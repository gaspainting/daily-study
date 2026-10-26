# 每日学习

面向 Android 的学习手记：安排课程复习与考研学习，记录时间、单词和每周目标。

[下载最新版](https://github.com/gaspainting/daily-study/releases/latest) · [使用说明](docs/使用说明.md) · [本次更新](docs/RELEASE-NOTES-v1.6.3.md)

当前版本 **v1.6.3**，支持 Android 8.0 及以上。

**主要功能**

| 功能 | 内容 |
|---|---|
| 今日记录 | 手动填写、学习计时、随记、草稿恢复 |
| 课程复习 | 编辑课表、临时调课与停课、逐门复习清单 |
| 单词学习 | 新学与复习分别计数，分次明细、总数调整、修改与撤销 |
| 目标与评估 | 自填周目标与任务、自动生成每日参考区间、分钟与数量目标、按今日安排评估完成情况 |
| 复盘与统计 | 周复盘、历史搜索与筛选、月历、趋势、计时明细 |
| 计划管理 | 多计划切换、科目添加（分钟或数量）、归档与排序 |
| 日签 | 开屏图文、每日日签、收藏、历史回看、保存图片与分享 |
| 提醒与桌面 | 学习提醒、备份提醒、桌面小组件 |
| 备份与报表 | ZIP 完整备份、旧 JSON 导入、CSV 与 PDF 报表 |
| 帮助与更新 | 设置内使用手册、启动检查更新、App 内下载安装 |

**安装与更新**

从[发行页](https://github.com/gaspainting/daily-study/releases/latest)下载 APK 安装。覆盖安装保留应用数据；卸载会删除应用数据。

重新启动 App 时自动检查更新，发现新版后显示版本说明和下载入口。选择“稍后”后，可从页头继续更新。从后台返回不重复提示。

v1.5.1 及更早版本需先通过「设置 → 关于 → 检查更新」安装本版。下载完成后点击安装，按 Android 提示授权并确认。

操作方法见 App 内「设置 → 使用手册」或[完整使用说明](docs/使用说明.md)。

**开发与测试**

Java Activity + WebView，界面使用 HTML、CSS 和 JavaScript。构建依赖 JDK 21、Android SDK 36 和 Build Tools 36.0.0，通过 JAVA_HOME 与 ANDROID_SDK_ROOT 指定路径。模型测试使用 Node.js，资料生成脚本使用 Python 3。

```powershell
& .\build.ps1
& .\build.ps1 -TestBuild
node --test tests/*.test.cjs
```

构建产物位于 dist/，版本和文件名来自 AndroidManifest.xml。首次构建会在 .signing/ 生成个人签名；后续覆盖升级需沿用同一签名。

安装测试包后，可在专用模拟器执行原生及 WebView 回归：

```powershell
$env:ANDROID_SERIAL = 'emulator-5572'
adb -s emulator-5572 shell am instrument -w -r cn.edu.njupt.studycheckin/cn.edu.njupt.studycheckin.SmokeTests
node tests/startup-update-ui.cjs
node tests/update-regression-ui.cjs
node tests/manual-ui.cjs
node tests/word-log-ui.cjs
node tests/layout-navigation-ui.cjs
```

设备交互测试逐个执行。构建和执行结果见[v1.6.1 验证报告](docs/V1.6.1.md)，发布命令见[发行通道](docs/APP-UPDATES.md)。

**项目资料**

- [开发范围与后续规划](docs/NEXT-DEVELOPMENT.md)
- [仓库结构与历史归档](docs/GITHUB.md)
- [课程与参考区间安排](docs/课程优先安排-v1.4.1.md)
- [70 日参考表](docs/source/seed-reference.md)
- [日签图片来源](docs/插图来源与选择核查.md)
- [第三方资源与许可](docs/THIRD-PARTY-NOTICES.md)
