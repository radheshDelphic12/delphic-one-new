/* global document, window */
/* Apply form of the public careers pages. Plain JavaScript, no build step.
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
    };
    if (source) payload.channel = source;

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

/* Job list: type to search, tick departments and / or locations to narrow the list. Within one group the ticks add up
   (any of them); between groups, and with the search, all must match. Nothing chosen means no restriction. */
(function () {
  var panel = document.getElementById('job-filters');
  if (!panel) return;
  var cards = Array.prototype.slice.call(document.querySelectorAll('#job-list .job'));
  var boxes = Array.prototype.slice.call(panel.querySelectorAll('input[data-filter]'));
  var search = document.getElementById('job-search');
  var empty = document.getElementById('no-match');
  var count = document.getElementById('job-count');
  var pills = document.getElementById('job-pills');

  function picked(key) {
    return boxes.filter(function (b) { return b.checked && b.getAttribute('data-filter') === key; });
  }

  function apply() {
    var depts = picked('dept').map(function (b) { return b.value; });
    var locs = picked('loc').map(function (b) { return b.value; });
    var q = search.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var cardLocs = (card.getAttribute('data-loc') || '').split('|');
      var okDept = !depts.length || depts.indexOf(card.getAttribute('data-dept')) !== -1;
      var okLoc = !locs.length || locs.some(function (l) { return cardLocs.indexOf(l) !== -1; });
      var okText = !q || (card.getAttribute('data-title') || '').indexOf(q) !== -1;
      var on = okDept && okLoc && okText;
      card.classList.toggle('hidden', !on);
      if (on) shown += 1;
    });
    empty.classList.toggle('hidden', shown !== 0);
    var filtered = depts.length || locs.length || q;
    count.textContent = filtered ? 'Showing ' + shown + ' of ' + cards.length + ' roles' : cards.length + ' open ' + (cards.length === 1 ? 'role' : 'roles');
    // a count badge on each dropdown, and a removable pill for every ticked option
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
      x.textContent = '\u00d7';
      pill.appendChild(x);
      pill.addEventListener('click', function () { b.checked = false; apply(); });
      pills.appendChild(pill);
    });
  }

  function clear() {
    boxes.forEach(function (b) { b.checked = false; });
    search.value = '';
    apply();
  }

  if (window.innerWidth < 800) {
    Array.prototype.forEach.call(panel.querySelectorAll('details.fgroup'), function (d) { d.open = false; });
  }
  boxes.forEach(function (b) { b.addEventListener('change', apply); });
  search.addEventListener('input', apply);
  document.getElementById('filters-clear').addEventListener('click', clear);
  document.getElementById('no-match-clear').addEventListener('click', clear);
  apply();
})();
