import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

// Sizes in px. The whole chart is laid out here in JS (not CSS flow) so the
// connector arrows can be drawn between exact points in one SVG.
const C = 64; // person circle diameter
const R = C / 2;
const GAP = 12; // between circles inside a box
const PAD = 16; // box padding
const LABEL = 24; // the team-name row between the members and the lead
const H_GAP = 40; // between sibling units
const V_GAP = 72; // between tree rows
const ROOT_W = 116;
const ROOT_H = 30;
const ROOT_STUB = 34; // the line running into the company node from below
const MAX_COLS = 4;
const LAST = Number.MAX_SAFE_INTEGER;

function flatten(roots) {
  const flat = [];
  const walk = (node) => {
    flat.push(node);
    node.direct_reports?.forEach(walk);
  };
  roots.forEach(walk);
  return flat;
}

const nameOf = (node) => node?.person?.name || '';
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));

// A box: members in a grid, then the team-name row, then the lead (if any)
// centred at the bottom — the lead's seat may be a vacancy.
function sizeBox(unit) {
  const n = unit.members.length;
  const cols = Math.max(1, Math.min(MAX_COLS, n));
  const rows = n ? Math.ceil(n / cols) : 0;
  unit.cols = cols;
  unit.width = Math.max(cols * C + (cols - 1) * GAP, C, 132) + PAD * 2;
  unit.height = PAD + (rows ? rows * C + (rows - 1) * GAP : 0) + LABEL + (unit.lead ? C : 0) + PAD;
}

/**
 * Turns the org chart payload into positioned units, company at the bottom:
 *   manager  — a person outside any team whom a team (or someone) reports to
 *   team     — HR Settings → Teams: members over the team name over the lead;
 *              open positions are vacant seats (the lead's first, if no lead)
 *   reports  — people with a manager but no team, boxed under that manager
 *   floating — drawn above the tree, unconnected: teams with neither a lead
 *              nor a reports-to manager, Contractors, and Not in a team
 * A team hangs off its reports-to manager, else its lead's manager; a person
 * off their manager. Siblings run left to right by team display order (a
 * manager takes the lowest order among the teams under them), then by name.
 * Reporting cycles or a missing manager fall back to the company.
 */
