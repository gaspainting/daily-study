# v1.7.0 架构边界与规则契约

本版在 v1.6.8 的 Java Activity、WebView、HTML/CSS/JavaScript 与 JSON 存储上整理模块边界。业务 schema 保持 9；本版不迁移数据库、不切换 UI 框架，也不改变自动评估口径。

## 分层

| 边界 | 当前职责 | 实现 |
|---|---|---|
| 页面与草稿 | 输入、页面状态、草稿、预览和结果呈现 | `app/src/main/assets/app.js` 与现有页面模块 |
| 领域入口 | 状态迁移、校验、记录读写和评估选择 | `domain-contract.js`；时间目标仍由 `reference.js` 提供，自动评估由 `evaluation.js` 提供 |
| 原生命令入口 | 验证计划、修订和请求身份；处理重复提交 | `BridgeContract.java`、`BridgeDispatcher.java` |
| 存储端口 | 稳定读取、UI读取、记录保存和评估日程保存 | `StudyStorage.Port`，当前适配到 `DataStore` |
| Android 能力 | 计时、通知、文件、更新、小组件和日签素材 | 继续由原生类负责 |

`StudyStorage.Port` 只覆盖当前 WebView 写入需要的存储操作。JSON、原子文件、既有迁移、备份格式和修订规则继续由 `DataStore` 管理。

## 桥接契约 v1

页面只通过 `Native.dispatch(json)` 提交正式学习状态和评估日程。请求包含：

```json
{
  "contractVersion": 1,
  "requestId": "save-...",
  "operation": "state.save",
  "planId": "main",
  "expectedRevision": 12,
  "payload": {}
}
```

允许的操作为 `state.save` 和 `evaluation.schedule.save`。原生入口检查整数契约版本、字段类型、请求 ID、操作、计划 ID 和修订号，再由 `StudyStorage.Port` 执行现有校验和原子提交。请求指纹按 JSON 对象键排序，键顺序变化不影响重试身份。成功响应包含请求 ID、操作、计划 ID、提交后的修订号和规范化状态；失败响应保留请求关联信息并给出当前可确认的错误。

原生入口为最近 32 个成功请求保留结果。同一请求 ID 和相同内容只执行一次；同一 ID 携带不同内容会被拒绝。目标计划已切换或修订号已变化时，写入不会执行。页面对未确认的同一内容重试时复用请求 ID；响应中断后会读取当前修订，并明确显示结果待核对。

当前 Android JavaScriptInterface 为同步调用，因此命令不持有异步 WebView 回调。计划标识和修订号仍在写入锁内复核，覆盖切换计划或并发更新窗口。

旧的 `saveState` 与 `saveEvaluationSchedule` 原生入口暂时保留给项目内兼容测试和旧调用路径；新页面的正式保存走契约 v1。

## 规则样例

`tests/fixtures/rule-contract-cases.json` 由 JS 与 Android Java 共同读取，并驱动区间规范化、时间/单词/数量目标快照、代表性工作日与周末日程、迁移兼容和桥接请求。`word-log-cases.json` 与 `automatic-assessment-cases.json` 继续用作 JS/Java 实际规则的共同输入输出。课程日程的相同日期也分别核对两个运行时的输出。

测试比较规范化后的业务值，不依赖 JSON 属性顺序。目标快照、正式记录、实际单位与自动评估结果分别保留既有语义；草稿不经过正式保存命令，也不进入统计。

## 文件落点

- `app/src/main/assets/domain-contract.js`
- `app/src/main/assets/bridge-contract.js`
- `app/src/main/java/cn/edu/njupt/studycheckin/StudyStorage.java`
- `app/src/main/java/cn/edu/njupt/studycheckin/BridgeContract.java`
- `app/src/main/java/cn/edu/njupt/studycheckin/BridgeDispatcher.java`
- `tests/fixtures/rule-contract-cases.json`
- `tests/bridge-contract.test.cjs`
- `tests/domain-contract.test.cjs`
- `tests/bridge-contract-ui.cjs`

## 验收

- JS 与 Java 接受相同请求样例并拒绝无效版本、ID、操作、计划及修订号。
- 真实 Android WebView 通过新桥保存正式记录与评估日程。
- 重复请求不会新增修订；请求内容不同、计划过期或修订过期不会覆盖现有状态。
- JSON 迁移、备份恢复、原子写、草稿、计时、单位和 v1.6.7 自动评估样例保持现有结果。
- 本版不重构构建系统；Gradle/CI 只在依赖或持续维护需求明确后单独安排。

## 验证记录

2026-10-27 完成 Node 全套测试（259 项）、`build.ps1 -TestBuild` 签名与 APK 校验、API 36 原生 SmokeTests（731 项）和 Android WebView 桥接流程（10 项）。模拟器应用私有数据在测试后逐文件校验并恢复。完整发行验证见 [v1.7.0 更新报告](V1.7.0.md)。

执行明细位于 `docs/validation-v1.7.0/architecture/`。本轮未在 vivo X100s 真机或 TalkBack 上验证。AndroidManifest 设置为 v1.7.0/versionCode 26。
