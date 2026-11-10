# v2.4.0 拾遗托管同步 R0 审计

审计日期：2026-11-10（Asia/Shanghai）  
审计分支：`feature/shiyi-cloud-sync-v2.5.0`  
回退基线：`pre-shiyi-v240-baseline` → `a341d83`（`docs: record v2.4.0 release manifest`）

本文记录每日学习 Android 端在进入拾遗托管同步重构前的实际状态。它把用户提供的执行提示词、三份参考资料与仓库事实分开：资料中写的目标和验收条件不等于当前代码已经实现。

## 已核对的发布与数据边界

| 项目 | 当前事实 | 结论 |
| --- | --- | --- |
| 包名 / 版本 | `cn.edu.njupt.studycheckin` / `2.4.0` / `versionCode=33` | 已发布版本，不能回写 |
| SDK | min 26，target 36 | 保持原兼容范围 |
| 数据格式 | Android 与 WebView 迁移、校验到 schema 9；JSON 原子写、写后核对和恢复日志仍在 | 不切换 Room/SQLite |
| 签名 | v2.4.0 APK SHA-256：`F389E7BF62C460D7765E356BE70E06652E5FE11F0EA52F672CDC8E5715F05C78`；已复制到 `tmp/integration-v240-baseline/每日学习-v2.4.0.apk` | 仅作回退证据，不作为新发布产物 |
| 更新渠道 | 原生更新代码仍消费 `daily-study-releases` 的 `releases/latest/download/update.json` | 旧客户端路径保持不变 |
| 远程版本 | GitHub 已有 `v2.1.0`、`v2.2.0`、`v2.3.0`、`v2.4.0`；没有 v2.5.0 | 新版本号必须高于 33 |
| 版本控制 | 分支从 v2.4.0 记录提交创建；旧标签与 Release 未修改 | 正式 push、Release、更新清单需另行确认 |

本机没有可供本次审计使用的 Mac Tauri/SQLite 客户端、Supabase 项目、后端 OpenAPI/JSON Schema、测试账号或真实 Android 设备。不能用本地 mock、同机浏览器或单元测试代替跨网络 Gate 0 证据。

## 当前 APP 结构

- Java + WebView + JSON 是现有实现。正式保存仍经过 `StudyStorage`/`DataStore`，评估、历史、单位、多计划、计时、备份恢复和 v2.4.0 行动型复盘均属于既有业务边界。
- `DataStore` 的迁移路径覆盖 schema 1–9；未知字段、空白与 0、旧记录依据和恢复日志已有校验。任何托管同步改动都不能把参考值写入实际记录，也不能整库覆盖本地状态。
- Android Manifest 当前声明通知、前台计时、开机恢复、网络和安装更新权限；没有增加云服务密钥或 WebView 网络权限。
- `UpdateManager` 和发布脚本仍使用旧更新 URL、现有包名、签名与递增 versionCode 约束；本审计没有修改它们。

## 旧“拾遗连接”实际能力

现有 `SyncStore` 只保存本地元数据：设备 ID、database epoch、设备序号、配对字段、outbox/inbox 数组、去重数组、游标、同步状态和提醒列表。其 `syncNow()` 在未绑定时返回本地状态，在已绑定时只返回“等待拾遗桌面端”；没有 HTTPS `SyncTransport`、账号会话、刷新/撤销、服务端修订号、ACK、游标拉取、冲突应用或业务事件追加。

旧设置页仍让用户填写配对码、桌面设备 ID、局域网地址、端口和指纹。该表单写入的是本地元数据，不能证明配对、传输或云端确认；旧 `contracts/shiyi-sync-v1.json` 也描述了局域网式事件信封，不能直接当作 v0.3 托管 API。

因此，v2.4.0 中的“拾遗连接”属于前置占位能力，不能标记为 Gate 0 完成。本轮将迁移旧状态而不删除学习数据，撤下 IP/端口/扫码/等待同网等用户界面，并把托管协议标记为待后端冻结。

## 参考资料与执行边界

本轮已完整阅读并作为设计依据的文件：

