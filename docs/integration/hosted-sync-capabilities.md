# 拾遗托管同步能力表（Android 端草案）

状态：`client-draft-pending-backend-freeze`。本文对应 `contracts/hosted-sync-v1.json`，用于与拾遗 Windows Tauri/SQLite 和 Supabase 后端对齐；它不表示生产接口已经部署。

## Android 已承诺的边界

- 每日学习继续使用 Java、WebView 和本地 JSON。未登录、未开启云同步或网络不可用时，今日记录、计时、评估、历史、复盘、备份和恢复继续在本机完成。
- 正式保存与草稿分开；本机保存、待上传、云端确认、手机已应用、冲突、离线、会话失效和设备撤销是不同状态。
- 实体 ID 使用计划 ID、日期或已有业务 ID 组合生成，不能由标题或设备时间推导。`operationId` 在重试中保持不变；服务端修订号和游标负责排序。
- Android 只接受能力表中冻结的业务命令。计划、记录、任务、回顾、评估和提醒分别处理，整库 JSON 替换不属于同步命令。
- 当前只有提醒具备本地下行适配：收到版本先落地，再按版本安排或取消 AlarmManager，并记录收到、已安排、已送达和已取消时间；任务、记录、回顾和评估命令会保留为明确的 `unsupported`，不会伪造学习事实。
- `JobScheduler` 提供联网后的周期检查机会；构建没有 HTTPS 端点元数据时只记录本机状态，推送加速能力仍为未验收。
- Token 只能保存在 Android Keystore 保护的原生存储中，不进入 WebView、JavaScript、日志、普通备份或 GitHub；`AuthSessionStore` 提供单飞刷新接口，刷新端点和撤销语义待后端冻结。

## 待后端冻结的接口

策划案规划的 `/api/v1/*` 路径在 Android 端仅作为逻辑依赖记录。正式联调前必须由后端提供：OpenAPI/JSON Schema、Auth claims、RLS 规则、错误码与重试分类、服务端 revision/cursor/tombstone 行为、分页上限、冲突响应和 fixtures。没有这些输入，客户端不把任何本地模拟响应标记为云端确认。

## 验收状态

当前可在 Windows 验证：契约字段拒绝未知命令、稳定 ID、重复操作键、基于服务端修订号的冲突判定、下行拒绝留痕、提醒版本回执字段、周期任务边界和本地状态持久化。当前不能验证：Supabase 账号隔离、真实 HTTPS、跨网络传输、ACK 丢失后的服务端幂等、拾遗进程停止恢复、推送加速、真实通知显示和旧 APK 覆盖升级。上述项目属于 G0-12 的联合验收，不用单元测试替代。
