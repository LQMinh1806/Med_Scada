import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SnackbarProvider } from 'notistack';
import { NotificationProvider } from './contexts/NotificationContext';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SnackbarProvider
      maxSnack={4}
      autoHideDuration={4000}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      preventDuplicate
    >
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </SnackbarProvider>
  </StrictMode>
);
