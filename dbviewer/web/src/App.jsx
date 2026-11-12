import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, download, qs } from './api.js';

// ---- small helpers ------------------------------------------------------------------------------------------------
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const MASK = '•'.repeat(6); // what the server shows in place of a hidden value
const KIND_LABEL = { auto: 'Scheduled', predeploy: 'Before deploy', now: 'Taken now', manual: 'Manual' };

function useHash() {
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive && setState({ loading: false, data, error: null }), (error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error" role="alert">{error instanceof ApiError && error.status === 401 ? `${error.message}. Open Delphic in this browser, then reload this page.` : error.message}</div>;
}

function Cell({ value, mask }) {
  if (value === null || value === undefined) return <span className="null">NULL</span>;
  if (mask && value === mask) return <span className="masked" title="Hidden">{value}</span>;
  return value;
}

// ---- snapshots list -----------------------------------------------------------------------------------------------
function Snapshots({ me }) {
  const { data, error, loading } = useLoad(() => api('snapshots'), []);
  const [migrations, setMigrations] = useState({});
  const [picking, setPicking] = useState(null);

  // migration counts are read lazily, two at a time, so opening the page never starts 100 pg_restore processes at once
  useEffect(() => {
    if (!data) return undefined;
    let alive = true;
    const queue = data.snapshots.slice(0, 60).map((s) => s.id);
    const worker = async () => {
      while (alive && queue.length) {
        const id = queue.shift();
        try {
          const r = await api(`snapshots/${encodeURIComponent(id)}/info`);
          if (alive) setMigrations((m) => ({ ...m, [id]: r.migration_count }));
        } catch { /* the number is a nicety */ }
      }
    };
    worker();
    worker();
    return () => { alive = false; };
  }, [data]);

  const days = useMemo(() => {
    const groups = [];
    (data?.snapshots || []).forEach((s) => {
      const day = s.time_ist.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(s);
      else groups.push({ day, items: [s] });
    });
    return groups;
  }, [data]);

  return (
    <section>
      <h2>Snapshots</h2>
      <p className="muted">Pick a point in time to see the tables exactly as they were, or compare it with another snapshot. Times are IST.</p>
      <ErrorBox error={error} />
      {loading && <p className="muted">Loading...</p>}
      {data && data.snapshots.length === 0 && <p className="muted">No dump files found.</p>}
      {days.map((g) => (
        <div key={g.day} className="day">
          <h3>{g.day}</h3>
          <table className="list">
            <tbody>
              {g.items.map((s) => (
                <tr key={s.id}>
                  <td className="time">{s.time_ist.slice(11)}</td>
                  <td><span className={`badge ${s.kind}`}>{KIND_LABEL[s.kind]}</span></td>
                  <td className="muted" title={s.id}>{s.id}</td>
                  <td className="num">{fmtSize(s.size)}</td>
                  <td className="num muted">{migrations[s.id] != null ? `${migrations[s.id]} migrations` : ''}</td>
                  <td className="actions">
                    <a className="btn" href={`#/s/${encodeURIComponent(s.id)}`}>View</a>
                    <button type="button" className="btn" onClick={() => setPicking(s)}>Compare with...</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {picking && <ComparePicker from={picking} snapshots={data.snapshots} canNow={me.compare_now} onClose={() => setPicking(null)} />}
    </section>
  );
}

function ComparePicker({ from, snapshots, canNow, onClose }) {
  const [other, setOther] = useState('');
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!job) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const j = await api(`compare/jobs/${job.id}`);
        if (!alive) return;
        if (j.status === 'done') { window.location.hash = `#/c/${j.key}`; return; }
        if (j.status === 'error') { setError(new Error(j.error)); setJob(null); return; }
        setJob({ id: job.id, step: j.step });
        setTimeout(tick, 700);
      } catch (e) { if (alive) { setError(e); setJob(null); } }
    };
    const t = setTimeout(tick, 400);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  async function start() {
    setError(null);
    // the older snapshot is always A, so "added" means added since then
    let a = from.id;
    let b = other;
    if (other !== 'now') {
      const o = snapshots.find((s) => s.id === other);
      if (o.time_utc < from.time_utc) [a, b] = [o.id, from.id];
    }
    try {
      const r = await api('compare', { method: 'POST', body: { a, b } });
      setJob({ id: r.job, step: 'starting' });
    } catch (e) { setError(e); }
  }

  return (
    <div className="modal-back" onClick={job ? undefined : onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compare snapshots">
        <h3>Compare {from.time_ist} IST with...</h3>
        <select value={other} onChange={(e) => setOther(e.target.value)} disabled={Boolean(job)}>
          <option value="">Choose a snapshot</option>
          {canNow && <option value="now">Now (takes a fresh dump of the live database)</option>}
          {snapshots.filter((s) => s.id !== from.id).map((s) => <option key={s.id} value={s.id}>{s.time_ist} - {KIND_LABEL[s.kind]} - {s.id}</option>)}
        </select>
        {other === 'now' && <p className="muted">A fresh dump is taken read-only. Only one every 5 minutes.</p>}
        <ErrorBox error={error} />
        {job && <p className="muted">Working: {job.step}</p>}
        <div className="row">
          <button type="button" className="btn primary" disabled={!other || Boolean(job)} onClick={start}>Compare</button>
          <button type="button" className="btn" disabled={Boolean(job)} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---- one snapshot -------------------------------------------------------------------------------------------------
function SnapshotView({ id, table }) {
  const { data, error, loading } = useLoad(() => api(`snapshots/${encodeURIComponent(id)}/tables`), [id]);
  const [filter, setFilter] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState(null);

  const tables = (data?.tables || []).filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()));
  const base = id.replace(/\.dump$/, '');
  const save = async (path, name) => {
    setBusy(true);
    setDlError(null);
    try { await download(path, name); } catch (e) { setDlError(e); }
    setBusy(false);
  };

  return (
    <section>
      <p><a href="#/">&larr; All snapshots</a></p>
      <h2>{data ? `${data.snapshot.time_ist} IST` : 'Snapshot'} <span className="muted">{id}</span></h2>
      <ErrorBox error={error || dlError} />
      {loading && <p className="muted">Reading the dump...</p>}
      {data && (
        <>
          <div className="toolbar">
            <label className="check"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Show personal identifiers (logged)</label>
            <button type="button" className="btn" disabled={busy} onClick={() => save(`snapshots/${encodeURIComponent(id)}/xlsx${qs({ reveal })}`, `${base}.xlsx`)}>
              {busy ? 'Preparing...' : 'Download whole snapshot (XLSX)'}
            </button>
          </div>
          <div className="split">
            <aside>
              <input type="search" placeholder="Find a table" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <ul className="tables">
                {tables.map((t) => (
                  <li key={t.name} className={t.name === table ? 'on' : ''}>
                    <a href={`#/s/${encodeURIComponent(id)}/t/${encodeURIComponent(t.name)}`}>
                      <span>{t.name}</span><span className="num">{t.rows.toLocaleString()}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="main">
              {table ? <TableGrid key={`${id}/${table}`} id={id} table={table} reveal={reveal} save={save} /> : <p className="muted">Choose a table on the left. Snapshots are read-only.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function TableGrid({ id, table, reveal, save }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ col: '', dir: 'asc' });
  const [page, setPage] = useState(1);
  const size = 100;
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading } = useLoad(
    () => api(`snapshots/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}${qs({ page, size, q: query, sort: sort.col, dir: sort.dir, reveal })}`),
    [id, table, page, query, sort.col, sort.dir, reveal],
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  const flip = (col) => { setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })); setPage(1); };

  return (
    <div>
      <div className="toolbar">
        <h3>{table}</h3>
        <input type="search" placeholder="Filter rows" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" onClick={() => save(`snapshots/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/csv${qs({ reveal })}`, `${id.replace(/\.dump$/, '')}__${table}.csv`)}>Download CSV</button>
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.name} onClick={() => flip(c.name)} title={`${c.type}${c.mask ? ' - masked' : ''}`}>
                      {c.name}{data.pk.includes(c.name) ? ' (key)' : ''}{sort.col === c.name ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={i}>{r.map((v, j) => <td key={data.columns[j].name}><Cell value={v} mask={data.mask} /></td>)}</tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <p className="muted pad">{loading ? 'Loading...' : 'No rows.'}</p>}
          </div>
          <Pager page={page} pages={pages} total={data.total} onPage={setPage} />
        </>
      )}
      {loading && !data && <p className="muted">Loading...</p>}
    </div>
  );
}

function Pager({ page, pages, total, onPage }) {
  return (
    <div className="pager">
      <span className="muted">{total.toLocaleString()} rows</span>
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

// ---- a comparison -------------------------------------------------------------------------------------------------
function CompareView({ keyId, table }) {
  const { data, error, loading } = useLoad(() => api(`compare/${keyId}`), [keyId]);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState(null);
  const xlsx = async () => {
    setBusy(true);
    setDlError(null);
    try { await download(`compare/${keyId}/xlsx${qs({ reveal })}`, `compare__${data.a.id.replace(/\.dump$/, '')}__${data.b.id.replace(/\.dump$/, '')}.xlsx`); } catch (e) { setDlError(e); }
    setBusy(false);
  };
  const sch = data?.schema;
  return (
    <section>
      <p><a href="#/">&larr; All snapshots</a></p>
      <h2>Comparison</h2>
      <ErrorBox error={error || dlError} />
      {loading && <p className="muted">Loading...</p>}
      {data && (
        <>
          <p>
            <strong>A</strong> {data.a.time_ist} IST <span className="muted">({KIND_LABEL[data.a.kind]})</span>
            {'  '}&rarr;{'  '}
            <strong>B</strong> {data.b.time_ist} IST <span className="muted">({KIND_LABEL[data.b.kind]})</span>
          </p>
          <div className="toolbar">
            <span className="stat"><b>{data.totals.tables_changed}</b> of {data.totals.tables_compared} tables changed</span>
            <span className="stat add">+{data.totals.added}</span><span className="stat rem">&minus;{data.totals.removed}</span><span className="stat chg">~{data.totals.changed}</span>
            <label className="check"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Show personal identifiers (logged)</label>
            <button type="button" className="btn" disabled={busy} onClick={xlsx}>{busy ? 'Preparing...' : 'Download comparison (XLSX)'}</button>
          </div>
          {(sch.migrations_added.length > 0 || sch.migrations_removed.length > 0 || sch.tables_added.length > 0 || sch.tables_removed.length > 0 || sch.columns.length > 0) && (
            <details className="schema" open>
              <summary>Schema changes</summary>
              {sch.migrations_added.length > 0 && <p>Migrations added: {sch.migrations_added.join(', ')}</p>}
              {sch.migrations_removed.length > 0 && <p>Migrations removed: {sch.migrations_removed.join(', ')}</p>}
              {sch.tables_added.length > 0 && <p>Tables added: {sch.tables_added.join(', ')}</p>}
              {sch.tables_removed.length > 0 && <p>Tables removed: {sch.tables_removed.join(', ')}</p>}
              {sch.columns.map((c) => <p key={c.table}>{c.table}: {c.added.length > 0 && `columns added ${c.added.join(', ')}`} {c.removed.length > 0 && `columns removed ${c.removed.join(', ')}`}</p>)}
            </details>
          )}
          <div className="split">
            <aside>
              <ul className="tables">
                {data.tables.map((t) => (
                  <li key={t.name} className={t.name === table ? 'on' : ''}>
                    <a href={`#/c/${keyId}/t/${encodeURIComponent(t.name)}`}>
                      <span>{t.name}</span>
                      <span className="counts"><i className="add">+{t.added}</i> <i className="rem">&minus;{t.removed}</i> <i className="chg">~{t.changed}</i></span>
                    </a>
                  </li>
                ))}
                {data.tables.length === 0 && <li className="muted pad">No differences.</li>}
              </ul>
            </aside>
            <div className="main">
              {table ? <DiffTable key={`${keyId}/${table}`} keyId={keyId} table={table} summary={data.tables.find((t) => t.name === table)} reveal={reveal} /> : <p className="muted">Choose a table on the left to see its rows.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function DiffTable({ keyId, table, summary, reveal }) {
  const first = summary && (summary.changed ? 'changed' : summary.added ? 'added' : 'removed');
  const [kind, setKind] = useState(first || 'changed');
  const [page, setPage] = useState(1);
  const size = 100;
  const { data, error, loading } = useLoad(() => api(`compare/${keyId}/tables/${encodeURIComponent(table)}${qs({ kind, page, size, reveal })}`), [keyId, table, kind, page, reveal]);
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;

  return (
    <div>
      <div className="toolbar">
        <h3>{table}</h3>
        {['added', 'removed', 'changed'].map((k) => (
          <button key={k} type="button" className={`btn tab ${k} ${kind === k ? 'on' : ''}`} onClick={() => { setKind(k); setPage(1); }} disabled={!summary || !summary[k]}>
            {k} {summary ? summary[k] : 0}
          </button>
        ))}
      </div>
      {summary && !summary.keyed && <p className="muted">This table has no primary key, so rows are compared as a whole: a row that was edited shows as one removed and one added.</p>}
      {summary && summary.truncated && <p className="muted">Very large change: the list shows the first rows only. The counts are complete.</p>}
      <ErrorBox error={error} />
      {data && data.kind !== 'changed' && (
        <div className="grid-wrap">
          <table className={`grid ${data.kind}`}>
            <thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{data.items.map((it, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={i}>{data.columns.map((c) => <td key={c}><Cell value={it.row[c] ?? null} mask={MASK} /></td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {data && data.kind === 'changed' && (
        <div className="grid-wrap">
          <table className="grid">
            <thead><tr><th>{data.pk.length ? data.pk.join(' | ') : 'row'}</th><th>Column</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {data.items.flatMap((it) => it.changes.map((c, i) => (
                <tr key={`${JSON.stringify(it.key)}-${c.col}`} className="chg-row">
                  {i === 0 && <td rowSpan={it.changes.length} className="key">{(it.key || []).join(' | ')}</td>}
                  <td>{c.col}</td>
                  {c.masked
                    ? <td colSpan={2}><span className="masked">changed (value hidden)</span></td>
                    : (<><td className="old"><Cell value={c.old} mask={MASK} /></td><td className="new"><Cell value={c.new} mask={MASK} /></td></>)}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} pages={pages} total={data.total} onPage={setPage} />}
      {loading && !data && <p className="muted">Loading...</p>}
    </div>
  );
}

// ---- shell --------------------------------------------------------------------------------------------------------
export default function App() {
  const hash = useHash();
  const me = useLoad(() => api('me'), []);
  const parts = hash.split('/').filter(Boolean);
  const route = parts[0];
  const dec = useCallback((i) => (parts[i] ? decodeURIComponent(parts[i]) : null), [hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  let body;
  if (me.error) body = <ErrorBox error={me.error} />;
  else if (me.loading) body = <p className="muted">Checking your login...</p>;
  else if (route === 's' && dec(1)) body = <SnapshotView id={dec(1)} table={parts[2] === 't' ? dec(3) : null} />;
  else if (route === 'c' && dec(1)) body = <CompareView keyId={dec(1)} table={parts[2] === 't' ? dec(3) : null} />;
  else body = <Snapshots me={me.data} />;

  return (
    <>
      <header>
        <a className="brand" href="#/">Database snapshots</a>
        <span className="note">Snapshots are read-only. Nothing here can write to any database.</span>
        <span className="who">{me.data ? `${me.data.user.name} (${me.data.user.email})` : ''}</span>
        <a href="/" className="btn">Back to Delphic</a>
      </header>
      <main>{body}</main>
    </>
  );
}
