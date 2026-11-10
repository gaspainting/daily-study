# 拾遗托管同步重构执行计划

基线：每日学习 v2.4.0，`versionCode=33`，业务 schema 9。

工作区：Windows 集中开发；每日学习 Android、拾遗 Windows 开发版和 Supabase 测试环境位于同一台 Windows 电脑时进行主要联调。macOS runner 只负责拾遗后期的 `.app/.dmg` 构建和 Mac 真机验收。

状态：`R0 audit complete / Gate 0 not complete`

本计划根据三份新版资料和实际代码审计整理。它把“计划要求”和“代码事实”分开，不能作为后端已经部署或同步已经完成的证明。

## 版本与保护规则

1. 不修改 v2.4.0 的标签、Release、APK、签名或 `latest/update.json`。
2. 托管同步的候选版本必须重新根据 Manifest、GitHub Release 和迁移结果命名；新 `versionCode` 必须大于 33，不能把当前分支名 `v2.5.0` 当成已确定版本。
3. 正式学习记录先由现有 Java/WebView/JSON 可靠落盘，再生成同步操作。云端不可用时不能阻止保存、评估、计时、任务、回顾或备份。
4. 共享协议只维护一份权威 OpenAPI、JSON Schema、错误码和 golden fixtures。GitHub 保存源码、协议、测试和发布物，不保存私人学习数据。

## G0 状态矩阵

| 任务 | 当前实际状态 | 本轮结论 | 下一依赖 |
| --- | --- | --- | --- |
| G0-01 基线、字段、契约 | Android 字段字典、稳定 ID 草案、协议信封和 fixtures 已提交 | 本地准备完成；`draft-pending-backend-freeze` | 拾遗/Supabase 提交正式 OpenAPI、Schema、错误码并共同冻结 |
| G0-02 稳定 ID、迁移、账号隔离 | 计划/记录/任务/回顾/评估/提醒的 ID 和旧 LAN 元数据迁移已在本地 | 本地迁移可审查；首次云端合并和 RLS 隔离未实现 | 账号 claims、workspace/device 模型、快照比较规则 |
| G0-03 Auth、设备会话、续期 | Keystore 加密会话容器和单飞刷新接口存在 | 客户端安全边界已有；无登录、注册、静默续期和设备撤销服务 | Supabase Auth 配置、设备 API、撤销错误 fixtures |
| G0-04 HTTPS 传输 | HTTPS-only `HttpSyncTransport` 和错误映射存在 | 适配层可替换；端点为空，不能发起生产请求 | 能力协商、正式 URL、认证 claims、限流策略 |
| G0-05 outbox/inbox/ACK | 正式保存恢复日志、实体 outbox、去重、ACK 和 inbox 结果已建模 | 本机可恢复；服务端事务 ACK、丢 ACK 重试未验证 | push/pull/ack 接口、幂等表和跨端 fixtures |
| G0-06 修订、冲突、删除 | `baseServerRevision`、冲突状态和删除命令在客户端存在 | 不按本地时间覆盖；服务端 CAS、history、tombstone 未实现 | revision/history/tombstone/cursor/epoch 语义 |
| G0-07 下行业务 | 下行校验和未知命令拒绝存在；提醒有本地适配 | 只有提醒可进入本地调度；任务、安排、回顾和更正未接入 | 正式领域载荷、合法操作入口、回退/撤销规则 |
| G0-08 本地提醒与回执 | AlarmManager、提醒版本和本机回执已存在 | 本地链路可用；服务端回执、权限和送达证据未完成 | reminders API、版本冲突规则、真机通知测试 |
| G0-09 触发、重试、离线 | 手动入口和联网 `JobScheduler` 周期机会存在 | 没有推送加速；真实后台同步、退避和断网恢复待联调 | 可访问端点、任务调度矩阵、跨网络测试 |
| G0-10 状态与恢复界面 | 设置页已有本机/云端/冲突/会话状态和手动同步入口 | 需补账号关联、首次差异预览和可操作错误恢复 | Auth/快照响应和最终状态枚举 |
| G0-11 首次合并、备份、恢复 | 本地 ZIP/JSON 备份和恢复日志保留 | 云端 snapshot、差异确认、恢复保护未实现 | snapshot/cursor/epoch、差异预览、恢复 fixtures |
| G0-12 Windows 联合验收 | 当前无拾遗仓库、Supabase 测试环境、测试账号或真机证据 | 未开始；不能宣称 Gate 0 | 两端代码、测试后端、Android 真机和跨网络场景 |

## 模块依赖和实施顺序

```text
真实 Android 业务边界
        ↓
共享 OpenAPI / JSON Schema / 错误码 / golden fixtures
        ↓
Auth 与设备会话 → HTTPS capabilities → push/pull/ack
        ↓                         ↓
本地 outbox/inbox/revision      下行提醒与业务命令
        └──────────────┬─────────┘
                       ↓
首次 snapshot/差异合并 → 状态界面与恢复 → Windows 联合验收
```

按以下顺序继续：

1. **契约冻结**：以 `contracts/app-capabilities.md`、`contracts/hosted-sync-v1.json` 和 `contracts/fixtures/` 为输入，由拾遗/Supabase 先提交正式版本；双方通过相同 fixtures 后再改实现。
2. **客户端 Auth**：接入 Supabase Auth 的安全登录、刷新、设备登记和撤销结果；凭证只进 Keystore 会话容器，不进 WebView、日志、备份或 GitHub。
3. **受限 HTTPS**：将正式 endpoint、capabilities、push/pull/snapshot/ack 和错误码接入 `HttpSyncTransport`；保持离线时只留本地状态。
4. **可靠收发**：补充批量大小、退避、游标过期、ACK 丢失、重复 operationId 和进程崩溃的跨端测试；未收到事务 ACK 不移除 outbox。
5. **冲突和下行**：先落地 server revision/CAS/tombstone/history，再按正式领域规则逐类接入提醒、任务、安排、回顾和业务更正；未知命令继续拒绝并留痕。
6. **首次关联与恢复**：实现 snapshot/差异预览/用户确认/失败回退，不整库覆盖本地 JSON；独立备份和退出同步保留本地数据。
7. **Windows 联合验收**：在同一 Windows 电脑用拾遗开发版和 Supabase 测试项目跑 AT-01～AT-32；随后由 macOS runner 构建拾遗安装包并在 Mac 验收原生能力。

## 拾遗/Supabase 必须交付的输入

- 正式 OpenAPI 与 JSON Schema，包含请求/响应包装、分页、最大批量和能力版本。
- Supabase Auth claims、workspace/device RLS 策略、设备登记/列表/撤销及令牌失效行为。
- push/pull/snapshot/ack/conflict/reminder 接口的成功、重复、冲突、无效、限流、会话失效、设备撤销和游标过期 fixtures。
- 服务端 `serverRevision`、`serverEpoch`、`journalCursor`、history、tombstone 和幂等记录的事务语义。
- 跨网络测试 URL、脱敏测试账号、可重复初始化的数据集、日志字段和回滚说明。

在这些输入到达前，Android 端不新增生产假设、不写服务端管理密钥、不把 mock 结果标为云端成功。

## 通过标准与报告格式

每轮改动必须报告：

- 修改文件、对应 G0 任务和版本/迁移影响。
- Android Node/Java/构建测试结果及真实设备、后端、跨网络证据分别列出。
- 未完成项、阻塞依赖、回退点和下一步。

只有在 Windows Android、拾遗开发版和 Supabase 测试环境完成真实跨网络场景，并保留 AT-01～AT-32 证据后，才能把 G0-12 和 Gate 0 标记为完成。
