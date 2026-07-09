/* ================================================================
   DD Game Box Web - 主应用逻辑
   连接 UI、解析器、API 客户端、打包器
   ================================================================ */

class DDGameBoxApp {
  constructor() {
    // 状态
    this.parseResult = null;
    this.manifestData = [];
    this.fetchedManifests = {};
    this.gameName = '';
    this.isFetching = false;

    // 组件
    this.api = new ApiClient();
    this.zip = new ZipPackager();

    // DOM
    this.dom = {};

    this._initDOM();
    this._initEvents();
    this._checkAPIs();
  }

  _initDOM() {
    this.dom = {
      dropZone: document.getElementById('dropZone'),
      fileInput: document.getElementById('fileInput'),
      parseResult: document.getElementById('parseResult'),
      gameInfo: document.getElementById('gameInfo'),
      depotList: document.getElementById('depotList'),
      keyInfo: document.getElementById('keyInfo'),
      fetchBtn: document.getElementById('fetchBtn'),
      downloadZipBtn: document.getElementById('downloadZipBtn'),
      clearBtn: document.getElementById('clearBtn'),
      progressSection: document.getElementById('progressSection'),
      progressContainer: document.getElementById('progressContainer'),
      logArea: document.getElementById('logArea'),
      statusText: document.getElementById('statusText'),
      fileCount: document.getElementById('fileCount'),
      apiStatus: document.getElementById('apiStatus'),
      logTabs: document.querySelectorAll('.log-tab'),
    };
  }

