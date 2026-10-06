#!/usr/bin/env python3
"""Render preview.png and preview-turtle.gif from the shipped sprite sheets.

Everything drawn here comes from the shipped spritesheets and is composited the
same way the plugin composites it at runtime: the fill sheet tinted with the
bar's text colour, the ink sheet painted over it in the bar's background
colour. Nothing is redrawn or touched up, so what the card shows is what the
plugin actually puts on your bar.

The sprites are drawn at several multiples of their real size because a 16px
cat is illegible on a marketplace card. The strip along the top is rendered at
true scale to keep that honest.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
OUT = REPO / "preview.png"

# Omarchy's default dark bar, so the card reads the same for everyone rather
# than depending on whatever theme happened to be active when it was made.
BG = (16, 19, 21)
BAR = (24, 28, 31)
TEXT = (202, 204, 204)
MUTED = (112, 120, 128)

W, H = 1200, 630
CELL = 32

FONT_DIR = Path("/usr/share/fonts/TTF")
FONT_CANDIDATES = [
    "CaskaydiaMonoNerdFont-Regular.ttf",
    "CaskaydiaMonoNerdFont-SemiLight.ttf",
    "CaskaydiaMonoNerdFont-ExtraLight.ttf",
]


def font(size):
    for name in FONT_CANDIDATES:
        path = FONT_DIR / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def frames(character):
    """Load the 32px fill and ink sheets for a character."""
    fill = Image.open(ASSETS / f"{character}32-fill.png").convert("RGBA")
    ink = Image.open(ASSETS / f"{character}32-ink.png").convert("RGBA")
    return fill, ink


def sprite(character, index, scale, fill_rgb, ink_rgb):
    """Composite one frame exactly as CatSprite.qml does, at `scale`x."""
    fill, ink = frames(character)
    box = (index * CELL, 0, (index + 1) * CELL, CELL)
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    for sheet, rgb in ((fill, fill_rgb), (ink, ink_rgb)):
        layer = Image.new("RGBA", (CELL, CELL), rgb + (0,))
        layer.putalpha(sheet.crop(box).getchannel("A"))
        out.alpha_composite(layer)
    return out.resize((CELL * scale, CELL * scale), Image.NEAREST)


# Frame indices, matching Frames.js / the FRAMES list in build-sprites.py.
INDEX = {
    "mati2": 0, "jare2": 1, "kaki1": 2, "mati3": 4, "sleep1": 5,
    "left1": 12, "right1": 14, "right2": 15, "dwright1": 22, "upright1": 18,
}


def main():
    if not (ASSETS / "neko32-fill.png").exists():
        sys.exit("run tools/build-sprites.py first")

    card = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(card)

    title = font(46)
    body = font(21)
    label = font(19)

    draw.text((60, 48), "Navbar Cat", font=title, fill=TEXT)
    draw.text((60, 108), "a cat that walks along your Omarchy bar",
              font=body, fill=MUTED)

    # A true-scale bar strip: this is the size the cat actually is.
    bar_y, bar_h = 170, 42
    draw.rectangle([0, bar_y, W, bar_y + bar_h], fill=BAR)
    for x, idx in ((300, 14), (520, 15), (760, 0), (980, 5)):
        card.paste(sprite("neko", idx, 1, TEXT, BAR), (x, bar_y + 13),
                   sprite("neko", idx, 1, TEXT, BAR))
    draw.text((60, bar_y + 13), "actual size", font=label, fill=MUTED)

    # Poses, big enough to see.
    poses = [("right1", "walks"), ("mati2", "sits"), ("jare2", "washes"),
             ("kaki1", "scratches"), ("sleep1", "sleeps"), ("upright1", "pounces")]
    y = 290
    for i, (frame, name) in enumerate(poses):
        x = 60 + i * 185
        card.paste(sprite("neko", INDEX[frame], 3, TEXT, BAR), (x, y),
                   sprite("neko", INDEX[frame], 3, TEXT, BAR))
        draw.text((x, y + 108), name, font=label, fill=MUTED)

    # The four characters.
    y = 452
    draw.text((60, y), "four characters", font=label, fill=MUTED)
    for i, character in enumerate(("neko", "tora", "dog", "turtle")):
        x = 60 + i * 145
        card.paste(sprite(character, INDEX["right1"], 3, TEXT, BAR), (x, y + 34),
                   sprite(character, INDEX["right1"], 3, TEXT, BAR))
        draw.text((x, y + 142), character, font=label, fill=MUTED)

    draw.text((640, y + 60), "takes your theme's colours", font=body, fill=MUTED)
    draw.text((640, y + 96), "chases and is pettable", font=body, fill=MUTED)
    draw.text((640, y + 132), "oneko sprites + an original turtle", font=body, fill=MUTED)

    card.save(OUT)
    print(f"wrote {OUT.relative_to(REPO)} ({card.width}x{card.height})")
    turtle_preview()


def turtle_preview():
    """Enlarged art preview: slow steps, a 2.4s hide, then emerging."""
    images = []
    for tick in range(80):
        tucked = 40 <= tick < 64
        walking = tick < 40
        frame = Image.new("RGB", (640, 240), BG)
        draw = ImageDraw.Draw(frame)
        draw.text((28, 20), "turtle", font=font(25), fill=TEXT)
        caption = "slow steps" if walking else "hiding in his shell" if tucked else "hello again"
        draw.text((28, 59), caption, font=font(18), fill=MUTED)
        draw.rectangle((0, 113, 640, 218), fill=BAR)
        index = 0 if tucked or not walking else INDEX["right1"] + (tick // 10) % 2
        art = sprite("turtle-shell" if tucked else "turtle", index, 3, TEXT, BAR)
        x = 200 + min(tick, 40) * 2
        frame.paste(art, (x, 119), art)
        images.append(frame)
    target = REPO / "preview-turtle.gif"
    images[0].save(target, save_all=True, append_images=images[1:],
                   duration=100, loop=0, optimize=False, disposal=2)
    print(f"wrote {target.relative_to(REPO)} (enlarged sprite preview)")


if __name__ == "__main__":
    main()
