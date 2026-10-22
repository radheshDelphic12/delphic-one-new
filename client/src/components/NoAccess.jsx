import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

/** Shown instead of an empty page when someone opens a page by its address without the permission for it. */
export default function NoAccess() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-tertiary-100 bg-white p-8 text-center shadow-card">
      <ShieldOff className="mx-auto h-8 w-8 text-tertiary-400" aria-hidden="true" />
      <h1 className="mt-3 font-heading text-base font-semibold text-tertiary-900">You don&apos;t have access to this page</h1>
      <p className="mt-1 text-sm text-tertiary-500">Ask your Admin if you need it.</p>
      <Link to="/" className="btn-primary mt-4 inline-flex">Back to the dashboard</Link>
    </div>
  );
}
