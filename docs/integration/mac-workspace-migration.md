# Windows 集中开发与 macOS 验收说明

当前协作策略已从“把 Android 工作区迁移到 Mac”调整为：Windows 同一工作区维护每日学习 Android、拾遗 Windows 开发版和 Supabase 测试环境；macOS 只在拾遗功能完成后通过 GitHub Actions runner 构建安装包，并在 Mac 上做原生能力和真机验收。

## 仓库和边界

- Android 仓库：<https://github.com/gaspainting/daily-study>，当前协作分支 `feature/shiyi-cloud-sync-v2.5.0`。
- 拾遗保持独立 Git 仓库，不能把两个项目合并成一个发布流程。
- GitHub 保存源码、共享协议、fixtures、测试、CI 和安装包发布物，不保存私人学习数据、Supabase 管理密钥、登录会话、备份或签名私钥。
- Android 的本地 JSON、正式保存、评估、计时、任务、回顾、备份和提醒仍由现有工程负责；拾遗使用 Tauri/Vue/TypeScript/Rust/SQLite。两端只通过唯一版本的 OpenAPI、JSON Schema、错误码和 fixtures 协作。

Windows 工作区建议采用同一父目录下的两个独立目录，例如：

```text
D:\南京邮电大学\learning\study-checkin-android
D:\南京邮电大学\learning\shiyi
```

如果拾遗目录尚未创建，先由拾遗项目初始化仓库；Android 端不会用空目录或文档假定它已经存在。

## Windows 联调顺序

1. 在两个仓库分别切换同一协作里程碑，确认共享契约、fixtures 和错误码的提交版本一致。
2. 在 Windows 启动 Supabase 测试环境和拾遗开发版，使用脱敏数据跑能力协商、Auth、push/pull/ACK、冲突、墓碑、提醒和恢复场景。
3. Android 端执行本地保存、离线队列、崩溃恢复、游标过期和旧备份回归；本地失败不能阻止正式保存。
4. 保存测试日志、请求/响应摘要和 fixtures 版本，再决定是否进入新的 Android 版本候选。

Android 本机的测试构建仍可使用：

```powershell
& .\build.ps1 -TestBuild
pwsh -NoProfile -File ./build.ps1 -TestBuild
node --test tests/*.test.cjs
```

构建产物在本机 `dist/`，不会提交到 GitHub。正式覆盖安装必须继续使用原有签名；测试签名不能替代 v2.4.0 的发布签名。

## macOS runner 和 Mac 验收

Windows 联调通过后，由 GitHub Actions 的 macOS runner 为拾遗工程构建 `.app/.dmg`。Mac 验收关注 Tauri/WKWebView、Keychain、Finder 文件权限、通知、签名和安装升级行为；这一步不能被 Windows 浏览器、模拟服务或 Android 构建替代。

Android 工程不要求为了拾遗开发迁移到 Mac。若需要在 Mac 上阅读或复核 Android 源码，可以单独克隆仓库，但这不是主要构建、联调或发布路径：

```sh
git clone https://github.com/gaspainting/daily-study.git
cd daily-study
git switch --track origin/feature/shiyi-cloud-sync-v2.5.0
```

## 不得跨机复制的内容

不要把 `.signing/`、`.env`、Supabase 服务端密钥、`sync-state.json`、认证会话、真实学习备份、`build/`、`dist/` 或 `tmp/` 复制到 GitHub 或另一个项目。跨端测试只使用脱敏 fixtures；真实学习数据留在设备和受限托管服务中。

## 当前未证明的内容

本说明只固定工作区和发布边界。当前仓库仍没有拾遗项目、Supabase 测试项目、可访问 HTTPS 端点、测试账号或真实 Android 设备，因此不能据此宣称 Windows 联调、异网同步、RLS、设备撤销、推送、Mac 安装或 Gate 0 已完成。
