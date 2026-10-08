import { inr, inrShort } from '../../lib/acconcy/meta.js';
import { acconcyError } from '../../lib/acconcy/api.js';

export const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
export const labelCls = 'block text-xs font-medium text-tertiary-600';
export const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
export const dayOf = (v) => (v ? String(v).slice(0, 10) : '');
export const today = () => new Date().toISOString().slice(0, 10);

/** Lakh/Crore figure with the full rupee amount on hover. */
export function Money({ v, className = '', signed = false }) {
  const n = Number(v || 0);
  return <span title={inr(n)} className={`whitespace-nowrap tabular-nums ${signed && n < 0 ? 'text-red-600' : ''} ${className}`}>{inrShort(n)}</span>;
}

export function Field({ label, children, className = '', hint }) {
  return (
    <label className={`${labelCls} ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-0.5 block text-[11px] font-normal text-tertiary-400">{hint}</span>}
    </label>
  );
}

export function Text({ label, value, onChange, className, ...rest }) {
  return <Field label={label} className={className}><input className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} /></Field>;
}
export function Num({ label, value, onChange, className, hint, ...rest }) {
  return <Field label={label} className={className} hint={hint}><input type="number" step="any" min="0" className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} /></Field>;
}
export function DateInput({ label, value, onChange, className, ...rest }) {
  return <Field label={label} className={className}><input type="date" className={inputCls} value={dayOf(value)} onChange={(e) => onChange(e.target.value)} {...rest} /></Field>;
}
export function Select({ label, value, onChange, options, blank, className, ...rest }) {
  return (
    <Field label={label} className={className}>
      <select className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}
export function Area({ label, value, onChange, rows = 3, className, ...rest }) {
  return <Field label={label} className={className}><textarea className={inputCls} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} /></Field>;
}

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

/** Dashboard tile. With `to`, the whole tile is a link (drill-down); `onClick` makes it a button. */
export function Kpi({ label, value, hint, tone, onClick }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${tone || 'text-tertiary-900'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-tertiary-500">{hint}</div>}
    </>
  );
  const base = 'block w-full rounded-2xl border bg-white p-4 text-left shadow-soft';
  if (!onClick) return <div className={base}>{body}</div>;
  return <button type="button" onClick={onClick} className={`${base} transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card`}>{body}</button>;
}

// Dates arrive from the API as full timestamps (2026-09-01T00:00:00.000Z) but the server only accepts YYYY-MM-DD, so an
// edited record would be refused unless every date is cut back to its day.
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function toBody(values, { numbers = [] } = {}) {
  const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() === '' ? null : v.trim().replace(ISO_DAY, '$1')) : v]));
  for (const k of numbers) if (body[k] !== null && body[k] !== undefined) body[k] = Number(body[k]);
  return body;
}

/**
 * Admin override helper: run(reason?) is tried once; if the server asks for a reason (closed month,
 * quantity limit) the admin is prompted for it and the call is retried with it.
 */
export async function withReason(run) {
  try {
    return await run(undefined);
  } catch (e) {
    const msg = acconcyError(e, '');
    if (/reason/i.test(msg)) {
      const reason = window.prompt(`${msg}\n\nReason for this change:`);
      if (reason && reason.trim()) return run(reason.trim());
    }
    throw e;
  }
}
