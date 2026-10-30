const prisma = require('../../config/db');
const { reportFrom, reportTo } = require('./reports.service');
const { average, median, daysBetween, tallyFunnel, bucketOf } = require('../../lib/funnel');

// Hiring funnel (Reports > Hiring funnel). The cohort is the profiles SOURCED in the chosen dates (profile.created_at, the same
// anchor as HR reports > Sourcing, bench people left out like there); what happens to them later, even after the end date, is
// counted. Two funnels: Internal hiring (Delphic's own hires) and Client hiring (candidates put forward to a client). A profile
// can be submitted to several requirements: it is counted once per funnel, at its furthest submission in that funnel.

const CHUNK = 5000;
const chunks = (list) => { const out = []; for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK)); return out; };

const NON_ROUND = new Set(['submitted', 'offer', 'joined']);
const RANK = (key) => {
  if (key === 'screening') return 10;
  if (key === 'submitted') return 20;
  let m = /^l(\d+)$/.exec(key);
  if (m) return 30 + Number(m[1]);
  m = /^client_r(\d+)$/.exec(key);
  if (m) return 50 + Number(m[1]);
  if (key === 'md') return 100;
  if (key === 'offer') return 110;
  return 120; // joined
};
const LABEL = (key) => {
  if (key === 'screening') return 'Screening';
  if (key === 'submitted') return 'Submitted to client';
  if (key === 'md') return 'MD round';
  if (key === 'offer') return 'Offer sent';
  if (key === 'joined') return 'Selected / Joined';
  let m = /^l(\d+)$/.exec(key);
  if (m) return `L${m[1]}`;
  m = /^client_r(\d+)$/.exec(key);
  return m ? `Client Round ${m[1]}` : key;
};

// Template round -> funnel stage: the screening test, the MD round, client rounds by order (Client Round n) and the other Delphic
// interviews by order (L n).
function stageKeysFor(template) {
  const map = new Map();
  let l = 0;
  let c = 0;
  for (const r of [...template.rounds].sort((a, b) => a.sort_order - b.sort_order)) {
    let key;
    if (r.kind === 'screening_test') key = 'screening';
    else if (/\bMD\b/i.test(r.name)) key = 'md';
    else if (r.conducted_by === 'client') key = `client_r${++c}`;
    else key = `l${++l}`;
    map.set(r.id, { key, name: r.name, mandatory: r.is_mandatory });
  }
  return map;
}

// Rounds made before templates existed: internal round 1 was the screening, the rest follow the old round names.
const LEGACY = (track) => ({
  internal_r1: 'screening',
  internal_r2: track === 'internal' ? 'l1' : 'screening',
  client_r1: 'client_r1',
  client_r2: 'client_r2',
  client_r3: 'client_r3',
  hr_cto_ceo: 'md',
});

const FIRST_RESULT_RANK = { pass: 4, skipped: 3, fail: 2, open: 1 };

function roundEvidence(rounds, keyOf) {
  const map = new Map();
  for (const r of rounds) {
    if (r.status === 'cancelled') continue;
    const key = keyOf(r);
    if (!key) continue;
    const status = r.result === 'pass' ? 'pass' : r.result === 'skipped' ? 'skipped' : r.result === 'fail' ? 'fail' : 'open';
    const at = r.completed_at || r.scheduled_at || null;
    const prev = map.get(key);
    if (!prev || FIRST_RESULT_RANK[status] > FIRST_RESULT_RANK[prev.status]) map.set(key, { status, at });
  }
  return map;
}

