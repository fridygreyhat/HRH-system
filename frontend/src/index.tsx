import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './AuthContext';
import { OfflineBanner, registerServiceWorker } from './pwa';
import '@fontsource-variable/inter';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <OfflineBanner />
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

registerServiceWorker();
