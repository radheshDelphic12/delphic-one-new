import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const CREATABLE_ROLES = [
  { value: 'bda', label: 'BDA' },
  { value: 'sales', label: 'Sales' },
  { value: 'recruiter', label: 'Recruiter' },
  { value: 'admin', label: 'Admin' },
  { value: 'employee', label: 'Employee' },
];

const emptyForm = {
  name: '',
  email: '',
  password: '',
  role: 'bda',
  phone: '',
  department_id: '',
};

function EditUserDrawer({ open, row, departments, isSuperadmin, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const [fields, setFields] = useState(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && row) {
      setFields({
        name: row.name || '',
        email: row.email || '',
        role: row.role || 'bda',
        phone: row.phone || '',
        active: row.active !== false,
        department_id: row.department?.id || '',
        is_superadmin: Boolean(row.is_superadmin),
      });
      setPassword('');
    }
  }, [open, row]);

  function set(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!fields) return;
    const patch = {};
    if (fields.name.trim() && fields.name.trim() !== row.name) patch.name = fields.name.trim();
    if (fields.email.trim() && fields.email.trim() !== row.email) patch.email = fields.email.trim();
    if (fields.role !== row.role) patch.role = fields.role;
    const phone = fields.phone.trim();
    if (phone !== (row.phone || '')) patch.phone = phone || null;
    if (fields.active !== (row.active !== false)) patch.active = fields.active;
    if (fields.department_id !== (row.department?.id || '')) patch.department_id = fields.department_id || null;
    if (isSuperadmin && fields.is_superadmin !== Boolean(row.is_superadmin)) patch.is_superadmin = fields.is_superadmin;
    if (isSuperadmin && password.trim()) patch.password = password.trim();

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await apiClient.patch(`/users/${row.id}`, patch);
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update user'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      title={row ? `Edit ${row.name}` : 'Edit user'}
      onClose={onClose}
      size="md"
      tone="edit"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="edit-user-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {fields && (
        <form id="edit-user-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Name</label>
            <input value={fields.name} onChange={(e) => set('name', e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Role</label>
            <select value={fields.role} onChange={(e) => set('role', e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
              {CREATABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Email</label>
            <input type="email" value={fields.email} onChange={(e) => set('email', e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Phone</label>
            <input value={fields.phone} onChange={(e) => set('phone', e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Department</label>
            <SearchableSelect
              value={fields.department_id}
              onChange={(v) => set('department_id', v)}
              placeholder="Unassigned"
              allowClear
              searchPlaceholder="Search departments…"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input id="edit-user-active" type="checkbox" checked={fields.active} onChange={(e) => set('active', e.target.checked)} />
            <label htmlFor="edit-user-active" className="text-sm text-tertiary-700">
              Active
            </label>
          </div>
          {isSuperadmin && (
            <>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="edit-user-super"
                  type="checkbox"
                  checked={fields.is_superadmin}
                  onChange={(e) => set('is_superadmin', e.target.checked)}
                />
                <label htmlFor="edit-user-super" className="text-sm text-tertiary-700">
                  Superadmin (full edit access)
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Reset password</label>
                <input
                  type="text"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="leave blank to keep current"
                  className="w-full rounded-xl border px-3 py-2 font-mono text-sm"
                />
              </div>
            </>
          )}
        </form>
      )}
    </Drawer>
  );
}

function DepartmentDrawer({ open, department, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(department);

  useEffect(() => {
    if (open) setName(department?.name || '');
  }, [open, department]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      if (isEditing) await apiClient.patch(`/departments/${department.id}`, { name: name.trim() });
      else await apiClient.post('/departments', { name: name.trim() });
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, `Failed to ${isEditing ? 'update' : 'create'} department`), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      title={isEditing ? 'Edit department' : 'Add department'}
      onClose={onClose}
      size="sm"
      tone={isEditing ? 'edit' : 'create'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="department-form" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add department'}
          </button>
        </>
      }
    >
      <form id="department-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-500">
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
          />
        </label>
      </form>
    </Drawer>
  );
}

export default function UsersPage() {
  const { user, isSuperadmin } = useAuth();
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [createdCreds, setCreatedCreds] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deptDrawer, setDeptDrawer] = useState(null);
  const [editRow, setEditRow] = useState(null);

  async function loadUsers() {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/users', { params: { limit: 100 } });
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load users'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function loadDepartments() {
    apiClient
      .get('/departments')
      .then(({ data }) => setDepartments(data.data || []))
      .catch(() => setDepartments([]));
  }

  useEffect(() => {
    if (user?.role === 'admin') {
      loadUsers();
      loadDepartments();
    }
  }, [user?.role]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreatedCreds(null);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        phone: form.phone.trim() || null,
        department_id: form.department_id || null,
      };
      const { data } = await apiClient.post('/users', payload);
      setCreatedCreds({
        name: data.data.name,
        email: data.data.email,
        role: data.data.role,
        password: form.password,
      });
      setForm(emptyForm);
      setCreateOpen(false);
      await loadUsers();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create user'), 'Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(row) {
    try {
      await apiClient.patch(`/users/${row.id}`, { active: !row.active });
      await loadUsers();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update user'), 'Something went wrong');
    }
  }

  const columns = useMemo(
    () => [
      { key: 'name', header: 'Name', render: (row) => <span className="font-semibold text-tertiary-900">{row.name}</span> },
      { key: 'email', header: 'Email', render: (row) => <span className="text-tertiary-500">{row.email}</span> },
      {
        key: 'role',
        header: 'Role',
        render: (row) => (
          <span className="capitalize text-tertiary-700">
            {row.role}
            {row.is_superadmin && <span className="ml-1 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase not-italic text-primary-700">super</span>}
          </span>
        ),
      },
      { key: 'dept', header: 'Department', render: (row) => row.department?.name || <span className="text-tertiary-400">Unassigned</span> },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
              row.active ? 'bg-green-50 text-green-700' : 'bg-tertiary-100 text-tertiary-600'
            }`}
          >
            {row.active ? 'Active' : 'Inactive'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
          <div className="flex gap-2">
            {isSuperadmin && (
              <button
                type="button"
                className="rounded-lg border border-[#105AA9] bg-white px-3 py-1 text-xs font-medium text-[#105AA9] transition-colors hover:bg-[#EEF5FC]"
                onClick={() => setEditRow(row)}
              >
                Edit
              </button>
            )}
            {row.id !== user.id ? (
              <button
                type="button"
                className="rounded-lg border border-[#105AA9] bg-white px-3 py-1 text-xs font-medium text-[#105AA9] transition-colors hover:bg-[#EEF5FC]"
                onClick={() => toggleActive(row)}
              >
                {row.active ? 'Deactivate' : 'Activate'}
              </button>
            ) : (
              !isSuperadmin && <span className="text-tertiary-400">—</span>
            )}
          </div>
        ),
      },
    ],
    [user.id, isSuperadmin]
  );

  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" className="btn-primary shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create user
        </button>
      </div>

      {createdCreds && (
        <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-700">
          <p className="font-medium">User created - copy and share these credentials:</p>
          <p className="mt-1">
            {createdCreds.name} ({createdCreds.role}) - <span className="font-mono">{createdCreds.email}</span> /{' '}
            <span className="font-mono">{createdCreds.password}</span>
          </p>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        emptyLabel="No users yet."
        headerClassName="bg-[#F5F7FF]"
      />

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-tertiary-100 px-4 py-2.5">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Departments</h2>
          <button
            type="button"
            className="rounded-lg border border-[#105AA9] bg-white px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#EEF5FC]"
            onClick={() => setDeptDrawer({})}
          >
            + Add department
          </button>
        </div>
        <ul className="divide-y divide-tertiary-100">
          {departments.map((dept) => (
            <li key={dept.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-medium text-tertiary-900">{dept.name}</span>
              <button
                type="button"
                className="text-xs font-medium text-primary-600 transition-colors hover:underline"
                onClick={() => setDeptDrawer(dept)}
              >
                Edit
              </button>
            </li>
          ))}
          {departments.length === 0 && <li className="px-4 py-5 text-sm text-tertiary-400">No departments yet.</li>}
        </ul>
      </section>

      <EditUserDrawer
        open={Boolean(editRow)}
        row={editRow}
        departments={departments}
        isSuperadmin={isSuperadmin}
        onClose={() => setEditRow(null)}
        onSaved={() => {
          setEditRow(null);
          loadUsers();
        }}
      />

      <DepartmentDrawer
        open={Boolean(deptDrawer)}
        department={deptDrawer?.id ? deptDrawer : null}
        onClose={() => setDeptDrawer(null)}
        onSaved={() => {
          setDeptDrawer(null);
          loadDepartments();
        }}
      />

      <Drawer open={createOpen} title="Create user" onClose={() => setCreateOpen(false)} size="md" tone="create">
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Role</label>
              <select
                value={form.role}
                onChange={(e) => updateField('role', e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              >
                {CREATABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Temporary password</label>
              <input
                type="text"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                className="w-full rounded-xl border px-3 py-2 font-mono text-sm"
                placeholder="min 8 characters"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Department</label>
              <SearchableSelect
                value={form.department_id}
                onChange={(v) => updateField('department_id', v)}
                placeholder="Unassigned"
                allowClear
                searchPlaceholder="Search departments…"
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Phone (optional)</label>
              <input
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
