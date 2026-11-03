"""Agrupa les entrades extretes per plat, les neteja, tria la versió més habitual i escriu la llavor de "Mis recetas".

Ús: python -I scripts/recetas/build-recetas.py <entrades.json> src/data/recetasPlanificaciones.json
        [--review revisio.md] [--map-from <llavor_v15.json> src/data/recetasPlanificacionesV15.json]

Els noms dels pacients surten dels noms de fitxer: les notes personals es treuen i, si en queda
algun a la sortida, s'avisa ("¿nom?") per revisar-ho a mà abans de desar.
--review escriu les fusions i correccions per revisar-les. --map-from relaciona cada recepta
de la llavor de la v1.18.0 (migració v15) amb la nova, per a la migració v16.
"""
import sys, re, json, unicodedata, collections, argparse

sys.stdout.reconfigure(encoding="utf-8")


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


# ── Neteja del text ──────────────────────────────────────────
# Errates dels PDF (paraula sencera, es conserva la majúscula inicial)
WORD_FIXES = {
    "acomapaña": "acompaña", "agucate": "aguacate", "aifrayer": "airfrayer", "airfayer": "airfrayer",
    "airfrrayer": "airfrayer", "bolla": "bola", "bonaito": "boniato", "cabalacín": "calabacín",
    "cabfra": "cabra", "carpacio": "carpaccio", "cerelaes": "cereales", "chda": "cucharada",
    "chdas": "cucharadas", "crepes": "creps", "crepés": "creps", "cuchardas": "cucharadas",
    "esilo": "estilo", "espaguettis": "espaguetis", "espoinacas": "espinacas", "estandar": "estándar",
    "freir": "freír", "fruts": "fruta", "garbannzos": "garbanzos", "giego": "griego", "kwii": "kiwi",
    "laminas": "láminas", "lechesemidesnatada": "leche semidesnatada", "lentjeas": "lentejas",
    "limon": "limón", "locha": "loncha", "maiz": "maíz", "máiz": "maíz", "microonda": "microondas",
    "narturales": "naturales", "palncha": "plancha", "peqieña": "pequeña", "piezad": "pieza",
    "pimieto": "pimiento", "plvo": "polvo", "podeis": "podéis", "poke": "poké", "querais": "queráis",
    "queiras": "quieras", "quiinoa": "quinoa", "rissoto": "risotto", "rúcuia": "rúcula",
    "serrrano": "serrano", "sofreir": "sofreír", "solomilllo": "solomillo", "todajas": "rodajas",
    "tomare": "tomate", "tomata": "tomate", "toritas": "tortitas", "vainila": "vainilla", "vede": "verde",
    "verduraas": "verduras", "verudra": "verdura", "zanahroia": "zanahoria",
}
PHRASE_FIXES = [
    ("j amón", "jamón"), ("merluz a", "merluza"), ("queso freso fresco", "queso fresco"),
    ("microondas/airfra yer", "microondas/airfrayer"), ("lara atún", "lata atún"), ("OPC1ÓN", "OPCIÓN"),
]
WORD_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+")
KEEP_UPPER = {"AOVE", "HC", "DHA", "EPA", "L", "M", "XL"}


def fix_words(s):
    for a, b in PHRASE_FIXES:
        s = s.replace(a, b)

    def word(m):
        w = m.group(0)
        if w.isupper() and len(w) >= 2 and w not in KEEP_UPPER:
            w = w.lower()  # "ACOMPAÑA CON ENSALADA", "(POCA CEBOLLA)"
        fix = WORD_FIXES.get(w.lower())
        if fix:
            w = fix[:1].upper() + fix[1:] if w[:1].isupper() else fix
        return w
    return WORD_RE.sub(word, s)


def fix_units(s):
    s = re.sub(r"(\d)\s*(?:grs?|gramos|g)\b\.?", r"\1 g", s, flags=re.I)
    s = re.sub(r"(\d)\s*ml\b\.?", r"\1 ml", s, flags=re.I)
    return s


def tidy(line):
    line = re.sub("[﻿​-‍]", "", line)
    line = fix_units(fix_words(line))
    line = re.sub(r"\s+", " ", line).strip()
    line = re.sub(r"\s+([,.;:)])", r"\1", line)
    line = re.sub(r"\(\s+", "(", line)
    return line[:1].upper() + line[1:] if line else line


# Títols que cal reescriure a mà (clau: títol net, plegat)
TITLE_OVERRIDES = {
    "merienda opcional (solo hacerla cuando tengas hambre)": "Merienda opcional (solo si tienes hambre)",
    "opcion 2 para antojo dulce: galletas + yogur natural": "Antojo dulce: galletas + yogur natural",
    "opcion para antojo dulce: chocolate negro + frutos secos naturales": "Antojo dulce: chocolate negro + frutos secos naturales",
    "calamar a la plancha con salsa de verde + patata + ensalada": "Calamar a la plancha con salsa verde + patata + ensalada",
    "sepia a la plancha verduras salteadas": "Sepia a la plancha con verduras salteadas",
}


