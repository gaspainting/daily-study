# 拾遗联动 Gate 0 前置接入

更新时间：2026年11月10日。本文记录每日学习侧已经落地的接口准备，以及仍需要拾遗桌面端和真实设备才能完成的验收项。

**已落地的前置工作**

- `contracts/shiyi-sync-v1.json` 固定协议版本、事件信封字段、实体类型、排序、去重、ACK、冲突和删除墓碑规则。
- `contracts/fixtures/` 提供有效、重复、冲突和未知版本样例；`sync-contract.js` 提供稳定实体 ID、信封校验、去重键和显式冲突判断。
- 任务、问题回顾、日记录和评估已有稳定的本地实体边界：`task:<planId>:<taskId>`、`review:<planId>:<reviewId>`、`record:<planId>:<date>`。计划 ID 由原生计划存储层提供，不能从标题推导。
- `SyncStore` 使用 Android Keystore 中的 `shiyi-sync-device` EC 密钥别名，并以原子文件保存设备 ID、database epoch、设备序号、配对状态、outbox/inbox 游标、去重列表、手动同步状态和提醒列表。私钥不会进入 WebView 或同步载荷。
- 设置页提供“拾遗连接”：自动准备同步、手动地址、配对信息、解除绑定和手动同步入口。未绑定或桌面端未连接时，状态分别显示“未绑定”或“等待拾遗启动”；手动同步不会伪造成功。
- 已加入 `daily-study://today`、`daily-study://plan`、`daily-study://review` 等深链入口。未知目标会返回 `unsupportedTarget` 并回到今日页，不会使应用崩溃。
- 已加入确认提醒的本地保存、非精确定时和通知深链准备。下行提醒落地后由 Android 本地调度；是否被用户看到需要真实设备验证。

**同步边界**

每日学习仍是本机优先的 Java/WebView/JSON 应用；本次没有引入云服务器、任意局域网文件访问、远程 Shell 或 AI 密钥接口。`SyncStore.syncNow()` 当前返回“等待拾遗桌面端”，直到桌面端协议客户端真正接入并返回 ACK，outbox 不会被清除。

**Gate 0 验收清单**

已准备：

- 稳定 ID、数据字典、协议版本和 golden fixtures；
- Android Keystore 设备身份别名；
- 原子同步状态、outbox/inbox/cursor/去重字段；
- 配对、解除绑定、手动地址和状态入口；
- 本地提醒与 `daily-study://` 深链接收器。

待真实拾遗桌面端和 Android 手机完成：

- 同一 Wi-Fi 下首次配对和设备指纹校验；
- 手机离线产生 20 条记录，重连后按事件 ID 幂等传输并收到 ACK；
- 局域网地址变化后无需重新配对；应用、桌面端重启和电脑睡眠后恢复；
- 未授权设备被拒绝；电脑关闭时手机仍能看到已调度的本地提醒；
- 原有保存、计时、评估、备份和升级回归；
- Android 17 的本地网络权限策略在目标 SDK 升级后重新评审。

截至本文更新时间，没有真实手机和拾遗桌面端连接，因此上面的待验收项不计为完成。
