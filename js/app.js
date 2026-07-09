/* ================================================================
   DD Game Box Web v2.2
   密码门 · Gist 云存储 · 快速API检测
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
    this._quickAPICheck();
    this._autoLoadToken();
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
      ghQuickTokenBtn: document.getElementById('ghQuickTokenBtn'),
      ghTokenHelpBtn: document.getElementById('ghTokenHelpBtn'),
      ghBackendRadio: document.querySelectorAll('input[name="backend"]'),
      tokenHelpOverlay: document.getElementById('tokenHelpOverlay'),
    };
  }

  _initEvents() {
    const dz = this.dom.dropZone, fi = this.dom.fileInput;
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('drag-over');
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

    // ═══ Token 保存 (含 Gist 云端) ═══
    this.dom.ghSaveTokenBtn.addEventListener('click', () => this._saveToken());

    // ═══ 一键获取 Token ═══
    this.dom.ghQuickTokenBtn.addEventListener('click', () => {
      window.open('https://github.com/settings/tokens/new?description=DDGameBox&scopes=repo,workflow', '_blank');
      this.dom.tokenHelpOverlay.style.display = 'flex';
    });

    // ═══ Token 帮助 ═══
    this.dom.ghTokenHelpBtn.addEventListener('click', () => {
      this.dom.tokenHelpOverlay.style.display = 'flex';
    });
    this.dom.tokenHelpOverlay.addEventListener('click', (e) => {
      if (e.target === this.dom.tokenHelpOverlay) this.dom.tokenHelpOverlay.style.display = 'none';
    });

    // ═══ 后端切换 ═══
    this.dom.ghBackendRadio.forEach(radio => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="backend"]:checked').value;
        this.log(`🔄 后端: ${mode === 'github' ? 'GitHub API' : 'CORS'}`, 'info');
        this._quickAPICheck();
      });
    });

    // ═══ 输完 token 回车保存 ═══
    this.dom.ghTokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveToken();
    });
  }

  /* =================================================================
     Token 自动恢复 + Gist 云存储
     ================================================================= */
  async _autoLoadToken() {
    // 1. 尝试从 localStorage 加载
    const saved = localStorage.getItem('dd_gh_token');
    if (saved) {
      this.dom.ghTokenInput.value = saved;
      this.github.token = saved;
      // 有本地 token 就异步尝试从 Gist 同步
      this._syncFromGist(saved);
      return;
    }
    // 2. 没有本地 token → 看 cookie 中有没有 Gist ID
    const gistId = this.github.getGistId();
    if (gistId) {
      this.log('☁️ 检测到云端配置，请先输入 Token...', 'info');
    }
  }

  async _syncFromGist(token) {
    if (!token) return;
    this.github.token = token;
    try {
      const cfg = await this.github.loadUserConfig();
      if (cfg?.token && cfg.token !== token) {
        this.github.token = cfg.token;
        this.dom.ghTokenInput.value = cfg.token;
        localStorage.setItem('dd_gh_token', cfg.token);
        this.log('☁️ 已从 GitHub 云端恢复 Token', 'success');
        this._quickAPICheck();
      }
    } catch { /* 无 Gist 或无网络, 静默 */ }
  }

  async _saveToken() {
    const token = this.dom.ghTokenInput.value.trim();
    if (!token) {
      this.log('⚠️ 请输入 Token', 'warn');
      return;
    }

    // 保存到本地
    localStorage.setItem('dd_gh_token', token);
    this.github.token = token;
    this.log('💾 Token 已保存到本地', 'success');

    // 保存到 GitHub Gist (云端备份)
    try {
      const result = await this.github.saveUserConfig({ token, savedAt: Date.now() });
      if (result.success) {
        this.log(`☁️ 已同步到 GitHub 云端 (${result.gistId.substring(0,8)}...)`, 'success');
        this.log('   下次打开网页自动恢复', 'info');
      }
    } catch (e) {
      this.log(`⚠️ 云端同步失败: ${e.message}`, 'warn');
      this.log('   本地已保存, 不影响使用', 'info');
    }

    this._quickAPICheck();
  }

  /* =================================================================
     快速 API 状态检测 (HEAD请求)
     ================================================================= */
  async _quickAPICheck() {
    this.dom.apiStatus.innerHTML = '🌐 检测...';
    const start = Date.now();
    const result = await this.github.quickCheck();
    const ms = Date.now() - start;
    if (result.ok) {
      const authed = result.authed ? '✅' : '⚠️';
      this.dom.apiStatus.innerHTML = `🌐 ${authed} ${result.remaining}次 · <span style="font-size:10px;opacity:.6">${ms}ms</span>`;
    } else {
      this.dom.apiStatus.innerHTML = '🌐 ⚠️ API 受限';
    }
  }

  /* =================================================================
     文件处理 (ZIP / Lua / manifest / JSON)
     ================================================================= */
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
            this.log(`✅ AppID=${zipResult.appid}, Depots=${zipResult.depots.length}, Manifests=${zipResult.manifests.length}`, 'success');
          }
          continue;
        }
        const content = await file.text();
        if (file.name.endsWith('.manifest')) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 manifest: ${file.name}`, 'info');
          continue;
        }
        if (LuaParser.isValid(content) || file.name.endsWith('.lua') || file.name.endsWith('.txt')) {
          allContent += '\n' + content;
          this.log(`📄 密钥: ${file.name} (${(content.length/1024).toFixed(1)}KB)`, 'info');
        } else if (this._looksLikeManifestJSON(content)) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 JSON: ${file.name}`, 'info');
        } else {
          this.log(`⚠️ 跳过: ${file.name}`, 'warn');
        }
      } catch (e) {
        this.log(`❌ 读取失败: ${file.name}`, 'error');
      }
    }

    if (allContent.trim()) {
      this.parseResult = LuaParser.parse(allContent);
      this.log(`✅ 解析: AppID=${this.parseResult.appid || '?'}, Depots=${this.parseResult.depots.length}`, 'success');
      this._renderParseResult();
      if (manifestFiles.length > 0) this._processManifestFiles(manifestFiles);
      if (this.parseResult.appid) this._fetchGameName(this.parseResult.appid);
    } else if (manifestFiles.length > 0) {
      const ids = LuaParser.extractDepotsFromFilenames(manifestFiles.map(f => f.name));
      this.parseResult = { appid: ids[0] || null, depots: ids.map(id => ({ id, sha: null, hasKey: false })), tokens: [], missingKeys: false, rawContent: '' };
      this.log(`📋 推断: ${ids.join(', ')}`, 'info');
      this._renderParseResult();
      this._processManifestFiles(manifestFiles);
    } else if (!this.parseResult) {
      this.log('⚠️ 未找到可识别内容', 'warn');
    }
    this._updateStatus();
  }

  _applyZipResult(zipResult) {
    if (zipResult.appid && !this.parseResult) {
      this.parseResult = { appid: zipResult.appid, depots: zipResult.depots || [], tokens: [], missingKeys: false, rawContent: '' };
    } else if (this.parseResult) {
      for (const d of zipResult.depots) {
        if (!this.parseResult.depots.find(x => x.id === d.id)) this.parseResult.depots.push(d);
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
    this.manifestData = files;
    this.dom.downloadZipBtn.disabled = false;
  }

  async _fetchGameName(appid) {
    try {
      this.gameName = await this.api.getGameName(appid);
      if (this.gameName) { this.log(`🏷️ ${this.gameName}`, 'success'); this._renderParseResult(); }
    } catch { /* ignore */ }
  }

  _renderParseResult() {
    const r = this.parseResult;
    if (!r) return;
    this.dom.parseResult.hidden = false;
    this.dom.gameInfo.innerHTML = `
      <span class="label">游戏名称</span><span class="value">${this.gameName || '—'}</span>
      <span class="label">APP ID</span><span class="value appid">${r.appid || '?'}</span>
      <span class="label">Depot</span><span class="value">${r.depots.length} 个</span>
      <span class="label">密钥</span><span class="value" style="color:${r.missingKeys?'#c41e3a':'#6b8e23'}">${r.missingKeys?'有缺失':'完整'}</span>`;
    this.dom.depotList.innerHTML = r.depots.map(d => `
      <div class="depot-item" data-depot-id="${d.id}">
        <span class="depot-id">${d.id}</span>
        <span class="depot-sha" title="${d.sha||''}">${d.sha?d.sha.substring(0,40)+'...':'❌'}</span>
        <span class="depot-status ${d.hasKey?'ok':'missing'}">${d.hasKey?'有':'缺'}密钥</span>
      </div>`).join('') || '<div style="color:var(--label)">—</div>';
    this.dom.keyInfo.innerHTML = r.tokens.length>0
      ? r.tokens.map(t => `<div class="token-item">🔑 ${t.appid}: ${t.token}</div>`).join('')
      : '<div>—</div>';
    if (r.appid || r.depots.length > 0) this.dom.fetchBtn.disabled = false;
  }

  /* =================================================================
     下载逻辑
     ================================================================= */
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
      if (mode === 'github') await this._fetchViaGitHub(r, depotIds);
      else await this._fetchViaCORS(r, depotIds);

      if (this.parseResult && this.manifestData.length > 0) {
        const vdf = VdfGenerator.generate(this.parseResult);
        this._showVdfPreview(vdf);
        this.log('🎉 完成! 点击打包下载', 'success');
        this.dom.downloadZipBtn.disabled = false;
      }
    } catch (e) {
      this.log(`❌ ${e.message}`, 'error');
    } finally {
      this.isFetching = false;
      this.dom.fetchBtn.textContent = '🚀 开始下载';
      this.dom.fetchBtn.disabled = !this.parseResult;
      this._updateStatus();
    }
  }

  async _fetchViaGitHub(r, depotIds) {
    this._addProgress('github', '🔗 GitHub 后端', 0);
    if (!this.github.token) {
      this._updateProgress('github', 100);
      this.log('⚠️ 未配置 Token → 点击 ⚡ 获取', 'warn');
      this.dom.tokenHelpOverlay.style.display = 'flex';
      throw new Error('请先设置 GitHub Token');
    }
    this._updateProgress('github', 30);
    this.log('📡 触发 GitHub Actions 查询 Steam...', 'api');
    const wf = await this.github.triggerWorkflow('steam-downloader.yml', {
      appid: r.appid?r.appid.toString():'', depots: depotIds.join(','), action: 'manifests'
    });
    if (wf) {
      this.triggeredWorkflow = wf;
      this._updateProgress('github', 60);
      this.log(`✅ 工作流 #${wf.id} 已启动`, 'success');
      this.log(`🔗 ${wf.html_url}`, 'info');
      this._addProgress('poll', '⏳ 等待结果...', 20);
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 15000));
        const s = await this.github.pollWorkflow(wf.id);
        this._updateProgress('poll', 20 + (i/20)*60);
        if (s.conclusion === 'success') { this._updateProgress('poll', 100); this.log('✅ 完成!', 'success'); break; }
        if (s.conclusion === 'failure') throw new Error('Actions 失败');
      }
      this._updateProgress('github', 100);
    } else {
      this.log('⚠️ 后端未响应 → CORS', 'warn');
      await this._fetchViaCORS(r, depotIds);
    }
  }

  async _fetchViaCORS(r, depotIds) {
    this._addProgress('cors', '🌐 CORS 代理', 0);
    this.log('⚠️ CORS 在中国大陆可能不可用', 'warn');
    if (!r.appid) { this._updateProgress('cors', 100); return; }
    try {
      const filtered = await this.api.filterWindowsDepots(r.appid, depotIds);
      this._updateProgress('cors', 30);
      this.log(`✅ ${filtered.length} Windows Depot`, 'success');
      const manifests = await this.api.fetchLatestManifests(r.appid, filtered);
      this.fetchedManifests = manifests;
      this._updateProgress('cors', 60);
      let n = 0; const t = Object.entries(manifests).length;
      if (t > 0) {
        for (const [did, mid] of Object.entries(manifests)) {
          try {
            const rc = await this.api.fetchRequestCode(mid);
            if (rc) {
              const r = await this.api.downloadManifest(did, mid, rc);
              this.manifestData.push({ depotId: parseInt(did), manifestId: mid, data: r.data, filename: r.filename });
              this.log(`✅ ${did}`, 'success');
            }
          } catch (e) { this.log(`❌ ${did}: ${e.message}`, 'error'); }
          n++; this._updateProgress('cors', 60+(n/t)*40);
        }
      }
      this._updateProgress('cors', 100);
    } catch (e) {
      this._updateProgress('cors', 100);
      this.log(`❌ ${e.message}`, 'error');
      this.log('👉 切换 GitHub 模式 + 设置 Token', 'warn');
      this.dom.tokenHelpOverlay.style.display = 'flex';
    }
  }

  /* =================================================================
     UI 辅助
     ================================================================= */
  _addProgress(id, label, p) {
    const d = document.createElement('div');
    d.className = 'progress-item loading'; d.id = `p-${id}`;
    d.innerHTML = `<div class="progress-header"><span>${label}</span><span class="progress-pct">${p}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${p}%"></div></div>`;
    this.dom.progressContainer.appendChild(d);
  }
  _updateProgress(id, p) {
    const el = document.getElementById(`p-${id}`);
    if (!el) return;
    el.querySelector('.progress-fill').style.width = `${p}%`;
    el.querySelector('.progress-pct').textContent = `${Math.round(p)}%`;
    if (p >= 100) el.classList.remove('loading');
  }

  _showVdfPreview(vdf) {
    const o = document.createElement('div'); o.className = 'modal-overlay';
    o.innerHTML = `<div class="modal-box"><h3>📄 config.vdf</h3><textarea readonly>${this._e(vdf)}</textarea><div class="modal-actions"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button><button class="btn btn-primary" onclick="copyVdf(this)">📋 复制</button></div></div>`;
    document.body.appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
    window.copyVdf = function(btn) {
      const ta = btn.closest('.modal-box').querySelector('textarea');
      navigator.clipboard.writeText(ta.value).then(() => { btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋 复制', 2000); });
    };
  }

  async _downloadPackage() {
    try {
      this.zip.createPackage(this.parseResult, this.manifestData);
      await this.zip.download('ddgamebox-package.zip');
      this.log(`✅ 打包: ${this.zip.getFileList().length} 文件`, 'success');
    } catch (e) { this.log(`❌ ${e.message}`, 'error'); }
  }

  _clear() {
    this.parseResult = null; this.manifestData = []; this.fetchedManifests = {};
    this.gameName = ''; this.isFetching = false; this.triggeredWorkflow = null;
    this.dom.parseResult.hidden = true; this.dom.progressSection.hidden = true;
    this.dom.fetchBtn.disabled = true; this.dom.downloadZipBtn.disabled = true;
    this.dom.logArea.innerHTML = ''; this.dom.progressContainer.innerHTML = '';
    this.log('🔄 已清空', 'info'); this._updateStatus();
  }

  log(msg, type = 'info') {
    const t = new Date().toLocaleTimeString();
    const l = document.createElement('div');
    l.className = `log-line ${type}`; l.dataset.type = type;
    l.innerHTML = `<span class="log-time">[${t}]</span>${this._e(msg)}`;
    this.dom.logArea.appendChild(l);
    this.dom.logArea.scrollTop = this.dom.logArea.scrollHeight;
  }

  _applyLogFilter(type) {
    this.dom.logArea.querySelectorAll('.log-line').forEach(l => {
      l.style.display = (type === 'all' || l.dataset.type === type) ? '' : 'none';
    });
  }

  _updateStatus() {
    const r = this.parseResult;
    this.dom.statusText.textContent = r?.appid
      ? `解析: AppID ${r.appid} | ${r.depots.length} depots`
      : r ? `解析: ${r.depots.length} depots`
      : '🔒 已解锁 · 拖入密钥';
    this.dom.fileCount.textContent = `📁 ${this.manifestData.length}`;
  }

  _e(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new DDGameBoxApp(); });