"""Prepare the bundled PDF font from pinned Noto Sans SC; requires fontTools 4.66.1.

UI typography uses the device font. This asset is only used for exported PDF text.
"""
from pathlib import Path
import hashlib,json,sys,unicodedata,copy
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source=Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest()=='a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da', 'Unexpected font source'

root=Path(__file__).resolve().parent.parent
out=root/'app/src/main/assets'
out.mkdir(parents=True,exist_ok=True)
font=instantiateVariableFont(TTFont(source),{'wght':400},inplace=True)
# PDF reverse maps glyph IDs. Distinct Unicode aliases need distinct IDs,
# including CJK radicals whose Unicode normalization leaves them unchanged.
cmap=font.getBestCmap();groups={};replacements={};order=list(font.getGlyphOrder())
for cp,glyph in cmap.items():groups.setdefault(glyph,[]).append(cp)
for glyph,points in groups.items():
    if len(points)<2:continue
    points.sort(key=lambda cp:(not unicodedata.name(chr(cp),'').startswith('CJK UNIFIED IDEOGRAPH'),unicodedata.normalize('NFKC',chr(cp))!=chr(cp),cp))
    for cp in points[1:]:
        name=f'report.u{cp:06X}';assert name not in font['glyf']
        font['glyf'][name]=copy.deepcopy(font['glyf'][glyph]);font['hmtx'][name]=font['hmtx'][glyph]
        if 'vmtx' in font:font['vmtx'][name]=font['vmtx'][glyph]
        order.append(name);replacements[cp]=name
font.setGlyphOrder(order)
font['glyf'].setGlyphOrder(order)
for table in font['cmap'].tables:
    if table.isUnicode() and table.format!=14:
        for cp in list(table.cmap):
            if cp in replacements:table.cmap[cp]=replacements[cp]
assert len(set(font.getBestCmap().values()))==len(font.getBestCmap())
names={1:'Daily Study Report',2:'Regular',3:'DailyStudyReport-Regular-v1',4:'Daily Study Report Regular',6:'DailyStudyReport-Regular',16:'Daily Study Report',17:'Regular'}
for record in font['name'].names:
    if record.nameID in names:record.string=names[record.nameID].encode(record.getEncoding())
font.recalcTimestamp=False
path=out/'report-font.ttf'
font.save(path)
license=(source.parent/'OFL.txt').read_bytes()
(out/'report-font-OFL.txt').write_bytes(license)
revision=(source.parent/'revision.txt').read_text('ascii').strip()
data={'source':'https://github.com/google/fonts/blob/'+revision+'/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf','revision':revision,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'modifiedFontSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'modifiedFontBytes':path.stat().st_size,'weight':400,'clonedUnicodeAliases':len(replacements),'uniqueUnicodeGlyphMapping':True,'family':'Daily Study Report','license':'SIL OFL 1.1','fontTools':'4.66.1'}
(root/'docs/validation-v1.3.3/report-font-provenance.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps(data,ensure_ascii=False))
