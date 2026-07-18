# 验证状态与验收表 / Verification Status and Acceptance Criteria

[中文](#中文说明) | [English](#english)

## 中文说明

### 已完成的软件验证

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| 打包/拆包无损 | 小尺寸确定性帧逐通道比较 | 通过 |
| 垂直重复行 | 逐字节比较 | 通过 |
| 单字节错误检测 | 修改传输帧样本 | 通过 |
| 4K/1080有效尺寸关系 | 自动断言 | 通过 |
| CTA总时序关系 | 自动断言 | 通过 |
| 4PPC内部时钟关系 | 自动断言 | 通过 |
| HDMI 2.0 TMDS预算 | 17.82 <= 18Gb/s | 理论通过，余量有限 |
| 双行缓存预算 | 15,360 bytes | 理论通过 |

参考模型计算结果：

```text
输入：3840 x 2160p60 RGB 8-bit
输出：2 x 1920 x 1080p60
有效像素数据：11.943936 Gb/s
输入TMDS：17.82 Gb/s
双输出TMDS合计：8.91 Gb/s
纯像素流水线延迟：约14.8-29.6us
```

这些结果只验证软件模型和预算，不证明物理HDMI链路可用。

### 未验证项目

- GPU是否持续输出RGB 4:4:4 Full且不进行缩放；
- ZCU106 HDMI 2.0 RX在目标显卡、线缆和4K60下的持续锁定；
- AMD HDMI IP的许可、Vivado版本和PHY支持；
- 两路发送器同步释放后的行/帧偏斜；
- 下游切换台对RGB范围、KEY灰阶和时序的处理；
- EMC、ESD、温升、线缆互操作和真实端到端延迟。

### 硬件验收建议

| 类别 | 建议通过标准 |
| --- | --- |
| 输入锁定 | 4K60连续24小时，无RX unlock |
| 帧完整性 | 长时间ramp测试中重复行和KEY RGB错误计数为0 |
| 输出同步 | 两路VS偏斜不超过1个148.5MHz像素时钟，HS无累计漂移 |
| 输出帧率 | 两路均为60/1，无持续重复或丢失 |
| KEY码值 | 0/16/128/235/255误差不超过1 LSB，范围配置明确 |
| FILL色彩 | Rec.709灰阶和色条满足目标切换台的8-bit HDMI容差 |
| 故障模式 | 输入中断后两路同时黑，恢复稳定后同时恢复 |
| 端到端延迟 | 目标低于1ms；超出时说明额外缓存来源 |

最终标准应根据目标切换台、许可和合规要求调整，不能由软件模型单独确认。

### 复现命令

```powershell
node overlay-link-lab\tests\transport-core.test.js
node overlay-link-lab\scripts\verify-theory.js
```

模拟器的错误注入应同时触发重复行一致性和源数据一致性失败；关闭后两项恢复通过。

## English

### Completed software checks

| Item | Method | Result |
| --- | --- | --- |
| Lossless pack/unpack | Per-channel comparison of deterministic small frames | Pass |
| Vertical line repetition | Byte-for-byte comparison | Pass |
| Single-byte error detection | Modify a transport sample | Pass |
| 4K/1080 active-size relationship | Automated assertion | Pass |
| CTA total-timing relationship | Automated assertion | Pass |
| 4PPC internal-clock relationship | Automated assertion | Pass |
| HDMI 2.0 TMDS budget | 17.82 <= 18Gb/s | Theoretical pass with limited margin |
| Two-line-buffer budget | 15,360 bytes | Theoretical pass |

Reference-model output:

```text
Input: 3840 x 2160p60 RGB 8-bit
Output: 2 x 1920 x 1080p60
Active pixel data: 11.943936 Gb/s
Input TMDS: 17.82 Gb/s
Combined output TMDS: 8.91 Gb/s
Pure pixel-pipeline latency: approximately 14.8-29.6us
```

These results validate software logic and budgets only. They do not prove that a physical
HDMI implementation works.

### Unverified items

- sustained GPU output as RGB 4:4:4 Full without scaling;
- ZCU106 HDMI 2.0 RX lock with target GPUs, cables, and 4K60;
- AMD HDMI IP licensing, Vivado version, and PHY support;
- line/frame skew after synchronized transmitter release;
- downstream switcher interpretation of RGB range, KEY grayscale, and timing;
- EMC, ESD, temperature, cable interoperability, and real end-to-end latency.

### Suggested hardware acceptance criteria

| Category | Suggested pass criterion |
| --- | --- |
| Input lock | 24 hours of 4K60 with no RX unlock |
| Frame integrity | Zero repeated-line and KEY RGB errors during a long ramp test |
| Output alignment | VS skew no greater than one 148.5MHz pixel clock and no accumulated HS drift |
| Output rate | Both outputs at 60/1 without sustained repeats or drops |
| KEY codes | Error no greater than 1 LSB at 0/16/128/235/255 with explicit range configuration |
| FILL color | Rec.709 grayscale and bars within the target switcher's 8-bit HDMI tolerance |
| Failure behavior | Both outputs black together after input loss and recover together after stable input |
| End-to-end latency | Target below 1ms; document any additional buffering when exceeded |

Final criteria must be adjusted for the target switcher, licensing, and compliance needs;
the software model cannot confirm them by itself.

### Reproduction commands

```powershell
node overlay-link-lab\tests\transport-core.test.js
node overlay-link-lab\scripts\verify-theory.js
```

Simulator error injection should fail both repeated-line and source-data checks. Both should
return to pass after error injection is disabled.
