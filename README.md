# 🎮 DD Game Box Web v2.0

> Steam 游戏下载助手 — GitHub 后端驱动 | 反向工程重构[地道游戏盒 V14](https://github.com/CheckCheats/DDGameBox)

## 🌐 在线地址

- **⭐ 推荐 CDN**: https://cdn.jsdelivr.net/gh/CheckCheats/DDGameBox@master/index.html
- **GitHub Pages**: https://checkcheats.github.io/DDGameBox/
- **本地**: 直接打开 `index.html`

> 如果 Pages 打不开，请使用 CDN 链接 (jsDelivr 全球加速)

## ✨ v2.0 新功能

- 🗜️ **ZIP 上传**: 支持拖入 `2253100.zip` 格式文件，自动解析游戏信息
- 🔗 **GitHub 后端**: 使用 GitHub API + Actions 替代不稳定的 CORS 代理
- 🔄 **双模式**: GitHub API / CORS 代理 可切换
- 📊 **工作流追踪**: 实时查看 GitHub Actions 下载进度
- 📁 **多格式**: 支持 .zip / .lua / .txt / .manifest / .json

## 📥 使用说明

1. **上传**: 拖入 `2253100.zip` 或 SteamCMD Lua 脚本
2. **解析**: 自动显示游戏 AppID、Depot 列表、密钥状态
3. **配置 Token** (可选): 右上角输入 GitHub Token 提高 API 限额
4. **获取**: 选择 GitHub 后端 → 点击"获取 Manifest"
5. **打包**: 下载包含 manifests + config.vdf 的 ZIP

## 🏗️ 项目结构

```
├── index.html                    # 主页面
├── css/style.css                 # 暖色主题样式
├── js/
│   ├── lua-parser.js             # SteamCMD Lua 解析器
│   ├── api-client.js             # 多源 CORS API 客户端
│   ├── github-backend.js         # GitHub API 后端
│   ├── vdf-generator.js          # VDF 配置生成
│   ├── zip-packager.js           # ZIP 打包下载
│   ├── zip-handler.js            # DDGameBox ZIP 格式解析
│   └── app.js                    # 主应用 (v2.0)
└── .github/workflows/
    ├── deploy.yml                # Pages 部署
    └── steam-downloader.yml      # Steam 下载后端 (Actions)
```

## 🔧 技术栈

- **Vanilla JavaScript ES6+** — 零框架依赖
- **GitHub Actions** — 服务端下载引擎
- **GitHub API** — 可靠的后端通道
- **jsDelivr CDN** — 全球加速访问
- **JSZip** — 浏览器 ZIP 处理

## ⚠️ 注意事项

- GitHub Pages 可能在某些网络被阻断 → 使用 CDN 链接
- GitHub API 未认证: 60次/小时 → 绑定 Token: 5000次/小时
- 实际游戏下载需配合 DepotDownloader (ddv20.exe)

## 📄 许可

仅供学习研究使用