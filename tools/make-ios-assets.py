# iPhone app icon (1024, no transparency) and launch image (2732 square) from the dark logo lockup.
# Usage: python -I tools/make-ios-assets.py app/img/lockup-dark.png ios/App/App/Assets.xcassets
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
lockup = Image.open(src).convert('RGBA')
MARK_BOTTOM = 171  # the AV monogram ends here, the AUTO VİZYON text starts below

mark = lockup.crop((0, 0, lockup.width, MARK_BOTTOM))
mark = mark.crop(mark.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox())


def placed(img, width, canvas):
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    canvas.alpha_composite(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
    return canvas


# Icon: the monogram on a near-black radial glow, the way the app's dark top bar looks.
glow = Image.radial_gradient('L').resize((1024, 1024), Image.BICUBIC)
icon = Image.merge('RGB', [glow.point(lambda v, c=c: round(c * (1 - v / 255) ** 1.6)) for c in (34, 32, 28)]).convert('RGBA')
placed(mark, 700, icon).convert('RGB').save(f'{out}/AppIcon.appiconset/AppIcon-512@2x.png')

# Launch image: shown "aspect fill", so a phone sees only the middle ~45% of the width.
splash = placed(lockup, 820, Image.new('RGBA', (2732, 2732), (0, 0, 0, 255))).convert('RGB')
for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    splash.save(f'{out}/Splash.imageset/{name}')
print('icon and splash written')
