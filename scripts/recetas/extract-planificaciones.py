"""Extreu plats (menú) i opcions (desayunos / almuerzos / meriendas) de les planificacions de Canva.

Ús: python -I scripts/recetas/extract-planificaciones.py <carpeta_pdfs> <entrades.json>
Sortida: llista de { file, section, page, titulo, alimentos: [..], receta } (cal PyMuPDF)
Després: scripts/recetas/build-recetas.py. L'entrada té dades de pacients: no la desis al repo.
"""
import sys, os, re, glob, json, unicodedata
import pymupdf

sys.stdout.reconfigure(encoding="utf-8")

DAYS = ["LUNES", "MARTES", "MIÉRCOLES", "MIERCOLES", "JUEVES", "VIERNES", "SÁBADO", "SABADO", "DOMINGO"]


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def is_bold(span):
    f = span["font"].lower()
    return "bold" in f or "black" in f or "semibold" in f or bool(span["flags"] & 16)


def spans_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                t = s["text"]
                if not t.strip():
                    continue
                x0, y0, x1, y1 = s["bbox"]
                out.append({"t": t, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "size": s["size"],
                            "bold": is_bold(s), "italic": "italic" in s["font"].lower() or bool(s["flags"] & 2),
                            "font": s["font"], "color": s["color"]})
    return out


def to_lines(spans, tol=None):
    """Agrupa spans en línies visuals (mateixa y)."""
    spans = sorted(spans, key=lambda s: (round((s["y0"] + s["y1"]) / 2, 0), s["x0"]))
    lines = []
    for s in spans:
        cy = (s["y0"] + s["y1"]) / 2
        h = s["y1"] - s["y0"]
        for ln in lines:
            if abs(ln["cy"] - cy) < (tol or h * 0.4):
                ln["spans"].append(s)
                break
        else:
            lines.append({"cy": cy, "spans": [s]})
    res = []
    for ln in lines:
        ss = sorted(ln["spans"], key=lambda s: s["x0"])
        text = ""
        prev = None
        for s in ss:
            if prev is not None and s["x0"] - prev["x1"] > s["size"] * 0.15 and not text.endswith(" ") and not s["t"].startswith(" "):
                text += " "
            text += s["t"]
            prev = s
        nb = sum(len(s["t"].strip()) for s in ss if s["bold"])
        nall = sum(len(s["t"].strip()) for s in ss)
        res.append({"text": re.sub(r"\s+", " ", text).strip(), "x0": min(s["x0"] for s in ss), "x1": max(s["x1"] for s in ss),
                    "y0": min(s["y0"] for s in ss), "y1": max(s["y1"] for s in ss), "bold": nb * 2 > nall,
                    "size": max(s["size"] for s in ss), "colors": {s["color"] for s in ss if s["bold"]},
                    "italic": all(s["italic"] for s in ss), "anybold": any(s["bold"] for s in ss)})
    res.sort(key=lambda l: l["y0"])
    return res


def first_word_width(line):
    t = line["text"]
    w = line["x1"] - line["x0"]
    fw = t.split(" ")[0]
    return w * len(fw) / max(len(t), 1)


CONT_END = re.compile(r"(?:\b(?:de|del|con|y|o|al|a|en|la|el|los|las|sin|para|tipo|u|e)|[,(+\-–/])$", re.I)


def join_wrapped(lines, box_w):
    """Refà les línies lògiques d'un bloc de text ajustat (centrat o a l'esquerra)."""
    items = []
    prev = None
    for ln in lines:
        t = ln["text"]
        if prev is None:
            items.append(t)
            prev = ln
            continue
        pw = prev["x1"] - prev["x0"]
        space = ln["size"] * 0.3
        fits = pw + space + first_word_width(ln) <= box_w * 1.01
        starts_low = bool(re.match(r"^[a-zñáéíóúü(\-–)\]/.,:;]", t))
        prev_t = items[-1]
        open_paren = prev_t.count("(") > prev_t.count(")") or bool(re.search(r"[-–(]$", prev_t))
        conj = open_paren or re.search(r"(?:\b(?:o|y|de|del|con|al|u|e|en|sin|a|la|el|que|para|tipo)|[\d½¼¾⅓⅔])$", prev_t, re.I) is not None
        cont = (not fits and starts_low) or conj or (starts_low and CONT_END.search(items[-1]) is not None) or bool(re.match(r"^[)\]/]", t))
        if cont:
            items[-1] = items[-1] + " " + t
        else:
            items.append(t)
        prev = ln
    return [re.sub(r"\s+", " ", i).strip().rstrip(",").strip() for i in items if i.strip(" ,")]


