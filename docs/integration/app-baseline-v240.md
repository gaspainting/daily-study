# 每日学习 v2.4.0 实际工程基线

审计日期：2026-11-10（Asia/Shanghai）

审计分支：`feature/shiyi-cloud-sync-v2.5.0`

审计起始提交：`25aa15d`

审计对象：Windows 工作区中的 Android 工程 `study-checkin-android`

这份报告只记录仓库和构建入口能够证明的事实。参考策划案中的目标、接口名称和验收条件不会因为写在文档里就被计入已实现。

## 发布、版本和兼容边界

| 项目 | 实际状态 | 处理边界 |
| --- | --- | --- |
| 包名、版本 | `cn.edu.njupt.studycheckin`、`2.4.0`、`versionCode=33` | 作为业务兼容基线；不移动 v2.4.0 标签、Release、APK 或 `latest/update.json` |
| 数据 schema | `DataStore` 迁移和校验到 schema 9 | 托管同步必须保留字段、单位、空白/0、计划身份和历史评估依据 |
| Android 架构 | Java Activity + WebView HTML/CSS/JavaScript + JSON 文件 | 不迁移 Kotlin、Compose、Room 或 SQLite；同步只接在现有保存边界之后 |
| 构建入口 | 仓库没有 Gradle wrapper/Gradle 工程；由 `build.ps1` 直接调用 JDK、Android SDK 工具 | Windows 集中构建；macOS runner 只用于后续拾遗构建和 macOS 验收 |
| 新版本政策 | 当前开发分支名含 `v2.5.0`，但候选版本尚未确定 | 发布前重新读取 Manifest 和 GitHub Release；新 `versionCode` 必须大于 33，不能把分支名当作版本承诺 |

## 实际业务能力

| 能力 | 代码事实 | 分类 |
| --- | --- | --- |
| 正式保存 | `DataStore` 使用 `AtomicFile`、写后读取核对、revision 检查；`SyncStore` 在保存前写 `sync-commit-journal.json`，保存成功后再产生实体操作 | 已实现，可保留 |
| 迁移与恢复 | `DataStore` 覆盖 schema 1–9；`PlanStore` 有计划切换日志；保存中断可在启动时恢复 | 已实现，后续同步不得绕过 |
| 自动评估 | `Evaluation`、`assessmentBases`、计划日程和历史规则由本地模型维护 | 已实现，云端不能静默重算或覆盖依据 |
| 任务与快速记录 | WebView 模型支持每日任务、周任务、快速记录和完成/延期/跳过历史 | 已实现；下行更正仍需正式业务命令 |
| 回顾与行动复盘 | `reviewQueue`、回顾事件、行动草案和下周计划确认入口已在本地业务中 | 已实现；建议不能直接写成正式学习记录 |
| 计时 | 原生 `TimerService`/`TimerStore` 与 WebView 记录入口存在 | 已实现；运行态不作为云端已确认事实 |
| 备份 | `BackupManager` 提供 ZIP、JSON、恢复日志和旧版本升级；认证会话单独存储 | 已实现；云端快照/差异恢复尚未接入 |
| 提醒 | 标准提醒使用 `AlarmManager`；拾遗提醒有版本、安排、取消、送达回执字段 | 本地已实现；云端回执和推送尚未验收 |
| 更新 | 原有 GitHub `update.json`、签名和递增 versionCode 路径保留 | 已实现；本轮不发布新 APK |

## 托管同步实际状态

| 模块 | 当前代码 | 实际结论 |
| --- | --- | --- |
| 稳定 ID/信封 | `SyncStore`、`hosted-sync-contract.js`、`contracts/hosted-sync-v1.json` 和 fixtures 已有 schema 9 草案 | 本地契约准备；不是冻结的生产协议 |
| 旧局域网数据 | `SyncStore.normalize` 把历史 `pair`、地址和旧状态迁移到私有 `legacyLanMetadata`，不再显示 LAN 表单 | 旧 LAN 仅作兼容迁移；当前没有可用 LAN 传输 |
| 会话 | `AuthSessionStore` 用 Android Keystore 加密会话文件，并提供刷新接口边界 | 没有账号登录、静默续期服务、设备登记或撤销后端 |
| HTTPS | `HttpSyncTransport` 强制 HTTPS、Bearer 会话和错误分类 | 端点元数据为空；没有真实请求 |
| 本地可靠收发 | outbox/inbox、去重、ACK、冲突、cursor、server revision 和恢复日志已建模 | 可独立测试的本地接入层；服务端事务、幂等和游标语义未验证 |
| 下行 | `HostedDownlink` 只对提醒进入本地调度；其他业务命令保留 `unsupported` 结果 | 不能宣称任务、记录、评估或回顾已经可以下行 |
| 触发 | 手动入口与 `JobScheduler` 周期机会存在；状态明确 `pushAccelerated=false` | 没有推送和真实后台同步证据 |
| 界面 | 设置页显示本机保存、待上传、云端确认、冲突、离线、会话失效和设备撤销等状态 | 状态展示已有；登录、首次关联和差异预览尚未接入 |

## 工程中没有找到的依赖

在当前 Windows 工作区及已核对的 `D:\GitHub`、`D:\南京邮电大学\learning` 目录中，没有找到拾遗 Tauri/Vue/TypeScript/Rust/SQLite 仓库、Supabase 项目、正式 OpenAPI/JSON Schema、可访问 HTTPS 测试端点、测试账号或服务端 fixtures。两个工程尚未形成可运行的 Windows 联调组合。

因此以下能力不能从当前 Android 仓库单独证明：Supabase Auth/RLS 账号隔离、设备撤销、跨网络 push/pull、服务端 CAS/墓碑/历史、首次快照合并、真实 ACK 丢失重试、通知送达、Windows 拾遗客户端和 Gate 0 联合验收。

## 已执行验证与证据边界

- `node --test tests/*.test.cjs`：295 项通过。
- 托管同步静态/契约检查：13 项通过。
- `node --check app/src/main/assets/app.js`：通过。
- `git -c core.whitespace=cr-at-eol diff --check`：通过。
- `build.ps1 -TestBuild`：Windows 测试 APK 构建通过，并完成 APK v2/v3 签名校验；该 APK 不是发布版本。
- 没有本轮真实 Android 真机、Supabase 测试环境、Windows 拾遗客户端或 macOS 运行证据。

上面的测试和构建只能证明本地代码、契约边界和兼容性检查结果，不能替代跨网络联合验收，也不能把 Gate 0 标记为完成。

## 基线结论

v2.4.0 的学习业务和本地可靠保存可以作为托管同步的保护边界。现有托管同步属于可回退的客户端准备层：它已经有本地实体 ID、恢复日志、outbox/inbox、HTTPS 适配和状态模型，但生产协议、账号服务、后端事务和跨端联调条件尚未交付。下一轮应先冻结共享契约和 golden fixtures，再接入真实 Auth 与受限 HTTPS 端点。
