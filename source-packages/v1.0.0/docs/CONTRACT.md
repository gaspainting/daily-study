# 每日学习：实现约定

用户：vivo X100s / Android 16。离线独立 APK，黑白纸张风格，提醒默认关闭。
包名 cn.edu.njupt.studycheckin；Java 原生宿主 + APK 内离线 HTML/CSS/JS 界面。
最低 API 26，compile/target API 36；不请求网络或广泛文件权限。

## 状态

`{version:1, plan:{title,startDate,endDate,startWeek,subjects,targets,weekGoals,weekHints}, records:{}, reviews:{}, settings:{reminders:{enabled:false,weekdayTime:"19:15",weekendTime:"10:00"}}}`

- subjects: `{id,name,kind,defaults:[Mon,...,Sun]}` 数组；内置 math/高数/math、vocab/单词/vocab，自定义 kind=custom。defaults 是新增日期参考值。
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
- 页面启动与宿主onResume执行 `window.onNativeResume()`，页面应重新载入 state/timer（表单dirty时避免覆盖未保存编辑，提示先保存）。

## Java跨文件接口

Root实现 DataStore、TimerStore、AppRules、MainActivity；platform agent实现 TimerService、ReminderReceiver、ReminderScheduler、StudyWidget 及widget资源。

DataStore.load(Context) -> JSONObject；DataStore.save(Context,JSONObject) throws Exception；DataStore.validate(JSONObject) throws Exception。
TimerStore.snapshot(Context) -> JSONObject；TimerStore.start(Context,String id,String name,String date) -> JSONObject；TimerStore.action(Context,String) -> JSONObject。
AppRules.allowed(LocalDateTime) -> boolean；AppRules.allowedTime(LocalDate,int hour,int minute) -> boolean。
ReminderScheduler.schedule(Context)；StudyWidget.refreshAll(Context)。
TimerService.ACTION_REFRESH="cn.edu.njupt.studycheckin.REFRESH_TIMER"；宿主startForegroundService启动刷新。每秒检查TimerStore.snapshot；若inactive停服务，若running通知提供pause/finish，paused提供resume/finish；对snapshot.message给出休息暂停说明。通知动作调用TimerStore.action，更新widget。不在boot启动FGS。
ReminderReceiver收BOOT_COMPLETED、TIME_SET、TIMEZONE_CHANGED、MY_PACKAGE_REPLACED及自定义提醒action；用inexact AlarmManager，触发时再次核对休息边界和计划范围，过晚则不发；schedule从settings取weekdayTime/weekendTime，默认off。POST_NOTIFICATIONS由Activity请求。
StudyWidget显示今日日期、两科或自定义科目的实际/参考、当天状态、打开APP按钮；黑白细线；updatePeriodMillis1800000。

## UI 页面

底部 今日/计划/复盘/设置；历史可在今日日期选择或计划日列表进入。今日含选日、参考、周目标与提示、timer、科目实际编辑（详细字段折叠）、状态/休息/原因。计划支持日期范围、起始教学周、科目新建与defaults修改、某天参考量、周目标。复盘含真实汇总/已记录比例和条形图，以及周复盘表单。设置含提醒开关及weekday/weekend time、备份导入导出、pinWidget、休息说明及版本。
页面使用中文，正文>=14px、控件触控>=44px，safe-area及native insets不重复。无在线字体或依赖。