TITLE_PREFIX = re.compile(r"^\s*[-–•]*\s*(?:opci[oó]n\s*\d+\s*[:.)-]?|[AB]\s*[).:-]|\d+\s*[).:-])?\s*", re.I)
SKIP_TITLE = re.compile(r"^(?:-+|libre.*|comida libre.*|cena libre.*|comidas?|cenas?|desayunos?|almuerzos?|meriendas?|media mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$", re.I)


def clean_title(t):
    t = TITLE_PREFIX.sub("", t).strip()
    t = re.sub(r"\s*\+\s*$", "", t).strip()
    t = re.sub(r"\s+", " ", t)
    return t


def link_for(rects_links, lines):
    for ln in lines:
        r = pymupdf.Rect(ln["x0"], ln["y0"], ln["x1"], ln["y1"])
        for lr, uri in rects_links:
            if r.intersects(lr):
                return uri
    return ""


def page_links(page):
    out = []
    for l in page.get_links():
        if l.get("uri"):
            out.append((pymupdf.Rect(l["from"]), l["uri"]))
    return out


def classify(h):
    h = fold(h)
    if "menu semanal" in h:
        return "menu"
    if "desayuno" in h and "almuerzo" in h:
        return "desayunos"
    if "desayuno" in h:
        return "desayunos"
    if "media manana" in h or "almuerzo" in h or "almiuerzo" in h:
        return "mediaManana"
    if "merienda" in h:
        return "merienda"
    if "comodin" in h:
        return "comodin"
    if "ideas comidas" in h or "ideas cenas" in h:
        return "ideas"
    return None


def menu_entries(spans, links):
    days = [s for s in spans if s["t"].strip().upper() in DAYS]
    if len(days) < 5:
        return None
    days.sort(key=lambda s: s["x0"])
    centers = []
    for d in days:
        cx = (d["x0"] + d["x1"]) / 2
        if all(abs(cx - c) > 10 for c in centers):
            centers.append(cx)
    centers.sort()
    spacing = min(b - a for a, b in zip(centers, centers[1:])) if len(centers) > 1 else 80
    head_y = min(d["y1"] for d in days)
    body = [s for s in spans if s["y0"] > head_y and s["t"].strip().upper() not in DAYS and s["size"] < 9
            and "NUTRIPOLO" not in s["t"]]
    # Notes al peu (centrades, més amples que una columna): es talla a la primera
    first_y = min((s["y0"] for s in body), default=head_y)
    wide = [s["y0"] for s in body if (s["x1"] - s["x0"]) > spacing * 1.05 and s["y0"] > first_y + 40]
    if wide:
        cut = min(wide) - 1
        body = [s for s in body if s["y0"] < cut]
    cols = {i: [] for i in range(len(centers))}
    for s in body:
        cx = (s["x0"] + s["x1"]) / 2
        i = min(range(len(centers)), key=lambda k: abs(centers[k] - cx))
        if abs(centers[i] - cx) <= spacing * 0.6:
            cols[i].append(s)
    out = []
    for i, ss in cols.items():
        lines = to_lines(ss)
        if lines:
            out += blocks_from_column(lines, links)
    return out


MENU_TITLE_COLORS = {0x8c9a35, 0x5e5f23}


def blocks_from_column(lines, links):
    """Seqüència títol (negreta) + ingredients (normal)."""
    out = []
    cur = None
    for idx, ln in enumerate(lines):
        gap_break = cur is not None and ln["y0"] - lines[idx - 1]["y1"] > ln["size"] * 2.2
        # Els títols del menú són verds (o comencen per "A)"/"B)"); una línia en negreta
        # d'un altre color enmig dels ingredients és l'hidrat ressaltat, no un plat nou
        # (sovint en cursiva)
        starts_title = (bool(ln["colors"] & MENU_TITLE_COLORS) and not ln["italic"]) or bool(re.match(r"^\s*[AB]\s*\)", ln["text"]))
        if ln["bold"] and cur is not None and cur["ing"] and not starts_title and not gap_break:
            cur["ing"].append(ln)
        elif cur is not None and cur["title"] and not cur["ing"] and ln["anybold"] and not gap_break:
            cur["title"].append(ln)  # "jamón + tostada": títol amb trossos en cursiva
        elif ln["bold"]:
            if cur is None or cur["ing"] or gap_break:
                cur = {"title": [ln], "ing": []}
                out.append(cur)
            else:
                cur["title"].append(ln)
        else:
            if cur is None or gap_break:
                cur = {"title": [], "ing": []}
                out.append(cur)
            cur["ing"].append(ln)
    res = []
    for b in out:
        if not b["title"]:
            continue
        title = clean_title(" ".join(l["text"] for l in b["title"]))
        if not title or SKIP_TITLE.match(title):
            continue
        ing = join_wrapped(b["ing"], max(l["x1"] - l["x0"] for l in b["ing"])) if b["ing"] else []
        res.append({"titulo": title, "alimentos": ing, "receta": link_for(links, b["title"])})
    return res


