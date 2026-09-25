import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App.jsx';
import { AuthProvider } from './lib/authContext.jsx';
import { AlertProvider } from './lib/alerts/alertContext.jsx';
import { NotificationsProvider } from './lib/notifications/notificationsContext.jsx';
import './styles/global.css';

// AuthProvider → AlertProvider → NotificationsProvider: the notifications context
// reads `user` (auth) and pushes "you have new notifications" via useAlerts, so it
// sits inside both.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AlertProvider>
          <NotificationsProvider>
            <App />
          </NotificationsProvider>
        </AlertProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
