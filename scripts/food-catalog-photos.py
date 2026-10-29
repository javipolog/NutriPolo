"""Fotos del catàleg d'aliments (public/alimentos/<id>.jpg).

Baixa les fotos de Pixabay (llicència Pixabay: ús lliure, sense atribució) i
les deixa totes iguals: aliment retallat, centrat, sobre blanc pur, amb la
mateixa mida i una ombra suau a sota. La llista surt de
src/services/genericFoods.js (camp `pixabay`).

    python -m pip install pillow
    python scripts/food-catalog-photos.py            # només les que falten
    python scripts/food-catalog-photos.py --force    # totes de nou
"""
import io, json, re, sys, urllib.request
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'alimentos'
SIZE = 480           # el mateix màxim que les fotos pujades a mà (imageFileToDataUrl)
FILL = 0.78          # costat llarg de l'aliment respecte del quadre


def catalog():
    src = (ROOT / 'src' / 'services' / 'genericFoods.js').read_text(encoding='utf8')
    return re.findall(r"id:\s*'([^']+)'.*?pixabay:\s*'([^']+)'", src)


def download(path):
    base, ext = path.rsplit('.', 1)
    req = urllib.request.Request(f'https://cdn.pixabay.com/photo/{base}_1280.{ext}', headers={'User-Agent': 'Mozilla/5.0'})
    return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGBA')


def cutout(im):
    """Màscara de l'aliment: l'alfa d'un PNG retallat o, en una foto sobre
    fons clar, la distància al color del fons (vores suaus, ombra inclosa)."""
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] < 250:
        return im, alpha, True
    rgb = im.convert('RGB')
    w, h = rgb.size
    # Fons de cada fila interpolat entre les vores esquerra i dreta: moltes
    # fotos d'estudi tenen un degradat (més gris a baix) que no és l'aliment
    edges = Image.new('RGB', (2, h))
    edges.paste(rgb.crop((0, 0, 6, h)).resize((1, h), Image.BOX), (0, 0))
    edges.paste(rgb.crop((w - 6, 0, w, h)).resize((1, h), Image.BOX), (1, 0))
    bg = edges.resize((w, h), Image.BILINEAR)
    diff = ImageChops.difference(rgb, bg).convert('L')
    mask = diff.point(lambda d: 0 if d < 8 else 255 if d > 38 else int((d - 8) * 255 / 30))
    return im, mask.filter(ImageFilter.GaussianBlur(0.6)), False


def render(im):
    im, mask, synthetic_shadow = cutout(im)
    box = mask.point(lambda a: 255 if a > 24 else 0).getbbox()
    im, mask = im.crop(box), mask.crop(box)
    k = SIZE * FILL / max(im.size)
    size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
    im, mask = im.resize(size, Image.LANCZOS), mask.resize(size, Image.LANCZOS)
    x = (SIZE - size[0]) // 2
    y = (SIZE - size[1]) // 2 + round(SIZE * 0.02)
    canvas = Image.new('RGB', (SIZE, SIZE), 'white')
    if synthetic_shadow:
        # Els PNG retallats no porten ombra: una el·lipse difusa sota la base
        shadow = Image.new('L', (SIZE, SIZE), 0)
        ImageDraw.Draw(shadow).ellipse([x + size[0] * 0.08, y + size[1] - SIZE * 0.035,
                                        x + size[0] * 0.92, y + size[1] + SIZE * 0.03], fill=70)
        shadow = shadow.filter(ImageFilter.GaussianBlur(SIZE * 0.025))
        canvas.paste(Image.new('RGB', canvas.size, (120, 120, 120)), (0, 0), shadow)
    canvas.paste(im.convert('RGB'), (x, y), mask)
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    force = '--force' in sys.argv
    for food_id, path in catalog():
        dest = OUT / f'{food_id}.jpg'
        if dest.exists() and not force:
            continue
        render(download(path)).save(dest, 'JPEG', quality=86, optimize=True, progressive=True)
        print(food_id)


if __name__ == '__main__':
    main()
