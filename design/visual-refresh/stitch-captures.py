"""Join unchanged browser screenshot strips into full iframe captures.

Input PNGs and their DOM rectangles are saved through cua_repl.
No interface content is redrawn. The comparison adds only margins and labels.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
RAW = ROOT.parents[1] / "tmp" / "visual-refresh-captures"
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)


def join(screen):
    captures = []
    for part in ("top", "bottom"):
        data = json.loads((RAW / f"{screen}-{part}.json").read_text(encoding="utf-8"))
        source = Image.open(RAW / f"{screen}-{part}.png").convert("RGB")
        sx = source.width / data["viewport"]["width"]
        sy = source.height / data["viewport"]["height"]
        assert abs(sx - sy) < .005, "Screenshot scale is inconsistent"
        captures.append((data, source, sx, sy))
    results = []
    for index, theme in enumerate(("system", "linear")):
        box = captures[0][0]["frames"][index]
        width, height = round(box["width"] * captures[0][2]), round(box["height"] * captures[0][3])
        image = Image.new("RGB", (width, height))
        coverage = [False] * height
        for data, source, sx, sy in captures:
            b = data["frames"][index]
            assert round(b["width"] * sx) == width and round(b["height"] * sy) == height
            x, y = round(b["x"] * sx), round(b["y"] * sy)
            top, bottom = max(0, y), min(source.height, y + height)
            if bottom <= top:
                continue
            target_y = top - y
            image.paste(source.crop((x, top, x + width, bottom)), (0, target_y))
            coverage[target_y:target_y + bottom - top] = [True] * (bottom - top)
        assert all(coverage), f"Missing screenshot rows: {screen}/{theme}"
        image.save(OUT / f"{screen}-{theme}.png")
        results.append(image)
    gap, margin, header = 36, 28, 60
    board = Image.new("RGB", (2 * results[0].width + 2 * margin + gap, results[0].height + header + margin), "#ededee")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
    for i, image in enumerate(results):
        x = margin + i * (image.width + gap)
        label = "A · 清晰的系统感" if i == 0 else "B · 紧凑的工作台"
        draw.text((x, 20), label, font=font, fill="#25262b")
        board.paste(image, (x, header))
    board.save(OUT / f"{screen}-comparison.png")
    print(f"{screen}: two complete {results[0].width}x{results[0].height} browser captures")


if __name__ == "__main__":
    import sys
    for screen in sys.argv[1:] or ("today", "plan", "review", "settings"):
        join(screen)
