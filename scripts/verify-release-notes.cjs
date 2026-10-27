'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repository = 'gaspainting/daily-study';
const api = endpoint => JSON.parse(cp.execFileSync('gh', ['api', endpoint], { cwd: root, encoding: 'utf8' }));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const readUtf8 = file => fs.readFileSync(file, 'utf8');
const versions = fs.readdirSync(path.join(root, 'docs'))
  .filter(name => /^RELEASE-NOTES-v\d+\.\d+\.\d+\.md$/.test(name))
  .map(name => name.slice('RELEASE-NOTES-v'.length, -3))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

async function main() {
  const releases = api(`repos/${repository}/releases?per_page=100`);
  const byTag = new Map(releases.map(item => [item.tag_name, item]));
  const results = [];
  for (const version of versions) {
    const tag = `v${version}`;
    const release = byTag.get(tag);
    if (!release || release.draft || release.prerelease) throw new Error(`Missing stable release: ${tag}`);
    const note = readUtf8(path.join(root, 'docs', `RELEASE-NOTES-v${version}.md`));
    const manifestPath = path.join(root, 'release', tag, 'update.json');
    const manifest = JSON.parse(readUtf8(manifestPath));
    if (release.body !== note || manifest.releaseNotes !== note) throw new Error(`Local note mismatch: ${tag}`);
    const reportPath = path.join(root, 'docs', `validation-v${version}`, 'public-release-results.json');
    if (fs.existsSync(reportPath) && Array.isArray(JSON.parse(readUtf8(reportPath)).assets)) {
      const report = JSON.parse(readUtf8(reportPath));
      for (const name of ['RELEASE-NOTES.md', 'update.json']) {
        const file = path.join(root, 'release', tag, name);
        const item = (report.assets || []).find(asset => asset.name === name);
        const hash = digest(fs.readFileSync(file));
        const reportHash = item?.sha256 || item?.digest?.replace(/^sha256:/, '');
        if (!item || item.bytes !== fs.statSync(file).size || reportHash !== hash) throw new Error(`Local release report differs: ${tag}/${name}`);
      }
    }
    const assetNames = release.assets.map(asset => asset.name).sort();
    if (assetNames.length !== 3 || assetNames.join('|') !== 'RELEASE-NOTES.md|daily-study-v' + version + '.apk|update.json') {
      throw new Error(`Unexpected release assets: ${tag}`);
    }
    for (const name of ['RELEASE-NOTES.md', 'update.json']) {
      if (release.assets.filter(asset => asset.name === name).length !== 1) throw new Error(`Release asset missing: ${tag}/${name}`);
      const response = await fetch(`https://github.com/${repository}/releases/download/${tag}/${name}`);
      if (!response.ok) throw new Error(`Download failed: ${tag}/${name} (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const expected = name === 'RELEASE-NOTES.md' ? note : readUtf8(manifestPath);
      if (bytes.toString('utf8') !== expected) throw new Error(`Public asset differs: ${tag}/${name}`);
      const remote = release.assets.find(asset => asset.name === name);
      if (remote.size !== bytes.length || remote.digest !== `sha256:${digest(bytes)}`) throw new Error(`Public digest differs: ${tag}/${name}`);
    }
    results.push({ tag, noteBytes: Buffer.byteLength(note, 'utf8') });
  }
  console.log(JSON.stringify({ verified: results.length, releases: results }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
