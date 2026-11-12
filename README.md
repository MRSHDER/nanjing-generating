# 南京，正在生成

《南京，正在生成》程序化短片的源码快照。画面使用 TypeScript、Three.js / WebGL 与 Canvas 2D，配乐由 JavaScript 程序合成。

**在线浏览：[南京，正在生成](https://mrshder.github.io/nanjing-generating/)**

90 秒程序化短片，包含程序合成配乐。请使用支持 WebGL 的现代浏览器，打开后点击“播放”。

## 本地运行

建议使用 Node.js 20 LTS 或更新的兼容版本。

```sh
npm ci
npm run music
npm run dev
```

打开终端显示的本地 Vite 地址。`npm run music` 生成 `out/music/score.wav`；仓库不包含已生成的音频，未生成时播放器没有对应配乐。

```sh
npm run typecheck
npm run build
```

`npm run build` 会生成配乐、构建页面，并将 `out/music/score.wav` 复制到发布目录。构建使用相对资源路径，适配 GitHub Pages 的项目子路径。

## 在线部署

推送到 `main` 分支后，GitHub Actions 会进行类型检查、构建和 GitHub Pages 发布。仓库 Settings → Pages → Source 应设为 GitHub Actions。本站使用默认 GitHub Pages 地址，无需配置自定义域名。

构建和部署成功不代表完整影片导出或所有视觉检查均通过。播放需要浏览器支持 WebGL。

## 目录

- `src/`：三维场景、二维叠加、字幕、合成和播放器。
- `music/`：配乐与合成器源码、节拍事件和结构数据。
- `scripts/`：渲染、导出及历史检查脚本。

浏览器自动化使用 `playwright-core`，相关脚本需要本机 Chrome 或通过 `CHROME_PATH` 指定可用浏览器；视频导出另需 FFmpeg。部分历史检查依赖原项目的参考截图、已导出视频或 `out/preview/index.html`，这些输入未发布，不能在本快照上直接完整复现。`check-single-backdrops.mjs`、`check-wutong-tunnel.mjs` 等涉及参考素材；请自行提供有权使用的输入，不要把缺失输入当作测试通过。

## 发布范围与权利

此仓库仅包含独立整理的源码快照，不包含原 Git 历史、参考图、外部参考 ZIP、成片、预览媒体、参赛或申诉资料、内部过程文档、凭据、依赖安装目录及无关工程。原工程未被改写。

第三方依赖通过 npm 安装，适用各自许可证。字体依赖为 Inter 与 Noto Sans SC（SIL Open Font License），其他依赖的许可证请见其包内许可文件。本次发布未额外授予本项目源码的开源许可；公开可查看不等于可以任意再分发。


## 本次检查

- 锁定依赖安装及 TypeScript 类型检查通过。
- 默认 `vite build` 因源码使用顶层 await、默认浏览器目标较旧而失败；请使用上述 `--target esnext` 构建命令及现代浏览器。
- 未执行全部历史视觉回归或最终 MP4 导出。
- `vite build --target esnext` 构建通过（有 bundle 大小提示）；程序配乐成功生成 90 秒音频，该生成文件不入库。
