# 每日学习 Android App

当前发行版本 [v1.4.2 / versionCode 12](https://github.com/gaspainting/daily-study/releases/tag/v1.4.2)。Java 原生 Activity 与 WebView，界面 HTML/CSS/JS 打包在 APK 内；不使用前端框架或 Gradle。最低 Android 8.0，目标 Android 16。

[源码与项目材料](https://github.com/gaspainting/daily-study) · [安装包与版本发布](https://github.com/gaspainting/daily-study/releases) · [GitHub目录与历史归档](docs/GITHUB.md)

支持 70 天学习计划、手动记录与计时、计划编辑及新科目、每周复盘、学习提醒、桌面小组件、ZIP 完整备份与旧 JSON 恢复。日签使用联网取得的真实图片，包含启动展示、固定每日抽签、收藏、历史、图片导出及系统分享。

v1.2.0 清理常驻开发说明，改用字段标签、真实记录状态及操作反馈；保留数据字段、枚举、统计口径、手动保存、固定休息边界与备份格式。空白与 0 分开保存，不填入参考量，不将休息状态转换为 0。

v1.3.0 增加「设置 → 关于 → 检查更新」。[gaspainting/daily-study](https://github.com/gaspainting/daily-study) 同时存放源码和发行资源。App通过Releases中的版本清单获取正式APK；源码位于main分支。更新下载独立于学习记录；安装前处理未保存输入和活动计时，使用 Android 系统安装确认。

**构建与验证**

本机 JDK 21 与 Android SDK 36：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -TestBuild
node --test .\tests\course-schedule.test.cjs
python .\scripts\generate-course-schedule.py
node --test .\tests\model.test.cjs .\tests\tracking-model.test.cjs .\tests\vocabulary-model.test.cjs .\tests\words-model.test.cjs .\tests\audit-algorithms.test.cjs .\tests\weekly-goals.test.cjs
```

构建脚本使用 javac、aapt2、d8、zipalign 和 apksigner，文件名与版本从 Manifest 读取。「关于」从已安装 PackageInfo 读取版本。正式 APK 不带仪器测试入口或 WebView 调试；测试 APK 供 ADB/CDP 回归使用，测试脚本使用 ANDROID_SERIAL 指定设备，默认 emulator-5572。

原生测试：

```powershell
adb -s emulator-5572 shell am instrument -w -r cn.edu.njupt.studycheckin/cn.edu.njupt.studycheckin.SmokeTests
```

真实 WebView 交互脚本位于 tests，逐个运行；不要并行操作同一模拟器。更新流程与发布命令见 [更新通道](docs/APP-UPDATES.md)。当前分配见 [课程优先安排](docs/课程优先安排-v1.4.1.md)。[v1.4.0报告](docs/V1.4.0.md)及 docs/screenshots/v1.4.0、docs/validation-v1.4.0 保留对应发行的验证范围。

**数据和项目材料**

学习状态与图文状态分开保存在应用私有目录，无应用级云同步，Manifest allowBackup=false。系统设备迁移行为依厂商实现，不能据此保证数据永不离开手机。ZIP 恢复先校验、显示覆盖范围、确认，再使用恢复日志处理多文件更新；旧 JSON 保留现有图文。恢复过程中未保存计时需要先处理。

签名文件在 .signing/personal-release.p12，源码分享包不包含私钥。保留本机签名以覆盖升级；自行生成其他签名无法覆盖现有签名安装。

参考计划来自上级 output/每日打卡表_独立会话交接说明.md，仓库保留其构建所需的 [70日参考表](docs/source/seed-reference.md)。generate_seed.py 优先读取原工作区文档，独立克隆时读取仓库参考表；核对每周合计，初始实际记录、复盘、计时会话为空。图片来源与选择规则见 [插图来源核查](docs/插图来源与选择核查.md)，原 v1.1.0 需求及验证见 [历史说明](docs/V1.1.0.md)。

v1.3.1 新增草稿恢复、历史筛选、月历及统计、计时明细、科目归档排序与复盘适配、备份管理、CSV/PDF 报表、日签筛选和多计划切换。范围及交付状态见 [开发清单](docs/NEXT-DEVELOPMENT.md)。内置 AI 暂不开发。


v1.3.2 将单词改为按数量记录，默认每日新学目标50个，复习另记。清空内置周目标和课表提示，目标按周手动填写。旧时长、会话、用户自填内容保留。新增每日目标与词数在计划、复盘、月历、历史、小组件和报表同步显示。


v1.3.3 增加单词累加撤销与按科目配置快捷加数。修复独立表单草稿丢失、单日目标草稿日期混用、旧长文本草稿与原生周目标识别问题；统一恢复异常的后台保护，优化历史/计时查询、报表合计、日签检索与小组件刷新。PDF使用独立报表字体，许可可在「关于」查看。


v1.3.4 加入课程复习，按当天课程与教学周分配参考量。工作日课程与高数合计90分钟；周六90分钟、周日早间60分钟。先课程复习再考研复习，每天灵活安排。单词数量目标、自填周目标与过去记录延续；「计划 → 课程优先安排」可预览并应用参考量。


v1.3.5 修复计划页记录完成后摘要挤占日期与参考量的问题。摘要分行显示，大字号使用纵向布局；记录内容与统计保持原语义。


v1.4.0增加自填周任务、今日勾选、周复盘分组、历史目标及移周，支持草稿、完整备份和PDF周报。旧文字保留，任务与分钟、词数分开；schema3兼容旧数据。修复关闭弹层后旧表单再次写入草稿的问题。




v1.4.1加入每日参考区间与按安排评估，工作日60—120分钟、周六240—360分钟、周日180—300分钟；旧计划经预览确认后应用。修复10月12—15日的课程顺序展示。schema4读取旧数据，区间、小组件、统计及报表同步，实际记录保持原口径。发布状态、截图与执行结果见[本轮报告](docs/V1.4.1.md)。


v1.4.2加入历史评估筛选、依据留存与主动重评、周/月达标率和趋势；报表同步记录评估来源与目标。见[本轮报告](docs/V1.4.2.md)。
