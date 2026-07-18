# RGB Alpha Splitter 原生桥接 / Native Bridge

[中文](#中文说明) | [English](#english)

## 中文说明

### 职责与平台

原生桥接负责NDI源发现、连接、帧接收、FrameSync、多格式GPU上传、共享内存兼容输出和
D3D11呈现控制。Windows使用D3D11原生输出和共享内存回退；macOS保持相同公共接口，当前
使用共享内存/WebGL兼容后端。

当前接收格式包括RGBA/RGBX、BGRA/BGRX、UYVY/UYVA、P216/PA16、NV12、I420和YV12。
P216/PA16在GPU路径中保留16位平面；控制预览和兼容输出按需转换为8位RGBA。

编译产物位于：

```text
native/ndi-node.node
```

### JavaScript接口

```js
findSources(): Promise<Array<{ id: string, name: string }>>
connect(sourceId: string): { id: string, name: string }
disconnect(): boolean
getStatus(): ReceiverStatus
getFrame(afterSequence: bigint): Frame | null
getSharedFrame(afterSequence: bigint): Frame | null
publishFrame(data, width, height, hasAlpha, frameRateN?, frameRateD?): boolean
publishBgraFrame(data, width, height, frameRateN?, frameRateD?): boolean
getEngineCapabilities(): EngineCapabilities
configureGpuPresenter(config): boolean
configureSync({ mode, frameRateN, frameRateD }): boolean
getGpuPresenterStatus(): PresenterStatus
```

兼容帧最大支持4096 x 2160 RGBA双槽映射。读取端在复制前后校验序列号，避免读取正在替换的
帧。NDI捕获线程直接发布到原生管线；本地测试图、图片和视频通过Electron IPC提交，因为其
解码像素来自Chromium。

`findSources()`在N-API工作线程执行NDI发现等待，避免阻塞Electron主进程。稳定同步模式使用
NDI FrameSync；低延迟模式使用最新帧策略。两个模式改善的是帧级节奏，不等同于硬件genlock。

### Windows构建

要求：

- Windows x64；
- NDI 6 SDK和兼容的NDI Runtime；
- Visual Studio 2022 Build Tools及“使用C++的桌面开发”；
- Node.js与npm。

默认SDK路径为`C:\Program Files\NDI\NDI 6 SDK`，也可设置`NDI_SDK_DIR`。构建脚本使用项目内
`.electron-gyp`缓存匹配Electron版本的头文件。

```powershell
npm install
npm run build:native
```

### macOS构建

要求NDI SDK for Apple、Xcode Command Line Tools、Node.js与npm。SDK默认位于
`/Library/NDI SDK for Apple`，也可设置`NDI_SDK_DIR`。

```bash
npm install
npm run build:native:mac
```

脚本为当前`x64`或`arm64`架构构建。Intel与Apple Silicon仍需分别进行实机运行和长时间验证。

NDI SDK、Runtime和相关商标不受本项目MIT许可证授权，详见
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## English

### Responsibilities and platforms

The native bridge handles NDI discovery, connection, capture, FrameSync, multi-format GPU
upload, shared-memory compatibility output, and D3D11 presentation control. Windows uses
native D3D11 output with a shared-memory fallback. macOS exposes the same public interface
and currently uses the shared-memory/WebGL compatibility backend.

Accepted receive formats include RGBA/RGBX, BGRA/BGRX, UYVY/UYVA, P216/PA16, NV12, I420,
and YV12. P216/PA16 retain 16-bit planes on the GPU path; the control preview and
compatibility output convert to 8-bit RGBA only when required.

The compiled addon is located at:

```text
native/ndi-node.node
```

### JavaScript API

```js
findSources(): Promise<Array<{ id: string, name: string }>>
connect(sourceId: string): { id: string, name: string }
disconnect(): boolean
getStatus(): ReceiverStatus
getFrame(afterSequence: bigint): Frame | null
getSharedFrame(afterSequence: bigint): Frame | null
publishFrame(data, width, height, hasAlpha, frameRateN?, frameRateD?): boolean
publishBgraFrame(data, width, height, frameRateN?, frameRateD?): boolean
getEngineCapabilities(): EngineCapabilities
configureGpuPresenter(config): boolean
configureSync({ mode, frameRateN, frameRateD }): boolean
getGpuPresenterStatus(): PresenterStatus
```

Compatibility frames use a double-slot RGBA mapping up to 4096 x 2160. Readers validate
the sequence before and after copying so they do not consume a slot while it is being
replaced. The NDI capture thread publishes directly to the native pipeline. Local test,
image, and video inputs arrive through Electron IPC because Chromium owns their decoded
pixels.

`findSources()` performs its NDI discovery wait on a N-API worker instead of blocking the
Electron main process. Stable mode uses NDI FrameSync; Low Latency uses the latest frame.
These modes improve frame cadence and do not provide hardware genlock.

### Windows build

Requirements:

- Windows x64;
- NDI 6 SDK and a compatible NDI Runtime;
- Visual Studio 2022 Build Tools with Desktop development with C++;
- Node.js and npm.

The default SDK path is `C:\Program Files\NDI\NDI 6 SDK`; `NDI_SDK_DIR` can override it.
The build script uses the project-local `.electron-gyp` cache for Electron headers.

```powershell
npm install
npm run build:native
```

### macOS build

Install the NDI SDK for Apple, Xcode Command Line Tools, Node.js, and npm. The default SDK
path is `/Library/NDI SDK for Apple`; `NDI_SDK_DIR` can override it.

```bash
npm install
npm run build:native:mac
```

The script builds for the current `x64` or `arm64` architecture. Intel and Apple Silicon
still require separate runtime and long-duration validation.

The NDI SDK, Runtime, and related trademarks are not covered by this project's MIT license.
See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
