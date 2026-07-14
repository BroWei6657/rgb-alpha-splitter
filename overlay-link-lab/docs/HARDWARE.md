# 硬件型号与购置建议

规格与产品状态核对日期：2026-07-14。当前没有硬件，不建议立即采购；先用本目录的模拟器和参考模型冻结协议。

## 第一阶段开发平台

| 优先级 | 型号 / 芯片 | 数量 | 用途 | 结论 |
| --- | --- | ---: | --- | --- |
| 必选 | AMD `EK-U1-ZCU106-G` | 1 | 4K60 HDMI RX、FPGA 处理、一路板载 HDMI TX | 首选；核心为 `XCZU7EV-2FFVC1156`，有 HDMI 输入/输出和 2 个 FMC |
| 必选 | Analog Devices `ADV7511KSTZ` | 1 | FMC 原型的第二路 1080p60 HDMI TX | 225 MHz，足够 1080p60；与板载 TX 组成双输出 |
| 必选 | Texas Instruments `TPD12S016PWR` | 1 | 第二路 HDMI 的 DDC/CEC 电平与 ESD 保护 | 放在 FMC HDMI 接口附近 |
| 可选 | Avnet `AES-FMC-IMAGEON-G` | 1 | 现成 ADV7511 FMC 输出 | 仅在授权渠道确认库存和 ZCU106 电压兼容后购买；有停产/缺货风险 |
| 必选 | Club 3D `CAC-1372` 2 m HDMI 线 | 3 | 一路输入、两路输出 | 原型阶段固定同型号、同长度，便于偏斜排查 |
| 建议 | Digilent `Digital Discovery` | 1 | I2C、HPD、DE/HS/VS 和低速控制调试 | 不能替代 HDMI 2.0 眼图仪 |

AMD 官方页列出的 ZCU106 料号是 `EK-U1-ZCU106-G`，页面显示 ZU7EV、HDMI 输入/输出、两个 FMC，官方标价为 USD 3,234，交期示例为 8 周。价格和交期采购前必须重新确认。

没有发现一块可直接承诺“1 路 HDMI 2.0 输入 + 2 路同步 HDMI 输出”的现成开发板，因此第二路 TX FMC 是这条路线中唯一需要先做的小板。不要在这一阶段直接做完整主板。

## 第二路 HDMI FMC 最小 BOM

| 器件 | 推荐具体型号 | 说明 |
| --- | --- | --- |
| HDMI TX | `ADV7511KSTZ` | 24-bit RGB 输入，I2C 配置，1080p60 |
| HDMI 保护/电平 | `TPD12S016PWR` | DDC、CEC、HPD 与 ESD 保护 |
| HDMI Type-A 与 FMC 连接器 | 按 ZCU106 原理图和 VITA 57.1 机械定义选型 | 在原理图评审后冻结，避免误选载板/子卡方向 |

FMC 第一版只装一颗 ADV7511。板载 HDMI TX 输出 FILL，FMC ADV7511 输出 KEY。两路 TX 必须由同一个 FPGA 时序模块驱动，不能用两个异步 framebuffer。

## 定制主板候选

在 ZCU106 + FMC 通过后，首块定制板继续使用下列器件，优先复用已验证 RTL 和约束：

| 功能 | 推荐具体型号 | 数量 |
| --- | --- | ---: |
| FPGA/SoC | AMD `XCZU7EV-2FFVC1156I` | 1 |
| HDMI 2.0 RX 重定时 | TI `TMDS181IRGZT` | 1 |
| 1080p HDMI TX | ADI `ADV7511KSTZ` | 2 |
| HDMI 保护/电平 | TI `TPD12S016PWR` | 3 |
| 输入 EDID EEPROM | ST `M24C02-WMN6TP` | 1 |
| 板级管理 MCU | ST `STM32G0B1CBT6` | 1 |

首块定制板不以降成本为目标。等资源利用率、GTH 裕量和温升实测完成后，再评估降到 `XCZU4EV`；不要在原型前期同时更换 FPGA 系列。

## Thunderbolt 备选路线

如果 HDMI 原型通过后仍需要一根可同时承载数据、控制和供电的线，设备端候选是 Intel `JHL9440 Thunderbolt 4 Accessory Controller`。Intel 官方规格列出 PCIe Gen4 x4、2 个 DP Sink 和 3 个 DP Source。

这条路线不作为首版，原因是：

- JHL9440 需要 Intel 参考设计、USB-C/PD、固件和 Thunderbolt/USB4 认证；
- PC 不再把设备只当显示器，需要 PCIe DMA 驱动和稳定的帧队列；
- 双 HDMI 仍然需要 FPGA 和两颗 ADV7511，不能由 Thunderbolt 控制器自动产生同步 KEY/FILL；
- 认证与高速 Type-C PCB 风险高于当前核心算法风险。

因此现在不要购买 JHL9440。进入该阶段时，硬件基线为 `JHL9440 + XCZU7EV + 2 x ADV7511`，软件基线为 PCIe Gen4 x4 DMA，而不是 DisplayPort MST；MST 的两个显示流通常不保证广播级行同步。

## 许可与供应风险

- ADV7511 官方页明确说明，购买实现 HDMI 技术的产品可能要求客户是 HDMI Adopter。自研销售硬件前必须处理 HDMI 许可、商标和合规。
- AMD HDMI RX/TX Subsystem IP 的生产许可、HDMI PHY 支持矩阵和 Vivado 版本必须在采购前确认。
- 原型固定关闭 HDCP。加入 HDCP 会引入密钥、授权和安全存储，不属于 Overlay MVP。
- `AES-FMC-IMAGEON-G` 只作为可选加速件，不能成为长期量产依赖。

## 已核对的官方来源

- [AMD ZCU106 Evaluation Kit](https://www.amd.com/en/products/adaptive-socs-and-fpgas/evaluation-boards/zcu106.html)
- [Analog Devices ADV7511](https://www.analog.com/en/products/adv7511.html)
- [Intel JHL9440 Thunderbolt 4 Accessory Controller](https://www.intel.com/content/www/us/en/products/sku/225918/intel-jhl9440-thunderbolt-4-accessory-controller/specifications.html)
