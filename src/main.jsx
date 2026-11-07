import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from '@/App';
import '@/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

// #root holds the static splash from index.html; createRoot replaces it on the first commit (no blank frame).

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/* framer-motion honours prefers-reduced-motion app-wide: transform/layout animations are skipped */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>
);
