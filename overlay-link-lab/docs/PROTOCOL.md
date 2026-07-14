# OLK-HDMI-1.0 传输协议

## 固定格式

| 项目 | 单线输入 | 两路输出 |
| --- | --- | --- |
| 有效画面 | 3840 x 2160 | 2 x 1920 x 1080 |
| 总时序 | 4400 x 2250 | 2 x 2200 x 1125 |
| 帧率 | 60/1 progressive | 60/1 progressive |
| 概念像素时钟 | 594 MHz | 148.5 MHz |
| 颜色 | RGB 4:4:4, 8-bit | RGB 4:4:4, 8-bit |
| HDCP | 禁用 | 禁用 |

输入必须是标准 CTA 3840x2160p60 时序。禁止 YCbCr 4:2:0、HDR、可变刷新率、缩放和桌面旋转。

## 像素映射

对源像素坐标 `(x, y)`，其中 `0 <= x < 1920`、`0 <= y < 1080`：

```text
transport(x,        2y)     = FILL.rgb(x, y)
transport(x,        2y + 1) = FILL.rgb(x, y)
transport(1920 + x, 2y)     = KEY(x, y) replicated to R/G/B
transport(1920 + x, 2y + 1) = KEY(x, y) replicated to R/G/B
```

FILL 的 Alpha 不在线路中传输。KEY 是 8-bit 灰度，`0` 表示完全透明，`255` 表示完全不透明。KEY 同时写入 R/G/B，便于接收端做通道一致性和链路错误检查。

## 为什么能够只用行缓存

标准 4K60 与 1080p60 有以下整数关系：

| 断言 | 数值 | 结果 |
| --- | --- | --- |
| 有效宽度 | 3840 = 2 x 1920 | 通过 |
| 有效高度 | 2160 = 2 x 1080 | 通过 |
| 总宽度 | 4400 = 2 x 2200 | 通过 |
| 总高度 | 2250 = 2 x 1125 | 通过 |
| 像素时钟 | 594 = 4 x 148.5 MHz | 通过 |

FPGA HDMI RX 子系统用 4 pixels-per-clock 时，其内部视频时钟为 148.5 MHz：每条 4K 输入行占 `4400 / 4 = 1100` 个内部时钟；两条输入行恰好占 `2200` 个时钟，等于一条 1080p 输出总行长。偶数输入行写入缓存，重复的奇数行提供输出所需的另一半时间。

推荐使用两个 ping-pong 行缓存：

```text
2 banks x 1920 pixels x (24-bit FILL + 8-bit KEY)
= 122,880 bits
= 15,360 bytes
```

输出在同一个 148.5 MHz 域内用一个 `2200 x 1125` 时序计数器驱动。两个 ADV7511 接收完全相同的像素时钟、HS、VS 和 DE；差别只有像素数据，因此 KEY/FILL 天然行同步。

## 数据路径

```text
4K60 HDMI RX
  -> HDMI RX Subsystem, RGB 4PPC @ 148.5 MHz
  -> 偶数行校验与左右半幅拆分
  -> FILL RGB / KEY 8-bit 双行缓存
  -> 单一 1080p60 时序发生器
  -> HDMI TX #1 FILL
  -> HDMI TX #2 KEY
```

预计纯像素流水线延迟为 1-2 条 1080p 行，即约 `14.8-29.6 us`，不含 HDMI 接收器、发送器和下游设备延迟。无需整帧 DDR；若实现加入帧同步器或缩放器，则延迟会变为至少一帧。

## 电平码值

- 传输链路固定为 RGB Full，确保 PC GPU 不把 KEY 的 `0-255` 重新映射。
- FILL tile 承载软件已准备好的目标 RGB 码值。输出 AVI InfoFrame 的量化范围必须与软件设置一致。
- KEY tile 在传输内使用 `0-255`。FPGA 按下游设置输出 Full `0-255` 或 Limited `16-235`；首个硬件版本默认 Limited。
- 首次实机必须用 0、1、16、17、127、128、235、254、255 灰阶验证 GPU、RX 和 TX 没有隐式范围转换。

## EDID

输入端 EDID 只声明：

- 3840x2160p60 8-bit RGB 4:4:4；
- 不声明音频、HDR、VRR、YUV 4:2:0 或 HDCP；
- Preferred Timing 固定为 3840x2160p60；
- 厂商/产品标识使用本新项目独立标识，不复用旧应用 ID。

EDID 的二进制内容在硬件阶段生成，并纳入 checksum 自动测试。在 EDID 或 RX 未锁定时，硬件输出黑 FILL 和黑 KEY，避免在节目链路上误出满屏图形。

## 错误计数

硬件至少维护以下只增计数器：

- 重复行不一致；
- KEY R/G/B 不一致；
- RX lock 丢失；
- 输入时序不匹配；
- 行缓存 underflow / overflow；
- 两路 TX lock 失败。

没有额外数据线时，状态先通过板载 UART 或以太网读取；这不属于正常视频传输路径。
