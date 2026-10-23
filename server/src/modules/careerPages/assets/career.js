/* global document, window */
/* Apply form and job list of the public careers pages. Plain JavaScript, no build step.
   All URLs are relative to the page, so it works under /delphic/career and under /career (a rewrite in front of the API). */
(function () {
  var form = document.getElementById('apply-form');
  if (!form) return;

  var field = function (name) { return form.elements[name]; };
  var show = function (el, on) { el.classList.toggle('hidden', !on); };
  var joiner = field('joiner_status');
  var notice = field('notice_choice');
  var lwdBox = document.getElementById('lwd-box');
  var noticeOtherBox = document.getElementById('notice-other-box');
  var errorBox = document.getElementById('apply-error');
  var button = form.querySelector('button[type=submit]');

  function sync() {
    var serving = joiner.value === 'serving_notice';
    show(lwdBox, serving);
    field('last_working_day').required = serving;
    var other = notice.value === 'other';
    show(noticeOtherBox, other);
    field('notice_other').required = other;
  }
  joiner.addEventListener('change', sync);
  notice.addEventListener('change', sync);
  sync();

  function fail(message) {
    errorBox.textContent = message;
    show(errorBox, true);
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // phone: digits only, at most 10 (a pasted +91 / 0 prefix is dropped)
  var phoneInput = field('phone');
  phoneInput.addEventListener('input', function () {
    var d = phoneInput.value.replace(/\D/g, '');
    if (d.length > 10) d = d.replace(/^(91|0)(?=\d{10}$)/, '').slice(0, 10);
    phoneInput.value = d;
  });
  var params = new URLSearchParams(window.location.search);
  var source = (params.get('src') || '').slice(0, 40);
  // an employee's personal job link carries ?ref=<employee id>: the application is credited to that employee
  var ref = (params.get('ref') || '').slice(0, 80);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    show(errorBox, false);
    if (!form.checkValidity()) { form.reportValidity(); return; }

    var value = function (name) { return field(name).value.trim(); };
    var payload = {
      name: value('name'),
      email: value('email'),
      phone: value('phone'),
      experience_years: value('experience_years'),
      message: value('message'),
      company_website: value('company_website'),
      linkedin_url: value('linkedin_url'),
      currently_working: value('currently_working'),
      joiner_status: value('joiner_status'),
      notice_period_days: notice.value === 'other' ? value('notice_other') : notice.value,
      last_working_day: joiner.value === 'serving_notice' ? value('last_working_day') : '',
      current_ctc_lpa: value('current_ctc_lpa'),
      expected_ctc_lpa: value('expected_ctc_lpa'),
      work_mode: value('work_mode'),
      cv_url: value('cv_url'),
      extra_skills: value('extra_skills'),
      referred_by: value('referred_by'),
    };
    if (source) payload.channel = source;
    if (ref) payload.ref = ref;
    button.disabled = true;
    button.textContent = 'Sending...';
    fetch(form.getAttribute('data-action'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; }); })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) {
          form.classList.add('hidden');
          show(document.getElementById('apply-done'), true);
          document.getElementById('apply-done').scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        var first = r.body && r.body.errors && r.body.errors[0] && r.body.errors[0].message;
        fail(first || (r.body && r.body.message) || 'Could not send your application. Please try again.');
      })
      .catch(function () { fail('Could not reach the server. Please check your connection and try again.'); })
      .then(function () { button.disabled = false; button.textContent = 'Submit application'; });
  });
})();

/* Job list: the search box, the department / location ticks and the sort box all ask the server (jobs.json), so a list of
   hundreds of roles stays fast. Typing is debounced; the words, filters and sort live in the address (?q=&dept=&loc=&sort=)
   so a result can be shared; "Load more" adds the next 20. Within one group the ticks add up (any of them). */
