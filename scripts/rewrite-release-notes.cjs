'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const notes = {
  '1.3.0': `# 每日学习 v1.3.0\n\n- 可以在“关于”里检查新版本，直接下载和安装。\n- 下载时显示进度，可以取消或重试。\n- 安装前会提示处理未保存的内容和正在进行的计时。\n- 安装完成后，后续版本也可以直接在 App 内更新。\n`,
  '1.3.1': `# 每日学习 v1.3.1\n\n- 可以创建并切换多个学习计划，每个计划的记录和统计分开保存。\n- 表单填写到一半退出，回来可以继续；点击“保存记录”后才计入当天结果。\n- 历史记录增加搜索、筛选、月历、月统计和计时明细。\n- 科目可以归档、恢复和排序，完整备份包含所有计划。\n- 可以导出 CSV 和 PDF 学习报表。\n- 日签历史、收藏和开屏记录可以按关键词、主题和语言查找。\n`,
  '1.3.2': `# 每日学习 v1.3.2\n\n- 单词改用数量记录：每天新学默认 50 个，也可以统一修改。\n- 新学和复习分开记录；新学、复习都可以分几次累加。\n- 周复盘、月历、历史、小组件和 CSV/PDF 报表都会显示词数。\n- 内置周目标和课表提示已清空，每周目标由你自己填写。\n`,
  '1.3.3': `# 每日学习 v1.3.3\n\n- 单词新学和复习都可以撤销最近一次累加。\n- 每个单词科目都可以设置自己的快捷加数。\n- 修复表单草稿、单日目标日期和旧长文本恢复错误。\n- 修复历史、计时明细、报表、日签检索和小组件刷新问题。\n- PDF 中的中文可以复制和搜索，备份恢复失败时会保留原记录。\n`,
  '1.3.4': `# 每日学习 v1.3.4\n\n- 每天先复习当天课程，再安排考研高数。\n- 工作日总参考时间为 90 分钟：课多日课程 40 分钟、高数 50 分钟；课少日课程 30 分钟、高数 60 分钟。\n- 周六集中复习课程 60 分钟、高数 30 分钟；周日早上各 30 分钟，下午休息。\n- 计划页可以预览并应用课程优先的安排，单词继续按数量记录。\n`,
  '1.3.5': `# 每日学习 v1.3.5\n\n- 修复计划页完成记录后日期和参考时间挤在一起的问题。\n- 小屏幕、大字号和较长的科目名称都能完整显示。\n- 空白日期只显示一次“未记录”，页面更容易浏览。\n`,
  '1.4.0': `# 每日学习 v1.4.0\n\n- 周目标增加任务清单，可以添加、编辑、勾选、排序和撤销删除。\n- 今日页可以直接勾选任务，周复盘会列出已完成和未完成的任务。\n- 修改计划日期后，原来的周目标仍然可以查看，也可以确认移动到新的一周。\n- 清单支持草稿恢复、多计划分开保存、完整备份和 PDF 周报。\n- 修复关闭编辑窗口后旧内容再次写入草稿的问题。\n`,
  '1.4.1': `# 每日学习 v1.4.1\n\n- 每日参考时间改为可编辑区间：工作日 60—120 分钟，周六 240—360 分钟，周日 180—300 分钟。\n- 今日评估会根据当天记录和安排，显示完成、未完成或超额；单词新学单独评估，复习单独记录。\n- 补全 10 月 12—15 日的课程复习顺序和课程名称。\n- 在“计划 → 课程与区间安排”里可以先预览，再应用新的安排。\n`,
  '1.4.2': `# 每日学习 v1.4.2\n\n- 历史记录可以按时长和新学结果筛选，也能找到还没有记录的计划日期。\n- 可以查看当天评估使用的参考目标；修改目标时默认保留原来的评估依据，也可以确认重新评估。\n- 周复盘和月复盘分别显示时长与新学的完成情况，并提供每日结果和每周趋势。\n- CSV/PDF 报表补充评估依据、保留时间和新学目标。\n`,
  '1.5.0': `# 每日学习 v1.5.0\n\n- 新增课程表：可以编辑课程、节次、教学周和单双周。\n- 支持单次调课、停课和撤销调课，并能查看调整记录。\n- 今日增加逐门课程复习清单和复习笔记，周末可以汇总本周课程。\n- 复习清单可以关联周任务，支持手动保存、草稿恢复、历史查看和多计划分开保存。\n- 完整备份和 CSV/PDF 报表会收录课程复习记录。\n`,
  '1.5.1': `# 每日学习 v1.5.1\n\n- 设置页新增“使用手册”，没有网络也可以阅读。\n- 手册包含记录、计时、单词、周目标、课表、评估、复盘、计划、日签、提醒、备份和更新等章节。\n- 支持目录定位、章节展开和返回目录，适合小屏幕和大字号显示。\n`,
  '1.5.2': `# 每日学习 v1.5.2\n\n- 重新打开 App 时会自动检查更新，发现新版本后显示更新内容和下载入口。\n- 可以选择稍后更新；回到 App 时不会重复弹窗，页面顶部仍保留更新入口。\n- 安装前会处理未保存的输入和正在进行的计时。\n`,
  '1.5.3': `# 每日学习 v1.5.3\n\n- 修复已经设置参考时间却显示“未设置参考区间”的问题。\n- 每天的参考时间会按现有计划自动生成，也可以手动修改总时间和各科时间。\n- 修改目标后，今天的评估会使用新的目标，同时保留还没有保存的输入。\n- 修复零参考科目漏算时间，以及周末参考时间显示不正确的问题。\n`,
  '1.6.0': `# 每日学习 v1.6.0\n\n- 可以添加按数量记录的科目，单位可写“题”“页”“组”等。\n- 数量科目支持每周目标和按日期修改；分钟科目继续使用参考时间区间。\n- 数量和分钟分别评估，不会把题数或页数加进学习分钟。\n- 历史记录会保留当时使用的单位，修改单位不会改变旧记录。\n- 周复盘、月历、历史、小组件、CSV/PDF 报表和备份都支持数量科目。\n`,
  '1.6.1': `# 每日学习 v1.6.1\n\n- 单词可以分几次记录，每次保留数量、时间和来源。\n- 快捷累加、任意数量添加、修改和删除会先放在编辑中，保存当天记录后再提交。\n- 可以预览当天总数，删除后可以撤销。\n- 统计、评估、小组件、CSV/PDF 报表和完整备份都会保留分次明细。\n- 原有单词总数和旧备份继续可以使用。\n`,
  '1.6.2': `# 每日学习 v1.6.2\n\n- 修复旧版参考时间出现“30—30”“60—60”等重复上下限的问题。\n- 修复周末误用工作日时间的问题：周六为 240—360 分钟，周日为 180—300 分钟。\n- 今日页把记录、课程、周目标和评估分开显示，查找和填写更方便。\n- 参考时间支持修改总量和各科分量，固定目标仍显示为单个数值。\n- 计划、周复盘、设置和使用手册的操作入口重新整理。\n`,
  '1.6.3': `# 每日学习 v1.6.3\n\n- 修改数量科目的单位后，历史记录和旧目标仍使用原单位。\n- 周统计、月统计和历史记录按单位分别显示，支持按数量和单位搜索。\n- 数量草稿会保留单位；单位变化时可以选择继续使用草稿或当前记录。\n- CSV/PDF 报表分别显示数量、目标和单位。\n- 新建计划会正确带上数量目标，旧备份仍可导入。\n`,
  '1.6.4': `# 每日学习 v1.6.4\n\n- 今日页改为白底列表：各科的参考时间和实际记录一眼可见，点科目即可编辑。\n- 今日安排和随记分别进入编辑，页面会区分“待保存”和“已保存”。\n- 计划、复盘、日签、设置和弹窗统一了标题、分组和操作位置。\n- 设置页按学习、数据和应用分组，提醒、备份、小组件、手册和关于都能直接找到。\n- 优化窄屏、大字号和系统返回时的页面位置。\n`,
  '1.6.5': `# 每日学习 v1.6.5\n\n- 新增“总体任务分配”，可以一次修改未来每天的新学单词、参考时间和数量目标。\n- 支持设置生效日期、批量修改工作日，并选择是否覆盖某一天已经单独修改的目标。\n- 今日列表增加“记一笔”，编辑窗口可以直接保存；保存失败后可在原窗口重试。\n- 优化页面返回位置、窄屏、大字号和键盘弹出时的编辑体验。\n`,
  '1.6.6': `# 每日学习 v1.6.6\n\n- 从其他 App 回到每日学习时，会在合适的时间自动检查新版本。\n- 发现更新后在页面顶部显示入口，不会打断正在进行的计时或编辑。\n- 检查还没完成时会继续等待结果，回到页面后仍能看到结果。\n- 已发现或已下载的更新会保留，手动检查可以随时进行。\n`,
  '1.6.7': `# 每日学习 v1.6.7\n\n- 今日评估改为按当天的实际记录和计划目标自动判断，不用每天先选择“照常、减量、仅回顾或休息”。\n- 可以提前安排某天的学习、课程回顾或休息，评估会按当天安排计算。\n- 每天都可以查看评估使用的目标，以及实际记录和原计划的对照。\n- 周复盘和月复盘同时显示计划完成情况和记录完整情况。\n- 修复带单词分次记录时课程复习清单无法保存，以及恢复备份后历史筛选打不开的问题。\n`,
  '1.6.8': `# 每日学习 v1.6.8\n\n- 归档科目如果还有未完成的历史记录，仍然可以从历史页面补记。\n- 历史数量记录会使用当天的单位，已有数量和明确填入的 0 都会保留。\n- “继续记录”会直接定位到还没有填写的项目。\n- 查看评估依据时，可以看到目标被移除或单位改变后的对照。\n`,
  '1.7.0': `# 每日学习 v1.7.0\n\n- 保存记录时会检查当前内容，重复点击不会生成重复记录。\n- 如果页面里的计划已经被更新，App 会先提示重新打开，避免覆盖刚保存的新记录。\n- 课程安排、参考时间和每日评估的结果保持一致。\n`
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJsonPreservingEol(file, value, original) {
  const lf = String.fromCharCode(10);
  const crlf = String.fromCharCode(13, 10);
  const eol = original.includes(crlf) ? crlf : lf;
  fs.writeFileSync(file, JSON.stringify(value, null, 2).split(lf).join(eol) + eol, 'utf8');
}

