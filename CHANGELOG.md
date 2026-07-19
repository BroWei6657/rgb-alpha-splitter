# 更新日志 / Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 的版本化结构。
This file follows the versioned structure of [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### 中文

- 暂无。

### English

- None.

## [1.3.1] - 2026-07-19

### 中文

- URL 输入支持自动补全 HTTP/HTTPS 协议，并可在页面已载入时即时切换强制透明背景。
- URL 模式新增网页交互：网页组件使用 Chromium 原生行为，预览光标跟随网页内容，支持左键、滚轮、键盘与复制粘贴快捷键；右键和中键不会转发。
- 完整显示、居中裁满和拉伸模式可直接启用网页交互；手动裁切需先通过裁切分辨率旁的小锁锁定，锁定后保留当前裁切并关闭编辑。
- 优化 URL 预览的帧采集、实际尺寸跟随和共享纹理生命周期，保持输入、RGB 与 Alpha 预览稳定且不增加逐帧 CPU 拷贝。

### English

- URL input now completes missing HTTP/HTTPS schemes, and Force Transparent Background can be changed while a page is loaded.
- URL mode now supports web interaction through Chromium's native component behavior. The preview cursor follows page content; left click, wheel, keyboard, and copy/paste shortcuts are supported, while right and middle input are blocked.
- Fit, Center Fill, and Stretch can enable web interaction directly. Manual Crop requires the small lock beside the crop resolution; locking preserves the crop and disables editing.
- URL preview frame capture, actual-size tracking, and shared-texture lifetime are optimized to keep Input, RGB, and Alpha previews stable without per-frame CPU copies.

## [1.3.0] - 2026-07-18

### 中文

- 将控制界面重构为信号工作台布局，使用独立的输入、信号、输出和诊断页签。
- 页签选中状态清晰可见，右侧工作区仅显示当前页签对应的控制组件。
- 诊断页新增低开销60秒并行折线趋势，可同时选择RGB FPS、Alpha FPS、P95帧时间、时钟抖动、双路Present偏差和GPU队列；不同单位使用独立刻度。
- 移除重复的“隐藏诊断”按钮，诊断页统一由左侧页签访问。
- 缩小中央监看区，在常用桌面窗口中无需页面级滚动即可查看完整输入、RGB和Alpha预览；各页签内的板块从01独立编号。
- 补充同步模式、信号格式、色彩、GPU、Alpha、裁切和输出设置的事件日志，并将透明棋盘调整为低对比中性灰效果。
- 新增可持久保存的“跟随系统/简体中文/English”界面语言选择，并支持通过安装目录 `resources/locales/` 下的UTF-8 TXT映射文件扩展或修改语言内容。

### English

- Reworked the control interface into a signal-desk layout with dedicated Input, Signal, Output, and Diagnostics tabs.
- Added persistent, visible tab selection and made the inspector show only the controls for the active tab.
- Added low-overhead parallel 60-second diagnostics charts with multi-select RGB FPS, Alpha FPS, P95 frame time, clock jitter, paired Present skew, and GPU queue metrics, each using its own scale.
- Removed the redundant diagnostics visibility button; the Diagnostics tab is now the single entry point.
- Reduced the central monitoring area so the full input, RGB, and Alpha preview stack fits common desktop windows without page-level scrolling, and restarted section numbering from 01 within each tab.
- Added event logging for synchronization, signal format, color, GPU, Alpha, crop, and output settings, and restyled the transparent checkerboard with a low-contrast neutral gray treatment.
- Added persistent Follow System, Simplified Chinese, and English UI selection, with extensible UTF-8 TXT locale mappings under the installed `resources/locales/` directory.

## [1.2.1] - 2026-07-15

### 中文

- 重新梳理控制台信息层级，使用稳定的顶部命令栏、运行状态轨和RGB/Alpha通道标识。
- 调整响应式断点，在1166px宽度下继续保留控制栏与监看区双栏布局，窄屏控制区改为紧凑网格。
- 增强主次操作、键盘焦点、文件选择、禁用状态及减少动态偏好的视觉反馈。

### English

- Reworked the control-console hierarchy with a stable command bar, runtime status rail, and distinct RGB/Alpha channel cues.
- Adjusted responsive breakpoints so the control and monitoring columns remain visible at 1166 px, with a compact control grid on narrower windows.
- Improved visual feedback for primary and secondary actions, keyboard focus, file selection, disabled states, and reduced-motion preferences.

## [1.2.0] - 2026-07-14

### 中文

- 产品更名为RGB Alpha Splitter，并保留原位升级兼容性。
- 新增有容量上限的工程日志和用户目录回退。
- 新增系统、浅色、深色主题，可隐藏诊断区并优化窄屏布局。
- 新增八方向裁切缩放和实时源像素尺寸。
- 新增NDI FrameSync稳定模式、低延迟旁路和DXGI时序指标。

### English

- Renamed the product while retaining in-place upgrade compatibility.
- Added bounded engineering logs with a writable per-user fallback.
- Added themes, hideable diagnostics, and responsive narrow layouts.
- Added eight-handle crop resizing with live source-pixel dimensions.
- Added FrameSync stable mode, low-latency bypass, and DXGI timing telemetry.

## [1.1.2] - 2026-07-14

### 中文

- 新增高性能GPU选择并扩展D3D11指标。
- 使用latest-frame队列和复用上传资源降低NDI提交竞争。
- 新增双输出轻量控制预览策略。
- 将Alpha和扫描设置同步到原生GPU呈现器。
- 隐藏Electron默认菜单并禁用生产包DevTools入口。

### English

- Added high-performance GPU selection and expanded D3D11 telemetry.
- Reduced NDI contention with a latest-frame queue and reusable uploads.
- Added lightweight control previews for dual-output operation.
- Synchronized Alpha and scan settings with the native presenter.
- Removed default menus and packaged DevTools entry points.

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
