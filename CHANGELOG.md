# 更新日志 / Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 的版本化结构。
This file follows the versioned structure of [Keep a Changelog](https://keepachangelog.com/).

## [1.2.1] - 2026-07-15

### 中文

- 重新梳理控制台信息层级，使用稳定的顶部命令栏、运行状态轨和RGB/Alpha通道标识。
- 调整响应式断点，在1166px宽度下继续保留控制栏与监看区双栏布局，窄屏控制区改为紧凑网格。
- 增强主次操作、键盘焦点、文件选择、禁用状态及减少动态偏好的视觉反馈。
- 保持全部1.2.0输入、输出、GPU、色彩、裁切、同步和安全接口不变。
- 将此前未批准的1.3.0版本标记纠正为1.2.1；独立Overlay研究目录继续与应用运行链路隔离。

### English

- Reworked the control-console hierarchy with a stable command bar, runtime status rail, and distinct RGB/Alpha channel cues.
- Adjusted responsive breakpoints so the control and monitoring columns remain visible at 1166 px, with a compact control grid on narrower windows.
- Improved visual feedback for primary and secondary actions, keyboard focus, file selection, disabled states, and reduced-motion preferences.
- Preserved every v1.2.0 input, output, GPU, color, crop, synchronization, and security interface.
- Corrected the previously unapproved v1.3.0 version marker to v1.2.1; the isolated Overlay research directory remains outside the application runtime.

## [1.2.0] - 2026-07-14

- 产品更名为 RGB Alpha Splitter，并保留原位升级兼容性。 / Renamed the product while retaining in-place upgrade compatibility.
- 新增有容量上限的工程日志和用户目录回退。 / Added bounded engineering logs with a writable per-user fallback.
- 新增系统、浅色、深色主题，可隐藏诊断区并优化窄屏布局。 / Added themes, hideable diagnostics, and responsive narrow layouts.
- 新增八方向裁切缩放和实时源像素尺寸。 / Added eight-handle crop resizing with live source-pixel dimensions.
- 新增 NDI FrameSync 稳定模式、低延迟旁路和 DXGI 时序指标。 / Added FrameSync stable mode, low-latency bypass, and DXGI timing telemetry.
- 性能目标改为格式和帧时序指标，不再绑定指定硬件。 / Replaced hardware-specific targets with format and frame-timing metrics.

## [1.1.2] - 2026-07-14

- 新增高性能 GPU 选择并扩展 D3D11 指标。 / Added high-performance GPU selection and expanded D3D11 telemetry.
- 使用 latest-frame 队列和复用上传资源降低 NDI 提交竞争。 / Reduced NDI contention with a latest-frame queue and reusable uploads.
- 新增双输出轻量控制预览策略。 / Added lightweight control previews for dual-output operation.
- 将 Alpha 和扫描设置同步到原生 GPU 呈现器。 / Synchronized Alpha and scan settings with the native presenter.
- 隐藏 Electron 默认菜单并禁用生产包 DevTools 入口。 / Removed default menus and packaged DevTools entry points.
- 保持 macOS 公共接口同步，等待实机验证。 / Kept macOS interfaces aligned pending hardware validation.

## [1.1.1] - 2026-07-12

- 修复本地媒体被旧 30 ms 发布周期限制在约 30 fps 的问题。 / Fixed the legacy local-media 30 fps cap.
- 新增截止时间调度和按目标帧率重复最后一帧。 / Added deadline scheduling and last-frame repetition.
- 新增 Windows D3D11 GPU 优先呈现与兼容回退。 / Added Windows D3D11 GPU-first presentation with fallback.
- 新增自动信号检测和按源手动色彩锁定。 / Added automatic signal detection and per-source color locks.
- 拆分分辨率、帧率、扫描、缩放和裁切控制。 / Separated resolution, frame rate, scan, scaling, and crop controls.
- 新增 URL viewport、裁切、冻结提示和手动刷新。 / Added URL viewport, crop, freeze, and manual refresh tools.
- 扩展质量优先的 NDI 像素格式与元数据支持。 / Expanded quality-first NDI formats and metadata.

## [1.1.0] - 2026-07-12

- 新增统一输入所有权与过期帧拒绝。 / Added unified source ownership and stale-frame rejection.
- 新增 URL 网络隔离、冻结监测和局域网限制。 / Added URL isolation, freeze monitoring, and LAN restrictions.
- 新增广播信号预设和 SDR 色彩元数据。 / Added broadcast presets and SDR color metadata.
- 新增 GPU 能力报告和自动兼容回退。 / Added GPU capability reporting and automatic fallback.
- 加固独立输出窗口并降低轮询开销。 / Hardened output windows and reduced polling overhead.

## [1.0.0]

- 首个支持 Full NDI、URL、本地媒体、测试图及 RGB/Alpha 输出的版本。 / Initial Full NDI, URL, local media, test-pattern, RGB, and Alpha release.
