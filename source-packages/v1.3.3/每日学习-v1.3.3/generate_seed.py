"""Extract the handover's actual 70 reference rows, never create completion data."""
import json
import re
from pathlib import Path
from datetime import date, timedelta

root = Path(__file__).resolve().parent
source = root.parent / "output/每日打卡表_独立会话交接说明.md"
text = source.read_text(encoding="utf-8-sig")
rows = re.findall(r"\| (2026-\d{2}-\d{2}) \| 周[一二三四五六日] \| (\d+) \| (\d+) \| (\d+) \|", text)
assert len(rows) == 70 and len({r[0] for r in rows}) == 70
targets = {}
for i, (day, math, vocab, total) in enumerate(rows):
    assert date.fromisoformat(day) == date(2026, 10, 12) + timedelta(days=i)
    assert int(math) + int(vocab) == int(total)
    targets[day] = {"math": int(math), "vocab": int(vocab)}
expected = [(340, 140)]*2 + [(390, 155)]*2 + [(430, 175)]*3 + [(465, 175)]*3
for i, pair in enumerate(expected):
    subset = list(targets.values())[7*i:7*i+7]
    assert tuple(sum(d[s] for d in subset) for s in ("math", "vocab")) == pair
state = {
    "version": 1, "_revision": 0,
    "plan": {"title": "高数与单词 · 低强度计划", "startDate": "2026-10-12", "endDate": "2026-12-20", "startWeek": 7,
        "subjects": [
            {"id": "math", "name": "高数", "kind": "math", "defaults": [40,25,60,25,40,90,60]},
            {"id": "vocab", "name": "单词", "kind": "vocab", "defaults": [20,20,20,20,20,20,20]}
        ], "targets": targets, "weekGoals": {}, "weekHints": {}},
    "records": {}, "reviews": {}, "sessions": [],
    "settings": {"reminders": {"enabled": False, "weekdayTime": "19:15", "weekendTime": "10:00"}}
}
out = root / "app/src/main/assets/seed.json"
out.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Verified {len(rows)} dates and 10 weekly totals; seed has zero actual records: {out}")
