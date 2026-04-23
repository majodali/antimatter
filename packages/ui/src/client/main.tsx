import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { subscribeToActivityStream } from './stores/activityStore';
import './styles/globals.css';

// Subscribe to the worker's activity-event broadcast as soon as the app boots.
// Idempotent; safe under React strict-mode double-mount.
subscribeToActivityStream();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
