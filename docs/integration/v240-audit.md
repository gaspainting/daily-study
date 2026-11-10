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

本机没有可供本次审计使用的拾遗 Windows Tauri/SQLite 客户端、Supabase 项目、后端 OpenAPI/JSON Schema、测试账号或真实 Android 设备。不能用本地 mock、同机浏览器或单元测试代替跨网络 Gate 0 证据。

## 当前 APP 结构

- Java + WebView + JSON 是现有实现。正式保存仍经过 `StudyStorage`/`DataStore`，评估、历史、单位、多计划、计时、备份恢复和 v2.4.0 行动型复盘均属于既有业务边界。
- `DataStore` 的迁移路径覆盖 schema 1–9；未知字段、空白与 0、旧记录依据和恢复日志已有校验。任何托管同步改动都不能把参考值写入实际记录，也不能整库覆盖本地状态。
- Android Manifest 当前声明通知、前台计时、开机恢复、网络和安装更新权限；没有增加云服务密钥或 WebView 网络权限。
- `UpdateManager` 和发布脚本仍使用旧更新 URL、现有包名、签名与递增 versionCode 约束；本审计没有修改它们。

## 旧“拾遗连接”实际能力

当前分支的 `SyncStore` 已把旧局域网字段迁移到私有 `legacyLanMetadata`，并维护设备/客户端实例、账号与工作区、可恢复提交日志、实体级 outbox、inbox 去重、服务端修订号、游标、epoch 保护、冲突和提醒版本回执。正式保存会先写 `sync-commit-journal.json`，本地状态成功后再追加可重放操作；只有显式 ACK 才移除 outbox，已落盘的 ACK 收到 duplicate 重放时保持幂等。

本地已有 `AuthSessionStore`（Keystore 加密会话容器）、HTTPS-only `HttpSyncTransport`、`HostedSyncService`、下行校验边界和 `JobScheduler` 触发器。构建没有托管端点元数据，因此周期任务只记录当前本机状态，不会发起伪造的云请求；收到正式端点后才会调用传输适配器。提醒的 `reminderVersion`、收到/已安排/已送达/已取消时间均在本地保存，旧版本提醒会补默认字段。

旧设置页的配对码、桌面设备 ID、局域网地址、端口和指纹入口已移除；旧 `contracts/shiyi-sync-v1.json` 保留为历史兼容资料，不能直接当作旧局域网或 v0.4 托管 API。提醒以外的下行业务命令当前只校验并留存拒绝结果，不会把未知载荷写入学习事实。

因此，v2.4.0 中的“拾遗连接”仍不是 Gate 0。当前分支提供可回退的本地队列、传输和下行边界，但账号登录/设备撤销、后端事务、首次合并、真实跨网络和 Windows 联合验收仍待交付；macOS 原生验收在 Windows 联调之后进行。

## 参考资料与执行边界

本轮已完整阅读并作为设计依据的文件：

1. `C:\Users\18307\Downloads\Codex提示词_每日学习_v2.4.0已发布后托管同步重构.md`：执行约束与真实验收边界。
2. `C:\Users\18307\Downloads\每日学习_已发布v2.4.0后_托管同步重构清单_v1.1.md`：G0-01 至 G0-12、AT-01 至 AT-32 和真实设备/后端验收门槛。
3. `C:\Users\18307\Downloads\拾遗_开发策划案_v0.4_Windows集中开发_macOS发布.md`：Windows 集中开发、Supabase 托管架构、macOS runner 发布和联调边界。
4. `C:\Users\18307\Downloads\每日学习后续开发阶段表_集中开发修订版_v2.md`：阶段 8 的工作分组、版本政策和维护交接条件。

这些文件是参考资料和任务约束，不是后端已部署、接口已冻结或验收已通过的证明。策划案中的 `/api/v1/*` 路径目前只作为逻辑接口草案使用；在收到拾遗/Supabase 的正式 OpenAPI、JSON Schema、错误码和 fixtures 前，Android 端不写入不可兼容的生产假设。

## R0 结果矩阵

| 能力 | 代码现状 | 本轮处理 |
| --- | --- | --- |
| 稳定实体 ID / 数据字典 | 旧 `sync-contract.js` 有局部 ID 与信封校验 | 新增 `contracts/app-capabilities.md`、托管契约草案和 fixtures；后端冻结前仍是草案 |
| 账号、设备、客户端代次 | 有 Keystore 设备密钥、加密会话容器和 client instance；无真实登录/撤销服务 | 本地会话刷新接口、作用域切换清理和代次状态已具备；真实 Auth/RLS/撤销待后端 |
| HTTPS 传输 | 已有 HTTPS-only `SyncTransport`/`HttpSyncTransport`，构建未配置端点 | `HostedSyncService` 支持 push/pull 边界；未配置端点时只报告本机状态 |
| outbox/inbox/ACK | 正式保存已接入恢复日志和实体级 outbox；inbox 拒绝/应用留痕已加入；duplicate ACK 可幂等重放 | 只有显式 ACK 才移除 outbox；服务端事务和丢 ACK 重传仍待后端 |
| 修订、冲突、墓碑 | `baseServerRevision`、操作 ID、冲突状态已建模；未完成服务端墓碑 | 不按最后修改时间覆盖；条件写入和墓碑待后端 |
| 下行任务/提醒 | 下行校验会拒绝未适配业务命令；提醒支持版本化接收/安排/取消/送达回执 | 仅提醒有本地适配；任务、记录、评估应用待正式命令清单 |
| 触发机制 | `JobScheduler` 每 6 小时提供联网机会，前台/手动入口保留；无推送声明 | 周期执行和真实后端联调待完成，推送仍未验收 |
| 状态界面 | 旧局域网连接表单 | 改为账号、云端确认、积压、冲突和会话状态，不显示局域网地址 |
| 首次合并/恢复 | 既有本地备份恢复，不含云端差异预览 | 不改旧备份；云端首次合并待拾遗/后端快照协议 |
| 联合验收 | 无 Windows 拾遗客户端、Supabase、真机证据 | 只报告静态、单元和构建证据；Gate 0 保持未完成 |

## 已有验证证据

以下是本仓库已有或本轮可重复的验证，不等同于真机/云端验收：

- Node 合同与模型测试本轮完整运行通过（297 项，其中托管同步静态检查 15 项）。
- `build.ps1 -TestBuild` 本轮通过，APK 仍使用 v2.4.0 manifest、原有签名路径和现有 SDK；该构建不是发布版本。
- v2.4.0 已完成签名构建并保存 APK 哈希；本轮不会覆盖基线文件。
- 当前本地分支和回退标签存在，工作目录不做 reset/clean，不覆盖用户数据文件。

## 不可在 Windows 本轮证明的事项

AT-01 至 AT-32 中涉及真实 Supabase/RLS、拾遗进程停止与异网、ACK 丢失后的服务端幂等、并发冲突、账号隔离、令牌撤销、真实通知显示、旧 APK 覆盖安装和独立恢复的部分，必须在收到后端与拾遗 Windows 最小客户端、测试账号/数据和 Android 真机后完成。当前不把 mock 或编译成功写成 Gate 0 通过。

## 回退与变更政策

- `pre-shiyi-v240-baseline` 和 `tmp/integration-v240-baseline/每日学习-v2.4.0.apk` 是本地回退点。
- 不修改 `v2.4.0` 标签、GitHub Release、APK、签名、versionCode=33 或旧 `latest/update.json`。
- 新代码留在独立分支；若未来发布，必须先完成兼容矩阵、迁移/恢复和真实联合验收，再按发布脚本创建 versionCode>33 的新版本，并在用户确认后 push/发布。
