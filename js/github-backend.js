/* ================================================================
   GitHub API Backend Client
   Uses api.github.com (accessible, unlike Pages) as backend proxy
   
   Features:
   1. Query Steam info via GitHub Actions
   2. Trigger Steam manifest downloads via workflow_dispatch
   3. Poll GitHub API for results
   4. Use GitHub Releases for file distribution
   ================================================================ */

class GitHubBackend {
  constructor(options = {}) {
    this.repo = options.repo || 'CheckCheats/DDGameBox';
    this.apiBase = `https://api.github.com/repos/${this.repo}`;
    this.token = options.token || null; // Optional: for higher rate limits
    this.timeout = options.timeout || 30000;
    this.pollInterval = options.pollInterval || 15000; // 15s between polls
    
    this._cache = new Map();
    this._runningJobs = new Map();
  }

  /**
   * GitHub API request with auth/rate-limit handling
   */
  async _apiRequest(path, method = 'GET', body = null) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const options = { 
      method, 
      headers,
      signal: AbortSignal.timeout(this.timeout)
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    const resp = await fetch(url, options);
    
    // Handle rate limiting
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get('Retry-After') || '60');
      throw new Error(`API 限速，${retryAfter}秒后重试`);
    }
    
    if (resp.status === 403 && resp.headers.get('X-RateLimit-Remaining') === '0') {
      throw new Error('API 次数用尽，等待重置');
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`GitHub API ${resp.status}: ${err.message || '未知错误'}`);
    }

    return resp.json();
  }

  /**
   * Get rate limit status
   */
  async getRateLimit() {
    return this._apiRequest('https://api.github.com/rate_limit');
  }

  /**
   * Trigger a workflow dispatch (start a download job)
   */
  async triggerWorkflow(workflowFile, inputs) {
    const body = {
      ref: 'master',
      inputs: inputs
    };
    
    await this._apiRequest(
      `/actions/workflows/${workflowFile}/dispatches`,
      'POST',
      body
    );
    
    // Wait a bit for the run to appear
    await new Promise(r => setTimeout(r, 2000));
    
    // Find the run ID
    const runs = await this._apiRequest('/actions/runs?per_page=5');
    const matchingRun = runs.workflow_runs.find(r => 
      r.name === 'Steam Download Backend' && 
      r.status !== 'completed'
    );
    
    if (matchingRun) {
      this._runningJobs.set(matchingRun.id.toString(), {
        runId: matchingRun.id,
        status: matchingRun.status,
        startTime: Date.now()
      });
      return matchingRun;
    }
    
    return null;
  }

  /**
   * Poll a workflow run for completion
   */
  async pollWorkflow(runId) {
    const run = await this._apiRequest(`/actions/runs/${runId}`);
    const job = this._runningJobs.get(runId.toString());
    if (job) {
      job.status = run.status;
    }
    return run;
  }

  /**
   * Get workflow run artifacts
   */
  async getArtifacts(runId) {
    return this._apiRequest(`/actions/runs/${runId}/artifacts`);
  }

  /**
   * Download an artifact (returns URL, not the file - use browser to download)
   */
  async downloadArtifact(artifactId) {
    // Returns archive_download_url - browser can fetch with auth
    const artifact = await this._apiRequest(`/actions/artifacts/${artifactId}`);
    return artifact.archive_download_url;
  }

  /**
   * Query Steam app info via GitHub Actions
   */
  async querySteamInfo(appid) {
    const cacheKey = `steam:${appid}`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    // Trigger workflow with action='info'
    const run = await this.triggerWorkflow('steam-downloader.yml', {
      appid: appid.toString(),
      depots: '',
      action: 'info'
    });

    if (!run) {
      // Fallback: query steamcmd API directly via GitHub proxy
      return this._fallbackSteamInfo(appid);
    }

    // Poll until complete
    let result = null;
    for (let i = 0; i < 20; i++) { // max 5 minutes
      await new Promise(r => setTimeout(r, this.pollInterval));
      const status = await this.pollWorkflow(run.id);
      
      if (status.conclusion === 'success') break;
      if (status.conclusion === 'failure') throw new Error('查询失败');
    }

    // Get artifact with results
    const artifacts = await this.getArtifacts(run.id);
    if (artifacts.artifacts?.length > 0) {
      // TODO: download and parse artifact
      result = { appid, status: 'fetched' };
    }

    this._cache.set(cacheKey, result);
    return result;
  }

  /**
   * Fallback: query Steam API directly via GitHub API's rate limit
   * (GitHub API from this region can reach steamcmd.net)
   */
  async _fallbackSteamInfo(appid) {
    // Use GitHub's raw content as a proxy mechanism
    // Create an issue comment with the query, the action parses it
    // For now, try direct access
    try {
      const resp = await fetch(`https://api.steamcmd.net/v1/info/${appid}`, {
        signal: AbortSignal.timeout(15000)
      });
      if (resp.ok) {
        const data = await resp.json();
        this._cache.set(`steam:${appid}`, data);
        return data;
      }
    } catch {}
    return null;
  }

  /**
   * Search GitHub Releases for uploaded files
   */
  async getReleases() {
    return this._apiRequest('/releases?per_page=10');
  }

  /**
   * Create a release (upload results)
   */
  async createRelease(tagName, name, body) {
    return this._apiRequest('/releases', 'POST', {
      tag_name: tagName,
      name: name,
      body: body,
      draft: false,
      prerelease: false
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubBackend;
}