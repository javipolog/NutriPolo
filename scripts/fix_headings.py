import os
import glob

base_dir = r"C:\Dev\PoloTrack\src\components"
files = glob.glob(os.path.join(base_dir, "*.jsx"))

base_replacements = [
    ("bg-slate-950", "bg-sand-50"),
    ("bg-slate-900/90", "bg-white"), ("bg-slate-900/80", "bg-white"),
    ("bg-slate-900/70", "bg-white"), ("bg-slate-900/60", "bg-white"),
    ("bg-slate-900/50", "bg-white"), ("bg-slate-900/40", "bg-white"),
    ("bg-slate-900/30", "bg-sand-50"), ("bg-slate-900/20", "bg-sand-50"),
    ("bg-slate-900", "bg-white"),
    ("bg-slate-800/80", "bg-sand-100"), ("bg-slate-800/70", "bg-sand-100"),
    ("bg-slate-800/60", "bg-sand-100"), ("bg-slate-800/50", "bg-sand-100"),
    ("bg-slate-800/40", "bg-sand-100"), ("bg-slate-800/30", "bg-sand-50"),
    ("bg-slate-800/20", "bg-sand-50"), ("bg-slate-800", "bg-sand-100"),
    ("bg-slate-700/60", "bg-sand-200"), ("bg-slate-700/50", "bg-sand-100"),
    ("bg-slate-700/40", "bg-sand-100"), ("bg-slate-700/30", "bg-sand-50"),
    ("bg-slate-700", "bg-sand-200"), ("bg-slate-600", "bg-sand-300"),
    ("border-slate-800/50", "border-sand-200"), ("border-slate-800", "border-sand-300"),
    ("border-slate-700/50", "border-sand-200"), ("border-slate-700", "border-sand-300"),
    ("border-slate-600", "border-sand-400"),
    ("divide-slate-800/50", "divide-sand-200"), ("divide-slate-700", "divide-sand-200"),
    ("text-slate-100", "text-sand-900"), ("text-slate-200", "text-sand-800"),
    ("text-slate-300", "text-sand-700"), ("text-slate-400", "text-sand-600"),
    ("text-slate-500", "text-sand-500"), ("text-slate-600", "text-sand-400"),
    ("bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20", "bg-terra-400 hover:bg-terra-500 text-white shadow-sm"),
    ("bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25", "bg-terra-400 hover:bg-terra-500 text-white shadow-sm"),
    ("bg-blue-600 hover:bg-blue-700 text-white", "bg-terra-400 hover:bg-terra-500 text-white"),
    ("bg-blue-600 hover:bg-blue-700", "bg-terra-400 hover:bg-terra-500"),
    ("shadow-blue-600/25", "shadow-sm"), ("shadow-blue-600/20", "shadow-sm"),
    ("bg-blue-600", "bg-terra-400"), ("bg-blue-500/20", "bg-terra-50"),
    ("bg-blue-500/10", "bg-terra-50"), ("text-blue-400", "text-terra-400"),
    ("text-blue-300", "text-terra-300"), ("text-blue-200", "text-terra-200"),
    ("border-blue-500/40", "border-terra-200"), ("border-blue-500/30", "border-terra-200"),
    ("border-blue-500/20", "border-terra-200"), ("border-blue-500", "border-terra-400"),
    ("focus:border-blue-500", "focus:border-terra-400"),
    ("focus:ring-blue-500/10", "focus:ring-terra-400/10"),
    ("focus:ring-blue-500", "focus:ring-terra-400"),
    ("bg-emerald-900/50", "bg-success-light"), ("bg-emerald-900/40", "bg-success-light"),
    ("bg-emerald-600 hover:bg-emerald-700 text-white", "bg-success hover:bg-success-dark text-white"),
    ("bg-emerald-600", "bg-success"),
    ("text-emerald-400", "text-success"), ("text-emerald-300", "text-success"),
    ("border-emerald-700", "border-success/20"),
    ("bg-amber-900/50", "bg-warning-light"), ("bg-amber-900/40", "bg-warning-light"),
    ("text-amber-400", "text-warning"), ("text-amber-300", "text-warning"),
    ("text-amber-200", "text-warning-dark"), ("border-amber-700", "border-warning/20"),
    ("bg-red-900/50", "bg-danger-light"), ("bg-red-900/40", "bg-danger-light"),
    ("bg-red-600 hover:bg-red-700 text-white", "bg-danger hover:bg-danger-dark text-white"),
    ("bg-red-600", "bg-danger"),
    ("text-red-400", "text-danger"), ("text-red-300", "text-danger"),
    ("border-red-700", "border-danger/20"),
    ("bg-purple-900/50", "bg-purple-50"), ("text-purple-300", "text-purple-700"),
    ("border-purple-700", "border-purple-200"),
    ("bg-orange-900/50", "bg-orange-50"), ("text-orange-300", "text-orange-700"),
    ("border-orange-700", "border-orange-200"),
    ("rounded-2xl", "rounded-soft"), ("rounded-xl", "rounded-soft"), ("rounded-lg", "rounded-button"),
    ("hover:bg-slate-800/30", "hover:bg-sand-50"), ("hover:bg-slate-800/50", "hover:bg-sand-100"),
    ("hover:bg-slate-800", "hover:bg-sand-100"), ("hover:bg-slate-700", "hover:bg-sand-200"),
    ("placeholder-slate-500", "placeholder-sand-500"), ("placeholder-slate-400", "placeholder-sand-500"),
    ("bg-black/70", "bg-black/40"), ("backdrop-blur-sm", "backdrop-blur-[2px]"),
]

heading_replacements = [
    ("text-3xl font-bold text-white", "font-serif text-display text-sand-900"),
    ("text-2xl font-bold text-white", "font-serif text-2xl font-bold text-sand-900"),
    ("text-xl font-bold text-white", "font-serif text-xl font-bold text-sand-900"),
    ("text-xl font-semibold text-white", "font-serif text-xl font-semibold text-sand-900"),
    ("text-lg font-bold text-white", "font-serif text-lg font-bold text-sand-900"),
    ("text-lg font-semibold text-white", "font-serif text-lg font-semibold text-sand-900"),
    ("text-sm font-medium text-white truncate", "text-sm font-medium text-sand-900 truncate"),
    ("font-semibold text-white", "font-semibold text-sand-900"),
    ("font-bold text-white", "font-bold text-sand-900"),
]

for filepath in files:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        original = content
        for old, new in base_replacements:
            content = content.replace(old, new)
        for old, new in heading_replacements:
            content = content.replace(old, new)
        content = content.replace("bg-terra-400 hover:bg-terra-500 text-sand-900", "bg-terra-400 hover:bg-terra-500 text-white")
        content = content.replace("bg-terra-400 hover:bg-terra-500 font-semibold text-sand-900", "bg-terra-400 hover:bg-terra-500 text-white font-medium")
        content = content.replace("bg-success hover:bg-success-dark text-sand-900", "bg-success hover:bg-success-dark text-white")
        content = content.replace("bg-danger hover:bg-danger-dark text-sand-900", "bg-danger hover:bg-danger-dark text-white")
        content = content.replace("bg-terra-400 text-sand-900", "bg-terra-400 text-white")
        if content != original:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Updated: {os.path.basename(filepath)}")
        else:
            print(f"No changes: {os.path.basename(filepath)}")
    except Exception as e:
        print(f"Error {filepath}: {e}")

print("Done!")
