# Overlay Link Lab

[中文](#中文说明) | [English](#english)

## 中文说明

Overlay Link Lab是与RGB Alpha Splitter运行代码隔离的硬件研究资料，探索通过一条HDMI链路
传输FILL与KEY，再由外部硬件生成两路同步HDMI输出。它不是主程序的运行功能，也没有完成
硬件实机验证。

### 当前结论

首个原型优先研究HDMI 2.0：PC在一帧`3840 x 2160p60 RGB 4:4:4 8-bit`画面中并排打包
FILL和KEY，FPGA使用行缓存拆分为两路`1920 x 1080p60`。两路输出共用像素时钟与同步计数器，
理论上能够保持帧、行同步。

现有参考模型只验证了几何、时序和带宽关系。HDMI PHY、EDID、线缆误码、输出偏斜、许可和
真实切换台兼容性均未验证，因此本文档不能作为可直接生产或采购的硬件方案。

### 项目边界

- 本目录不修改主程序的输入、输出、原生模块或兼容协议。
- 软件集成应使用独立companion进程，以只读方式消费主程序输出。
- 不包含HDCP、硬件genlock、SDI接口或已验证的量产设计。
- Thunderbolt/PCIe路线仅为后续研究方向，不属于首个原型范围。

### 目录

```text
overlay-link-lab/
  docs/                  协议、硬件选型、实施与验收说明
  protocol/              可机读的传输协议参数
  scripts/               理论预算检查
  simulator/             无硬件浏览器仿真器
  src/                   可复用打包/拆包参考模型
  tests/                 协议往返和错误检测测试
```

### 本地验证

直接打开`overlay-link-lab/simulator/index.html`可查看浏览器仿真器。运行理论与参考模型测试：

```powershell
node overlay-link-lab\scripts\verify-theory.js
node overlay-link-lab\tests\transport-core.test.js
```

模拟器刷新率不代表硬件输出帧率；协议目标固定为60Hz。

### 文档

- [传输协议](docs/PROTOCOL.md)
- [硬件选型参考](docs/HARDWARE.md)
- [实施过程](docs/IMPLEMENTATION.md)
- [验证状态与验收表](docs/VERIFICATION.md)

## English

Overlay Link Lab is hardware research isolated from the RGB Alpha Splitter runtime. It
explores carrying FILL and KEY over one HDMI link and using external hardware to generate
two synchronized HDMI outputs. It is not a runtime feature of the main application and
has not been validated on physical hardware.

### Current conclusion

The first prototype should investigate HDMI 2.0. The PC packs FILL and KEY side by side
inside a `3840 x 2160p60 RGB 4:4:4 8-bit` frame. An FPGA uses line buffers to split the
transport into two `1920 x 1080p60` outputs. A shared pixel clock and timing counter can
theoretically keep the outputs aligned at frame and line level.

The reference model validates only geometry, timing, and bandwidth relationships. HDMI
PHY behavior, EDID compatibility, cable errors, output skew, licensing, and production
switcher compatibility remain untested. These documents are not a production-ready design
or purchasing specification.

### Scope

- This directory does not modify the main application's inputs, outputs, native module, or compatibility protocol.
- Software integration should use a separate read-only companion process.
- HDCP, hardware genlock, SDI interfaces, and a validated production design are out of scope.
- Thunderbolt/PCIe remains a later research option, not part of the first prototype.

### Directory

```text
overlay-link-lab/
  docs/                  Protocol, hardware, implementation, and verification notes
  protocol/              Machine-readable transport parameters
  scripts/               Theory and budget checks
  simulator/             Browser simulator that requires no hardware
  src/                   Reusable pack/unpack reference model
  tests/                 Round-trip and error-detection tests
```

### Local verification

Open `overlay-link-lab/simulator/index.html` directly to use the browser simulator. Run the
theory and reference-model checks with:

```powershell
node overlay-link-lab\scripts\verify-theory.js
node overlay-link-lab\tests\transport-core.test.js
```

The simulator refresh rate is not a hardware output rate. The protocol target remains 60Hz.

### Documentation

- [Transport protocol](docs/PROTOCOL.md)
- [Hardware reference](docs/HARDWARE.md)
- [Implementation process](docs/IMPLEMENTATION.md)
- [Verification status and acceptance criteria](docs/VERIFICATION.md)
