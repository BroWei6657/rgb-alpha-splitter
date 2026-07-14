# Overlay Link Lab

这是一个与旧应用运行代码隔离的单线 Overlay 研究项目。目标是让现有 RGB Alpha Splitter 的画面经一根 HDMI 或 Thunderbolt 线进入硬件，再由硬件输出同步的 HDMI FILL 和 HDMI KEY。

## 当前结论

首版应选 **HDMI 2.0**，不应先做 Thunderbolt。

- PC 把 FILL 放在 4K60 帧左半边，把 KEY 放在右半边，并把每个 1080p 源行重复两次。
- FPGA 接收标准 `3840x2160p60 RGB 4:4:4 8-bit`，用约 `15 KiB` 双行缓存拆成两路 `1920x1080p60`。
- 两路输出共用同一个 148.5 MHz 时钟和同步计数器，能够保持帧、行同步。
- HDMI 路线对 PC 表现为普通显示器，不需要专用硬件驱动。Thunderbolt 路线需要 PCIe DMA 驱动、控制器参考设计和认证，留到 HDMI 原型通过后再评估。

理论模型已证明几何、时序和带宽关系成立，但目前还没有证明 HDMI PHY、EDID 兼容性、线缆误码率、双输出偏斜和真实切换台兼容性。这些必须在有硬件后实测。

## 项目边界

- 本目录不修改 `main.js`、`src/`、`native/` 或旧应用的输出逻辑。
- 旧应用 ID `com.ndialphasplitter.desktop` 保持不变。
- 旧共享内存标识 `Local\\NDIAlphaSplitter.Frame.v1` / `/NDIAlphaSplitter.Frame.v1` 保持不变。
- 后续软件集成应做成独立 companion 进程，以只读方式消费旧共享帧，不改变旧应用协议。

## 目录

```text
overlay-link-lab/
  docs/                  协议、硬件选型、实施与验收说明
  protocol/              可机读的传输协议参数
  scripts/               理论预算检查
  simulator/             无硬件浏览器仿真器
  src/                   可复用打包/拆包参考模型
  tests/                 协议往返和错误检测测试
```

## 立即运行

直接打开：

```text
overlay-link-lab/simulator/index.html
```

运行理论验证和参考模型测试：

```powershell
node overlay-link-lab\scripts\verify-theory.js
node overlay-link-lab\tests\transport-core.test.js
```

## 文档入口

- [传输协议](docs/PROTOCOL.md)
- [硬件型号与购置建议](docs/HARDWARE.md)
- [软件、FPGA、PCB 和驱动实施过程](docs/IMPLEMENTATION.md)
- [当前验证结果与硬件验收表](docs/VERIFICATION.md)

## 当前阶段禁止项

- 不购买 Thunderbolt 控制器或开始认证。
- 不开发 HDCP；Overlay 专用链路固定为无 HDCP。
- 不做自研 HDMI 2.0 主板，先用 ZCU106 和第二路 HDMI FMC 验证。
- 不把模拟器的 30 fps 浏览器刷新率误认为硬件输出帧率；协议目标始终是 60 Hz。
