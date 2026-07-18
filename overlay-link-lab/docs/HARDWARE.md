# 硬件选型参考 / Hardware Reference

[中文](#中文说明) | [English](#english)

## 中文说明

以下器件状态最后核对于2026-07-14，仅用于未验证的实验原型。采购、许可、供货、板卡电压、
FPGA IP支持和HDMI合规性必须在实际立项时重新确认。

### 第一阶段开发平台

| 优先级 | 型号 / 芯片 | 数量 | 用途 | 说明 |
| --- | --- | ---: | --- | --- |
| 核心 | AMD `EK-U1-ZCU106-G` | 1 | 4K60 HDMI RX、FPGA处理、一路板载HDMI TX | `XCZU7EV-2FFVC1156`，带HDMI输入/输出和两个FMC接口 |
| 核心 | Analog Devices `ADV7511KSTZ` | 1 | FMC原型第二路1080p60 HDMI TX | 225MHz像素时钟能力，需验证FMC电压与时序 |
| 核心 | Texas Instruments `TPD12S016PWR` | 1 | 第二路HDMI DDC/CEC电平与ESD保护 | 应靠近HDMI接口放置 |
| 可选 | Avnet `AES-FMC-IMAGEON-G` | 1 | 现成ADV7511 FMC输出 | 可能停产或缺货，不能作为长期供应基线 |
| 测试 | 同型号、同长度的认证HDMI 2.0线缆 | 3 | 一路输入、两路输出 | 便于排查链路与偏斜差异 |
| 测试 | 逻辑分析仪 | 1 | I2C、HPD、DE/HS/VS和低速控制 | 不能替代HDMI 2.0眼图与合规测试设备 |

没有确认存在可直接提供“一路HDMI 2.0输入和两路同步HDMI输出”的通用开发板。研究方案因此
采用ZCU106板载TX加第二路ADV7511 FMC；在该组合实测前，不应把它视为已验证BOM。

### 第二路HDMI FMC最小组成

| 功能 | 参考器件 | 说明 |
| --- | --- | --- |
| HDMI TX | `ADV7511KSTZ` | 24-bit RGB输入、I2C配置、1080p60 |
| HDMI保护/电平 | `TPD12S016PWR` | DDC、CEC、HPD与ESD保护 |
| HDMI Type-A与FMC连接器 | 按ZCU106原理图和VITA 57.1机械定义选型 | 原理图评审后冻结方向、电压和引脚 |

板载HDMI TX输出FILL，FMC TX输出KEY。两路发送器必须由同一个FPGA时序模块驱动，不能使用
两个异步framebuffer。

### 后续定制板候选

仅在开发板原型通过后评估定制板：

| 功能 | 候选器件 | 数量 |
| --- | --- | ---: |
| FPGA/SoC | AMD `XCZU7EV-2FFVC1156I` | 1 |
| HDMI 2.0 RX重定时 | TI `TMDS181IRGZT` | 1 |
| 1080p HDMI TX | ADI `ADV7511KSTZ` | 2 |
| HDMI保护/电平 | TI `TPD12S016PWR` | 3 |
| 输入EDID EEPROM | ST `M24C02-WMN6TP` | 1 |
| 板级管理MCU | ST `STM32G0B1CBT6` | 1 |

器件降级、成本优化和量产替代应在资源利用率、GT裕量、温升和24小时稳定性实测后进行。

### Thunderbolt备选路线

Intel `JHL9440`可作为后续Thunderbolt 4/PCIe研究候选，但它需要USB-C PD、固件、参考设计、
PCIe DMA驱动和认证。双HDMI输出仍需FPGA和两颗发送器；DisplayPort MST通常不能提供广播级
行同步。因此该路线不是HDMI原型的直接线缆替换。

### 许可与供应风险

- HDMI产品开发与销售可能要求HDMI Adopter资格和合规测试。
- AMD HDMI RX/TX Subsystem IP许可、PHY支持矩阵和Vivado版本需要单独确认。
- HDCP需要额外授权、密钥和安全存储，本实验协议不包含HDCP。
- 停产或单一来源FMC只能用于实验加速，不能直接成为量产依赖。

### 官方来源

- [AMD ZCU106 Evaluation Kit](https://www.amd.com/en/products/adaptive-socs-and-fpgas/evaluation-boards/zcu106.html)
- [Analog Devices ADV7511](https://www.analog.com/en/products/adv7511.html)
- [Intel JHL9440 Thunderbolt 4 Accessory Controller](https://www.intel.com/content/www/us/en/products/sku/225918/intel-jhl9440-thunderbolt-4-accessory-controller/specifications.html)

## English

The component status below was last reviewed on 2026-07-14 and applies only to an
unvalidated experimental prototype. Availability, licensing, board voltages, FPGA IP
support, and HDMI compliance must be checked again before procurement or product work.

### First-stage development platform

| Priority | Part | Qty. | Purpose | Notes |
| --- | --- | ---: | --- | --- |
| Core | AMD `EK-U1-ZCU106-G` | 1 | 4K60 HDMI RX, FPGA processing, one onboard HDMI TX | `XCZU7EV-2FFVC1156`, HDMI input/output, and two FMC sites |
| Core | Analog Devices `ADV7511KSTZ` | 1 | Second 1080p60 HDMI TX on an FMC prototype | 225MHz pixel-clock capability; FMC voltage and timing require validation |
| Core | Texas Instruments `TPD12S016PWR` | 1 | DDC/CEC level shifting and ESD protection | Place near the HDMI connector |
| Optional | Avnet `AES-FMC-IMAGEON-G` | 1 | Existing ADV7511 FMC output | May be obsolete or unavailable; not a long-term supply baseline |
| Test | Matching certified HDMI 2.0 cables | 3 | One input and two outputs | Matching length helps isolate link and skew differences |
| Test | Logic analyzer | 1 | I2C, HPD, DE/HS/VS, and low-speed control | Does not replace HDMI 2.0 eye-diagram or compliance equipment |

No general-purpose development board has been confirmed to provide one HDMI 2.0 input and
two synchronized HDMI outputs directly. The research design therefore combines the ZCU106
onboard TX with a second ADV7511 FMC. It is not a validated BOM until tested physically.

### Minimum second-output FMC

| Function | Reference part | Notes |
| --- | --- | --- |
| HDMI TX | `ADV7511KSTZ` | 24-bit RGB input, I2C configuration, 1080p60 |
| HDMI protection/level shifting | `TPD12S016PWR` | DDC, CEC, HPD, and ESD protection |
| HDMI Type-A and FMC connectors | Select from the ZCU106 schematic and VITA 57.1 definition | Freeze orientation, voltages, and pins after schematic review |

The onboard HDMI TX carries FILL and the FMC TX carries KEY. Both transmitters must use
the same FPGA timing generator rather than asynchronous framebuffers.

### Later custom-board candidates

Evaluate a custom board only after the development-board prototype passes:

| Function | Candidate | Qty. |
| --- | --- | ---: |
| FPGA/SoC | AMD `XCZU7EV-2FFVC1156I` | 1 |
| HDMI 2.0 RX retimer | TI `TMDS181IRGZT` | 1 |
| 1080p HDMI TX | ADI `ADV7511KSTZ` | 2 |
| HDMI protection/level shifting | TI `TPD12S016PWR` | 3 |
| Input EDID EEPROM | ST `M24C02-WMN6TP` | 1 |
| Board-management MCU | ST `STM32G0B1CBT6` | 1 |

Part reduction, cost optimization, and production substitutions should follow measured
resource use, GT margin, temperature, and 24-hour stability results.

### Thunderbolt alternative

Intel `JHL9440` is a possible later Thunderbolt 4/PCIe research candidate, but it requires
USB-C PD, firmware, reference-design access, PCIe DMA software, and certification. The two
HDMI outputs still require an FPGA and two transmitters. DisplayPort MST does not generally
provide broadcast-grade line alignment, so this is not a drop-in cable replacement for the
HDMI prototype.

### Licensing and supply risks

- HDMI product development and sale may require HDMI Adopter status and compliance testing.
- AMD HDMI RX/TX Subsystem licensing, PHY support, and Vivado compatibility require separate confirmation.
- HDCP adds licensing, keys, and secure storage and is not part of this experimental protocol.
- Obsolete or single-source FMC cards may accelerate experiments but are not production dependencies.

### Official sources

- [AMD ZCU106 Evaluation Kit](https://www.amd.com/en/products/adaptive-socs-and-fpgas/evaluation-boards/zcu106.html)
- [Analog Devices ADV7511](https://www.analog.com/en/products/adv7511.html)
- [Intel JHL9440 Thunderbolt 4 Accessory Controller](https://www.intel.com/content/www/us/en/products/sku/225918/intel-jhl9440-thunderbolt-4-accessory-controller/specifications.html)
