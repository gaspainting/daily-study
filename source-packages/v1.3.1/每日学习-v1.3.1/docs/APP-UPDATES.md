# App 内更新与发行通道

更新仓库：[gaspainting/daily-study-releases](https://github.com/gaspainting/daily-study-releases)。用户已确认使用专用公开仓库；仅上传正式 APK、update.json 和 RELEASE-NOTES.md。源码、签名私钥、手机学习记录与备份不作为发布资源上传。APK 内的界面资源和默认计划随安装包公开。

**手机上的操作**

首次安装包含更新入口的 APK，之后在「关于」点击「检查更新」。有新版时查看更新内容、下载，再选择安装；Android 要求安装授权或确认时按系统界面完成。电脑发布新版后，手机可使用自己的网络获取，无需每次从电脑传送文件。手机仍需下载完整 APK；普通检查更新不会直接替用户完成安装。

此通道由 App 主动检查，当前不提供后台服务器推送。GitHub 在 vivo X100s / Android 16 当前网络中的访问情况需要真机验证；不能用电脑连通的结果代替。

**版本与签名**

显示版本以已安装 PackageInfo 为准，发布清单从编译后的 APK 读取版本名、versionCode、包名和最低系统版本。prepare-release 同时核对当前源码 Manifest，避免发布旧构建。升级顺序比较 versionCode，禁止回退。保持本机现有签名，证书 SHA-256 为：

```
fa74d9cbf26f6d34709400a576b93442b8295bdb607e7f80753669133244c3b5
```

签名私钥仍在本机 .signing；更换签名不能覆盖现有安装。发布工具使用 apksigner 验证正式 APK，拒绝可调试包、仪器测试入口、testOnly 包及其他签名。手机端下载后校验摘要、包名和版本，并比对签名证书；Android 安装器完成最终安装签名验证。

**电脑发布操作**

在项目目录运行现有构建和项目测试。更新源码 Manifest 的 versionName / versionCode，准备只描述本次已交付功能的更新说明；未完成的下一阶段功能不能写入发布说明。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\release-tooling.test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-release.ps1 -ApkPath .\dist\每日学习-v1.3.1.apk -NotesPath .\docs\RELEASE-NOTES-v1.3.1.md
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-release.ps1 -ReleaseDirectory .\release\v1.3.1 -ValidateOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-release.ps1 -ReleaseDirectory .\release\v1.3.1
```

示例版本号需随实际发布改动。发行目录必须新建，工具不会覆盖旧目录。prepare-release 从真实 APK 生成三个公开文件：

| 文件 | 内容 |
|---|---|
| daily-study-v版本.apk | 已验证的正式安装包，文件名使用 ASCII |
| update.json | 包名、版本、系统要求、APK 地址/字节数/SHA-256、证书摘要、更新说明和日期 |
| RELEASE-NOTES.md | 与清单中的 releaseNotes 内容相同的中文更新说明 |

publish-release 在实际上传前重新校验，复制固定快照，再检查公开仓库、已有标签及旧版本清单。已存在的版本或标签不会移动；新 versionCode 必须高于已有正式版本。安装包不得超过 64 MiB，更新说明不得超过 8000 个字符或 16 KiB，完整清单不得超过 64 KiB。发布时先创建草稿，仅上传上述三个文件；核对 GitHub API 返回的资源大小与 SHA-256，并重新下载三个资源比对。校验完成后才发布为 latest，再读取公开稳定清单检查内容。

上传或草稿验证失败时，该版本保留为草稿供检查，不自动删除或覆盖。默认发布仍拒绝重复版本。检查草稿后，可以使用 -ResumeDraft 恢复；工具要求同版本草稿仅有三个资源，且其文件名、大小、SHA-256 与本地待发布文件全部一致，再按资源 ID 认证下载、重新验证，最后按发行 ID 发布。恢复不会补传、修改或覆盖资源；内容不一致时拒绝继续。草稿对应的 Git 标签在发布前可能不存在，因此不使用按标签读取草稿或下载草稿资源的流程。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-release.ps1 -ReleaseDirectory .\release\v1.3.1 -ResumeDraft
```

发布已经成功、但最后公开链接验证失败时，工具会明确报告该状态，不能据此认为远程没有版本，也不能用 ResumeDraft 修改已经公开的版本。

本地验证模式 -ValidateOnly 不联网、不创建仓库或发布；实际发布需要 gh 已登录有权写入仓库的账号，工具不读取或打印个人令牌。

**下载地址和清单**

手机固定检查地址：

[最新版本清单](https://github.com/gaspainting/daily-study-releases/releases/latest/download/update.json)

APK 使用带不可变版本标签的下载地址，例如 releases/download/v1.3.0/daily-study-v1.3.0.apk。清单 formatVersion 为 1，字段为 packageName、versionCode、versionName、minSdk、apkUrl、apkBytes、apkSha256、signerSha256、releaseNotes（字符串）和 releaseDate（YYYY-MM-DD）。所有网络地址使用 HTTPS；不将 GitHub 长期令牌写入 APK。

**数据和验证范围**

更新通过同包名、同签名覆盖安装，保留现有应用数据。安装会终止旧应用进程，因此进入实际安装前处理活动计时和未保存输入；检查或下载本身不能自动丢弃这些内容。操作发起后不直接显示「更新成功」，重新进入 App 时读取已安装的真实版本。

本地发布工具测试覆盖实际 APK 元数据/证书、三文件清单、中文换行、版本/来源/摘要异常、额外文件、重复输出目录、测试包和损坏包。App 更新功能、系统安装取消/授权及覆盖保留数据的实际结果应在对应版本的发布验证报告中记录。真机未执行的项目仍标为未验证。

**依据**

- [GitHub Release 资源 API](https://docs.github.com/en/rest/releases/assets)：读取资源地址、大小和摘要。
- [GitHub Release 稳定链接](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)：latest/download/update.json。
- [Android 安装交互](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int))：系统用户确认须按实际结果处理。
