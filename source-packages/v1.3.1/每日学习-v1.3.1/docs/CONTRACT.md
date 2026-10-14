# 每日学习：实现约定

用户：vivo X100s / Android 16。离线独立 APK，黑白纸张风格，提醒默认关闭。
包名 cn.edu.njupt.studycheckin；Java 原生宿主 + APK 内离线 HTML/CSS/JS 界面。
最低 API 26，compile/target API 36。v1.1.0增加INTERNET权限用于原生HTTPS素材获取，不请求广泛存储或读取相册权限；学习记录仍本地保存。

## 状态

`{version:2, plan:{title,startDate,endDate,startWeek,subjects,targets,weekGoals,weekHints}, records:{}, reviews:{}, settings:{reminders:{enabled:false,weekdayTime:"19:15",weekendTime:"10:00"}}}`

- subjects: `{id,name,kind,defaults:[Mon,...,Sun],activePeriods?:[{from,to:null|ISO}]}` 数组；内置 math/高数/math、vocab/单词/vocab，自定义 kind=custom。defaults 是新增日期参考值。
- targets: ISO 日期 -> subjectId -> 非负参考分钟（0..1440），初始精确保留70天参考量。
- weekGoals/weekHints: 周首日 ISO -> 文本；首周开始日视作首周锚点。
- records: ISO 日期 -> `{subjects:{subjectId:{minutes:null|number,content:"",problem:"",newWords:null|integer,reviewWords:null|integer,forgotWords:""}},status:null|"正常参考"|"减量"|"仅回顾"|"休息",restKept:null|boolean,note:""}`。
- reviews: 周锚点 ISO -> `{load:"",mathProblem:"",vocabReview:"",adjustment:"",reason:"",halfDayRest:null|boolean}`。
- 空白=null，确认未学习=0；不能将缺失自动转成0。计时保存精确 minutes=秒/60，同时附加 sessions 数组（id/date/subjectId/seconds/endedAt）。
- 改日期范围保留既有 targets/records，不删除历史；新增日依科目defaults填参考；周号由startWeek与startDate相对计算。初始周目标与提示精确保留。
- 不设连续打卡惩罚、最低完成率、自动补量/强推课程。实际汇总必须显示已记录天数，缺失不等于0。

## Native JS桥（同步 JSON 字符串）

- `getState()` -> state JSON。
- `saveState(json)` -> `{ok:true}` 或 `{error:"..."}`。宿主原子写文件并更新widget/提醒。
- `getTimer()` -> `{active:false}` 或 `{active:true,subjectId,subjectName,date,running,elapsedMs,message}`。
- `startTimer(id,name,date)` -> timer snapshot 或 `{error}`。
- `timerAction("pause"|"resume"|"finish"|"discard")` -> snapshot 或 `{finished:true,date,subjectId,seconds,minutes}` 或 `{error}`。finish原子加入record科目实际分钟，保留原字段；默认状态仅在空白时填正常参考。
- `exportBackup()` / `importBackup()` -> `{ok:true}` 或 `{error}`，打开系统文档选择器。导入原生验证+替换确认，活动计时阻止导入，不导入正在运行的计时。
- `pinWidget()` -> `{ok:true}` 或 `{error}`。
- `getPlatformInfo()` -> `{androidVersion,sdkInt,notificationsGranted,remindersExact:false}`。
- `toast(text)`。
- 页面启动与宿主onResume执行 `window.onNativeResume()`，页面应重新载入 state/timer（表单dirty时保留编辑并单独持久化草稿）。

## Java跨文件接口

Root实现 DataStore、TimerStore、AppRules、MainActivity；platform agent实现 TimerService、ReminderReceiver、ReminderScheduler、StudyWidget 及widget资源。

v1.1.0在同一项目新增InspirationStore、InspirationSources、ImageChecks、InspirationPoster、CardShareProvider、BackupManager。图片优先联网获取，不内置离线插画或程序生成图。学习state维持version:1及原有严格字段，图文使用独立inspiration.json，无需把旧记录重写成另一套模型。

图文桥：getStartup()仅在新Activity会话首次调用返回show:true；首次无图片时返回waiting并启动素材准备，nextStartup()/cancelStartup()控制准备后的展示或跳过。getInspiration(scope,offset,limit)分页返回今日固定卡/历史/状态；drawDaily()使用当前本地日期原子抽取，无未展示图片时可返回pending并异步准备，成功后固定保存。getInspirationEntry(id)、favoriteInspiration(id,value)、setInspirationOnline(value)、refreshInspiration()、cleanInspirationPending()、saveInspirationImage(id)、shareInspiration(id)。后台联网和媒体操作通过onInspirationChanged通知页面，不覆盖其他页面未保存的学习表单。

完整备份改为ZIP：manifest.json含format=daily-study-complete、version=1、study和inspiration；media/保存摘要命名的实际图片。旧版JSON只恢复学习记录。所有解压路径白名单验证，图片摘要核对；两份状态的恢复通过私有restore-journal.json回滚日志保护。网络图片仅从https://study.local/media/摘要文件名映射到私有媒体目录展示；WebView本身阻断网络加载。

