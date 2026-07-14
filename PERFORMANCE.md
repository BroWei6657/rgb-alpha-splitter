# 性能基线 / Performance Baseline

## v1.1.0 兼容后端 / v1.1.0 compatibility backend

以下数据于2026-07-12使用v1.1.0兼容后端和两个独立RGB/Alpha输出窗口测得。
The following results were measured on 2026-07-12 with the v1.1.0 compatibility
backend and two independent RGB/Alpha output windows.

| 输入帧 / Source frame | 发布帧 / Published | RGB输出 / RGB output | Alpha输出 / Alpha output |
| --- | ---: | ---: | ---: |
| 1920 x 1080 | 97 / 1.6 s | 60.2 fps | 59.9 fps |
| 3840 x 2160 | 94 / 1.6 s | 18.7 fps | 19.3 fps |

运行 `npm run performance` 可重复测试。测试必须在真实桌面/GPU会话中执行，受限
沙箱中的GPU子进程不能作为有效性能环境。

Run `npm run performance` to repeat the test. It requires a real desktop/GPU
session; sandboxed GPU child processes are not a valid benchmark environment.

该结果说明共享内存RGBA复制可以满足当次1080p60测试，但不能满足2160p60双输出。
4K60需要原生D3D11/Metal共享纹理呈现器，本版本不得宣称已验证支持。

The result confirms that shared-memory RGBA copies were suitable for the tested
1080p60 case but not for 2160p60 dual output. 4K60 requires a native D3D11/Metal
shared-texture presenter and is not claimed as validated by this build.

## v1.1.1 D3D11 GPU 后端 / D3D11 GPU backend

移除两个重复WebGL共享内存读取器并改用D3D11子窗口交换链后，测得以下结果：

After removing two redundant WebGL shared-memory readers and presenting through
D3D11 child-window swap chains, the following results were measured:

| 输入帧 / Source frame | 发布帧 / Published | RGB输出 / RGB output | Alpha输出 / Alpha output |
| --- | ---: | ---: | ---: |
| 1920 x 1080 | 98 / 1.6 s | 59.1 fps | 59.1 fps |
| 3840 x 2160 | 90 / 1.6 s | 49.4 fps | 49.4 fps |

1080p60管线按目标节奏呈现，源帧不足时重复最新纹理。4K结果超过v1.1.0兼容基线
的两倍，但仍低于60fps，因此UI只显示实测FPS，不声明2160p60已验证支持。URL共享
纹理避免CPU上传；NDI帧仍需从SDK内存上传一次。

The 1080p60 path presents at the selected cadence and repeats the latest texture
when the source is slower. The 4K result is more than twice the v1.1.0 baseline but
remains below 60 fps, so the UI reports measured FPS without claiming validated
2160p60 support. URL shared textures avoid CPU upload; NDI frames still require one
upload from SDK-provided memory.

## GPU 调度基线 / GPU scheduling baseline

v1.1.2 smoke于2026-07-14测得两路1080p输出约59.6fps，静态帧在1.1秒内重复
66次。呈现器约为0.08ms上传、0.01ms绘制、0.33ms Present和1.03ms P95，
没有呈现失败。

The v1.1.2 smoke run on 2026-07-14 measured two 1080p output windows at 59.6 fps,
with static-frame repetition at 66 frames
in 1.1 seconds. The presenter reported approximately 0.08 ms upload, 0.01 ms draw,
0.33 ms Present and 1.03 ms P95 frame work, with zero presentation failures.

该smoke验证本地调度和输出连续性，不代表真实NDI网络解码验收。最终验收需要真实
1080p59.94/60 NDI输入，并根据实际帧率、帧时间稳定性、丢帧和资源上限评估。

This smoke result validates scheduling and output continuity, not real NDI network decode.
Final acceptance uses real 1080p59.94/60 NDI input and is evaluated by achieved frame rate,
frame-time stability, dropped frames and bounded resource use rather than a named hardware target.
`npm run performance` records adapter, upload, render, Present,
P95, overwritten-frame and failure metrics for both 1080p and 2160p cases.

移除两个空闲WebGL输出上下文后，12秒1080p60测试平均60.17fps，最低一秒
58.71fps，P95为2.67ms且没有呈现失败。Electron总工作集从950,300KiB开始，
峰值相同，结束时为922,012KiB。该短时基线的后续五小时结果见本文下方。

A 12-second 1080p60 soak after removing the two idle WebGL output contexts averaged
60.17 fps with 58.71 fps as the lowest one-second sample, 2.67 ms P95 frame work and
zero presentation failures. Aggregate Electron working set started at 950,300 KiB,
peaked at the same value and ended at 922,012 KiB, indicating that the warm pipeline
did not grow during the sample. Its subsequent five-hour result is documented below.

## v1.2.0 同步呈现 smoke / Synchronized presentation smoke

Windows smoke中两路1080p输出约为60fps，并选择RGB DXGI帧延迟对象作为主时钟。
测试确认无呈现失败、存在八个裁切手柄、1166px布局无水平溢出，且稳定/低延迟
同步设置可正常切换。真实NDI FrameSync仍需持续信号和长时间实机测试。

