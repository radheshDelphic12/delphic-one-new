import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const TYPE_STYLES = {
  error: {
    wrap: 'border-danger-200 bg-danger-50 text-danger-900',
    icon: AlertCircle,
    iconClass: 'text-danger-600',
  },
  success: {
    wrap: 'border-success-200 bg-success-50 text-success-900',
    icon: CheckCircle2,
    iconClass: 'text-success-600',
  },
  warning: {
    wrap: 'border-warning-200 bg-warning-50 text-warning-900',
    icon: AlertTriangle,
    iconClass: 'text-warning-700',
  },
  info: {
    wrap: 'border-sky-200 bg-sky-50 text-sky-900',
    icon: Info,
    iconClass: 'text-sky-600',
  },
};

function AlertBanner({ alert, onDismiss }) {
  const [phase, setPhase] = useState('enter');
  const styles = TYPE_STYLES[alert.type] || TYPE_STYLES.info;
  const Icon = styles.icon;

  useEffect(() => {
    if (phase !== 'exit') return undefined;
    const timer = setTimeout(() => onDismiss(alert.id), 260);
    return () => clearTimeout(timer);
  }, [phase, alert.id, onDismiss]);

  function dismiss() {
    setPhase('exit');
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`alert-banner alert-banner--${phase} pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 shadow-card ${styles.wrap}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconClass}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {alert.title ? <p className="text-sm font-semibold">{alert.title}</p> : null}
          <p className={`text-sm ${alert.title ? 'mt-0.5' : ''}`}>{alert.message}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss alert"
          onClick={dismiss}
          className="rounded-lg p-1 text-current/60 transition-colors hover:bg-black/5 hover:text-current"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Fixed top-right stack of dismissable alert banners.
 */
export default function AlertBannerStack({ alerts, onDismiss }) {
  if (!alerts.length) return null;

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(100vw-2rem,24rem)] flex-col gap-2"
    >
      {alerts.map((alert) => (
        <AlertBanner key={alert.id} alert={alert} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
