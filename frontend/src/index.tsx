import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './AuthContext';
import { InstallPrompt } from './pwa/InstallPrompt';
import { registerServiceWorker } from './pwa/register';
import '@fontsource-variable/inter';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <InstallPrompt />
    </AuthProvider>
  </React.StrictMode>
);

registerServiceWorker();
