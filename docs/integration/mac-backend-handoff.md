# Android → 拾遗 Windows/Supabase 联调交接

状态：`draft-pending-backend-freeze`。这是给拾遗 Windows Tauri/SQLite 与 Supabase 后端的输入清单，不是后端已经完成的证明。

## Android 当前可供对齐的文件

- `contracts/app-capabilities.md`：从实际 Android schema 9 状态整理的实体、字段边界、稳定 ID 与命令矩阵。
- `contracts/hosted-sync-v1.json`：协议 1 的逻辑信封和路由草案。
- `contracts/fixtures/hosted-valid-operation.json`：上行记录操作。
- `contracts/fixtures/hosted-conflict-operation.json`：同实体的服务端修订冲突。
- `contracts/fixtures/hosted-unsupported-command.json`：未知命令必须拒绝。
- `contracts/fixtures/hosted-reminder-downlink.json`：提醒下行、服务端修订和游标包装样例。

这些文件必须和拾遗端的正式 OpenAPI/JSON Schema 一起评审。拾遗端不能只依据路径名称推断生产字段；冻结前如需调整字段、包装或错误码，应同时更新 Android fixture 和两端契约测试。

## 后端必须提供的最小接口

1. Auth 会话与账号恢复；RLS 必须把账号、工作区、设备登记和操作幂等键隔离。
2. 设备登记、设备列表和单设备撤销；撤销结果必须让旧会话的后续 push/pull 得到明确错误。
3. `GET /api/v1/capabilities`：协议版本、支持实体/命令、最大批量、游标有效期和提醒版本能力。
4. `POST /api/v1/sync/push`：事务写入实体修订、历史/墓碑、操作幂等记录和 journal；ACK 只能在提交后返回。
5. `GET /api/v1/sync/pull?cursor=`：返回同一 `serverEpoch` 下的连续 journal 项和下一游标；游标过期必须要求 snapshot，而不是跳过事件。
6. `POST /api/v1/sync/snapshot`：首次绑定或 epoch 变化时提供可比较快照，不得要求 Android 直接覆盖本地 JSON。
7. 冲突查询/解决、提醒 ACK 与版本回执；同一提醒的旧版本回执不能确认新版本。

## 错误与一致性要求

至少区分 `401/UNAUTHENTICATED`、`403/DEVICE_REVOKED`、`409/REVISION_CONFLICT`、`429/RATE_LIMITED`、5xx 临时故障、无效载荷和不支持命令。只有临时故障和限流进入退避重试；冲突、撤销和不支持命令要保留本地可处理状态。

`operationId` 与 `clientInstanceId` 是幂等键；同键不同载荷必须拒绝。服务端修订和 journal 游标由服务端生成，不能使用 Android 或拾遗的本地时间决定覆盖胜负。删除必须留下墓碑，旧设备离线上传不能复活已删除实体。

## 联调前仍缺少的输入

当前 Windows 工程没有拾遗目录、Supabase 项目、测试账号、可访问的 HTTPS 端点或真实 Android 设备。因此本分支只完成本地契约、持久队列、HTTPS 适配边界、提醒下行候选和周期触发；不能宣称账号、跨网络、RLS、服务端幂等、推送、恢复合并或 Gate 0 已通过。拾遗 Windows 端交付后，先用上述 fixtures 做无 UI 的 push/pull/冲突测试，再进行真实手机与异网验收。
