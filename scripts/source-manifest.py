"""Inventory public project files and verify their exact bytes, excluding local keys/builds."""
from pathlib import Path
from datetime import date
import argparse, hashlib, json, re, xml.etree.ElementTree as ET

root=Path(__file__).resolve().parent.parent
output=root/'docs/github-source-manifest.json'
secret=re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--verify',action='store_true')
args=parser.parse_args()
files=[]
for directory in ('app','scripts','tests','docs','design'):
    files.extend(p for p in (root/directory).rglob('*') if p.is_file() and p!=output and '__pycache__' not in p.parts and p.suffix.lower() not in ('.pyc','.pyo'))
files.extend(root/name for name in ('.gitignore','.gitattributes','README.md','build.ps1','generate_seed.py'))
for directory in (root/'release').iterdir():
    if directory.is_dir() and '-pre-install-guard' not in directory.name:
        files.extend(directory/name for name in ('update.json','RELEASE-NOTES.md'))
entries=[]
for file in sorted(files):
    assert file.resolve().is_relative_to(root.resolve()),str(file)
    relative=file.relative_to(root).as_posix()
    assert not any(p in ('.signing','.git','.env','node_modules') for p in file.relative_to(root).parts),relative
    assert file.suffix.lower() not in ('.p12','.jks','.keystore','.pem','.key'),relative
    data=file.read_bytes();assert not secret.search(data),relative
    entries.append({'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
ns='{http://schemas.android.com/apk/res/android}'
manifest=ET.parse(root/'app/src/main/AndroidManifest.xml').getroot()
value={'date':date.today().isoformat(),'repository':'gaspainting/daily-study','version':manifest.attrib[ns+'versionName'],'versionCode':int(manifest.attrib[ns+'versionCode']),'files':entries,'excluded':['.signing/','build/','tmp/','dist/','private signing files','release APK copies; GitHub Releases provide them'],'archiveBranch':'source-archive'}
if args.verify:
    stored=json.loads(output.read_text('utf8'))
    assert stored['files']==entries,'Source file set or bytes differ from the inventory'
    assert stored['version']==value['version'] and stored['versionCode']==value['versionCode']
else:
    output.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'verified':args.verify,'files':len(entries)+1,'version':value['version'],'versionCode':value['versionCode'],'bytes':sum(x['bytes'] for x in entries)},ensure_ascii=False))
