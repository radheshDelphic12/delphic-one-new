import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Text input with a show/hide visibility toggle.
 * Forwards standard input props; omit `type` (managed internally).
 */
export default function PasswordInput({ className = '', toggleClassName = '', ...props }) {
  const [visible, setVisible] = useState(false);
  const toggleTone = toggleClassName || 'text-tertiary-400 hover:text-tertiary-700';

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`pr-10 ${className}`.trim()}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((prev) => !prev)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 ${toggleTone}`.trim()}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
