/* ================================================================
   API 客户端 - 多源容错获取 Steam Manifest 数据
   
   API 来源:
   1. SteamCMD API:  api.steamcmd.net/v1/info/{appid}
   2. SteamOOO:      manifest.steam.ooo/{manifest_id}
   3. WUDRM:         gmrc.wudrm.com/manifest/{manifest_id}
   4. SteamRun:      manifest.steam.run/api/manifest/{manifest_id}
   5. Steam CDN:     steampipe.akamaized.net
   6. Steam Store:   store.steampowered.com/api/appdetails
   ================================================================ */

class ApiClient {
  constructor(options = {}) {
    // CORS 代理列表 (按优先级)
    this.proxies = options.proxies || [
      'https://api.allorigins.win/raw?url={url}',
      'https://api.allorigins.win/get?url={url}',
      'https://corsproxy.io/?url={url}',
      'https://api.codetabs.com/v1/proxy?quest={url}',
    ];
    this.activeProxyIndex = 0;
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    
    // API 端点
    this.ENDPOINTS = {
      STEAMCMD_API: 'https://api.steamcmd.net/v1/info/{appid}',
      WUDRM_API: 'http://gmrc.wudrm.com/manifest/{manifest_id}',
      STEAMRUN_API: 'https://manifest.steam.run/api/manifest/{manifest_id}',
      STEAMOOO_API: 'https://manifest.steam.ooo/{manifest_id}',
      STORE_API: 'https://store.steampowered.com/api/appdetails?appids={appid}&l=english',
      CDN_BASE: 'http://steampipe.akamaized.net',
      OPENSTEAM_API: 'https://manifest.opensteamtool.com/',
    };

    this.HEADERS = {
      'User-Agent': 'Valve/Steam HTTP Client 1.0',
      'Accept': '*/*',
    };

    this._cache = new Map();
    this._abortController = null;
  }

  /**
   * 通过 CORS 代理发送请求
   */
  async fetchWithProxy(url, options = {}) {
    const controller = new AbortController();
    const signal = options.signal || controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // 尝试每个代理
    for (let i = 0; i < this.proxies.length; i++) {
      const proxyUrl = this.proxies[i].replace('{url}', encodeURIComponent(url));
      try {
        const resp = await fetch(proxyUrl, {
          ...options,
          signal,
          headers: { ...this.HEADERS, ...options.headers }
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
          this.activeProxyIndex = i;
          // allorigins.win get 模式返回包装数据
          if (proxyUrl.includes('/get?url=')) {
            const wrapper = await resp.json();
            return wrapper.contents;
          }
          return resp.ok ? resp : await resp.text();
        }
      } catch (e) {
        console.warn(`Proxy ${i} failed for ${url}:`, e.message);
        continue;
      }
    }
    clearTimeout(timeoutId);
    throw new Error(`所有 CORS 代理均无法访问: ${url}`);
  }

  /**
   * 获取 App 信息 (带缓存)
   */
  async getAppInfo(appid) {
    const cacheKey = `appinfo:${appid}`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    const url = this.ENDPOINTS.STEAMCMD_API.replace('{appid}', appid);
    const text = await this.fetchWithProxy(url);
    const data = JSON.parse(typeof text === 'string' ? text : text);
    this._cache.set(cacheKey, data);
    return data;
  }

  /**
   * 获取游戏名称 (从 Steam Store)
   */
  async getGameName(appid) {
    try {
      const url = this.ENDPOINTS.STORE_API.replace('{appid}', appid);
      const text = await this.fetchWithProxy(url);
      const data = JSON.parse(typeof text === 'string' ? text : text);
      return data?.[String(appid)]?.data?.common?.name || '';
    } catch {
      return '';
    }
  }

  /**
   * 获取最新 Manifest IDs
   */
  async fetchLatestManifests(appid, depotIds) {
    const data = await this.getAppInfo(appid);
    const depots = data?.data?.depots || {};
    const manifests = {};

    for (const depotId of depotIds) {
      const depotInfo = depots[String(depotId)] || {};
      const publicBranch = depotInfo.public || {};
      if (publicBranch.gid) {
        manifests[depotId] = publicBranch.gid;
      } else if (depotInfo.manifests?.public?.gid) {
        manifests[depotId] = depotInfo.manifests.public.gid;
      }
    }
    return manifests;
  }

  /**
   * 过滤 Windows 平台 Depot
   */
  async filterWindowsDepots(appid, depotIds) {
    const data = await this.getAppInfo(appid);
    const depots = data?.data?.depots || {};
    const result = [];

    for (const depotId of depotIds) {
      const depotInfo = depots[String(depotId)] || {};
      const config = depotInfo.config || {};
      const oslist = (config.oslist || '').toLowerCase();
      const realm = (config.realm || '').toLowerCase();

      if (oslist.includes('windows') || !oslist) {
        if (!realm.includes('steamchina')) {
          result.push(depotId);
        }
      }
    }
    return result;
  }

  /**
   * 获取 Manifest 请求码 (多 API 容错)
   */
  async fetchRequestCode(manifestId) {
    // 1. 尝试 steam.ooo
    try {
      const url = this.ENDPOINTS.STEAMOOO_API.replace('{manifest_id}', manifestId);
      const text = await this.fetchWithProxy(url);
      const code = (typeof text === 'string' ? text : text).trim();
      if (/^\d+$/.test(code)) return code;
    } catch {}

    // 2. 尝试 wudrm
    try {
      const url = this.ENDPOINTS.WUDRM_API.replace('{manifest_id}', manifestId);
      const text = await this.fetchWithProxy(url);
      return (typeof text === 'string' ? text : text).trim();
    } catch {}

    // 3. 尝试 steam.run
    try {
      const url = this.ENDPOINTS.STEAMRUN_API.replace('{manifest_id}', manifestId);
      const text = await this.fetchWithProxy(url);
      const data = JSON.parse(typeof text === 'string' ? text : text);
      return data?.content || '';
    } catch {}

    throw new Error(`无法获取 manifest ${manifestId} 的请求码`);
  }

  /**
   * 下载 Manifest 文件
   * @returns {Promise<{depotId: number, manifestId: string, data: ArrayBuffer, filename: string}>}
   */
  async downloadManifest(depotId, manifestId, requestCode) {
    const url = `${this.ENDPOINTS.CDN_BASE}/depot/${depotId}/manifest/${manifestId}/5/${requestCode}`;
    
    const resp = await this.fetchWithProxy(url);
    
    let data;
    let filename = `${depotId}_${manifestId}.manifest`;

    // 检查是否是 ZIP
    const text = typeof resp === 'string' ? resp : await resp.text();
    if (text.startsWith('PK')) {
      // ZIP 格式 - 使用 JSZip 或手动解析
      // 对于浏览器，返回原始文本让 zip-packager 处理
      data = text;
      filename = `${depotId}_${manifestId}.zip`;
    } else {
      data = text;
    }

    return { depotId, manifestId, data, filename };
  }

  /**
   * 取消当前操作
   */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiClient;
}
