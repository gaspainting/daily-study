# 每日学习 · 视觉样稿

本目录保存两套独立、可操作的视觉样稿。用户选择的 A 方案用于 v1.6.4 正式界面；样稿使用独立的浏览器示例存储，不接入 Android 原生桥。

## 打开

在仓库根目录执行：

```powershell
node design/visual-refresh/serve.cjs
```

访问 [本地预览](http://127.0.0.1:8818/)。服务器仅监听本机。

## 两个方向

| 方向 | 视觉 | 录入 |
| --- | --- | --- |
| A · 清晰的系统感 | 白色主画布、大标题、蓝色操作、细线列表 | 点科目进入集中编辑，手动保存 |
| B · 紧凑的工作台 | 深色主画布、工具栏、对齐的记录表 | 时长与单词数量行内填写，手动保存 |

参考页面与具体取舍见 [references.html](references.html)。今日、课程、本周目标、评估、计划、周统计、月历、历史、日签文字排版和设置均有页面；计时器、提醒、小组件为界面示例，不调用系统服务。

## 数据与交互范围

- 使用项目现有 `model.js`、`reference.js` 和课表模块计算示例记录。日期固定为 2026-10-26。
- 未填写保留空值，显式 0 显示为 0；部分记录单独显示。参考与实际分别处理，单词新学和复习分别录入。
- 科目编辑完成后进入草稿；点“保存记录”后校验并写入本地浏览器的独立样稿命名空间，写入成功后显示保存结果。
- 修改总参考区间会分配到时间科目；逐项修改会更新合计。更改日期前提供保存或放弃草稿的选择。
- 主预览可以同步切换两套方案、选择空值 / 零值 / 部分记录示例、放大文字和切换 320px 窄屏。
- 日签使用公版诗句展示文字排版，正式 App 的联网图片和来源功能未改动。

## 本轮验证

2026-10-26，浏览器内执行并查看了：

- A 的科目编辑、超出 1440 分钟的校验、草稿状态、手动保存，以及刷新后的示例记录恢复。
- 总参考从 60—120 改为 90—150 分钟后，分项变为 30—50 与 60—100，实际记录保持原值。
- 两套方案的空值、显式 0、部分记录，以及部分记录下的“待补全时长”评估。
- 今日、计划、复盘和设置的实际渲染；320px 与 125% 文字样例的目视检查。

执行命令：

```powershell
node --check design/visual-refresh/phone.js
node --check design/visual-refresh/gallery.js
node --check design/visual-refresh/serve.cjs
node --test tests/reference-assessment.test.cjs tests/assessment-history.test.cjs
```

参考与历史评估测试：39 项通过。Android 构建、vivo 真机、TalkBack、系统权限、后台计时及原生分享未在本轮样稿中验证。

## 截图

以下图片由浏览器真实截图按画布位置拼接，未重新绘制界面；拼接过程检查每个画布像素行均有截图覆盖。

- [今日对比](screenshots/today-comparison.png)
- [计划对比](screenshots/plan-comparison.png)
- [复盘对比](screenshots/review-comparison.png)
- [设置对比](screenshots/settings-comparison.png)

`stitch-captures.py` 用于复现截图拼接；原始截图片段和 DOM 位置记录位于本次工作区 `tmp/visual-refresh-captures/`。
