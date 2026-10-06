"""Original turtle pixel art, authored for this plugin under its MIT license.

The 16px design uses a domed, tiled shell, a blunt head and short feet. Larger
sprites keep the same pixel grid. Each frame yields the same silhouette/ink
pair as the oneko artwork, so colours follow the current Omarchy theme.
"""

from PIL import Image, ImageDraw, ImageChops


def turtle_frame(name, size):
    # Palette values: 0 transparent, 1 theme fill, 2 theme ink.
    art = Image.new("L", (16, 16), 0)
    draw = ImageDraw.Draw(art)
    step = name.endswith("2")
    asleep = name.startswith("sleep")
    tucked = name == "shell"
    yawn = name == "mati3"
    perk = name == "awake"
    stretch = name.startswith(("utogi", "dtogi", "ltogi", "rtogi"))
    walking = name.startswith(("up", "down", "left", "right", "dw")) or stretch

    def shape(points):
        draw.polygon(points, fill=1)

    # Tail and legs sit behind the shell. Sleep retracts them under its rim.
    if not asleep and not tucked:
        draw.line([(0, 10), (3, 9)], fill=1, width=2)
        stride = 1 if step and walking else 0
        for x, offset in ((3, stride), (9, -stride)):
            draw.rectangle((x + offset, 10, x + offset + 2, 13), fill=1)

    # A long neck and round, earless head make the silhouette read as a turtle.
    head_y = 6 if perk or name.startswith("up") else 8
    if name.startswith("dw"):
        head_y = 9
    if name == "jare2":
        head_y -= 1
    if tucked:
        pass
    elif asleep:
        draw.rectangle((11, 9, 13, 11), fill=1)
        draw.line((12, 10, 13, 10), fill=2)
    else:
        draw.rectangle((10, head_y + 1, 13, 11), fill=1)
        shape([(12, head_y), (14, head_y), (15, head_y + 1),
               (15, head_y + 3), (14, head_y + 4), (12, head_y + 4),
               (11, head_y + 3), (11, head_y + 1)])
        draw.point((14, head_y + 1), fill=2)
        if yawn:
            draw.rectangle((13, head_y + 3, 14, head_y + 4), fill=2)
        else:
            draw.point((15, head_y + 3), fill=2)

    # Broad domed carapace with a clear hexagonal centre plate and lower rim.
    top = 4 if asleep and step else 3
    shape([(1, 10), (2, 7), (3, 5), (5, top), (8, top),
           (10, 5), (11, 7), (12, 10), (11, 12), (2, 12)])
    draw.line([(5, 5), (8, 5), (9, 7), (8, 9), (5, 9), (4, 7), (5, 5)], fill=2)
    draw.line([(5, 5), (4, 4)], fill=2)
    draw.line([(8, 5), (9, 4)], fill=2)
    draw.line([(4, 7), (2, 7)], fill=2)
    draw.line([(9, 7), (10, 7)], fill=2)
    draw.line([(5, 9), (4, 11)], fill=2)
    draw.line([(8, 9), (9, 11)], fill=2)

    # A pet causes a small wave; edge scratching becomes a little foot reach.
    if name.startswith("kaki") or stretch:
        draw.line([(10, 11), (12, 11 if step else 12),
                   (13, 10 if step else 12)], fill=1, width=1)

    if tucked:
        # Keep the retracted shell centred in the same sprite cell.
        centered = Image.new("L", (16, 16), 0)
        centered.paste(art, (1, 0))
        art = centered
    elif "left" in name or name.startswith("ltogi"):
        art = art.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    elif name.startswith(("up1", "up2", "utogi")):
        art = art.transpose(Image.Transpose.ROTATE_90)
    elif name.startswith(("down", "dtogi")):
        art = art.transpose(Image.Transpose.ROTATE_270)

    if size != 16:
        art = art.resize((size, size), Image.Resampling.NEAREST)
    mask = art.point(lambda value: 255 if value else 0)
    ink = art.point(lambda value: 255 if value == 2 else 0)
    assert ImageChops.subtract(ink, mask).getbbox() is None
    pixels = art.load()
    return (
        [[int(pixels[x, y] != 0) for x in range(size)] for y in range(size)],
        [[int(pixels[x, y] == 2) for x in range(size)] for y in range(size)],
    )
