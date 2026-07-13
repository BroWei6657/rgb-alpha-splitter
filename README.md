# RGB Alpha Splitter

[中文](#中文说明) | [English](#english)

当前版本 / Current version: **1.2.0**

`package.json` 是唯一版本来源；打包前使用 `npm run check:version` 校验锁文件和更新日志。
`package.json` is the single version source; run `npm run check:version` before packaging.

## 中文说明

### 许可证与 NDI 要求

项目源码采用 [MIT License](LICENSE)。NDI SDK、NDI Runtime 和 NDI 商标受 Vizrt
单独条款约束，不包含在本仓库中。详见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### v1.2.0 重点功能

- 工程日志优先写入安装目录 `logs/`，无权限时回退到用户应用数据目录。
- 控制界面支持跟随系统、浅色和深色主题，可隐藏诊断区并适配窄屏窗口。
- NDI 稳定模式使用 FrameSync，低延迟模式保留 latest-frame 直接接收。
- Windows 使用 RGB 优先、Alpha 后备的 DXGI 显示时钟并提供双路时序诊断。
- 手动裁切支持八方向拖拽和实时源像素尺寸显示。
- 性能验收基于帧率、帧时间、丢帧和资源占用，不绑定指定硬件型号。

这是一个面向正式桌面软件的 Full NDI / MOV / 测试源输入工程雏形，用于把输入画面实时拆分成 RGB 与 Alpha 两路，并支持预览、独立窗口和拓展屏全屏输出。

## 当前已实现

- 测试源输入：用于排查渲染、Alpha 拆分、输出窗口和全屏投屏链路。
- MOV / 视频 / 图片输入：通过本地文件选择载入，MOV 解码能力取决于系统和 Chromium 支持的编码。
- URL 模式：通过隔离的离屏浏览器载入 HTTP/HTTPS 网页、图片或浏览器可播放的视频，并把页面透明度拆分为 RGB 与 Alpha。
- 输入所有权：NDI、URL、本地媒体和测试图使用 generation token，过期输入不能覆盖当前信号。
- 广播 SDR 管理：Rec.709/Rec.2020、Full/Limited、Gamma 2.4、HD/UHD 常用帧率与 1080i 场序预设。
- Windows GPU 优先：D3D11共享纹理、原生RGB/Alpha子窗口和最新帧呈现线程；失败时自动恢复WebGL兼容输出。
- 输出节拍：本地媒体按所选有理数帧率发布，D3D调度器按绝对截止时间Present；源帧不足时重复最后一帧，过快时仅保留最新帧。
- 自动输入识别：读取NDI FourCC、分辨率、帧率、场类型与XML metadata，支持按输入源手动锁定色域和范围。
- 独立输出控制：分辨率、帧率、扫描方式和显示模式分开设置，支持留黑、裁满、拉伸和手动裁切。
- URL制作工具：自然尺寸/自定义viewport、预览框选裁切、冻结提示和仅由用户触发的页面刷新。
- 安全 URL Session：默认禁止 localhost 和私有网段；需要局域网页面时必须显式开启“允许访问局域网 URL”。
- RGB / Alpha 拆分：每帧拆为 RGB 输出预览与 Alpha 灰度预览。
- Alpha 调整：支持 Alpha 增益和 Alpha 反相。
- 输出窗口：RGB 与 Alpha 可分别打开独立窗口，拖到拓展屏后全屏。
- 诊断信息：运行状态、FPS、帧时间、输入源、分辨率和事件日志。
- NDI Bridge 接口：Electron `main.js` / `preload.js` 已预留 NDI 源搜索、连接和断开接口。

## NDI 接入状态

浏览器页面不能直接搜索或接收局域网 NDI 源，因为 NDI 需要本机 SDK / DLL 调用能力。Electron 桌面版已接入 NDI 6 原生模块：

```text
renderer UI
  -> window.ndiBridge
  -> preload.js
  -> main.js ipcMain
  -> native/ndi-node.node
  -> NDI SDK / NDI Runtime
```

正式输出采用独立的数据通路：

```text
NDI SDK receiver thread
  -> Windows named shared-memory double buffer
  -> RGB output renderer -> WebGL RGB shader
  -> Alpha output renderer -> WebGL Alpha shader
```

控制窗口不再向输出窗口复制 Canvas。两个输出由 Main 创建为独立
`BrowserWindow`，各自通过 `output-preload.js` 直接读取共享帧。控制窗口重载、
最小化或 Renderer 恢复时，输出数据通路不受影响。

测试图、图片和本地视频由控制 Renderer 解码/绘制，并在输出开启时以最高约
30 fps 发布到同一共享双缓冲；控制预览降至约 15 fps。NDI 正式输入仍由 C++
接收线程直接发布，不经过这条 IPC 兼容路径。

当前实现可以搜索局域网 NDI 源、连接指定源、在独立线程接收 BGRA/BGRX
视频帧，并将最新 RGBA 帧送入 WebGL RGB/Alpha 拆分与输出管线。接收端只
保留最新帧，不会因 UI 短暂卡顿积累延迟。

源为 BGRA 时界面显示“含 Alpha”；源为 BGRX 时显示“无 Alpha”，Alpha
输出为白色。这通常意味着上游没有启用带透明通道的 Full NDI 输出。

## 文件结构

```text
index.html                 UI 入口
styles.css                 桌面控制台样式
src/app.js                 输入、拆分、预览、输出、诊断逻辑
src/ndi-bridge-client.js   Renderer 侧 NDI Bridge 客户端
main.js                    Electron 主进程和 NDI IPC 接口
preload.js                 安全暴露 window.ndiBridge
native/README.md           NDI 原生模块接口说明
package.json               Electron 工程脚本
```

## 运行方式

### 免安装预览

直接双击 `index.html`，可以使用测试源和本地 MOV / 视频 / 图片输入。

### 本地静态服务

```bash
npm run serve
```

然后打开：

```text
http://127.0.0.1:4173/
```

### Electron 桌面模式

需要先安装依赖：

```bash
npm install
npm run build:native
npm run check:version
npm run smoke
npm start
```

`npm run smoke` 会用隐藏 Electron 窗口检查 NDI Runtime、preload、显示器枚举和
WebGL、独立输出和 URL 离屏 RGBA 发布，输出 `SMOKE_RESULT` 后自动退出。运行冒烟测试前请先关闭正式程序。

### macOS 开发与打包

支持 macOS 11 及以上系统，包含 Intel `x64` 和 Apple Silicon `arm64` 两条构建
路径。需要先安装：

- NDI SDK for Apple，默认路径 `/Library/NDI SDK for Apple`；
- NDI Runtime 或包含 `libndi.dylib` 的 NDI Tools；
- Xcode Command Line Tools；
- Node.js 和 npm。

如果 SDK 安装在其他位置，请先设置：

```bash
export NDI_SDK_DIR="/your/path/to/NDI SDK for Apple"
```

然后执行：

```bash
npm install
npm run build:native:mac
npm run check
npm run smoke
npm run dist:mac
```

DMG 和 ZIP 输出到 `release/`，文件名包含当前架构。`dist:mac` 必须在对应架构
的 Mac 上运行；macOS 原生模块和 DMG 不能在 Windows 上交叉生成。向其他用户
公开分发前，还应配置 Apple Developer ID、Hardened Runtime 和 notarization。

macOS 构建声明了本地网络用途与 NDI Bonjour 服务，首次搜索 NDI 源时系统会请求
“本地网络”权限，需要允许该权限。

当前 `package.json` 已声明 Electron。网络受限或未安装依赖时，`npm start` 不会可用。

## 实现说明与性能边界

- v1.1.2 Windows构建通过DXGI优先选择高性能GPU，也可以改为系统自动或指定适配器。
- NDI的RGBA/BGRA、UYVY/UYVA、NV12、I420/YV12和P216/PA16均保留原始平面并直接上传GPU；
  CPU RGBA转换只用于兼容输出和控制预览。
- 独立输出开启后默认使用约854x480、15fps轻量预览，也可以选择完整预览或暂停预览。
- GPU状态显示适配器、队列、覆盖帧、上传/渲染/Present耗时、P95帧时间和设备移除原因。
- URL通过Electron shared texture导入；GPU输出窗口使用sandbox和不加载原生模块的最小preload。
- P216/PA16使用R16/R16G16纹理保持高精度YUV与Alpha；Alpha增益和反相在GPU shader中处理。
- RGB 色彩转换在 GPU shader 中完成，Alpha 不参与色域、Gamma 或范围变换。
- 1080i GPU输出在逐行显示器上采用前后帧运动判断与Bob/Weave组合；
  普通显卡窗口不等同于具备 genlock 的物理隔行 SDI 输出。
- macOS保持相同UI、IPC、输入、色彩和预览功能，继续使用`compatibility`共享内存/WebGL后端；
  Intel与Apple Silicon构建和运行仍需在Mac实机验证，本版本不声明Metal支持。

- C++ 接收线程向 NDI SDK 请求最佳质量格式，并把原始打包或平面数据提交给D3D11；
  JavaScript不参与GPU输出的逐像素换序或拆分。
- 最新帧写入 Windows 命名共享内存双缓冲，写端用原子序号发布，读端在复制前后
  校验序号，避免撕裂帧。共享区最大支持 4096 x 2160 RGBA。
- RGB 和 Alpha 使用两个独立 Renderer，直接把共享内存帧上传到各自 WebGL
  纹理；输出帧不再经过 Main-to-Renderer 整帧 IPC 或控制页 Canvas 拷贝。
- 任一输出打开后，控制页 NDI 监看自动降至约 15 fps，正式输出仍按源帧/显示器
  刷新率运行，降低非高配电脑的监看开销。
- RGB/Alpha 拆分由 WebGL fragment shader 完成，可随 NDI 源动态分辨率工作。
- NDI 模式只在收到新帧时上传纹理和刷新 RGB/Alpha 输出；静态图片只渲染
  一次，文件视频只在播放时间变化时渲染。
- Electron 已关闭渲染器后台节流、后台计时器节流和遮挡窗口节流。主控制窗口
  最小化或被其他窗口遮挡时，NDI 接收和两个输出窗口仍持续刷新。
- 正式输出不依赖 `requestAnimationFrame`：两个独立输出使用固定共享帧轮询，
  控制 Renderer 由 Electron Main 发送带 ACK 的帧时钟，最小化时不会被 Chromium
  降低 rAF 频率，也不会积压时钟消息。
- 应用使用 `prevent-app-suspension`、禁用 Windows 原生窗口遮挡计算，并把主进程
  优先级提高到 Above Normal。诊断区会显示 RGB/Alpha 两路实际输出 FPS。
- 顶部 FPS 明确标记为“预览”，输出开启后控制预览会主动降帧；正式输出帧率请
  以诊断区的 `RGB FPS` / `Alpha FPS` 为准。
- 每个进程使用独立的系统临时 Chromium 磁盘缓存，并禁用 GPU shader 磁盘缓存，
  避免重复启动或异常缓存 ACL 导致 `Unable to create cache` 错误。Local Storage
  仍保留在用户数据目录，显示器和 Alpha 设置不会丢失。
- 原生诊断提供 NDI 连接数、接收帧、SDK 丢弃帧、队列深度和最后帧年龄。
- 连续 2 秒无视频帧时界面进入断流报警；启用“断流自动重连”后，连续 5 秒
  无帧会重建接收器，并以 10 秒为重试冷却时间。重连期间保持最后一帧输出。
- RGB 与 Alpha 可以分别绑定到指定显示器，并记住显示器选择和自动全屏设置。
- 应用使用单实例保护；主渲染进程异常退出时，一分钟内最多自动恢复三次，
  避免无限崩溃循环。
- Windows GPU输出由原生D3D11子窗口直接呈现，不再从共享区复制到JavaScript；
  共享内存仅保留给控制预览、macOS和Windows兼容后端。
- 两个显卡桌面输出窗口共享同一源帧，但普通扩展屏不提供 SDI Fill/Key 所需的
  genlock。需要广播级严格同步时仍应使用专业输出硬件。

## vMix 联调检查

1. 在 vMix 中启用带 Alpha 的 NDI 输出，并确认字幕输入本身包含透明通道。
2. 本机防火墙允许 vMix 与本程序进行 NDI 网络通信，网络配置文件保持一致。
3. 启动本程序后刷新 NDI 源，选择 vMix 对应输出并连接。
4. 输入信息应显示实际分辨率、帧率和“含 Alpha”。若显示“无 Alpha”，问题在
   上游信号格式，不应通过 Alpha 增益补偿。
5. 在“全屏输出”中分别选择 RGB 与 Alpha 所在显示器，再打开输出窗口；选择
   “打开后自动全屏”时，窗口会直接移动到对应显示器并进入全屏。
6. 可临时停止 vMix NDI 输出测试看门狗：2 秒后应报警，5 秒后应开始自动重连，
   输出保持最后一帧，源恢复后状态回到“NDI 正常”。

## 使用注意

- MOV 文件如果无法播放，通常是编码不被 Chromium 支持，不是输入逻辑错误。
- NDI 源有 Alpha 的前提是上游确实输出带 Alpha 的格式；否则 Alpha 预览会接近全白或全黑。
- 正式演出建议使用固定分辨率和帧率，并将拆分逻辑迁移到 GPU shader。

## English

### Overview

RGB Alpha Splitter is an Electron desktop application that receives Full NDI,
URL, local media, or test-pattern input and produces independent RGB and Alpha
outputs. It supports control previews, standalone windows, and fullscreen output
on extended displays.

### Features

- Full NDI discovery and reception with RGBA/BGRA, UYVY/UYVA, NV12, I420/YV12,
  P216, and PA16 GPU upload paths.
- URL input through an isolated offscreen browser with transparent backgrounds,
  viewport control, freeze detection, manual refresh, and normalized cropping.
- Local video, image, and generated test-pattern input.
- Rec.709/Rec.2020 SDR, Full/Limited range conversion, fractional frame rates,
  and 1080i TFF/BFF handling.
- Windows D3D11 GPU-first RGB/Alpha presentation with automatic compatibility
  fallback.
- NDI FrameSync stable mode and latest-frame low-latency mode.
- Independent output resolution, frame rate, scan, scaling, crop, display, and
  fullscreen controls.
- System, light, and dark themes, responsive layouts, hideable diagnostics, and
  bounded engineering logs.

### Requirements

- Windows 10/11 x64 for the validated D3D11 path.
- NDI Runtime for receiving NDI sources.
- Node.js and npm for source builds.
- NDI 6 SDK and Visual Studio 2022 Build Tools with Desktop C++ for rebuilding
  the Windows native module.

macOS 11 or later is represented by compatibility interfaces and build scripts.
Intel and Apple Silicon runtime validation remains pending.

### Development

```powershell
npm install
npm run build:native
npm run check:version
npm run check
npm run smoke
npm start
```

For macOS, install the NDI SDK for Apple and Xcode Command Line Tools, then run:

```bash
npm install
npm run build:native:mac
npm run check
npm run smoke
npm run dist:mac
```

### Architecture

```text
NDI / URL / local media / test pattern
  -> native receiver or isolated Chromium source
  -> D3D11 GPU presenter on Windows
  -> shared RGB source texture
  -> RGB output + Alpha output
  -> shared-memory/WebGL compatibility fallback
```

The output windows do not depend on the control window's animation frame rate.
Minimizing or occluding the control window must not pause native output.

### Limitations

- Ordinary GPU display outputs do not provide hardware genlock, scanline
  synchronization, or physical SDI Fill/Key synchronization.
- Validated 2160p60 operation is not claimed.
- macOS Metal output and long-duration Intel/Apple Silicon validation remain
  future work.
- Media codec support depends on Chromium and the operating system.

### License

Project source is licensed under the [MIT License](LICENSE). NDI components and
trademarks remain subject to Vizrt's separate terms. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
