# Cuts the shop's own lettering out of the logo for the app chrome.
# wordmark.png keeps the original colors (light surfaces); the *-dark files turn the black
# metallic parts into chrome so they stay visible on black.
# Usage: python -I tools/make-wordmark.py app/img/logo.png app/img
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
logo = Image.open(src).convert('RGBA')


def band_box(y0, y1, thresh=700):
    px = logo.load()
    xs = [x for y in range(y0, y1) for x in range(logo.width) if sum(px[x, y][:3]) < thresh]
    return max(0, min(xs) - 4), y0, min(logo.width, max(xs) + 5), y1


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


def chrome(img):
    img = img.copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            hi, lo = max(r, g, b), min(r, g, b)
            if (hi - lo) / hi < 0.22 if hi else True:
                v = 255 - int((r + g + b) / 3 * 0.78)
                px[x, y] = (v, v, min(255, v + 4), a)
    return img


def drop_edge_specks(img, max_width=3):
    """Clears the 1-2 px stray columns the scan leaves left and right of the lettering."""
    a = img.getchannel('A')
    ink = [any(a.getpixel((x, y)) > 40 for y in range(img.height)) for x in range(img.width)]
    runs, start = [], None
    for x, on in enumerate(ink + [False]):
        if on and start is None:
            start = x
        if not on and start is not None:
            runs.append((start, x))
            start = None
    while runs and runs[0][1] - runs[0][0] <= max_width:
        runs.pop(0)
    while runs and runs[-1][1] - runs[-1][0] <= max_width:
        runs.pop()
    return img.crop((max(0, runs[0][0] - 2), 0, min(img.width, runs[-1][1] + 2), img.height))


wordmark = drop_edge_specks(knock_out_white(logo.crop(band_box(278, 360))))
wordmark.save(f'{out}/wordmark.png')
chrome(wordmark).save(f'{out}/wordmark-dark.png')
drop_edge_specks(chrome(knock_out_white(logo.crop(band_box(104, 396))))).save(f'{out}/lockup-dark.png')
print('wordmark', wordmark.size)
