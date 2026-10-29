# Turns the Higgsfield images into app assets.
# Usage: python -I tools/make-art.py <dir with icons.png welcome.png earnings.png> app/img
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]

# 3 x 2 icon sheet with a transparent background -> one trimmed square icon per cell
ICONS = ['ruhsat', 'ehliyet', 'kimlik', 'camera', 'car', 'coins']
sheet = Image.open(f'{src}/icons.png').convert('RGBA')
cw, ch = sheet.width // 3, sheet.height // 2
solid = sheet.getchannel('A').point(lambda a: 255 if a > 24 else 0)


def empty(box):
    return solid.crop(box).getbbox() is None


def icon_box(x0, y0, x1, y1):
    # The model lets an icon cross its cell line (the car's nose does). Start in the middle of the cell
    # and widen to the first empty column and row on each side, so the icon stays whole and a
    # neighbour's overhang, which sits past an empty gap, stays out.
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    if empty((cx, y0, cx + 1, y1)):
        return x0, y0, x1, y1
    left, right = cx, cx + 1
    while left > 0 and not empty((left - 1, y0, left, y1)): left -= 1
    while right < sheet.width and not empty((right, y0, right + 1, y1)): right += 1
    if empty((left, cy, right, cy + 1)):
        return left, y0, right, y1
    top, bottom = cy, cy + 1
    while top > 0 and not empty((left, top - 1, right, top)): top -= 1
    while bottom < sheet.height and not empty((left, bottom, right, bottom + 1)): bottom += 1
    return left, top, right, bottom


for i, name in enumerate(ICONS):
    box = icon_box((i % 3) * cw, (i // 3) * ch, (i % 3 + 1) * cw, (i // 3 + 1) * ch)
    cell = sheet.crop(box)
    cell = cell.crop(cell.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox())
    side = max(cell.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.alpha_composite(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
    square.resize((192, 192), Image.LANCZOS).save(f'{out}/ic-{name}.webp', 'WEBP', quality=88, method=6)


def fit_width(name, width, dst):
    im = Image.open(f'{src}/{name}.png').convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(f'{out}/{dst}', 'WEBP', quality=74, method=6)
    print(dst, im.size)


fit_width('welcome', 1170, 'welcome.webp')
fit_width('earnings', 1170, 'earnings.webp')
