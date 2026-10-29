import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// UI fonts are bundled so the app renders the same offline. Latin covers ES/CA/EN.
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-500.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/onest/latin-700.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
