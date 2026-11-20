import { AnimatePresence, motion } from 'framer-motion';
import Skeleton from './Skeleton.jsx';

/**
 * Harmonious data table with optional row click, selection, and floating action bar.
 *
 * On screens narrower than 1024px (phones and tablets with the side menu open) the table is shown as one card per row instead:
 * the first column is the card's title, every other column becomes a "label / value" pair, and a column with no header (usually
 * the row's action buttons) sits at the bottom of the card. The same columns, render functions, row click and selection are used,
 * so a page needs no change.
 *
 * Args:
 *   columns: Column defs { key, header, render? }.
 *   rows: Row objects with id.
 *   loading: Show loading row.
 *   emptyLabel: Empty-state text.
 *   onRowClick: Called with the row when a body row is clicked.
 *   selectable: Enable checkboxes + floating action bar.
 *   selectedIds: Controlled selected id set (array).
 *   onSelectionChange: Called with next selected id array.
 *   actions: [{ key, label, onClick, danger? }] for the floating bar.
 *   rowSelectable: (row) => boolean. Rows it refuses get a greyed-out checkbox and are left out of "select all" (default: every row).
 */
export default function DataTable({
  columns,
  rows,
  loading,
  emptyLabel = 'No records found',
  onRowClick,
  selectable = false,
  rowSelectable = () => true,
  selectedIds = [],
  onSelectionChange,
  actions = [],
  headerClassName = 'bg-white',
  striped = false,
  embedded = false,
  // When set, the table body scrolls inside this height while the header row
  // (`thead` is `sticky top-0`) and everything above the table stay put.
  maxHeight,
}) {
  const selected = new Set(selectedIds);
  const allIds = rows.filter((r) => rowSelectable(r)).map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : allIds);
  }

  function toggleOne(id) {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  }

  const displayColumns = selectable
    ? [{ key: '_select', header: '', render: null }, ...columns]
    : columns;

  // Phone cards: the first column is the title, columns with a header are label/value pairs, header-less ones are the action row.
  const hasHeader = (col) => col.header !== undefined && col.header !== null && col.header !== '';
  const [titleCol, ...restCols] = columns;
  const fieldCols = restCols.filter(hasHeader);
  const actionCols = restCols.filter((col) => !hasHeader(col));
  const cell = (col, row) => (col.render ? col.render(row) : row[col.key]);
  const frame = embedded ? '' : 'rounded-2xl border border-tertiary-100 shadow-card';

  return (
    <>
      <div
        className={`hidden overflow-x-auto bg-white lg:block ${maxHeight ? 'overflow-y-auto overscroll-contain' : ''} ${frame}`}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="min-w-full divide-y divide-tertiary-100">
          <thead className={`sticky top-0 z-10 border-b border-tertiary-100 ${headerClassName}`}>
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                    className="rounded border-tertiary-300 text-primary-600"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-tertiary-500"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-tertiary-100 bg-white">
            {loading &&
              Array.from({ length: 6 }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`}>
                  {displayColumns.map((col, colIndex) => (
                    <td key={col.key || colIndex} className="px-4 py-1.5">
                      <Skeleton className="h-4 w-full max-w-[10rem]" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={displayColumns.length} className="px-4 py-8 text-center text-sm text-tertiary-400">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-tertiary-50/80 ${onRowClick ? 'cursor-pointer' : ''} ${
                    selected.has(row.id) ? 'bg-primary-50/40' : striped && rowIndex % 2 === 1 ? 'bg-canvas-muted/60' : 'bg-white'
                  }`}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable && (
                    <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        disabled={!rowSelectable(row)}
                        aria-label={`Select row ${row.id}`}
                        className="rounded border-tertiary-300 text-primary-600"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-1.5 text-sm text-tertiary-700">
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Phones and tablets: one card per row. */}
      <div className="lg:hidden" data-testid="data-cards">
        {loading && (
          <ul className={`divide-y divide-tertiary-100 bg-white ${frame}`}>
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={`card-skeleton-${i}`} className="space-y-2 px-4 py-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </li>
            ))}
          </ul>
        )}
        {!loading && rows.length === 0 && (
          <p className={`bg-white px-4 py-8 text-center text-sm text-tertiary-400 ${frame}`}>{emptyLabel}</p>
        )}
        {!loading && rows.length > 0 && (
          <ul className={`divide-y divide-tertiary-100 overflow-hidden bg-white ${frame}`}>
            {selectable && (
              <li className="flex items-center gap-2 bg-canvas-muted px-4 py-2 text-xs font-medium text-tertiary-600">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all rows" className="h-4 w-4 rounded border-tertiary-300 text-primary-600" />
                Select all
              </li>
            )}
            {rows.map((row, rowIndex) => (
              <li
                key={row.id}
                className={`space-y-3 px-4 py-4 ${onRowClick ? 'cursor-pointer active:bg-tertiary-50' : ''} ${
                  selected.has(row.id) ? 'bg-primary-50/40' : striped && rowIndex % 2 === 1 ? 'bg-canvas-muted/60' : 'bg-white'
                }`}
                onClick={() => onRowClick?.(row)}
              >
                <div className="flex items-start gap-3">
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      disabled={!rowSelectable(row)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select row ${row.id}`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-tertiary-300 text-primary-600"
                    />
                  )}
                  <div className="min-w-0 flex-1 break-words text-sm font-medium text-tertiary-900">{titleCol ? cell(titleCol, row) : null}</div>
                </div>
                {fieldCols.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                    {fieldCols.map((col) => (
                      <div key={col.key} className="min-w-0">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">{col.header}</dt>
                        <dd className="mt-0.5 break-words text-tertiary-800">{cell(col, row) ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {actionCols.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-tertiary-100 pt-3" onClick={(e) => e.stopPropagation()}>
                    {actionCols.map((col) => <span key={col.key} className="contents">{cell(col, row)}</span>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {selectable && selected.size > 0 && actions.length > 0 && (
          <motion.div
            className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border bg-tertiary-900 px-4 py-2.5 text-sm text-white shadow-drawer"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
          >
            <span className="mr-2 text-xs text-tertiary-300">{selected.size} selected</span>
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                  action.danger
                    ? 'bg-danger-600 hover:bg-danger-700'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
                onClick={() => action.onClick([...selected])}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-tertiary-300 transition-colors hover:bg-white/10"
              onClick={() => onSelectionChange?.([])}
            >
              Discard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
