# 🎮 DD Game Box Web

> **注意:** 此网页版为[地道游戏盒 V14](https://github.com/CheckCheats/DDGameBox)的逆向工程重构，完全在浏览器端运行。

## 🌐 在线地址

`https://checkcheats.github.io/DDGameBox/`

## ✨ 功能

- 📁 **拖入/浏览**上传 SteamCMD Lua 脚本
- 🔍 **自动解析**游戏配置 (APPID、Depot、密钥)
- 📡 **多 API 容错**获取 Manifest 信息
- 📦 **一键打包**下载 manifest + config.vdf
- 📊 **可视化进度**跟踪
- 🎨 **暖色复古主题**，移植原应用配色

## 📥 使用说明

1. **准备文件**: 获取 SteamCMD Lua 脚本 (如 `ac_origin.lua`)
2. **上传**: 拖入网页或点击选择文件
3. **解析**: 自动显示游戏信息、Depot 列表、密钥状态
4. **获取**: 点击"获取 Manifest"，自动从多个 API 下载
5. **打包**: 下载包含 manifests + config.vdf 的 ZIP 包
6. **下载游戏**: 将 ZIP 解压到 ddv20.exe 目录，运行 `start_download.bat`

## 🏗️ 本地开发

```bash
# 直接打开
open web/index.html

# 或使用 Python 简单服务器
cd web && python -m http.server 8080
# 访问 http://localhost:8080
```

## 📁 项目结构

```
web/
├── index.html              # 主页面
├── css/
│   └── style.css           # 样式表（暖色主题）
├── js/
│   ├── lua-parser.js       # Lua 脚本解析器
│   ├── api-client.js       # API 客户端（多源容错）
│   ├── vdf-generator.js    # VDF 配置生成
│   ├── zip-packager.js     # ZIP 打包下载
│   └── app.js              # 主应用逻辑
└── .github/workflows/
    └── deploy.yml           # GitHub Pages 部署
```

## 🔧 技术栈

- **HTML5** + **CSS3** (原生，无框架)
- **Vanilla JavaScript** (ES6+)
- **CORS 代理**: 绕过 API 跨域限制
- **JSZip**: 浏览器端 ZIP 打包
- **GitHub Pages**: CDN 托管

## ⚠️ 已知限制

- 浏览器无法直接连接 Steam CDN，需通过 CORS 代理
- manifest 文件下载需代理可用
- 实际游戏文件下载需配合 ddv20.exe (DepotDownloader) 使用

## 📄 许可证

仅供学习研究使用
