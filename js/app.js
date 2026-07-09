/* ================================================================
   DD Game Box Web v2.0 - GitHub Backend Integration
   Uses GitHub API + Actions as serverless backend
   ================================================================ */

class DDGameBoxApp {
  constructor() {
    // 状态
    this.parseResult = null;
    this.manifestData = [];
    this.fetchedManifests = {};
    this.gameName = '';
    this.isFetching = false;
    this.triggeredWorkflow = null;

    // 组件
    this.api = new ApiClient();
    this.github = new GitHubBackend({ repo: 'CheckCheats/DDGameBox' });
    this.zip = new ZipPackager();

    // DOM
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
      ghBackendRadio: document.querySelectorAll('input[name="backend"]'),
    };
  }

  _initEvents() {
    const dz = this.dom.dropZone;
    const fi = this.dom.fileInput;

    // 拖放事件
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
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

    // 日志过滤
    this.dom.logTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.dom.logTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._applyLogFilter(tab.dataset.type);
      });
    });

    // GitHub Token
    this.dom.ghSaveTokenBtn.addEventListener('click', () => {
      const token = this.dom.ghTokenInput.value.trim();
      if (token) {
        localStorage.setItem('dd_gh_token', token);
        this.github.token = token;
        this.log('✅ GitHub Token 已保存 (本地存储)', 'success');
        this._checkGitHubStatus();
      }
    });
    
    // 后端切换
    this.dom.ghBackendRadio.forEach(radio => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="backend"]:checked').value;
        this.log(`🔄 后端切换: ${mode === 'github' ? 'GitHub API' : 'CORS 代理'}`, 'info');
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

  /**
   * Handle uploaded files (ZIP, Lua, manifest, JSON)
   */
  async _handleFiles(files) {
    this._clear();
    this.log(`📁 处理 ${files.length} 个文件...`, 'info');

    let allContent = '';
    const manifestFiles = [];

    for (const file of files) {
      try {
        // === ZIP files (DDGameBox format: 2253100.zip) ===
        if (file.name.endsWith('.zip')) {
          this.log(`🗜️ 解析 ZIP: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB)`, 'info');
          const zipResult = await ZipHandler.parseGameZip(file);
          
          if (zipResult) {
            this._applyZipResult(zipResult);
            this.log(`✅ ZIP 解析: AppID=${zipResult.appid}, Depots=${zipResult.depots.length}, Manifests=${zipResult.manifests.length}`, 'success');
          }
          continue;
        }

        const content = await file.text();
        
        // Manifest files
        if (file.name.endsWith('.manifest')) {
          manifestFiles.push({ name: file.name, content });
          this.log(`📄 加载 manifest: ${file.name}`, 'info');
          continue;
        }

        // Lua/SteamCMD scripts
        if (LuaParser.isValid(content) || file.name.endsWith('.lua') || file.name.endsWith('.txt')) {
          allContent += '\n' + content;
          this.log(`📄 加载脚本: ${file.name} (${(content.length/1024).toFixed(1)}KB)`, 'info');
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

    // Parse Lua content
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
      this.log('⚠️ 未找到可识别的游戏内容', 'warn');
    }

    this._updateStatus();
  }

  /**
   * Apply ZIP parse result
   */
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
    
    // Merge keys into depots
    if (zipResult.keys) {
      for (const [did, key] of Object.entries(zipResult.keys)) {
        const depot = this.parseResult.depots.find(d => d.id === parseInt(did));
        if (depot) {
          depot.sha = key;
          depot.hasKey = true;
        }
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
    this.log(`📦 处理 ${files.length} 个 manifest 文件...`, 'info');
    this.manifestData = files;
    this.dom.downloadZipBtn.disabled = false;
  }

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
      </span>
    `;

    this.dom.depotList.innerHTML = r.depots.map(d => `
      <div class="depot-item" data-depot-id="${d.id}">
        <span class="depot-id">${d.id}</span>
        <span class="depot-sha" title="${d.sha || '无密钥'}">
          ${d.sha ? d.sha.substring(0, 40) + '...' : '❌ 无密钥'}
        </span>
        <span class="depot-status ${d.hasKey ? 'ok' : 'missing'}">
          ${d.hasKey ? '有密钥' : '缺密钥'}
        </span>
      </div>
    `).join('') || '<div style="color:var(--label)">未找到 Depot</div>';

    this.dom.keyInfo.innerHTML = r.tokens.length > 0
      ? r.tokens.map(t => `<div class="token-item">🔑 Token APPID ${t.appid}: ${t.token}</div>`).join('')
      : '<div>无额外 Token</div>';

    if (r.appid || r.depots.length > 0) {
      this.dom.fetchBtn.disabled = false;
    }
  }

  /**
   * Start fetch - uses backend mode (GitHub or CORS)
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
    const mode = document.querySelector('input[name="backend"]:checked').value;

    try {
      if (mode === 'github') {
        await this._startFetchGitHub(r, depotIds);
      } else {
        await this._startFetchLegacy(r, depotIds);
      }

      if (this.parseResult) {
        const vdfContent = VdfGenerator.generate(this.parseResult);
        this._showVdfPreview(vdfContent);
        this.log('🎉 所有操作完成！', 'success');
        this.dom.downloadZipBtn.disabled = false;
      }
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
   * GitHub backend fetch - trigger Actions workflow
   */
  async _startFetchGitHub(r, depotIds) {
    this._addProgress('github', '🔗 连接到 GitHub 后端', 0);
    
    if (!this.github.token) {
      throw new Error('需要 GitHub Token (右上角设置)');
    }

    this._updateProgress('github', 50);
    this.log('📡 通过 GitHub Actions 查询 Steam 数据...', 'api');

    // Trigger workflow
    const depotsStr = depotIds.join(',');
    this.triggeredWorkflow = await this.github.triggerWorkflow('steam-downloader.yml', {
      appid: r.appid ? r.appid.toString() : '',
      depots: depotsStr,
      action: 'manifests'
    });

    if (this.triggeredWorkflow) {
      this._updateProgress('github', 70);
      this.log(`✅ 工作流已触发: #${this.triggeredWorkflow.id}`, 'success');
      this.log(`🔗 https://github.com/CheckCheats/DDGameBox/actions/runs/${this.triggeredWorkflow.id}`, 'info');

      // Poll for completion
      this._addProgress('poll', '⏳ 等待工作流完成...', 30);
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 15000));
        const status = await this.github.pollWorkflow(this.triggeredWorkflow.id);
        this._updateProgress('poll', 30 + (i / 15) * 70);
        
        if (status.conclusion === 'success') {
          this._updateProgress('poll', 100);
          this.log('✅ GitHub Actions 工作流完成!', 'success');
          break;
        }
        if (status.conclusion === 'failure') {
          throw new Error('工作流执行失败，请检查 Actions 日志');
        }
      }

      this._updateProgress('github', 100);
    } else {
      // Fallback to legacy
      this.log('⚠️ GitHub 后端未响应，降级到 CORS 代理...', 'warn');
      await this._startFetchLegacy(r, depotIds);
    }
  }

  /**
   * Legacy CORS proxy fetch (original method)
   */
  async _startFetchLegacy(r, depotIds) {
    if (r.appid) {
      this._addProgress('step1', '🔍 过滤 Windows Depots (CORS)', 0);
      const filtered = await this.api.filterWindowsDepots(r.appid, depotIds);
      this._updateProgress('step1', 100);
      this.log(`✅ 过滤: ${filtered.length}/${depotIds.length} Windows Depot`, 'success');

      this._addProgress('step2', '📡 获取 Manifest IDs', 0);
      const manifests = await this.api.fetchLatestManifests(r.appid, filtered);
      this.fetchedManifests = manifests;
      this._updateProgress('step2', 100);
      this.log(`✅ ${Object.keys(manifests).length} 个 manifest IDs`, 'success');

      let completed = 0;
      const total = Object.entries(manifests).length;
      if (total > 0) {
        this._addProgress('step3', '⬇️ 下载 Manifest', 0);
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
          this._updateProgress('step3', (completed/total)*100);
        }
      }
    }
  }

  _addProgress(id, label, percent) {
    const div = document.createElement('div');
    div.className = 'progress-item loading';
    div.id = `progress-${id}`;
    div.innerHTML = `
      <div class="progress-header"><span>${label}</span><span class="progress-pct">${percent}%</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
    `;
    this.dom.progressContainer.appendChild(div);
  }

  _updateProgress(id, percent) {
    const item = document.getElementById(`progress-${id}`);
    if (!item) return;
    const fill = item.querySelector('.progress-fill');
    const pct = item.querySelector('.progress-pct');
    fill.style.width = `${percent}%`;
    pct.textContent = `${Math.round(percent)}%`;
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
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    window.copyText = function(btn) {
      const textarea = btn.closest('.modal-box').querySelector('textarea');
      navigator.clipboard.writeText(textarea.value).then(() => {
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
      this.dom.statusText.textContent = '就绪 - 拖入2253100.zip或Lua脚本';
    }
    this.dom.fileCount.textContent = `📁 ${this.manifestData.length} manifest`;
  }

  async _checkStatus() {
    this.dom.apiStatus.textContent = '🌐 检测中...';
    
    // Check GitHub API
    try {
      const limit = await this.github.getRateLimit();
      const remaining = limit?.rate?.remaining || '?';
      this.dom.apiStatus.innerHTML = `🌐 GitHub API: <span style="color:#6b8e23">${remaining} 次可用</span>`;
    } catch {
      this.dom.apiStatus.innerHTML = '🌐 GitHub API: <span style="color:#e65100">不可用</span>';
    }
    
    this._checkGitHubStatus();
  }

  async _checkGitHubStatus() {
    if (!this.github.token) return;
    try {
      const limit = await this.github.getRateLimit();
      const remaining = limit?.rate?.remaining || '?';
      this.dom.apiStatus.innerHTML = `🌐 GitHub API: <span style="color:#6b8e23">✅ ${remaining} 次</span>`;
    } catch {}
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.app = new DDGameBoxApp();
});