# 拾遗托管同步 Gate 0 状态

更新时间：2026年11月10日。v2.4.0 的旧“拾遗连接”是局域网式前置占位，已不再作为当前托管同步协议。Windows Android 端现在维护托管契约草案、本地状态、加密会话存储和可重放 outbox；生产协议仍需 Mac Tauri/SQLite 与 Supabase 后端共同冻结。

当前代码对应：

- `contracts/hosted-sync-v1.json`：逻辑信封、稳定 ID、支持命令、状态和服务端结果分类；明确标注待后端冻结。
- `docs/integration/hosted-sync-capabilities.md`：Android 业务字段、支持命令、接口输入和验收边界。
- `AuthSessionStore`：Android Keystore 保护的原生会话文件；凭证不进入 WebView、日志或普通备份。
- `SyncStore`：账号/工作区、客户端实例代次、outbox/inbox、服务端修订号、游标、冲突和提醒状态。正式保存成功后才追加小实体操作；没有服务端 ACK 不清除 outbox。
- 设置页：显示本机保存、待上传、云端确认、手机已应用、冲突、离线、会话失效和设备撤销等状态，不再要求配对码、IP、端口、指纹或保持同一 Wi-Fi。

本轮能在 Windows 独立验证的是契约校验、稳定 ID、重复操作键、修订冲突判定、原生队列持久化和现有业务回归。当前没有 Mac 客户端、Supabase 测试后端、测试账号或真实 Android 设备，因此不能宣称账号隔离、跨网络传输、服务端幂等、提醒可见性或 Gate 0 通过。

联合验收仍需覆盖真实旧数据、Mac 关机与异网、离线补传、崩溃恢复、丢 ACK 重发、并发冲突、删除传播、账号/设备撤销、提醒版本回执、旧备份恢复和 v2.4.0 覆盖升级。证据和未完成项记录在 [`docs/integration/v240-audit.md`](integration/v240-audit.md)。
