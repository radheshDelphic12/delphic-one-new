import assert from 'node:assert/strict';
import { buildOwnershipGraph, layoutRadial, layoutTree } from './ownershipGraph.js';

const groups = [{ id: 'g1', name: 'Gulati Industries Group' }];
const co = (id, name, status, holders = []) => ({ id, name, status, org_group_id: 'g1', total_pct: holders.reduce((s, h) => s + h.pct, 0), holders: holders.map((h, i) => ({ id: `${id}-${i}`, holder_label: h.label, ...h })) });
const grp = (pct) => ({ holder_kind: 'group', label: 'Gulati Industries Group', pct });
const hold = (id, label, pct) => ({ holder_kind: 'company', holder_company_id: id, label, pct });
const ext = (name, pct) => ({ holder_kind: 'external', holder_name: name, label: name, pct });

const companies = [
  co('dg', 'Delphic Global', 'operational', [grp(100)]),
  co('do', 'Delphic One', 'operational', [hold('dg', 'Delphic Global', 100)]),
  co('ds', 'Delphic Secure', 'planning', [hold('dg', 'Delphic Global', 100)]),
  co('zs', 'Zklyrera Spirits', 'operational', [grp(100)]),
  co('vi', 'Velon International', 'future', [hold('zs', 'Zklyrera Spirits', 30), ext('Mr Shah', 20)]),
  co('ge', 'Gulati Enterprises', 'operational', []),
  co('zi', 'Zephyr Infrastructure', 'operational', []),
];

// all statuses: the participants are drawn, the rest listed as "ownership not set"
let g = buildOwnershipGraph(companies, groups);
assert.deepEqual(g.unattached.map((c) => c.name).sort(), ['Gulati Enterprises', 'Zephyr Infrastructure']);
const level = (id) => g.nodes.find((n) => n.id === id).level;
assert.equal(level('group:g1'), 0);
assert.equal(level('company:dg'), 1);
assert.equal(level('company:do'), 2);
assert.equal(level('company:vi'), 2);
assert.equal(level('ext:mr shah'), 0);
assert.equal(g.edges.length, 6);
assert.deepEqual(g.edges.find((e) => e.to === 'company:vi' && e.from === 'company:zs'), { from: 'company:zs', to: 'company:vi', pct: 30 });

// only operational: Delphic Secure (planning) and Velon (future) are hidden; their holders are not
g = buildOwnershipGraph(companies, groups, ['operational']);
assert.ok(!g.nodes.some((n) => n.id === 'company:ds' || n.id === 'company:vi'));
assert.ok(g.nodes.some((n) => n.id === 'company:do'));
assert.equal(g.nodes.find((n) => n.id === 'company:do').context, false);

// only future: Velon is shown, its holder Zklyrera (operational) stays as a dimmed context node, and so does the group above it
g = buildOwnershipGraph(companies, groups, ['future']);
assert.equal(g.nodes.find((n) => n.id === 'company:vi').context, false);
assert.equal(g.nodes.find((n) => n.id === 'company:zs').context, true);
assert.ok(g.nodes.some((n) => n.id === 'group:g1'));

// no status chosen: nothing is shown
g = buildOwnershipGraph(companies, groups, []);
assert.equal(g.nodes.length, 0);
assert.equal(g.unattached.length, 0);

// layouts put every node inside the canvas, and a child below / outside its holder
g = buildOwnershipGraph(companies, groups);
const tree = layoutTree(g);
for (const n of g.nodes) {
  const p = tree.pos.get(n.id);
  assert.ok(p.x >= 0 && p.x + p.w <= tree.width && p.y >= 0 && p.y + p.h <= tree.height, `${n.id} inside the tree canvas`);
}
for (const e of tree.edges) assert.ok(e.b.y > e.a.y, 'a business sits below its holder');
const radial = layoutRadial(g);
for (const n of g.nodes) {
  const p = radial.pos.get(n.id);
  assert.ok(p.x >= 0 && p.x + p.w <= radial.width && p.y >= 0 && p.y + p.h <= radial.height, `${n.id} inside the circle canvas`);
}
// a single root sits in the middle
g = buildOwnershipGraph([companies[0], companies[1], companies[2]], groups);
const r = layoutRadial(g);
const root = r.pos.get('group:g1');
assert.ok(Math.abs(root.x + root.w / 2 - r.cx) < 0.001 && Math.abs(root.y + root.h / 2 - r.cy) < 0.001);
console.log('ownershipGraph ok');
