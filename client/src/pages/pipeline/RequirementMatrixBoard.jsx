import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import Badge from '../../components/ui/Badge.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import ScreeningRoundChips from './ScreeningRoundChips.jsx';
import { groupBoard, stageColumnStats, BOARD_COLUMNS } from '../../lib/accountBoard.js';
import { shortKey } from './pipelineBoardUtils.js';
import PipelineFilters from './PipelineFilters.jsx';

const STAGE_HEADER_COLORS = {
  sourced: 'bg-slate-100 text-slate-700',
  internal_screening: 'bg-indigo-50 text-indigo-700',
  submitted_to_client: 'bg-blue-50 text-blue-700',
  interview_scheduled: 'bg-violet-50 text-violet-700',
  interview_result: 'bg-fuchsia-50 text-fuchsia-700',
  offer_sent: 'bg-purple-50 text-purple-700',
  bgv: 'bg-cyan-50 text-cyan-700',
  closed: 'bg-green-50 text-green-700',
  backout: 'bg-orange-50 text-orange-700',
  rejected: 'bg-red-50 text-red-700',
};

const MATRIX_FIELDS = [
  'search',
  'account_ids',
  'profile_source',
  'req_type',
  'bda_id',
  'sales_id',
  'admin_id',
  'recruiter_ids',
  'submitted_by_ids',
  'status',
  'priority',
  'submission_stage',
  'stuck',
  'date_range',
];

function CandidateCard({ submission }) {
  return (
    <Link
      to={`/submissions/${submission.id}`}
      className="block w-full rounded-md border border-tertiary-200 bg-white p-2 text-left shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/40"
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-primary-700">{submission.profile?.name || 'Candidate'}</p>
        <ProgressRing percent={submission.progress?.percent ?? null} size="sm" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {submission.profile?.source && <Badge value={submission.profile.source} />}
      </div>
      {submission.profile?.source === 'vendor' && submission.profile?.vendor_account?.name && (
        <p className="mt-1 truncate text-[11px] text-tertiary-500">
          via {submission.profile.vendor_account.name}
        </p>
      )}
      <p className="mt-1 truncate text-[11px] text-tertiary-500">
        Recruiter: {submission.submitted_by?.name || '—'}
      </p>
      <ScreeningRoundChips rounds={submission.internal_rounds} className="mt-1" />
    </Link>
  );
}

export default function RequirementMatrixBoard() {
  const [requirements, setRequirements] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterParams, setFilterParams] = useState({});

  const handleFiltersChange = useCallback((params) => {
    setFilterParams(params);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiClient
      .get('/pipeline/board', { params: filterParams })
      .then(({ data }) => {
        if (cancelled) return;
        setRequirements(data.data?.requirements || []);
        setSubmissions(data.data?.submissions || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || 'Failed to load pipeline board');
        setRequirements([]);
        setSubmissions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterParams]);

  const { rows } = useMemo(() => groupBoard(requirements, submissions), [requirements, submissions]);
  const columnStats = useMemo(() => stageColumnStats(rows), [rows]);

  return (
    <div className="space-y-3">
      <div className="relative z-40 flex flex-wrap items-center justify-between gap-2">
        <PipelineFilters fields={MATRIX_FIELDS} onChange={handleFiltersChange} />
        <p className="text-xs text-tertiary-500">
          {requirements.length} requirement(s) · {submissions.length} candidate(s)
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-tertiary-500">Loading pipeline map…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-tertiary-200 bg-white px-4 py-8 text-center text-sm text-tertiary-500">
          No requirements match these filters.
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-tertiary-200 bg-tertiary-50/40">
          <div
            className="inline-grid min-w-full"
            style={{
              gridTemplateColumns: `minmax(220px, 260px) repeat(${BOARD_COLUMNS.length}, minmax(180px, 1fr))`,
            }}
          >
            <div className="sticky left-0 top-0 z-30 border-b border-r border-tertiary-200 bg-white px-3 py-2 text-xs font-semibold text-tertiary-600">
              Requirement
            </div>
            {BOARD_COLUMNS.map((stage) => (
              <div
                key={stage}
                className={`sticky top-0 z-20 border-b border-r border-tertiary-200 px-3 py-2 ${STAGE_HEADER_COLORS[stage] || 'bg-tertiary-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold capitalize">{stage.replace(/_/g, ' ')}</span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-tertiary-600">
                    {columnStats[stage] || 0}
                  </span>
                </div>
              </div>
            ))}

            {rows.map((row) => {
              const req = row.requirement;
              return (
                <div key={req.id} className="contents">
                  <div
                    className={`sticky left-0 z-10 border-b border-r border-l-4 border-tertiary-200 bg-white p-3 ${
                      req.is_stuck ? 'border-l-danger-400' : 'border-l-transparent'
                    }`}
                  >
                    <Link to={`/requirements/${req.id}`} className="text-sm font-semibold text-primary-700 hover:underline">
                      {req.title}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-tertiary-500">{shortKey('REQ', req.id)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge value={req.status || 'open'} />
                      {req.is_stuck && (
                        <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-medium text-danger-700">
                          Stuck
                        </span>
                      )}
                      {req.past_sla && (
                        <span className="rounded-full bg-warning-50 px-2 py-0.5 text-[10px] font-medium text-warning-800">
                          Past SLA
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-[11px] text-tertiary-500">{req.account?.name || '—'}</p>
                    <p className="truncate text-[11px] text-tertiary-500">
                      BDA: {req.account?.owner?.name || '—'}
                    </p>
                    <p className="truncate text-[11px] text-tertiary-500">
                      Sales: {req.sales_owner?.name || '—'}
                    </p>
                    <p className="truncate text-[11px] text-tertiary-500">
                      Recruiters: {(req.recruiters || []).map((person) => person.name).join(', ') || '—'}
                    </p>
                    <Link to={`/requirements/${req.id}/board`} className="mt-1.5 inline-block text-[11px] text-primary-600 hover:underline">
                      Job board
                    </Link>
                  </div>
                  {BOARD_COLUMNS.map((stage) => {
                    const cards = row.cells[stage] || [];
                    return (
                      <div key={`${req.id}::${stage}`} className="min-h-[88px] space-y-2 border-b border-r border-tertiary-100 bg-white p-2">
                        {cards.map((sub) => (
                          <CandidateCard key={sub.id} submission={sub} />
                        ))}
                        {cards.length === 0 && <p className="px-1 py-3 text-center text-[11px] text-tertiary-300">—</p>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
