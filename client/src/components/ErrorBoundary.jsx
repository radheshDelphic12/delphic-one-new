import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import apiClient from '../lib/apiClient.js';

// One report per distinct error per page load, so a crash loop can't flood the API.
const reported = new Set();

function report(error, info) {
  const message = String(error?.message || error || 'Unknown error').slice(0, 2000);
  const key = `${window.location.pathname}|${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  apiClient
    .post('/client-errors', {
      message,
      stack: String(error?.stack || '').slice(0, 8000) || undefined,
      component_stack: String(info?.componentStack || '').slice(0, 8000) || undefined,
      url: `${window.location.pathname}${window.location.search}`.slice(0, 500),
      user_agent: navigator.userAgent.slice(0, 500),
    })
    .catch(() => {}); // Signed out or offline: the console still has it.
}

/**
 * Catches a render error so one broken page never blanks the whole app.
 * Shows what happened with Try again / Reload / Dashboard, and reports the
 * error (message + stacks) to the server log as `client_error`. `resetKey`
 * clears the error when it changes — pass the route, so navigating away
 * (or pressing Back) renders the next page normally.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack);
    report(error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const fullPage = this.props.fullPage;
    return (
      <div className={fullPage ? 'flex min-h-screen items-center justify-center bg-tertiary-50 p-6' : 'p-2'}>
        <div role="alert" className="mx-auto max-w-lg rounded-2xl border border-danger-100 bg-white p-6 shadow-card">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" />
            <div className="min-w-0 space-y-2">
              <h2 className="font-heading text-base font-semibold text-tertiary-900">Something went wrong on this page</h2>
              <p className="text-sm text-tertiary-600">
                The error has been reported. Try again, reload the page, or go back to the dashboard — the rest of the app still works.
              </p>
              <p className="break-words rounded-lg bg-tertiary-50 px-2 py-1 font-mono text-xs text-tertiary-500">{String(error.message || error).slice(0, 300)}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className="btn-secondary text-sm" onClick={() => this.setState({ error: null })}>Try again</button>
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => window.location.reload()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reload page
                </button>
                <button type="button" className="btn-primary text-sm" onClick={() => window.location.assign('/')}>Go to Dashboard</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