  _initEvents() {
    const dz = this.dom.dropZone;
    const fi = this.dom.fileInput;

    // 拖放事件
    dz.addEventListener('click', () => fi.click());

    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('drag-over');
    });

    dz.addEventListener('dragleave', () => {
      dz.classList.remove('drag-over');
    });

    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) this._handleFiles(files);
    });

    fi.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this._handleFiles(e.target.files);
        fi.value = '';
      }
    });

    // 按钮
    this.dom.fetchBtn.addEventListener('click', () => this._startFetch());
    this.dom.downloadZipBtn.addEventListener('click', () => this._downloadPackage());
    this.dom.clearBtn.addEventListener('click', () => this._clear());

    // 日志过滤标签
    this.dom.logTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.dom.logTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._applyLogFilter(tab.dataset.type);
      });
    });
  }

  /**
   * 处理上传的文件
   */
  async _handleFiles(files) {
    this._clear();
    this.log(`处理 ${files.length} 个文件...`, 'info');

    let allContent = '';
    const manifestFiles = [];

    for (const file of files) {
      try {
        const content = await file.text();
        
        // 判断文件类型
        if (file.name.endsWith('.manifest')) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 加载 manifest: ${file.name}`, 'info');
          continue;
        }

        if (LuaParser.isValid(content) || file.name.endsWith('.lua') || file.name.endsWith('.txt')) {
          allContent += '\n' + content;
          this.log(`📄 加载脚本: ${file.name} (${(content.length / 1024).toFixed(1)}KB)`, 'info');
        } else if (this._looksLikeManifestJSON(content)) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 加载 JSON manifest: ${file.name}`, 'info');
        } else {
          this.log(`⚠️ 跳过未知格式: ${file.name}`, 'warn');
        }
      } catch (e) {
        this.log(`❌ 读取失败: ${file.name} - ${e.message}`, 'error');
      }
    }

    // 解析 Lua/SteamCMD 内容
    if (allContent.trim()) {
      this.parseResult = LuaParser.parse(allContent);
      this.log(`✅ 解析完成: AppID=${this.parseResult.appid || '未知'}, Depots=${this.parseResult.depots.length}`, 'success');
      this._renderParseResult();

      // 如果有 manifest 文件，分析 depot IDs
      if (manifestFiles.length > 0) {
        this._processManifestFiles(manifestFiles);
      }

      // 尝试获取游戏名称
      if (this.parseResult.appid) {
        this._fetchGameName(this.parseResult.appid);
      }

    } else if (manifestFiles.length > 0) {
      // 只有 manifest 文件，尝试推断 appid
      const ids = LuaParser.extractDepotsFromFilenames(manifestFiles.map(f => f.name));
      this.parseResult = {
        appid: ids[0] || null,
        depots: ids.map(id => ({ id, sha: null, hasKey: false })),
        tokens: [],
        missingKeys: false,
        rawContent: ''
      };
      this.log(`📋 从 manifest 文件名推断: ${ids.join(', ')}`, 'info');
      this._renderParseResult();
      this._processManifestFiles(manifestFiles);
    } else {
      this.log('⚠️ 未找到可识别的游戏配置内容', 'warn');
    }

    this._updateStatus();
  }

  /**
   * 检测是否为 JSON manifest 格式
   */
  _looksLikeManifestJSON(content) {
    try {
      const data = JSON.parse(content.startsWith('1|') ? content.slice(2) : content);
      return data && typeof data === 'object' && !Array.isArray(data);
    } catch {
      return false;
    }
  }

  /**
   * 处理上传的 manifest 文件
   */
  _processManifestFiles(files) {
    this.log(`📦 处理 ${files.length} 个 manifest 文件...`, 'info');
    this.manifestData = files;
    this.dom.downloadZipBtn.disabled = false;
  }

  /**
   * 获取游戏名称
   */
  async _fetchGameName(appid) {
    try {
      this.gameName = await this.api.getGameName(appid);
      if (this.gameName) {
        this.log(`🏷️ 游戏名称: ${this.gameName}`, 'success');
        this._renderParseResult();
      }
    } catch {
      this.log('⚠️ 无法获取游戏名称', 'warn');
    }
  }

  /**
   * 渲染解析结果
   */
  _renderParseResult() {
    const r = this.parseResult;
    if (!r) return;

    this.dom.parseResult.hidden = false;

    // 游戏信息
    const gameInfoHTML = `
      <span class="label">游戏名称</span>
      <span class="value">${this.gameName || '获取中...'}</span>
      <span class="label">APP ID</span>
      <span class="value appid">${r.appid || '未知'}</span>
      <span class="label">Depot 数量</span>
      <span class="value">${r.depots.length} 个</span>
      <span class="label">密钥状态</span>
      <span class="value" style="color: ${r.missingKeys ? '#c41e3a' : '#6b8e23'}">
        ${r.missingKeys ? '有缺失密钥' : '完整密钥'}
      </span>
    `;
    this.dom.gameInfo.innerHTML = gameInfoHTML;

    // Depot 列表
    const depotHTML = r.depots.map(d => `
      <div class="depot-item" data-depot-id="${d.id}">
        <span class="depot-id">${d.id}</span>
        <span class="depot-sha" title="${d.sha || '无密钥'}">
          ${d.sha ? d.sha.substring(0, 40) + '...' : '❌ 无密钥'}
        </span>
        <span class="depot-status ${d.hasKey ? 'ok' : 'missing'}">
          ${d.hasKey ? '有密钥' : '缺密钥'}
        </span>
      </div>
    `).join('');
    this.dom.depotList.innerHTML = depotHTML || '<div style="color:var(--label)">未找到 Depot</div>';

    // 密钥信息
    const tokenHTML = r.tokens.length > 0 
      ? r.tokens.map(t => `<div class="token-item">🔑 Token APPID ${t.appid}: ${t.token}</div>`).join('')
      : '<div>无额外 Token</div>';
    this.dom.keyInfo.innerHTML = tokenHTML;

    // 启用按钮
    if (r.appid || r.depots.length > 0) {
      this.dom.fetchBtn.disabled = false;
    }
  }

  /**
   * 开始获取 Manifest
   */
  async _startFetch() {
    if (this.isFetching) return;
    this.isFetching = true;
    this.dom.fetchBtn.disabled = true;
    this.dom.fetchBtn.textContent = '⏳ 获取中...';
    this.dom.progressSection.hidden = false;
    this.dom.progressContainer.innerHTML = '';

    const r = this.parseResult;
    const depotIds = r.depots.map(d => d.id);

    try {
      // Step 1: 过滤 Windows depots
      if (r.appid) {
        this._addProgress('step1', '🔍 过滤 Windows Depots', 0);
        const filtered = await this.api.filterWindowsDepots(r.appid, depotIds);
        this._updateProgress('step1', 100);
        this.log(`✅ 过滤完成: ${filtered.length}/${depotIds.length} 个 Windows Depot`, 'success');

        // Step 2: 获取最新 Manifest IDs
        this._addProgress('step2', '📡 获取最新 Manifest IDs', 0);
        const manifests = await this.api.fetchLatestManifests(r.appid, filtered);
        this.fetchedManifests = manifests;
        this._updateProgress('step2', 100);
        this.log(`✅ 获取到 ${Object.keys(manifests).length} 个 manifest IDs`, 'success');

        // 更新 depot 显示
        for (const [depotId, manifestId] of Object.entries(manifests)) {
          const item = this.dom.depotList.querySelector(`[data-depot-id="${depotId}"]`);
          if (item) {
            const status = item.querySelector('.depot-status');
            status.textContent = `Manifest: ${manifestId.substring(0, 12)}...`;
            status.className = 'depot-status ok';
          }
        }

        // Step 3: 下载 Manifest 文件
        let completed = 0;
        const total = Object.entries(manifests).length;
        
        if (total > 0) {
          this._addProgress('step3', '⬇️ 下载 Manifest 文件', 0);
          
          for (const [depotId, manifestId] of Object.entries(manifests)) {
            try {
              this.log(`⬇️ 获取 manifest ${depotId} 请求码...`, 'api');
              const rc = await this.api.fetchRequestCode(manifestId);
              if (rc) {
                this.log(`⬇️ 下载 manifest ${depotId}...`, 'api');
                const result = await this.api.downloadManifest(depotId, manifestId, rc);
                this.manifestData.push({
                  depotId: parseInt(depotId),
                  manifestId,
                  data: result.data,
                  filename: result.filename
                });
                this.log(`✅ Manifest ${depotId} 下载完成`, 'success');
              }
            } catch (e) {
              this.log(`❌ Manifest ${depotId} 下载失败: ${e.message}`, 'error');
            }
            
            completed++;
            this._updateProgress('step3', (completed / total) * 100);
          }
        }
      }

      // Step 4: 生成 VDF
      this._addProgress('step4', '🔧 生成配置文件', 50);
      const vdfContent = VdfGenerator.generate(r);
      this._updateProgress('step4', 100);
      this.log('✅ config.vdf 已生成', 'success');
      
      // 显示 VDF 预览
      this._showVdfPreview(vdfContent);

      // 完成
      this.log('🎉 所有操作完成！', 'success');
      this.dom.downloadZipBtn.disabled = false;

    } catch (e) {
      this.log(`❌ 获取失败: ${e.message}`, 'error');
    } finally {
      this.isFetching = false;
      this.dom.fetchBtn.textContent = '🚀 获取 Manifest';
      this.dom.fetchBtn.disabled = !this.parseResult;
      this._updateStatus();
    }
  }

  /**
   * 添加进度条
   */
  _addProgress(id, label, percent) {
    const div = document.createElement('div');
    div.className = 'progress-item loading';
    div.id = `progress-${id}`;
    div.innerHTML = `
      <div class="progress-header">
        <span>${label}</span>
        <span class="progress-pct">${percent}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percent}%"></div>
      </div>
    `;
    this.dom.progressContainer.appendChild(div);
  }

  /**
   * 更新进度
   */
  _updateProgress(id, percent) {
    const item = document.getElementById(`progress-${id}`);
    if (!item) return;
    const fill = item.querySelector('.progress-fill');
    const pct = item.querySelector('.progress-pct');
    fill.style.width = `${percent}%`;
    pct.textContent = `${Math.round(percent)}%`;
    if (percent >= 100) {
      item.classList.remove('loading');
    }
  }

  /**
   * 显示 VDF 预览模态框
   */
  _showVdfPreview(vdfContent) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>📄 config.vdf 预览</h3>
        <textarea readonly>${this._escapeHtml(vdfContent)}</textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
          <button class="btn btn-primary" onclick="copyText(this)">📋 复制</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    
    window.copyText = function(btn) {
      const textarea = btn.closest('.modal-box').querySelector('textarea');
      navigator.clipboard.writeText(textarea.value).then(() => {
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = '📋 复制', 2000);
      });
    };
  }

  /**
   * 打包下载
   */
  async _downloadPackage() {
    try {
      this.log('📦 正在打包...', 'info');
      
      this.zip.createPackage(this.parseResult, this.manifestData);
      
      await this.zip.download('ddgamebox-package.zip');
      
      this.log(`✅ 打包完成: ${this.zip.getFileList().length} 个文件`, 'success');
    } catch (e) {
      this.log(`❌ 打包失败: ${e.message}`, 'error');
    }
  }

  /**
   * 清空所有
   */
  _clear() {
    this.parseResult = null;
    this.manifestData = [];
    this.fetchedManifests = {};
    this.gameName = '';
    this.isFetching = false;

    this.dom.parseResult.hidden = true;
    this.dom.progressSection.hidden = true;
    this.dom.fetchBtn.disabled = true;
    this.dom.downloadZipBtn.disabled = true;
    this.dom.logArea.innerHTML = '';
    this.dom.progressContainer.innerHTML = '';
    this.log('🔄 已清空', 'info');
    this._updateStatus();
  }

  /**
   * 日志
   */
  log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.dataset.type = type;
    line.innerHTML = `<span class="log-time">[${time}]</span>${this._escapeHtml(msg)}`;
    this.dom.logArea.appendChild(line);
    line.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  /**
   * 应用日志过滤器
   */
  _applyLogFilter(type) {
    const lines = this.dom.logArea.querySelectorAll('.log-line');
    lines.forEach(line => {
      if (type === 'all' || line.dataset.type === type) {
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    });
  }

  /**
   * 更新状态栏
   */
  _updateStatus() {
    const r = this.parseResult;
    if (r && r.appid) {
      this.dom.statusText.textContent = `已解析: AppID ${r.appid} | ${r.depots.length} depots`;
    } else if (r) {
      this.dom.statusText.textContent = `已解析: ${r.depots.length} depots`;
    } else {
      this.dom.statusText.textContent = '就绪';
    }
    this.dom.fileCount.textContent = `📁 ${this.manifestData.length} manifest 文件`;
  }

  /**
   * 检查 API 可用性
   */
  async _checkAPIs() {
    this.dom.apiStatus.textContent = '🌐 API 状态: 检测中...';
    try {
      const resp = await fetch('https://api.allorigins.win/get?url=https://httpbin.org/get');
      if (resp.ok) {
        this.dom.apiStatus.innerHTML = '🌐 API 状态: <span style="color:#6b8e23">可用</span>';
      } else {
        this.dom.apiStatus.innerHTML = '🌐 API 状态: <span style="color:#e65100">有限</span>';
      }
    } catch {
      this.dom.apiStatus.innerHTML = '🌐 API 状态: <span style="color:#c62828">不可用</span>';
    }
  }

  /**
   * HTML 转义
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  window.app = new DDGameBoxApp();
  window.app.log('🚀 DD Game Box Web 已启动', 'success');
  window.app.log('💡 拖入 SteamCMD Lua 脚本文件开始', 'info');
});
