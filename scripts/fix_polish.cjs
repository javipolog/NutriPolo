// Polish pass: fixes remaining text-white in non-button contexts
const fs = require('fs');
const path = require('path');

function fixFile(filePath, fixes) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = 0;
  for (const [from, to, flags] of fixes) {
    const before = content;
    if (flags === 'g') {
      content = content.split(from).join(to);
    } else {
      content = content.replace(from, to);
    }
    if (content !== before) changed++;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`${path.basename(filePath)}: ${changed} fixes applied`);
}

const base = 'C:/Dev/PoloTrack/src/components';

// ======================== RulesManager.jsx ========================
fixFile(`${base}/RulesManager.jsx`, [
  // All bg-sand-100 or bg-white input fields with text-white
  ['bg-sand-100 border border-sand-300 text-white px-3 py-2 rounded-button', 'bg-sand-100 border border-sand-300 text-sand-900 px-3 py-2 rounded-button', 'g'],
  ['bg-white border border-sand-300 text-white px-3 py-2 rounded-button', 'bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button', 'g'],
  // Rule name
  ['<span className="text-white text-sm font-semibold">', '<span className="text-sand-900 text-sm font-semibold">', 'g'],
  // "per ordre" strong
  ['<strong className="text-white">per ordre', '<strong className="text-sand-900">per ordre', 'g'],
  // Action tag color for proveedor (the only one with text-white)
  ["{ label: act.proveedor, color: 'text-white' }", "{ label: act.proveedor, color: 'text-sand-900' }", 'g'],
]);

// ======================== ClientsView.jsx ========================
fixFile(`${base}/ClientsView.jsx`, [
  ['"text-white font-semibold">{formatCurrency', '"text-sand-900 font-semibold">{formatCurrency', 'g'],
  ['<h3 className="text-white font-medium', '<h3 className="text-sand-900 font-medium', 'g'],
]);

// ======================== DesignEditor.jsx ========================
fixFile(`${base}/DesignEditor.jsx`, [
  // Text inputs on white bg
  ['text-xs text-white font-mono outline-none focus:border-terra-400 transition-colors" />', 'text-xs text-sand-900 font-mono outline-none focus:border-terra-400 transition-colors" />', 'g'],
  // NumberStepper buttons hover
  ['hover:text-white transition-colors p-0.5', 'hover:text-sand-700 transition-colors p-0.5', 'g'],
  // NumberStepper input center value
  ['text-white text-sm text-center outline-none', 'text-sand-900 text-sm text-center outline-none', 'g'],
  // Font select
  ['text-white text-sm px-3 py-2 rounded-button outline-none focus:border-terra-400 transition-colors appearance-none cursor-pointer', 'text-sand-900 text-sm px-3 py-2 rounded-button outline-none focus:border-terra-400 transition-colors appearance-none cursor-pointer', 'g'],
  // Toggle label group-hover
  ['group-hover:text-white transition-colors', 'group-hover:text-sand-800 transition-colors', 'g'],
  // Segment inactive hover
  ["'text-sand-600 hover:text-white'", "'text-sand-600 hover:text-sand-800'", 'g'],
  // Tab active bg-sand-200 text-white
  ["'bg-sand-200 text-white shadow'", "'bg-sand-200 text-sand-900 shadow'", 'g'],
  // Label editor input
  ['text-xs text-white outline-none focus:border-terra-400 transition-colors" />', 'text-xs text-sand-900 outline-none focus:border-terra-400 transition-colors" />', 'g'],
  // Logo text input
  ['text-white text-sm outline-none focus:border-terra-400 transition-colors" />', 'text-sand-900 text-sm outline-none focus:border-terra-400 transition-colors" />', 'g'],
  // SVG textarea
  ['text-white text-xs font-mono outline-none focus:border-terra-400 transition-colors resize-none"', 'text-sand-900 text-xs font-mono outline-none focus:border-terra-400 transition-colors resize-none"', 'g'],
  // Font sizes input
  ['text-xs text-white font-mono outline-none focus:border-terra-400 transition-colors" />', 'text-xs text-sand-900 font-mono outline-none focus:border-terra-400 transition-colors" />', 'g'],
  // Table style button active: bg-blue-500/8 → terra
  ["'border-terra-400 bg-blue-500/8 text-white'", "'border-terra-400 bg-terra-50 text-sand-900'", 'g'],
  // hover:border-slate-500 stale
  ["hover:border-slate-500'", "hover:border-sand-400'", 'g'],
  // Ampliar hover
  ['text-sand-600 hover:text-white transition-colors">', 'text-sand-600 hover:text-sand-800 transition-colors">', 'g'],
  // Logo type button inactive hover
  ["'text-sand-600 hover:text-white'`}>", "'text-sand-600 hover:text-sand-800'`}>", 'g'],
  // Icon container blue gradient
  ['bg-gradient-to-br from-blue-600 to-blue-700', 'bg-terra-400', 'g'],
]);

