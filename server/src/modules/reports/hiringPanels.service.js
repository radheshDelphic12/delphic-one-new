const prisma = require('../../config/db');
const { reportFrom, reportTo } = require('./reports.service');

// Hiring panels (Reports > Hiring funnel > Hiring panels). One panel per interview template (Hiring setup): Client Hiring, Internal
// Technical Hiring, Internal Sales / HR / Operations Hiring ... Each template round is a LAYER, in the template's order.
//
// Unit = a submission (a candidate put forward on one requirement), found by the DATE OF SUBMISSION. For every layer:
//   Bucket        = candidates who reach the layer: layer 1 = everyone in the panel; later layers = those who PASSED or SKIPPED the layer before.
//   Scheduled     = of the bucket, an interview / test / AI interview was set up.
//   Attended      = of the bucket, the candidate showed up (a result is in, or the time has come and no no-show).
//   Decision pending / Rejected / Passed = of those who attended, no decision yet / failed / passed.
//   Skipped       = the layer was not held for them (a skipped round, an optional round they moved past, or a gap in the records),
//                   so they flow to the next bucket as if passed.
//   Since First   = bucket / the first layer's bucket.     Layer by Layer = bucket / the previous layer's bucket.
// Layer 1 of a template (its screening test) combines the screening interview, the screening test and the AI interview: the best result wins.

const CHUNK = 4000;
const chunks = (list) => { const out = []; for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK)); return out; };
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b ? round2((a / b) * 100) : null);

const RANK = { pass: 4, skipped: 3, fail: 2, open: 1 };

function layerLabel(r) {
  const by = r.conducted_by === 'client' ? 'Client' : 'Delphic';
  const parts = [by, r.is_mandatory ? 'mandatory' : 'optional'];
  if (r.rating_required) parts.push('rating required');
  return `${r.name} (${parts.join(', ')})${r.kind === 'screening_test' ? ' / AI Round' : ''}`;
}

// Rounds made before templates existed carry only a round_type: place them on the template's layers.
function legacyLayerIndex(layers, roundType) {
  const clientIdx = layers.map((l, i) => (l.conducted_by === 'client' ? i : -1)).filter((i) => i >= 0);
  const interviewIdx = layers.map((l, i) => (l.kind !== 'screening_test' ? i : -1)).filter((i) => i >= 0);
  const md = layers.findIndex((l) => /\bMD\b/i.test(l.name));
  switch (roundType) {
    case 'internal_r1': return 0;
    case 'internal_r2': return clientIdx.length ? 0 : (interviewIdx[0] ?? null);
    case 'client_r1': return clientIdx[0] ?? null;
    case 'client_r2': return clientIdx[1] ?? null;
    case 'client_r3': return clientIdx[2] ?? null;
    case 'hr_cto_ceo': return md >= 0 ? md : null;
    default: return null;
  }
}

function emptyEvidence() { return { scheduled: false, attended: false, result: null }; }

function add(ev, { scheduled, attended, result }) {
  ev.scheduled = ev.scheduled || scheduled;
  ev.attended = ev.attended || attended;
  if (result && (!ev.result || RANK[result] > RANK[ev.result])) ev.result = result;
}

function roundEvidence(round, now) {
  if (round.status === 'cancelled') return null;
  if (round.result === 'skipped') return { scheduled: false, attended: false, result: 'skipped' };
  if (round.result === 'pass') return { scheduled: true, attended: true, result: 'pass' };
  if (round.result === 'fail') return { scheduled: true, attended: true, result: 'fail' };
  const happened = round.result === 'pending' && (round.status === 'completed' || (round.scheduled_at && new Date(round.scheduled_at) <= now));
  return { scheduled: true, attended: Boolean(happened), result: 'open' };
}

