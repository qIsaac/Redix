import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/components.css';

const apiReady = import.meta.env.VITE_REDIX_DEMO === '1'
  ? import('./demo-api')
  : import('./tauri-api');

apiReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
