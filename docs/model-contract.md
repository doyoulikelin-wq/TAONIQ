# TAONIQ 模型契约 v0.10.0

这一版是对既有 v0.9 实验模型的通用输入工程适配。它不是命理预测器。历法标签、工程参数、微分方程与有限时间形态检查各有独立含义。

## 加载和运行

浏览器只需先加载 `assets/model/worker-source.js`，再加载界面脚本。它同时提供 `TaoModel` 和 `TaoWorker`，全部依赖在仓库内；不请求网络，不需要服务端，双击 HTML 的 `file://` 路径也可使用 Blob Worker。

源代码或冻结 JSON 改动后执行：

```sh
node assets/model/build.cjs
node --test tests/model.test.cjs
```

`build.cjs` 将 lunar-javascript、数据、编码、驱动、积分器、形态检查、距离函数、出生映射及 API 按依赖顺序打包。不要只修改生成后的 `worker-source.js`。第三方许可证在 `assets/vendor/lunar-MIT-LICENSE.txt`。

## 日期与历法

```js
const chart = TaoModel.chart({birth: '1991-03-08T11:37:28', gender: 'female'});
const temporal = TaoModel.temporal(chart, Date.now());
```

- 输入范围是公历 1901-01-01 至当前时刻，字符串严格校验合法日历、时分秒。
- 固定 UTC+08；不根据设备时区变化，不处理历史夏令时、出生地和真太阳时。输入应按这一约定准备。
- 冻结依赖 lunar-javascript 1.7.7；八字 `EightChar.setSect(1)`，23:00 换日；年、月按节气精确时刻。
- 起运用 `getYun(male ? 1 : 0, 2)`。这是传统顺逆排运的二元规则选择，不是对真实身份的推断。
- 起运的节气时差按分钟字段折算，秒不参与时差折算；出生秒仍保留在公历时间和起运时刻中。
- 每步大运从个人第一步起运时刻按十个公历年推进，左闭右开；闰日到非闰年钳到 2 月 28 日。此公历周年约定是工程选择。
- 起运前大运为空且输入为零，不用月柱或小运替代，不向其他时间层重新分配预算。

`chart` 含 `input/birth/birthMs/gender/pillars/parameters/values/visibleWuxing/hiddenWuxing/dayMaster/dayMasterElement/key/profile/dayun`。
`dayun` 含 `firstStartMs/firstStart/direction/directionSign/startAge/boundaryJie`。
`temporal` 含 `dateTime/epochMs/flowPillars/pillars/dayun/layers`；五层 `pillars` 顺序是大运（或 null）、流年、流月、流日、流时。

## 生辰核映射

沿用 v0.3：四个有序柱各形成二维天干/地支/藏干圆周特征，得到原始八特征；再用原型距离编码五行总量、藏干量、柱间对比与相邻柱相互关系。33 个冻结结构原型关联参数锚点；八参数为：

`anchor + halfwidth × 0.25 × (2 × feature − 1)`。

这些权重、原型、距离、半宽及参数对应都是本项目的工程设定。四柱顺序参与计算；不是仅以五行总量查图。八个原有合成案例按完整四柱键保留历史参数浮点，确保 v0.9 重现。

### v0.10 输入域适配

旧 v0.3 最近锚点有时不满足后续驱动对 β 与 κ 的输入域约束。通用输入模式按**原有结构距离排序**选择最近且满足参数域的锚点，八特征微扰公式不变。返回：

- `domainFallback`：是否采用第二个或更后面的合格区域；
- `originalAnchorId/originalPrototypeIndex`：原始最近区域；
- `anchorId/prototypeIndex`：实际采用区域；
- `mappingVersion`：适配发生时为 `v0.10-nearest-admissible-domain-adapter`。

这不保证该区域所有驱动条件都复杂或稳定。若所有区域都不合格，错误描述模型尚不支持此映射，不将合法生辰称为无效。`domainFallback` 是模型输入域适配，与 `profile.fallback` 的校准后旧映射回退不同。

## 流盘计算

```js
const result = await TaoModel.compute({
  chart, epochMs: Date.now(),
  enabled: [true,true,true,true,true],
  multipliers: [1,1,1,1,1],
  windowDays: 90,
  profile // 可选；保存过的校准结果
}, {onProgress, shouldCancel});
```

输入权重归一化自 `1 : 0.3 : 0.09 : 0.027 : 0.0081`，独立开关与 0–2 倍强度。最大输入预算属于大运，**不保证所有情况下最终几何效应严格按此大小排序**。关闭层的贡献精确为零，不改变出生专属映射路线。

返回 `baseline/custom/noDayun` 三个独立 Float64Array，都是 `[x0,y0,z0,x1,y1,z1,...]`。另返回 `chart/temporal/profile/parameters/diagnostics/protocol/morphology/projection`。

- `baseline`：八出生参数恒定积分得到的生辰核；
- `custom`：所选日期和控件状态下的流盘；
- `noDayun`：同日期、同路线、同其他开关强度，仅关闭大运。
- 共享投影 `center/radius/camera_degrees`，不对每张图自动归一缩放或旋转；交互观察若允许旋转/缩放，两图应同步。

