# 第三方材料

**报表字体**

PDF使用 Daily Study Report 字体，基于 Noto Sans SC，遵循 SIL Open Font License 1.1。应用包包含完整许可 `assets/report-font-OFL.txt`，可从「设置 → 关于 → 开源许可」查看。字体版权与许可证按原文件保留。

来源：[google/fonts 固定版本](https://github.com/google/fonts/tree/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc)，提交 `2894aab31764f10f29c421bdfd2340d3b382d384`。原字体 SHA256：`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`。

本项目将可变字体实例化为400字重，改名为 Daily Study Report，为497组 Unicode 别名复制等形字形，使每个字符具有独立字形编号。改名符合原字体保留名称要求。工具为 fontTools 4.66.1，重现脚本为 `scripts/prepare-report-font.py`；[实例化工具文档](https://fonttools.readthedocs.io/en/latest/varLib/instancer.html)。该工具仅用于开发时生成资源。

打包字体为10688144字节，SHA256：`91bbf3b62daf774a14edd0eac36b121e678af9e7228a97f52f23e1c6cb8c011c`。来源与生成摘要见 [provenance](validation-v1.3.3/report-font-provenance.json)。

**日签图文**

日签文字和图片的来源按每条内容保留。报表字体许可不代表日签图片或文字许可；具体署名继续显示在日签及导出卡片中。
