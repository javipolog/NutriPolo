/** @type {import('tailwindcss').Config} */
export default {
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
        // Paleta càlida inspirada en Claude/Anthropic
        sand: {
          50:  '#FAF9F6',  // bg principal
          100: '#F4F3EE',  // surface (Pampas)
          200: '#EDEAE3',  // surface alt
          300: '#E8E5DD',  // border light
          400: '#D4D0C8',  // border
          500: '#B0AEA5',  // neutral (Cloudy)
          600: '#9C9A91',  // text muted
          700: '#65635B',  // text secondary
          800: '#3D3B35',  // dark surface border
          900: '#2A2923',  // dark surface
          950: '#1C1B18',  // dark bg
        },
        terra: {
          50:  '#FDF4EF',
          100: '#FADCC9',
          200: '#F0BFA0',
          300: '#D4845F',  // accent light
          400: '#C15F3C',  // accent principal (Crail)
          500: '#A84E30',  // accent hover
          600: '#8F4028',
          700: '#6B301E',
          800: '#4A2115',
          900: '#2D140D',
        },
        // Semàntics
        success: {
          DEFAULT: '#2D7A4F',
          light:   '#E8F5EC',
          dark:    '#1A5C38',
        },
        warning: {
          DEFAULT: '#B8860B',
          light:   '#FFF8E1',
          dark:    '#8B6508',
        },
        danger: {
          DEFAULT: '#C13B3B',
          light:   '#FDECEC',
          dark:    '#9A2F2F',
        },
        info: {
          DEFAULT: '#4A7FB5',
          light:   '#EBF3FA',
          dark:    '#3A6591',
        },
      },
      borderRadius: {
        'soft':   '8px',
        'button': '6px',
        'badge':  '4px',
      },
      boxShadow: {
        'card':       '0 1px 3px rgba(26,25,21,0.04), 0 1px 2px rgba(26,25,21,0.06)',
        'card-hover': '0 4px 12px rgba(26,25,21,0.08), 0 2px 4px rgba(26,25,21,0.04)',
        'modal':      '0 20px 60px rgba(26,25,21,0.15), 0 4px 16px rgba(26,25,21,0.08)',
        'toast':      '0 4px 16px rgba(26,25,21,0.12)',
        'sidebar':    '1px 0 0 0 #E8E5DD',
        'sticky-col': '-4px 0 6px -2px rgba(26,25,21,0.06)',
      },
      fontSize: {
        'display':    ['2rem',    { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        'heading':    ['1.5rem',  { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        'subheading': ['1.125rem',{ lineHeight: '1.4', fontWeight: '600' }],
      },
      keyframes: {
        fadeIn:       { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeInUp:     { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        scaleIn:      { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        slideIn:      { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { from: { transform: 'translateX(100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        slideOutRight:{ from: { transform: 'translateX(0)', opacity: '1' }, to: { transform: 'translateX(100%)', opacity: '0' } },
      },
      animation: {
        fadeIn:     'fadeIn 0.15s ease-out',
        fadeInUp:   'fadeInUp 0.2s ease-out',
        scaleIn:    'scaleIn 0.15s ease-out',
        slideIn:    'slideIn 0.15s ease-out',
        shake:      'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
}
