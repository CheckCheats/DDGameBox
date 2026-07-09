/* ================================================================
   ZIP File Handler - Parse DDGameBox ZIP format (2253100.zip)
   
   Format: ZIP contains:
   - .lua files with depot config + decryption keys
   - .manifest files (binary Steam manifest)
   - JSON files like "100% - 228990.json"
   ================================================================ */

class ZipHandler {
  /**
   * Parse a ZIP file and extract game information + manifest files
   * @param {File} zipFile - The ZIP file from browser
   * @returns {Promise<Object>} { appid, depots, keys, manifests, manifestFiles }
   *   manifests = [{ filename, appid, progress, fileCount, depotIds }]
   *   manifestFiles = [{ name, data (binary as Uint8Array/Blob) }]
   */
  static async parseGameZip(zipFile) {
    const result = {
      appid: null,
      depots: [],
      keys: {},
      manifests: [],
      manifestFiles: [],  // 提取的 .manifest 文件 (带二进制内容)
      sourceFile: zipFile.name
    };

    // Extract AppID from ZIP filename
    const filenameMatch = zipFile.name.match(/(\d{4,})/);
    if (filenameMatch) {
      result.appid = parseInt(filenameMatch[1], 10);
    }

    // Load JSZip
    const JSZip = await ZipHandler._loadJSZip();
    
    try {
      const zip = await JSZip.loadAsync(zipFile);
      
      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        
        // ═══ 1. 提取 .manifest 文件 (二进制!) ═══
        if (filename.endsWith('.manifest')) {
          try {
            // 保存为 Blob (二进制数据)
            const blob = await zipEntry.async('blob');
            
            // 从文件名提取 depot ID
            const parts = filename.replace('.manifest', '').split('_');
            const depotId = parts.length > 0 ? parseInt(parts[0], 10) : null;
            
            result.manifestFiles.push({
              name: filename,
              depotId: depotId,
              data: blob,           // Blob 用于上传到服务器
              size: blob.size
            });
            
            // 添加到 depots 列表
            if (depotId && !result.depots.find(d => d.id === depotId)) {
              result.depots.push({ id: depotId, sha: null, hasKey: false });
            }
            
            console.log(`📦 manifest: ${filename} (${(blob.size/1024).toFixed(1)}KB)`);
          } catch (e) {
            console.warn(`Failed to extract manifest ${filename}:`, e.message);
          }
          continue;
        }
        
        // ═══ 2. 解析 JSON manifest 文件 (100% - 228990.json) ═══
        const manifestMatch = filename.match(/(\d+)%\s*-?\s*(\d+)\.json$/i);
        if (manifestMatch) {
          const progress = parseInt(manifestMatch[1], 10);
          const appId = parseInt(manifestMatch[2], 10);
          
          try {
            const content = await zipEntry.async('string');
            const parsed = ZipHandler._parseManifestJSON(content);
            
            if (parsed) {
              result.manifests.push({
                filename,
                appid: appId,
                progress,
                fileCount: parsed.fileCount,
                depotIds: parsed.depotIds || []
              });
              
              // Collect depot IDs
              if (parsed.depotIds) {
                for (const depotId of parsed.depotIds) {
                  if (!result.depots.find(d => d.id === depotId)) {
                    result.depots.push({ id: depotId, sha: null, hasKey: false });
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`Failed to parse ${filename}:`, e.message);
          }
          continue;
        }

        // ═══ 3. 解析 Lua config 文件 ═══
        if (filename.endsWith('.lua') || filename.endsWith('.txt')) {
          try {
            const content = await zipEntry.async('string');
            if (LuaParser.isValid(content)) {
              const parsed = LuaParser.parse(content);
              if (parsed.appid) result.appid = parsed.appid;
              
              // 合并 depots (从 Lua 中获得 key)
              for (const d of parsed.depots) {
                const existing = result.depots.find(x => x.id === d.id);
                if (existing) {
                  if (d.sha) { existing.sha = d.sha; existing.hasKey = true; }
                } else {
                  result.depots.push(d);
                }
              }
              
              // 收集合钥
              for (const t of (parsed.tokens || [])) {
                result.keys[t.appid] = t.token;
              }
            }
          } catch (e) {
            console.warn(`Failed to parse ${filename}:`, e.message);
          }
          continue;
        }

        // ═══ 4. 解析 config.vdf ═══
        if (filename.endsWith('.vdf') || filename === 'config.vdf') {
          try {
            const content = await zipEntry.async('string');
            const vdfKeys = ZipHandler._parseVdfKeys(content);
            Object.assign(result.keys, vdfKeys);
            for (const did of Object.keys(vdfKeys)) {
              const numDid = parseInt(did, 10);
              if (numDid && !result.depots.find(d => d.id === numDid)) {
                result.depots.push({ id: numDid, sha: vdfKeys[did], hasKey: true });
              }
            }
          } catch (e) {
            console.warn(`Failed to parse ${filename}:`, e.message);
          }
          continue;
        }
      }
      
      // 解析完成后，将 manifestFiles 中的 depot 信息合并到 depots
      for (const mf of result.manifestFiles) {
        if (mf.depotId) {
          const existing = result.depots.find(d => d.id === mf.depotId);
          if (!existing) {
            result.depots.push({ id: mf.depotId, sha: null, hasKey: false });
          }
        }
      }
      
    } catch (e) {
      console.error('ZIP parse error:', e);
      throw new Error(`ZIP 解析失败: ${e.message}`);
    }

    console.log(`📊 ZIP 结果: appid=${result.appid}, depots=${result.depots.length}, manifests=${result.manifestFiles.length}, keys=${Object.keys(result.keys).length}`);
    return result;
  }

  /**
   * Parse JSON manifest content (format: "1|" + JSON)
   */
  static _parseManifestJSON(content) {
    if (!content) return null;
    
    let jsonStr = content;
    if (content.startsWith('1|')) {
      jsonStr = content.substring(2);
    }
    
    try {
      const data = JSON.parse(jsonStr);
      
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const files = Object.keys(data);
        const depotIds = new Set();
        return {
          fileCount: files.length,
          depotIds: [...depotIds],
          files: files,
          raw: data
        };
      }
    } catch {
    }
    
    return null;
  }

  /**
   * Parse VDF config for decryption keys
   */
  static _parseVdfKeys(vdfContent) {
    const keys = {};
    const regex = /"(\d+)"\s*\{[^}]*"DecryptionKey"\s*"([a-fA-F0-9]+)"/g;
    let match;
    while ((match = regex.exec(vdfContent)) !== null) {
      keys[match[1]] = match[2];
    }
    return keys;
  }

  /**
   * Load JSZip dynamically
   */
  static async _loadJSZip() {
    if (window.JSZip) return window.JSZip;
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => {
        const script2 = document.createElement('script');
        script2.src = 'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js';
        script2.onload = () => resolve(window.JSZip);
        script2.onerror = reject;
        document.head.appendChild(script2);
      };
      document.head.appendChild(script);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZipHandler;
}
