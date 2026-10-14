# 每日学习 Android App

当前发行目标 v1.2.0 / versionCode 3。Java 原生 Activity 与 WebView，界面 HTML/CSS/JS 打包在 APK 内；不使用前端框架或 Gradle。最低 Android 8.0，目标 Android 16。

支持 70 天学习计划、手动记录与计时、计划编辑及新科目、每周复盘、学习提醒、桌面小组件、ZIP 完整备份与旧 JSON 恢复。日签使用联网取得的真实图片，包含启动展示、固定每日抽签、收藏、历史、图片导出及系统分享。

v1.2.0 清理常驻开发说明，改用字段标签、真实记录状态及操作反馈；保留数据字段、枚举、统计口径、手动保存、固定休息边界与备份格式。空白与 0 分开保存，不填入参考量，不将休息状态转换为 0。

**构建与验证**

本机 JDK 21 与 Android SDK 36：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -TestBuild
node --test .\tests\model.test.cjs
```

构建脚本使用 javac、aapt2、d8、zipalign 和 apksigner，文件名与版本从 Manifest 读取。「关于」从已安装 PackageInfo 读取版本。正式 APK 不带仪器测试入口或 WebView 调试；测试 APK 供 ADB/CDP 回归使用，测试脚本使用 ANDROID_SERIAL 指定设备，默认 emulator-5572。

原生测试：

```powershell
adb -s emulator-5572 shell am instrument -w -r cn.edu.njupt.studycheckin/cn.edu.njupt.studycheckin.SmokeTests
```

真实 WebView 交互脚本位于 tests，逐个运行；不要并行操作同一模拟器。说明与执行结果见 [v1.2.0报告](docs/V1.2.0.md)，详细对照见 [文案审计](docs/ux-copy-audit.md)，截图和结果位于 docs/screenshots/v1.2.0 与 docs/validation-v1.2.0。旧版本报告保留其原版本，不作为本轮通过证明。

**数据和项目材料**

学习状态与图文状态分开保存在应用私有目录，无应用级云同步，Manifest allowBackup=false。系统设备迁移行为依厂商实现，不能据此保证数据永不离开手机。ZIP 恢复先校验、显示覆盖范围、确认，再使用恢复日志处理多文件更新；旧 JSON 保留现有图文。恢复过程中未保存计时需要先处理。

签名文件在 .signing/personal-release.p12，源码分享包不包含私钥。保留本机签名以覆盖升级；自行生成其他签名无法覆盖现有签名安装。

参考计划来自上级 output/每日打卡表_独立会话交接说明.md。generate_seed.py 提取连续 70 日数据并核对每周合计，初始实际记录、复盘、计时会话为空。图片来源与选择规则见 [插图来源核查](docs/插图来源与选择核查.md)，原 v1.1.0 需求及验证见 [历史说明](docs/V1.1.0.md)。

用户已确认手机当前安装 v1.1.0，与本地源码、APK和截图一致。本轮发布 v1.2.0 / code 3，并重新验证同签名覆盖升级。
