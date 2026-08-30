## 项目概述

X行动（原「潮汐监狱 Tide Prison Ops」）——一款参照《三角洲行动》烽火地带玩法的第一人称战术撤离网页游戏。玩家渗透废弃监狱/大坝等地图，搜索物资、击退武装看守 AI、抵达撤离点完成撤离。含地图选择界面（潮汐监狱 / 零号大坝）、加密保险箱、后坐力等机制。

## 技术栈

- **渲染引擎**：Three.js (v0.169)
- **构建工具**：Vite (v5)
- **语言**：JavaScript (ES Modules)
- **包管理器**：pnpm
- **音效**：WebAudio API 合成
- **样式**：内联 CSS（index.html）

## 目录结构

```
/workspace/projects/
├── .coze              # 项目配置（平台入口）
├── .preview           # 预览端口声明
├── index.html         # 主入口（含内联样式和 canvas）
├── package.json
├── vite.config.js     # Vite 配置（base: './', server host: true）
├── scripts/
│   ├── build.sh       # 预览 build 脚本（安装依赖）
│   └── run.sh         # 预览 run 脚本（启动 vite dev server）
└── src/
    ├── main.js        # 主循环、玩家物理、命中判定、撤离流程、地图选择
    ├── world.js       # 地图生成（潮汐监狱/零号大坝）+ 碰撞与射线
    ├── textures.js    # 程序化照片风纹理（低成本画面升级）
    ├── controls.js    # PC 键鼠 + 平板触屏双摇杆
    ├── weapons.js     # 枪模、射击、换弹、曳光
    ├── enemies.js     # 武装看守 AI（巡逻/交战状态机）
    ├── loot.js        # 物资箱与撤离点
    ├── hud.js         # HUD、小地图（旋转式，含敌人/物资/撤离标记）
    └── audio.js       # WebAudio 合成音效（枪声/脚步/拾取/环境海风）
```

## 关键入口 / 核心模块

- **入口**：`index.html` → `src/main.js`
- **地图**：`src/world.js`（程序化生成监狱地图 + 碰撞检测）
- **AI**：`src/enemies.js`（巡逻/察觉/交战状态机，10 名武装看守）
- **操作**：`src/controls.js`（PC 键鼠 + 平板触屏双模式）
- **武器**：`src/weapons.js`（第一人称枪模、射击、换弹、曳光弹）

## 运行与预览

- **预览**：`bash scripts/run.sh` 启动 Vite dev server，端口从 `.preview` 读取（默认 5000）
- **构建**：`pnpm run build` → 产物输出到 `dist/`
- **项目类型**：web（纯前端 SPA，无后端）
- **部署**：`scripts/deploy_build.sh`（安装依赖 + vite build）→ `scripts/deploy_run.sh`（`node scripts/serve_dist.js` 零依赖静态服务器承载 dist/，监听 0.0.0.0:5000）

## 用户偏好与长期约束

- 包管理器强制使用 pnpm
- 纯前端项目，无服务端依赖

## 常见问题和预防

- 部署环境禁止在 run 脚本里用 `npx serve` 等需要临时下载包的命令：FaaS 启动超时仅 30 秒，临时安装会触发 `function start timed out`；必须保证 run 阶段零安装、启动即监听 0.0.0.0:5000（已改用内置模块实现的 `scripts/serve_dist.js`）
- Vite dev server 必须绑定 `0.0.0.0`，不能绑定 `127.0.0.1`
- 端口从 `.preview` 文件的 `expose_port` 读取，不 hardcode
- Three.js 场景较重，构建 chunkSizeWarningLimit 已设为 1200KB