/** How one submission fared at every stage of its funnel. `seq` = the track's stage keys after "sourced", in order. */
function evaluate(sub, track, seq, tmplInfo, hist, keyOf) {
  const ev = roundEvidence(sub.interview_rounds || [], keyOf);
  const isRound = (k) => !NON_ROUND.has(k);
  const evidence = (k) => {
    if (k === 'submitted') return hist.has('submitted_to_client') ? { kind: 'pass', at: hist.get('submitted_to_client') } : null;
    if (k === 'offer') {
      const at = hist.get('offer_sent') || hist.get('bgv') || hist.get('closed');
      return at ? { kind: 'pass', at } : null;
    }
    if (k === 'joined') return hist.has('closed') || sub.stage === 'closed' ? { kind: 'pass', at: hist.get('closed') || null } : null;
    const e = ev.get(k);
    if (!e) return null;
    if (e.status === 'pass') return { kind: 'pass', at: e.at };
    if (e.status === 'skipped') return { kind: 'skipped', at: e.at };
    return null;
  };
  // A stage the submission's own template does not have is left out for that submission (not a gap in the data).
  const applicable = (k) => {
    if (k === 'submitted') return track === 'client';
    if (!isRound(k) || !tmplInfo) return true;
    return tmplInfo.has(k) || ev.has(k);
  };

  let p = -1;
  seq.forEach((k, i) => { if (evidence(k)) p = i; });
  let f = -1;
  for (let i = p + 1; i < seq.length; i += 1) if (applicable(seq[i])) { f = i; break; }
  const ended = sub.stage === 'rejected' || sub.stage === 'backout';

  const outcomes = {};
  const times = {};
  seq.forEach((k, i) => {
    if (i <= p) {
      const e = evidence(k);
      if (e) { outcomes[k] = e.kind === 'skipped' ? 'assumed' : 'passed'; times[k] = e.at; return; }
      if (!applicable(k)) return;
      if (ev.get(k)?.status === 'fail') { outcomes[k] = 'passed'; return; } // failed, then moved on anyway (a manager's call)
      if (isRound(k) && tmplInfo && tmplInfo.has(k) && !tmplInfo.get(k).mandatory) { outcomes[k] = 'assumed'; return; }
      outcomes[k] = 'unavailable';
    } else if (i === f) {
      outcomes[k] = ev.get(k)?.status === 'fail' || ended ? 'dropped' : 'pending';
    }
  });
  return { progress: p, outcomes, times };
}

