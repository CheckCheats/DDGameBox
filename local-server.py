# -*- coding: utf-8 -*-
"""
DD Game Box 本地代理服务器
将前端解析的密钥数据传给 ddv20.exe 执行真正的游戏下载
然后打包成 ZIP 返回浏览器

用法: python local-server.py
"""

import os
import sys
import json
import time
import uuid
import shutil
import base64
import zipfile
import threading
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ============================================================
# 配置
# ============================================================
HOST = '127.0.0.1'
PORT = 8899
DDV20_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'DepotDownloader', 'ddv20.exe')
WORK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '.local_downloads')

active_task = None
task_lock = threading.Lock()


# ============================================================
# 工具函数
# ============================================================

def json_response(handler, data, status=200):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.end_headers()
    handler.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

def run_ddv20(dd_path, args, task_dir, log_callback):
    """运行 ddv20.exe 并捕获输出（绕过系统代理直连 Steam）"""
    cmd = [dd_path] + args
    log_callback(f"▶ {' '.join(cmd)}")
    
    # 使用系统代理（Clash/V2Ray 等翻墙工具），直连 Steam 在国内会被 GFW 阻断
    env = os.environ.copy()
    # 显式设置代理，避免 requests 读取注册表失败
    env['HTTP_PROXY'] = 'http://127.0.0.1:7897'
    env['HTTPS_PROXY'] = 'http://127.0.0.1:7897'
    env['http_proxy'] = 'http://127.0.0.1:7897'
    env['https_proxy'] = 'http://127.0.0.1:7897'
    env.pop('NO_PROXY', None)
    env.pop('no_proxy', None)
    env.pop('ALL_PROXY', None)
    env.pop('all_proxy', None)
    try:
        proc = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=task_dir,
            creationflags=subprocess.CREATE_NO_WINDOW,
            bufsize=1,
            universal_newlines=True
        )
        for line in proc.stdout:
            line = line.rstrip('\n\r')
            log_callback(line)
        proc.wait()
        return proc.returncode
    except Exception as e:
        log_callback(f"❌ 启动失败: {e}")
        return -1


def create_zip(source_dir, output_path):
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, dirs, files in os.walk(source_dir):
            for f in files:
                if f.endswith('.manifest') or f.endswith('.tmp') or f.startswith('.'):
                    continue
                fp = os.path.join(root, f)
                arcname = os.path.relpath(fp, source_dir)
                zf.write(fp, arcname)


# ============================================================
# 下载任务线程
# ============================================================

