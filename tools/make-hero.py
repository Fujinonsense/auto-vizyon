# Resizes the Higgsfield studio image into the home hero (iPhone 3x width).
# Usage: python -I tools/make-hero.py <source.png> app/img/hero.webp
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
w = 1170
im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.save(dst, 'WEBP', quality=74, method=6)
print(dst, im.size)
