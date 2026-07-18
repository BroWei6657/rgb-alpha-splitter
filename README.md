# RGB Alpha Splitter

[中文](#中文说明) | [English](#english)

当前版本：**1.3.0**
Current version: **1.3.0**

## 中文说明

### 项目简介

RGB Alpha Splitter 是一款面向实时视频制作的桌面工具，可接收 Full NDI、URL、
本地视频/图片或测试图，将输入画面拆分为 RGB（Fill）和 Alpha（Key）两路画面，
并通过独立窗口或扩展显示器全屏输出。

本程序输出的是普通显卡桌面窗口，适合软件监看、转播制作和没有专业Fill/Key硬件
时的工作流程。它不能替代带genlock的SDI输出卡或硬件级Fill/Key同步设备。

### 下载与首次运行

当前主要验证平台为Windows 10/11 x64。请从
[GitHub Releases](https://github.com/BroWei6657/rgb-alpha-splitter/releases)
下载最新安装包。

1. 下载 `RGB-Alpha-Splitter-Setup-1.3.0.exe`。
2. 使用Release页面提供的 `SHA256SUMS.txt` 校验安装包。
3. 运行安装程序并选择安装目录。
4. 如果要使用NDI模式，请先安装兼容的 **NDI Runtime**，然后重新启动本程序。
5. 第一次搜索NDI源时，允许Windows防火墙中的专用网络访问。

当前Windows安装包未进行数字签名，因此Windows可能显示SmartScreen提示。请只从本项目
GitHub Release下载，并在运行前核对SHA-256。

> **NDI Runtime与NDI SDK不同：**普通用户只需要NDI Runtime。只有从源码重新编译
> 原生模块的开发者才需要NDI SDK、Visual Studio和Node.js。

未安装NDI Runtime时，程序仍可启动，URL、本地媒体和测试图模式仍可使用；NDI源搜索、
连接和接收不可用。只需接收NDI信号时，建议直接安装对应系统的Runtime：

- [Windows版NDI Runtime v6官方下载](https://ndi.link/NDIRedistV6)
- [macOS版NDI Runtime v6官方下载](https://ndi.link/NDIRedistV6Apple)
- [NDI Tools官方下载说明页](https://ndi.video/tools/)（可选，包含其他NDI工具）
- [DistroAV的NDI Runtime安装说明](https://github.com/DistroAV/DistroAV/wiki/1.-Installation#required---ndi-runtime)（第三方参考）

安装完成后请重新启动RGB Alpha Splitter。本项目不捆绑或再分发NDI Runtime、NDI Tools或SDK。

### NDI使用前检查

- 发送端与本机应处于可互通的局域网，Windows网络配置文件建议设为“专用”。
- 防火墙需要允许发送端程序、NDI Runtime及RGB Alpha Splitter进行局域网通信。
- vMix或其他发送端必须实际输出包含Alpha的Full NDI信号；普通NDI视频通常不含Alpha。
- 连接后检查界面显示的分辨率、帧率、像素格式和“含Alpha/无Alpha”状态。
- 自动识别的色域或范围不正确时，可手动调整，并可使用“恢复自动识别”。
- 稳定同步模式用于改善输出节奏；低延迟模式使用最新帧策略。两者都不等同于硬件genlock。

### 主要功能

- **输入模式：**Full NDI、HTTP/HTTPS URL、本地视频/图片和测试图。
- **通道拆分：**RGB输出与Alpha灰度输出，支持Alpha增益和反相。
- **Windows GPU优先：**D3D11原生双输出，失败时自动切换兼容后端。
- **信号与色彩：**Rec.709/Rec.2020 SDR、Full/Limited、常用HD/UHD分辨率、
  分数帧率和1080i TFF/BFF输入处理。
- **画面适配：**完整显示留黑、居中裁满、拉伸和八方向手动裁切。
- **URL工具：**自然尺寸/自定义viewport、透明背景、冻结提示和手动刷新。
- **独立输出：**RGB与Alpha窗口可分别选择显示器并全屏，主窗口最小化不应暂停输出。
- **控制预览：**轻量、完整和暂停三档；独立输出开启后默认优先保证输出性能。
- **诊断：**可多选的60秒并行趋势图、实际输出FPS、帧时间、队列、GPU、时钟、连接状态和事件日志。
- **界面：**独立的输入、信号、输出和诊断页签，支持简体中文/English切换、跟随系统/浅色/深色主题及窄屏布局。
- **透明预览：**可切换低对比中性灰棋盘，便于检查输入Alpha而不影响输出。

### 界面语言与TXT语言包

语言选择位于主界面顶部，支持“跟随系统”“简体中文”和“English”，选择会自动保存。
安装版的语言文件位于：

```text
<安装目录>\resources\locales\
  languages.txt
  zh-CN.txt
  en-US.txt
```

开发版使用项目根目录下的 `locales/`。`languages.txt` 按以下格式登记语言：

```text
zh-CN=简体中文|zh-CN.txt
en-US=English|en-US.txt
```

各语言TXT使用 `键=显示文字` 格式。新增语言时，先复制一份现有语言文件并翻译等号右侧，
保留完整且一致的键集合，再在 `languages.txt` 中登记。语言文件使用UTF-8编码；修改后需
重新启动程序。安装目录可能需要管理员写入权限，升级安装也可能覆盖自定义语言文件，因此
修改前应另行备份。无效文件名、重复键、缺失键或超出大小限制的语言包会被拒绝加载。

### 快速使用

1. 启动程序，选择“NDI模式”或“URL模式”；也可以载入本地文件或启动测试源。
2. NDI模式下刷新源列表、选择发送端并连接；URL模式下输入地址并点击“载入URL”。
3. 确认输入预览、输入格式、色域和范围。自动识别不正确时再进行手动调整。
4. 设置输出分辨率、帧率、扫描方式和显示模式。
5. 分别选择RGB和Alpha目标显示器，打开输出窗口或点击“全部输出”。
6. 正式制作时以诊断页的 `RGB FPS` 和 `Alpha FPS` 为准；顶部FPS表示控制预览帧率。

### 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 找不到NDI源 | 确认已安装NDI Runtime、发送端正在输出、设备处于同一网络，并检查防火墙和网络配置文件。 |
| NDI Bridge不可用 | 安装或修复[Windows版NDI Runtime v6](https://ndi.link/NDIRedistV6)后重启程序；普通用户不需要安装NDI SDK。 |
| Alpha输出全白或全黑 | 检查发送端是否真正输出带Alpha的Full NDI/媒体内容，不要仅依靠Alpha增益补偿。 |
| 局域网URL被阻止 | 默认禁止私有网段；确认地址可信后，显式开启“允许访问局域网URL”。 |
| MOV或视频无法播放 | 解码能力取决于操作系统和Chromium支持的编码，可先转为受支持的H.264或其他常用格式。 |
| 输出帧率低 | 使用轻量或暂停控制预览，确认输出帧率与显示器刷新率合理，并查看GPU、队列和P95指标。 |
| 主窗口最小化后预览变慢 | 控制预览可能主动降帧；应检查独立输出窗口及诊断区的RGB/Alpha实际FPS。 |
| 页面长时间无新画面 | URL模式只显示冻结状态，不自动刷新；确认网页状态后使用“刷新页面”。 |

### 日志与诊断

打包程序优先把日志写入安装目录下的 `logs/`。如果安装目录不可写，会自动回退到：

```text
%LOCALAPPDATA%\RGB Alpha Splitter\logs\
```

诊断区会显示实际日志目录，并提供“打开日志目录”按钮。排错时请提供问题发生时间、输入模式、
输出格式、GPU/兼容后端状态和相关日志片段。日志可能包含设备名、NDI源名或脱敏后的URL信息，
公开分享前仍应先检查内容。

### 当前限制

- 当前主要完成Windows D3D11实机验证；macOS接口和构建脚本保留，但Intel与Apple Silicon
  的运行和长时间稳定性仍待实机验证。
- 本程序当前只处理视频画面，不接收或输出NDI/URL媒体音频。
- 不声明真实2160p60双输出已稳定支持；请依据目标设备进行实测。
- 普通扩展显示器不提供硬件genlock、扫描线同步或物理SDI Fill/Key同步。
- 五小时稳定性报告使用1080p60合成源验证DXGI双输出，没有连接真实NDI发送端，
  因此不代表NDI FrameSync网络接收的五小时验收。
- URL和本地媒体的编解码能力受Electron/Chromium和操作系统支持范围限制。

### 从源码运行

普通安装用户不需要本节工具。Windows源码构建需要：

- Node.js与npm；
- NDI 6 SDK和兼容NDI Runtime；
- Visual Studio 2022 Build Tools，并安装“使用C++的桌面开发”；
- Windows x64环境。

```powershell
npm install
npm run build:native
npm run check:version
npm run check
npm run smoke
npm start
```

`package.json` 是唯一版本来源。原生模块构建细节见
[native/README.md](native/README.md)。

macOS 11及以上源码构建需要NDI SDK for Apple、兼容NDI Runtime或NDI Tools、
Xcode Command Line Tools和Node.js：

```bash
npm install
npm run build:native:mac
npm run check
npm run smoke
npm run dist:mac
```

macOS首次搜索NDI源时需要允许“本地网络”权限。对外分发DMG前还需要配置
Apple Developer ID、Hardened Runtime和notarization。

### 架构概览

```text
NDI / URL / 本地媒体 / 测试图
  -> 输入所有权与信号格式识别
  -> Windows D3D11 GPU呈现
  -> 同一源帧生成RGB输出与Alpha输出
  -> GPU不可用时切换共享内存/WebGL兼容后端
```

独立输出不依赖控制预览的动画帧率。控制窗口最小化或被遮挡时，原生输出应继续运行。

### 文档

- [CHANGELOG.md](CHANGELOG.md)：版本更新记录。
- [PERFORMANCE.md](PERFORMANCE.md)：性能基线和五小时稳定性结果。
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：第三方许可与NDI声明。
- [native/README.md](native/README.md)：原生模块构建和接口说明。
- [overlay-link-lab](overlay-link-lab/README.md)：与主程序隔离的单线KEY/FILL硬件理论研究。

### 许可证

项目源码采用 [MIT License](LICENSE)。NDI SDK、NDI Runtime及相关商标受Vizrt单独条款约束，
不包含在本项目MIT许可范围内。项目与Vizrt不存在隶属或官方合作关系。

## English

### Overview

RGB Alpha Splitter is a desktop tool for live video production. It accepts Full NDI,
URL, local video/image, or test-pattern input, splits the picture into RGB (Fill) and
Alpha (Key), and presents them in independent windows or fullscreen on extended displays.

The application produces ordinary GPU desktop windows. It is useful for software
monitoring and production workflows without dedicated Fill/Key hardware, but it does
not replace a genlocked SDI output card or hardware Fill/Key synchronization.

### Download and first run

Windows 10/11 x64 is the primary validated platform. Download the latest installer from
[GitHub Releases](https://github.com/BroWei6657/rgb-alpha-splitter/releases).

1. Download `RGB-Alpha-Splitter-Setup-1.3.0.exe`.
2. Verify it with the `SHA256SUMS.txt` file on the Release page.
3. Run the installer and choose an installation directory.
4. To use NDI mode, install a compatible **NDI Runtime**, then restart the application.
5. Allow private-network access in Windows Firewall when discovering NDI sources for the first time.

The current Windows installer is unsigned, so Windows may display a SmartScreen warning.
Only download it from this project's GitHub Release and verify its SHA-256 before running it.

> **NDI Runtime is not the NDI SDK:** regular users only need the Runtime. The SDK,
> Visual Studio, and Node.js are required only when rebuilding the native module.

Without the NDI Runtime, the application can still start and URL, local-media, and
test-pattern modes remain available. NDI discovery, connection, and reception are
unavailable. If you only need to receive NDI, install the Runtime for your platform:

- [Download NDI Runtime v6 for Windows](https://ndi.link/NDIRedistV6)
- [Download NDI Runtime v6 for macOS](https://ndi.link/NDIRedistV6Apple)
- [Official NDI Tools download page](https://ndi.video/tools/) (optional additional tools)
- [DistroAV NDI Runtime installation guide](https://github.com/DistroAV/DistroAV/wiki/1.-Installation#required---ndi-runtime) (third-party reference)

Restart RGB Alpha Splitter after installation. This project does not bundle or redistribute
the NDI Runtime, NDI Tools, or SDK.

### Before using NDI

- Keep the sender and this computer on a mutually reachable local network; a Private Windows network profile is recommended.
- Allow the sender, NDI Runtime, and RGB Alpha Splitter through the local firewall.
- vMix or another sender must actually transmit Full NDI with Alpha; ordinary NDI video usually has no Alpha channel.
- After connecting, check the detected resolution, frame rate, pixel format, and Alpha state.
- If automatic gamut or range detection is wrong, adjust it manually or restore automatic detection.
- Stable sync improves output cadence; low-latency mode uses the latest frame. Neither mode is hardware genlock.

### Features

- **Inputs:** Full NDI, HTTP/HTTPS URL, local video/image, and generated test patterns.
- **Channel split:** RGB output and grayscale Alpha output with gain and inversion controls.
- **GPU-first Windows output:** native D3D11 dual presentation with automatic compatibility fallback.
- **Signal and color:** Rec.709/Rec.2020 SDR, Full/Limited range, common HD/UHD sizes,
  fractional frame rates, and 1080i TFF/BFF input handling.
- **Geometry:** fit, center-fill, stretch, and eight-handle manual crop.
- **URL tools:** natural/custom viewport, transparent background, freeze indication, and manual refresh.
- **Independent outputs:** separate RGB/Alpha display selection and fullscreen windows; minimizing the control window should not pause output.
- **Control preview:** lightweight, full, and paused modes, with output performance prioritized while output windows are open.
- **Diagnostics:** multi-select parallel 60-second charts, actual output FPS, frame time, queue, GPU, clock, connection state, and event logs.
- **Interface:** dedicated Input, Signal, Output, and Diagnostics tabs with Simplified Chinese/English selection, system/light/dark themes, and responsive narrow layouts.
- **Transparency preview:** a low-contrast neutral checkerboard for inspecting input Alpha without affecting output.

### Interface language and TXT locale packs

The language selector is in the top bar. Follow System, Simplified Chinese, and English
are included, and the selection is persisted. Installed locale files are stored in:

```text
<installation directory>\resources\locales\
  languages.txt
  zh-CN.txt
  en-US.txt
```

Development builds use `locales/` in the project root. Register languages in
`languages.txt` using this format:

```text
zh-CN=简体中文|zh-CN.txt
en-US=English|en-US.txt
```

Each locale TXT uses `key=display text`. To add a language, copy an existing catalog,
translate the text after each equals sign while preserving the complete key set, and
register it in `languages.txt`. Files must use UTF-8 and are reloaded after an application
restart. Editing the installation directory may require administrator permission, and an
upgrade may replace custom locale files, so back them up first. Unsafe file names, duplicate
or missing keys, and oversized catalogs are rejected.

### Quick start

1. Start the application and choose NDI or URL mode, or load a local file/test pattern.
2. In NDI mode, refresh sources, select the sender, and connect. In URL mode, enter the address and select Load URL.
3. Confirm the input preview and detected format, gamut, and range. Override them only when detection is wrong.
4. Configure output resolution, frame rate, scan mode, and scaling.
5. Select the RGB and Alpha displays, then open the windows or choose All Outputs.
6. During production, use `RGB FPS` and `Alpha FPS` on the Diagnostics tab. The top FPS value is the control-preview rate.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| No NDI sources | Install the NDI Runtime, confirm the sender is active and on the same network, and check firewall/network-profile settings. |
| NDI Bridge unavailable | Install or repair [NDI Runtime v6 for Windows](https://ndi.link/NDIRedistV6), then restart the application. Regular users do not need the NDI SDK. |
| Alpha is solid white or black | Confirm the sender or media really contains Alpha; do not use Alpha gain to compensate for a missing channel. |
| Private-network URL blocked | Private ranges are blocked by default. Enable Allow LAN URL only for a trusted address. |
| MOV/video does not play | Codec support depends on the OS and Chromium. Transcode to supported H.264 or another common format. |
| Output FPS is low | Use lightweight or paused control preview, choose a sensible output/display rate, and inspect GPU, queue, and P95 metrics. |
| Preview slows when minimized | The control preview may throttle intentionally; check the output windows and actual RGB/Alpha FPS metrics. |
| URL picture stops changing | URL mode reports a freeze but does not auto-refresh. Verify the page, then use Refresh Page manually. |

### Logs and diagnostics

Packaged builds first write logs to `logs/` beside the executable. If that location is
not writable, logs fall back to:

```text
%LOCALAPPDATA%\RGB Alpha Splitter\logs\
```

Diagnostics shows the active path and provides an Open Log Directory command. For support,
include the incident time, input mode, output format, backend state, and relevant log lines.
Logs can contain display names, NDI source names, or sanitized URL details, so review them
before posting publicly.

### Current limitations

- Windows D3D11 is the primary validated path. macOS interfaces and build scripts remain,
  but Intel and Apple Silicon runtime and long-duration validation are pending.
- The application currently processes video only; it does not receive or output NDI/URL media audio.
- Stable real-world 2160p60 dual output is not claimed; validate it on the target system.
- Ordinary extended displays do not provide hardware genlock, scanline synchronization,
  or physical SDI Fill/Key synchronization.
- The five-hour stability report used a synthetic 1080p60 source for DXGI dual output and
  did not use a real NDI sender, so it is not a five-hour NDI FrameSync reception acceptance test.
- URL and local-media codec support is limited by Electron/Chromium and the operating system.

### Running from source

Regular installer users do not need these tools. A Windows source build requires:

- Node.js and npm;
- the NDI 6 SDK and a compatible NDI Runtime;
- Visual Studio 2022 Build Tools with Desktop development with C++;
- Windows x64.

```powershell
npm install
npm run build:native
npm run check:version
npm run check
npm run smoke
npm start
```

`package.json` is the single version source. See [native/README.md](native/README.md)
for native build details.

A macOS 11+ source build requires the NDI SDK for Apple, a compatible Runtime or NDI Tools,
Xcode Command Line Tools, and Node.js:

```bash
npm install
npm run build:native:mac
npm run check
npm run smoke
npm run dist:mac
```

Allow Local Network access when discovering NDI sources on macOS. Distribution also requires
an Apple Developer ID, Hardened Runtime, and notarization.

### Architecture overview

```text
NDI / URL / local media / test pattern
  -> input ownership and signal detection
  -> Windows D3D11 GPU presentation
  -> one source frame feeds RGB output and Alpha output
  -> shared-memory/WebGL compatibility fallback when GPU output is unavailable
```

Independent output does not depend on the control preview's animation rate. Native output
should continue while the control window is minimized or occluded.

### Documentation

- [CHANGELOG.md](CHANGELOG.md): release history.
- [PERFORMANCE.md](PERFORMANCE.md): performance baselines and the five-hour stability result.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): third-party licenses and NDI notices.
- [native/README.md](native/README.md): native build and interface details.
- [overlay-link-lab](overlay-link-lab/README.md): isolated single-cable KEY/FILL hardware research.

### License

Project source is licensed under the [MIT License](LICENSE). The NDI SDK, NDI Runtime,
and related trademarks remain subject to Vizrt's separate terms and are not covered by
this project's MIT license. This project is not affiliated with or endorsed by Vizrt.
