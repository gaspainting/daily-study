# G0-01 至 G0-12 分阶段计划

这是 Windows Android 端与 Mac/Supabase 协作的执行计划。当前分支只推进可独立验证的 R1 本地基础；正式协议和 Gate 0 需要双方确认与联合证据。

## R1：字段、身份和本地可靠性

1. **G0-01 / G0-02**：从真实 Android 状态整理字段字典、稳定 ID、支持命令和 schema 样例；保持 `planId`、日期、历史单位、评估依据与多计划隔离。由 `hosted-sync-v1.json`、`hosted-sync-contract.js` 和 fixtures 测试承载；后端冻结前只标为草案。
2. **G0-03**：使用 Android Keystore 原生会话存储和客户端实例代次；完成后端登录/刷新/设备撤销前不开放伪登录流程。
3. **G0-05**：正式保存前写 `sync-commit-journal.json`，保存完成后生成实体级 outbox；启动时恢复中断点。显式 ACK 才删除 outbox，冲突单独保留。

## R2：可替换传输与业务状态

4. **G0-04 / G0-06**：按冻结的 OpenAPI/JSON Schema 接入 `SyncTransport`；只用 HTTPS，区分认证、撤销、冲突、限流和临时失败；以服务端 revision/cursor/tombstone 处理排序与删除。
5. **G0-07 / G0-08**：建立支持命令白名单，使用正式业务入口应用任务、安排、回顾和记录更正；提醒采用版本化接收、安排、更新、撤销回执。未知关键命令拒绝并保留错误。
6. **G0-09 / G0-10**：前台、手动和 WorkManager 周期触发按实际能力启用；推送仅作为加速提示。界面区分本机保存、待上传、云端确认、手机已应用、冲突、离线和会话状态。

## R3：首次合并、后端和 Mac 对齐

7. **G0-11**：后端提供 snapshot/cursor/epoch/过期响应和差异预览 fixtures；首次绑定比较本地与云端，不整库替换；备份与同步分开，退出同步不删除本地记录。
8. **G0-12**：Mac 提供最小 Tauri/SQLite 客户端、正式 OpenAPI/JSON Schema、RLS 策略、测试账号/数据、错误 fixtures 和运行说明。Windows 端补齐测试矩阵、迁移与回退脚本。

## 联合验收门槛

必须用真实旧数据、真实 Android 手机、Mac 客户端和测试 Supabase，在不同网络与 Mac 关机条件下完成：离线 20 条记录、断电/崩溃、丢 ACK 重发、重复操作、并发冲突、删除传播、账号/设备隔离、令牌续期/撤销、提醒版本与权限、旧备份恢复和 v2.4.0 覆盖升级。正常网络单次演示、mock、编译成功和单元测试只能作为补充证据。

## 当前交接给 Mac/后端

- Android 业务实体：`plan`、`record`、`task`、`review`、`evaluation`、`reminder`。
- Android 支持命令：每类 `upsert_*` 与 `delete_*`；提醒使用 `cancel_reminder`。未知命令必须拒绝。
- 操作关键字段：`workspaceId`、`deviceId`、`clientInstanceId`、`operationId`、`entityType`、`entityId`、`command`、`baseServerRevision`、`schemaVersion=9`、UTC 时间、业务时区和实体 payload。
- 需要后端确认：账号 claims、RLS、revision/history/tombstone、cursor/epoch、ACK response、冲突解决格式、分页和限流。
