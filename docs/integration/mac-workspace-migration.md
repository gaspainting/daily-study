# macOS 工作区迁移与协同开发说明

这份说明把 Windows Android 工程迁移到 Mac 时需要保留的源码、环境和边界固定下来。它不把私人学习数据、登录会话或签名私钥放进 GitHub。

## 迁移来源

当前可协作分支：`feature/shiyi-cloud-sync-v2.5.0`  
源码仓库：<https://github.com/gaspainting/daily-study>  
Android 工程目录：`study-checkin-android`

在 Mac 上重新克隆源码：

```sh
git clone https://github.com/gaspainting/daily-study.git
cd daily-study
git switch --track origin/feature/shiyi-cloud-sync-v2.5.0
```

GitHub 仓库只包含源码、契约、fixtures、测试和文档。不要把 Windows 工作区中的 `.signing/`、`.env`、`sync-state.json`、学习备份、APK 缓存、`build/`、`dist/` 或 `tmp/` 当作协作文件复制上去。已有 Android 安装的覆盖升级必须继续使用原签名；签名文件只能通过用户选择的私密渠道单独转移，不能提交到仓库。

## Mac 环境

需要以下工具：

- macOS 可用的 JDK 21；设置 `JAVA_HOME`。
- Android SDK Platform 36 和 Build Tools 36.0.0；设置 `ANDROID_SDK_ROOT`（也接受 `ANDROID_HOME`）。
- PowerShell 7、Node.js、Python 3 和 `adb`。
- 真机或 Android 模拟器只用于设备回归，不替代 Node/原生构建检查。

典型环境变量如下，SDK 路径按 Mac 实际安装位置调整：

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"
```

构建脚本 `build.ps1` 已改为按平台选择 `aapt2`、`zipalign`、JDK 工具和临时目录。Mac 上使用 PowerShell 7 执行：

```sh
pwsh -NoProfile -File ./build.ps1 -TestBuild
node --test tests/*.test.cjs
```

构建脚本会在本机 `dist/` 生成测试 APK；这些文件不会进入 Git。首次在 Mac 上生成的新签名只能用于本机测试，不能覆盖已安装的 v2.4.0，也不能替代正式发布签名。

## 两个项目的协作边界

- Android 端继续在本仓库维护 Java/WebView、本地 JSON、outbox/inbox、提醒调度和同步状态。
- Mac“拾遗”在独立工程维护 Tauri/SQLite；两端通过 `contracts/app-capabilities.md`、`contracts/hosted-sync-v1.json` 和 `contracts/fixtures/` 对齐。
- Supabase URL、Auth 配置、RLS、测试账号和服务端密钥属于 Mac/后端环境，不写入 Android 仓库，也不放入 APK、WebView、日志或备份。
- 共享数据只能使用脱敏 fixtures。真实学习记录仍留在各自设备和托管数据库，不通过 GitHub 提交。

Mac 端交付接口时，先提交正式 OpenAPI/JSON Schema、能力响应、错误码、revision/cursor/tombstone 语义和测试 fixtures，再由 Android 分支接入。当前提醒下行适配和其他未支持命令的拒绝边界见 [`mac-backend-handoff.md`](mac-backend-handoff.md)。

## 尚未由 Windows 证明的内容

本说明只解决源码工作区和构建入口的迁移准备。Windows 端没有 Mac 机器、Supabase 测试项目或真实 Android 设备，因此 Mac 构建、异网同步、RLS、账号撤销、推送和联合 Gate 0 仍需在 Mac/后端交付后实测。首次在 Mac 上成功编译不等于跨网络联调完成。
