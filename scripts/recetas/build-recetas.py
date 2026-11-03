"""Agrupa les entrades extretes per plat, tria la versió més habitual i escriu la llavor de "Mis recetas".

Ús: python -I scripts/recetas/build-recetas.py <entrades.json> src/data/recetasPlanificaciones.json
Els noms dels pacients surten dels noms de fitxer: les notes personals es treuen i, si en queda
algun a la sortida, s'avisa ("¿nom?") per revisar-ho a mà abans de desar.
"""
import sys, re, json, unicodedata, collections

sys.stdout.reconfigure(encoding="utf-8")


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def loose_key(t):
    # L'ordre de les paraules no compta ("pollo, setas y alcachofas" = "setas, alcachofas y pollo")
    k = fold(t)
    k = re.sub(r"\([^)]*\)", " ", k)
    k = k.replace("+", " y ").replace("&", " y ")
    k = re.sub(r"[^a-z0-9ñ ]", " ", k)
    k = re.sub(r"\b(?:con|de|del|y|a|al|la|el|los|las|en)\b", " ", k)
    return " ".join(sorted(set(k.split())))


def plan_no(fname):
    m = re.search(r"Planificaci[oó]n\s*(\d+)", fname)
    return int(m.group(1)) if m else 0


def tidy(line):
    line = re.sub(r"[﻿​-‍]", "", line)
    line = re.sub(r"\s+", " ", line).strip()
    line = re.sub(r"\s+([,.;:)])", r"\1", line)
    line = re.sub(r"\(\s+", "(", line)
    return line[:1].upper() + line[1:] if line else line


def tidy_title(t):
    t = re.sub(r"\s*[-–—]?\s*\(?receta pinchando aqu[ií]\)?", "", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" -–:+.(")
    t = re.sub(r"\s+([,)])", r"\1", t)
    return t[:1].upper() + t[1:]


entries = json.load(open(sys.argv[1], encoding="utf-8"))

# Noms dels pacients (dels noms de fitxer): cap nota personal no pot passar a les receptes
NAMES = set()
for f in {e["file"] for e in entries}:
    n = re.sub(r"^Planificaci[oó]n\s*\d+\s*-?\s*", "", f).replace(".pdf", "")
    NAMES |= {fold(w) for w in re.split(r"[\s.]+", n) if len(w) >= 3}
NAME_RE = "(?:" + "|".join(sorted(map(re.escape, NAMES))) + ")"
PERSONAL_LINE = re.compile(r"^\W*" + NAME_RE + r"\s*:", re.I)
PERSONAL_PAREN = re.compile(r"\s*\(\s*" + NAME_RE + r"\s*\)", re.I)
# Cel·les de Canva amb text sobreposat o tallat
BROKEN_TITLE = re.compile(r".\s*\b[AB]\)|salsa de zanaho$")
NOTE_TITLES = re.compile(r"^(?:hc totales|cocinalas|aceite de oliva virgen extra|especias al gusto|postre|priorizar|hidratos de carbono|utilizar una)", re.I)
LINK_HINT = re.compile(r"pulsa|pincha|subrayad|receta aqu", re.I)


def clean_food(line):
    f = fold(line)
    if PERSONAL_LINE.match(f) or LINK_HINT.search(line):
        return ""
    line = re.sub(r"\s*[-–]?\s*HC TOTALES:?\s*[\d.,]*\s*g\b", "", line, flags=re.I)
    # "Cebolla (Saray)" → "Cebolla"
    line = re.sub(r"\s*\([^)]*\)", lambda m: "" if PERSONAL_PAREN.fullmatch(fold(m.group(0))) else m.group(0), line)
    return tidy(line)

def glue_quantities(lines):
    """Treu "HC TOTALES: 6g" i enganxa a l'anterior una línia que només és quantitat ("80g")."""
    out = []
    skip_next_qty = False
    for l in lines:
        m = re.search(r"\s*[-–]?\s*hc totales", fold(l))
        if m:
            skip_next_qty = not re.search(r"\d", l[m.start():])
            l = l[:m.start()].strip()
            if l:
                out.append(l)
            continue
        if re.fullmatch(r"[\d.,]+\s*(?:g|gr|ml|%)\.?\)?", l, re.I):
            if skip_next_qty:
                skip_next_qty = False
                continue
            if out:
                out[-1] += " " + l
                continue
        skip_next_qty = False
        out.append(l)
    return out


groups = collections.defaultdict(list)
for e in entries:
    if "BAR" in (e.get("heading") or "").upper():
        continue  # què demanar al bar: no és una recepta
    e["titulo"] = tidy_title(e["titulo"])
    e["alimentos"] = glue_quantities([a for a in map(clean_food, e["alimentos"]) if a])
    if not e["titulo"] or not e["alimentos"] or len(e["titulo"]) < 4 or NOTE_TITLES.match(fold(e["titulo"])) or BROKEN_TITLE.search(e["titulo"]):
        continue
    if re.match(r"(?:tortilla|revuelto)\b", fold(e["titulo"])) and not re.search(r"huevo|clara", fold(" ".join(e["alimentos"]))):
        continue  # cel·la amb els ingredients d'un altre plat
    groups[loose_key(e["titulo"])].append(e)

recipes = []
for k, es in groups.items():
    if not k:
        continue
    recency = lambda e: (e["mtime"], plan_no(e["file"]))
    titles = collections.Counter(e["titulo"] for e in es)
    best_title = max(titles, key=lambda t: (titles[t], max(recency(e) for e in es if e["titulo"] == t)))
    variants = collections.Counter("\n".join(e["alimentos"]) for e in es)
    best_foods = max(variants, key=lambda v: (variants[v], max(recency(e) for e in es if "\n".join(e["alimentos"]) == v)))
    links = collections.Counter(e["receta"] for e in es if e["receta"])
    receta = links.most_common(1)[0][0] if links else ""
    sections = collections.Counter("menu" if e["section"] == "menu" else "opcion" for e in es)
    recipes.append({
        "titulo": best_title,
        "alimentos": best_foods,
        "receta": receta,
        "_veces": len(es),
        "_planes": len({e["file"] for e in es}),
        "_variantes": len(variants),
        "_tipo": sections.most_common(1)[0][0],
    })

recipes.sort(key=lambda r: fold(r["titulo"]))
for r in recipes:
    words = set(re.findall(r"[a-zñ]+", fold(r["titulo"] + " " + r["alimentos"])))
    if words & NAMES:
        print("  ¿nom?", sorted(words & NAMES), "|", r["titulo"], "|", r["alimentos"].replace(chr(10), " · ")[:120])
rows = [json.dumps({"titulo": r["titulo"], "alimentos": r["alimentos"], **({"receta": r["receta"]} if r["receta"] else {})},
                   ensure_ascii=False) for r in recipes]
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as out:
    out.write("[\n" + ",\n".join(rows) + "\n]\n")
print(len(entries), "entrades →", len(recipes), "receptes;", sum(1 for r in recipes if r["receta"]), "amb enllaç")
print(collections.Counter(r["_tipo"] for r in recipes))
