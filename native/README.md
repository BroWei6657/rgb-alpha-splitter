# RGB Alpha Splitter Native Bridge

[中文](#中文说明) | [English](#english)

## 中文说明

原生桥接模块负责 NDI 源发现、连接、帧接收、多格式 GPU 上传、共享内存兼容输出、
FrameSync 和 D3D11 呈现控制。编译产物位于：

```text
native/ndi-node.node
```

支持的 NDI 格式包括 RGBA/RGBX、BGRA/BGRX、UYVY/UYVA、P216/PA16、NV12、
I420 和 YV12。Windows 使用 D3D11 原生子窗口和双缓冲上传资源；macOS 保留相同
接口结构并使用共享内存/WebGL兼容后端。

Windows 构建要求 NDI 6 SDK、NDI 6 Runtime、Visual Studio 2022 Desktop C++
Build Tools 和匹配Electron版本的x64头文件：

```powershell
npm run build:native
```

macOS 需要 NDI SDK for Apple 和 Xcode Command Line Tools：

```bash
npm run build:native:mac
```

NDI SDK、Runtime和商标不受本项目MIT许可证授权，详见根目录
`THIRD_PARTY_NOTICES.md`。

## English

The UI is ready to consume an Electron preload bridge named `window.ndiBridge`.

Native addon location:

```text
native/ndi-node.node
```

JavaScript API exported by the addon:

```js
findSources(): Promise<Array<{ id: string, name: string }>>
connect(sourceId: string): Promise<{ id: string, name: string }>
disconnect(): Promise<boolean>
getFrame(afterSequence: bigint): null | {
  width: number,
  height: number,
  frameRateN: number,
  frameRateD: number,
  sequence: bigint,
  hasAlpha: boolean,
  data: Buffer // RGBA
}
getSharedFrame(afterSequence: bigint): null | Frame
publishFrame(data: Buffer, width: number, height: number, hasAlpha: boolean,
             frameRateN?: number, frameRateD?: number): boolean
```

`ndi_addon.cpp` publishes the newest RGBA/RGBX frame to a named Windows shared-memory
double buffer. Readers validate the sequence before and after copying, so they never
consume a buffer while the receiver is replacing it. RGB and Alpha output renderers
load the addon directly and do not route frames through Electron IPC.

The mapping supports frames up to 4096 x 2160 RGBA and allocates two frame slots.
Shared publication is serialized so delayed local IPC and NDI source transitions cannot
write the same slot concurrently. `publishFrame` detects effective alpha in native code.

`findSources()` returns a Promise and performs the 750 ms NDI discovery wait on a N-API
worker so Electron Main remains responsive.

`getEngineCapabilities()` reports the compiled presentation backend. Version 1.2.0 uses a
high-performance DXGI adapter by default, Electron child-window flip swap chains, a bounded
latest-frame queue, shared-texture import, recovery metadata and detailed timing metrics.
macOS exposes the same status shape and keeps the shared-memory compatibility backend.

Quality-first NDI capture accepts RGBA/RGBX, BGRA/BGRX, UYVY/UYVA, P216/PA16, NV12,
I420 and YV12. Every listed format has a direct planar or packed D3D11 upload path.
P216/PA16 use R16/R16G16 textures to preserve source precision; 8-bit RGBA conversion
is retained only for the throttled control preview and compatibility output.
Windows uses `CreateFileMapping`; macOS uses a POSIX `shm_open`/`mmap` mapping with
the same header and sequence-validation protocol.
NDI capture publishes directly from C++; local test/image/video inputs use `publishFrame`
through Electron IPC because their decoded pixels originate in Chromium.

Build from the repository root:

```powershell
npm run build:native
```

Requirements: NDI 6 SDK in `C:\Program Files\NDI\NDI 6 SDK`, NDI 6 Runtime,
Visual Studio 2022 Build Tools with Desktop C++, and x64 Electron headers. The build
script downloads and caches the matching Electron headers under `.electron-gyp`.

On macOS, install NDI SDK for Apple under `/Library/NDI SDK for Apple` (or set
`NDI_SDK_DIR`), install Xcode Command Line Tools, and run:

```bash
npm run build:native:mac
```

The script builds for the current `arm64` or `x64` Mac architecture.
