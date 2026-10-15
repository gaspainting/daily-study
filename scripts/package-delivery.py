"""Package local delivery materials; this tool never uploads them."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
ns = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(root / 'app/src/main/AndroidManifest.xml').getroot()
version, code = manifest.attrib[ns+'versionName'], int(manifest.attrib[ns+'versionCode'])
label = manifest.find('application').attrib[ns+'label']
apk = root / 'dist' / f'{label}-v{version}.apk'
release = json.loads((root / 'release' / f'v{version}' / 'update.json').read_text('utf-8'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert release['versionName'] == version and release['versionCode'] == code
assert release['apkSha256'] == sha(apk) and release['apkBytes'] == apk.stat().st_size
out = root.parent / 'output/android'
out.mkdir(parents=True, exist_ok=True)
dest = out / apk.name
shutil.copy2(apk, dest)
dest.with_suffix('.apk.sha256').write_text(f'{sha(dest)}  {dest.name}\n', encoding='utf-8')
materials = out / f'{label}-v{version}_资料'
materials.mkdir(exist_ok=True)
documents = [f'V{version}.md', 'APP-UPDATES.md', 'NEXT-DEVELOPMENT.md', '使用说明.md', 'ux-copy-audit.md']
documents += [name for name in [f'CODE-REVIEW-v{version}.md', f'课程优先安排-v{version}.md', 'THIRD-PARTY-NOTICES.md'] if (root / 'docs' / name).is_file()]
guide = (root / 'docs/使用说明.md').read_text('utf-8')
for name in re.findall(r'\]\(([^/\\:#()]+\.md)\)', guide):
    linked = root / 'docs' / name
    if name not in documents and linked.is_file() and linked.resolve().is_relative_to((root / 'docs').resolve()):
        documents.append(name)
for name in documents:
    shutil.copy2(root / 'docs' / name, materials / name)
shutil.copytree(root / 'docs' / f'validation-v{version}', materials / f'validation-v{version}', dirs_exist_ok=True)
shutil.copytree(root / 'docs/screenshots' / f'v{version}', materials / 'screenshots' / f'v{version}', dirs_exist_ok=True)
for name in documents:
    guide = guide.replace(f'({name})', f'({materials.name}/{name})')
for name in [f'{label}-v{version}_使用说明.md', f'{label}_使用说明.md']:
    (out / name).write_text(guide, encoding='utf-8')
source = out / f'{label}-v{version}-源码.zip'
excluded = {'.signing', '.git', 'dist', 'build', 'tmp', 'release'}
with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if not file.is_file() or relative.parts[0] in excluded or file.suffix.lower() in {'.p12', '.jks', '.keystore', '.pem'}:
            continue
        archive.write(file, f'{label}-v{version}/' + relative.as_posix())
with zipfile.ZipFile(source) as archive:
    assert all('.signing/' not in name and not name.endswith(('.p12', '.jks', '.keystore', '.pem')) for name in archive.namelist())
evidence = out / f'{label}-v{version}-验证资料.zip'
with zipfile.ZipFile(evidence, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(materials.rglob('*')):
        if file.is_file(): archive.write(file, materials.name + '/' + file.relative_to(materials).as_posix())
result = {'version': version, 'versionCode': code, 'apkBytes': dest.stat().st_size, 'apkSha256': sha(dest), 'localOnly': [source.name, evidence.name], 'publicRelease': release['apkUrl']}
(out / f'{label}-v{version}-交付核对.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
