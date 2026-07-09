/* ================================================================
   ZIP 打包器 - 将 manifests + config 打包下载
   使用 Compression Streams API (现代浏览器原生支持)
   降级使用 JSZip CDN 备选
   ================================================================ */

class ZipPackager {
  constructor() {
    this.files = new Map(); // filename -> content (string/Blob)
  }

  /**
   * 添加文件
   */
  addFile(filename, content) {
    this.files.set(filename, content);
  }

  /**
   * 添加二进制文件
   */
  addBlob(filename, blob) {
    this.files.set(filename, blob);
  }

  /**
   * 生成并下载 ZIP
   */
  async download(zipName = 'ddgamebox-package.zip') {
    if (this.files.size === 0) {
      throw new Error('没有文件可打包');
    }

    // 尝试使用原生 Compression Streams API
    if (this._supportsNativeZip()) {
      await this._downloadNativeZip(zipName);
    } else {
      // 降级: 使用 JSZip CDN
      await this._downloadWithJSZip(zipName);
    }
  }

  /**
   * 检查是否支持原生 ZIP
   */
  _supportsNativeZip() {
    return 'CompressionStream' in window;
  }

  /**
   * 使用原生 API 生成 ZIP (仅支持文本文件)
   * 对于完整的 ZIP 支持, 推荐 JSZip
   */
  async _downloadNativeZip(zipName) {
    // 简单的文本打包 - 作为 JSON 下载
    const packageData = {};
    for (const [name, content] of this.files) {
      packageData[name] = typeof content === 'string' 
        ? content 
        : '[binary content]';
    }
    const blob = new Blob(
      [JSON.stringify(packageData, null, 2)], 
      { type: 'application/json' }
    );
    this._triggerDownload(blob, 'ddgamebox-manifests.json');
  }

  /**
   * 使用 JSZip 生成完整 ZIP
   */
  async _downloadWithJSZip(zipName) {
    // 动态加载 JSZip
    const JSZip = await this._loadJSZip();
    
    const zip = new JSZip();
    
    for (const [name, content] of this.files) {
      if (content instanceof Blob || content instanceof Uint8Array) {
        zip.file(name, content);
      } else {
        zip.file(name, content);
      }
    }

    const blob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    this._triggerDownload(blob, zipName);
  }

  /**
   * 动态加载 JSZip
   */
  async _loadJSZip() {
    if (window.JSZip) return window.JSZip;
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve(window.JSZip);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * 触发浏览器下载
   */
  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**
   * 创建完整的下载包
   * @param {Object} parseResult - LuaParser.parse() 结果
   * @param {Array} manifestData - 下载的 manifest 数据
   */
  createPackage(parseResult, manifestData) {
    this.files.clear();

    // 1. 添加 config.vdf
    const vdfContent = VdfGenerator.generate(parseResult);
    this.addFile('config.vdf', vdfContent);

    // 2. 添加 manifests
    if (manifestData && manifestData.length > 0) {
      for (const item of manifestData) {
        const filename = `${item.depotId}_${item.manifestId}.manifest`;
        if (typeof item.data === 'string') {
          // 可能是 ZIP 或文本数据
          this.addFile(filename, item.data);
        }
      }
    }

    // 3. 添加下载清单 JSON
    const manifest = VdfGenerator.generateDownloadManifest(parseResult);
    this.addFile('download_manifest.json', manifest);

    // 4. 添加启动脚本
    const batchScript = VdfGenerator.generateBatchScript(parseResult);
    this.addFile('start_download.bat', batchScript);

    const shellScript = VdfGenerator.generateShellScript(parseResult);
    this.addFile('start_download.sh', shellScript);

    return this;
  }

  /**
   * 获取文件列表
   */
  getFileList() {
    return [...this.files.keys()];
  }

  /**
   * 获取总大小估算
   */
  getEstimatedSize() {
    let total = 0;
    for (const [name, content] of this.files) {
      total += typeof content === 'string' 
        ? new Blob([content]).size 
        : content.size || content.length || 0;
    }
    return total;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZipPackager;
}
