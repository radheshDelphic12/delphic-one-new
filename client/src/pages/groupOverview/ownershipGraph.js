// Group Dashboard > Companies & Stakes: the ownership graph behind the group chart (pure functions, no React).
//
// Nodes: the holding group (one per group), outside holders, and the businesses of the register. Edges: holder -> held business with the
// stake %. Only businesses that take part in ownership (they have a holder, or hold another business) are drawn; the rest are listed as
// "ownership not set". The status filter decides which businesses are shown; a holder of a shown business that the filter would hide stays
// as a dimmed "context" node, so the structure above it is never cut off.

export const STATUSES = ['operational', 'planning', 'future'];

const extKey = (name) => `ext:${String(name || '').trim().toLowerCase()}`;

export function buildOwnershipGraph(companies, groups, statuses = STATUSES) {
  const wanted = new Set(statuses);
  const byId = new Map(companies.map((c) => [c.id, c]));
  const groupName = (id) => groups.find((g) => g.id === id)?.name || groups[0]?.name || 'The group';

  // holders[companyId] = [{ key, kind, label, pct }]
  const holdersOf = new Map();
  const holdsSomething = new Set();
  for (const c of companies) {
    holdersOf.set(c.id, c.holders.map((h) => {
      if (h.holder_kind === 'company') { holdsSomething.add(h.holder_company_id); return { key: `company:${h.holder_company_id}`, kind: 'company', label: h.holder_label, pct: h.pct }; }
      if (h.holder_kind === 'group') { const gid = h.holder_group_id || c.org_group_id; return { key: `group:${gid || ''}`, kind: 'group', label: groupName(gid), pct: h.pct }; }
      return { key: extKey(h.holder_name), kind: 'external', label: h.holder_name || h.holder_label, pct: h.pct };
    }));
  }

  const takesPart = (c) => c.holders.length > 0 || holdsSomething.has(c.id);
  const visible = new Set(companies.filter((c) => wanted.has(c.status) && takesPart(c)).map((c) => c.id));
  const unattached = companies.filter((c) => wanted.has(c.status) && !takesPart(c));

  // Holders of a shown business stay (dimmed) even when the filter hides them.
  const context = new Set();
  const stack = [...visible];
  while (stack.length) {
    const id = stack.pop();
    for (const h of holdersOf.get(id) || []) {
      if (h.kind !== 'company') continue;
      const hid = h.key.slice(8);
      if (!visible.has(hid) && !context.has(hid) && byId.has(hid)) { context.add(hid); stack.push(hid); }
    }
  }

  const nodes = new Map();
  const edges = [];
  const ensure = (key, node) => { if (!nodes.has(key)) nodes.set(key, { id: key, ...node }); return nodes.get(key); };
  for (const id of [...visible, ...context]) {
    const c = byId.get(id);
    ensure(`company:${id}`, { kind: 'company', label: c.name, status: c.status, company: c, context: context.has(id), total_pct: c.total_pct });
    for (const h of holdersOf.get(id)) {
      if (h.kind === 'company' && !visible.has(h.key.slice(8)) && !context.has(h.key.slice(8))) continue;
      ensure(h.key, h.kind === 'company' ? { kind: 'company', label: h.label } : { kind: h.kind, label: h.label });
      edges.push({ from: h.key, to: `company:${id}`, pct: h.pct });
    }
  }
  // a holder that is itself a company node was created above with its own data; make sure context holders carry their company
  for (const n of nodes.values()) if (n.kind === 'company' && !n.company) { const c = byId.get(n.id.slice(8)); if (c) Object.assign(n, { company: c, status: c.status, total_pct: c.total_pct, context: context.has(c.id) }); }

  // level = longest holder chain above the node (group / outside holders are 0)
  const parents = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const e of edges) parents.get(e.to).push(e.from);
  const memo = new Map();
  const levelOf = (key, seen = new Set()) => {
    if (memo.has(key)) return memo.get(key);
    if (seen.has(key)) return 0; // a loop is refused by the server; never recurse forever
    seen.add(key);
    const ps = parents.get(key) || [];
    const level = ps.length ? 1 + Math.max(...ps.map((p) => levelOf(p, seen))) : 0;
    memo.set(key, level);
    return level;
  };
  for (const n of nodes.values()) n.level = levelOf(n.id);

  const levels = [];
  for (const n of nodes.values()) (levels[n.level] ||= []).push(n);
  // order each level by where its holders sit (fewer crossing lines), first level by name
  levels.forEach((row, li) => {
    if (li === 0) { row.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'group' ? -1 : b.kind === 'group' ? 1 : 0)); }
    else {
      const idx = new Map(levels[li - 1].map((n, i) => [n.id, i]));
      const center = (n) => { const ps = (parents.get(n.id) || []).map((p) => idx.get(p)).filter((v) => v != null); return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : 1e9; };
      row.sort((a, b) => center(a) - center(b) || a.label.localeCompare(b.label));
    }
    row.forEach((n, i) => { n.order = i; });
  });

  return { nodes: [...nodes.values()], edges, levels, unattached };
}

