# 每日学习 Android 实际能力与数据字典（托管同步草案）

状态：`draft-pending-backend-freeze`  
业务 schema：9　协议草案：1  
适用工程：`cn.edu.njupt.studycheckin`（v2.4.0 基线后的候选分支）

这份文件从 Android 工程当前的 `DataStore`、`PlanStore`、`SyncStore` 和 WebView 模型整理字段与命令。它是 Mac/后端冻结 OpenAPI、JSON Schema、RLS 和错误码之前的协作输入，不表示托管接口已经部署，也不表示 Gate 0 已通过。

## 本地事实与同步边界

- 正式学习记录仍由 Java/WebView 的本地保存入口提交；草稿、计时运行态和界面状态不作为云端已确认事实。
- 学习事实、计划规则、历史评估依据和提醒意图必须保留原始字段、业务日期和业务时区。云端建议按实体修订和事件日志保存，不能用设备时间或整份 JSON 覆盖解决冲突。
- `operationId` 在同一 `clientInstanceId` 内不可换载荷重用；`entityId` 是业务身份；`baseServerRevision`、`serverRevision` 和 `journalCursor` 由服务端决定。
- Android 在收到服务端提交确认前只能显示“本机已保存”或“待上传”；收到确认后才显示“云端已确认”。下行提醒还要单独确认“手机已保存/已安排/已送达”。
- 账号、工作区和设备会话属于同步元数据，不写入 WebView，也不把访问令牌放入备份、日志或普通 JSON 状态。

## 实际实体与稳定 ID

| 实体 | Android 当前来源 | 稳定 ID 草案 | 事实边界 | 首版命令 |
| --- | --- | --- | --- | --- |
| `plan` | `state.plan`、`PlanStore` | `plan:<planId>` | 计划标题、日期、周次、科目、目标、周任务配置；不含运行中的草稿 | `upsert_plan`、`delete_plan` |
| `record` | `state.records[date]` | `record:<planId>:<YYYY-MM-DD>` | 某计划某业务日的正式实际、状态、备注、计时归属和单词明细 | `upsert_record`、`delete_record` |
| `task` | `state.plan.weekTasks[weekKey][]` | `task:<planId>:<taskId>` | 下一周/周内任务的标题、科目、完成状态和更新字段；完成不是评估事实 | `upsert_task`、`delete_task` |
| `review` | `state.reviews`、`state.reviewQueue` | `review:<planId>:<reviewKey>` | 回顾项、行动项及其反馈；不得把建议直接写入正式记录 | `upsert_review`、`delete_review` |
| `evaluation` | `state.evaluation`、`assessmentBases` | `evaluation:<planId>` | 自动评估规则、分母、依据版本和结果快照；历史依据不可静默重算 | `upsert_evaluation`、`delete_evaluation` |
| `reminder` | `SyncStore.reminders` | `reminder:<eventId>`（事件 ID 本身也必须稳定） | 目标时间、时区、深链、版本和手机回执；通知送达不等于用户点击 | `upsert_reminder`、`cancel_reminder` |

以下内容当前保留在本机或另有备份流程，不能由通用下行载荷伪造：运行中的计时器、草稿、日签素材缓存、访问令牌、服务端管理字段和 AI 建议。`sessions` 只有在后端另行确认计时事件语义后才加入支持命令。

## 操作信封

每个上行操作使用 `contracts/hosted-sync-v1.json` 中的字段：

```json
{
  "protocolVersion": 1,
  "workspaceId": "workspace_demo",
  "deviceId": "device_demo",
  "clientInstanceId": "instance_demo",
  "operationId": "operation_demo_001",
  "entityType": "record",
  "entityId": "record:main:2026-11-10",
  "command": "upsert_record",
  "baseServerRevision": 4,
  "schemaVersion": 9,
  "occurredAtUtc": "2026-11-10T08:00:00Z",
  "businessTimeZone": "Asia/Shanghai",
  "payload": {}
}
```

后端冻结前，字段名、响应包装、认证 claims、分页、错误码和事务语义都不能视为生产协议。服务端至少要保证：同一幂等键同载荷返回同一结果；不同载荷拒绝；ACK 只在事务提交后返回；修订、墓碑和游标能恢复；账号与工作区由 RLS 隔离。

## 下行命令矩阵

Android 只接受能力协商明确列出的命令。`reminder` 是当前可落地的本地适配候选；计划、记录、任务、回顾和评估需要正式领域入口和 Mac/后端共同冻结载荷后才能标记为 `device_applied`。未知或关键但不支持的命令必须保留为拒绝结果，不能返回成功后丢字段。

| 命令 | 当前 Android 处理 | 失败结果 |
| --- | --- | --- |
| `upsert_reminder` | 校验提醒字段、版本、深链和账号范围，写入本地提醒，再安排 AlarmManager | `invalid` 或 `unsupported`，不推进未保存游标 |
| `cancel_reminder` | 校验事件 ID 与版本，取消本机同版本闹钟并保存取消回执 | 版本不匹配时保留旧提醒，不确认新版本 |
| 其他 `upsert_*` / `delete_*` | 仅做信封和命令白名单校验；正式业务适配待领域规则和后端 fixture 冻结 | `unsupported`，不伪造学习事实 |

## 原生边界命令

WebView 可调用的同步入口仅用于读取状态、保存偏好、检查状态、退出会话和保存提醒：

| Bridge 方法 | 作用 | 是否代表云端成功 |
| --- | --- | --- |
| `getSyncStatus` | 返回账号、工作区、待上传、冲突、游标、最近尝试/成功/失败 | 否 |
| `saveSyncSettings` | 保存本机自动同步偏好和工作区标识 | 否 |
| `syncNow` | 记录一次检查并报告当前可确认状态 | 否；没有后端端点时保持本机队列 |
| `unpairSync` | 退出会话并保留本机学习数据与未上传队列 | 否 |
| `saveSyncReminder` | 写入并安排一个版本化提醒意图 | 仅代表本机保存 |

真实登录、静默续期、设备登记/撤销、HTTPS 端点、首次快照/合并和跨网络联合验收需要 Mac/Supabase 交付后才能变成可执行的生产能力。GitHub 只保存代码、契约、fixtures 和发布物，不保存私人学习数据。

## 协作要求

Mac/后端交付以下内容后，Android 才能冻结 v1：正式 OpenAPI/JSON Schema、能力响应、Auth claims、设备登记/撤销接口、push/pull/snapshot/ack 响应、冲突解决格式、游标过期语义、提醒版本回执、RLS 规则和跨网络 fixtures。每次变更必须同时更新本文件、`contracts/hosted-sync-v1.json` 和 `contracts/fixtures/`，并通过 Android 与 Mac 两端的契约测试。
