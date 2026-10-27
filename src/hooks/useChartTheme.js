import { useEffect, useState } from 'react';

// Recharts takes colours as props, so the palette from styles.css is mirrored
// here for each theme. Series colours are lighter in dark mode to keep contrast.
const LIGHT = {
  primary: '#3E6B52', accent: '#C15F3C', info: '#3A6591',
  grid: '#E6E2D8', axis: '#75726A', cursor: '#F4F3EE',
  tooltipBg: '#FFFFFF', tooltipBorder: '#DEDAD0', tooltipText: '#1C1B18',
};
const DARK = {
  primary: '#8CCDA5', accent: '#E09A78', info: '#8DB8E8',
  grid: '#3E3C36', axis: '#918E85', cursor: '#302F2A',
  tooltipBg: '#262520', tooltipBorder: '#3E3C36', tooltipText: '#F0EDE6',
};

const isDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';

/** Chart colours for the current in-app theme; re-renders when the theme changes. */
export function useChartTheme() {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark ? DARK : LIGHT;
}
