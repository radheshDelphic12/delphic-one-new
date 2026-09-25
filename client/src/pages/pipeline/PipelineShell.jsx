import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/authContext.jsx';
import { usePermissions } from '../../lib/permissions.js';
import { defaultPipelineView } from './pipelineBoardUtils.js';
import OpenInNewTabButton from '../../components/OpenInNewTabButton.jsx';
import LeadPipelineBoard from './LeadPipelineBoard.jsx';
import JobPipelineBoard from './JobPipelineBoard.jsx';
import CandidatePipelineBoard from './CandidatePipelineBoard.jsx';
import RequirementMatrixBoard from './RequirementMatrixBoard.jsx';

const VIEW_OPTIONS = [
  { key: 'matrix', label: 'Requirement map', capability: 'viewRequirementMatrix' },
  { key: 'lead', label: 'Leads', capability: 'viewLeadPipeline' },
  { key: 'jobs', label: 'Jobs', capability: 'viewJobPipeline' },
  { key: 'candidates', label: 'Candidates', capability: 'viewCandidatePipeline' },
];

/**
 * Role-aware pipeline entry: picks the right board, with an admin switcher.
 */
export default function PipelineShell() {
  const { user } = useAuth();
  const { can } = usePermissions(user);
  const [searchParams, setSearchParams] = useSearchParams();

  const availableViews = useMemo(
    () => VIEW_OPTIONS.filter((option) => can(option.capability)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- can is derived from user.role
    [user?.role]
  );

  const requested = searchParams.get('view');
  const activeView =
    availableViews.find((option) => option.key === requested)?.key ||
    availableViews.find((option) => option.key === defaultPipelineView(user?.role))?.key ||
    availableViews[0]?.key ||
    'lead';

  const showSwitcher = availableViews.length > 1;

  function setView(view) {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showSwitcher ? (
          <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-1 shadow-soft">
            {availableViews.map((option) => {
              const isActive = option.key === activeView;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setView(option.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-tertiary-600 hover:bg-tertiary-50 hover:text-tertiary-900'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <OpenInNewTabButton />
      </div>

      {activeView === 'lead' && <LeadPipelineBoard />}
      {activeView === 'jobs' && <JobPipelineBoard />}
      {activeView === 'candidates' && <CandidatePipelineBoard />}
      {activeView === 'matrix' && <RequirementMatrixBoard />}
    </div>
  );
}
