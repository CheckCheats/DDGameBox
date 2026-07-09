/* ================================================================
   Lua 脚本解析器 - 解析 SteamCMD 格式的 Lua 配置
   支持: 游戏APPID, addappid, addtoken, 密钥提取
   ================================================================ */

class LuaParser {
  /**
   * 解析 SteamCMD Lua 脚本内容
   * @param {string} content - Lua 脚本文本
   * @returns {Object} 解析结果
   */
  static parse(content) {
    const info = {
      appid: null,
      depots: [],
      dlcDepots: [],
      tokens: [],
      dlcOnly: false,
      missingKeys: false,
      rawContent: content,
      errors: []
    };

    if (!content || !content.trim()) {
      info.errors.push('空文件');
      return info;
    }

    // 1. 提取主游戏 APPID (中文注释格式)
    const appidMatch = content.match(/主游戏APPID[：:]\s*(\d+)/);
    if (appidMatch) {
      info.appid = parseInt(appidMatch[1], 10);
    }

    // 2. 提取完整格式: addappid(depot_id, token, "sha_key")
    //    addappid(480, 1, "abc123def456789...")
    const fullPattern = /addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"([^"]+)"\s*\)/g;
    let match;
    while ((match = fullPattern.exec(content)) !== null) {
      const did = parseInt(match[1], 10);
      const sha = match[2];
      // 避免重复
      if (!info.depots.find(d => d.id === did)) {
        info.depots.push({ id: did, sha: sha, hasKey: true });
      }
    }

    // 3. 提取无密钥格式: addappid(depot_id)  -- 注释
    //    addappid(480)
    const simplePattern = /^\s*addappid\s*\(\s*(\d+)\s*\)\s*(?:--.*)?$/gm;
    while ((match = simplePattern.exec(content)) !== null) {
      const did = parseInt(match[1], 10);
      if (!info.depots.find(d => d.id === did)) {
        info.depots.push({ id: did, sha: null, hasKey: false });
      }
    }

    // 4. 提取 tokens: addtoken(appid, "token")
    const tokenPattern = /addtoken\s*\(\s*(\d+)\s*,\s*"(\d+)"\s*\)/g;
    while ((match = tokenPattern.exec(content)) !== null) {
      info.tokens.push({
        appid: parseInt(match[1], 10),
        token: match[2]
      });
    }

    // 5. 检查特殊标记
    if (/缺少密钥|无仓库/.test(content)) {
      info.missingKeys = true;
    }

    // 6. 如果没找到任何 depots, 尝试从文件名猜测
    // 或者在纯数字内容时直接做 appid
    if (info.depots.length === 0 && info.appid) {
      // 可能是直接放 manifest 目录路径
    }

    return info;
  }

  /**
   * 从文件名推断 appid
   * @param {string} filename - 文件名
   * @returns {number|null}
   */
  static guessAppidFromFilename(filename) {
    if (!filename) return null;
    const match = filename.match(/(\d{5,})/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * 检测是否是有效的 SteamCMD Lua 格式
   * @param {string} content
   * @returns {boolean}
   */
  static isValid(content) {
    return /addappid|主游戏APPID/i.test(content);
  }

  /**
   * 从 manifest 文件名列表提取 depot IDs
   * @param {string[]} filenames
   * @returns {number[]}
   */
  static extractDepotsFromFilenames(filenames) {
    const depots = new Set();
    for (const name of filenames) {
      const match = name.match(/(\d+)/);
      if (match) {
        depots.add(parseInt(match[1], 10));
      }
    }
    return [...depots];
  }
}

// 导出 (浏览器环境)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LuaParser;
}
