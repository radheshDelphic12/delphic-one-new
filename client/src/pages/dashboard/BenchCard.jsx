import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Armchair } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';

const left = (n) => (n === null ? 'No end date' : n <= 0 ? 'Last day' : `${n} day${n === 1 ? '' : 's'} left`);

/** Employees on the bench right now (admins only): not on any project today, inside their bench dates. Hidden when nobody is. */
export default function BenchCard() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    apiClient.get('/orgs/bench').then(({ data }) => { if (live) setRows(data.data || []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <h2 className="flex items-center gap-2 border-b border-tertiary-100 px-4 py-3 font-heading text-sm font-semibold text-tertiary-900">
        <Armchair className="h-4 w-4 text-tertiary-400" /> On the bench
        <span className="font-normal text-tertiary-400">{rows.length} {rows.length === 1 ? 'person' : 'people'}</span>
      </h2>
      <ul className="divide-y divide-tertiary-100">
        {rows.map((r) => (
          <li key={r.org_membership_id}>
            <Link to={`/people/${r.org_membership_id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-tertiary-50/80">
              <span className="min-w-0">
                <span className="block truncate font-medium text-primary-600">{r.name}</span>
                <span className="block truncate text-xs text-tertiary-500">{[r.designation, r.department].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={`shrink-0 text-xs ${r.days_left !== null && r.days_left <= 7 ? 'font-medium text-red-600' : 'text-tertiary-500'}`}>{left(r.days_left)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
