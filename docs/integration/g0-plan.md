# G0-01 至 G0-12 分阶段计划

这是 Windows 集中工作区内每日学习 Android、拾遗 Windows 开发版与 Supabase 测试环境的执行计划。macOS runner 只负责拾遗后期安装包构建和 Mac 原生验收。当前仓库只完成本地客户端准备，正式协议和 Gate 0 需要双方确认与联合证据。完整事实见 [`app-baseline-v240.md`](app-baseline-v240.md)，实施顺序见 [`hosted-sync-implementation-plan.md`](hosted-sync-implementation-plan.md)。

## R1：字段、身份和本地可靠性

1. **G0-01 / G0-02**：从真实 Android 状态整理字段字典、稳定 ID、支持命令和 schema 样例；保持 `planId`、日期、历史单位、评估依据与多计划隔离。由 `contracts/app-capabilities.md`、`hosted-sync-v1.json`、`hosted-sync-contract.js` 和 fixtures 测试承载；后端冻结前只标为草案。
2. **G0-03**：使用 Android Keystore 原生会话存储和客户端实例代次；完成后端登录/刷新/设备撤销前不开放伪登录流程。
3. **G0-05**：正式保存前写 `sync-commit-journal.json`，保存完成后生成实体级 outbox；启动时恢复中断点。显式 ACK 才删除 outbox，冲突单独保留。

## R2：可替换传输与业务状态

4. **G0-04 / G0-06**：已接入 HTTPS-only `SyncTransport`/`HttpSyncTransport` 和 push/pull 领域边界；只用服务端 revision/cursor，不按设备时间覆盖。正式 OpenAPI、认证、撤销、墓碑和冲突解决仍待冻结。
5. **G0-07 / G0-08**：已建立命令白名单和下行拒绝留痕；提醒支持版本化接收、安排、取消、送达回执。任务、安排、回顾和记录更正必须等待正式领域载荷后再接入，未知关键命令不返回成功。
6. **G0-09 / G0-10**：已加入 `JobScheduler` 周期机会、前台和手动入口；当前构建没有托管端点，不会发起云请求，推送仍标记未验收。界面区分本机保存、待上传、云端确认、手机已应用、冲突、离线和会话状态。

## R3：首次合并、后端和 Windows 联调

7. **G0-11**：后端提供 snapshot/cursor/epoch/过期响应和差异预览 fixtures；首次绑定比较本地与云端，不整库替换；备份与同步分开，退出同步不删除本地记录。
8. **G0-12**：拾遗 Windows 开发版与 Supabase 提供最小 Tauri/SQLite 客户端、正式 OpenAPI/JSON Schema、RLS 策略、测试账号/数据、错误 fixtures 和运行说明。Android 端在同一 Windows 工作区补齐测试矩阵、迁移与回退脚本；macOS runner 后续只做安装包和原生验收。

## 联合验收门槛

必须用真实旧数据、真实 Android 手机、Windows 拾遗客户端和测试 Supabase，在不同网络与拾遗进程停止条件下完成：离线 20 条记录、断电/崩溃、丢 ACK 重发、重复操作、并发冲突、删除传播、账号/设备隔离、令牌续期/撤销、提醒版本与权限、旧备份恢复和 v2.4.0 覆盖升级。正常网络单次演示、mock、编译成功和单元测试只能作为补充证据；macOS runner 的原生安装验收另行记录。

## 当前交接给拾遗/后端

- Android 业务实体：`plan`、`record`、`task`、`review`、`evaluation`、`reminder`。
- Android 支持命令：每类 `upsert_*` 与 `delete_*`；提醒使用 `cancel_reminder`。未知命令必须拒绝。
- 操作关键字段：`workspaceId`、`deviceId`、`clientInstanceId`、`operationId`、`entityType`、`entityId`、`command`、`baseServerRevision`、`schemaVersion=9`、UTC 时间、业务时区和实体 payload。
- 需要后端确认：账号 claims、RLS、revision/history/tombstone、cursor/epoch、ACK response、冲突解决格式、分页和限流。
