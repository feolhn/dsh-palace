"""把设计负责人原型（Discussion #40）里的水彩图标转成插件用的小 WebP。
用法：python3 -I scripts/make-icons.py <原型目录> vendor/icons
每个图标按原型的校准（icons.js / style.css 里的尺寸和位移）画进同一个 77×77 的框（四周各留 10 的余量），
导出 2 倍大小（194×194）。前端只要把图片放在框的 (-10, -10) 处，大小 97×97。"""
import sys
from pathlib import Path
from PIL import Image

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
M, S = 10, 2  # 余量、倍数
BOX = 77 + 2 * M

def canvas():
    return Image.new('RGBA', (BOX * S, BOX * S), (0, 0, 0, 0))

def place(img, w, h, left, top, c=None):
    c = c or canvas()
    im = img.resize((round(w * S), round(h * S)), Image.LANCZOS)
    c.alpha_composite(im, (round((left + M) * S), round((top + M) * S)))
    return c

def save(c, key):
    c.save(out / f'{key}.webp', 'WEBP', quality=86, method=6)

# 圆形水彩物体（icons.js 的校准）
named = {
    'mercury': ('experiment-assets/planets/watercolor-mercury.png', 72.35469, 2.380354, 1.774513),
    'venus': ('experiment-assets/planets/watercolor-venus.png', 71.451386, 3.002222, 2.17603),
    'mars': ('experiment-assets/planets/watercolor-mars.png', 69.710792, 3.950353, 2.727357),
    'black-swan': ('assets/watercolor-black-swan-round-v2.png', 78.186557, -0.677324, -3.026358),
    'snow-mountain': ('assets/watercolor-snow-mountain-round-v2.png', 76.925484, 0.311692, -4.833681),
    'earth': ('assets/watercolor-earth.png', 69.288814, 4.124255, 2.568226),
    'pufferfish': ('assets/watercolor-pufferfish-round-v2.png', 79.269474, -0.684766, -1.147384),
    'lotus-leaf': ('assets/watercolor-lotus-leaf-round-v2.png', 67.491226, 5.003335, 5.058056),
    'gold-coin': ('assets/watercolor-gold-coin.png', 76.925484, 0.352301, -0.285575),
    'teardrop': ('assets/watercolor-teardrop-round-v2.png', 73.187417, 1.990861, -1.584755),
}
for key, (path, size, left, top) in named.items():
    save(place(Image.open(src / path).convert('RGBA'), size, size, left, top), key)

# 月亮、红太阳：3:2 的图，object-fit: contain 进 86.3×57.6 的框（style.css .moon-button img）
save(place(Image.open(src / 'assets/watercolor-moon.png').convert('RGBA'), 86.328, 57.552, -4.350, 9.575), 'moon')
save(place(Image.open(src / 'assets/watercolor-sun-red.png').convert('RGBA'), 86.434, 57.623, -4.094, 9.844), 'sun')

# 精灵图（5 个一排）：background-size 500% auto，再按 style.css 的 translate + scale（以框中心为原点）
sprites = {
    'rainbow': ('assets/sapphic-watercolor-icons.png', 0, -1.448, -0.046, 0.787350),
    'orange': ('assets/sapphic-watercolor-icons-edited.png', 2, 3.346, -4.239, 1.063899),
    'open-book': ('assets/sapphic-watercolor-icons.png', 3, 0.676, 0.089, 0.707317),
    'shell': ('assets/sapphic-watercolor-icons.png', 4, 0.349, 0.149, 0.819947),
}
for key, (path, index, tx, ty, scale) in sprites.items():
    sheet = Image.open(src / path).convert('RGBA')
    sw, sh = 77 * 5, 77 * 5 * sheet.height / sheet.width
    ox, oy = (77 - sw) * (index / 4), (77 - sh) * 0.5
    # 精灵在框里的位置 → 缩放（中心 38.5）→ 平移
    w, h = sw * scale, sh * scale
    left = 38.5 + (ox - 38.5) * scale + tx
    top = 38.5 + (oy - 38.5) * scale + ty
    c = place(sheet, w, h, left, top)
    # 只保留框内这一格（精灵图其他格不能露出来）
    crop = canvas()
    x0, y0 = round((38.5 - 38.5 * scale + tx + M) * S), round((38.5 - 38.5 * scale + ty + M) * S)
    x1, y1 = round((38.5 + 38.5 * scale + tx + M) * S), round((38.5 + 38.5 * scale + ty + M) * S)
    crop.alpha_composite(c.crop((x0, y0, x1, y1)), (x0, y0))
    save(crop, key)
print('ok', len(list(out.glob('*.webp'))))
