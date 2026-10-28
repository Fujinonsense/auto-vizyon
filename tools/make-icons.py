# Cuts the AV monogram out of the shop logo and builds the app icons.
# Usage: python -I tools/make-icons.py app/img/logo.png app/img
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
logo = Image.open(src).convert('RGBA')
w = logo.width
MARK_TOP, MARK_BOTTOM = 104, 277  # monogram band (text starts at y=280)


def content_x_range(y0, y1, thresh=700):
    px = logo.load()
    xs = [x for y in range(y0, y1) for x in range(w) if sum(px[x, y][:3]) < thresh]
    return min(xs), max(xs)


def knock_out_white(img):
    img = img.copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, _ = px[x, y]
            m = min(r, g, b)
            if m > 245:
                px[x, y] = (r, g, b, 0)
            elif m > 215:
                px[x, y] = (r, g, b, int(255 * (245 - m) / 30))
    return img


x0, x1 = content_x_range(MARK_TOP, MARK_BOTTOM)
mark = knock_out_white(logo.crop((max(0, x0 - 6), MARK_TOP, min(w, x1 + 7), MARK_BOTTOM)))
mark.save(f'{out}/mark.png')


def icon(size, pad):
    canvas = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    m = mark.copy()
    inner = int(size * (1 - 2 * pad))
    m.thumbnail((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return canvas.convert('RGB')


icon(512, 0.16).save(f'{out}/icon-512.png')
icon(192, 0.14).save(f'{out}/icon-192.png')
icon(180, 0.12).save(f'{out}/apple-touch-icon.png')
print('mark', mark.size)
