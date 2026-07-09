# =============================================================================
# 地道游戏盒 V14 (DD Game Box V14) - 逆向工程完整分析报告
# Complete Reverse Engineering Analysis Report
# =============================================================================
# 
# 目标软件: D:\DDGameBox\地道游戏盒V14.exe (V14)
# 作者:      德印小馆长
# QQ群:      971469953
# 
# 分析完成时间: 2026-07-09
# =============================================================================

"""
=============================================================================
一、架构概览 (Architecture Overview)
=============================================================================

地道游戏盒V14 是一个 PyInstaller 打包的 Python 应用程序，使用 PyQt6 GUI 框架。
它本质上是一个 Steam 游戏下载器的前端界面，核心下载引擎是内置的
DepotDownloader v2.0 (ddv20.exe)。

技术栈:
- Python 3.14 (python314.dll)
- PyQt6 (GUI框架)
- PyInstaller 6.x (打包)
- steam 库 (Steam CDN 客户端)
- requests (HTTP 客户端)
- tqdm (进度条)
- zstandard (ZSTD解压)
- py7zr / rarfile (压缩文件处理)
- vdf (Valve配置解析)
- pywin32 (Windows API 集成)

=============================================================================
二、文件结构 (File Structure)
=============================================================================

D:\DDGameBox\
├── 地道游戏盒V14.exe    # 主程序 (PyInstaller one-file bundle, ~64MB)
├── DepotDownloader\
│   ├── ddv20.exe        # Steam Depot下载器 (PyInstaller bundle, ~20MB)
│   └── depot\
│       ├── config.vdf    # Steam Depot 解密密钥配置
│       ├── *.manifest    # Depot manifests (下载清单)
│       └── ...
├── icon.ico             # 应用图标
├── unins000.exe         # InnoSetup 卸载程序
└── *.json               # 游戏下载进度记录文件

=============================================================================
三、主程序功能模块 (Main Application Features)
=============================================================================
"""

import sys, os, json, re, subprocess
from typing import Dict, List, Optional

# =============================================================================
# 3.1 配置系统 (Configuration)
# =============================================================================

BASE_DIR = None  # 运行时确定：开发模式下是脚本目录，打包后是可执行文件目录
CONFIG_FILE = "config.json"
DEPOT_DIR = "./DepotDownloader"

DEFAULT_CONFIG = {
    "download_dir": "C:\\GAMEBOX",
    "version": "V14",
    "auto_retry": True,
}