(function () {
  var panel = document.getElementById('job-filters');
  if (!panel) return;
  var list = document.getElementById('job-list');
  var boxes = Array.prototype.slice.call(panel.querySelectorAll('input[data-filter]'));
  var search = document.getElementById('job-search');
  var sort = document.getElementById('job-sort');
  var empty = document.getElementById('no-match');
  var count = document.getElementById('job-count');
  var pills = document.getElementById('job-pills');
  var more = document.getElementById('load-more');
  var link = list.getAttribute('data-link') || '';
  var openTotal = Number(list.getAttribute('data-open')) || 0;
  var page = Number(list.getAttribute('data-page')) || 1;
  var pages = Number(list.getAttribute('data-pages')) || 1;
  var timer = null;
  var inflight = null;
  var seq = 0;

  function picked(key) {
    return boxes.filter(function (b) { return b.checked && b.getAttribute('data-filter') === key; });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function chip(text, cls) { return text ? el('span', 'chip' + (cls ? ' ' + cls : ''), text) : null; }

  function card(j) {
    var a = el('a', 'job');
    a.href = encodeURIComponent(j.slug) + link;
    a.setAttribute('data-testid', 'career-job');
    var main = el('span', 'job-main');
    main.appendChild(el('span', 'jid', j.job_code));
    main.appendChild(el('strong', '', j.title));
    var chips = el('span', 'chips');
    [chip(j.department, 'dept'), chip((j.places || []).join(', '), 'place'), chip(j.mode), chip(j.employment_type)].forEach(function (c) { if (c) chips.appendChild(c); });
    main.appendChild(chips);
    a.appendChild(main);
    var go = el('span', 'go', 'View & apply ');
    go.appendChild(el('i', '', '→'));
    a.appendChild(go);
    return a;
  }

  function query(forPage) {
    var q = new URLSearchParams();
    var text = search.value.replace(/\s+/g, ' ').trim();
    if (text) q.set('q', text);
    var d = picked('dept').map(function (b) { return b.value; });
    var l = picked('loc').map(function (b) { return b.value; });
    if (d.length) q.set('dept', d.join(','));
    if (l.length) q.set('loc', l.join(','));
    if (sort.value) q.set('sort', sort.value);
    if (forPage > 1) q.set('page', String(forPage));
    return q;
  }

  function renderMeta(total) {
    var q = search.value.trim();
    var filtered = q || picked('dept').length || picked('loc').length;
    count.textContent = filtered ? 'Showing ' + total + ' of ' + openTotal + ' roles' : total + ' open ' + (total === 1 ? 'role' : 'roles');
    empty.classList.toggle('hidden', total !== 0);
    more.classList.toggle('hidden', page >= pages);
    ['dept', 'loc'].forEach(function (key) {
      var n = picked(key).length;
      var badge = panel.querySelector('[data-sel="' + key + '"]');
      if (badge) badge.textContent = n ? String(n) : '';
    });
    pills.innerHTML = '';
    boxes.filter(function (b) { return b.checked; }).forEach(function (b) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.setAttribute('aria-label', 'Remove filter ' + b.getAttribute('data-label'));
      pill.textContent = b.getAttribute('data-label') + ' ';
      var x = document.createElement('i');
      x.textContent = '×';
      pill.appendChild(x);
      pill.addEventListener('click', function () { b.checked = false; load(); });
      pills.appendChild(pill);
    });
  }

  /** Keeps the search in the address (?q=...) next to src / ref, without adding history entries. */
  function syncAddress() {
    var q = query(1);
    var keep = new URLSearchParams(window.location.search);
    ['src', 'ref'].forEach(function (k) { if (keep.get(k)) q.set(k, keep.get(k)); });
    var qs = q.toString();
    try { window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '')); } catch (_err) { /* ignore */ }
  }

  function fetchPage(forPage, replace) {
    if (inflight) inflight.abort();
    inflight = typeof AbortController === 'function' ? new AbortController() : { abort: function () {} };
    var mine = (seq += 1);
    return fetch('jobs.json?' + query(forPage).toString(), { headers: { Accept: 'application/json' }, signal: inflight.signal })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (mine !== seq || !body.success) return;
        if (replace) list.innerHTML = '';
        body.data.forEach(function (j) { list.appendChild(card(j)); });
        page = body.pagination.page;
        pages = body.pagination.totalPages;
        openTotal = body.pagination.open_total;
        renderMeta(body.pagination.total);
      })
      .catch(function () { /* an aborted or failed request keeps the list on screen */ });
  }

  function load() { syncAddress(); return fetchPage(1, true); }

  function clear() {
    boxes.forEach(function (b) { b.checked = false; });
    search.value = '';
    sort.value = '';
    load();
  }

  if (window.innerWidth < 800) {
    Array.prototype.forEach.call(panel.querySelectorAll('details.fgroup'), function (d) { d.open = false; });
  }
  boxes.forEach(function (b) { b.addEventListener('change', load); });
  sort.addEventListener('change', load);
  // debounce: ask the server when typing pauses
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 250); });
  more.addEventListener('click', function () { fetchPage(page + 1, false); });
  document.getElementById('filters-clear').addEventListener('click', clear);
  document.getElementById('no-match-clear').addEventListener('click', clear);
  renderMeta(Number((count.textContent.match(/\d+/) || [0])[0]));
})();
