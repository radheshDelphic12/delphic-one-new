import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Save, Search, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import RichTextEditor from '../../components/ui/RichTextEditor.jsx';

const INPUT = 'w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm outline-none focus:border-primary-400';
const NEW = 'new';
const BLANK = { title: '', category: '', content: '', is_published: false };

const formatDay = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/**
 * People → Policies. Admins write policies in a rich-text editor (drafts stay
 * hidden until published); everyone else reads the published ones.
 */
export default function PoliciesPage() {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const isAdmin = user?.role === 'admin';
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // policy id | 'new' | null
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/policies');
      setPolicies(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load policies'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  const current = policies.find((p) => p.id === selected) || null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return policies.filter((p) => !q || `${p.title} ${p.category || ''}`.toLowerCase().includes(q));
  }, [policies, search]);

  function open(policy) {
    setSelected(policy.id);
    setForm({ title: policy.title, category: policy.category || '', content: policy.content, is_published: policy.is_published });
    setEditing(false);
  }

  function startNew() {
    setSelected(NEW);
    setForm(BLANK);
    setEditing(true);
  }

  async function save() {
    if (!form.title.trim()) {
      pushError('Give the policy a title.', 'Please fix the form');
      return;
    }
    setSaving(true);
    try {
      const body = { title: form.title.trim(), category: form.category.trim() || null, content: form.content, is_published: form.is_published };
      const { data } = selected === NEW ? await apiClient.post('/policies', body) : await apiClient.patch(`/policies/${selected}`, body);
      pushInfo(selected === NEW ? 'Policy created' : 'Policy saved');
      await load();
      setSelected(data.data.id);
      setForm({ title: data.data.title, category: data.data.category || '', content: data.data.content, is_published: data.data.is_published });
      setEditing(false);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the policy'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!current || !window.confirm(`Delete "${current.title}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/policies/${current.id}`);
      pushInfo('Policy deleted');
      setSelected(null);
      setEditing(false);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the policy'), 'Something went wrong');
    }
  }

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-3 self-start rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Policies</h2>
          {isAdmin && (
            <button type="button" className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs" onClick={startNew}>
              <Plus className="h-3.5 w-3.5" /> New policy
            </button>
          )}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policies" className={`${INPUT} pl-9`} />
        </label>
        {loading ? (
          <p className="px-1 py-4 text-xs text-tertiary-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-4 text-xs text-tertiary-400">{policies.length ? 'No policy matches.' : 'No policies yet.'}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => open(p)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${selected === p.id ? 'bg-primary-50 text-primary-800' : 'text-tertiary-800 hover:bg-tertiary-50'}`}
                >
                  <span className="block font-medium">{p.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-tertiary-500">
                    {p.category && <span>{p.category}</span>}
                    {isAdmin && !p.is_published && <span className="rounded bg-warning-50 px-1.5 text-warning-700">Draft</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        {!selected ? (
          <EmptyState
            icon={FileText}
            title={isAdmin ? 'Select or create a policy' : 'Select a policy to read'}
            description={isAdmin ? 'Write company policies here; publish them when they are ready for employees.' : 'Company policies published by your admin appear here.'}
          />
        ) : editing && isAdmin ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <label className="block text-xs font-medium text-tertiary-600">Title
                <input value={form.title} onChange={(e) => set('title', e.target.value)} className={`${INPUT} mt-1`} placeholder="e.g. Leave policy" />
              </label>
              <label className="block text-xs font-medium text-tertiary-600">Category
                <input value={form.category} onChange={(e) => set('category', e.target.value)} className={`${INPUT} mt-1`} placeholder="e.g. HR" list="policy-categories" />
                <datalist id="policy-categories">
                  {[...new Set(policies.map((p) => p.category).filter(Boolean))].map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
            </div>
            <RichTextEditor value={form.content} resetKey={selected} onChange={(html) => set('content', html)} placeholder="Write the policy…" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-tertiary-700">
                <input type="checkbox" checked={form.is_published} onChange={(e) => set('is_published', e.target.checked)} />
                Published (visible to employees)
              </label>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => (selected === NEW ? setSelected(null) : open(current))}>Cancel</button>
                <button type="button" className="btn-primary inline-flex items-center gap-1" disabled={saving} onClick={save}>
                  <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save policy'}
                </button>
              </div>
            </div>
          </div>
        ) : current ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-tertiary-100 pb-3">
              <div className="min-w-0">
                <h2 className="font-heading text-xl font-semibold text-tertiary-900">{current.title}</h2>
                <p className="mt-1 text-xs text-tertiary-500">
                  {[current.category, `Updated ${formatDay(current.updated_at)}`, isAdmin && !current.is_published ? 'Draft' : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>
                  <button type="button" className="btn-secondary inline-flex items-center gap-1 text-danger-700" onClick={remove}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                </div>
              )}
            </div>
            {current.content ? (
              // Sanitized by the server (allow-listed tags only) before it is stored.
              <div className="policy-content" dangerouslySetInnerHTML={{ __html: current.content }} />
            ) : (
              <p className="text-sm text-tertiary-400">This policy has no content yet.</p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