// ======================== TaxesView.jsx ========================
fixFile(`${base}/TaxesView.jsx`, [
  // Blue gradient icon container
  ['bg-gradient-to-br from-blue-600 to-blue-700', 'bg-terra-400', 'g'],
  // Violet gradient icon container
  ['bg-gradient-to-br from-violet-600 to-violet-700', 'bg-info', 'g'],
  // Quarter text: not current = text-white
  ["isCurrent ? 'text-terra-300' : 'text-white'", "isCurrent ? 'text-terra-500' : 'text-sand-800'", 'g'],
  // Modelo100 ingresos color
  ["{ label: 'Ingresos brutos', value: modelo100.ingresos, color: 'text-white' }", "{ label: 'Ingresos brutos', value: modelo100.ingresos, color: 'text-sand-900' }", 'g'],
  // Tab inactive hover
  ["'text-sand-600 hover:text-white'}`}>", "'text-sand-600 hover:text-sand-800'}`}>", 'g'],
  // Quarter date text
  ['<p className="text-white font-semibold mt-1">', '<p className="text-sand-900 font-semibold mt-1">', 'g'],
]);

// ======================== NotionSync.jsx ========================
fixFile(`${base}/NotionSync.jsx`, [
  ['<h3 className="text-white font-medium">', '<h3 className="text-sand-900 font-medium">', 'g'],
  ['text-sand-600 hover:text-white"', 'text-sand-600 hover:text-sand-700"', 'g'],
]);

// ======================== SettingsView.jsx ========================
fixFile(`${base}/SettingsView.jsx`, [
  ['font-medium text-white mb-1">Exportar datos', 'font-medium text-sand-900 mb-1">Exportar datos', 'g'],
  ['font-medium text-white mb-1">Importar datos', 'font-medium text-sand-900 mb-1">Importar datos', 'g'],
  // Theme card hover (not on colored bg)
  ["hover:border-sand-400 hover:text-white'", "hover:border-sand-400 hover:text-sand-900'", 'g'],
]);

