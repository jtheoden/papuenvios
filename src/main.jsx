import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

if (rootElement.innerHTML.trim() !== '') {
  rootElement.innerHTML = '';
}
// DEBUG ONLY
console.log("[ENV] VITE_SUPABASE_URL =", import.meta.env.VITE_SUPABASE_URL);
console.log("[ENV] VITE_SUPABASE_ANON_KEY set? =", Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY));
console.log("[ENV] MODE =", import.meta.env.MODE);


ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