def get_base_dir():
    """获取应用基础目录 (支持PyInstaller打包和开发模式)"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

def load_config() -> dict:
    """从config.json加载配置，带默认值"""
    if not os.path.exists(CONFIG_FILE):
        return DEFAULT_CONFIG.copy()
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)
    for key, value in DEFAULT_CONFIG.items():
        config.setdefault(key, value)
    return config

def save_config(config: dict):
    """保存配置到config.json"""
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

def get_download_path(game_name: str) -> str:
    """获取游戏下载路径"""
    config = load_config()
    base = config.get('download_dir', '')
    if not base:
        base = 'C:\\GAMEBOX'
    return os.path.join(base, game_name)

# =============================================================================
# 3.2 API 端点 (API Endpoints)
# =============================================================================

# --- Steam信息API ---
STEAMCMD_API = "https://api.steamcmd.net/v1/info/{appid}"
STORE_API = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"

# --- Manifest 下载 API (多重容错) ---
WUDRM_API = "http://gmrc.wudrm.com/manifest/{manifest_id}"        # 武德人 API
STEAMRUN_API = "https://manifest.steam.run/api/manifest/{manifest_id}"  # Steam.Run API
STEAMOOO_API = "https://manifest.steam.ooo/{manifest_id}"          # Steam.OOO API

# --- Steam CDN ---
CDN_BASE = "http://steampipe.akamaized.net"

# --- HTTP Headers ---
HEADERS = {
    "User-Agent": "Valve/Steam HTTP Client 1.0",
    "Accept": "*/*",
    "Accept-Encoding": "deflate, gzip",
}

# --- 推广链接 ---
GAME_LIST_URL = "https://link3.cc/guanzhang"
QQ_GROUP_URL = "https://qm.qq.com/q/TfLRtz50cK"
BILIBILI_URL = "https://space.bilibili.com/286896221"
VERSION_URL = "https://pan.quark.cn/s/ad08ad1f1d06"

# =============================================================================
# 3.3 Steam API 交互 (Steam API Interaction)
# =============================================================================

_api_cache: Dict[int, dict] = {}

def api_get(appid: int) -> dict:
    """
    从 SteamCMD API 获取 App 信息 (带缓存)
    返回格式: {"success": true, "data": {"type": "game", "depots": {}}}
    """
    import requests
    if appid in _api_cache:
        return _api_cache[appid]
    
    resp = requests.get(STEAMCMD_API.format(appid=appid))
    resp.raise_for_status()
    data = resp.json()
    _api_cache[appid] = data
    return data

def get_game_name_from_api(appid: int) -> str:
    """
    从 Steam Store API 获取游戏名称
    请求: store.steampowered.com/api/appdetails?appids={appid}
    """
    import requests
    try:
        resp = requests.get(STORE_API.format(appid=appid))
        if resp.status_code == 200:
            data = resp.json()
            app_data = data.get(str(appid), {}).get("data", {})
            return app_data.get("common", {}).get("name", "")
    except:
        pass
    return ""

# =============================================================================
# 3.4 Manifest 操作 (Manifest Operations)
# =============================================================================

def fetch_latest_manifests(appid: int, depot_ids: List[int]) -> Dict[int, str]:
    """
    获取指定 depot 的最新 manifest ID
    返回: {depot_id: manifest_gid, ...}
    """
    data = api_get(appid)
    depots = data.get("data", {}).get("depots", {})
    manifests = {}
    
    for depot_id in depot_ids:
        depot_info = depots.get(str(depot_id), {})
        # 优先从 public branch 获取
        public = depot_info.get("public", {})
        if "gid" in public:
            manifests[depot_id] = public["gid"]
        elif "manifests" in depot_info:
            manifests[depot_id] = depot_info["manifests"].get("public", {}).get("gid", "")
    
    return manifests

def filter_windows_depots(appid: int, depot_ids: List[int]) -> List[int]:
    """
    过滤掉 macOS/Linux/steamchina 的 depot
    只保留 Windows 平台的 depot
    """
    data = api_get(appid)
    depots = data.get("data", {}).get("depots", {})
    result = []
    
    for depot_id in depot_ids:
        depot_info = depots.get(str(depot_id), {})
        config = depot_info.get("config", {})
        oslist = config.get("oslist", "").lower()
        realm = config.get("realm", "").lower()
        
        # 包含 windows 或没有指定 oslist 的认为支持 Windows
        if "windows" in oslist or not oslist:
            # 排除 steamchina
            if "steamchina" not in realm:
                result.append(depot_id)
    
    return result

def fetch_request_code(mid: str) -> str:
    """
    获取 manifest 下载请求码 (多API容错)
    依次尝试: steam.ooo → wudrm → steam.run
    """
    import requests
    
    # 1. 尝试 steam.ooo
    try:
        resp = requests.get(STEAMOOO_API.format(manifest_id=mid))
        if resp.status_code == 200:
            code = resp.text.strip()
            if code.isdigit():
                return code
    except:
        pass
    
    # 2. 尝试 wudrm
    try:
        resp = requests.get(WUDRM_API.format(manifest_id=mid))
        if resp.status_code == 200:
            return resp.text.strip()
    except:
        pass
    
    # 3. 尝试 steam.run
    try:
        resp = requests.get(STEAMRUN_API.format(manifest_id=mid))
        if resp.status_code == 200:
            data = resp.json()
            return data.get("content", "")
    except:
        pass
    
    return ""

def download_manifest(did: int, mid: str, rc: str, out_dir: str):
    """
    从 Steam CDN 下载 manifest 文件
    URL 格式: {CDN_BASE}/depot/{did}/manifest/{mid}/5/{rc}
    """
    import requests, zipfile, io
    
    url = f"{CDN_BASE}/depot/{did}/manifest/{mid}/5/{rc}"
    resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    
    content = resp.content
    
    # 判断是否是 ZIP 返回
    if content[:2] == b'PK':  # ZIP magic number
        zf = zipfile.ZipFile(io.BytesIO(content))
        for name in zf.namelist():
            if name.endswith('.manifest'):
                filepath = os.path.join(out_dir, f"{did}_{name}")
                with open(filepath, 'wb') as f:
                    f.write(zf.read(name))
    else:
        # 直接保存为 .manifest 文件
        filename = f"{did}_{mid}.manifest"
        filepath = os.path.join(out_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(content)

def find_manifest_in_data(data: dict, target: dict) -> Optional[str]:
    """
    在 Steam API 返回数据中递归搜索 manifest 信息
    用于从复杂嵌套结构中找到 gid/manifest ID
    """
    # 递归搜索
    def search(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "gid" and isinstance(v, str):
                    return v
                result = search(v)
                if result:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = search(item)
                if result:
                    return result
        return None
    return search(data)

# =============================================================================
# 3.5 VDF 配置生成 (VDF Config Generation)
# =============================================================================

def generate_config_vdf(info: dict, out_dir: str):
    """
    生成 Steam DepotDownloader 配置文件 config.vdf
    格式:
        "depots"
        {
            "228990"
            {
                "DecryptionKey" "44d8c45ce229a11c4f231a3d2a350eaf80b0d69a8af938ec7ccca720f694b0e8"
            }
        }
    """
    depots = info.get("depots", [])
    lines = ['"depots"', '{']
    
    for depot in depots:
        did = str(depot.get("id", 0))
        sha = depot.get("sha", "")
        lines.append(f'    "{did}"')
        lines.append('    {')
        lines.append(f'        "DecryptionKey" "{sha}"')
        lines.append('    }')
    
    lines.append('}')
    
    filepath = os.path.join(out_dir, 'config.vdf')
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

# =============================================================================
# 3.6 Lua 脚本解析 (Lua Script Parsing)
# =============================================================================

def parse_lua(content: str) -> dict:
    """
    解析 SteamCMD 格式的 Lua 脚本，提取游戏配置信息
    
    支持的格式:
    1. 主游戏APPID: 123456 或 主游戏APPID：123456
    2. addappid(appid)                     -- 基础 depot (无密钥)
    3. addappid(appid, token, "sha_value") -- 完整 depot (带密钥)
    4. addtoken(appid, "token")            -- DLC token
    5. 注释标记: 缺少密钥 / 无仓库
    
    返回:
    {
        "appid": 主游戏ID,
        "depots": [{"id": depot_id, "sha": "sha_value"}, ...],
        "dlc_depots": [...],
        "tokens": [{"appid": id, "token": "value"}, ...],
        "dlc_only": False,
        "missing_keys": False
    }
    """
    import re
    
    info = {
        "appid": None,
        "depots": [],
        "dlc_depots": [],
        "tokens": [],
        "dlc_only": False,
        "missing_keys": False,
    }
    
    # 提取主游戏 APPID
    m = re.search(r'主游戏APPID[：:]\s*(\d+)', content)
    if m:
        info["appid"] = int(m.group(1))
    
    # 提取带密钥的 addappid (完整格式)
    # addappid(480, 1, "abc123def456")
    for m in re.finditer(r'addappid\((\d+),\s*\d+,\s*"([^"]*)"\)', content):
        did = int(m.group(1))
        sha = m.group(2)
        info["depots"].append({"id": did, "sha": sha})
    
    # 提取不带密钥的 addappid (只有ID)
    # addappid(480)  -- 注释
    for m in re.finditer(r'^[ \t]*addappid\((\d+)\)\s*(?:--.*)?$', content, re.MULTILINE):
        did = int(m.group(1))
        # 避免重复
        if not any(d["id"] == did for d in info["depots"]):
            info["depots"].append({"id": did, "sha": None})
    
    # 提取 token
    for m in re.finditer(r'addtoken\((\d+),\s*"(\d+)"\)', content):
        info["tokens"].append({
            "appid": int(m.group(1)),
            "token": m.group(2)
        })
    
    # 检查特殊标记
    if re.search(r'缺少密钥|无仓库', content):
        info["missing_keys"] = True
    
    return info

# =============================================================================
# 3.7 ddv20.exe 接口 (DepotDownloader Interface)
# =============================================================================
#
# ddv20.exe 是一个 Python 编写的 Steam Depot 下载器，支持以下命令行参数:
#
# 基本参数:
#   -r/--retry <n>         重试次数 (默认5)
#   -t/--thread <n>        并行下载线程 (默认32)
#   -o/--output <dir>      输出目录
#   -log/--level <level>   日志级别 (默认INFO)
#
# 认证参数:
#   -l/--login-anonymously 匿名登录 (获取CDN token)
#   -a/--app-id <id>       Steam App ID
#   -c/--cell-id <id>       CDN CellID 覆盖
#
# 连接参数:
#   -u/--api-host <host>    API 主机 (默认Public)
#   -s/--server <url>       内容服务器列表 (可多次指定)
#   -m/--max-servers <n>    最大服务器数 (默认20)
#   --use-http              使用 HTTP 连接
#   --use-websocket         使用 WebSocket 连接
#
# 子命令:
#   app -p/--app-path <path>        下载完整 App (用app manifest)
#   depot --manifest-path <paths>   下载指定 Depot (用depot manifest)
#
# 示例用法:
#   ddv20.exe -l -o C:\GAMEBOX\MyGame depot --manifest-path D:\manifests\228990.manifest
#   ddv20.exe -l -a 730 -o C:\CS2 depot --manifest-path D:\manifests\731.manifest ...
#
# ddv20.exe 核心数据流:
#   1. 解析 .manifest 文件 → DepotManifest 对象
#   2. 解析 config.vdf → 获取解密密钥
#   3. 匿名登录 Steam → 获取 CDN token
#   4. 连接 CDN 服务器 → 获取 chunk 数据
#   5. 多线程并行下载 → ZSTD 解压 → 写入文件

# =============================================================================
# 3.8 主程序核心 workflow (Main Workflow)
# =============================================================================

def run_ddv(args: List[str]):
    """
    运行 ddv20.exe
    
    典型调用流程:
    1. 用户通过 UI 加载 .lua 或 .manifest 文件
    2. parse_lua() 解析游戏配置
    3. api_get() 获取 Steam API 数据
    4. fetch_latest_manifests() 获取最新 manifest IDs
    5. filter_windows_depots() 过滤平台
    6. fetch_request_code() + download_manifest() 下载 manifests
    7. generate_config_vdf() 生成解密配置
    8. 调用 ddv20.exe 开始下载
    """
    ddv_path = os.path.join(BASE_DIR, DEPOT_DIR, "ddv20.exe")
    cmd = [ddv_path] + args
    return subprocess.run(cmd, capture_output=True, text=True)

# =============================================================================
# 3.9 UI 颜色方案 (Color Scheme)
# =============================================================================

COLORS = {
    # 背景色系
    "bg": "#fef9ef",           # 主背景 (暖米色)
    "panel": "#fdf5e6",        # 面板背景
    
    # 标题栏
    "title_bg": "#c41e3a",     # 标题背景 (红色)
    "title_fg": "#ffd700",     # 标题文字 (金色)
    
    # 按钮
    "btn_idle": "#f0c040",     # 按钮默认 (金色)
    "btn_hover": "#e8b830",    # 按钮悬停 (深金色)
    "btn_ok": "#6b8e23",       # 成功按钮 (绿色)
    "btn_fail": "#c41e3a",     # 失败按钮 (红色)
    "btn_fg": "#3d2b1f",       # 按钮文字 (深棕色)
    "btn_disabled": "#d0c8b0", # 禁用按钮
    
    # 日志
    "log_bg": "#5c3d2e",       # 日志背景 (深棕色)
    "log_fg": "#d4c5a9",       # 日志文字 (浅棕色)
    
    # 其他
    "label": "#8b7355",        # 标签文字
    "link": "#c41e3a",         # 链接颜色
    "progress": "#6b8e23",     # 进度条
    "border": "#d4c5a9",       # 边框
}

# =============================================================================
# 3.10 核心类实现 (Core Classes)
# =============================================================================
#
# 注：以下是从字节码反编译重组的伪代码实现
#

class KillThread:
    """杀死 ddv20 进程的后台线程"""
    def __init__(self, process):
        self.process = process
    
    def run(self):
        """终止进程"""
        if self.process:
            self.process.kill()

class SettingsDialog:
    """
    设置对话框
    - 下载路径选择 (QFileDialog)
    - 自动重试开关
    - 版本显示
    """
    def __init__(self, parent):
        self.config = load_config()
        # 显示下载路径
        # 浏览按钮 -> QFileDialog.getExistingDirectory()
        # 保存按钮 -> save_config()
    
    def browse_folder(self):
        from PyQt6.QtWidgets import QFileDialog
        path = QFileDialog.getExistingDirectory(
            self, "选择下载目录", self.config.get("download_dir", "C:\\GAMEBOX")
        )
        if path:
            self.download_path_edit.setText(path)
    
    def save_settings(self):
        self.config["download_dir"] = self.download_path_edit.text()
        save_config(self.config)
        self.accept()

class TaskManager:
    """
    任务状态管理器
    保存/加载/清除下载任务状态到 task_status.json
    """
    TASK_FILE = "task_status.json"
    
    @staticmethod
    def save_task(game_name: str, status: dict):
        tasks = {}
        if os.path.exists(TaskManager.TASK_FILE):
            with open(TaskManager.TASK_FILE, 'r', encoding='utf-8') as f:
                tasks = json.load(f)
        tasks[game_name] = status
        with open(TaskManager.TASK_FILE, 'w', encoding='utf-8') as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)
    
    @staticmethod
    def load_task(game_name: str) -> dict:
        if not os.path.exists(TaskManager.TASK_FILE):
            return {}
        with open(TaskManager.TASK_FILE, 'r', encoding='utf-8') as f:
            tasks = json.load(f)
        return tasks.get(game_name, {})
    
    @staticmethod
    def clear_task(game_name: str):
        if not os.path.exists(TaskManager.TASK_FILE):
            return
        with open(TaskManager.TASK_FILE, 'r', encoding='utf-8') as f:
            tasks = json.load(f)
        tasks.pop(game_name, None)
        with open(TaskManager.TASK_FILE, 'w', encoding='utf-8') as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)

class WorkerThread:
    """
    后台工作线程
    负责:
    1. 加载 manifest 数据
    2. 下载游戏文件
    3. 管理整个下载生命周期
    
    Signals:
    - log_msg(str): 日志消息
    - btn_color(str, str): 按钮颜色更新
    - info_signal(str): 状态信息
    - game_name_signal(str): 游戏名称
    - found_manifests(list): 找到的 manifests
    - ask_continue(str): 提示用户选择
    - finished_job(): 任务完成
    """
    def __init__(self, game_name, appid, depots, download_path, auto_retry=True):
        super().__init__()
        self.game_name = game_name
        self.appid = appid
        self.depots = depots
        self.download_path = download_path
        self.auto_retry = auto_retry
    
    def run(self):
        """主执行流程"""
        self._load()       # 1. 加载配置和manifests
        self._install()    # 2. 启动下载
        self._do_clean()   # 3. 清理
    
    def _load(self):
        """加载 manifest 数据"""
        # 获取 depot IDs (从 parse_lua 结果)
        # 调用 filter_windows_depots 过滤
        # 调用 fetch_latest_manifests 获取最新 manifest IDs
        # 对每个 depot: fetch_request_code + download_manifest
        # generate_config_vdf 生成配置
        pass
    
    def _install(self):
        """执行下载"""
        # 构建 ddv20.exe 命令行
        # 启动子进程
        # 监控输出和进度
        # 处理错误和重试
        pass
    
    def _do_clean(self):
        """清理临时文件"""
        # 删除临时下载的 manifest 文件
        # 清理缓存
        pass

class ColorButton:
    """
    自定义颜色按钮
    支持背景色、前景色、悬停效果
    """
    def __init__(self, text, idle_color="#f0c040", fg_color="#3d2b1f"):
        self.idle_color = idle_color
        self.fg_color = fg_color
        self._apply_style()
    
    def _apply_style(self):
        """应用 CSS 样式"""
        pass
    
    def set_color(self, hex_color: str):
        """动态更改按钮颜色"""
        pass
    
    @staticmethod
    def _darken(hex_color: str, factor=0.8) -> str:
        """将颜色暗化 (用于悬停效果)"""
        hex_color = hex_color.lstrip('#')
        rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        darkened = tuple(int(c * factor) for c in rgb)
        return f"#{darkened[0]:02x}{darkened[1]:02x}{darkened[2]:02x}"

class MainWindow:
    """
    主窗口
    包含:
    - 标题栏: 应用名称 + 图标
    - 游戏信息区: 游戏名称、状态、进度条
    - 操作按钮: 下载/安装/暂停/加载文件
    - 日志输出: 实时日志滚动显示
    - 底部栏: 设置、游戏列表、作者链接
    """
    pass

# =============================================================================
# 四、ddv20.exe 核心实现 (DepotDownloader Core)
# =============================================================================

class DepotDownloader:
    """
    Steam Depot 下载器核心类
    
    功能:
    - 连接 Steam CDN
    - 下载 depot chunks
    - 验证和解密数据
    - 管理多服务器/多线程下载
    """
    def __init__(self, session, cdn_clients, manifest_path_depot_key_dict,
                 output_dir, thread_count=32, retry_count=5):
        self.session = session        # Steam 会话
        self.cdn_clients = cdn_clients  # CDN 客户端列表
        self.manifests = manifest_path_depot_key_dict  # {manifest_path: (depot_key, manifest)}
        self.output_dir = output_dir
        self.thread_count = thread_count
        self.retry_count = retry_count
    
    def download(self):
        """
        主下载流程:
        1. 解析每个 manifest 中的文件列表
        2. 分配到多个 CDN 服务器
        3. 多线程并行下载 chunk
        4. ZSTD 解压 → 写入磁盘
        """
        pass

def get_manifest_path_depot_key_dict(path: str) -> dict:
    """
    从指定路径加载 manifest 和 depot key 配置
    
    路径可以是:
    - 目录: 扫描所有 .manifest 和 .vdf 文件
    - 单个 .manifest 文件: 配合同目录下的 config.vdf
    
    返回: {manifest_path: (depot_key, depot_manifest_object)}
    """
    pass

# =============================================================================
# 五、可复制性分析 (Replicability Analysis)
# =============================================================================
#
# 核心功能完全可以复制，关键点:
#
# 1. Steam Depot 下载 - 使用开源 steam 库或自行实现
#    - 匿名登录 Steam 获取 CDN token
#    - 连接 CDN 服务器
#    - 下载并解密 depot chunks
#
# 2. Manifest 获取 - 多 API 容错
#    - SteamCMD API (api.steamcmd.net)
#    - 第三方 manifest 镜像 API
#
# 3. 游戏配置解析
#    - Lua 脚本解析 (正则表达式即可)
#    - JSON manifest 文件解析
#    - VDF 配置生成
#
# 4. GUI 框架
#    - PyQt6 完全可替代
#    - 颜色方案可直接复用
#
# 5. PyInstaller 打包
#    - 将 Python 脚本 + ddv20.exe 打包为单个 EXE
#
# 完整替代方案:
#   使用 Python + PyQt6 + Steam库 + requests
#   功能完全等价，无需任何版权限制的外壳软件
# =============================================================================

# =============================================================================
# 六、完成总结
# =============================================================================
#
# 本报告涵盖：
# ✓ 完整的文件结构分析
# ✓ PyInstaller 打包提取和分析
# ✓ 所有 API 端点和数据流
# ✓ 完整的 Python 类和方法签名
# ✓ 颜色方案和 UI 设计规范
# ✓ Lua 脚本解析规则
# ✓ VDF 配置生成格式
# ✓ DepotDownloader 命令行接口
# ✓ 核心业务流程 (workflow)
# ✓ 可复制的架构设计
#
# 地道游戏盒 V14 本质上是一个包装器，核心价值在于:
# 1. 便捷的 GUI 界面
# 2. 多 API 容错的 manifest 获取逻辑
# 3. SteamCMD Lua 脚本的便捷解析
# 4. 与 ddv20.exe 的流程集成
# 5. 美观的暖色 UI 主题
# =============================================================================

print("逆向分析完成")
print(f"分析文件: D:\\DDGameBox\\REVERSE_ENGINEERING_COMPLETE.py")
