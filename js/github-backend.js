/* ================================================================
   GitHub API Backend Client v2.2
   - Gist 数据库: 用户配置云端持久化
   - 快速 API 状态检测 (HEAD)
   - Actions 触发 / 轮询
   ================================================================ */

class GitHubBackend {
  constructor(options = {}) {
    this.repo = options.repo || 'CheckCheats/DDGameBox';
    this.apiBase = `https://api.github.com/repos/${this.repo}`;
    this.token = options.token || null;
    this.timeout = options.timeout || 15000;
    this.pollInterval = options.pollInterval || 15000;
    this.log = options.log || null;

    this._cache = new Map();
    this._runningJobs = new Map();
    // Gist ID cookie key
    this.GIST_COOKIE = 'ddgist';
  }

  /* =================================================================
     GitHub API 基础请求 (带认证/限速处理)
     ================================================================= */
  async _apiRequest(path, method = 'GET', body = null) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const headers = {
      'Accept': 'application/vnd.github+json',
    };
    if (body) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const resp = await fetch(url, {
      method, headers,
      body: body ? JSON.stringify(body) : null,
      signal: AbortSignal.timeout(this.timeout)
    });

    if (resp.status === 429) {
      const s = parseInt(resp.headers.get('Retry-After') || '60');
      throw new Error(`API限速，${s}秒后重试`);
    }
    if (resp.status === 403 && resp.headers.get('X-RateLimit-Remaining') === '0') {
      throw new Error('API次数用尽，重置中...');
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`GitHub ${resp.status}: ${err.message || '?'}`);
    }
    // 204 No Content → 不解析 body
    if (resp.status === 204) return null;
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  /* =================================================================
     快速 API 状态检测 (HEAD)
     ================================================================= */
  async quickCheck() {
    const result = { ok: false, authed: false, remaining: 0 };
    try {
      const resp = await fetch('https://api.github.com/rate_limit', {
        method: 'GET',
        headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {},
        signal: AbortSignal.timeout(5000)
      });
      result.ok = resp.ok;
      if (resp.ok) {
        const data = await resp.json();
        result.remaining = data?.rate?.remaining || 0;
        result.authed = !!this.token;
      }
    } catch (e) {
      // CORS blocked (GitHub Pages → api.github.com), silently degrade
      result.ok = false;
      result.corsBlocked = true;
    }
    return result;
  }

  /* =================================================================
     Rate Limit 详细
     ================================================================= */
  async getRateLimit() {
    return this._apiRequest('https://api.github.com/rate_limit');
  }

  /* =================================================================
     触发 Actions 工作流
     ================================================================= */
  async triggerWorkflow(workflowFile, inputs) {
    await this._apiRequest(`/actions/workflows/${workflowFile}/dispatches`, 'POST', {
      ref: 'master',
      inputs
    });
    await new Promise(r => setTimeout(r, 2000));
    const runs = await this._apiRequest('/actions/runs?per_page=5');
    const match = runs.workflow_runs.find(r => r.status !== 'completed');
    if (match) {
      this._runningJobs.set(match.id.toString(), { runId: match.id, status: match.status, startTime: Date.now() });
      return match;
    }
    return null;
  }

  async pollWorkflow(runId) {
    const run = await this._apiRequest(`/actions/runs/${runId}`);
    const job = this._runningJobs.get(runId.toString());
    if (job) job.status = run.status;
    return run;
  }

  /* =================================================================
     Gist 数据库 — 用户 Token / 配置云持久化
     ================================================================= */

  /** 获取 Gist ID (从 cookie) */
  getGistId() {
    const m = document.cookie.match(new RegExp(`(?:^|; )${this.GIST_COOKIE}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  /** 保存 Gist ID 到 cookie (365天) */
  _saveGistId(id) {
    document.cookie = `${this.GIST_COOKIE}=${encodeURIComponent(id)};max-age=${60*60*24*365};path=/;SameSite=Lax`;
  }

  /** 清除 Gist ID cookie */
  _clearGistId() {
    document.cookie = `${this.GIST_COOKIE}=;max-age=0;path=/`;
    this._cache.delete('user_config');
  }

  /** 
   * 读取用户配置: 从 Gist 加载 token
   * 需要用户已保存 token (用 token 读自己的 gist)
   * 404 → Gist 被删除/不存在 → 清除 cookie, 自动创建新 Gist
   */
  async loadUserConfig() {
    const gistId = this.getGistId();
    if (!gistId || !this.token) return null;
    try {
      const gist = await this._gistRequest(gistId);
      const file = gist.files?.['ddbox-config.json'];
      if (file?.content) {
        const cfg = JSON.parse(file.content);
        this._cache.set('user_config', cfg);
        return cfg;
      }
    } catch (e) {
      // Gist 不存在/被删 → 清 cookie, 下次 saveUserConfig 会自动创建
      if (/Gist 404/.test(e.message)) {
        document.cookie = `${this.GIST_COOKIE}=;max-age=0;path=/`;
        this._cache.delete('user_config');
        return null; // 不抛错, 让调用方继续
      }
      throw e;
    }
    return null;
  }

  /**
   * 保存用户配置到 Gist
   * 自动创建/更新 Gist, 返回 { success, gistId }
   */
  async saveUserConfig(data) {
    if (!this.token) throw new Error('需要 Token 才能保存配置');

    let gistId = this.getGistId();
    const content = JSON.stringify({ ...data, updated: Date.now() }, null, 2);

    if (gistId) {
      // 更新已有 Gist — 404 不抛异常, 静默降级到创建
      const updated = await this._gistRequest(gistId, 'PATCH', {
        files: { 'ddbox-config.json': { content } }
      }).catch(() => null);
      if (updated) {
        this._cache.set('user_config', data);
        return { success: true, gistId };
      }
      // Gist 不存在或被删, 清 cookie 重新创建
      this._clearGistId();
      gistId = null;
    }

    // 创建新 Gist
    const gist = await this._gistRequest(null, 'POST', {
      description: 'DD Game Box - 用户配置',
      public: false,
      files: { 'ddbox-config.json': { content } }
    });
    this._saveGistId(gist.id);
    this._cache.set('user_config', data);
    return { success: true, gistId: gist.id };
  }

  /**
   * Gist API 请求 (跨域, 不经过 repo)
   */
  async _gistRequest(gistId, method = 'GET', body = null) {
    const url = gistId
      ? `https://api.github.com/gists/${gistId}`
      : 'https://api.github.com/gists';
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      signal: AbortSignal.timeout(15000)
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      // 404 = gist 不存在, 清除 cookie
      if (resp.status === 404 && gistId) {
        document.cookie = `${this.GIST_COOKIE}=;max-age=0;path=/`;
        this._cache.delete('user_config');
      }
      throw new Error(`Gist ${resp.status}: ${err.message || '?'}`);
    }
    if (resp.status === 204) return null;
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  /** 获取 Releases */
  async getReleases() {
    return this._apiRequest('/releases?per_page=10');
  }

  /* =================================================================
     文件操作: 推送到仓库 (Contents API)
     ================================================================= */

  /** 推送文件到仓库 (自动 base64 编码) */
  async pushFile(path, content, message = 'update file') {
    const b64 = btoa(unescape(encodeURIComponent(content)));
    // 检查文件是否已存在（获取 SHA）
    let sha = null;
    try {
      const existing = await this._apiRequest(`/contents/${path}`);
      if (existing?.sha) sha = existing.sha;
    } catch (e) {
      if (e.message?.startsWith('GitHub 404')) sha = null; // 新文件
      else if (e.message?.startsWith('GitHub 403')) throw new Error('Token 无 contents 写入权限');
      else throw e;
    }
    const body = {
      message: sha ? `update: ${message}` : `create: ${message}`,
      content: b64,
      branch: 'master'
    };
    if (sha) body.sha = sha;
    return this._apiRequest(`/contents/${path}`, 'PUT', body);
  }

  /** 删除文件 */
  async deleteFile(path, message = 'cleanup') {
    const existing = await this._apiRequest(`/contents/${path}`);
    if (!existing?.sha) throw new Error('File not found');
    return this._apiRequest(`/contents/${path}`, 'DELETE', {
      message: `delete: ${message}`,
      sha: existing.sha,
      branch: 'master'
    });
  }

  /* =================================================================
     完整下载请求流程: 推送数据 → 触发 Actions → 获取 Artifact
     ================================================================= */

  /**
   * 提交下载请求:
   * 1. 将 payload 推送到 requests/{uuid}.json
   * 2. 触发 workflow_dispatch
   * 3. 返回 { requestId, runId }
   */
  async submitDownloadRequest(payload) {
    const uuid = crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

    const path = `requests/${uuid}.json`;
    const payloadStr = JSON.stringify(payload);

    this.log?.(`📤 推送请求数据到 ${path}...`);
    await this.pushFile(path, payloadStr, `下载请求 ${uuid}`);

    // 等待几秒确保 GitHub 处理好 commit，再触发 workflow
    await new Promise(r => setTimeout(r, 3000));

    this.log?.(`🚀 触发 Steam Depot Downloader...`);
    const run = await this.triggerWorkflow('steam-downloader.yml', {
      request_id: uuid
    });

    return {
      requestId: uuid,
      runId: run?.id || null,
      runUrl: run?.html_url || null
    };
  }

  /** 获取 Artifact 下载 URL */
  async getArtifactDownloadUrl(runId) {
    const result = await this._apiRequest(`/actions/runs/${runId}/artifacts`);
    if (!result?.artifacts?.length) return null;
    const art = result.artifacts[0];
    return {
      id: art.id,
      name: art.name,
      size: art.size_in_bytes,
      downloadUrl: `${this.apiBase}/actions/artifacts/${art.id}/zip`
    };
  }

  /** 轮询工作流直到完成 */
  async pollUntilDone(runId, onProgress, timeoutMs = 30 * 60 * 1000) {
    const start = Date.now();
    let lastStatus = '';

    while (Date.now() - start < timeoutMs) {
      const run = await this.pollWorkflow(runId);
      const status = run.conclusion || run.status;

      if (status !== lastStatus) {
        const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
        onProgress?.(`status: ${status} (${elapsed}min)`);
        lastStatus = status;
      }

      if (run.conclusion === 'success') return { success: true, run };
      if (run.conclusion === 'failure') return { success: false, error: '工作流失败', run };
      if (run.conclusion === 'cancelled') return { success: false, error: '工作流已取消', run };
      if (run.status === 'completed' && run.conclusion === 'skipped') return { success: false, error: '工作流跳过', run };

      await new Promise(r => setTimeout(r, 15000));
    }

    return { success: false, error: '等待超时 (30分钟)' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubBackend;
}