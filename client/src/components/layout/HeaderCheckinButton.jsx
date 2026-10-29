import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogIn, LogOut, MapPin } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';

const CHECKIN_PATH = '/attendance?section=location-checkin';

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Workplace Check-in shortcut beside the notification bell (Delphic Global, full-time employees).
 * Not checked in: a highlighted "Check in" button; checked in: the time plus "Check out"; done: a quiet chip.
 * It only links to the Workplace Check-in tab, where the location / selfie step happens.
 */
export default function HeaderCheckinButton() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [today, setToday] = useState(null);
  const isMaster = Boolean(user?.active_org?.is_master_workspace);

  useEffect(() => {
    if (!isMaster) {
      setToday(null);
      return;
    }
    apiClient.get('/location-checkin/today').then(({ data }) => setToday(data.data || null)).catch(() => setToday(null));
  }, [isMaster, user?.active_org?.id, pathname]);

  if (!isMaster || !today?.eligible) return null;
  const rec = today.record;

  if (!rec) {
    return (
      <Link to={CHECKIN_PATH} className="mr-1 inline-flex items-center gap-2 rounded-full bg-primary-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm ring-2 ring-primary-200 transition hover:bg-primary-700" aria-label="Workplace check-in: check in now">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-white" /></span>
        <LogIn className="h-4 w-4" aria-hidden="true" />
        <span>Check in</span>
      </Link>
    );
  }
  if (!rec.check_out_at) {
    return (
      <Link to={CHECKIN_PATH} className="mr-1 inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3.5 py-1.5 text-sm font-medium text-green-800 transition hover:bg-green-100" aria-label="Workplace check-in: check out">
        <MapPin className="h-4 w-4" aria-hidden="true" />
        <span>In {clock(rec.check_in_at)}</span>
        <span className="inline-flex items-center gap-1 font-semibold"><LogOut className="h-3.5 w-3.5" aria-hidden="true" />Check out</span>
      </Link>
    );
  }
  return (
    <Link to={CHECKIN_PATH} className="mr-1 inline-flex items-center gap-2 rounded-full border border-tertiary-200 bg-white px-3 py-1.5 text-xs font-medium text-tertiary-600 hover:bg-tertiary-50" aria-label="Workplace check-in: day complete">
      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{clock(rec.check_in_at)} – {clock(rec.check_out_at)}</span>
    </Link>
  );
}
