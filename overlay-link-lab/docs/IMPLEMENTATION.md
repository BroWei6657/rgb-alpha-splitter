# 实施过程 / Implementation Process

[中文](#中文说明) | [English](#english)

## 中文说明

本流程描述实验研究顺序，不代表已完成的硬件功能。每一阶段必须通过对应验证后才能进入下一阶段。

### 阶段0：无硬件协议验证

1. 运行`node overlay-link-lab\tests\transport-core.test.js`，验证打包、拆包、重复行和错误检测。
2. 运行`node overlay-link-lab\scripts\verify-theory.js`，验证几何、时序和带宽断言。
3. 打开`simulator/index.html`检查测试图、KEY增益、反转和错误注入。
4. 协议映射发生不兼容变更时必须增加协议版本。

### 阶段1：独立PC companion

companion应与主程序解耦，只读消费兼容帧并生成固定HDMI传输画面：

```text
RGB Alpha Splitter
  -> read-only shared frame
  -> Overlay Link companion
  -> D3D11 3840 x 2160 fullscreen swap chain
  -> selected HDMI transport display
```

实现要求：

1. 复用共享帧序列校验，只读映射，不创建新的共享内存owner。
2. D3D11 pixel shader将FILL写入左半幅，将Alpha灰度写入右半幅，并把每条源行重复两次。
3. 输出固定为`DXGI_FORMAT_R8G8B8A8_UNORM`、3840 x 2160、60/1，关闭HDR、缩放和色彩增强。
4. 只有检测到精确目标模式时才允许输出，并记录Present时间、丢帧、序列号、显示模式和适配器LUID。

HDMI路线把设备呈现为普通显示器，不需要专用设备驱动。

### 阶段2：ZCU106单输入单输出

先验证输入协议和一路FILL输出，KEY通过ILA抽样：

1. 使用ZCU106 board preset、HDMI 2.0 RX Subsystem、Video Timing Controller和ILA。
2. RX固定为RGB 4PPC @ 148.5MHz，不加入VDMA、缩放器或VCU。
3. 实现重复行检查、左右半幅拆分和ping-pong行缓存。
4. 使用静态ramp和moving edge检查通道顺序、范围和行对齐。

建议模块边界：

```text
olk_rx_guard        输入时序、RGB、重复行和KEY三通道检查
olk_line_split      左右半幅拆分、ping-pong BRAM
olk_1080_timing     单一2200 x 1125输出计数器
olk_fill_out        24-bit RGB读口
olk_key_out         8-bit到RGB及Full/Limited映射
olk_status_regs     锁定状态和错误计数器
```

### 阶段3：双HDMI输出

1. 第二路ADV7511先使用独立彩条发生器验证I2C配置和1080p60输出。
2. 板载TX与FMC TX共用pixel clock、HS、VS和DE。
3. FILL输出24-bit RGB；KEY输出三通道相同的灰度。
4. 上电后依次完成电源、EDID、RX lock、缓存清零，再同时释放两个TX reset。
5. 输入或缓存错误持续超过两帧时，两路同时输出黑；连续30帧无错后同时恢复。

使用示波器测量两路VS/HS偏斜，并用实际切换台检查External Key边缘和码值范围。

### 阶段4：定制PCB

只有开发板方案通过后才开始定制板：

1. 冻结FPGA引脚、GT quad、时钟和发送器寄存器配置。
2. HDMI差分对按100ohm约束，控制过孔与stub，并把重定时器靠近输入接口。
3. 分别处理HDMI接口ESD、DDC和HPD，保持低速控制与TMDS隔离。
4. 两个发送器使用同一低偏斜时钟源，不使用独立晶振。
5. 评审stack-up、阻抗、PDN、热、BGA escape和HDMI合规预扫。

bring-up顺序：电源、JTAG、DDR、I2C/MCU、EDID/HPD、RX lock、单TX、双TX、24小时稳定性。

### 阶段5：可选Thunderbolt/PCIe

该阶段仅在HDMI原型完成后评估：设备端通过PCIe DMA传输带版本、序列、stride和CRC的帧，
至少使用三缓冲并丢弃过期帧。双HDMI仍由单一FPGA时序发生器输出。Thunderbolt路线需要单独
完成驱动、USB-C PD、固件、EMI和互操作认证。

## English

This process describes an experimental research sequence, not completed hardware
functionality. Each stage must pass its verification criteria before the next begins.

### Stage 0: protocol validation without hardware

1. Run `node overlay-link-lab\tests\transport-core.test.js` to verify packing, unpacking, repeated lines, and error detection.
2. Run `node overlay-link-lab\scripts\verify-theory.js` to verify geometry, timing, and bandwidth assertions.
3. Open `simulator/index.html` to inspect test patterns, KEY gain, inversion, and error injection.
4. Increment the protocol version for any incompatible mapping change.

### Stage 1: independent PC companion

The companion remains separate from the main application. It reads compatibility frames
and produces the fixed HDMI transport image:

```text
RGB Alpha Splitter
  -> read-only shared frame
  -> Overlay Link companion
  -> D3D11 3840 x 2160 fullscreen swap chain
  -> selected HDMI transport display
```

Requirements:

1. Reuse shared-frame sequence validation with a read-only mapping and do not create a new shared-memory owner.
2. Use a D3D11 pixel shader to place FILL on the left and Alpha grayscale on the right while repeating each source line twice.
3. Fix output at `DXGI_FORMAT_R8G8B8A8_UNORM`, 3840 x 2160, 60/1 with HDR, scaling, and color enhancement disabled.
4. Enable output only when the exact mode is detected and record Present timing, drops, sequence, display mode, and adapter LUID.

The HDMI route presents as an ordinary display and does not require a device-specific driver.

### Stage 2: ZCU106 single input and output

Validate the transport input and one FILL output first while sampling KEY through ILA:

1. Use the ZCU106 board preset, HDMI 2.0 RX Subsystem, Video Timing Controller, and ILA.
2. Fix RX at RGB 4PPC @ 148.5MHz without VDMA, scaling, or VCU blocks.
3. Implement repeated-line checks, left/right splitting, and ping-pong line buffers.
4. Use static ramps and moving edges to check channel order, range, and line alignment.

Suggested modules:

```text
olk_rx_guard        Input timing, RGB, repeated-line, and KEY-channel checks
olk_line_split      Left/right split and ping-pong BRAM
olk_1080_timing     Single 2200 x 1125 output counter
olk_fill_out        24-bit RGB read port
olk_key_out         8-bit to RGB and Full/Limited mapping
olk_status_regs     Lock state and error counters
```

### Stage 3: dual HDMI output

1. Validate the second ADV7511 I2C setup and 1080p60 output with an independent color-bar generator.
2. Drive the onboard TX and FMC TX from the same pixel clock, HS, VS, and DE.
3. Output 24-bit RGB for FILL and replicated grayscale for KEY.
4. Complete power, EDID, RX lock, and buffer clear before releasing both TX resets together.
5. If input or buffer errors persist for more than two frames, black both outputs; restore them after 30 clean frames.

Measure VS/HS skew with an oscilloscope and verify External Key edges and code ranges on the target switcher.

### Stage 4: custom PCB

Start a custom board only after the development-board design passes:

1. Freeze FPGA pins, GT quad, clocks, and transmitter register settings.
2. Route HDMI differential pairs at 100ohm, control vias and stubs, and place the retimer near the input.
3. Handle ESD, DDC, and HPD at each connector while isolating low-speed control from TMDS.
4. Feed both transmitters from one low-skew clock source rather than independent oscillators.
5. Review stack-up, impedance, PDN, thermal design, BGA escape, and HDMI pre-compliance.

Bring-up order: power, JTAG, DDR, I2C/MCU, EDID/HPD, RX lock, one TX, two TX, then a 24-hour stability run.

### Stage 5: optional Thunderbolt/PCIe

Evaluate this stage only after the HDMI prototype is complete. PCIe DMA frames need a
version, sequence, stride, CRC, and at least three buffers with stale-frame rejection. A
single FPGA timing generator still drives both HDMI outputs. The Thunderbolt path requires
separate driver, USB-C PD, firmware, EMI, and interoperability work.
