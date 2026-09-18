/* ============================================================
   LBD VOTING PLATFORM — Central Front-End Script
   Free-voting edition: no registration. Voting window is
   controlled by the "Settings" tab of the spreadsheet.
   ============================================================ */

const CONFIG = {
  // Paste your deployed Apps Script Web App URL here (must end in /exec):
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycby3hEN_jnaDIwWx64-hW_Xi270mMcASA9XEPgZKKhAy85XSg264EONaJxU4kk0ybSQhbw/exec',

  RESULTS_REFRESH_MS: 3000000
};

/* ---------------- Tiny helpers ---------------- */
const $ = (sel) => document.querySelector(sel);

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

function showError(box, message) {
  if (!box) return;
  box.textContent = message;
  show(box);
}

function setLoading(btn, isLoading, loadingText) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.disabled = isLoading;
  btn.classList.toggle('is-loading', isLoading);
  btn.textContent = isLoading ? (loadingText || 'Please wait…') : btn.dataset.label;
}

function backendConfigured() {
  return CONFIG.APPS_SCRIPT_URL && !CONFIG.APPS_SCRIPT_URL.includes('PASTE_DEPLOYED_URL_HERE');
}

function requireBackend() {
  if (!backendConfigured()) {
    throw new Error('The backend URL has not been configured yet. Open script.js and paste your ' +
      'Apps Script URL into CONFIG.APPS_SCRIPT_URL (see README.md).');
  }
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/* ---------------- API layer ----------------
   POSTs use Content-Type text/plain to avoid CORS preflight
   (required when calling Apps Script from GitHub Pages). */
async function apiGet(action) {
  requireBackend();
  const sep = CONFIG.APPS_SCRIPT_URL.includes('?') ? '&' : '?';
  const res = await fetch(CONFIG.APPS_SCRIPT_URL + sep + 'action=' + encodeURIComponent(action));
  if (!res.ok) throw new Error('Network error (' + res.status + ')');
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Unexpected server response.'); }
}

async function apiPost(payload) {
  requireBackend();
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Unexpected server response.'); }
}

/* ---------------- Live clock (time strip under header) ---------------- */
function initClock() {
  const dateEl = document.getElementById('live-date');
  const timeEl = document.getElementById('live-time');
  if (!dateEl || !timeEl) return;

  function tick() {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    timeEl.textContent = now.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', second: '2-digit'
    });
  }

  tick();
  setInterval(tick, 1000);
}

/* ---------------- Page router ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  initClock();

  switch (document.body.dataset.page) {
    case 'welcome': initIndexPage();   break;
    case 'vote':    initVotePage();    break;
    case 'results': initResultsPage(); break;
  }
});

/* ================= WELCOME PAGE ================= */
function initIndexPage() {
  const el = $('#vote-status');
  if (!el) return;

  apiGet('getVotingStatus').then((st) => {
    show(el);
    if (st.state === 'open') {
      el.textContent = '● Voting is open now';
      el.className = 'vote-status open';
    } else if (st.state === 'not_started') {
      el.textContent = 'Voting opens: ' + formatDateTime(st.start);
      el.className = 'vote-status pending';
    } else {
      el.textContent = 'Voting has ended — final results available';
      el.className = 'vote-status ended';
    }
  }).catch(() => { /* status line is optional; fail silently */ });
}

