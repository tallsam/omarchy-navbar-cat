#!/usr/bin/env python3
"""Turn oneko's XBM bitmap/mask pairs into the spritesheets the plugin ships.

oneko encodes each frame as two 32x32 bitmaps: an image and a mask. Inside the
mask, a set image bit is ink (the outline and facial detail, drawn black in the
original) and a clear bit is fill (the cat's body, drawn white). We keep that
two-tone structure so the cat can be themed at runtime rather than baked to
fixed colours.

Output is two alpha-only sheets per size:

  *-fill.png   alpha = the whole silhouette (mask)
  *-ink.png    alpha = the detail only (image AND mask)

The fill sheet carries the *entire* silhouette rather than just the non-ink
pixels, and the ink sheet is painted over it. Splitting them into disjoint
regions instead would leave hairline seams between the two layers wherever the
compositor scales the sprite by a non-integer factor.

Sheets are emitted at 32px (native) and 16px (reduced). The 16px reduction maps
each 2x2 block with an "ink if any, mask if any" rule. A majority rule was
tried first and rejected: oneko's outlines are 1px, so majority voting breaks
them into dashes and the cat stops reading as a cat at a glance.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image
from turtle_sprites import turtle_frame

REPO = Path(__file__).resolve().parent.parent
VENDOR = REPO / "vendor" / "oneko"
ASSETS = REPO / "assets"

SIZE = 32

# The characters we ship, and where each one's pixels come from.
#
# `suffix` is oneko's own file-naming (`mati2_tora.xbm`). `masks` names the set
# to take masks from: tora ships 32 bitmaps and no masks at all, because oneko
# reuses the neko masks for it (oneko.c:157 passes mati2_mask_bits for both the
# neko and tora columns). We do the same rather than inventing silhouettes.
#
# Only these three are shipped. oneko's tarball also carries `bsd`, `sakura`,
# and `tomoyo`, whose rights are reserved — see vendor/oneko/PROVENANCE.md.
CHARACTERS = {
    "neko": {"suffix": "", "masks": "neko", "mask_suffix": ""},
    "tora": {"suffix": "_tora", "masks": "neko", "mask_suffix": ""},
    "dog": {"suffix": "_dog", "masks": "dog", "mask_suffix": "_dog"},
}

# Every frame in the neko set, in sheet order. The index of a name here is its
# frame index in the generated sheets.
FRAMES = [
    "mati2", "jare2", "kaki1", "kaki2", "mati3", "sleep1", "sleep2", "awake",
    "up1", "up2", "down1", "down2", "left1", "left2", "right1", "right2",
    "upleft1", "upleft2", "upright1", "upright2",
    "dwleft1", "dwleft2", "dwright1", "dwright2",
    "utogi1", "utogi2", "dtogi1", "dtogi2", "ltogi1", "ltogi2", "rtogi1", "rtogi2",
]

# State -> the two frames it alternates between, transcribed from oneko.c's
# AnimationPattern table (oneko.c:229). Names match oneko's own states so the
# behaviour stays recognisable to anyone who knows the original.
POSES = {
    "stop":    ["mati2", "mati2"],      # sitting still
    "wash":    ["jare2", "mati2"],      # washing its face
    "scratch": ["kaki1", "kaki2"],      # scratching its head
    "yawn":    ["mati3", "mati3"],      # yawning
    "sleep":   ["sleep1", "sleep2"],    # asleep (ticks 4x slower)
    "awake":   ["awake", "awake"],      # just woken, about to move
    "up":      ["up1", "up2"],
    "down":    ["down1", "down2"],
    "left":    ["left1", "left2"],
    "right":   ["right1", "right2"],
    "upleft":  ["upleft1", "upleft2"],
    "upright": ["upright1", "upright2"],
    "dwleft":  ["dwleft1", "dwleft2"],
    "dwright": ["dwright1", "dwright2"],
    "utogi":   ["utogi1", "utogi2"],    # clawing the top edge
    "dtogi":   ["dtogi1", "dtogi2"],    # clawing the bottom edge
    "ltogi":   ["ltogi1", "ltogi2"],    # clawing the left edge
    "rtogi":   ["rtogi1", "rtogi2"],    # clawing the right edge
}


def read_xbm(path):
    """Parse an XBM into a list of rows of 0/1. XBM packs bits LSB-first."""
    text = path.read_text()
    width = int(re.search(r"_width (\d+)", text).group(1))
    height = int(re.search(r"_height (\d+)", text).group(1))
    data = [int(b, 16) for b in re.findall(r"0x([0-9a-fA-F]{2})", text)]
    stride = (width + 7) // 8
    return [
        [(data[y * stride + (x >> 3)] >> (x & 7)) & 1 for x in range(width)]
        for y in range(height)
    ]


def load_frame(character, name):
    """Return (mask, ink) grids for one frame of one character."""
    spec = CHARACTERS[character]
    image = read_xbm(VENDOR / "bitmaps" / character / f"{name}{spec['suffix']}.xbm")
    mask = read_xbm(
        VENDOR / "bitmasks" / spec["masks"] / f"{name}{spec['mask_suffix']}_mask.xbm"
    )
    # Ink only counts where the mask lets it show; oneko clips the image by the
    # mask when it blits, and some frames have stray image bits outside it.
    ink = [[image[y][x] & mask[y][x] for x in range(SIZE)] for y in range(SIZE)]
    return mask, ink


def halve(grid):
    """Reduce 32x32 -> 16x16, setting a cell if any of its 2x2 source bits are."""
    return [
        [
            1 if any(grid[y + dy][x + dx] for dy in (0, 1) for dx in (0, 1)) else 0
            for x in range(0, SIZE, 2)
        ]
        for y in range(0, SIZE, 2)
    ]


def write_sheet(path, grids, cell):
    """Write an alpha-only sheet: white pixels, alpha from the grid."""
    sheet = Image.new("RGBA", (cell * len(grids), cell), (255, 255, 255, 0))
    pixels = sheet.load()
    for index, grid in enumerate(grids):
        for y in range(cell):
            for x in range(cell):
                if grid[y][x]:
                    pixels[index * cell + x, y] = (255, 255, 255, 255)
    sheet.save(path)
    return path


def main():
    ASSETS.mkdir(exist_ok=True)
    written = []

    for character, spec in CHARACTERS.items():
        missing = [
            n for n in FRAMES
            if not (VENDOR / "bitmaps" / character / f"{n}{spec['suffix']}.xbm").exists()
        ]
        if missing:
            sys.exit(f"{character}: missing vendored frames: {', '.join(missing)}")

        loaded = [load_frame(character, name) for name in FRAMES]
        written += [
            write_sheet(ASSETS / f"{character}32-fill.png", [m for m, _ in loaded], 32),
            write_sheet(ASSETS / f"{character}32-ink.png", [i for _, i in loaded], 32),
            write_sheet(ASSETS / f"{character}16-fill.png", [halve(m) for m, _ in loaded], 16),
            write_sheet(ASSETS / f"{character}16-ink.png", [halve(i) for _, i in loaded], 16),
        ]

    # Original artwork: draw both sizes directly so the small turtle remains
    # legible and never depends on files in the vendored oneko source.
    for size in (16, 32):
        loaded = [turtle_frame(name, size) for name in FRAMES]
        written += [
            write_sheet(ASSETS / f"turtle{size}-fill.png", [m for m, _ in loaded], size),
            write_sheet(ASSETS / f"turtle{size}-ink.png", [i for _, i in loaded], size),
        ]
        mask, ink = turtle_frame("shell", size)
        written += [
            write_sheet(ASSETS / f"turtle-shell{size}-fill.png", [mask], size),
            write_sheet(ASSETS / f"turtle-shell{size}-ink.png", [ink], size),
        ]

    # The frame/pose tables are generated rather than hand-maintained so the
    # sheet and the QML can never disagree about what frame 17 is.
    table = {
        "cell": SIZE,
        "count": len(FRAMES),
        "index": {name: i for i, name in enumerate(FRAMES)},
        "characters": sorted([*CHARACTERS, "turtle"]),
        "poses": {
            pose: [FRAMES.index(a), FRAMES.index(b)] for pose, (a, b) in POSES.items()
        },
    }
    frames_js = REPO / "Frames.js"
    frames_js.write_text(
        "// GENERATED by tools/build-sprites.py -- do not edit by hand.\n"
        ".pragma library\n\n"
        f"var CELL = {SIZE}\n"
        f"var COUNT = {len(FRAMES)}\n"
        f"var INDEX = {json.dumps(table['index'], indent=2)}\n\n"
        f"var CHARACTERS = {json.dumps(table['characters'])}\n\n"
        f"var POSES = {json.dumps(table['poses'], indent=2)}\n"
    )

    for path in written:
        print(f"wrote {path.relative_to(REPO)} ({path.stat().st_size} bytes)")
    print(f"wrote {frames_js.relative_to(REPO)} ({len(FRAMES)} frames, {len(POSES)} poses)")


if __name__ == "__main__":
    main()