export function layoutTeamChart({ roots, teams = [] }, companyName) {
  const people = flatten(roots);
  const byId = new Map(people.map((p) => [p.id, p]));
  const units = [];
  const floatTeams = [];
  const home = new Map(); // person id -> unit that draws them

  for (const team of teams) {
    const lead = byId.get(team.lead_membership_id) || null;
    const members = people.filter((p) => p.team_id === team.id && p.id !== lead?.id).sort(byName);
    let vacancies = team.open_positions || 0;
    const leadSeat = lead || (vacancies > 0 ? { vacant: true } : null);
    if (!lead && vacancies > 0) vacancies -= 1;
    const seats = [...members, ...Array.from({ length: vacancies }, () => ({ vacant: true }))];
    if (!lead && seats.length === 0 && !leadSeat) continue;
    const managerId = team.manager_membership_id && byId.has(team.manager_membership_id) ? team.manager_membership_id : lead?.manager_id;
    const unit = { id: `team:${team.id}`, kind: 'team', label: team.name, lead: leadSeat, members: seats, managerId, order: team.sort_order ?? 0 };
    if (!managerId || !byId.has(managerId)) {
      unit.kind = 'floating';
      floatTeams.push(unit);
    } else {
      units.push(unit);
    }
    if (lead && !home.has(lead.id)) home.set(lead.id, unit);
    members.forEach((m) => { if (!home.has(m.id)) home.set(m.id, unit); });
  }

  const loose = people.filter((p) => !home.has(p.id)).sort(byName);
  const managerIds = new Set(units.map((u) => u.managerId));
  loose.forEach((p) => { if (p.manager_id && byId.has(p.manager_id)) managerIds.add(p.manager_id); });

  for (const person of loose) {
    if (!managerIds.has(person.id)) continue;
    const unit = { id: `mgr:${person.id}`, kind: 'manager', person, managerId: person.manager_id };
    units.push(unit);
    home.set(person.id, unit);
  }

  const reportsBoxes = new Map();
  const contractors = [];
  const unassigned = [];
  for (const person of loose) {
    if (home.has(person.id)) continue;
    if (person.manager_id && byId.has(person.manager_id)) {
      if (!reportsBoxes.has(person.manager_id)) {
        const unit = { id: `reports:${person.manager_id}`, kind: 'reports', label: 'Direct reports', lead: null, members: [], managerId: person.manager_id, order: LAST };
        reportsBoxes.set(person.manager_id, unit);
        units.push(unit);
      }
      reportsBoxes.get(person.manager_id).members.push(person);
    } else if (person.worker_type === 'contractor') {
      contractors.push(person);
    } else {
      unassigned.push(person);
    }
  }

  const root = { id: 'root', kind: 'root', label: companyName, width: ROOT_W, height: ROOT_H, children: [] };
  const parent = new Map();
  for (const u of units) {
    const target = home.get(u.managerId);
    parent.set(u.id, target && target !== u ? target : root);
  }
  // Break reporting cycles (A → B → A): the first unit that revisits hangs off the company.
  for (const u of units) {
    const seen = new Set([u.id]);
    let p = parent.get(u.id);
    while (p && p !== root) {
      if (seen.has(p.id)) { parent.set(u.id, root); break; }
      seen.add(p.id);
      p = parent.get(p.id);
    }
  }

  for (const u of units) {
    u.children = [];
    if (u.kind === 'manager') { u.width = C; u.height = C; } else sizeBox(u);
  }
  for (const u of units) parent.get(u.id).children.push(u);

  // Sibling order: a unit's rank is its own team order, or the lowest among
  // the teams below it — so a manager sits where their first team belongs.
  const rank = (u) => {
    if (u.rank !== undefined) return u.rank;
    u.rank = Math.min(u.kind === 'team' ? u.order : LAST, ...u.children.map(rank));
    return u.rank;
  };
  const label = (u) => u.label || nameOf(u.person);
  const sortChildren = (u) => {
    u.children.forEach(sortChildren);
    u.children.sort((a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b)));
  };
  root.children.forEach(rank);
  sortChildren(root);

  // Tidy tree, company at the bottom: each subtree is as wide as its children
  // side by side (or itself, if wider); a parent sits centred under them.
  const rowHeight = [];
  const measure = (u, depth) => {
    u.depth = depth;
    rowHeight[depth] = Math.max(rowHeight[depth] || 0, u.height);
    const kids = u.children.reduce((sum, c) => sum + measure(c, depth + 1), 0) + H_GAP * Math.max(0, u.children.length - 1);
    u.span = Math.max(u.width, kids);
    return u.span;
  };
  measure(root, 0);

  floatTeams.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const floatBoxes = [
    ...floatTeams,
    { id: 'float:contractors', kind: 'floating', contractor: true, label: 'Contractor', lead: null, members: contractors },
    { id: 'float:unassigned', kind: 'floating', label: 'Not in a team', lead: null, members: unassigned },
  ].filter((b) => b.members.length > 0 || b.lead);
  floatBoxes.forEach(sizeBox);
  const floatH = floatBoxes.reduce((m, b) => Math.max(m, b.height), 0);

  const rowBottom = [];
  let y = (floatH ? floatH + V_GAP : 0) + rowHeight.slice(1).reduce((s, h) => s + h + V_GAP, 0) + ROOT_H;
  for (let d = 0; d < rowHeight.length; d += 1) {
    rowBottom[d] = y;
    y -= rowHeight[d] + V_GAP;
  }
  const height = rowBottom[0] + ROOT_STUB;

  const place = (u, left) => {
    const kidsW = u.children.reduce((s, c) => s + c.span, 0) + H_GAP * Math.max(0, u.children.length - 1);
    let x = left + (u.span - kidsW) / 2;
    for (const c of u.children) {
      place(c, x);
      x += c.span + H_GAP;
    }
    u.x = left + (u.span - u.width) / 2;
    u.y = rowBottom[u.depth] - u.height;
  };
  place(root, 0);

  let fx = 0;
  for (const b of floatBoxes) {
    b.x = fx;
    b.y = 0;
    fx += b.width + H_GAP;
  }

  // Circle centres for every seat drawn in a box.
  const positionBox = (b) => {
    const gridW = b.cols * C + (b.cols - 1) * GAP;
    const startX = b.x + (b.width - gridW) / 2;
    const rows = b.members.length ? Math.ceil(b.members.length / b.cols) : 0;
    b.circles = b.members.map((seat, i) => ({
      seat,
      cx: startX + (i % b.cols) * (C + GAP) + R,
      cy: b.y + PAD + Math.floor(i / b.cols) * (C + GAP) + R,
    }));
    b.labelY = b.y + PAD + (rows ? rows * C + (rows - 1) * GAP : 0) + LABEL / 2;
    if (b.lead) b.leadCircle = { seat: b.lead, cx: b.x + b.width / 2, cy: b.y + b.height - PAD - R };
  };
  units.filter((u) => u.kind !== 'manager').forEach(positionBox);
  floatBoxes.forEach(positionBox);

  // Arrow ends: a circle's centre with its radius (the arrow stops at the
  // rim), a box's edge, or the company node.
  const lowerEnd = (u) => {
    if (u.kind === 'manager') return { x: u.x + R, y: u.y + R, r: R };
    if (u.leadCircle) return { x: u.leadCircle.cx, y: u.leadCircle.cy, r: R };
    return { x: u.x + u.width / 2, y: u.y + u.height, r: 0 };
  };
  const upperEnd = (u) => {
    if (u.kind === 'root') return { x: u.x + u.width / 2, y: u.y, r: 0 };
    if (u.kind === 'manager') return { x: u.x + R, y: u.y + R, r: R };
    // A box's members sit above its lead, so a unit hanging off it leaves
    // from the box's top edge instead of crossing them.
    return { x: u.x + u.width / 2, y: u.y, r: 0 };
  };
  // From → to, trimmed to each end's rim; the arrowhead sits at `to`.
  const arrow = (id, from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    return { id, x1: from.x + ux * from.r, y1: from.y + uy * from.r, x2: to.x - ux * to.r, y2: to.y - uy * to.r };
  };
  const lines = units.map((u) => arrow(u.id, upperEnd(parent.get(u.id)), lowerEnd(u)));
  // Inside a box with a lead, the lead points to each member.
  for (const b of [...units, ...floatBoxes]) {
    if (!b.leadCircle) continue;
    b.circles.forEach((c, i) => lines.push(arrow(`${b.id}:${i}`, { x: b.leadCircle.cx, y: b.leadCircle.cy, r: R }, { x: c.cx, y: c.cy, r: R })));
  }
  lines.push(arrow('root:stub', { x: root.x + ROOT_W / 2, y: height, r: 0 }, { x: root.x + ROOT_W / 2, y: root.y + ROOT_H, r: 0 }));

  const width = Math.max(root.span, fx - H_GAP, 0);
  return { root, units, floatBoxes, lines, width, height };
}