/** Top-down chart: one row per level, nodes centred, edges drawn from the holder's bottom to the business's top. */
export function layoutTree(graph, { nodeW = 178, nodeH = 58, gapX = 26, gapY = 96, pad = 24 } = {}) {
  const rows = graph.levels.filter(Boolean);
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const width = pad * 2 + widest * nodeW + (widest - 1) * gapX;
  const height = pad * 2 + rows.length * nodeH + Math.max(0, rows.length - 1) * gapY;
  const pos = new Map();
  rows.forEach((row, li) => {
    const rowW = row.length * nodeW + (row.length - 1) * gapX;
    const x0 = (width - rowW) / 2;
    row.forEach((n, i) => pos.set(n.id, { x: x0 + i * (nodeW + gapX), y: pad + li * (nodeH + gapY), w: nodeW, h: nodeH }));
  });
  return { width, height, pos, edges: graph.edges.map((e) => ({ ...e, a: anchor(pos.get(e.from), 'bottom'), b: anchor(pos.get(e.to), 'top') })) };
}

function anchor(box, side) {
  return { x: box.x + box.w / 2, y: side === 'bottom' ? box.y + box.h : box.y };
}

/**
 * Circular chart: the holding group in the middle (when there is exactly one), outside holders and the group's direct businesses on the
 * first ring, and every further ownership level on its own ring. A business sits next to its holder, so the lines stay short.
 */
export function layoutRadial(graph, { nodeW = 160, nodeH = 50, ringGap = 215, pad = 30 } = {}) {
  const parentsOf = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) parentsOf.get(e.to).push(e.from);
  const roots = graph.nodes.filter((n) => !parentsOf.get(n.id).length);
  const groupRoots = roots.filter((n) => n.kind === 'group');
  const center = groupRoots.length === 1 ? groupRoots[0] : null;

  // ring = distance from the centre: group 0, its businesses and outside holders 1, and so on down the holder chain
  const ringMemo = new Map();
  const ringOf = (n, seen = new Set()) => {
    if (ringMemo.has(n.id)) return ringMemo.get(n.id);
    if (seen.has(n.id)) return 1;
    seen.add(n.id);
    const ps = parentsOf.get(n.id);
    let ring;
    if (center) ring = n === center ? 0 : ps.length ? 1 + Math.max(...ps.map((p) => ringOf(graph.nodes.find((x) => x.id === p), seen))) : 1;
    else ring = n.level;
    ringMemo.set(n.id, ring);
    return ring;
  };
  const rows = [];
  for (const n of graph.nodes) (rows[ringOf(n)] ||= []).push(n);
  const rings = rows.map((r, i) => (r ? i : null)).filter((i) => i != null);

  const radii = new Map();
  let prev = -ringGap;
  for (const ring of rings) {
    const row = rows[ring];
    if (ring === 0 && row.length === 1) { radii.set(0, 0); prev = 0; continue; }
    const need = (row.length * (nodeW + 14)) / (2 * Math.PI);
    const r = Math.max(prev + ringGap, need);
    radii.set(ring, r);
    prev = r;
  }
  const maxR = Math.max(0, ...radii.values());
  const size = Math.max((maxR + nodeW / 2 + pad) * 2, nodeW + pad * 2);
  const cx = size / 2;
  const cy = size / 2;
  const pos = new Map();
  const angleOf = new Map();
  const meanAngle = (ids) => {
    const a = ids.map((id) => angleOf.get(id)).filter((v) => v != null);
    return a.length ? Math.atan2(a.reduce((t, v) => t + Math.sin(v), 0), a.reduce((t, v) => t + Math.cos(v), 0)) : null;
  };

  for (const ring of rings) {
    const row = rows[ring];
    const r = radii.get(ring);
    if (r === 0) { pos.set(row[0].id, { x: cx - nodeW / 2, y: cy - nodeH / 2, w: nodeW, h: nodeH }); angleOf.set(row[0].id, 0); continue; }
    const minStep = (nodeW + 14) / r;
    const want = row.map((n) => meanAngle(parentsOf.get(n.id)));
    let angles;
    if (ring === 1 || want.every((a) => a == null)) {
      // the first ring is spread evenly, starting at the top
      angles = row.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / row.length);
    } else {
      // later rings: each business at its holder's angle, pushed apart just enough not to overlap
      const order = row.map((_, i) => i).sort((a, b) => (want[a] ?? 0) - (want[b] ?? 0));
      angles = new Array(row.length);
      let last = -Infinity;
      for (const idx of order) {
        const a = Math.max(want[idx] ?? last + minStep, last + minStep);
        angles[idx] = a;
        last = a;
      }
      const shift = order.reduce((t, idx) => t + ((want[idx] ?? angles[idx]) - angles[idx]), 0) / order.length;
      angles = angles.map((a) => a + shift);
    }
    row.forEach((n, i) => {
      angleOf.set(n.id, angles[i]);
      pos.set(n.id, { x: cx + r * Math.cos(angles[i]) - nodeW / 2, y: cy + r * Math.sin(angles[i]) - nodeH / 2, w: nodeW, h: nodeH });
    });
  }
  const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  return { width: size, height: size, pos, edges: graph.edges.map((e) => ({ ...e, a: mid(pos.get(e.from)), b: mid(pos.get(e.to)) })), radii: [...radii.values()], cx, cy };
}