async function loadCohort({ date_from, date_to, sourcer_id, client_id, service_type }) {
  const range = { gte: reportFrom(date_from), lte: reportTo(date_to) };
  const profiles = await prisma.profile.findMany({
    where: { on_bench: false, created_at: range, ...(sourcer_id ? { added_by: sourcer_id } : {}) },
    select: { id: true, name: true, created_at: true, added_by: true, added_by_user: { select: { id: true, name: true } } },
  });

  const submissions = [];
  for (const ids of chunks(profiles.map((p) => p.id))) {
    submissions.push(...await prisma.submission.findMany({
      where: { profile_id: { in: ids } },
      select: {
        id: true,
        profile_id: true,
        stage: true,
        created_at: true,
        seat: { select: { requirement: { select: { req_type: true, account_id: true, interview_template_id: true, title: true, account: { select: { name: true } } } } } },
        interview_rounds: { select: { round_type: true, template_round_id: true, status: true, result: true, completed_at: true, scheduled_at: true } },
      },
    }));
  }

  const histories = new Map(); // submission id -> Map(to_stage -> first time)
  for (const ids of chunks(submissions.map((s) => s.id))) {
    const rows = await prisma.stageHistory.findMany({
      where: { entity_type: 'submission', entity_id: { in: ids }, to_stage: { in: ['submitted_to_client', 'offer_sent', 'bgv', 'closed'] } },
      orderBy: { changed_at: 'asc' },
      select: { entity_id: true, to_stage: true, changed_at: true },
    });
    for (const h of rows) {
      if (!histories.has(h.entity_id)) histories.set(h.entity_id, new Map());
      if (!histories.get(h.entity_id).has(h.to_stage)) histories.get(h.entity_id).set(h.to_stage, h.changed_at);
    }
  }

  const templates = new Map();
  for (const t of await prisma.interviewTemplate.findMany({ include: { rounds: true } })) templates.set(t.id, stageKeysFor(t));
  const templateRoundKey = new Map();
  for (const rounds of templates.values()) for (const [id, info] of rounds) templateRoundKey.set(id, info);

  // Only the submissions that match the client / service-type filters take part.
  const wantTrack = (track) => !service_type || service_type === track;
  const trackOf = (s) => (s.seat?.requirement?.req_type === 'internal_hiring' ? 'internal' : 'client');
  const filtered = submissions.filter((s) => wantTrack(trackOf(s)) && (!client_id || s.seat?.requirement?.account_id === client_id));
  const byProfile = new Map();
  for (const s of filtered) {
    if (!byProfile.has(s.profile_id)) byProfile.set(s.profile_id, []);
    byProfile.get(s.profile_id).push(s);
  }

  // Stage list per track: the base stages plus whatever the templates and the old rounds in the data use.
  const trackKeys = { internal: new Set(['screening', 'md', 'offer', 'joined']), client: new Set(['screening', 'submitted', 'client_r1', 'md', 'offer', 'joined']) };
  const names = { internal: new Map(), client: new Map() };
  const optional = { internal: new Set(), client: new Set() };
  for (const s of filtered) {
    const track = trackOf(s);
    const tmpl = templates.get(s.seat?.requirement?.interview_template_id);
    if (tmpl) {
      for (const info of tmpl.values()) {
        trackKeys[track].add(info.key);
        if (!names[track].has(info.key)) names[track].set(info.key, new Set());
        names[track].get(info.key).add(info.name);
        if (!info.mandatory) optional[track].add(info.key);
      }
    }
    for (const r of s.interview_rounds) {
      const key = r.template_round_id ? templateRoundKey.get(r.template_round_id)?.key : LEGACY(track)[r.round_type];
      if (key) trackKeys[track].add(key);
    }
  }
  const seqs = { internal: [...trackKeys.internal].sort((a, b) => RANK(a) - RANK(b)), client: [...trackKeys.client].sort((a, b) => RANK(a) - RANK(b)) };
  const seqOf = (track) => seqs[track];

  const entities = { internal: [], client: [] };
  const profileFacts = new Map();
  for (const profile of profiles) {
    const subs = byProfile.get(profile.id) || [];
    const facts = { profile, submitted: subs.length > 0, tracks: {} };
    for (const track of ['internal', 'client']) {
      let best = null;
      for (const s of subs.filter((x) => trackOf(x) === track)) {
        const tmpl = templates.get(s.seat?.requirement?.interview_template_id) || null;
        const keyOf = (r) => (r.template_round_id ? templateRoundKey.get(r.template_round_id)?.key : LEGACY(track)[r.round_type]);
        const result = evaluate(s, track, seqOf(track), tmpl ? new Map([...tmpl.values()].map((i) => [i.key, i])) : null, histories.get(s.id) || new Map(), keyOf);
        if (!best || result.progress > best.progress || (result.progress === best.progress && s.created_at > best.created_at)) best = { ...result, created_at: s.created_at, sub: s };
      }
      if (!best) continue;
      const times = {};
      for (const [k, at] of Object.entries(best.times)) times[k] = daysBetween(profile.created_at, at);
      const req = best.sub.seat?.requirement;
      const entity = {
        profile_id: profile.id,
        outcomes: { sourced: 'passed', ...best.outcomes },
        times,
        info: { submission_id: best.sub.id, submission_stage: best.sub.stage, requirement: req?.title || null, client: req?.account?.name || null, track },
      };
      entities[track].push(entity);
      facts.tracks[track] = entity;
    }
    profileFacts.set(profile.id, facts);
  }

  // Profile level flags (any funnel).
  const flagsOf = (facts) => {
    const outs = Object.values(facts.tracks);
    const has = (key, ...want) => outs.some((e) => want.includes(e.outcomes[key]));
    const selected = has('joined', 'passed');
    const pending = outs.some((e) => Object.values(e.outcomes).includes('pending'));
    const dropped = !selected && !pending && outs.some((e) => Object.values(e.outcomes).includes('dropped'));
    const joinedDays = outs.map((e) => e.times.joined).filter((d) => d != null);
    return {
      submitted: facts.submitted,
      // moved on past the screening = cleared it, even when that round has no record (the funnel table lists those under Data unavailable)
      first_round_cleared: has('screening', 'passed', 'assumed', 'unavailable'),
      reached_client_round: facts.tracks.client?.outcomes.client_r1 != null,
      selected,
      dropped,
      in_progress: !selected && pending,
      days_to_join: joinedDays.length ? Math.min(...joinedDays) : null,
    };
  };

  const inCohort = [...profileFacts.values()].filter((f) => (!client_id && !service_type) || f.submitted);
  const rows = inCohort.map((f) => ({ ...f, flags: flagsOf(f) }));
  return { rows, entities, wantTrack, seqOf, names, optional };
}

