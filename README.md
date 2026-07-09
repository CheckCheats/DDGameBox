# 🎮 DD Game Box Web

> Steam 游戏下载助手 — GitHub 后端驱动 · 密码保护 · 云端配置

## 🌐 在线地址

| 来源 | 地址 |
|------|------|
| ⭐ CDN (推荐) | https://cdn.jsdelivr.net/gh/CheckCheats/DDGameBox@master/index.html |
| GitHub Pages | https://checkcheats.github.io/DDGameBox/ |
| ⭐ CDN (备选) | https://cdn.jsdelivr.net/gh/CheckCheats/DDGameBox@master/index.html |

> 优先使用 GitHub Pages，CDN 链接在某些浏览器可能以 text/plain 显示源码
> 如果 CDN 打开是字符源码 → 请改用 GitHub Pages 链接

## 🔒 密码保护

- 打开网页需输入密码解锁
- 密码在源码中 XOR 0x5A 混淆存储, 不可直接读取
- 解锁后 1 小时内免重新输入 (localStorage)
- 内置版本号显示在解锁页底部 + 状态栏, 用于辨别部署是否成功

## ✨ 功能

- 🔑 **密钥拖入即解析** — 支持 ZIP / Lua / manifest / JSON
- 🚀 **GitHub Actions 后端** — 通过 API 触发, 服务器直接从 Steam 下载
- ☁️ **Gist 云存储** — Token 加密保存到私有 Gist, 跨设备自动恢复
- ⚡ **一键获取 Token** — 点击 ⚡ 跳转创建页面, 预填权限
- 🔄 **双模式后端** — GitHub API (推荐) / CORS 代理 (备选)
- 📊 **实时进度** — 工作流状态轮询 + 日志面板
- 📦 **打包下载** — manifests + config.vdf 一键打包

## 📥 使用流程

1. 输入密码进入页面
2. 拖入密钥文件 (任意 Steam 密钥 ZIP / Lua 脚本)
3. 右上角输入 GitHub Token (点击 ⚡ 一键创建)
4. 点击 💾 保存 Token (同步到 Gist 云端)
5. 点击 🚀 开始下载 — GitHub Actions 后台执行
6. 完成后点击 📦 打包下载

## 🏗️ 项目结构

```
├── index.html                    # 主页面 (含密码门)
├── css/style.css                 # 暗色主题
├── js/
│   ├── app.js                    # 主应用
│   ├── github-backend.js         # GitHub API + Gist 云存储
│   ├── api-client.js             # CORS 代理客户端
│   ├── lua-parser.js             # Lua 密钥解析器
│   ├── vdf-generator.js          # VDF 配置生成
│   ├── zip-packager.js           # ZIP 打包
│   └── zip-handler.js            # ZIP 格式解析
└── .github/workflows/
    ├── deploy.yml                # Pages 部署
    └── steam-downloader.yml      # Steam 下载引擎
```

## 🔧 技术栈

- Vanilla JavaScript ES6+ — 零框架
- GitHub Actions — 服务端下载
- GitHub API — 后端通道 + Gist 数据库
- jsDelivr CDN — 全球加速
- JSZip — 浏览器 ZIP 处理

## ⚠️ 注意

- GitHub API 未认证: 60次/小时 → 绑 Token: 5000次/小时
- CORS 代理在中国大陆可能不可用, 建议用 GitHub 模式
- 实际游戏下载需配合 DepotDownloader

## 📄 许可

仅供学习研究使用