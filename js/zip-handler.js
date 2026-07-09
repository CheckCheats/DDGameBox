/* ================================================================
   ZIP File Handler - Parse DDGameBox ZIP format (2253100.zip)
   
   Format: ZIP contains JSON manifest files like "100% - 228990.json"
   File content: "1|" + JSON object mapping file paths → chunk SHA lists
   
   Extract: AppID from filename, Depot IDs from manifest data
   ================================================================ */

class ZipHandler {
  /**
   * Parse a ZIP file and extract game information
   * @param {File} zipFile - The ZIP file from browser
   * @returns {Promise<Object>} { appid, depots, keys, manifests }
   */
  static async parseGameZip(zipFile) {
    const result = {
      appid: null,
      depots: [],
      keys: {},
      manifests: [],
      sourceFile: zipFile.name
    };

    // Extract AppID from ZIP filename (e.g., "2253100.zip" → 2253100)
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
        
        // Check for JSON manifest files (format: "100% - 228990.json")
        const manifestMatch = filename.match(/(\d+)%\s*-\s*(\d+)\.json$/i);
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

        // Check for Lua config files
        if (filename.endsWith('.lua') || filename.endsWith('.txt')) {
          try {
            const content = await zipEntry.async('string');
            if (LuaParser.isValid(content)) {
              const parsed = LuaParser.parse(content);
              if (parsed.appid) result.appid = parsed.appid;
              if (parsed.depots.length > 0) {
                for (const d of parsed.depots) {
                  if (!result.depots.find(x => x.id === d.id)) {
                    result.depots.push(d);
                  }
                }
              }
              // Collect tokens/keys
              for (const t of (parsed.tokens || [])) {
                result.keys[t.appid] = t.token;
              }
            }
          } catch (e) {
            console.warn(`Failed to parse ${filename}:`, e.message);
          }
          continue;
        }

        // Check for config.vdf
        if (filename.endsWith('.vdf') || filename === 'config.vdf') {
          try {
            const content = await zipEntry.async('string');
            const keys = ZipHandler._parseVdfKeys(content);
            Object.assign(result.keys, keys);
            // VDF also contains depot IDs
            for (const did of Object.keys(keys)) {
              const numDid = parseInt(did, 10);
              if (numDid && !result.depots.find(d => d.id === numDid)) {
                result.depots.push({ id: numDid, sha: keys[did], hasKey: true });
              }
            }
          } catch (e) {
            console.warn(`Failed to parse ${filename}:`, e.message);
          }
          continue;
        }

        // Check for manifest files (.manifest extension)
        if (filename.endsWith('.manifest')) {
          const parts = filename.replace('.manifest', '').split('_');
          if (parts.length >= 2) {
            const depotId = parseInt(parts[0], 10);
            if (depotId && !result.depots.find(d => d.id === depotId)) {
              result.depots.push({ id: depotId, sha: null, hasKey: false });
            }
          }
        }
      }
    } catch (e) {
      console.error('ZIP parse error:', e);
      throw new Error(`ZIP 解析失败: ${e.message}`);
    }

    return result;
  }

  /**
   * Parse JSON manifest content (format: "1|" + JSON)
   * @returns {Object|null} { fileCount, depotIds, files }
   */
  static _parseManifestJSON(content) {
    if (!content) return null;
    
    // Strip "1|" prefix
    let jsonStr = content;
    if (content.startsWith('1|')) {
      jsonStr = content.substring(2);
    }
    
    try {
      const data = JSON.parse(jsonStr);
      
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const files = Object.keys(data);
        const depotIds = new Set();
        
        // Extract depot IDs from chunk data if present
        // Files are keyed by depot-relative paths
        // We can infer depot IDs from the file count and structure
        return {
          fileCount: files.length,
          depotIds: [...depotIds],
          files: files,
          raw: data
        };
      }
    } catch {
      // Maybe it's not valid JSON, return raw content
    }
    
    return null;
  }

  /**
   * Parse VDF config for decryption keys
   * Format: "depots" { "2253101" { "DecryptionKey" "hex..." } }
   */
  static _parseVdfKeys(vdfContent) {
    const keys = {};
    // Pattern: "DEPOT_ID" { "DecryptionKey" "KEY_HEX" }
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
        // Fallback to unpkg
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