/* ================================================================
   DD Game Box Web v3.0
   密码门 · Gist 云存储 · 本地代理下载
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
    this.github = new GitHubBackend({
      repo: 'CheckCheats/DDGameBox',
      log: (msg) => this.log(msg, 'api')
    });
    this.zip = new ZipPackager();
    this.dom = {};

    // 本地代理地址
    this.LOCAL_SERVER = 'http://127.0.0.1:8899';
    this.localAvailable = false;

    this._initDOM();
    this._initEvents();
    this._quickAPICheck();
    this._autoLoadToken();
    this._checkLocalServer();
  }

  _initDOM() {
    const byId = id => document.getElementById(id);
    this.dom = {
      dropZone: byId('dropZone'),
      fileInput: byId('fileInput'),
      parseResult: byId('parseResult'),
      gameInfo: byId('gameInfo'),
      depotList: byId('depotList'),
      keyInfo: byId('keyInfo'),
      fetchBtn: byId('fetchBtn'),
      downloadZipBtn: byId('downloadZipBtn'),
      clearBtn: byId('clearBtn'),
      progressSection: byId('progressSection'),
      progressContainer: byId('progressContainer'),
      logArea: byId('logArea'),
      statusText: byId('statusText'),
      fileCount: byId('fileCount'),
      apiStatus: byId('apiStatus'),
      logTabs: document.querySelectorAll('.log-tab'),
      ghTokenInput: byId('ghTokenInput'),
      ghSaveTokenBtn: byId('ghSaveTokenBtn'),
      ghQuickTokenBtn: byId('ghQuickTokenBtn'),
      ghTokenHelpBtn: byId('ghTokenHelpBtn'),
      ghBackendRadio: document.querySelectorAll('input[name="backend"]'),
      tokenHelpOverlay: byId('tokenHelpOverlay'),
      localStatus: byId('localStatus'),
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

    // Token 保存
    this.dom.ghSaveTokenBtn.addEventListener('click', () => this._saveToken());
    this.dom.ghQuickTokenBtn.addEventListener('click', () => {
      window.open('https://github.com/settings/tokens/new?description=DDGameBox&scopes=repo,workflow,gist', '_blank');
      this.dom.tokenHelpOverlay.style.display = 'flex';
    });
    this.dom.ghTokenHelpBtn.addEventListener('click', () => {
      this.dom.tokenHelpOverlay.style.display = 'flex';
    });
    this.dom.tokenHelpOverlay.addEventListener('click', (e) => {
      if (e.target === this.dom.tokenHelpOverlay) this.dom.tokenHelpOverlay.style.display = 'none';
    });

    this.dom.ghBackendRadio.forEach(radio => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="backend"]:checked').value;
        this.log(`🔄 后端: ${mode === 'github' ? 'GitHub API' : mode === 'local' ? '本地代理' : 'CORS'}`, 'info');
        this._quickAPICheck();
      });
    });

    this.dom.ghTokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveToken();
    });
  }

  /* =================================================================
     本地代理服务器检测
     ================================================================= */
  async _checkLocalServer() {
    try {
      const resp = await fetch(`${this.LOCAL_SERVER}/api/health`, {
        signal: AbortSignal.timeout(2000)
      });
      if (resp.ok) {
        const data = await resp.json();
        this.localAvailable = true;
        this.log('🖥️ 已连接本地下载代理', 'success');
        if (this.dom.localStatus) {
          this.dom.localStatus.innerHTML = '🖥️ 本地';
          this.dom.localStatus.title = data.ddv20_path || '已连接';
        }
        return;
      }
    } catch (e) { /* 忽略 */ }
    this.localAvailable = false;
    if (this.dom.localStatus) {
      this.dom.localStatus.innerHTML = '☁️ 远程';
      this.dom.localStatus.title = '未检测到本地代理';
    }
  }

  /* =================================================================
     Token
     ================================================================= */
  async _autoLoadToken() {
    const saved = localStorage.getItem('dd_gh_token');
    if (saved) {
      this.dom.ghTokenInput.value = saved;
      this.github.token = saved;
      this._syncFromGist(saved);
      return;
    }
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
      } else {
        this.log('☁️ 云端配置已同步', 'info');
      }
    } catch (e) {
      if (/Gist 404/.test(e.message)) {}
    }
  }

  async _saveToken() {
    const token = this.dom.ghTokenInput.value.trim();
    if (!token) {
      this.log('⚠️ 请输入 Token', 'warn');
      return;
    }
    localStorage.setItem('dd_gh_token', token);
    this.github.token = token;
    this.log('💾 Token 已保存到本地', 'success');
    try {
      const result = await this.github.saveUserConfig({ token, savedAt: Date.now() });
      if (result.success) {
        this.log(`☁️ 已同步到 GitHub 云端 (${result.gistId.substring(0,8)}...)`, 'success');
      }
    } catch (e) {
      this.log(`⚠️ 云端同步失败: ${e.message}`, 'warn');
      this.log('   本地已保存, 不影响使用', 'info');
    }
    this._quickAPICheck();
  }

  /* =================================================================
     API 状态
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
     文件处理
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
    // ✅ 关键: 保存从 ZIP 提取的 .manifest 文件列表
    if (zipResult.manifestFiles && zipResult.manifestFiles.length > 0) {
      this._zipManifestFiles = zipResult.manifestFiles;
      this.log(`📦 提取 ${zipResult.manifestFiles.length} 个 .manifest 文件`, 'success');
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
     下载逻辑 — 本地代理优先
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
      // 如果选择"本地"或选择了 GitHub 但本地代理可用 → 优先用本地
      if (mode === 'local') {
        await this._fetchViaLocal(r, depotIds);
      }
      // 本地检测到且可用 → 自动使用
      else if (this.localAvailable) {
        this.log('🖥️ 检测到本地代理，自动使用', 'info');
        await this._fetchViaLocal(r, depotIds);
      }
      // GitHub 模式
      else if (mode === 'github') {
        await this._fetchViaGitHub(r, depotIds);
      }
      // CORS 模式
      else {
        await this._fetchViaCORS(r, depotIds);
      }

      // 成功后如果还是只有配置包，启用打包按钮
      if (this.parseResult && this.manifestData.length > 0) {
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

  /* =================================================================
     方式1: 本地代理下载 (最推荐)
     ================================================================= */
  async _fetchViaLocal(r, depotIds) {
    this._addProgress('local', '🖥️ 本地代理', 10);

    // 构建发送到本地服务器的数据
    const keys = {};
    for (const d of r.depots) {
      if (d.sha) keys[d.id] = d.sha;
    }
    for (const t of (r.tokens || [])) {
      keys[t.appid] = t.token;
    }

    // 把 manifest 内容也打包进去
    // 从 ZIP 提取的 .manifest 文件 (二进制 Blob) → 转为 base64
    const manifests = [];
    
    // 1. 从 ZIP 提取的 .manifest 文件 (最重要!)
    if (this._zipManifestFiles && this._zipManifestFiles.length > 0) {
      for (const mf of this._zipManifestFiles) {
        try {
          // Blob → ArrayBuffer → base64
          const arrayBuf = await mf.data.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          const b64 = btoa(binary);
          
          manifests.push({
            filename: mf.name,
            depotId: mf.depotId,
            content_b64: b64,
            is_binary: true,
            size: mf.size || bytes.length
          });
          this.log(`📦 ${mf.name} → ${(bytes.length/1024).toFixed(1)}KB (base64)`, 'info');
        } catch (e) {
          this.log(`⚠️ manifest 转换失败: ${mf.name}`, 'warn');
        }
      }
    }
    
    // 2. 从文本 manifest 数据 (JSON 格式等)
    for (const m of this.manifestData) {
      let depotId = null;
      const idMatch = m.name ? m.name.match(/(\d+)/) : null;
      if (idMatch) depotId = parseInt(idMatch[1], 10);
      const content = typeof m.content === 'string' ? m.content : (m.data || '');
      if (content && !manifests.find(x => x.filename === (m.name || `${depotId}.manifest`))) {
        manifests.push({
          filename: m.name || `${depotId}.manifest`,
          depotId: depotId,
          content: content,
          is_binary: false
        });
      }
    }

    const payload = {
      appid: String(r.appid || ''),
      depots: r.depots,
      manifests: manifests,
      keys: keys
    };

    this.log(`📤 发送到本地代理 (${depotIds.length} depots + ${manifests.length} manifests)`, 'api');
    this._updateProgress('local', 15);

    try {
      // 1. 启动下载
      const resp = await fetch(`${this.LOCAL_SERVER}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || `代理返回 ${resp.status}`);
      }
      const task = await resp.json();
      this.log(`📋 任务 #${task.id} 已启动`, 'success');
      this._updateProgress('local', 20);

      // 2. 添加日志区域
      this._addProgress('local_log', '📋 下载日志', 0);
      const logBox = document.getElementById('p-local_log');
      if (logBox) {
        logBox.style.overflow = 'auto';
        logBox.style.maxHeight = '300px';
        logBox.style.fontSize = '12px';
        logBox.style.fontFamily = 'monospace';
        logBox.style.background = 'rgba(0,0,0,.3)';
        logBox.style.borderRadius = '6px';
        logBox.style.padding = '8px';
        logBox.innerHTML = '<div id="localLogContent"></div>';
      }

      // 3. 轮询进度
      let prevLogsLen = 0;
      let lastProgress = 0;
      let stallCount = 0;
      for (let i = 0; i < 240; i++) { // 最多等 2 小时
        await new Promise(r => setTimeout(r, 3000));

        const statusResp = await fetch(`${this.LOCAL_SERVER}/api/status`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!statusResp.ok) continue;
        const status = await statusResp.json();

        // 更新日志
        if (status.logs && status.logs.length > prevLogsLen) {
          const newLogs = status.logs.slice(prevLogsLen);
          prevLogsLen = status.logs.length;
          const lc = document.getElementById('localLogContent');
          if (lc) {
            for (const line of newLogs) {
              const div = document.createElement('div');
              div.textContent = line;
              lc.appendChild(div);
            }
            lc.scrollTop = lc.scrollHeight;
          }
          stallCount = 0;
        } else {
          stallCount++;
        }

        // 更新进度
        const pct = status.progress || 0;
        if (pct !== lastProgress) {
          this._updateProgress('local', 15 + pct * 0.65);
          lastProgress = pct;
        }

        // 检查状态
        if (status.status === 'completed') {
          this._updateProgress('local', 100);
          this.log('🎉 全部下载完成!', 'success');
          this.log('📥 正在获取游戏文件...', 'info');

          // 4. 下载 ZIP 文件到浏览器
          const zipResp = await fetch(`${this.LOCAL_SERVER}/api/download-zip`);
          if (!zipResp.ok) throw new Error('下载文件失败');

          const blob = await zipResp.blob();
          const zipName = `game-${r.appid}.zip`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = zipName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 30000);

          const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
          this.log(`✅ 已下载: ${zipName} (${sizeMB} MB)`, 'success');
          this.log('📁 保存位置: 浏览器默认下载目录', 'info');
          return;
        }

        if (status.status === 'failed') {
          throw new Error('本地代理下载失败');
        }

        if (status.status === 'cancelled') {
          throw new Error('下载已取消');
        }

        // 如果连续 20 次轮询无新日志且进度没变（1分钟无变化）
        if (stallCount > 20 && lastProgress < 10) {
          this.log('⏳ 等待中... (本地代理可能在处理中)', 'info');
          stallCount = 10; // 降低警告频率
        }
      }

      throw new Error('下载超时 (超过 2 小时)');

    } catch (e) {
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        this.log('❌ 无法连接本地代理 (127.0.0.1:8899)', 'error');
        this.log('👉 请先运行: python local-server.py', 'warn');
        this.localAvailable = false;
        if (this.dom.localStatus) this.dom.localStatus.innerHTML = '☁️ 远程';

        // 尝试 fallback 到 GitHub
        if (this.github.token) {
          this.log('🔄 自动切换到 GitHub 后端...', 'info');
          await this._fetchViaGitHub(r, depotIds);
        } else {
          throw new Error('请先启动本地代理 或 设置 GitHub Token 使用远程下载');
        }
      } else {
        throw e;
      }
    }
  }

  /* =================================================================
     方式2: GitHub Actions 下载 (新 — 直接推 manifests 到仓库)
     ================================================================= */
  async _fetchViaGitHub(r, depotIds) {
    this._addProgress('github', '🔗 GitHub Actions 下载', 0);
    if (!this.github.token) {
      this._updateProgress('github', 100);
      this.log('⚠️ 未配置 Token → 点击 ⚡ 获取', 'warn');
      this.dom.tokenHelpOverlay.style.display = 'flex';
      throw new Error('请先设置 GitHub Token');
    }
    this._updateProgress('github', 5);
    this.log('📡 准备推送到 GitHub 仓库...', 'api');

    // 构建 payload（同本地模式一样，包含 manifests）
    const keys = {};
    for (const d of r.depots) {
      if (d.sha) keys[d.id] = d.sha;
    }
    for (const t of (r.tokens || [])) {
      keys[t.appid] = t.token;
    }

    // 将 .manifest 文件转为 base64
    const manifests = [];

    // 1. 从 ZIP 提取的 .manifest 二进制文件
    if (this._zipManifestFiles && this._zipManifestFiles.length > 0) {
      for (const mf of this._zipManifestFiles) {
        try {
          const arrayBuf = await mf.data.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          const b64 = btoa(binary);
          manifests.push({
            filename: mf.name,
            depotId: mf.depotId,
            content_b64: b64,
            is_binary: true,
            size: bytes.length
          });
          this.log(`📦 manifest: ${mf.name} (${(bytes.length/1024).toFixed(1)}KB)`, 'info');
        } catch (e) {
          this.log(`⚠️ ${mf.name} 编码失败: ${e.message}`, 'warn');
        }
      }
    }

    // 2. 从文本数据来的 manifest
    for (const m of this.manifestData) {
      let depotId = null;
      const idMatch = m.name ? m.name.match(/(\d+)/) : null;
      if (idMatch) depotId = parseInt(idMatch[1], 10);
      const content = typeof m.content === 'string' ? m.content : (m.data || '');
      if (content && !manifests.find(x => x.filename === (m.name || `${depotId}.manifest`))) {
        manifests.push({
          filename: m.name || `${depotId}.manifest`,
          depotId: depotId,
          content: content,
          is_binary: false
        });
      }
    }

    const payload = {
      appid: String(r.appid || ''),
      depots: r.depots,
      manifests: manifests,
      keys: keys
    };

    this.log(`📦 payload: ${depotIds.length} depots, ${manifests.length} manifests, ${(JSON.stringify(payload).length/1024).toFixed(1)}KB`, 'info');
    this._updateProgress('github', 15);

    try {
      // 1. 推送文件 + 触发工作流
      this.log('⏫ 推送到 GitHub 仓库...', 'info');
      const result = await this.github.submitDownloadRequest(payload);
      this._updateProgress('github', 25);

      if (!result.runId) {
        // pushFile 成功了但 triggerWorkflow 返回 null（CORS 或 rate limit）
        this.log('⚠️ 工作流触发可能失败，检查 Actions 页面', 'warn');
        this.log(`📁 请求数据已推送到: requests/${result.requestId}.json`, 'info');
        this.log('💡 可手动前往 Actions 触发 steam-downloader.yml', 'info');
        return;
      }

      this.triggeredWorkflow = { id: result.runId, html_url: result.runUrl };
      this.log(`✅ 工作流 #${result.runId} 已触发`, 'success');
      this.log(`🔗 ${result.runUrl}`, 'info');
      this._updateProgress('github', 30);

      // 2. 轮询等待
      this._addProgress('poll', '⏳ 下载中... (5-30分钟)', 30);
      this.log('⏳ 等待 GitHub Actions 完成...', 'info');

      const pollResult = await this.github.pollUntilDone(result.runId, (msg) => {
        this.log(`📡 ${msg}`, 'info');
      });

      if (pollResult.success) {
        this._updateProgress('poll', 90);
        this.log('🎉 Actions 完成!', 'success');

        // 3. 下载 artifact
        try {
          await this._downloadGitHubArtifact(result.runId, r.appid);
          this._updateProgress('poll', 100);
          this._updateProgress('github', 100);
        } catch (e) {
          this.log(`⚠️ artifact 下载失败: ${e.message}`, 'warn');
          this.log('💡 去 Actions 页面手动下载: ' + result.runUrl, 'info');
          this._updateProgress('poll', 100);
        }
      } else {
        throw new Error(pollResult.error || '工作流异常');
      }
    } catch (e) {
      if (e.message.includes('权限') || e.message.includes('403')) {
        this.log('❌ Token 权限不足，需要 repo (contents:write) 权限', 'error');
      } else if (e.message.includes('超时')) {
        this.log('❌ ' + e.message, 'error');
        this.log('💡 大型游戏可能耗时较长，可前往 Actions 检查进度', 'info');
      } else {
        throw e;
      }
    }
  }

  /* =================================================================
     下载 GitHub Actions artifact
     ================================================================= */
  async _downloadGitHubArtifact(runId, appid) {
    this.log('📦 获取 Actions artifacts...', 'info');
    const artifacts = await this.github._apiRequest(`/actions/runs/${runId}/artifacts`);
    if (!artifacts?.artifacts?.length) {
      throw new Error('没有找到 artifacts');
    }

    const artifact = artifacts.artifacts[0];
    this.log(`📦 找到: ${artifact.name} (${(artifact.size_in_bytes/1024/1024).toFixed(1)}MB)`, 'info');

    // 下载 artifact (GitHub API 返回 302 到 S3)
    const dlUrl = `${this.github.apiBase}/actions/artifacts/${artifact.id}/zip`;
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (this.github.token) headers['Authorization'] = `Bearer ${this.github.token}`;

    const resp = await fetch(dlUrl, { headers });
    if (!resp.ok) throw new Error(`Artifact 下载失败: ${resp.status}`);

    const blob = await resp.blob();
    const zipName = `game-${appid || 'download'}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    this.log(`✅ 已下载: ${zipName} (${(blob.size/1024/1024).toFixed(1)}MB)`, 'success');
  }

  /* =================================================================
     方式3: CORS 代理 (备选)
     ================================================================= */
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
              const r2 = await this.api.downloadManifest(did, mid, rc);
              this.manifestData.push({ depotId: parseInt(did), manifestId: mid, data: r2.data, filename: r2.filename });
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
      this.log('👉 切换本地代理或 GitHub 模式', 'warn');
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