function circleClass(seat) {
  if (seat.vacant) return 'border-slate-700 bg-[#c9a7e0]';
  if (seat.employment_status === 'notice_period') return 'border-amber-600 bg-amber-200';
  if (seat.employment_status === 'pending_onboarding') return 'border-dashed border-slate-700 bg-[#9fc9f0]';
  return 'border-slate-700 bg-[#9fc9f0]';
}

function Seat({ seat, cx, cy }) {
  const title = seat.vacant ? 'Open position' : [nameOf(seat), seat.designation?.name, seat.employee_code].filter(Boolean).join(' · ');
  return (
    <div
      className={`absolute flex items-center justify-center rounded-full border p-1.5 text-center ${circleClass(seat)}`}
      style={{ left: cx - R, top: cy - R, width: C, height: C }}
      title={title}
    >
      {!seat.vacant && <span className="line-clamp-3 break-words text-[9.5px] font-semibold leading-tight text-slate-900">{nameOf(seat)}</span>}
    </div>
  );
}

function Box({ unit }) {
  const border = unit.contractor ? 'border-[3px] border-sky-400' : unit.kind === 'reports' ? 'border border-dashed border-slate-500' : 'border border-slate-600';
  return (
    <>
      <div className={`absolute bg-[#fde59a] ${border}`} style={{ left: unit.x, top: unit.y, width: unit.width, height: unit.height }} />
      <p
        className="absolute truncate px-2 text-center text-[10.5px] font-bold text-slate-900"
        style={{ left: unit.x, top: unit.labelY - 8, width: unit.width, lineHeight: '16px' }}
        title={unit.label}
      >
        {unit.label}
      </p>
    </>
  );
}

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2];