async function hiringFunnel(params) {
  const { date_from, date_to, sourcer_id, client_id, service_type, group_by = 'month' } = params;
  const { rows, entities, wantTrack, seqOf, names, optional } = await loadCohort(params);

  const funnels = ['client', 'internal']
    .filter(wantTrack)
    .map((track) => {
      const stages = [{ key: 'sourced', label: 'Sourced', names: [], optional: false }, ...seqOf(track).map((key) => ({
        key,
        label: LABEL(key),
        names: [...(names[track].get(key) || [])],
        optional: optional[track].has(key),
      }))];
      return {
        track,
        label: track === 'client' ? 'Client hiring' : 'Internal hiring',
        profiles: entities[track].length,
        stages: tallyFunnel(stages, entities[track]),
      };
    })
    .filter((fn) => fn.profiles > 0);

  const joinedDays = rows.map((r) => r.flags.days_to_join).filter((d) => d != null);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const tally = (list) => ({
    sourced: list.length,
    submitted: list.filter((r) => r.flags.submitted).length,
    first_round_cleared: list.filter((r) => r.flags.first_round_cleared).length,
    reached_client_round: list.filter((r) => r.flags.reached_client_round).length,
    selected: list.filter((r) => r.flags.selected).length,
    dropped: list.filter((r) => r.flags.dropped).length,
    in_progress: list.filter((r) => r.flags.in_progress).length,
    avg_days_to_join: average(list.map((r) => r.flags.days_to_join)),
  });
  const withRates = (t) => ({
    ...t,
    first_round_pct: pct(t.first_round_cleared, t.submitted),
    client_round_pct: pct(t.reached_client_round, t.first_round_cleared),
    selected_pct: pct(t.selected, t.sourced),
  });

  const bySourcer = new Map();
  for (const r of rows) {
    const id = r.profile.added_by;
    if (!bySourcer.has(id)) bySourcer.set(id, { sourcer_id: id, sourcer: r.profile.added_by_user?.name || 'Unknown', list: [] });
    bySourcer.get(id).list.push(r);
  }
  const recruiters = [...bySourcer.values()]
    .map(({ sourcer_id: id, sourcer, list }) => ({ sourcer_id: id, sourcer, ...withRates(tally(list)) }))
    .sort((a, b) => b.sourced - a.sourced);

  const trend = [];
  if (group_by !== 'none') {
    const buckets = new Map();
    for (const r of rows) {
      const b = bucketOf(r.profile.created_at, group_by);
      if (!buckets.has(b.key)) buckets.set(b.key, { key: b.key, label: b.label, list: [] });
      buckets.get(b.key).list.push(r);
    }
    for (const b of [...buckets.values()].sort((x, y) => x.key.localeCompare(y.key))) trend.push({ bucket: b.label, bucket_key: b.key, ...withRates(tally(b.list)) });
  }

  const totals = withRates(tally(rows));
  return {
    filters: { date_from, date_to, sourcer_id: sourcer_id || null, client_id: client_id || null, service_type: service_type || null, group_by },
    summary: {
      ...totals,
      not_submitted: totals.sourced - totals.submitted,
      avg_days_to_join: average(joinedDays),
      median_days_to_join: median(joinedDays),
      joined_count: joinedDays.length,
    },
    funnels,
    recruiters,
    trend,
    assumptions: [
      'Cohort: profiles sourced (added) between the chosen dates, bench people left out like in HR reports. What happened to them later, even after the end date, is counted; their finalising date is ignored.',
      'A profile submitted to more than one requirement counts once per funnel, at its furthest submission in that funnel.',
      'Passed = the round result is Pass. Dropped = the round result is Fail, or the submission was rejected / backed out while waiting at that stage. A candidate who has simply not moved on yet is In progress, not dropped.',
      'An optional round that was not held, or a round skipped for a bench profile, counts as Passed by default (shown as "Not held"). Untick the option to see those separately.',
      'A mandatory round with no record although the candidate moved on, and old submissions without round records, go to Data unavailable in the funnel table instead of being counted as a pass. In the summary and the recruiter table such a candidate still counts as having cleared the round, because they moved on past it.',
      'A round that the requirement\'s own template does not have (for example L3 on a non-technical template) is left out for that candidate.',
      'Old (pre-template) rounds are mapped: internal round 1 = Screening, internal round 2 = L1 (Internal hiring) or Screening (Client hiring), client rounds 1-3 = Client Round 1-3, HR/CTO/CEO = MD round.',
      'Rejected / backed-out candidates are counted as dropped at the first stage they had not yet cleared.',
      'Selected / Joined = the submission reached Closed. Days to join = sourcing date to the day the submission was closed.',
    ],
  };
}

