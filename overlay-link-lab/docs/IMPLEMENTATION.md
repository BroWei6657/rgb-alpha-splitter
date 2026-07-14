# 实施过程

## 阶段 0：无硬件协议冻结（当前）

1. 运行 `node overlay-link-lab\\tests\\transport-core.test.js`，保证打包、拆包、重复行和错误检测通过。
2. 运行 `node overlay-link-lab\\scripts\\verify-theory.js`，保证 7 条几何/时序/带宽断言通过。
3. 打开 `simulator/index.html`，检查三种测试图、KEY 增益、反转和错误注入。
4. 冻结 `OLK-HDMI-1.0`。协议变更必须增加协议版本，不能静默改变像素映射。

本阶段完成后才能采购 ZCU106。

## 阶段 1：独立 PC companion

新增程序仍放在本目录，不修改旧应用。

```text
旧 RGB Alpha Splitter
  -> 只读打开 Local\\NDIAlphaSplitter.Frame.v1
  -> Overlay Link companion
  -> D3D11 3840x2160 全屏交换链
  -> 指定的 ZCU106 HDMI 显示器
```

软件过程：

1. 复用旧共享帧头和 sequence-before/after 校验，只读映射，不创建新 owner。
2. D3D11 pixel shader 读取 RGBA 源纹理：左半输出 RGB，右半把 Alpha 复制到 RGB；源 Y 坐标用 `floor(transportY / 2)`。
3. 交换链固定 `DXGI_FORMAT_R8G8B8A8_UNORM`、3840x2160、60/1；关闭 HDR、桌面缩放和色彩增强。
4. 只允许用户明确选择一个物理显示器；检测不到精确 3840x2160@60 RGB 时拒绝上线。
5. 记录 Present 时间、dropped frame、共享帧 sequence、显示模式和 GPU adapter LUID。

HDMI 路线不需要设备驱动。companion 是一个普通显示输出程序；硬件通过 EDID 暴露固定模式。

## 阶段 2：ZCU106 单输入单输出

先验证输入协议和一路输出，再增加第二路。

1. Vivado 工程使用 ZCU106 board preset、HDMI 2.0 RX Subsystem、Video Timing Controller 和 ILA。
2. RX 固定为 RGB 4PPC @ 148.5 MHz；不加入 VDMA、缩放器或 VCU。
3. 实现偶数行捕获、奇数行一致性检查和左右半幅拆分。
4. 第一阶段只把 FILL 接到板载 HDMI TX；KEY 在 ILA 中抽样校验。
5. 用静态 ramp 和 moving edge 验证没有重排、范围映射或行错位。

FPGA 模块边界建议：

```text
olk_rx_guard        输入时序、RGB、重复行和 KEY 三通道检查
olk_line_split      左右半幅拆分、ping-pong BRAM
olk_1080_timing     唯一的 2200 x 1125 输出计数器
olk_fill_out        24-bit RGB 读口
olk_key_out         8-bit 到 RGB、Full/Limited 映射
olk_status_regs     锁定状态和错误计数器
```

## 阶段 3：双 HDMI FMC

1. FMC 小板使用 ADV7511KSTZ；先单独用彩条发生器配置 I2C 和输出 1080p60。
2. 板载 TX 与 FMC TX 接收同一个 pixel clock、HS、VS、DE。
3. FILL 输出 24-bit RGB；KEY 输出复制后的 24-bit 灰度。
4. 上电顺序为：电源稳定、配置 EDID、RX lock、清缓存、同时释放两个 TX reset。
5. 任一 RX/缓存错误持续超过两帧时，两路输出同时切到黑；恢复需连续 30 帧无错。

用示波器检查两路 VS/HS 偏斜，再用实际切换台的 External Key 模式检查边缘。如果切换台要求 FILL/KEY 端口顺序或有限范围，在 FPGA 寄存器配置，不改传输协议。

## 阶段 4：定制 PCB

1. 先冻结 ZCU106 引脚、GT quad、时钟和 ADV7511 寄存器配置。
2. HDMI 2.0 输入差分对按 100 ohm 约束，最小化过孔和 stub；TMDS181 紧邻输入连接器。
3. 三个 HDMI 口分别放置 TPD12S016，DDC 走线与 TMDS 隔离。
4. 两颗 ADV7511 的输入时钟来自同一低偏斜扇出；不用两个独立晶振。
5. PCB 评审必须包含 stack-up、阻抗报告、PDN、热仿真、BGA escape、HDMI compliance 预扫。

首板 bring-up 顺序：电源 -> JTAG -> DDR -> I2C/MCU -> EDID/HPD -> RX lock -> 单 TX -> 双 TX -> 24 小时稳定性测试。

## 阶段 5：可选 Thunderbolt

只有 HDMI 版本通过全部验收后才开始：

1. JHL9440 暴露 PCIe Gen4 x4 到 FPGA endpoint。
2. Windows 端先用 AMD XDMA 驱动验证 BAR、MSI-X 和持续 DMA，再决定是否写 KMDF 正式驱动。
3. DMA payload 使用独立版本头、frame sequence、stride 和 CRC；至少三缓冲，过期帧直接丢弃。
4. FPGA 收到完整帧后才切换读缓冲；两路 HDMI 仍由同一 1080p timing generator 输出。
5. 完成 USB-IF/Thunderbolt 设计审查、Type-C PD、EMI 和互操作测试。

Thunderbolt 不是 HDMI 方案的线缆替换，而是一条新的 PCIe 设备产品线。