// ======================== ExpensesView.jsx ========================
fixFile(`${base}/ExpensesView.jsx`, [
  // Page heading
  ['font-extrabold text-white tracking-tight', 'font-extrabold text-sand-900 tracking-tight', 'g'],
  // Button hover (watchfolder active/inactive)
  ["hover:bg-sand-200 hover:text-white'", "hover:bg-sand-200 hover:text-sand-800'", 'g'],
  // Search input
  ['text-white pl-10 pr-4 py-2 rounded-soft', 'text-sand-900 pl-10 pr-4 py-2 rounded-soft', 'g'],
  // Year select background
  ['bg-transparent text-white text-sm px-3 py-1 outline-none cursor-pointer hover:bg-sand-200', 'bg-transparent text-sand-800 text-sm px-3 py-1 outline-none cursor-pointer hover:bg-sand-200', 'g'],
  // Period filter select
  ['bg-transparent text-white text-sm px-3 py-1 outline-none cursor-pointer hover:bg-sand-200 transition-colors appearance-none font-medium">', 'bg-transparent text-sand-800 text-sm px-3 py-1 outline-none cursor-pointer hover:bg-sand-200 transition-colors appearance-none font-medium">', 'g'],
  // Category select
  ['text-white text-sm px-4 py-2 rounded-soft outline-none', 'text-sand-900 text-sm px-4 py-2 rounded-soft outline-none', 'g'],
  // GroupBy select
  ['text-white text-sm outline-none cursor-pointer appearance-none font-medium py-1">', 'text-sand-800 text-sm outline-none cursor-pointer appearance-none font-medium py-1">', 'g'],
  // Option elements: bg-white text-white → bg-white text-sand-900 (across all options)
  ['className="bg-white text-white"', 'className="bg-white text-sand-900"', 'g'],
  // Provider cell
  ['"text-white font-semibold">{exp.proveedor}', '"text-sand-900 font-semibold">{exp.proveedor}', 'g'],
  // PDF link hover
  ['hover:text-white" : ""}}\n', 'hover:text-terra-500" : ""}}\n', 'g'],
  // Fallback for different whitespace
  ['hover:text-white"', 'hover:text-terra-500"', 'g'],
  // Total cell
  ['"text-white font-bold font-mono', '"text-sand-900 font-bold font-mono', 'g'],
  // Edit button hover
  ['text-sand-600 hover:text-white hover:bg-sand-200"', 'text-sand-600 hover:text-sand-800 hover:bg-sand-200"', 'g'],
  // Form totals
  ['"text-white text-sm font-medium">TOTAL GASTO', '"text-sand-900 text-sm font-medium">TOTAL GASTO', 'g'],
  ['"text-white text-xl font-black"', '"text-sand-900 text-xl font-black"', 'g'],
  // Cancel buttons hover
  ['hover:text-white">Cancelar', 'hover:text-sand-800">Cancelar', 'g'],
  // Import total
  ['"text-lg font-black text-white', '"text-lg font-black text-sand-900', 'g'],
  // CIF inline input
  ['text-white outline-none focus:border-terra-400 font-mono"\n', 'text-sand-900 outline-none focus:border-terra-400 font-mono"\n', 'g'],
  // Concepto inline input
  ['text-white outline-none focus:border-terra-400"\n', 'text-sand-900 outline-none focus:border-terra-400"\n', 'g'],
  // Rule suggestion strong
  ['<strong className="text-white">', '<strong className="text-sand-900">', 'g'],
  // hover:bg-blue-500 on Guardar button → terra
  ['className="bg-terra-400 hover:bg-blue-500 shadow-lg shadow-blue-900/20 px-6"', 'className="bg-terra-400 hover:bg-terra-500 shadow-card-hover px-6"', 'g'],
  // Another hover:bg-blue-500
  ['className="bg-terra-400 hover:bg-blue-500">', 'className="bg-terra-400 hover:bg-terra-500">', 'g'],
]);

// ======================== SendInvoiceModal.jsx ========================
fixFile(`${base}/SendInvoiceModal.jsx`, [
  // PDF path display
  ['text-xs text-white font-mono truncate bg-white', 'text-xs text-sand-700 font-mono truncate bg-white', 'g'],
  // Copy button hover
  ['text-sand-500 hover:text-white hover:bg-sand-200', 'text-sand-500 hover:text-sand-700 hover:bg-sand-200', 'g'],
  // Lang tab active
  ["'bg-sand-200 text-white'", "'bg-sand-200 text-sand-900'", 'g'],
  // Email/subject/body inputs
  ['border-sand-300 text-white px-3 py-2.5 rounded-button', 'border-sand-300 text-sand-900 px-3 py-2.5 rounded-button', 'g'],
  ['border text-white px-3 py-2.5 rounded-button', 'border text-sand-900 px-3 py-2.5 rounded-button', 'g'],
]);

// ======================== Invoices.jsx ========================
fixFile(`${base}/Invoices.jsx`, [
  // Tab hover fixes (may still be present)
  ["'bg-terra-400 text-white' : 'text-sand-600 hover:text-white'}`}>", "'bg-terra-400 text-white' : 'text-sand-600 hover:text-sand-800'}`}>", 'g'],
  ["'bg-purple-600 text-white' : 'text-sand-600 hover:text-white'}`}>", "'bg-purple-600 text-white' : 'text-sand-600 hover:text-sand-800'}`}>", 'g'],
]);

console.log('\nAll polish fixes complete!');
