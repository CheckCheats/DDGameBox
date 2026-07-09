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

  /** 
   * 读取用户配置: 从 Gist 加载 token
   * 需要用户已保存 token (用 token 读自己的 gist)
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
    } catch {}
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
      // 更新已有 Gist
      try {
        await this._gistRequest(gistId, 'PATCH', {
          files: { 'ddbox-config.json': { content } }
        });
        this._cache.set('user_config', data);
        return { success: true, gistId };
      } catch {
        // Gist 可能被删了, 重新创建
        gistId = null;
      }
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubBackend;
}