DataStore.load(Context) -> JSONObject；DataStore.save(Context,JSONObject) throws Exception；DataStore.validate(JSONObject) throws Exception。
TimerStore.snapshot(Context) -> JSONObject；TimerStore.start(Context,String id,String name,String date) -> JSONObject；TimerStore.action(Context,String) -> JSONObject。
AppRules.allowed(LocalDateTime) -> boolean；AppRules.allowedTime(LocalDate,int hour,int minute) -> boolean。
ReminderScheduler.schedule(Context)；StudyWidget.refreshAll(Context)。
TimerService.ACTION_REFRESH="cn.edu.njupt.studycheckin.REFRESH_TIMER"；宿主startForegroundService启动刷新。每秒检查TimerStore.snapshot；若inactive停服务，若running通知提供pause/finish，paused提供resume/finish；对snapshot.message给出休息暂停说明。通知动作调用TimerStore.action，更新widget。不在boot启动FGS。
ReminderReceiver收BOOT_COMPLETED、TIME_SET、TIMEZONE_CHANGED、MY_PACKAGE_REPLACED及自定义提醒action；用inexact AlarmManager，触发时再次核对休息边界和计划范围，过晚则不发；schedule从settings取weekdayTime/weekendTime，默认off。POST_NOTIFICATIONS由Activity请求。
StudyWidget显示今日日期、两科或自定义科目的实际/参考、当天状态、打开APP按钮；黑白细线；updatePeriodMillis1800000。

## UI 页面

底部 今日/计划/复盘/日签/设置；历史可在今日日期选择或计划日列表进入。今日含选日、参考、周目标与提示、timer、科目实际编辑（详细字段折叠）、状态/休息/原因。计划支持日期范围、起始教学周、科目新建与defaults修改、某天参考量、周目标。复盘含真实汇总/已记录比例和条形图，以及周复盘表单。设置含提醒开关及weekday/weekend time、备份导入导出、pinWidget、休息说明及版本。
页面使用中文，正文>=14px、控件触控>=44px，safe-area及native insets不重复。无在线字体或依赖。


## v1.3.1 数据与接口

当前学习 schema=2。schema1 在读取时克隆迁移，只有写入动作更新文件；不把读取迁移当成用户保存。旧 `mathProblem`、`vocabReview` 保留，并映射到 `reviews[week].subjects[id]`。前端与原生同时验证新旧输入。

`activePeriods` 为左闭右开的日期区间，省略表示始终有效。归档当日不再计入无记录的参考与分母；过去有效日期保持原统计，已有实际记录继续计入。恢复开启新时段，不删除旧区间。科目排序保留 ID。显式 0、空白和只填写随记继续区分。

`plans.json` 保存最多8个计划，activeId 指向 `study-state.json`，其他计划有完整 state。首次使用旧单计划直接映射 main，读取不覆盖旧数据。创建新计划不复制实际记录、复盘和会话。切换前处理全部活动/暂停计时；切换日志保护 study/catalog 两文件，恢复失败时阻断写入并提供重新读取。学习提醒和小组件跟随当前计划；日签、备份提醒和下载状态共用。

完整 ZIP version2 包含全部计划、当前学习状态、图文状态及媒体。ZIP1/旧 JSON 仅替换当前计划；ZIP1 同时替换图文，JSON 保留图文；其他计划保留。三文件恢复使用日志回滚。确认前校验，确认时核对当前计划未改变，恢复成功清除对应范围草稿。

草稿保存于独立 `drafts.json`，键为 planId:表单上下文，值含 base、values、updatedAt。原始字符串和布尔值保留空白、0及多行输入。草稿不参与正式记录、统计、备份或报表；实际保存后清除该份草稿。冲突由用户选择；失败保留输入并可重试。

新增桥：
- `getDraft(key)` / `saveDraft(key,baseJSON,valuesJSON)` / `deleteDraft(key)` / `clearDrafts()`。
- `getPlans()` → `{activeId,plans:[{id,name}]}`；`createPlan(stateJSON)` → `{ok,id}`；`switchPlan(id)`。
- `getBackupStatus()` / `setBackupReminder(enabled,days)` / `openBackupNotificationSettings()`。
- `exportReport(format,start,end,subjectId)`：系统保存位置，CSV/PDF，只读当前计划快照；完成写入后提示成功，不更新备份日期。
- `searchInspiration(scope,offset,limit,query,theme,language)` / `getInspirationFilters()`：全量已有历史先筛选再分页。
- `getLaunchRoute()`：消费一次备份提醒的 settings 目标。

报表保留空白/0，CSV含BOM及公式注入保护；PDF黑白A4、中文自动折行和分页。明细只展示保存的结束时间和净时长，不伪造开始时间。原有计时边界、提醒休息不补发、手动保存和版本信息来源不变。