/** What a submission did at every layer of its template: [{ scheduled, attended, result }]. */
function evidenceFor(sub, layers, extras, now) {
  const evidence = layers.map(emptyEvidence);
  const byRoundId = new Map(layers.map((l, i) => [l.id, i]));
  for (const r of sub.interview_rounds) {
    let idx = r.template_round_id ? byRoundId.get(r.template_round_id) : legacyLayerIndex(layers, r.round_type);
    if (idx === undefined || idx === null) continue;
    const e = roundEvidence(r, now);
    if (e) add(evidence[idx], e);
  }
  // Layer 1 (the screening test) also takes the screening test and the AI interview.
  const screening = layers.findIndex((l) => l.kind === 'screening_test');
  if (screening >= 0) {
    for (const a of extras.attempts.get(sub.id) || []) {
      if (a.template_round_id && a.template_round_id !== layers[screening].id) continue;
      const done = a.status === 'submitted';
      add(evidence[screening], { scheduled: true, attended: a.status === 'started' || done, result: done ? (a.passed === true ? 'pass' : a.passed === false ? 'fail' : 'open') : 'open' });
    }
    for (const a of extras.ai.get(sub.id) || []) {
      if (a.template_round_id && a.template_round_id !== layers[screening].id) continue;
      const outcome = a.override_outcome || a.outcome;
      const attended = ['started', 'completed', 'pending_review'].includes(a.status);
      add(evidence[screening], { scheduled: true, attended, result: outcome === 'pass' ? 'pass' : outcome === 'below_pass' ? 'fail' : 'open' });
    }
  }
  return evidence;
}

/** Runs one submission down its layers: the layer outcome for every layer it was in the bucket of. */
function walk(sub, layers, evidence, hist) {
  const n = layers.length;
  // The furthest layer with any activity: a candidate who has a later layer has moved past the earlier ones.
  let reach = -1;
  evidence.forEach((e, i) => { if (e.scheduled || e.attended || e.result === 'pass') reach = i; });
  const pastAll = ['offer_sent', 'bgv', 'closed'].includes(sub.stage) || hist.has('offer_sent') || hist.has('bgv') || hist.has('closed');
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const ev = evidence[i];
    const moved = pastAll || i < reach;
    let status;
    if (ev.result === 'pass') status = 'passed';
    else if (ev.result === 'skipped') status = 'skipped';
    else if (moved) status = ev.attended ? 'passed' : 'skipped'; // went on without a pass on record: a manager's call, or the round was not held
    else if (ev.result === 'fail') status = 'rejected';
    else if (ev.attended) status = 'pending';
    else status = 'waiting';
    out.push({ status, scheduled: ev.scheduled && status !== 'skipped', attended: ev.attended && ['passed', 'rejected', 'pending'].includes(status) });
    if (status !== 'passed' && status !== 'skipped') break;
  }
  return out;
}

const profileTypeWhere = (type) => {
  if (type === 'bench') return { on_bench: true };
  if (type === 'vendor') return { on_bench: false, source: 'vendor' };
  if (type === 'market') return { on_bench: false, source: { in: ['direct', 'linkedin'] } };
  return {};
};

