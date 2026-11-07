#!/usr/bin/env python3
"""
Build every app icon from one source image (needs Pillow: pip install pillow).

    python3 scripts/make_icons.py build/icon-source.png

Writes
  build/icon.ico            Windows: exe, installer, portable launcher
  build/icon.png            1024 px, used for macOS (.icns) and Linux packages
  resources/icons/icon.ico  Windows window/taskbar/tray icon at runtime
  resources/icons/icon-N.png  PNG sizes for the window, tray and Linux

The .ico follows Windows' own icon guidelines: every size up to 128 px is a
classic 32-bit bitmap (BGRA + AND mask) and only 256 px is PNG-compressed.
Explorer's small views (List, Details, Small icons) read the 16/20/24 px
images through code paths that don't reliably decode PNG entries, so an
all-PNG icon (Pillow's default) shows up blank or generic there.
The 20 and 40 px sizes cover 125% and 250% display scaling.
"""
import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ROOT = Path(__file__).resolve().parent.parent


def square_canvas(src: Image.Image) -> Image.Image:
    """Trim transparent edges, then centre the artwork on a square with a small margin."""
    src = src.convert("RGBA")
    bbox = src.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox() or (0, 0, *src.size)
    art = src.crop(bbox)
    side = max(art.size)
    margin = round(side * 0.04)
    canvas = Image.new("RGBA", (side + 2 * margin, side + 2 * margin), (0, 0, 0, 0))
    canvas.paste(art, ((canvas.width - art.width) // 2, (canvas.height - art.height) // 2), art)
    return canvas


def render(canvas: Image.Image, size: int) -> Image.Image:
    im = canvas.resize((size, size), Image.LANCZOS)
    if size <= 48:  # keep fine detail readable at taskbar / Explorer sizes
        im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=1))
    return im


def bmp_entry(im: Image.Image) -> bytes:
    """32-bit DIB as stored in .ico: BITMAPINFOHEADER (double height), bottom-up BGRA, 1-bit AND mask."""
    w, h = im.size
    px = im.convert("RGBA").load()
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
    row_bytes = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(row_bytes)
        for x in range(w):
            if px[x, y][3] == 0:  # fully transparent -> mask bit set
                row[x // 8] |= 0x80 >> (x % 8)
        mask += row
    return header + bytes(xor) + bytes(mask)


def png_entry(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, images: list) -> None:
    entries = [(im.size[0], png_entry(im) if im.size[0] >= 256 else bmp_entry(im)) for im in images]
    out = bytearray(struct.pack("<HHH", 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    for size, data in entries:
        dim = 0 if size >= 256 else size  # 0 means 256 in the directory
        out += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in entries:
        out += data
    path.write_bytes(bytes(out))


def main() -> None:
    src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "icon-source.png"
    canvas = square_canvas(Image.open(src_path))
    icons = ROOT / "resources" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    for s in PNG_SIZES:
        render(canvas, s).save(icons / f"icon-{s}.png", optimize=True)
    render(canvas, 1024).save(ROOT / "build" / "icon.png", optimize=True)
    ico_images = [render(canvas, s) for s in ICO_SIZES]
    write_ico(ROOT / "build" / "icon.ico", ico_images)
    write_ico(icons / "icon.ico", ico_images)
    print(f"icons written from {src_path.name}: ico {ICO_SIZES}, png {PNG_SIZES}")


if __name__ == "__main__":
    main()