1. `C:\Users\18307\Downloads\Codex%E6%8F%90%E7%A4%BA%E8%AF%8D_%E6%AF%8F%E6%97%A5%E5%AD%A6%E4%B9%A0_v2.4.0%E5%B7%B2%E5%8F%91%E5%B8%83后托管同步重构.md`：执行约束与 R0–R5 顺序。
2. `C:\Users\18307\Downloads\每日学习接入改动与验收清单.md`：G0-01 至 G0-12、AT-01 至 AT-32 和真实设备/后端验收门槛。
3. `C:\Users\18307\Downloads\拾遗开发策划案_v0.3.md`：托管架构、状态语义、逻辑 API、可靠收发、冲突、提醒与安全边界。
4. `C:\Users\18307\Downloads\每日学习后续开发阶段表_协同修订版.md`：阶段 7 A/B/C 工作分组、原 v2.4.0 发布后的版本政策和维护交接条件。

这些文件是参考资料和任务约束，不是后端已部署、接口已冻结或验收已通过的证明。v0.3 中列出的 `/api/v1/*` 路径目前只作为逻辑接口草案使用；在收到 Mac/后端的正式 OpenAPI、JSON Schema、错误码和 fixtures 前，Android 端不写入不可兼容的生产假设。

## R0 结果矩阵

| 能力 | 代码现状 | 本轮处理 |
| --- | --- | --- |
| 稳定实体 ID / 数据字典 | 旧 `sync-contract.js` 有 plan/record/task/review/evaluation/reminder 的局部 ID 与信封校验 | 新增托管契约草案、能力表和测试，保留旧 fixtures 作为历史兼容样例 |
| 账号、设备、客户端代次 | 只有 Keystore EC 设备密钥别名；无账号会话、撤销或 client instance | 增加本地会话与客户端实例状态接口；真实登录/撤销待后端 |
| HTTPS 传输 | 不存在 | 增加无密钥、可替换的 `SyncTransport`/`HttpSyncTransport` 和 `HostedSyncService`；未配置端点时明确返回未配置 |
| outbox/inbox/ACK | 只有未接入业务写入的数组字段 | 接入本地保存产生的可重放操作与持久化状态；只有显式 ACK 才移除 outbox，服务端 ACK/游标仍待后端 |
| 修订、冲突、墓碑 | 只有旧信封的局部冲突判断 | 以 `baseServerRevision`、操作 ID、冲突状态建模；不做最后写入覆盖 |
| 下行任务/提醒 | 仅本地提醒保存和调度 | 保留提醒版本/回执字段；下行命令应用待正式命令清单 |
| 触发机制 | 无云端同步任务 | 保留手动/前台入口，WorkManager/推送加速待联调 |
| 状态界面 | 旧局域网连接表单 | 改为账号、云端确认、积压、冲突和会话状态，不显示局域网地址 |
| 首次合并/恢复 | 既有本地备份恢复，不含云端差异预览 | 不改旧备份；云端首次合并待 Mac/后端快照协议 |
| 联合验收 | 无 Mac、Supabase、真机证据 | 只报告静态、单元和构建证据；Gate 0 保持未完成 |

## 已有验证证据

以下是本仓库已有或本轮可重复的验证，不等同于真机/云端验收：

- Node 合同与模型测试本轮完整运行通过（286 项，其中新增托管契约 4 项）。
- `build.ps1 -TestBuild` 本轮通过，APK 仍使用 v2.4.0 manifest、原有签名路径和现有 SDK；该构建不是发布版本。
- v2.4.0 已完成签名构建并保存 APK 哈希；本轮不会覆盖基线文件。
- 当前本地分支和回退标签存在，工作目录不做 reset/clean，不覆盖用户数据文件。

## 不可在 Windows 本轮证明的事项

AT-01 至 AT-32 中涉及真实 Supabase/RLS、Mac 关机与异网、ACK 丢失后的服务端幂等、并发冲突、账号隔离、令牌撤销、真实通知显示、旧 APK 覆盖安装和独立恢复的部分，必须在收到后端与 Mac 最小客户端、测试账号/数据和 Android 真机后完成。当前不把 mock 或编译成功写成 Gate 0 通过。

## 回退与变更政策

- `pre-shiyi-v240-baseline` 和 `tmp/integration-v240-baseline/每日学习-v2.4.0.apk` 是本地回退点。
- 不修改 `v2.4.0` 标签、GitHub Release、APK、签名、versionCode=33 或旧 `latest/update.json`。
- 新代码留在独立分支；若未来发布，必须先完成兼容矩阵、迁移/恢复和真实联合验收，再按发布脚本创建 versionCode>33 的新版本，并在用户确认后 push/发布。