// The profiles behind one count of the report. Either a profile-level metric (summary / recruiter / trend counts) or a stage cell:
// { track, stage, outcome } with outcome = reached | passed | assumed | dropped | pending | unavailable (comma separated).
const PROFILE_METRICS = {
  sourced: () => true,
  submitted: (r) => r.flags.submitted,
  not_submitted: (r) => !r.flags.submitted,
  first_round_cleared: (r) => r.flags.first_round_cleared,
  reached_client_round: (r) => r.flags.reached_client_round,
  selected: (r) => r.flags.selected,
  dropped: (r) => r.flags.dropped,
  in_progress: (r) => r.flags.in_progress,
};
const DETAIL_LIMIT = 1000;

async function hiringFunnelDetails(params) {
  const { metric, track, stage, outcome, bucket, group_by = 'month' } = params;
  const { rows, entities } = await loadCohort(params);
  const byProfile = new Map(rows.map((r) => [r.profile.id, r]));
  const inBucket = (profile) => !bucket || group_by === 'none' || bucketOf(profile.created_at, group_by).key === bucket;
  const statusOf = (flags) => (flags.selected ? 'Selected / joined' : flags.dropped ? 'Dropped' : flags.in_progress ? 'In progress' : flags.submitted ? 'Submitted' : 'Not submitted');

  let list = [];
  if (stage && track) {
    const wanted = (outcome || 'reached').split(',');
    for (const e of entities[track] || []) {
      const row = byProfile.get(e.profile_id);
      const got = e.outcomes[stage];
      if (!row || !got || !inBucket(row.profile) || !(wanted.includes('reached') || wanted.includes(got))) continue;
      list.push({ row, entity: e, outcome: got });
    }
  } else {
    const test = PROFILE_METRICS[metric] || PROFILE_METRICS.sourced;
    list = rows.filter((r) => test(r) && inBucket(r.profile)).map((row) => {
      const entity = Object.values(row.tracks).sort((a, b) => Object.keys(b.outcomes).length - Object.keys(a.outcomes).length)[0] || null;
      return { row, entity, outcome: null };
    });
  }

  const OUTCOME_TEXT = { passed: 'Passed', assumed: 'Not held (counted as passed)', dropped: 'Dropped', pending: 'In progress', unavailable: 'Data unavailable' };
  const items = list
    .sort((a, b) => new Date(b.row.profile.created_at) - new Date(a.row.profile.created_at))
    .slice(0, DETAIL_LIMIT)
    .map(({ row, entity, outcome }) => ({
      profile_id: row.profile.id,
      name: row.profile.name,
      sourced_on: row.profile.created_at,
      recruiter: row.profile.added_by_user?.name || 'Unknown',
      status: statusOf(row.flags),
      outcome: outcome ? OUTCOME_TEXT[outcome] : null,
      days_at_stage: outcome && entity?.times?.[stage] != null ? Math.round(entity.times[stage] * 10) / 10 : null,
      submission_id: entity?.info.submission_id || null,
      submission_stage: entity?.info.submission_stage || null,
      requirement: entity?.info.requirement || null,
      client: entity?.info.client || null,
    }));
  return { total: list.length, shown: items.length, items };
}

module.exports = { hiringFunnel, hiringFunnelDetails };