v0.10.1 显示层使用 `assets/view3d.js` 的真实 xyz 透视相机；相机到共享中心距离为 `3.2 × radius`，中心平面保留原世界尺度。原始相邻轨迹点保持连接，按固定世界深度分 12 档明暗和线宽，不按深度重新连接顶点。两图同步旋转与缩放，默认 6°/秒、可调 2–12°/秒；自动绘制限制为最高约 30 次/秒，这不是已经测得的设备帧率。旋转不触发积分、不改变日期或坐标。

时间轴默认逐月步进，结果完成后停留 4 秒，可选 2/8 秒，并提供上一步/下一步。该节奏是本版设计：v0.6 提供的是年、月、日、时前后手动步进，没有自动播放时长可照搬。导出 `animation` 保存步长、停留时间及旋转设置，`projection.type` 和 `cameraDistanceRadii` 保存透视口径。

积分仍是 v0.9 三维扩展 Langford 方程，RK4，初值 `[0.1,0,0]`，暂态 600 模型单位，观察默认 90，步长 0.0025，采样 0.01。`windowDays` 是历史 API 名称，**单位是模型时间，不是现实天数**。

每个公历时间点冻结驱动参数后重新积分。时间轴展示日期对应的形态序列，**不是从出生到现在连续累积的动力状态**，中间插值也不能冒充积分历史。

### 方程

令 `r²=x²+y²`、`Ω=δ+ζz+ηx`：

```text
x' = (z−β)x − Ωy + κyz
y' = Ωx + (z−β)y + κxz
z' = τ + αz − z³/3 − r²(1+εz) − 2κxy
```

参数顺序为 `alpha,beta,tau,delta,epsilon,zeta,kappa,eta`。全部关闭精确返回出生参数与同一条出生轨迹；无隐藏装饰、裁剪、重试选漂亮图或按当前日期更换路线。

## 真正的出生专属校准

```js
const {profile, summaries} = await TaoModel.calibrate(chart, {onProgress, shouldCancel});
```

未知生辰先返回 `profile.status='uncalibrated_preview'`，明确使用 v0.8 未校准预览。用户触发校准后，执行冻结 `birth-only-canonical-v1.1`：9 候选 × 12 标准探针 × 7 控件状态，共 **756 次真实积分**。探针、候选、阈值全见 `assets/model/calibration-protocol.json`。

每候选须不增加相对 v0.8 的定点数量、全部简单结果数量及默认状态简单结果数量，同时大运开/关的世界空间与中心化 RMS 归一形态 Hellinger 距离均至少提升 5%。合格者取两种提升倍数几何平均最大者；平分沿冻结候选顺序。无合格者明确回退 v0.8。

`profile.status`：

- `uncalibrated_preview`：未校准预览；
- `calibrated`：校准选择了新映射；
- `calibrated_fallback_v08`：完成校准但无候选达标。

映射键为 `JSON.stringify({pillars, params:八参数数组})`，同时校验 `protocol`。不含性别、当前日期、大运、开关或强度。UI 可在本机保存完整 `profile`，再传入 `compute`；协议或出生键不匹配则拒绝使用。校准重跑不会按本次观看日期改变标准探针。校准因数值错误或用户取消而中断时，不生成完成标记或伪造通过结果。

## Worker 消息

```js
const worker = TaoWorker.create();
worker.postMessage({id: 1, type: 'compute', payload: {chart, epochMs, enabled, multipliers, profile}});
worker.postMessage({id: 2, type: 'calibrate', payload: {chart}});
worker.postMessage({id: 2, type: 'cancel'});
```

回应：`{id,type:'progress',progress:{fraction,phase,completed?,total?,candidate?}}`；
`{id,type:'result',result}`；或 `{id,type:'error',error}`。

可直接 `worker.terminate()` 并重建取消任意任务。计算返回三条轨迹时转移独立 ArrayBuffer；生辰核缓存保存独立副本。

## 检查的含义

`morphology.class` 可能为 `near_fixed_point`、`near_periodic`、`not_flagged_simple`。这是有限观察窗诊断：前者 RMS<1e−6；周期检查在 0.1–45 模型单位寻找分离的真实复现极小值，归一误差<.025 且三段误差均<.04。

`not_flagged_simple` **不等于已证明混沌、独特或命理准确**。本版本不提供 Lyapunov 证明，不根据画面复杂程度宣判命运。

## 验证入口与记录

- `node --test tests/model.test.cjs`：80 个 Python 映射对照、八例浮点复现、16 套起运资料及 224 边界、42 个节气/换日/时辰边界、日期与 23:00、五层开关不变量、真实积分、Blob Worker 源码运行和取消。
- `node tests/model-calibration.cjs T01`：完整 756 条件重新选择，与既有 Python 标量统计核对；结果写 `assets/model/calibration-check-T01.json`。
- `node tests/model-calibration.cjs T05`：相同完整流程，验证无合格路线时的回退。

映射对照 fixture 是独立 Python `mapper.py` 对原有 80 合成四柱的重算；历法 fixture 是既有 v0.7 的 16 套日历输出。另有全新合成生辰完整 756 条件校准及后续积分记录 `assets/model/calibration-check-unseen.json`，未借用八示例参数或路线。该例校准后按规则沿用 v0.8，未伪造优化通过。

这些测试是数学/实现回归，不是人生命理预测验证或浏览器视觉验收。
