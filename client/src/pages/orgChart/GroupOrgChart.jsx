import { useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Crown, UserRound } from 'lucide-react';
import TeamChart from './TeamChart.jsx';

// Hiring (open positions) is purple everywhere in the org chart: the vacant seats in a team box use the same colour.
const HIRING = '#c9a7e0';

const openPositionsOf = (company) => (company.teams || []).reduce((n, t) => n + (Number(t.open_positions) || 0), 0);

function PersonCard({ name, caption, tone = 'blue' }) {
  const palette = tone === 'crown' ? 'border-amber-500 bg-amber-50' : 'border-slate-400 bg-[#9fc9f0]';
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm ${palette}`}>
      {tone === 'crown' ? <Crown className="h-4 w-4 text-amber-600" /> : <UserRound className="h-4 w-4 text-slate-700" />}
      <span className="leading-tight">
        <span className="block font-semibold text-slate-900">{name}</span>
        {caption && <span className="block text-[11px] text-slate-600">{caption}</span>}
      </span>
    </div>
  );
}

/** A short vertical connector between two levels. */
const Down = () => <div className="ml-6 h-5 w-px bg-slate-400" aria-hidden="true" />;

function CompanyBranch({ company }) {
  const soon = Boolean(company.org.enabled_modules?.includes('coming_soon'));
  const open = openPositionsOf(company);
  const [expanded, setExpanded] = useState(!soon && company.roots.length > 0);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    // the trunk (left line) comes from the Group Super Admin; this tick joins the company to it
    <section className="relative">
      <span className="absolute -left-6 top-5 h-px w-6 bg-slate-400" aria-hidden="true" />
      <div className={`inline-flex items-center gap-3 rounded-xl border px-4 py-2.5 shadow-sm ${soon ? 'border-dashed border-slate-400 bg-white' : 'border-sky-700 bg-sky-700 text-white'}`}>
        <Building2 className="h-4 w-4" />
        <span className="font-heading text-sm font-semibold">{company.org.name}</span>
        <span className={`text-xs ${soon ? 'text-slate-500' : 'text-sky-100'}`}>{soon ? 'Coming soon' : `${company.headcount} ${company.headcount === 1 ? 'person' : 'people'}`}</span>
        {open > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-900" style={{ background: HIRING }} title="Open positions">{open} hiring</span>}
      </div>

      {!soon && (
        <>
          <Down />
          <div className="ml-6 flex flex-wrap items-center gap-2">
            {company.admins?.length ? company.admins.map((a) => <PersonCard key={a.id} name={a.name} caption={['Admin', a.designation].filter(Boolean).join(' · ')} />) : <span className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">No admin set for this company</span>}
          </div>
          {company.roots.length > 0 && (
            <>
              <Down />
              <div className="ml-6">
                <button type="button" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => setExpanded((v) => !v)}>
                  <Chevron className="h-3.5 w-3.5" /> {expanded ? 'Hide' : 'Show'} teams and people
                </button>
                {expanded && (
                  <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white p-2">
                    <TeamChart data={{ roots: company.roots, teams: company.teams || [] }} companyName={company.org.name} hint="Teams, leads and open positions of this company." />
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Group org chart, top down: the Group Super Admin at the top, each company under it, each company's admin under the
 * company, and the company's own team chart (the same one Delphic has) under the admin. Open positions are purple.
 */
export default function GroupOrgChart({ companies, adminName }) {
  return (
    <div>
      <PersonCard name={adminName} caption="Group Super Admin · admin of every company" tone="crown" />
      <Down />
      <div className="ml-6 space-y-6 border-l border-slate-400 pb-2 pl-6 pt-5">
        {companies.map((company) => <CompanyBranch key={company.org.id} company={company} />)}
      </div>
    </div>
  );
}
