/** @type {import('tailwindcss').Config} */
export default {
  // Follow the in-app theme (data-theme on <html>), not the OS setting.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'ui-serif', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        // Accent; channels defined in styles.css (light + dark)
        terra: {
          50: 'rgb(var(--terra-50) / <alpha-value>)',
          100: 'rgb(var(--terra-100) / <alpha-value>)',
          200: 'rgb(var(--terra-200) / <alpha-value>)',
          300: 'rgb(var(--terra-300) / <alpha-value>)',
          400: 'rgb(var(--terra-400) / <alpha-value>)',
          500: 'rgb(var(--terra-500) / <alpha-value>)',
          600: 'rgb(var(--terra-600) / <alpha-value>)',
          700: 'rgb(var(--terra-700) / <alpha-value>)',
          800: 'rgb(var(--terra-800) / <alpha-value>)',
          900: 'rgb(var(--terra-900) / <alpha-value>)',
        },
        // Semàntics
        success: {
          DEFAULT: '#2D7A4F',
          light:   '#E8F5EC',
          dark:    '#1A5C38',
        },
        // DEFAULT tones pass WCAG AA as text on their own -light tint
        warning: {
          DEFAULT: '#8F6A0A',
          light:   '#FFF8E1',
          dark:    '#6E5206',
        },
        danger: {
          DEFAULT: '#C13B3B',
          light:   '#FDECEC',
          dark:    '#9A2F2F',
        },
        info: {
          DEFAULT: '#3A6591',
          light:   '#EBF3FA',
          dark:    '#2C4F73',
        },
        // Theme-aware: channels defined in styles.css (light + dark)
        wellness: {
          50: 'rgb(var(--wellness-50) / <alpha-value>)',
          100: 'rgb(var(--wellness-100) / <alpha-value>)',
          200: 'rgb(var(--wellness-200) / <alpha-value>)',
          300: 'rgb(var(--wellness-300) / <alpha-value>)',
          400: 'rgb(var(--wellness-400) / <alpha-value>)',
          500: 'rgb(var(--wellness-500) / <alpha-value>)',
          600: 'rgb(var(--wellness-600) / <alpha-value>)',
          700: 'rgb(var(--wellness-700) / <alpha-value>)',
          800: 'rgb(var(--wellness-800) / <alpha-value>)',
          900: 'rgb(var(--wellness-900) / <alpha-value>)',
        },
        sage: {
          50: 'rgb(var(--sage-50) / <alpha-value>)',
          100: 'rgb(var(--sage-100) / <alpha-value>)',
          200: 'rgb(var(--sage-200) / <alpha-value>)',
          300: 'rgb(var(--sage-300) / <alpha-value>)',
          400: 'rgb(var(--sage-400) / <alpha-value>)',
          500: 'rgb(var(--sage-500) / <alpha-value>)',
          600: 'rgb(var(--sage-600) / <alpha-value>)',
          700: 'rgb(var(--sage-700) / <alpha-value>)',
          800: 'rgb(var(--sage-800) / <alpha-value>)',
          900: 'rgb(var(--sage-900) / <alpha-value>)',
          950: 'rgb(var(--sage-950) / <alpha-value>)',
        },
      },
      borderRadius: {
        'soft':   '8px',
        'button': '6px',
        'badge':  '4px',
      },
      boxShadow: {
        'card':       '0 1px 2px rgba(28,27,24,0.05)',
        'card-hover': '0 4px 12px rgba(26,25,21,0.08), 0 2px 4px rgba(26,25,21,0.04)',
        'modal':      '0 20px 60px rgba(26,25,21,0.15), 0 4px 16px rgba(26,25,21,0.08)',
        'toast':      '0 4px 16px rgba(26,25,21,0.12)',
        'sidebar':    '1px 0 0 0 rgb(var(--sage-300))',
        'sticky-col': '-4px 0 6px -2px rgba(26,25,21,0.06)',
      },
      fontSize: {
        'display':    ['2rem',    { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        'title':      ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],  // page <h1>
        'heading':    ['1.5rem',  { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        'subheading': ['1.125rem',{ lineHeight: '1.4', fontWeight: '600' }],
      },
      // Keyframes and .animate-* classes live in styles.css
    },
  },
  plugins: [],
}
