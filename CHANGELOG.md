# 更新日志 / Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 的版本化结构。
This file follows the versioned structure of [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### 中文

- 重写面向用户的README，精简过时架构和开发过程说明。
- 补充Windows/macOS NDI Runtime v6直达下载链接、可选NDI Tools入口及第三方安装参考，并明确NDI Runtime与NDI SDK的区别。
- 补充安装包签名状态、视频/音频范围、日志隐私、平台验证和硬件同步边界。
- 统一README和更新日志的公开发布表述，同时保留真实版本历史。

### English

- Reworked the user-facing README and removed outdated architecture and development-process details.
- Added direct Windows/macOS NDI Runtime v6 downloads, the optional NDI Tools page, and a third-party installation reference, while clarifying the Runtime versus SDK distinction.
- Documented installer-signing status, video/audio scope, log privacy, platform validation, and hardware-sync boundaries.
- Standardized the public-release wording in the README and changelog while preserving the factual release history.

## [1.2.1] - 2026-07-15

### 中文

- 重新梳理控制台信息层级，使用稳定的顶部命令栏、运行状态轨和RGB/Alpha通道标识。
- 调整响应式断点，在1166px宽度下继续保留控制栏与监看区双栏布局，窄屏控制区改为紧凑网格。
- 增强主次操作、键盘焦点、文件选择、禁用状态及减少动态偏好的视觉反馈。
- 保持全部1.2.0输入、输出、GPU、色彩、裁切、同步和安全接口不变。
- 新增与主应用运行链路隔离的Overlay Link硬件理论、协议、模拟器和验证资料。

### English

- Reworked the control-console hierarchy with a stable command bar, runtime status rail, and distinct RGB/Alpha channel cues.
- Adjusted responsive breakpoints so the control and monitoring columns remain visible at 1166 px, with a compact control grid on narrower windows.
- Improved visual feedback for primary and secondary actions, keyboard focus, file selection, disabled states, and reduced-motion preferences.
- Preserved every v1.2.0 input, output, GPU, color, crop, synchronization, and security interface.
- Added isolated Overlay Link hardware theory, protocol, simulator, and validation material without changing the application runtime.

## [1.2.0] - 2026-07-14

### 中文

- 产品更名为RGB Alpha Splitter，并保留原位升级兼容性。
- 新增有容量上限的工程日志和用户目录回退。
- 新增系统、浅色、深色主题，可隐藏诊断区并优化窄屏布局。
- 新增八方向裁切缩放和实时源像素尺寸。
- 新增NDI FrameSync稳定模式、低延迟旁路和DXGI时序指标。
- 性能目标改为格式和帧时序指标，不再绑定指定硬件。

### English

- Renamed the product while retaining in-place upgrade compatibility.
- Added bounded engineering logs with a writable per-user fallback.
- Added themes, hideable diagnostics, and responsive narrow layouts.
- Added eight-handle crop resizing with live source-pixel dimensions.
- Added FrameSync stable mode, low-latency bypass, and DXGI timing telemetry.
- Replaced hardware-specific targets with format and frame-timing metrics.

## [1.1.2] - 2026-07-14

### 中文

- 新增高性能GPU选择并扩展D3D11指标。
- 使用latest-frame队列和复用上传资源降低NDI提交竞争。
- 新增双输出轻量控制预览策略。
- 将Alpha和扫描设置同步到原生GPU呈现器。
- 隐藏Electron默认菜单并禁用生产包DevTools入口。
- 保持macOS公共接口同步，等待实机验证。

### English

- Added high-performance GPU selection and expanded D3D11 telemetry.
- Reduced NDI contention with a latest-frame queue and reusable uploads.
- Added lightweight control previews for dual-output operation.
- Synchronized Alpha and scan settings with the native presenter.
- Removed default menus and packaged DevTools entry points.
- Kept macOS interfaces aligned pending hardware validation.

## [1.1.1] - 2026-07-12

### 中文

- 修复本地媒体被旧30毫秒发布周期限制在约30fps的问题。
- 新增截止时间调度和按目标帧率重复最后一帧。
- 新增Windows D3D11 GPU优先呈现与兼容回退。
- 新增自动信号检测和按源手动色彩锁定。
- 拆分分辨率、帧率、扫描、缩放和裁切控制。
- 新增URL viewport、裁切、冻结提示和手动刷新。
- 扩展质量优先的NDI像素格式与元数据支持。

### English

- Fixed the legacy local-media 30fps cap.
- Added deadline scheduling and last-frame repetition.
- Added Windows D3D11 GPU-first presentation with fallback.
- Added automatic signal detection and per-source color locks.
- Separated resolution, frame rate, scan, scaling, and crop controls.
- Added URL viewport, crop, freeze, and manual refresh tools.
- Expanded quality-first NDI formats and metadata.

## [1.1.0] - 2026-07-12

### 中文

- 新增统一输入所有权与过期帧拒绝。
- 新增URL网络隔离、冻结监测和局域网限制。
- 新增广播信号预设和SDR色彩元数据。
- 新增GPU能力报告和自动兼容回退。
- 加固独立输出窗口并降低轮询开销。

### English

- Added unified source ownership and stale-frame rejection.
- Added URL isolation, freeze monitoring, and LAN restrictions.
- Added broadcast presets and SDR color metadata.
- Added GPU capability reporting and automatic fallback.
- Hardened output windows and reduced polling overhead.

## [1.0.0]

### 中文

- 首个支持Full NDI、URL、本地媒体、测试图及RGB/Alpha输出的版本。

### English

- Initial Full NDI, URL, local media, test-pattern, RGB, and Alpha release.