/* ================= VOTE PAGE ================= */
function initVotePage() {
  const ballot = $('#ballot');
  const submitBtn = $('#submit-vote-btn');
  const progressEl = $('#vote-progress');
  const errorBox = $('#vote-error');

  const selections = {};
  let categoryCount = 0;

  $('#retry-btn').addEventListener('click', () => window.location.reload());

  function renderStatusPanel(state, isoTime) {
    hide($('#vote-loading'));
    hide($('#vote-load-error'));
    hide($('#retry-btn'));
    hide(ballot);

    const panel = $('#vote-status-panel');
    const badge = $('#status-badge');
    const title = $('#status-title');
    const msg = $('#status-msg');
    const resultsBtn = $('#status-results-btn');

    if (state === 'ended') {
      badge.textContent = 'Voting Closed';
      badge.className = 'status-badge ended';
      title.textContent = 'Voting Is Over';
      msg.textContent = 'The voting window has closed. You can no longer cast a ballot, ' +
        'but the results are available.';
      show(resultsBtn);
    } else {
      badge.textContent = 'Not Started';
      badge.className = 'status-badge pending';
      title.textContent = 'Voting Has Not Started Yet';
      msg.textContent = isoTime
        ? 'Voting opens on ' + formatDateTime(isoTime) + '. Please check back then.'
        : 'The administrator has not opened voting yet. Please check back soon.';
      hide(resultsBtn);
    }
    show(panel);
  }

  async function loadCandidates() {
    show($('#vote-loading'));
    hide($('#vote-load-error'));
    hide($('#retry-btn'));
    try {
      const data = await apiGet('getCandidates');
      if (data.status !== 'success' || !data.categories || !data.categories.length) {
        throw new Error('The ballot is empty. The administrator must add candidates to the ' +
          '"Candidates" tab of the spreadsheet first.');
      }
      hide($('#vote-loading'));
      renderCategories(data.categories);
      show(ballot);
    } catch (err) {
      hide($('#vote-loading'));
      showError($('#vote-load-error'), err.message ||
        'We could not load the ballot. Please check your connection and try again.');
      show($('#retry-btn'));
    }
  }

  function renderCategories(categories) {
    const container = $('#vote-sections');
    container.innerHTML = '';
    categoryCount = categories.length;

    categories.forEach((cat) => {
      const section = document.createElement('section');
      section.className = 'vote-category';
      section.dataset.category = cat.category;

      const h2 = document.createElement('h2');
      h2.textContent = cat.category;
      section.appendChild(h2);

      const list = document.createElement('div');
      list.className = 'options';

      cat.candidates.forEach((name) => {
        const label = document.createElement('label');
        label.className = 'vote-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = cat.category;
        input.value = name;
        input.className = 'sr-only';
        input.addEventListener('change', () => {
          selections[cat.category] = name;
          section.classList.remove('missing');
          list.querySelectorAll('.vote-option').forEach((o) => o.classList.remove('selected'));
          label.classList.add('selected');
          updateProgress();
        });

        const dot = document.createElement('span');
        dot.className = 'radio-dot';
        dot.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.textContent = name;

        label.appendChild(input);
        label.appendChild(dot);
        label.appendChild(text);
        list.appendChild(label);
      });

      section.appendChild(list);
      container.appendChild(section);
    });

    updateProgress();
  }

  function updateProgress() {
    const done = Object.keys(selections).length;
    progressEl.textContent = done + ' of ' + categoryCount + ' categories completed';
    submitBtn.disabled = done < categoryCount;
  }

  submitBtn.addEventListener('click', async () => {
    const missing = [];
    document.querySelectorAll('.vote-category').forEach((sec) => {
      if (!selections[sec.dataset.category]) {
        sec.classList.add('missing');
        missing.push(sec);
      } else {
        sec.classList.remove('missing');
      }
    });

    if (missing.length) {
      showError(errorBox, 'Please choose a candidate in every highlighted category before submitting.');
      missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    hide(errorBox);
    setLoading(submitBtn, true, 'Submitting your vote…');
    try {
      const data = await apiPost({ action: 'submitVote', votes: selections });
      if (data.status === 'success') {
        window.location.href = 'results.html?voted=1';
      } else {
        setLoading(submitBtn, false);
        const msg = (data.message || '').toLowerCase();
        if (msg.includes('over') || msg.includes('closed')) {
          renderStatusPanel('ended');
        } else if (msg.includes('not started')) {
          renderStatusPanel('not_started');
        } else {
          showError(errorBox, data.message || 'Your vote could not be submitted. Please try again.');
        }
      }
    } catch (err) {
      setLoading(submitBtn, false);
      showError(errorBox, err.message ||
        'We could not reach the server. Please check your connection and try again — your vote has NOT been submitted yet.');
    }
  });

  // Entry point: check the voting window first, then load the ballot.
  (async () => {
    show($('#vote-loading'));
    try {
      const st = await apiGet('getVotingStatus');
      if (st.state === 'ended') { renderStatusPanel('ended'); return; }
      if (st.state === 'not_started') { renderStatusPanel('not_started', st.start); return; }

      if (st.end) {
        const endsEl = $('#vote-ends');
        endsEl.textContent = '⏳ Voting ends: ' + formatDateTime(st.end);
        show(endsEl);
      }
      await loadCandidates();
    } catch (err) {
      hide($('#vote-loading'));
      showError($('#vote-load-error'), err.message ||
        'We could not reach the server. Please check your connection and try again.');
      show($('#retry-btn'));
    }
  })();
}

/* ================= RESULTS PAGE ================= */
function initResultsPage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('voted')) show($('#thankyou-banner'));

  // Show the "voting has ended" banner when appropriate.
  apiGet('getVotingStatus').then((st) => {
    if (st.state === 'ended') show($('#ended-banner'));
  }).catch(() => { /* banner is optional */ });

  const refreshBtn = $('#refresh-btn');
  refreshBtn.addEventListener('click', loadResults);

  loadResults();
  setInterval(loadResults, CONFIG.RESULTS_REFRESH_MS);

  async function loadResults() {
    setLoading(refreshBtn, true, 'Refreshing…');
    try {
      const data = await apiGet('getResults');
      if (data.status !== 'success') throw new Error(data.message || 'Could not load results.');
      renderResults(data.tallies || {}, data.totalVotes || 0);
      $('#last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
      hide($('#results-error'));
    } catch (err) {
      showError($('#results-error'), err.message ||
        'Could not load results. Retrying automatically…');
    } finally {
      setLoading(refreshBtn, false);
    }
  }

  function renderResults(tallies, totalVotes) {
    $('#total-votes').textContent = totalVotes;
    const container = $('#results-container');
    container.innerHTML = '';

    const categories = Object.keys(tallies);
    if (!categories.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No results to display yet.';
      container.appendChild(p);
      return;
    }

    categories.forEach((cat) => {
      const entries = Object.entries(tallies[cat]).sort((a, b) => b[1] - a[1]);
      const catTotal = entries.reduce((sum, e) => sum + e[1], 0);

      const section = document.createElement('section');
      section.className = 'result-category';

      const h2 = document.createElement('h2');
      h2.textContent = cat;
      section.appendChild(h2);

      entries.forEach(([name, count], idx) => {
        const pct = catTotal ? Math.round((count / catTotal) * 100) : 0;

        const row = document.createElement('div');
        row.className = 'result-row' + (idx === 0 && count > 0 ? ' leading' : '');

        const top = document.createElement('div');
        top.className = 'result-top';
        const nameEl = document.createElement('span');
        nameEl.className = 'result-name';
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.className = 'result-count';
        countEl.textContent = count + (count === 1 ? ' vote' : ' votes');
        top.appendChild(nameEl);
        top.appendChild(countEl);

        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        track.appendChild(fill);

        const pctEl = document.createElement('span');
        pctEl.className = 'result-pct';
        pctEl.textContent = pct + '%';

        row.appendChild(top);
        row.appendChild(track);
        row.appendChild(pctEl);
        section.appendChild(row);

        requestAnimationFrame(() => { fill.style.width = pct + '%'; });
      });

      container.appendChild(section);
    });
  }
}