def tidy_title(t):
    t = re.sub(r"\s*[-–—]?\s*\(?receta pinchando aqu[ií]\)?", "", t, flags=re.I)
    t = tidy(t)
    t = re.sub(r"\s*(?:[-–—]+\s*)?\(?(antiinflamatori[oa])\)?$", r" (\1)", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" -–:+.(")
    t = re.sub(r"\s+([,)])", r"\1", t)
    t = t[:1].upper() + t[1:]
    return TITLE_OVERRIDES.get(fold(t), t)


# Receptes on el PDF posava un consejo en lloc dels aliments (clau: títol net, plegat)
RECIPE_OVERRIDES = {
    "1 botella de pediasure (200 ml)": None,  # suplement d'un pacient concret
    "1 barrita de proteinas con chocolate": {"alimentos": "1 barrita de proteínas con chocolate"},
    "1 pieza de fruta": {"alimentos": "1 pieza de fruta que quieras",
                         "nota": "Para que no pase demasiado tiempo sin comer entre la comida y la cena."},
    "1 pieza de fruta que quieras (ej: platano verde)": {"alimentos": "1 pieza de fruta que quieras (ej: plátano verde)"},
    "2 datiles rellenos de crema de cacahuete": {"alimentos": "2 dátiles\nCrema de cacahuete",
                                                 "nota": "Abre el dátil y rellénalo con la crema de cacahuete."},
    "datiles con crema de cacahuete y chocolate": {"alimentos": "Dátiles\nCrema de cacahuete\n1 onza de chocolate negro",
                                                   "nota": "Abre el dátil, quita el hueso y rellénalo con la crema de cacahuete y la onza de chocolate."},
    "magdalenas de avena caseras + infusion": {"alimentos": "Magdalenas de avena caseras\nInfusión o vaso de bebida de almendras sin azúcar"},
}

# El mateix plat escrit de maneres diferents: sense ordre, parèntesis, articles ni plurals
STOP = {"con", "de", "del", "y", "a", "al", "la", "el", "los", "las", "en", "u", "o", "un", "una"}


def singular(w):
    if len(w) > 4 and w.endswith("es") and w[-3] in "lrnzdj":
        return w[:-2]
    if len(w) > 3 and w.endswith("s"):
        return w[:-1]
    return w


def merge_key(t):
    k = fold(t)
    k = re.sub(r"\([^)]*\)", " ", k)
    k = k.replace("+", " y ").replace("&", " y ").replace("/", " ")
    k = re.sub(r"[^a-z0-9ñ ]", " ", k)
    return " ".join(sorted({singular(w) for w in k.split() if w not in STOP}))


def plan_no(fname):
    m = re.search(r"Planificaci[oó]n\s*(\d+)", fname)
    return int(m.group(1)) if m else 0


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


ap = argparse.ArgumentParser()
ap.add_argument("entries")
ap.add_argument("out")
ap.add_argument("--review")
ap.add_argument("--map-from", nargs=2, metavar=("OLD_SEED", "MAP_OUT"))
args = ap.parse_args()

entries = json.load(open(args.entries, encoding="utf-8"))

# Noms dels pacients (dels noms de fitxer): cap nota personal no pot passar a les receptes
NAMES = set()
for f in {e["file"] for e in entries}:
    n = re.sub(r"^Planificaci[oó]n\s*\d+\s*-?\s*", "", f).replace(".pdf", "")
    NAMES |= {fold(w) for w in re.split(r"[\s.]+", n) if len(w) >= 3}
NAME_RE = "(?:" + "|".join(sorted(map(re.escape, NAMES))) + ")"
PERSONAL_LINE = re.compile(r"^\W*" + NAME_RE + r"\s*:", re.I)
PERSONAL_PAREN = re.compile(r"\s*\(\s*" + NAME_RE + r"\s*\)", re.I)
# Cel·les de Canva amb text sobreposat o tallat
BROKEN_TITLE = re.compile(r".[AB]\)|salsa de zanaho$")
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
    """Treu "HC TOTALES: 6g" i enganxa a l'anterior una línia que només és quantitat ("80 g")."""
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
        if re.fullmatch(r"[\d.,]+\s*(?:g|ml|%)\.?\)?", l, re.I):
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
    raw_title = e["titulo"]
    e["titulo"] = tidy_title(raw_title)
    e["alimentos"] = glue_quantities([a for a in map(clean_food, e["alimentos"]) if a])
    if not e["titulo"] or not e["alimentos"] or len(e["titulo"]) < 4 or NOTE_TITLES.match(fold(e["titulo"])) or BROKEN_TITLE.search(raw_title):
        continue
    if re.match(r"(?:tortilla|revuelto)\b", fold(e["titulo"])) and not re.search(r"huevo|clara", fold(" ".join(e["alimentos"]))):
        continue  # cel·la amb els ingredients d'un altre plat
    groups[merge_key(e["titulo"])].append(e)