def vblocks(ls):
    """Blocs de línies seguides (mateixa columna, sense salt vertical gran)."""
    bl = []
    for l in sorted(ls, key=lambda l: l["y0"]):
        cx = (l["x0"] + l["x1"]) / 2
        for b in reversed(bl):
            last = b[-1]
            if abs(((last["x0"] + last["x1"]) / 2) - cx) < 120 and -2 < l["y0"] - last["y1"] < l["size"] * 0.9:
                b.append(l)
                break
        else:
            bl.append([l])
    return bl


def options_entries(spans, links):
    """Pàgina d'opcions: títol en negreta a l'esquerra, ingredients a la dreta."""
    bold = to_lines([s for s in spans if s["bold"]])
    reg = to_lines([s for s in spans if not s["bold"]])
    tb = vblocks(bold)
    ib = vblocks(reg)
    res = []
    used = set()
    for t in tb:
        title = clean_title(" ".join(l["text"] for l in t))
        if not title or SKIP_TITLE.match(title) or re.match(r"^(nota|importante|opcional)\b", fold(title)):
            continue
        ty0, ty1 = t[0]["y0"], t[-1]["y1"]
        ty = (ty0 + ty1) / 2
        tx1 = max(l["x1"] for l in t)
        cands = []
        for k, b in enumerate(ib):
            if k in used or min(l["x0"] for l in b) < tx1 - 15:
                continue
            by0, by1 = b[0]["y0"], b[-1]["y1"]
            cands.append((abs((by0 + by1) / 2 - ty), k))
        ing = []
        if cands:
            d, k = min(cands)
            b = ib[k]
            if d < 60 or (b[0]["y0"] <= ty <= b[-1]["y1"]):
                used.add(k)
                ing = join_wrapped(b, max(l["x1"] - l["x0"] for l in b))
        res.append({"titulo": title, "alimentos": ing, "receta": link_for(links, t)})
    return res


def extract(path):
    doc = pymupdf.open(path)
    out = []
    for pno, page in enumerate(doc):
        spans = spans_of(page)
        links = page_links(page)
        m = menu_entries(spans, links)
        if m:
            out += [{"section": "menu", "page": pno, **e} for e in m]
            continue
        heads = [s for s in spans if s["size"] >= 13 and classify(s["t"])]
        if not heads:
            # Capçalera dibuixada com a imatge: pàgina d'opcions sense títol
            if pno > 0 and not any(s["size"] >= 13 and "NUTRIPOLO" not in s["t"] for s in spans):
                body = [s for s in spans if "NUTRIPOLO" not in s["t"]]
                out += [{"section": "otros", "page": pno, **e} for e in options_entries(body, links)]
            continue
        heads.sort(key=lambda s: s["y0"])
        body = [s for s in spans if s["size"] < 13 and "NUTRIPOLO" not in s["t"]]
        # Cada span va a la capçalera més propera per sobre (i en columna, si n'hi ha dues a la mateixa alçada)
        groups = {id(h): [] for h in heads}
        for s in body:
            above = [h for h in heads if h["y1"] <= s["y0"] + 2]
            if not above:
                continue
            y = max(h["y0"] for h in above)
            row = [h for h in above if abs(h["y0"] - y) < 10]
            h = min(row, key=lambda h: abs((h["x0"] + h["x1"]) / 2 - (s["x0"] + s["x1"]) / 2))
            groups[id(h)].append(s)
        for h in heads:
            kind = classify(h["t"])
            for e in options_entries(groups[id(h)], links):
                out.append({"section": kind, "heading": h["t"].strip(), "page": pno, **e})
    return out


if __name__ == "__main__":
    src = sys.argv[1]
    files = [src] if src.lower().endswith(".pdf") else sorted(glob.glob(os.path.join(src, "*.pdf")))
    allr = []
    for f in files:
        r = extract(f)
        for e in r:
            e["file"] = os.path.basename(f)
            e["mtime"] = os.path.getmtime(f)
        allr += r
        print(f"{os.path.basename(f)[:45]:45} {len(r):3}  " + ", ".join(f"{k}={sum(1 for e in r if e['section']==k)}" for k in ["desayunos", "mediaManana", "merienda", "menu"]), file=sys.stderr)
    out = sys.argv[2] if len(sys.argv) > 2 else None
    if out:
        json.dump(allr, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    else:
        for e in allr:
            print(f"[{e['section']}] {e['titulo']}  <{e['receta']}>")
            for a in e["alimentos"]:
                print("     -", a)