/**
 * Team view: each HR team is a box — members over the team name over the
 * lead — hanging off the manager it reports to, down to the company at the
 * bottom, with teams nobody manages yet and contractors above the tree.
 * Reporting lines are still manager_id; teams, leads, reports-to, open
 * positions and order come from People → HR Settings → Teams.
 */
export default function TeamChart({ data, companyName }) {
  const [zoom, setZoom] = useState(3);
  const chart = useMemo(() => layoutTeamChart(data, companyName), [data, companyName]);
  const scale = ZOOMS[zoom];
  const boxes = [...chart.units.filter((u) => u.kind !== 'manager'), ...chart.floatBoxes];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-tertiary-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-slate-700 bg-[#9fc9f0]" /> Employee</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-slate-700 bg-[#c9a7e0]" /> Open position</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-dashed border-slate-700 bg-[#9fc9f0]" /> New hire</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-amber-600 bg-amber-200" /> Notice period</span>
          <span>Teams, leads, reports-to, open positions and order: People → HR Settings → Teams.</span>
        </div>
        <div className="inline-flex items-center rounded-lg border border-tertiary-200 bg-white shadow-sm">
          <button type="button" className="p-1.5 text-tertiary-600 hover:bg-tertiary-50 disabled:opacity-40" onClick={() => setZoom((z) => z - 1)} disabled={zoom === 0} aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
          <span className="w-10 text-center tabular-nums text-tertiary-700">{Math.round(scale * 100)}%</span>
          <button type="button" className="p-1.5 text-tertiary-600 hover:bg-tertiary-50 disabled:opacity-40" onClick={() => setZoom((z) => z + 1)} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="overflow-auto rounded-xl border border-tertiary-200 bg-[#e8e8e8] p-8">
        <div style={{ width: chart.width * scale, height: chart.height * scale }}>
          <div className="relative origin-top-left" style={{ width: chart.width, height: chart.height, transform: `scale(${scale})` }}>
            {boxes.map((b) => <Box key={b.id} unit={b} />)}
            <svg className="pointer-events-none absolute inset-0 overflow-visible" width={chart.width} height={chart.height} aria-hidden="true">
              <defs>
                <marker id="org-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#1e293b" />
                </marker>
              </defs>
              {chart.lines.map((l) => (
                <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#1e293b" strokeWidth="1" markerEnd="url(#org-arrow)" />
              ))}
            </svg>
            {boxes.flatMap((b) => [
              ...b.circles.map((c, i) => <Seat key={`${b.id}:${i}`} seat={c.seat} cx={c.cx} cy={c.cy} />),
              ...(b.leadCircle ? [<Seat key={`${b.id}:lead`} seat={b.leadCircle.seat} cx={b.leadCircle.cx} cy={b.leadCircle.cy} />] : []),
            ])}
            {chart.units.filter((u) => u.kind === 'manager').map((u) => <Seat key={u.id} seat={u.person} cx={u.x + R} cy={u.y + R} />)}
            <div
              className="absolute flex items-center justify-center rounded-lg border border-slate-700 bg-[#9ee0b8] px-2 text-center text-[11px] font-bold text-slate-900"
              style={{ left: chart.root.x, top: chart.root.y, width: ROOT_W, height: ROOT_H }}
              title={companyName}
            >
              <span className="truncate">{companyName}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
