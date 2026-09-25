import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import AlertBannerStack from '../../components/ui/AlertBannerStack.jsx';

const AlertContext = createContext(null);

const AUTO_DISMISS_MS = {
  success: 6000,
  info: 6000,
  warning: 8000,
};

function createAlertId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Global alert provider. Push dismissable banners from any screen.
 */
export function AlertProvider({ children }) {
  const [alerts, setAlerts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissAlert = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }, []);

  const pushAlert = useCallback(({ type = 'info', title, message }) => {
    const text = String(message || '').trim();
    if (!text) return null;

    const alert = {
      id: createAlertId(),
      type,
      title: title ? String(title).trim() : '',
      message: text,
    };

    setAlerts((current) => [alert, ...current].slice(0, 6));

    const autoDismiss = AUTO_DISMISS_MS[type];
    if (autoDismiss) {
      const timer = setTimeout(() => dismissAlert(alert.id), autoDismiss);
      timersRef.current.set(alert.id, timer);
    }

    return alert.id;
  }, [dismissAlert]);

  const pushError = useCallback((message, title = 'Something went wrong') => {
    return pushAlert({ type: 'error', title, message });
  }, [pushAlert]);

  const pushSuccess = useCallback((message, title = 'Success') => {
    return pushAlert({ type: 'success', title, message });
  }, [pushAlert]);

  const pushWarning = useCallback((message, title = 'Warning') => {
    return pushAlert({ type: 'warning', title, message });
  }, [pushAlert]);

  const pushInfo = useCallback((message, title = '') => {
    return pushAlert({ type: 'info', title, message });
  }, [pushAlert]);

  const value = useMemo(
    () => ({ alerts, pushAlert, pushError, pushSuccess, pushWarning, pushInfo, dismissAlert }),
    [alerts, pushAlert, pushError, pushSuccess, pushWarning, pushInfo, dismissAlert]
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      <AlertBannerStack alerts={alerts} onDismiss={dismissAlert} />
    </AlertContext.Provider>
  );
}

export function useAlerts() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlerts must be used within AlertProvider');
  }
  return context;
}
