# Turns the Higgsfield images into app assets.
# Usage: python -I tools/make-art.py <dir with icons.png welcome.png earnings.png> app/img
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]

# 3 x 2 icon sheet with a transparent background -> one trimmed square icon per cell
ICONS = ['ruhsat', 'ehliyet', 'kimlik', 'camera', 'car', 'coins']
sheet = Image.open(f'{src}/icons.png').convert('RGBA')
cw, ch = sheet.width // 3, sheet.height // 2
for i, name in enumerate(ICONS):
    cell = sheet.crop(((i % 3) * cw, (i // 3) * ch, (i % 3 + 1) * cw, (i // 3 + 1) * ch))
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
