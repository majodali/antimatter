import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { eventLog } from './lib/eventLog';

// Global error handler
window.onerror = (_msg, _source, _line, _col, error) => {
  eventLog.error('system', 'Unhandled error', error?.stack ?? String(_msg));
};

window.addEventListener('unhandledrejection', (e) => {
  eventLog.error('system', 'Unhandled promise rejection', String(e.reason));
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

eventLog.info('system', 'IDE initialized');