async function loadPanels(params) {
  const { date_from, date_to, vendor_account_id, team_id, sourcer_id, client_id, sales_owner_id, brought_by_id, profile_type } = params;
  const now = new Date();

  let sourcerFilter = sourcer_id ? { equals: sourcer_id } : undefined;
  if (team_id) {
    const members = await prisma.orgMembership.findMany({ where: { team_id }, select: { person_id: true } });
    const ids = members.map((m) => m.person_id);
    sourcerFilter = sourcer_id ? (ids.includes(sourcer_id) ? { equals: sourcer_id } : { in: [] }) : { in: ids };
  }
  const profileWhere = { ...profileTypeWhere(profile_type), ...(vendor_account_id ? { vendor_account_id } : {}), ...(sourcerFilter ? { added_by: sourcerFilter } : {}) };
  const requirementWhere = {
    ...(client_id ? { account_id: client_id } : {}),
    ...(sales_owner_id ? { sales_owner_id } : {}),
    ...(brought_by_id ? { account: { origin_owner_id: brought_by_id } } : {}),
  };

  const submissions = await prisma.submission.findMany({
    where: {
      created_at: { gte: reportFrom(date_from), lte: reportTo(date_to) },
      ...(Object.keys(profileWhere).length ? { profile: profileWhere } : {}),
      ...(Object.keys(requirementWhere).length ? { seat: { requirement: requirementWhere } } : {}),
    },
    select: {
      id: true,
      profile_id: true,
      stage: true,
      created_at: true,
      profile: { select: { name: true, source: true, on_bench: true, added_by_user: { select: { name: true } }, vendor_account: { select: { name: true } } } },
      seat: { select: { requirement: { select: { title: true, req_type: true, hiring_track: true, interview_template_id: true, sales_owner: { select: { name: true } }, account: { select: { name: true, origin_owner: { select: { name: true } } } } } } } },
      interview_rounds: { select: { round_type: true, template_round_id: true, status: true, result: true, scheduled_at: true } },
    },
  });

  const ids = submissions.map((s) => s.id);
  const attempts = new Map();
  const ai = new Map();
  const histories = new Map();
  for (const part of chunks(ids)) {
    for (const a of await prisma.assessmentAttempt.findMany({ where: { submission_id: { in: part }, deleted_at: null, superseded_at: null }, select: { submission_id: true, template_round_id: true, status: true, passed: true } })) {
      if (!attempts.has(a.submission_id)) attempts.set(a.submission_id, []);
      attempts.get(a.submission_id).push(a);
    }
    for (const a of await prisma.aiInterview.findMany({ where: { submission_id: { in: part }, deleted_at: null, superseded_at: null }, select: { submission_id: true, template_round_id: true, status: true, outcome: true, override_outcome: true } })) {
      if (!ai.has(a.submission_id)) ai.set(a.submission_id, []);
      ai.get(a.submission_id).push(a);
    }
    for (const h of await prisma.stageHistory.findMany({ where: { entity_type: 'submission', entity_id: { in: part }, to_stage: { in: ['offer_sent', 'bgv', 'closed'] } }, select: { entity_id: true, to_stage: true } })) {
      if (!histories.has(h.entity_id)) histories.set(h.entity_id, new Set());
      histories.get(h.entity_id).add(h.to_stage);
    }
  }

  const templates = await prisma.interviewTemplate.findMany({ include: { rounds: { orderBy: { sort_order: 'asc' } } }, orderBy: { created_at: 'asc' } });
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const resolved = new Map(); // "<req_type>|<track>" -> template id (requirements made before templates existed)
  const resolve = (reqType, track) => {
    const k = `${reqType}|${track || ''}`;
    if (!resolved.has(k)) {
      const matching = templates.filter((t) => t.is_active && t.service_types.includes(reqType) && (!t.hiring_track || t.hiring_track === (track || null)));
      resolved.set(k, (matching.find((t) => t.hiring_track) || matching[0] || null)?.id || null);
    }
    return resolved.get(k);
  };

  const extras = { attempts, ai };
  const panels = new Map(templates.map((t) => [t.id, { template: t, layers: t.rounds, items: [] }]));
  let noTemplate = 0;
  for (const s of submissions) {
    const req = s.seat?.requirement;
    const tid = (req?.interview_template_id && templateById.has(req.interview_template_id) ? req.interview_template_id : null) || (req ? resolve(req.req_type, req.hiring_track) : null);
    const panel = tid ? panels.get(tid) : null;
    if (!panel || !panel.layers.length) { noTemplate += 1; continue; }
    const evidence = evidenceFor(s, panel.layers, extras, now);
    panel.items.push({ sub: s, walk: walk(s, panel.layers, evidence, histories.get(s.id) || new Set()) });
  }
  return { panels, noTemplate, total: submissions.length };
}

const METRICS = {
  bucket: () => true,
  scheduled: (w) => w.scheduled,
  attended: (w) => w.attended,
  pending: (w) => w.status === 'pending',
  rejected: (w) => w.status === 'rejected',
  passed: (w) => w.status === 'passed',
  skipped: (w) => w.status === 'skipped',
};

function tallyPanel(panel) {
  const layers = panel.layers.map((r, i) => {
    const inLayer = panel.items.map((it) => it.walk[i]).filter(Boolean);
    const count = (key) => inLayer.filter(METRICS[key]).length;
    return { no: i + 1, round_id: r.id, name: r.name, label: layerLabel(r), conducted_by: r.conducted_by, mandatory: r.is_mandatory, bucket: inLayer.length, scheduled: count('scheduled'), attended: count('attended'), pending: count('pending'), rejected: count('rejected'), passed: count('passed'), skipped: count('skipped') };
  });
  const first = layers[0]?.bucket || 0;
  layers.forEach((l, i) => {
    l.since_first_pct = i === 0 ? (first ? 100 : null) : pct(l.bucket, first);
    l.layer_pct = i === 0 ? (first ? 100 : null) : pct(l.bucket, layers[i - 1].bucket);
  });
  return layers;
}

