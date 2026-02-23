files = [
    r"C:\Dev\PoloTrack\src\components\ExpensesView.jsx",
    r"C:\Dev\PoloTrack\src\components\ClientsView.jsx",
    r"C:\Dev\PoloTrack\src\components\TaxesView.jsx",
    r"C:\Dev\PoloTrack\src\components\SettingsView.jsx",
    r"C:\Dev\PoloTrack\src\components\DesignEditor.jsx",
    r"C:\Dev\PoloTrack\src\components\CommandPalette.jsx",
]

# Check which files exist
import os
files = [f for f in files if os.path.exists(f)]

replacements = [
    # Backgrounds
    ("bg-slate-950", "bg-sand-50"),
    ("bg-slate-900/90", "bg-white"),
    ("bg-slate-900/80", "bg-white"),
    ("bg-slate-900/70", "bg-white"),
    ("bg-slate-900/60", "bg-white"),
    ("bg-slate-900/50", "bg-white"),
    ("bg-slate-900/40", "bg-white"),
    ("bg-slate-900/30", "bg-sand-50"),
    ("bg-slate-900/20", "bg-sand-50"),
    ("bg-slate-900", "bg-white"),
    ("bg-slate-800/80", "bg-sand-100"),
    ("bg-slate-800/70", "bg-sand-100"),
    ("bg-slate-800/60", "bg-sand-100"),
    ("bg-slate-800/50", "bg-sand-100"),
    ("bg-slate-800/40", "bg-sand-100"),
    ("bg-slate-800/30", "bg-sand-50"),
    ("bg-slate-800/20", "bg-sand-50"),
    ("bg-slate-800", "bg-sand-100"),
    ("bg-slate-700/60", "bg-sand-200"),
    ("bg-slate-700/50", "bg-sand-100"),
    ("bg-slate-700/40", "bg-sand-100"),
    ("bg-slate-700/30", "bg-sand-50"),
    ("bg-slate-700", "bg-sand-200"),
    ("bg-slate-600", "bg-sand-300"),
    # Borders
    ("border-slate-800/50", "border-sand-200"),
    ("border-slate-800", "border-sand-300"),
    ("border-slate-700/50", "border-sand-200"),
    ("border-slate-700", "border-sand-300"),
    ("border-slate-600", "border-sand-400"),
    # Dividers
    ("divide-slate-800/50", "divide-sand-200"),
    ("divide-slate-700", "divide-sand-200"),
    # Text
    ("text-slate-100", "text-sand-900"),
    ("text-slate-200", "text-sand-800"),
    ("text-slate-300", "text-sand-700"),
    ("text-slate-400", "text-sand-600"),
    ("text-slate-500", "text-sand-500"),
    ("text-slate-600", "text-sand-400"),
    # Blue primary actions
    ("bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20", "bg-terra-400 hover:bg-terra-500 text-white shadow-sm"),
    ("bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25", "bg-terra-400 hover:bg-terra-500 text-white shadow-sm"),
    ("bg-blue-600 hover:bg-blue-700 text-white", "bg-terra-400 hover:bg-terra-500 text-white"),
    ("bg-blue-600 hover:bg-blue-700", "bg-terra-400 hover:bg-terra-500"),
    ("shadow-blue-600/25", "shadow-sm"),
    ("shadow-blue-600/20", "shadow-sm"),
    ("bg-blue-600", "bg-terra-400"),
    ("bg-blue-500/20", "bg-terra-50"),
    ("bg-blue-500/10", "bg-terra-50"),
    ("text-blue-400", "text-terra-400"),
    ("text-blue-300", "text-terra-300"),
    ("text-blue-200", "text-terra-200"),
    ("border-blue-500/40", "border-terra-200"),
    ("border-blue-500/30", "border-terra-200"),
    ("border-blue-500/20", "border-terra-200"),
    ("border-blue-500", "border-terra-400"),
    ("focus:border-blue-500", "focus:border-terra-400"),
    ("focus:ring-blue-500/10", "focus:ring-terra-400/10"),
    ("focus:ring-blue-500", "focus:ring-terra-400"),
    # Semantic - emerald/success
    ("bg-emerald-900/50", "bg-success-light"),
    ("bg-emerald-900/40", "bg-success-light"),
    ("bg-emerald-600 hover:bg-emerald-700 text-white", "bg-success hover:bg-success-dark text-white"),
    ("bg-emerald-600", "bg-success"),
    ("text-emerald-400", "text-success"),
    ("text-emerald-300", "text-success"),
    ("border-emerald-700", "border-success/20"),
    # Semantic - amber/warning
    ("bg-amber-900/50", "bg-warning-light"),
    ("bg-amber-900/40", "bg-warning-light"),
    ("text-amber-400", "text-warning"),
    ("text-amber-300", "text-warning"),
    ("text-amber-200", "text-warning-dark"),
    ("border-amber-700", "border-warning/20"),
    # Semantic - red/danger
    ("bg-red-900/50", "bg-danger-light"),
    ("bg-red-900/40", "bg-danger-light"),
    ("bg-red-600 hover:bg-red-700 text-white", "bg-danger hover:bg-danger-dark text-white"),
    ("bg-red-600", "bg-danger"),
    ("text-red-400", "text-danger"),
    ("text-red-300", "text-danger"),
    ("border-red-700", "border-danger/20"),
    # Semantic - purple
    ("bg-purple-900/50", "bg-purple-50"),
    ("text-purple-300", "text-purple-700"),
    ("border-purple-700", "border-purple-200"),
    # Semantic - orange
    ("bg-orange-900/50", "bg-orange-50"),
    ("text-orange-300", "text-orange-700"),
    ("border-orange-700", "border-orange-200"),
    # Rounded
    ("rounded-2xl", "rounded-soft"),
    ("rounded-xl", "rounded-soft"),
    ("rounded-lg", "rounded-button"),
    # Hover
    ("hover:bg-slate-800/30", "hover:bg-sand-50"),
    ("hover:bg-slate-800/50", "hover:bg-sand-100"),
    ("hover:bg-slate-800", "hover:bg-sand-100"),
    ("hover:bg-slate-700", "hover:bg-sand-200"),
    # Additional patterns
    ("placeholder-slate-500", "placeholder-sand-500"),
    ("placeholder-slate-400", "placeholder-sand-500"),
    ("bg-black/70", "bg-black/40"),
    ("backdrop-blur-sm", "backdrop-blur-[2px]"),
]

for filepath in files:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original = content
        for old, new in replacements:
            content = content.replace(old, new)
        
        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Updated: {filepath}")
        else:
            print(f"No changes: {filepath}")
    except Exception as e:
        print(f"Error processing {filepath}: {e}")

print("Done!")
