# 来源、定位与证据边界

资料核对日期：2026-10-25。现代数学文献与传统材料分别使用，不将两类资料互相当作预测证据。

## 数学文献

1. Edward N. Lorenz (1963), *Deterministic Nonperiodic Flow*, Journal of the Atmospheric Sciences 20(2), 130–141。[原始论文期刊页](https://journals.ametsoc.org/view/journals/atsc/20/2/1520-0469_1963_020_0130_dnf_2_0_co_2.xml)，[DOI](https://doi.org/10.1175/1520-0469%281963%29020%3C0130%3ADNF%3E2.0.CO%3B2)。支持确定性非线性系统的非周期运动和初态敏感性，不支持八字映射。本项目没有使用 Lorenz 方程替代当前 Langford 扩展方程。
2. John Milnor (1985), *On the concept of attractor*, Communications in Mathematical Physics 99, 177–195。[原始期刊页](https://link.springer.com/article/10.1007/BF01212280)。吸引子涉及轨迹长期行为，不等同于一次有限时窗的美观图像。
3. Brian R. Hunt and Edward Ott (2015), *Defining Chaos*, Chaos 25, 097618。[作者预印本 v3](https://arxiv.org/abs/1501.07896v3)，[DOI](https://doi.org/10.1063/1.4922973)。提出基于扩张熵的定义；本项目未计算该文的扩张熵，不能借此声称所有输出已获混沌认证。

## 指定传统资料：只用已核对的符号层

以下定位来自项目指定“道家八字资料”的工作电子录文与 v0.3 既有来源摘录。L 号是当时抓取录文的定位，不是扫描页码；原文、现代校记和研究者解释分开。公开仓库不复制三本书、扫描件或整段现代注解。

| 来源 | 本地定位 | 支持的范围与限制 |
|---|---|---|
| 《子平真诠·论用神》 | U005-Z08-R，L48、L52、L54；汇编物理行 144、148、152 | “以日干配月令地支”；支持有序四柱、日干和月令参照。不提供数值预算。 [来源页](https://www.donglishuzhai.net/chapter/3721.html) |
| 《子平真诠·论用神成败救应》 | U006-Z09-R，L48；汇编物理行 163 | 月令候选需要四柱配合，不能仅凭一个标签宣称成格。 [来源页](https://www.donglishuzhai.net/chapter/3722.html) |
| 《子平真诠·论用神变化》 | U006-Z10-R，L48；汇编物理行 186 | 寅支藏干成员的例子。不是完整十二支固定表的统一权重。 [来源页](https://www.donglishuzhai.net/chapter/3723.html) |
| 《三命通会》卷二“论遁月时” | U013S02，L218–223 | 年干与月干、日干与时干的关系；工作录文有“巳/己”字形问题，不静默当作影像核正。 [上游电子本](https://zh.wikisource.org/wiki/三命通會_(四庫全書本)/卷02) |
| 《三命通会》卷二“论人元司事” | U013S02，L170–174 | 地支藏干与分日司事观念；分日天数不等同本项目固定平均编码。 [上游电子本](https://zh.wikisource.org/wiki/三命通會_(四庫全書本)/卷02) |
| 《三命通会》卷五“论古人立印食官财名义及各神名义” | U013S05，L116；汇编物理行 3927 | 日干参照、生我/我生/克我/我克、天干阴阳五行和地支方位五行。没有将其吉凶断语编为已经验证的结论。 [上游电子本](https://zh.wikisource.org/wiki/三命通會_(四庫全書本)/卷05) |

固定藏干表、合冲表和历法口径同时由代码公开。对未被来源直接支持的数值常数，只标记为项目设计。主界面的传统符号不是完整“命格诊断”，不根据形态给富贵、健康或性格结论。

## 历法软件

[lunar-javascript](https://github.com/6tail/lunar-javascript)，打包版本 1.7.7，MIT License。该库提供历法、节气与排运计算；使用库不代表其全部命理解释已被科学验证。版本、日界、UTC+08、起运 sect 配置以 [model-contract.md](model-contract.md) 和运行页为准。系统不加载远程 CDN。

## 项目内部证据

[validation-baseline.json](validation-baseline.json) 保存 v0.9 开发、留出和 500 图批次的摘要、原始本地文件相对定位与 SHA256。只分发摘要；没有把大量内部轨迹、用户私人附件或三本书上传仓库。仓库内当前代码与契约可复算新输入；旧批次原始资料仍保留于原工作区。

来源“可追溯”仅指能够指出编码所参照的文本及实际计算规则；不等于已经证明古代概念与现代方程同构。
