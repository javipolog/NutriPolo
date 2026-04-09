/**
 * invoiceDesignPresets.js — NutriPolo
 * Presets de color, opciones de fuente y validacion para el diseno de facturas/planes.
 */

import { DEFAULT_INVOICE_DESIGN } from '../stores/store';

// ── Color presets ───────────────────────────────────────────
export const PRESETS = {
  terra: {
    label: 'Terra',
    colors: { ...DEFAULT_INVOICE_DESIGN.colors },
  },
  ocean: {
    label: 'Ocean',
    colors: {
      accent:      '#2E7D9B',
      accentDark:  '#1F6480',
      accentMid:   '#B4D6E4',
      accentLight: '#EAF4F8',
      primary:     '#141B1E',
      secondary:   '#3A4A52',
      muted:       '#5A6B73',
      cardBg:      '#F7FAFB',
    },
  },
  forest: {
    label: 'Forest',
    colors: {
      accent:      '#4A9960',
      accentDark:  '#357A48',
      accentMid:   '#B4DAC0',
      accentLight: '#EBF5EE',
      primary:     '#151A16',
      secondary:   '#3A4A3E',
      muted:       '#5A6B5E',
      cardBg:      '#F7FAF8',
    },
  },
  minimal: {
    label: 'Minimal',
    colors: {
      accent:      '#333333',
      accentDark:  '#1A1A1A',
      accentMid:   '#C8C8C8',
      accentLight: '#F0F0F0',
      primary:     '#111111',
      secondary:   '#444444',
      muted:       '#777777',
      cardBg:      '#FAFAFA',
    },
  },
};

// ── Font options ────────────────────────────────────────────
export const FONT_OPTIONS = [
  { id: 'worksans',   label: 'Work Sans' },
  { id: 'roboto',     label: 'Roboto' },
  { id: 'helvetica',  label: 'Helvetica (Estandar)' },
];

// ── Helpers ─────────────────────────────────────────────────
export function getPresetColors(presetId) {
  return PRESETS[presetId]?.colors ?? PRESETS.terra.colors;
}

export function validateDesign(design) {
  if (!design || typeof design !== 'object') return { ...DEFAULT_INVOICE_DESIGN };
  const base = DEFAULT_INVOICE_DESIGN;
  return {
    preset:      design.preset || base.preset,
    colors:      { ...base.colors, ...(design.colors || {}) },
    fontFamily:  design.fontFamily || base.fontFamily,
    logo:        design.logo && design.logo.data ? design.logo : null,
    showTagline: typeof design.showTagline === 'boolean' ? design.showTagline : base.showTagline,
    taglineText: design.taglineText || base.taglineText,
  };
}
