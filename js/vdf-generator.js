/* ================================================================
   VDF 生成器 - 生成 Steam config.vdf 格式配置
   ================================================================ */

class VdfGenerator {
  /**
   * 从解析结果生成 config.vdf
   * @param {Object} parseResult - LuaParser.parse() 的输出
   * @returns {string} VDF 格式文本
   */
  static generate(parseResult) {
    const { depots, tokens } = parseResult;
    const lines = [];

    lines.push('"depots"');
    lines.push('{');

    for (const depot of depots) {
      if (!depot.sha) continue; // 没有密钥的 depot 不加入
      
      lines.push(`    "${depot.id}"`);
      lines.push('    {');
      lines.push(`        "DecryptionKey" "${depot.sha}"`);
      lines.push('    }');
    }

    // 添加 token 作为额外 depot
    for (const token of tokens) {
      lines.push(`    "${token.appid}"`);
      lines.push('    {');
      lines.push(`        "DecryptionKey" "${token.token}"`);
      lines.push('    }');
    }

    lines.push('}');

    return lines.join('\n');
  }

  /**
   * 生成 ddv20.exe 命令行脚本 (Windows .bat)
   */
  static generateBatchScript(parseResult, outputDir, manifestDir) {
    const { appid, depots } = parseResult;
    const lines = [];

    lines.push('@echo off');
    lines.push('chcp 65001 > nul');
    lines.push('');
    lines.push('REM DD Game Box - DepotDownloader 启动脚本');
    lines.push('REM 将 ddv20.exe 放在同目录下');
    lines.push('');

    // 找到 ddv20.exe 的相对路径
    lines.push('set DDV20=%~dp0ddv20.exe');
    lines.push('set MANIFEST_DIR=%~dp0manifests');
    lines.push('set OUTPUT_DIR=%~dp0download');
    lines.push('');

    // 构建命令行
    let cmd = '"%DDV20%" -l';
    if (appid) cmd += ` -a ${appid}`;
    cmd += ` -o "%OUTPUT_DIR%"`;
    cmd += ` --use-http`;
    cmd += ` depot --manifest-path "%MANIFEST_DIR%"`;

    lines.push(cmd);
    lines.push('');
    lines.push('pause');

    return lines.join('\n');
  }

  /**
   * 生成 Linux/Mac 启动脚本
   */
  static generateShellScript(parseResult, outputDir, manifestDir) {
    const { appid, depots } = parseResult;
    const lines = [];

    lines.push('#!/bin/bash');
    lines.push('# DD Game Box - DepotDownloader 启动脚本');
    lines.push('');
    lines.push('DDV20="$(dirname "$0")/ddv20"');
    lines.push('MANIFEST_DIR="$(dirname "$0")/manifests"');
    lines.push('OUTPUT_DIR="$(dirname "$0")/download"');
    lines.push('');

    let cmd = '"$DDV20" -l';
    if (appid) cmd += ` -a ${appid}`;
    cmd += ` -o "$OUTPUT_DIR"`;
    cmd += ` --use-http`;
    cmd += ` depot --manifest-path "$MANIFEST_DIR"`;

    lines.push(cmd);

    return lines.join('\n');
  }

  /**
   * 生成 JSON 格式的下载清单
   */
  static generateDownloadManifest(parseResult, manifests = {}) {
    return JSON.stringify({
      appid: parseResult.appid,
      gameName: parseResult.gameName || '',
      depots: parseResult.depots.map(d => ({
        id: d.id,
        sha: d.sha,
        hasKey: d.hasKey,
        manifestId: manifests[d.id] || null
      })),
      tokens: parseResult.tokens
    }, null, 2);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VdfGenerator;
}
