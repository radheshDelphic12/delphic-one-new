import { useState } from 'react';
import apiClient from '../lib/apiClient.js';
import { useAlerts } from '../lib/alerts/alertContext.jsx';
import PasswordInput from './ui/PasswordInput.jsx';

/**
 * Self-contained "change my password" form (fields + submit).
 * Lives in the Settings › Security tab.
 *
 * Args:
 *   onDone: optional — called after a successful change.
 *   onCancel: optional — renders a secondary Cancel button.
 */
export default function ChangePasswordForm({ onDone, onCancel }) {
  const { pushError, pushSuccess } = useAlerts();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();

    if (newPassword.length < 8) {
      pushError('New password must be at least 8 characters', 'Validation');
      return;
    }
    if (newPassword !== confirmPassword) {
      pushError('New password and confirmation do not match', 'Validation');
      return;
    }

    setSaving(true);
    try {
      await apiClient.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      pushSuccess('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onDone?.();
    } catch (err) {
      pushError(err.response?.data?.message || 'Could not change password', 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-500">Current password</label>
        <PasswordInput
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-500">New password</label>
        <PasswordInput
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          minLength={8}
          required
        />
        <p className="mt-1 text-xs text-tertiary-400">At least 8 characters.</p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-500">Confirm new password</label>
        <PasswordInput
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          minLength={8}
          required
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}
