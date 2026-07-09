# DD Game Box Web 版实现计划

## 目标
创建 GitHub Pages 公网网页，替代地道游戏盒 V14，支持：
- 拖入/浏览上传 Lua/SteamCMD 脚本
- 网页端自动解析游戏配置
- 多 API 容错获取 Manifest 数据（带进度条）
- 一键下载生成 config.vdf + manifest 包
- 完整替代原有桌面工具盒

## 架构设计
- 纯前端静态页面（HTML + CSS + JS）
- 通过 CORS 代理访问 Steam API
- 浏览器端 Lua 解析 + VDF 生成
- 使用 JSZip 打包下载
- GitHub Actions 自动部署到 Pages

## 技术栈
- HTML5 + CSS3 (深色主题)
- Vanilla JavaScript (无框架依赖)
- CORS 代理: api.allorigins.win / corsproxy.io
- JSZip: 客户端打包下载
- Showdown: API 请求包装

## 实现步骤

### Step 1: 创建仓库结构
- index.html (主入口)
- css/style.css (样式)
- js/lua-parser.js (Lua 解析)
- js/api-client.js (API 客户端)
- js/vdf-generator.js (VDF 生成)
- js/zip-packager.js (ZIP 打包)
- js/app.js (主逻辑)
- README.md

### Step 2: Lua 解析器
- 提取主游戏 APPID
- 提取 addappid 条目
- 提取加密密钥 SHA
- 提取 tokens

### Step 3: API 客户端
- 多源 manifest 获取
- CORS 代理包装
- 进度回调
- 错误重试

### Step 4: VDF 生成器
- 生成 config.vdf 内容
- 文件预览

### Step 5: ZIP 打包
- 汇总 manifests + config.vdf
- 浏览器下载

### Step 6: UI 界面
- 文件拖放区
- 解析结果显示
- 进度条动画
- 下载按钮
