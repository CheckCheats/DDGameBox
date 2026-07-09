/* ================================================================
   DD Game Box Web v2.1 - GitHub Backend Integration
   拖入密钥 → GitHub Actions 后台下载 Steam 游戏
   ================================================================ */

class DDGameBoxApp {
  constructor() {
    this.parseResult = null;
    this.manifestData = [];
    this.fetchedManifests = {};
    this.gameName = '';
    this.isFetching = false;
    this.triggeredWorkflow = null;

    this.api = new ApiClient();
    this.github = new GitHubBackend({ repo: 'CheckCheats/DDGameBox' });
    this.zip = new ZipPackager();
    this.dom = {};

    this._initDOM();
    this._initEvents();
    this._checkStatus();
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
      ghTokenInput: document.getElementById('ghTokenInput'),
      ghSaveTokenBtn: document.getElementById('ghSaveTokenBtn'),
      ghTokenHelpBtn: document.getElementById('ghTokenHelpBtn'),
      ghBackendRadio: document.querySelectorAll('input[name="backend"]'),
      tokenHelpOverlay: document.getElementById('tokenHelpOverlay'),
    };
  }

  _initEvents() {
    const dz = this.dom.dropZone;
    const fi = this.dom.fileInput;

    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) this._handleFiles(e.dataTransfer.files);
    });
    fi.addEventListener('change', (e) => {
      if (e.target.files.length > 0) { this._handleFiles(e.target.files); fi.value = ''; }
    });

    this.dom.fetchBtn.addEventListener('click', () => this._startFetch());
    this.dom.downloadZipBtn.addEventListener('click', () => this._downloadPackage());
    this.dom.clearBtn.addEventListener('click', () => this._clear());

    this.dom.logTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.dom.logTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._applyLogFilter(tab.dataset.type);
      });
    });

    // Token save
    this.dom.ghSaveTokenBtn.addEventListener('click', () => {
      const token = this.dom.ghTokenInput.value.trim();
      if (token) {
        localStorage.setItem('dd_gh_token', token);
        this.github.token = token;
        this.log('✅ Token 已保存 (仅存本地浏览器)', 'success');
        this._checkStatus();
      }
    });

    // Token help
    this.dom.ghTokenHelpBtn.addEventListener('click', () => {
      this.dom.tokenHelpOverlay.style.display = 'flex';
    });

    // Close help on overlay click
    this.dom.tokenHelpOverlay.addEventListener('click', (e) => {
      if (e.target === this.dom.tokenHelpOverlay) {
        this.dom.tokenHelpOverlay.style.display = 'none';
      }
    });

    // Backend switch
    this.dom.ghBackendRadio.forEach(radio => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="backend"]:checked').value;
        this.log(`🔄 后端: ${mode === 'github' ? 'GitHub API' : 'CORS 代理'}`, 'info');
        this._checkStatus();
      });
    });

    // Load saved token
    const savedToken = localStorage.getItem('dd_gh_token');
    if (savedToken) {
      this.dom.ghTokenInput.value = savedToken;
      this.github.token = savedToken;
    }
  }

  async _handleFiles(files) {
    this._clear();
    this.log(`📁 处理 ${files.length} 个文件...`, 'info');
    let allContent = '';
    const manifestFiles = [];

    for (const file of files) {
      try {
        if (file.name.endsWith('.zip')) {
          this.log(`🗜️ 解析密钥 ZIP: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB)`, 'info');
          const zipResult = await ZipHandler.parseGameZip(file);
          if (zipResult) {
            this._applyZipResult(zipResult);
            this.log(`✅ ZIP 解析: AppID=${zipResult.appid}, Depots=${zipResult.depots.length}, Manifests=${zipResult.manifests.length}`, 'success');
          }
          continue;
        }

        const content = await file.text();
        if (file.name.endsWith('.manifest')) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 加载 manifest: ${file.name}`, 'info');
          continue;
        }

        if (LuaParser.isValid(content) || file.name.endsWith('.lua') || file.name.endsWith('.txt')) {
          allContent += '\n' + content;
          this.log(`📄 加载密钥脚本: ${file.name} (${(content.length/1024).toFixed(1)}KB)`, 'info');
        } else if (this._looksLikeManifestJSON(content)) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 加载 JSON: ${file.name}`, 'info');
        } else {
          this.log(`⚠️ 跳过: ${file.name}`, 'warn');
        }
      } catch (e) {
        this.log(`❌ 读取失败: ${file.name} - ${e.message}`, 'error');
      }
    }

    if (allContent.trim()) {
      this.parseResult = LuaParser.parse(allContent);
      this.log(`✅ 解析完成: AppID=${this.parseResult.appid || '未知'}, Depots=${this.parseResult.depots.length}`, 'success');
      this._renderParseResult();
      if (manifestFiles.length > 0) this._processManifestFiles(manifestFiles);
      if (this.parseResult.appid) this._fetchGameName(this.parseResult.appid);
    } else if (manifestFiles.length > 0) {
      const ids = LuaParser.extractDepotsFromFilenames(manifestFiles.map(f => f.name));
      this.parseResult = {
        appid: ids[0] || null,
        depots: ids.map(id => ({ id, sha: null, hasKey: false })),
        tokens: [], missingKeys: false, rawContent: ''
      };
      this.log(`📋 从文件名推断: ${ids.join(', ')}`, 'info');
      this._renderParseResult();
      this._processManifestFiles(manifestFiles);
    } else if (!this.parseResult) {
      this.log('⚠️ 未找到可识别内容', 'warn');
    }

    this._updateStatus();
  }

  _applyZipResult(zipResult) {
    if (zipResult.appid && !this.parseResult) {
      this.parseResult = {
        appid: zipResult.appid,
        depots: zipResult.depots || [],
        tokens: [],
        missingKeys: false,
        rawContent: ''
      };
    } else if (zipResult.depots.length > 0 && this.parseResult) {
      for (const d of zipResult.depots) {
        if (!this.parseResult.depots.find(x => x.id === d.id)) {
          this.parseResult.depots.push(d);
        }
      }
    }
    if (zipResult.keys) {
      for (const [did, key] of Object.entries(zipResult.keys)) {
        const depot = this.parseResult.depots.find(d => d.id === parseInt(did));
        if (depot) { depot.sha = key; depot.hasKey = true; }
      }
    }
    this._renderParseResult();
    if (this.parseResult.appid) this._fetchGameName(this.parseResult.appid);
  }

  _looksLikeManifestJSON(content) {
    try {
      const data = JSON.parse(content.startsWith('1|') ? content.slice(2) : content);
      return data && typeof data === 'object' && !Array.isArray(data);
    } catch { return false; }
  }

  _processManifestFiles(files) {
    this.log(`📦 处理 ${files.length} 个 manifest...`, 'info');
    this.manifestData = files;
    this.dom.downloadZipBtn.disabled = false;
  }

  async _fetchGameName(appid) {
    try {
      this.gameName = await this.api.getGameName(appid);
      if (this.gameName) { this.log(`🏷️ 游戏: ${this.gameName}`, 'success'); this._renderParseResult(); }
    } catch { this.log('⚠️ 无法获取游戏名称', 'warn'); }
  }

  _renderParseResult() {
    const r = this.parseResult;
    if (!r) return;
    this.dom.parseResult.hidden = false;
    this.dom.gameInfo.innerHTML = `
      <span class="label">游戏名称</span>
      <span class="value">${this.gameName || '获取中...'}</span>
      <span class="label">APP ID</span>
      <span class="value appid">${r.appid || '未知'}</span>
      <span class="label">Depot 数量</span>
      <span class="value">${r.depots.length} 个</span>
      <span class="label">密钥状态</span>
      <span class="value" style="color: ${r.missingKeys ? '#c41e3a' : '#6b8e23'}">
        ${r.missingKeys ? '有缺失密钥' : '完整密钥'}
      </span>`;
    this.dom.depotList.innerHTML = r.depots.map(d => `
      <div class="depot-item" data-depot-id="${d.id}">
        <span class="depot-id">${d.id}</span>
        <span class="depot-sha" title="${d.sha || '无密钥'}">${d.sha ? d.sha.substring(0, 40) + '...' : '❌ 无密钥'}</span>
        <span class="depot-status ${d.hasKey ? 'ok' : 'missing'}">${d.hasKey ? '有密钥' : '缺密钥'}</span>
      </div>`).join('') || '<div style="color:var(--label)">未找到 Depot</div>';
    this.dom.keyInfo.innerHTML = r.tokens.length > 0
      ? r.tokens.map(t => `<div class="token-item">🔑 Token APPID ${t.appid}: ${t.token}</div>`).join('')
      : '<div>无额外 Token</div>';
    if (r.appid || r.depots.length > 0) this.dom.fetchBtn.disabled = false;
  }

  async _startFetch() {
    if (this.isFetching) return;
    this.isFetching = true;
    this.dom.fetchBtn.disabled = true;
    this.dom.fetchBtn.textContent = '⏳ 处理中...';
    this.dom.progressSection.hidden = false;
    this.dom.progressContainer.innerHTML = '';

    const r = this.parseResult;
    const depotIds = r.depots.map(d => d.id);
    const mode = document.querySelector('input[name="backend"]:checked').value;

    try {
      if (mode === 'github') {
        await this._fetchViaGitHub(r, depotIds);
      } else {
        await this._fetchViaCORS(r, depotIds);
      }

      if (this.parseResult && this.manifestData.length > 0) {
        const vdfContent = VdfGenerator.generate(this.parseResult);
        this._showVdfPreview(vdfContent);
        this.log('🎉 完成! 点击「打包下载」获取文件', 'success');
        this.dom.downloadZipBtn.disabled = false;
      }
    } catch (e) {
      this.log(`❌ 失败: ${e.message}`, 'error');
    } finally {
      this.isFetching = false;
      this.dom.fetchBtn.textContent = '🚀 开始下载';
      this.dom.fetchBtn.disabled = !this.parseResult;
      this._updateStatus();
    }
  }

  /**
   * GitHub 后端: 通过 Actions 查询 Steam API
   */
  async _fetchViaGitHub(r, depotIds) {
    this._addProgress('github', '🔗 连接到 GitHub 后端', 0);

    if (!this.github.token) {
      this._updateProgress('github', 100);
      this.log('', 'info');
      this.log('⚠️ 未配置 GitHub Token', 'warn');
      this.log('点击右上角 ❓ 查看获取教程 (30秒搞定)', 'warn');
      this.log('设置 Token 后可绕过网络限制直接下载', 'info');
      this.dom.tokenHelpOverlay.style.display = 'flex';
      throw new Error('请先设置 GitHub Token (点击右上角 ❓)');
    }

    this._updateProgress('github', 30);
    this.log('📡 通过 GitHub Actions 查询 Steam 数据...', 'api');
    const depotsStr = depotIds.join(',');

    this.triggeredWorkflow = await this.github.triggerWorkflow('steam-downloader.yml', {
      appid: r.appid ? r.appid.toString() : '',
      depots: depotsStr,
      action: 'manifests'
    });

    if (this.triggeredWorkflow) {
      this._updateProgress('github', 60);
      this.log(`✅ 工作流已触发: #${this.triggeredWorkflow.id}`, 'success');
      this.log(`🔗 查看进度: https://github.com/CheckCheats/DDGameBox/actions/runs/${this.triggeredWorkflow.id}`, 'info');

      this._addProgress('poll', '⏳ 等待 Steam 数据...', 20);
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 15000));
        const status = await this.github.pollWorkflow(this.triggeredWorkflow.id);
        this._updateProgress('poll', 20 + (i / 20) * 60);

        if (status.conclusion === 'success') {
          this._updateProgress('poll', 100);
          this.log('✅ GitHub Actions 完成! 检查 Artifacts 下载结果', 'success');
          break;
        }
        if (status.conclusion === 'failure') {
          throw new Error('工作流失败 → 查看 Actions 日志');
        }
      }
      this._updateProgress('github', 100);
    } else {
      // Fallback
      this.log('⚠️ GitHub 后端未响应，尝试 CORS 通道...', 'warn');
      await this._fetchViaCORS(r, depotIds);
    }
  }

  /**
   * CORS 代理通道 (可靠性较低，自动降级)
   */
  async _fetchViaCORS(r, depotIds) {
    this._addProgress('cors', '🌐 通过 CORS 代理查询', 0);
    this.log('⚠️ CORS 代理在中国大陆可能不稳定', 'warn');
    this.log('💡 建议切换到 GitHub 模式并设置 Token', 'info');

    if (!r.appid) {
      this._updateProgress('cors', 100);
      return;
    }

    try {
      const filtered = await this.api.filterWindowsDepots(r.appid, depotIds);
      this._updateProgress('cors', 30);
      this.log(`✅ 过滤: ${filtered.length}/${depotIds.length} Windows Depot`, 'success');

      const manifests = await this.api.fetchLatestManifests(r.appid, filtered);
      this.fetchedManifests = manifests;
      this._updateProgress('cors', 60);
      this.log(`✅ ${Object.keys(manifests).length} 个 manifest IDs`, 'success');

      let completed = 0;
      const total = Object.entries(manifests).length;
      if (total > 0) {
        for (const [depotId, manifestId] of Object.entries(manifests)) {
          try {
            const rc = await this.api.fetchRequestCode(manifestId);
            if (rc) {
              const result = await this.api.downloadManifest(depotId, manifestId, rc);
              this.manifestData.push({ depotId: parseInt(depotId), manifestId, data: result.data, filename: result.filename });
              this.log(`✅ Manifest ${depotId}`, 'success');
            }
          } catch (e) {
            this.log(`❌ Manifest ${depotId}: ${e.message}`, 'error');
          }
          completed++;
          this._updateProgress('cors', 60 + (completed/total)*40);
        }
      }
      this._updateProgress('cors', 100);
    } catch (e) {
      this._updateProgress('cors', 100);
      this.log(`❌ CORS 代理失败: ${e.message}`, 'error');
      this.log('', 'info');
      this.log('🔄 所有 CORS 代理均已失效 (被墙/关闭)', 'warn');
      this.log('👉 请切换到 GitHub 模式: 点击右上角 ❓ 获取 Token', 'warn');
      this.log('GitHub Actions 直接从美国服务器访问 Steam API', 'info');
      this.dom.tokenHelpOverlay.style.display = 'flex';
    }
  }

  _addProgress(id, label, percent) {
    const div = document.createElement('div');
    div.className = 'progress-item loading';
    div.id = `progress-${id}`;
    div.innerHTML = `<div class="progress-header"><span>${label}</span><span class="progress-pct">${percent}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>`;
    this.dom.progressContainer.appendChild(div);
  }

  _updateProgress(id, percent) {
    const item = document.getElementById(`progress-${id}`);
    if (!item) return;
    item.querySelector('.progress-fill').style.width = `${percent}%`;
    item.querySelector('.progress-pct').textContent = `${Math.round(percent)}%`;
    if (percent >= 100) item.classList.remove('loading');
  }

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
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    window.copyText = function(btn) {
      const ta = btn.closest('.modal-box').querySelector('textarea');
      navigator.clipboard.writeText(ta.value).then(() => {
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = '📋 复制', 2000);
      });
    };
  }

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

  _clear() {
    this.parseResult = null;
    this.manifestData = [];
    this.fetchedManifests = {};
    this.gameName = '';
    this.isFetching = false;
    this.triggeredWorkflow = null;
    this.dom.parseResult.hidden = true;
    this.dom.progressSection.hidden = true;
    this.dom.fetchBtn.disabled = true;
    this.dom.downloadZipBtn.disabled = true;
    this.dom.logArea.innerHTML = '';
    this.dom.progressContainer.innerHTML = '';
    this.log('🔄 已清空', 'info');
    this._updateStatus();
  }

  log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.dataset.type = type;
    line.innerHTML = `<span class="log-time">[${time}]</span>${this._escapeHtml(msg)}`;
    this.dom.logArea.appendChild(line);
    this.dom.logArea.scrollTop = this.dom.logArea.scrollHeight;
  }

  _applyLogFilter(type) {
    this.dom.logArea.querySelectorAll('.log-line').forEach(line => {
      line.style.display = (type === 'all' || line.dataset.type === type) ? '' : 'none';
    });
  }

  _updateStatus() {
    const r = this.parseResult;
    if (r && r.appid) {
      this.dom.statusText.textContent = `已解析: AppID ${r.appid} | ${r.depots.length} depots`;
    } else if (r) {
      this.dom.statusText.textContent = `已解析: ${r.depots.length} depots`;
    } else {
      this.dom.statusText.textContent = '就绪 - 拖入密钥开始下载';
    }
    this.dom.fileCount.textContent = `📁 ${this.manifestData.length} manifest`;
  }

  async _checkStatus() {
    this.dom.apiStatus.textContent = '🌐 检测中...';
    try {
      const limit = await this.github.getRateLimit();
      const remaining = limit?.rate?.remaining || '?';
      const authed = this.github.token ? '✅' : '⚠️';
      this.dom.apiStatus.innerHTML = `🌐 GitHub: <span style="color:#6b8e23">${authed} ${remaining}次</span>`;
    } catch {
      this.dom.apiStatus.innerHTML = '🌐 GitHub: <span style="color:#e65100">不可达</span>';
    }
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new DDGameBoxApp();
});