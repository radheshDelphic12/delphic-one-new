import { useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';

// A new password, shown ONCE. The server does not keep it in a readable form and cannot show it again: copy it now and pass it on.
export default function PasswordResultDrawer({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(result.password); setCopied(true); } catch { setCopied(false); }
  }
  function close() { setCopied(false); onClose(); }
  return (
    <Drawer open={Boolean(result)} onClose={close} size="md" title="New password" footer={<button type="button" className="btn-primary" onClick={close}>Done</button>}>
      {result && (
        <div className="space-y-3 text-sm" data-testid="password-result">
          <p>The password for <b>{result.email}</b>{result.customer ? <> ({result.customer})</> : null} was changed. Their earlier sign-ins have ended.</p>
          <p className="rounded-xl bg-warning-50 p-3 text-warning-900"><b>This is shown only now.</b> It cannot be shown again. Give it to the person and ask them to change it after signing in (Settings).</p>
          <div className="flex items-center gap-2 rounded-xl bg-canvas-muted p-3">
            <code className="flex-1 select-all break-all font-mono text-base" data-testid="new-password">{result.password}</code>
            <button type="button" className="btn-secondary text-xs" onClick={copy} data-testid="copy-password">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