recipes = []
dropped = []
for k, es in groups.items():
    if not k:
        continue
    recency = lambda e: (e["mtime"], plan_no(e["file"]))
    titles = collections.Counter(e["titulo"] for e in es)
    best_title = max(titles, key=lambda t: (titles[t], max(recency(e) for e in es if e["titulo"] == t)))
    variants = collections.Counter("\n".join(e["alimentos"]) for e in es)
    best_foods = max(variants, key=lambda v: (variants[v], max(recency(e) for e in es if "\n".join(e["alimentos"]) == v)))
    links = collections.Counter(e["receta"] for e in es if e["receta"])
    r = {"titulo": best_title, "alimentos": best_foods, "receta": links.most_common(1)[0][0] if links else "", "nota": "",
         "_key": k, "_veces": len(es), "_titulos": titles,
         "_tipo": collections.Counter("menu" if e["section"] == "menu" else "opcion" for e in es).most_common(1)[0][0]}
    ov = RECIPE_OVERRIDES.get(fold(best_title), {})
    if ov is None:
        dropped.append(best_title)
        continue
    r.update(ov)
    recipes.append(r)

recipes.sort(key=lambda r: fold(r["titulo"]))
for r in recipes:
    words = set(re.findall(r"[a-zñ]+", fold(r["titulo"] + " " + r["alimentos"] + " " + r["nota"])))
    if words & NAMES:
        print("  ¿nom?", sorted(words & NAMES), "|", r["titulo"], "|", r["alimentos"].replace(chr(10), " · ")[:120])

rows = [json.dumps({"titulo": r["titulo"], "alimentos": r["alimentos"],
                    **({"receta": r["receta"]} if r["receta"] else {}), **({"nota": r["nota"]} if r["nota"] else {})},
                   ensure_ascii=False) for r in recipes]
with open(args.out, "w", encoding="utf-8", newline="\n") as out:
    out.write("[\n" + ",\n".join(rows) + "\n]\n")
print(len(entries), "entrades →", len(recipes), "receptes;", sum(1 for r in recipes if r["receta"]), "amb enllaç")
print(collections.Counter(r["_tipo"] for r in recipes))

index = {r["_key"]: i for i, r in enumerate(recipes)}
if args.map_from:
    # Llavor de la v1.18.0 → índex de la recepta nova (-1 si s'ha tret). Clau: firma FNV-1a de
    # "titulo\nalimentos\nreceta", la mateixa que calcula seedSignature() a planificacion.js.
    old = json.load(open(args.map_from[0], encoding="utf-8"))
    mapping = {}
    for o in old:
        sig = fnv1a(f'{o["titulo"]}\n{o["alimentos"]}\n{o.get("receta", "")}')
        assert sig not in mapping, f"firma repetida: {o['titulo']}"
        mapping[sig] = index.get(merge_key(tidy_title(o["titulo"])), -1)
    with open(args.map_from[1], "w", encoding="utf-8", newline="\n") as out:
        json.dump(mapping, out, separators=(",", ":"), sort_keys=True)
        out.write("\n")
    lost = [o["titulo"] for o in old if mapping[fnv1a(f'{o["titulo"]}\n{o["alimentos"]}\n{o.get("receta", "")}')] < 0]
    print(len(old), "receptes de la v1.18.0;", len(set(mapping.values()) - {-1}), "receptes noves;", len(lost), "tretes:", lost)

if args.review:
    merged = sorted((r for r in recipes if len(r["_titulos"]) > 1), key=lambda r: fold(r["titulo"]))
    with open(args.review, "w", encoding="utf-8", newline="\n") as out:
        out.write(f"# Revisión de las recetas\n\n{len(recipes)} recetas. Se quitan: {', '.join(dropped) or 'ninguna'}.\n\n")
        out.write(f"## Fusiones ({len(merged)})\n\nTítulo que queda ← títulos que se juntan con él (veces en los planes).\n\n")
        for r in merged:
            others = ", ".join(f"{t} ({n})" for t, n in r["_titulos"].most_common() if t != r["titulo"])
            out.write(f"- **{r['titulo']}** ← {others}\n")
        out.write("\n## Recetas reescritas a mano\n\n")
        for r in recipes:
            if fold(r["titulo"]) in RECIPE_OVERRIDES:
                out.write(f"- **{r['titulo']}**: {r['alimentos'].replace(chr(10), ' · ')}" + (f" — _{r['nota']}_" if r["nota"] else "") + "\n")