async function hiringPanels(params) {
  const { panels, noTemplate, total } = await loadPanels(params);
  const out = [...panels.values()]
    .map((p) => ({
      template: { id: p.template.id, name: p.template.name, hiring_track: p.template.hiring_track, service_types: p.template.service_types, is_active: p.template.is_active },
      submissions: p.items.length,
      layers: tallyPanel(p),
    }))
    // Every active template keeps its panel (so the three look alike even when one is empty); an inactive one only when it has data.
    .filter((p) => p.template.is_active || p.submissions > 0);
  return {
    filters: { ...params },
    total_submissions: total,
    without_template: noTemplate,
    panels: out,
    assumptions: [
      'One panel per interview template (Hiring setup); each template round is a layer, in the template\'s order. The unit is a submission (a candidate put forward on one requirement), selected by the date of submission.',
      'Bucket = candidates who reach the layer: the first layer takes everyone in the panel, every later layer takes those who passed or skipped the layer before. Since First = bucket / first layer\'s bucket. Layer by Layer = bucket / previous layer\'s bucket.',
      'Scheduled = an interview, test or AI interview was set up. Attended = the candidate showed up: a result is in, or the interview time has passed (a no-show or a cancelled round is not attended).',
      'Decision pending = attended but no result recorded yet. Rejected = result Fail. Passed = result Pass. So Attended = Decision pending + Rejected + Passed.',
      'Skipped = the layer was not held for the candidate: a round marked skipped (bench first round), an optional round they moved past, or a layer with no record although the candidate moved on to a later one. They count in the next layer\'s bucket like a pass.',
      'A candidate who attended a layer and then moved on to a later layer anyway (a manager\'s call) counts as Passed there.',
      'Layer 1 (the screening round) combines the screening interview, the screening test and the AI interview: the best result of the three is used.',
      'A candidate who is rejected or backed out before a layer was set up stays in that layer\'s bucket without a scheduled / attended / result count.',
      ...(noTemplate ? [`${noTemplate} submission(s) are left out because their requirement has no interview template.`] : []),
    ],
  };
}

const DETAIL_LIMIT = 1000;

async function hiringPanelDetails(params) {
  const { template_id, layer, metric = 'bucket' } = params;
  const { panels } = await loadPanels(params);
  const panel = panels.get(template_id);
  const idx = Number(layer) - 1;
  if (!panel || !(idx >= 0 && idx < panel.layers.length) || !METRICS[metric]) return { total: 0, shown: 0, items: [] };
  const STATUS_TEXT = { passed: 'Passed', skipped: 'Skipped', rejected: 'Rejected', pending: 'Decision pending', waiting: 'Waiting (not held yet)' };
  const list = panel.items.filter((it) => it.walk[idx] && METRICS[metric](it.walk[idx]));
  const items = list
    .sort((a, b) => new Date(b.sub.created_at) - new Date(a.sub.created_at))
    .slice(0, DETAIL_LIMIT)
    .map(({ sub, walk: w }) => {
      const req = sub.seat?.requirement;
      return {
        profile_id: sub.profile_id,
        name: sub.profile?.name || '—',
        submitted_on: sub.created_at,
        recruiter: sub.profile?.added_by_user?.name || '—',
        vendor: sub.profile?.vendor_account?.name || null,
        profile_type: sub.profile?.on_bench ? 'Bench' : sub.profile?.source === 'vendor' ? 'Vendor' : 'Market',
        client: req?.account?.name || null,
        requirement: req?.title || null,
        sales_owner: req?.sales_owner?.name || null,
        brought_by: req?.account?.origin_owner?.name || null,
        stage: sub.stage,
        layer_status: STATUS_TEXT[w[idx].status],
        submission_id: sub.id,
      };
    });
  return { total: list.length, shown: items.length, items };
}

module.exports = { hiringPanels, hiringPanelDetails };
