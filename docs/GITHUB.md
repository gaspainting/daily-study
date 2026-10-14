# GitHub项目与归档

仓库：[gaspainting/daily-study](https://github.com/gaspainting/daily-study)，公开。当前源码版本为v1.3.3/code7。

**main分支**

| 路径 | 内容 |
|---|---|
| app/ | Java宿主、网页界面、Android资源、报表字体与许可 |
| scripts/、build.ps1、generate_seed.py | 构建、发布、字体生成、交付打包 |
| tests/ | 模型、原生与真实WebView回归，测试夹具 |
| docs/ | 需求、设计、约定、使用说明、代码审查、版本报告与规划 |
| docs/screenshots/、docs/validation-*/ | 各轮页面截图、导出样例、原始测试结果与摘要 |
| docs/source/seed-reference.md | 可独立重建seed的70日原参考数据 |
| release/v*/update.json、RELEASE-NOTES.md | 已发布版本的清单和说明 |

完整文件摘要见 [上传清单](github-source-manifest.json)。构建私钥、编译缓存、临时设备快照与测试安装包由.gitignore排除。现有签名文件留在原本机目录。

**历史源文件与交付材料**

[source-archive分支](https://github.com/gaspainting/daily-study/tree/source-archive)保存本机v1.0.0至v1.3.3源码包、验证资料包内的文件和各版交付说明。归档保留原ZIP内路径，文件逐个与原包比较；archive-manifest.json记录原ZIP摘要和文件索引。它是本次导入的文件快照，不补造原开发提交时间。

原始源码ZIP与验证ZIP已展开为可浏览的文件。正式APK和摘要也保留在归档的delivery目录；App下载仍使用已有Releases路径。

**下载与开发**

```powershell
git clone https://github.com/gaspainting/daily-study.git
cd daily-study
python generate_seed.py
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

源码构建需要JDK21、Android SDK36和对应build-tools。通过JAVA_HOME和ANDROID_SDK_ROOT选择本机路径。生成报表字体另需fontTools4.66.1；日常构建使用已打包字体。

已有手机覆盖升级继续使用原签名；新克隆未含该私钥，会生成另一签名的本地包。正式更新按 [更新通道](APP-UPDATES.md)操作。既有v1.3.0至v1.3.3发布及其APK、update.json、说明保持原资源和下载地址。

**仓库改名与版本来源**

仓库由daily-study-releases改名为daily-study；旧更新路径通过GitHub重定向兼容已安装App。已发布APK、清单及原版本标签不替换。当前源码另标记为source-v1.3.3，可从该标签下载完整源码。此轮修改构建输入的仓库后备路径、Git目录规则和发布脚本，App生产源文件及已发布APK保留原字节。

[GitHub仓库改名说明](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)。