for (const [version, text] of Object.entries(notes)) {
  const docPath = path.join(root, 'docs', `RELEASE-NOTES-v${version}.md`);
  const assetPath = path.join(root, 'release', `v${version}`, 'RELEASE-NOTES.md');
  const manifestPath = path.join(root, 'release', `v${version}`, 'update.json');
  fs.writeFileSync(docPath, text, 'utf8');
  fs.writeFileSync(assetPath, text, 'utf8');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const oldReleaseNotes = JSON.stringify(manifest.releaseNotes);
  const newReleaseNotes = JSON.stringify(text);
  if (!manifestText.includes(oldReleaseNotes)) throw new Error(`releaseNotes field missing: ${version}`);
  fs.writeFileSync(manifestPath, manifestText.replace(oldReleaseNotes, newReleaseNotes), 'utf8');

  const reportPath = path.join(root, 'docs', `validation-v${version}`, 'public-release-results.json');
  if (fs.existsSync(reportPath)) {
    const reportText = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(reportText);
    let changed = false;
    for (const item of report.assets || []) {
      if (item.name === 'RELEASE-NOTES.md' || item.name === 'update.json') {
        const file = path.join(root, 'release', `v${version}`, item.name);
        const bytes = fs.statSync(file).size;
        const digest = sha256(file);
        if (item.bytes !== bytes) { item.bytes = bytes; changed = true; }
        if ('sha256' in item && item.sha256 !== digest) { item.sha256 = digest; changed = true; }
        if ('digest' in item && item.digest !== `sha256:${digest}`) { item.digest = `sha256:${digest}`; changed = true; }
      }
    }
    if ('manifestSha256' in report) {
      const digest = sha256(manifestPath);
      if (report.manifestSha256 !== digest) { report.manifestSha256 = digest; changed = true; }
    }
    if (changed) writeJsonPreservingEol(reportPath, report, reportText);
  }
}

console.log(`Rewrote ${Object.keys(notes).length} user-facing release notes.`);
