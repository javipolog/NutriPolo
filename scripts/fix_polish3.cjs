// Polish pass 3: semantic color alignment (emerald/red → success/danger tokens)
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
// Result cards use bg-red-900/30 (dark) on light background — fix to light semantic
fixFile(`${base}/TaxesView.jsx`, [
  ["'bg-red-900/30 border border-red-800'", "'bg-danger-light border border-danger/30'"],
  ["'bg-emerald-900/30 border border-emerald-800'", "'bg-success-light border border-success/30'"],
  ["'bg-red-900/20 border-red-800/50'", "'bg-danger-light border-danger/20'"],
  ["'bg-emerald-900/20 border-emerald-800/50'", "'bg-success-light border-success/20'"],
]);

// ======================== DesignEditor.jsx ========================
// Save button hover
fixFile(`${base}/DesignEditor.jsx`, [
  ["'bg-success hover:bg-emerald-500'", "'bg-success hover:bg-success-dark'"],
]);

// ======================== ExpensesView.jsx ========================
fixFile(`${base}/ExpensesView.jsx`, [
  // Delete selected button
  ['bg-danger hover:bg-red-500 shadow-lg shadow-red-900/20', 'bg-danger hover:bg-danger-dark'],
  // Watcher ping dots
  ['bg-emerald-400 opacity-75', 'bg-success opacity-75'],
  ['bg-emerald-500" />', 'bg-success" />'],
  // Activity dots
  ["activity.type === 'success' ? 'bg-emerald-400' :", "activity.type === 'success' ? 'bg-success' :"],
  ["activity.type === 'error' ? 'bg-red-400' :", "activity.type === 'error' ? 'bg-danger' :"],
  // Rule source badges
  ["cls: 'bg-emerald-500/20 text-success border-emerald-500/30', label: 'REGLA'", "cls: 'bg-success-light text-success border-success/30', label: 'REGLA'"],
  ["cls: 'bg-emerald-500/20 text-success border-emerald-500/30', label: 'CIF'", "cls: 'bg-success-light text-success border-success/30', label: 'CIF'"],
  // Rule applied indicator
  ['bg-emerald-500/8 border border-emerald-500/15 rounded-button', 'bg-success-light/50 border border-success/20 rounded-button'],
  // Coverage bar
  ["color: 'bg-emerald-500'", "color: 'bg-success'"],
  // "All good" banners
  ['bg-emerald-500/8 border border-emerald-500/15 px-3 py-2 rounded-button', 'bg-success-light/50 border border-success/20 px-3 py-2 rounded-button'],
  ['bg-emerald-500/8 border border-emerald-500/15 px-3 py-2.5 rounded-button', 'bg-success-light/50 border border-success/20 px-3 py-2.5 rounded-button'],
]);

// ======================== Invoices.jsx ========================
fixFile(`${base}/Invoices.jsx`, [
  // Payment button hover
  ['text-success hover:text-success hover:bg-emerald-500/10', 'text-success hover:text-success hover:bg-success-light/50'],
  // Delete hover
  ['text-danger hover:text-danger hover:bg-red-900/20', 'text-danger hover:text-danger hover:bg-danger-light/50'],
]);

// ======================== SendInvoiceModal.jsx ========================
fixFile(`${base}/SendInvoiceModal.jsx`, [
  // Status color map
  ["'bg-emerald-500/10 text-success border-emerald-500/20'", "'bg-success-light text-success border-success/20'"],
  ["'bg-red-500/10 text-danger border-red-500/20'", "'bg-danger-light text-danger border-danger/20'"],
  // Success state panel
  ['bg-emerald-500/10 border border-emerald-500/20 rounded-soft', 'bg-success-light border border-success/20 rounded-soft'],
  // Error state
  ['bg-red-500/10 border border-red-500/20 text-danger', 'bg-danger-light border border-danger/20 text-danger'],
]);

// ======================== NotionSync.jsx ========================
fixFile(`${base}/NotionSync.jsx`, [
  // Configured icon bg
  ['bg-emerald-500/20 rounded-button', 'bg-success-light rounded-button'],
  // Sync error
  ['bg-red-500/10 border border-red-500/30', 'bg-danger-light border border-danger/30'],
  // Test result panels
  ["'bg-emerald-500/10 border border-emerald-500/30'", "'bg-success-light border border-success/30'"],
  ["'bg-red-500/10 border border-red-500/30'", "'bg-danger-light border border-danger/30'"],
]);

// ======================== RulesManager.jsx ========================
fixFile(`${base}/RulesManager.jsx`, [
  // Transporte category dot
  ["text: 'text-success', dot: 'bg-emerald-400'", "text: 'text-success', dot: 'bg-success'"],
  // Error panel
  ['bg-red-500/10 border border-red-500/20 text-danger', 'bg-danger-light border border-danger/20 text-danger'],
  // Delete button hover
  ['hover:bg-red-500/10 text-sand-500', 'hover:bg-danger-light text-sand-500'],
  // Applied keywords badge
  ["'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 cursor-default'", "'text-success bg-success-light border border-success/20 cursor-default'"],
]);

// ======================== SettingsView.jsx ========================
fixFile(`${base}/SettingsView.jsx`, [
  // Shield icon bg
  ['bg-emerald-500/20 rounded-button', 'bg-success-light rounded-button'],
]);

// ======================== ExpensesView.jsx delete row hover ========================
// Already covered: hover:bg-red-900/20 in row delete button
fixFile(`${base}/ExpensesView.jsx`, [
  ['hover:text-danger hover:bg-red-900/20', 'hover:text-danger hover:bg-danger-light/50'],
]);

console.log('\nPolish pass 3 complete!');
