// Polish pass 2: fix remaining legacy blue/slate colors
const fs = require('fs');
const path = require('path');

function fixFile(filePath, fixes) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = 0;
  for (const [from, to] of fixes) {
    const before = content;
    content = content.split(from).join(to);
    if (content !== before) changed++;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`${path.basename(filePath)}: ${changed} fixes applied`);
}

const base = 'C:/Dev/PoloTrack/src/components';

// ======================== TaxesView.jsx ========================
fixFile(`${base}/TaxesView.jsx`, [
  // Active row highlight on light bg (blue-900/20 → terra tint)
  ["'bg-blue-900/20' : 'hover:bg-sand-50'", "'bg-terra-50' : 'hover:bg-sand-50'"],
  // Active quarter card (blue-900/30 → terra tint)
  ["'bg-blue-900/30 border-blue-700'", "'bg-terra-50 border-terra-300'"],
]);

// ======================== Invoices.jsx ========================
fixFile(`${base}/Invoices.jsx`, [
  // Recurring alert banner (blue → terra/warning tones)
  ['bg-blue-900/30 border border-blue-700/50', 'bg-terra-50 border border-terra-300'],
  // Generar template button
  ['bg-blue-700 hover:bg-terra-400', 'bg-terra-400 hover:bg-terra-500'],
  // Preview send button
  ['bg-terra-400 hover:bg-blue-500">\n                                Enviar', 'bg-terra-400 hover:bg-terra-500">\n                                Enviar'],
]);

// ======================== SendInvoiceModal.jsx ========================
fixFile(`${base}/SendInvoiceModal.jsx`, [
  // Tancar button
  ['bg-terra-400 hover:bg-blue-500" size="sm">', 'bg-terra-400 hover:bg-terra-500" size="sm">'],
  // Send button
  ["'bg-terra-400 hover:bg-blue-500 shadow-lg shadow-blue-900/20'", "'bg-terra-400 hover:bg-terra-500 shadow-card-hover'"],
  // Info note tint
  ['bg-blue-500/5 border border-terra-400/15', 'bg-terra-50/30 border border-terra-300/30'],
]);

// ======================== RulesManager.jsx ========================
fixFile(`${base}/RulesManager.jsx`, [
  // "Otros" category bg
  ["bg: 'bg-slate-500/10',   text: 'text-sand-600',   dot: 'bg-slate-400'", "bg: 'bg-sand-100',   text: 'text-sand-600',   dot: 'bg-sand-400'"],
  // getCatColor fallback
  ["|| { bg: 'bg-slate-500/10', text: 'text-sand-600', dot: 'bg-slate-400' }", "|| { bg: 'bg-sand-100', text: 'text-sand-600', dot: 'bg-sand-400' }"],
  // Software category dot
  ["dot: 'bg-blue-400'", "dot: 'bg-info'"],
  // Keyword badge (bg-blue-500/15)
  ['bg-blue-500/15 text-terra-400 border border-terra-400/25', 'bg-terra-50 text-terra-500 border border-terra-300'],
  // Guardar regla button
  ['bg-terra-400 hover:bg-blue-500 px-5', 'bg-terra-400 hover:bg-terra-500 px-5'],
  // Help panel
  ['bg-blue-500/8 border border-terra-400/15', 'bg-terra-50/50 border border-terra-300/30'],
  // Tancar rules button
  ['bg-terra-400 hover:bg-blue-500 px-6', 'bg-terra-400 hover:bg-terra-500 px-6'],
]);

// ======================== DesignEditor.jsx ========================
fixFile(`${base}/DesignEditor.jsx`, [
  // Active section card
  ["border-terra-400 bg-blue-500/8'", "border-terra-400 bg-terra-50'"],
]);

// ======================== ExpensesView.jsx ========================
fixFile(`${base}/ExpensesView.jsx`, [
  // Nuevo Gasto button
  ['bg-terra-400 hover:bg-blue-500 shadow-lg shadow-blue-900/20">\n                        Nuevo Gasto', 'bg-terra-400 hover:bg-terra-500 shadow-card-hover">\n                        Nuevo Gasto'],
  // Precision button active
  ["'bg-blue-500/15 border-terra-200 text-terra-400'", "'bg-terra-50 border-terra-300 text-terra-500'"],
  // Precision button inactive hover
  ["'bg-sand-100 border-sand-300 text-sand-600 hover:text-terra-400 hover:border-terra-200 hover:bg-blue-500/8'", "'bg-sand-100 border-sand-300 text-sand-600 hover:text-terra-400 hover:border-terra-300 hover:bg-terra-50'"],
  // Activity "new" dot
  ["activity.type === 'new' ? 'bg-blue-400' :", "activity.type === 'new' ? 'bg-info' :"],
  // Activity default dot
  ["'bg-slate-500'", "'bg-sand-400'"],
  // Group header chevron
  ['<ChevronRight className="text-blue-500"', '<ChevronRight className="text-terra-400"'],
  // Sort arrows active
  ["'opacity-100 text-blue-500' : ''", "'opacity-100 text-terra-400' : ''"],
  // Guardar button
  ['bg-terra-400 hover:bg-blue-500">Guardar Transacción', 'bg-terra-400 hover:bg-terra-500">Guardar Transacción'],
]);

console.log('\nPolish pass 2 complete!');