def download_worker(task_id, data, task_dir):
    """后台下载线程"""
    global active_task

    appid = data.get('appid', '')
    depots = data.get('depots', [])
    manifests = data.get('manifests', [])
    keys = data.get('keys', {})

    def log(msg):
        with task_lock:
            if active_task and active_task['id'] == task_id:
                active_task['logs'].append(f"[{time.strftime('%H:%M:%S')}] {msg}")

    output_dir = os.path.join(task_dir, 'downloads')
    manifest_dir = os.path.join(task_dir, 'manifests')
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(manifest_dir, exist_ok=True)

    with task_lock:
        if active_task and active_task['id'] == task_id:
            active_task['status'] = 'running'
            active_task['progress'] = 5

    try:
        # 1. 保存 manifest 文件
        log(f"📄 正在处理 {len(manifests)} 个 manifest 文件...")
        saved_manifests = 0
        for m in manifests:
            fname = m.get('filename', '')
            if not fname:
                continue
            mpath = os.path.join(manifest_dir, fname)

            if m.get('is_binary') and m.get('content_b64'):
                try:
                    raw = base64.b64decode(m['content_b64'])
                    with open(mpath, 'wb') as f:
                        f.write(raw)
                    saved_manifests += 1
                    log(f"  ✓ {fname} ({len(raw)} bytes)")
                except Exception as e:
                    log(f"  ⚠️ {fname} 解码失败: {e}")
            elif m.get('content'):
                content = m.get('content', '')
                if isinstance(content, str) and content.strip():
                    with open(mpath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    saved_manifests += 1
                    log(f"  ✓ {fname} (text)")
            else:
                log(f"  ⚠️ {fname} 跳过: 无数据")

        if saved_manifests > 0:
            log(f"  ✅ 已保存 {saved_manifests} 个 manifest 文件")

        with task_lock:
            if active_task and active_task['id'] == task_id:
                active_task['progress'] = 15

        # 2. 检查 ddv20.exe
        if not os.path.exists(DDV20_PATH):
            log(f"❌ 未找到 ddv20.exe: {DDV20_PATH}")
            with task_lock:
                if active_task and active_task['id'] == task_id:
                    active_task['status'] = 'failed'
                    active_task['progress'] = 0
            return

        # 3. 获取所有已保存的 manifest 文件列表
        manifest_files = []
        if os.path.exists(manifest_dir):
            for f in os.listdir(manifest_dir):
                fp = os.path.join(manifest_dir, f)
                if os.path.isfile(fp):
                    manifest_files.append(fp)
                    log(f"  📎 发现: {f}")

        if not manifest_files:
            log("❌ 没有 manifest 文件，无法下载")
            with task_lock:
                if active_task and active_task['id'] == task_id:
                    active_task['status'] = 'failed'
                    active_task['progress'] = 0
            return

        # 4. 逐个下载每个 depot
        total_depots = len(depots)
        for idx, depot in enumerate(depots):
            depot_id = depot.get('id', depot.get('depotId'))
            if not depot_id:
                continue

            depot_key = keys.get(str(depot_id), depot.get('sha', ''))
            log(f"📥 下载 Depot {depot_id} ({idx+1}/{total_depots})...")

            args = []
            if appid:
                args += ['-a', str(appid)]
            args += ['-l']
            args += ['-o', output_dir]
            args += ['-t', '16']
            args += ['depot']
            args += ['-m'] + manifest_files

            if depot_key:
                args += ['-k', depot_key]

            ret = run_ddv20(DDV20_PATH, args, task_dir, log)

            if ret == 0:
                log(f"✅ Depot {depot_id} 下载完成")
            else:
                log(f"⚠️ Depot {depot_id} 返回码 {ret}")

            with task_lock:
                if active_task and active_task['id'] == task_id:
                    pct = 15 + int((idx + 1) / total_depots * 65)
                    active_task['progress'] = min(pct, 80)

        # 5. 打包 ZIP
        log("📦 打包游戏文件...")
        zip_path = os.path.join(task_dir, f'game-{appid}.zip')
        create_zip(output_dir, zip_path)

        zip_size = os.path.getsize(zip_path)
        log(f"✅ 打包完成: {zip_size / 1024 / 1024:.1f} MB")

        with task_lock:
            if active_task and active_task['id'] == task_id:
                active_task['status'] = 'completed'
                active_task['progress'] = 100
                active_task['zip_path'] = zip_path
                active_task['zip_size'] = zip_size

    except Exception as e:
        log(f"❌ 下载失败: {e}")
        import traceback
        log(traceback.format_exc()[-200:])
        with task_lock:
            if active_task and active_task['id'] == task_id:
                active_task['status'] = 'failed'
                active_task['progress'] = 0


# ============================================================
# HTTP 处理器
# ============================================================

class DDGHandler(BaseHTTPRequestHandler):

    def _set_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/health':
            return json_response(self, {
                'status': 'ok',
                'ddv20': os.path.exists(DDV20_PATH),
                'ddv20_path': DDV20_PATH
            })

        if path == '/api/status':
            with task_lock:
                if active_task:
                    resp = {
                        'id': active_task['id'],
                        'status': active_task['status'],
                        'progress': active_task['progress'],
                        'logs': active_task['logs'][-50:],
                    }
                else:
                    resp = {'id': None, 'status': 'idle', 'progress': 0, 'logs': []}
            return json_response(self, resp)

        if path == '/api/download-zip':
            with task_lock:
                if not active_task or active_task['status'] != 'completed' or not active_task.get('zip_path'):
                    return json_response(self, {'error': '没有可下载的文件'}, 400)
                zip_path = active_task['zip_path']
                appid = active_task.get('appid', 'game')

            if not os.path.exists(zip_path):
                return json_response(self, {'error': '文件不存在'}, 404)

            self.send_response(200)
            self._set_cors()
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', f'attachment; filename="game-{appid}.zip"')
            self.send_header('Content-Length', str(os.path.getsize(zip_path)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            with open(zip_path, 'rb') as f:
                shutil.copyfileobj(f, self.wfile)
            return

        return json_response(self, {'error': '未知路径'}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/download':
            global active_task

            content_len = int(self.headers.get('Content-Length', 0))
            if content_len == 0:
                return json_response(self, {'error': '请求体为空'}, 400)

            body = self.rfile.read(content_len)
            try:
                data = json.loads(body.decode('utf-8'))
            except json.JSONDecodeError:
                return json_response(self, {'error': 'JSON 解析失败'}, 400)

            appid = data.get('appid', '')
            if not appid:
                return json_response(self, {'error': '缺少 appid'}, 400)

            with task_lock:
                if active_task and active_task['status'] in ('running', 'init'):
                    return json_response(self, {
                        'error': '已有下载任务进行中',
                        'current_id': active_task['id']
                    }, 409)

            task_id = str(uuid.uuid4())[:8]
            task_dir = os.path.join(WORK_DIR, task_id)
            os.makedirs(task_dir, exist_ok=True)

            with task_lock:
                active_task = {
                    'id': task_id,
                    'appid': appid,
                    'status': 'init',
                    'progress': 0,
                    'logs': [],
                    'zip_path': None,
                    'zip_size': 0,
                    'data': data,
                    'dir': task_dir
                }

            thread = threading.Thread(
                target=download_worker,
                args=(task_id, data, task_dir),
                daemon=True
            )
            thread.start()

            return json_response(self, {
                'id': task_id,
                'status': 'init',
                'message': '下载任务已启动'
            })

        if path == '/api/cancel':
            with task_lock:
                if active_task:
                    active_task['logs'].append(f"[{time.strftime('%H:%M:%S')}] ⛔ 用户取消下载")
                    active_task['status'] = 'cancelled'
            with task_lock:
                if active_task and active_task.get('dir') and os.path.exists(active_task['dir']):
                    try:
                        shutil.rmtree(active_task['dir'])
                    except:
                        pass
                active_task = None
            return json_response(self, {'status': 'cancelled'})

        return json_response(self, {'error': '未知路径'}, 404)

    def log_message(self, format, *args):
        pass


# ============================================================
# 主入口
# ============================================================

def main():
    os.makedirs(WORK_DIR, exist_ok=True)

    if not os.path.exists(DDV20_PATH):
        print(f"⚠️ 警告: 未找到 ddv20.exe")
        print(f"   预期路径: {DDV20_PATH}")
        print()
        print(f"   请确认 DepotDownloader 目录存在且包含 ddv20.exe")
        print()

    server = HTTPServer((HOST, PORT), DDGHandler)
    print(f"========================================")
    print(f"  DD Game Box 本地代理服务器")
    print(f"  http://{HOST}:{PORT}")
    print(f"========================================")
    print(f"  浏览器中的 DD Game Box 会自动连接此服务器")
    print(f"  关闭此窗口 = 停止服务")
    print(f"========================================")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 服务已停止")
        server.server_close()


if __name__ == '__main__':
    main()
