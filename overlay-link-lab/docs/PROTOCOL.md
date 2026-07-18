# OLK-HDMI-1.0 传输协议 / Transport Protocol

[中文](#中文说明) | [English](#english)

## 中文说明

本协议是理论参考模型，尚未通过HDMI硬件验证。

### 固定格式

| 项目 | 单线输入 | 两路输出 |
| --- | --- | --- |
| 有效画面 | 3840 x 2160 | 2 x 1920 x 1080 |
| 总时序 | 4400 x 2250 | 2 x 2200 x 1125 |
| 帧率 | 60/1 progressive | 60/1 progressive |
| 概念像素时钟 | 594MHz | 148.5MHz |
| 颜色 | RGB 4:4:4, 8-bit | RGB 4:4:4, 8-bit |
| HDCP | 禁用 | 禁用 |

输入必须使用标准CTA 3840 x 2160p60时序，不支持YCbCr 4:2:0、HDR、可变刷新率、缩放或桌面旋转。

### 像素映射

对源坐标`0 <= x < 1920`、`0 <= y < 1080`：

```text
transport(x,        2y)     = FILL.rgb(x, y)
transport(x,        2y + 1) = FILL.rgb(x, y)
transport(1920 + x, 2y)     = KEY(x, y) replicated to R/G/B
transport(1920 + x, 2y + 1) = KEY(x, y) replicated to R/G/B
```

FILL的Alpha不在线路中传输。KEY为8位灰度：`0`表示完全透明，`255`表示完全不透明。
KEY同时写入R/G/B，便于接收端检查三通道一致性。

### 行缓存关系

| 断言 | 数值 |
| --- | --- |
| 有效宽度 | 3840 = 2 x 1920 |
| 有效高度 | 2160 = 2 x 1080 |
| 总宽度 | 4400 = 2 x 2200 |
| 总高度 | 2250 = 2 x 1125 |
| 像素时钟 | 594 = 4 x 148.5MHz |

HDMI RX使用4 pixels-per-clock时，内部视频时钟为148.5MHz。每条4K输入行占1100个内部时钟，
两条输入行正好占2200个时钟，等于一条1080p输出总行长。偶数行写入缓存，重复的奇数行提供
输出读取时间。

建议使用两个ping-pong行缓存：

```text
2 banks x 1920 pixels x (24-bit FILL + 8-bit KEY)
= 122,880 bits
= 15,360 bytes
```

两个HDMI发送器由同一`2200 x 1125`计数器、像素时钟、HS、VS和DE驱动，只有像素数据不同。

### 数据路径与延迟

```text
4K60 HDMI RX
  -> RGB 4PPC @ 148.5MHz
  -> 重复行校验和左右半幅拆分
  -> FILL RGB / KEY 8-bit行缓存
  -> 单一1080p60时序发生器
  -> HDMI TX FILL + HDMI TX KEY
```

纯像素流水线预计延迟为1至2条1080p行，约`14.8-29.6us`，不包含收发器和下游设备延迟。
加入帧同步器或缩放器会把延迟提高到至少一帧。

### 电平码值

- 传输链路固定为RGB Full，避免GPU把KEY的`0-255`重新映射。
- FILL承载软件准备的目标RGB码值，输出量化范围必须与软件设置一致。
- KEY在传输内使用`0-255`；FPGA可按下游要求输出Full或Limited，实验默认Limited。
- 首次硬件测试应覆盖0、1、16、17、127、128、235、254和255灰阶，检查隐式范围转换。

### EDID

输入EDID仅声明3840 x 2160p60、8-bit RGB 4:4:4，不声明音频、HDR、VRR、YCbCr 4:2:0或HDCP。
Preferred Timing固定为3840 x 2160p60。EDID校验和应纳入自动测试；EDID或RX未锁定时，两路输出黑场。

### 错误计数

硬件至少维护以下只增计数器：

- 重复行不一致；
- KEY R/G/B不一致；
- RX lock丢失；
- 输入时序不匹配；
- 行缓存underflow/overflow；
- 两路TX lock失败。

实验阶段可通过UART或以太网读取状态，它们不属于正常视频传输路径。

## English

This protocol is a theoretical reference model and has not been validated on HDMI hardware.

### Fixed format

| Item | Single-link input | Two outputs |
| --- | --- | --- |
| Active picture | 3840 x 2160 | 2 x 1920 x 1080 |
| Total timing | 4400 x 2250 | 2 x 2200 x 1125 |
| Frame rate | 60/1 progressive | 60/1 progressive |
| Conceptual pixel clock | 594MHz | 148.5MHz |
| Color | RGB 4:4:4, 8-bit | RGB 4:4:4, 8-bit |
| HDCP | Disabled | Disabled |

The input must use standard CTA 3840 x 2160p60 timing. YCbCr 4:2:0, HDR, variable
refresh rate, scaling, and desktop rotation are not supported.

### Pixel mapping

For source coordinates `0 <= x < 1920` and `0 <= y < 1080`:

```text
transport(x,        2y)     = FILL.rgb(x, y)
transport(x,        2y + 1) = FILL.rgb(x, y)
transport(1920 + x, 2y)     = KEY(x, y) replicated to R/G/B
transport(1920 + x, 2y + 1) = KEY(x, y) replicated to R/G/B
```

FILL Alpha is not carried on the link. KEY is 8-bit grayscale: `0` is fully transparent
and `255` is fully opaque. Replicating KEY into R/G/B allows channel-consistency checks.

### Line-buffer relationship

| Assertion | Value |
| --- | --- |
| Active width | 3840 = 2 x 1920 |
| Active height | 2160 = 2 x 1080 |
| Total width | 4400 = 2 x 2200 |
| Total height | 2250 = 2 x 1125 |
| Pixel clock | 594 = 4 x 148.5MHz |

With a 4-pixels-per-clock HDMI RX, the internal video clock is 148.5MHz. One 4K input
line occupies 1100 internal clocks, and two input lines occupy 2200 clocks, matching one
total 1080p output line. Even lines are written while repeated odd lines provide read time.

Two ping-pong line buffers are sufficient in the model:

```text
2 banks x 1920 pixels x (24-bit FILL + 8-bit KEY)
= 122,880 bits
= 15,360 bytes
```

Both HDMI transmitters use the same `2200 x 1125` counter, pixel clock, HS, VS, and DE;
only their pixel data differs.

### Data path and latency

```text
4K60 HDMI RX
  -> RGB 4PPC @ 148.5MHz
  -> repeated-line check and left/right split
  -> FILL RGB / KEY 8-bit line buffers
  -> one 1080p60 timing generator
  -> HDMI TX FILL + HDMI TX KEY
```

Estimated pure-pixel-pipeline latency is one to two 1080p lines, approximately
`14.8-29.6us`, excluding receiver, transmitter, and downstream latency. A frame
synchronizer or scaler would increase latency to at least one frame.

### Code ranges

- The transport is fixed at RGB Full so the GPU does not remap KEY `0-255` values.
- FILL carries RGB codes prepared by software; output quantization must match that configuration.
- KEY uses `0-255` in transport. The FPGA may emit Full or Limited for the downstream device; the experiment defaults to Limited.
- Initial hardware tests should cover 0, 1, 16, 17, 127, 128, 235, 254, and 255 to detect implicit range conversion.

### EDID

The input EDID declares only 3840 x 2160p60 8-bit RGB 4:4:4. It does not declare audio,
HDR, VRR, YCbCr 4:2:0, or HDCP. Preferred Timing is fixed at 3840 x 2160p60. EDID checksum
validation belongs in automated tests. Both outputs go black when EDID or RX is not locked.

### Error counters

Hardware should provide monotonic counters for:

- repeated-line mismatch;
- KEY R/G/B mismatch;
- RX lock loss;
- input timing mismatch;
- line-buffer underflow/overflow;
- TX lock failure on either output.

UART or Ethernet may expose status during experiments; neither is part of the normal video path.