The Windows smoke test presented both 1080p outputs at approximately 60 fps with the RGB
DXGI frame-latency object selected as the master clock. The test reported no presentation
failures, eight crop handles, a single-column 1166 px layout without horizontal overflow,
and working stable/low-latency synchronization configuration. These figures validate the
local scheduler and packaged resources; final NDI FrameSync acceptance still requires a
continuous real NDI source and a long-duration production test.

## v1.2.0 5小时DXGI帧同步稳定性测试 / 5-hour DXGI frame-sync stability test

测试于2026-07-14 23:18:21至2026-07-15 04:18:21（UTC+8）使用已打包的v1.2.0程序连续运行
18,000秒。输入为1920 x 1080、60fps合成视频帧，RGB与Alpha原生D3D11输出同时启用，
RGB交换链的DXGI帧延迟等待对象作为主显示时钟。测试使用的适配器为
NVIDIA GeForce RTX 4070 Laptop GPU；该信息仅描述本次测试环境，不构成最低或推荐硬件要求。

The packaged v1.2.0 application ran continuously for 18,000 seconds from
2026-07-14 23:18:21 to 2026-07-15 04:18:21 (UTC+8). The source was a synthetic
1920 x 1080 60 fps video stream. Native D3D11 RGB and Alpha outputs were active
simultaneously, with the RGB swap chain's DXGI frame-latency waitable object used
as the master display clock. The test adapter was an NVIDIA GeForce RTX 4070
Laptop GPU; this identifies the test environment only and is not a minimum or
recommended hardware requirement.

| 指标 / Metric | 5小时结果 / 5-hour result |
| --- | ---: |
| 测试时长 / Duration | 18,000,000 ms (5 h) |
| 目标输出 / Target output | 1920 x 1080 @ 60 fps |
| 合成源发布帧 / Synthetic source frames published | 1,095,131 |
| 输出提交帧 / Output frames submitted | 1,080,048 |
| 平均输出帧率 / Average output FPS | 59.9894 fps |
| RGB最低1秒采样 / Lowest 1-second RGB sample | 54.4747 fps |
| Alpha最低1秒采样 / Lowest 1-second Alpha sample | 54.4747 fps |
| 呈现失败 / Presentation failures | 0 |
| 连续呈现失败 / Consecutive presentation failures | 0 |
| 结束时队列深度 / Final queue depth | 0 |
| 覆盖/丢弃帧 / Overwritten/dropped frames | 14 / 14 |
| 重复输出帧 / Repeated output frames | 14,691 |
| 时钟状态 / Clock state | Locked (`dxgi-rgb`) |
| 引擎报告时钟抖动 / Engine-reported tick jitter | 898.13 us |
| RGB/Alpha呈现偏差 / RGB/Alpha Present skew | 1,548.83 us |
| 上传/绘制/Present / Upload/draw/Present | 0.4888 / 0.0069 / 0.9663 ms |
| P95帧处理时间 / P95 frame work | 2.2746 ms |
| 初始/峰值/最终工作集 / Initial/peak/final working set | 959,556 / 959,556 / 818,800 KiB |
| 设备移除或最终错误 / Device removal or final error | None |

在本测试范围内，DXGI双输出调度稳定性通过。平均输出帧率达到60fps目标的99.9824%，
RGB与Alpha保持相同的最低采样值，主时钟在结束时仍为锁定状态；测试期间没有Present失败，
结束时没有队列积压，最终工作集比初始值低约14.7%。最低1秒采样54.4747fps表明Windows调度
仍存在短时抖动；14个覆盖/丢弃帧和14,691个重复帧反映合成发布器与输出时钟之间的相位及
供帧差异，但未造成输出队列持续增长或呈现中断。本结果属于帧级软件同步验证，不等同于
硬件genlock、扫描线同步或物理Fill/Key同步。

Within this test scope, DXGI dual-output scheduling stability passed. Average
output reached 99.9824% of the 60 fps target, RGB and Alpha reported the same
lowest sample, and the master clock remained locked at completion. There were no
Present failures, no final queue backlog, and final working set was approximately
14.7% below the initial value. The 54.4747 fps lowest one-second sample shows that
short Windows scheduling disturbances remain. The 14 overwritten/dropped frames
and 14,691 repeated frames reflect phase and supply differences between the
synthetic publisher and the output clock, but did not produce sustained queue
growth or presentation interruption. This is frame-level software synchronization,
not hardware genlock, scanline synchronization, or physical Fill/Key synchronization.

### NDI验证边界 / NDI validation boundary

本次5小时运行没有连接真实NDI发送端：NDI接收帧为0，`frameSyncActive=false`，
`ndiTimestampAvailable=false`。因此，本结果验证的是DXGI主显示时钟下的本地合成源双输出稳定性，
不能作为NDI FrameSync网络接收、NDI时间戳或断线重连的5小时验收结果。后续仍需使用持续的
1080p59.94/60真实NDI源重复同等时长测试。

No real NDI sender was connected during this five-hour run: the receiver captured
zero NDI frames, `frameSyncActive=false`, and `ndiTimestampAvailable=false`.
Accordingly, this result validates dual-output stability for a local synthetic
source under the DXGI master display clock. It is not a five-hour acceptance test
of NDI FrameSync network reception, NDI timestamps, or reconnect behavior. An
equivalent-duration run with a continuous real 1080p59.94/60 NDI source remains
required.
