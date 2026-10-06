import { useEffect, useState } from 'react';

// Small shared pieces for the Zephyr forms and detail screens.
export const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
export const labelCls = 'block text-xs font-medium text-tertiary-600';
export const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
export const dayOf = (v) => (v ? String(v).slice(0, 10) : '');
export const today = () => new Date().toISOString().slice(0, 10);

export function Section({ title, hint, children, cols = 2 }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border bg-white p-4">
      <legend className="px-1 font-heading text-sm font-semibold text-tertiary-900">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-tertiary-500">{hint}</p>}
      <div className={`grid gap-3 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
    </fieldset>
  );
}

export function Detail({ label, children }) {
  if (children === null || children === undefined || children === '' || children === false) return null;
  return (
    <div>
      <dt className="text-xs text-tertiary-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-tertiary-900">{children}</dd>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-tertiary-400">{children}</div>;
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Empty strings become null and numeric fields become numbers, ready to send to the API. */
export function toBody(values, { numbers = [], keep = [] } = {}) {
  const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v]));
  for (const k of numbers) if (body[k] !== null && body[k] !== undefined) body[k] = Number(body[k]);
  for (const k of keep) body[k] = values[k];
  return body;
}
