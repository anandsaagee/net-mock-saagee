/**
 * UGC NET Philosophy Mock Test — script.js
 * Clean, minimal, production-ready exam engine.
 */

'use strict';

/* ═══════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════ */
const CONFIG = {
  duration   : 3 * 60 * 60,   // 3 hours in seconds
  marksPerQ  : 2,
  passMark   : 40,             // percentage cutoff
  storageKey : 'ugcnet_session',
  warnAt     : [300, 60],      // seconds remaining → show alert
};

/* ═══════════════════════════════════════════
   STATUS CODES (palette colours)
═══════════════════════════════════════════ */
const S = {
  UNVISITED   : 'unvisited',    // grey
  UNANSWERED  : 'unanswered',   // red
  ANSWERED    : 'answered',     // green
  MARKED      : 'marked',       // purple (no answer)
  MARKED_ANS  : 'marked-ans',   // purple-green (answered + marked)
};

/* ═══════════════════════════════════════════
   STATE  (single source of truth)
═══════════════════════════════════════════ */
const exam = {
  questions : [],
  answers   : {},    // { index: optionIndex | null }
  status    : {},    // { index: S.* }
  index     : 0,
  remaining : CONFIG.duration,
  ticker    : null,
  started   : false,
  finished  : false,
  darkMode  : false,
};

/* ═══════════════════════════════════════════
   DOM SHORTCUTS
═══════════════════════════════════════════ */
const el  = id  => document.getElementById(id);
const all = sel => document.querySelectorAll(sel);

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  showPage('page-home');
  wire();
  tryResume();
});

/* ═══════════════════════════════════════════
   WIRING
═══════════════════════════════════════════ */
function wire() {
  on('btn-goto-instructions', () => showPage('page-instructions'));

  // Instructions — enable Start only after checkbox
  const checkbox = el('agree-checkbox');
  const startBtn = el('btn-start-test');
  if (checkbox && startBtn) {
    startBtn.disabled = true;
    checkbox.addEventListener('change', () => startBtn.disabled = !checkbox.checked);
    startBtn.addEventListener('click', loadAndStart);
  }

  // Exam controls
  on('btn-save-next',    saveAndNext);
  on('btn-mark-review',  markForReview);
  on('btn-clear',        clearResponse);
  on('btn-prev',         () => goto(exam.index - 1));
  on('btn-submit',       confirmSubmit);
  on('btn-submit-header',confirmSubmit);

  // Result controls
  on('btn-restart',      restart);
  on('btn-review',       enterReviewMode);

  // Extras
  on('btn-dark-mode',    toggleDark);
  on('btn-fullscreen',   toggleFullscreen);

  // Palette paper tabs
  on('tab-paper1', () => showPaperTab(1));
  on('tab-paper2', () => showPaperTab(2));

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKey);
}

function on(id, fn) {
  const node = el(id);
  if (node) node.addEventListener('click', fn);
}

/* ═══════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════ */
const PAGES = ['page-home','page-instructions','page-exam','page-result'];

function showPage(id) {
  PAGES.forEach(p => {
    const node = el(p);
    if (node) node.classList.toggle('active-page', p === id);
  });
}

/* ═══════════════════════════════════════════
   LOAD QUESTIONS & START
═══════════════════════════════════════════ */
async function loadAndStart() {
  if (!exam.questions.length) {
    try {
      const res = await fetch('questions.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      exam.questions = await res.json();
    } catch (err) {
      toast('⚠ Could not load questions.json — ' + err.message, 'danger', 6000);
      return;
    }
  }
  startExam();
}

function startExam() {
  // Initialise maps
  exam.questions.forEach((_, i) => {
    exam.answers[i] = exam.answers[i] ?? null;
    exam.status[i]  = exam.status[i]  ?? S.UNVISITED;
  });

  exam.index    = exam.index || 0;
  exam.started  = true;
  exam.finished = false;

  showPage('page-exam');
  buildPalette();
  goto(exam.index);
  startTimer();
  guardUnload(true);
}

/* ═══════════════════════════════════════════
   TIMER
═══════════════════════════════════════════ */
function startTimer() {
  clearInterval(exam.ticker);
  renderTimer();
  exam.ticker = setInterval(() => {
    if (exam.remaining <= 0) { clearInterval(exam.ticker); autoSubmit(); return; }
    exam.remaining--;
    renderTimer();
    checkWarnings();
    persist();
  }, 1000);
}

function renderTimer() {
  const h = Math.floor(exam.remaining / 3600);
  const m = Math.floor((exam.remaining % 3600) / 60);
  const s = exam.remaining % 60;
  const node = el('timer-display');
  if (!node) return;
  node.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  node.className = 'timer'
    + (exam.remaining <= 300 ? ' timer-warn'   : '')
    + (exam.remaining <= 60  ? ' timer-danger' : '');
}

function checkWarnings() {
  if (exam.remaining === 300) { beep(520, 700); toast('⏰ 5 minutes remaining!', 'warn'); }
  if (exam.remaining === 60)  { beep(880, 400); toast('🚨 1 minute left!',       'danger'); }
}

/* ═══════════════════════════════════════════
   RENDER QUESTION
═══════════════════════════════════════════ */
function goto(idx) {
  if (idx < 0 || idx >= exam.questions.length) return;

  // Mark as visited
  if (exam.status[idx] === S.UNVISITED) exam.status[idx] = S.UNANSWERED;

  exam.index = idx;
  const q    = exam.questions[idx];

  setText('question-number', `Question ${idx + 1} of ${exam.questions.length}`);
  setText('subject-label',   q.topic || 'General');
  setText('paper-label',     q.paper === 1 ? 'Paper I – General' : 'Paper II – Philosophy');
  setHTML('question-text',   q.question);

  const wrap = el('options-container');
  if (!wrap) return;
  wrap.innerHTML = '';

  q.options.forEach((opt, i) => {
    const lbl  = document.createElement('label');
    lbl.className = 'option' + (exam.answers[idx] === i ? ' option-selected' : '');

    const radio = document.createElement('input');
    radio.type  = 'radio';
    radio.name  = 'opt';
    radio.value = i;
    radio.checked = exam.answers[idx] === i;

    // In review mode — show correct answer highlighting
    if (exam.finished) {
      lbl.classList.toggle('option-correct', i === q.answer);
      lbl.classList.toggle('option-wrong',   exam.answers[idx] === i && i !== q.answer);
      radio.disabled = true;
    } else {
      radio.addEventListener('change', () => pickAnswer(idx, i));
    }

    const txt = document.createElement('span');
    txt.innerHTML = `<b>${'ABCD'[i]}.</b> ${opt}`;

    lbl.append(radio, txt);
    wrap.appendChild(lbl);
  });

  syncPalette();
  scrollPaletteBtn(idx);
  updateProgress();

  // Auto-switch palette tab to match current question's paper
  const paper = q.paper || 2;
  showPaperTab(paper, false);
}

function pickAnswer(idx, optIdx) {
  exam.answers[idx] = optIdx;

  // Preserve marked state
  if (exam.status[idx] === S.MARKED || exam.status[idx] === S.MARKED_ANS) {
    exam.status[idx] = S.MARKED_ANS;
  } else {
    exam.status[idx] = S.ANSWERED;
  }

  // Visual feedback on selected label
  all('.option').forEach(l => l.classList.remove('option-selected'));
  const labels = all('.option');
  if (labels[optIdx]) labels[optIdx].classList.add('option-selected');

  updatePaletteBtn(idx);
  updateProgress();
}

/* ═══════════════════════════════════════════
   EXAM CONTROLS
═══════════════════════════════════════════ */
function saveAndNext() {
  const i = exam.index;

  if (exam.answers[i] !== null) {
    if (exam.status[i] === S.MARKED || exam.status[i] === S.MARKED_ANS) {
      exam.status[i] = S.MARKED_ANS;
    } else {
      exam.status[i] = S.ANSWERED;
    }
  } else if (exam.status[i] === S.UNVISITED) {
    exam.status[i] = S.UNANSWERED;
  }

  updatePaletteBtn(i);
  persist();
  if (i < exam.questions.length - 1) goto(i + 1);
  else toast('You are on the last question.', 'info');
}

function markForReview() {
  const i = exam.index;
  exam.status[i] = exam.answers[i] !== null ? S.MARKED_ANS : S.MARKED;
  updatePaletteBtn(i);
  persist();
  if (i < exam.questions.length - 1) goto(i + 1);
}

function clearResponse() {
  const i = exam.index;
  exam.answers[i] = null;
  exam.status[i]  = S.UNANSWERED;
  all('input[name="opt"]').forEach(r => r.checked = false);
  all('.option').forEach(l => l.classList.remove('option-selected'));
  updatePaletteBtn(i);
  updateProgress();
  persist();
}

function confirmSubmit() {
  const attempted   = countAttempted();
  const unattempted = exam.questions.length - attempted;

  if (unattempted > 0) {
    if (!confirm(
      `⚠ ${unattempted} question(s) unanswered.\n\n` +
      `Attempted: ${attempted} / ${exam.questions.length}\n\n` +
      `Submit anyway?`
    )) return;
  }
  submitExam();
}

function autoSubmit() {
  toast('⏰ Time up! Submitting…', 'danger');
  setTimeout(submitExam, 1200);
}

/* ═══════════════════════════════════════════
   SUBMIT & SCORE
═══════════════════════════════════════════ */
function submitExam() {
  clearInterval(exam.ticker);
  exam.finished = true;
  guardUnload(false);
  persist();
  showResult(calcResult());
}

function calcResult() {
  let correct = 0, wrong = 0, attempted = 0;
  const byTopic = {};

  exam.questions.forEach((q, i) => {
    const t = q.topic || 'General';
    byTopic[t] = byTopic[t] || { correct: 0, total: 0 };
    byTopic[t].total++;

    if (exam.answers[i] !== null) {
      attempted++;
      if (exam.answers[i] === q.answer) { correct++; byTopic[t].correct++; }
      else wrong++;
    }
  });

  const score   = correct * CONFIG.marksPerQ;
  const maxScore = exam.questions.length * CONFIG.marksPerQ;
  const pct     = maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : '0.0';
  const timeTaken = CONFIG.duration - exam.remaining;

  return {
    score, maxScore, correct, wrong, attempted,
    unattempted : exam.questions.length - attempted,
    pct, passed : parseFloat(pct) >= CONFIG.passMark,
    byTopic, timeTaken,
  };
}

/* ═══════════════════════════════════════════
   RESULT PAGE
═══════════════════════════════════════════ */
function showResult(r) {
  showPage('page-result');

  setText('result-score',       `${r.score} / ${r.maxScore}`);
  setText('result-correct',     r.correct);
  setText('result-wrong',       r.wrong);
  setText('result-attempted',   r.attempted);
  setText('result-unattempted', r.unattempted);
  setText('result-pct',         `${r.pct}%`);
  setText('result-time',        fmtTime(r.timeTaken));

  const statusEl = el('result-status');
  if (statusEl) {
    statusEl.textContent = r.passed ? '✅ PASS' : '❌ FAIL';
    statusEl.className   = r.passed ? 'badge-pass' : 'badge-fail';
  }

  renderTopicBars(r.byTopic);
}

function renderTopicBars(byTopic) {
  const wrap = el('topic-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  Object.entries(byTopic)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([topic, d]) => {
      const pct = d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'topic-row';
      row.innerHTML = `
        <div class="topic-name">${topic}</div>
        <div class="topic-bar-track">
          <div class="topic-bar" style="width:0%" data-target="${pct}"></div>
        </div>
        <div class="topic-pct">${d.correct}/${d.total} &nbsp; <b>${pct}%</b></div>`;
      wrap.appendChild(row);
    });

  // Animate bars after paint
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wrap.querySelectorAll('.topic-bar').forEach(bar => {
      bar.style.width = bar.dataset.target + '%';
    });
  }));
}

/* ═══════════════════════════════════════════
   QUESTION PALETTE
═══════════════════════════════════════════ */
function buildPalette() {
  [1, 2].forEach(paper => {
    const grid = el(`palette-p${paper}`);
    if (!grid) return;
    grid.innerHTML = '';

    let localNum = 0;
    exam.questions.forEach((q, i) => {
      if ((q.paper || 2) !== paper) return;
      localNum++;
      const btn = document.createElement('button');
      btn.id          = `pb-${i}`;
      btn.className   = `pal-btn ${exam.status[i]}`;
      btn.textContent = localNum;
      btn.title       = `Q${i + 1}: ${q.topic}`;
      btn.addEventListener('click', () => goto(i));
      grid.appendChild(btn);
    });
  });
  showPaperTab(1, false);
}

function updatePaletteBtn(i) {
  const btn = el(`pb-${i}`);
  if (!btn) return;
  btn.className = `pal-btn ${exam.status[i]}` + (i === exam.index ? ' pal-current' : '');
}

function syncPalette() {
  exam.questions.forEach((_, i) => updatePaletteBtn(i));
}

function scrollPaletteBtn(i) {
  const btn = el(`pb-${i}`);
  if (btn) btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showPaperTab(paper, switchQuestion = true) {
  [1, 2].forEach(p => {
    const grid = el(`palette-p${p}`);
    const tab  = el(`tab-paper${p}`);
    if (grid) grid.style.display = p === paper ? 'grid' : 'none';
    if (tab)  tab.classList.toggle('tab-active', p === paper);
  });

  // Jump to first question of that paper when user taps tab
  if (switchQuestion) {
    const idx = exam.questions.findIndex(q => (q.paper || 2) === paper);
    if (idx !== -1) goto(idx);
  }
}

/* ═══════════════════════════════════════════
   PROGRESS BAR & COUNTERS
═══════════════════════════════════════════ */
function updateProgress() {
  const done  = countAttempted();
  const total = exam.questions.length;
  const pct   = total > 0 ? (done / total) * 100 : 0;

  const bar = el('progress-fill');
  if (bar) bar.style.width = pct + '%';
  setText('answered-count', `${done} / ${total}`);
}

function countAttempted() {
  return Object.values(exam.answers).filter(v => v !== null).length;
}

/* ═══════════════════════════════════════════
   REVIEW MODE
═══════════════════════════════════════════ */
function enterReviewMode() {
  showPage('page-exam');
  const banner = el('review-banner');
  if (banner) banner.style.display = 'block';
  syncPalette();
  goto(0);
}

/* ═══════════════════════════════════════════
   RESTART
═══════════════════════════════════════════ */
function restart() {
  if (!confirm('Clear all progress and start fresh?')) return;
  clearInterval(exam.ticker);
  guardUnload(false);
  localStorage.removeItem(CONFIG.storageKey);

  Object.assign(exam, {
    questions: [], answers: {}, status: {},
    index: 0, remaining: CONFIG.duration, ticker: null,
    started: false, finished: false,
  });

  // Reset UI
  const banner = el('review-banner');
  if (banner) banner.style.display = 'none';
  const checkbox = el('agree-checkbox');
  if (checkbox) checkbox.checked = false;
  const startBtn = el('btn-start-test');
  if (startBtn) startBtn.disabled = true;

  showPage('page-home');
}

/* ═══════════════════════════════════════════
   LOCAL STORAGE — PERSIST / RESUME
═══════════════════════════════════════════ */
function persist() {
  if (!exam.started) return;
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify({
      questions : exam.questions,
      answers   : exam.answers,
      status    : exam.status,
      index     : exam.index,
      remaining : exam.remaining,
      darkMode  : exam.darkMode,
      savedAt   : Date.now(),
    }));
  } catch (_) {}
}

function tryResume() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return;
    const snap = JSON.parse(raw);

    // Discard if older than 4 hours
    if (Date.now() - snap.savedAt > 4 * 3600 * 1000) {
      localStorage.removeItem(CONFIG.storageKey);
      return;
    }

    if (!confirm('⚡ Resume your unfinished exam?')) {
      localStorage.removeItem(CONFIG.storageKey);
      return;
    }

    Object.assign(exam, {
      questions : snap.questions,
      answers   : snap.answers,
      status    : snap.status,
      index     : snap.index,
      remaining : snap.remaining,
      darkMode  : snap.darkMode || false,
      started   : true,
    });

    if (exam.darkMode) document.body.classList.add('dark');

    showPage('page-exam');
    buildPalette();
    goto(exam.index);
    startTimer();
    guardUnload(true);
    updateProgress();
  } catch (_) {
    localStorage.removeItem(CONFIG.storageKey);
  }
}

/* ═══════════════════════════════════════════
   UNLOAD GUARD
═══════════════════════════════════════════ */
function guardUnload(on) {
  window.onbeforeunload = on
    ? e => { e.preventDefault(); return (e.returnValue = 'Exam in progress — leave?'); }
    : null;
}

/* ═══════════════════════════════════════════
   DARK MODE & FULLSCREEN
═══════════════════════════════════════════ */
function toggleDark() {
  exam.darkMode = !exam.darkMode;
  document.body.classList.toggle('dark', exam.darkMode);
  const btn = el('btn-dark-mode');
  if (btn) btn.textContent = exam.darkMode ? '☀ Light' : '🌙 Dark';
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    setText('btn-fullscreen', '⛶ Exit');
  } else {
    document.exitFullscreen();
    setText('btn-fullscreen', '⛶ Fullscreen');
  }
}

/* ═══════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════ */
function handleKey(e) {
  if (!exam.started || exam.finished) return;
  if (e.target.matches('input, button')) return;

  const map = {
    'ArrowRight' : saveAndNext,
    'Enter'      : saveAndNext,
    'ArrowLeft'  : () => goto(exam.index - 1),
    'm'          : markForReview,
    'M'          : markForReview,
    'c'          : clearResponse,
    'C'          : clearResponse,
  };

  if (map[e.key]) { e.preventDefault(); map[e.key](); return; }

  // Alt + 1-4 → pick option
  if (e.altKey && '1234'.includes(e.key)) {
    const radios = all('input[name="opt"]');
    const target = radios[+e.key - 1];
    if (target) { target.checked = true; target.dispatchEvent(new Event('change')); }
  }
}

/* ═══════════════════════════════════════════
   TOAST NOTIFICATION
═══════════════════════════════════════════ */
let _toastTimer = null;

function toast(msg, type = 'info', duration = 3500) {
  let t = el('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className   = `toast toast-${type} toast-show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('toast-show'), duration);
}

/* ═══════════════════════════════════════════
   WEB AUDIO BEEP
═══════════════════════════════════════════ */
function beep(hz = 440, ms = 500) {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = hz;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch (_) {}
}

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
const pad     = n => String(n).padStart(2, '0');
const setText = (id, v) => { const n = el(id); if (n) n.textContent = v; };
const setHTML = (id, v) => { const n = el(id); if (n) n.innerHTML   = v; };

function fmtTime(sec) {
  return `${pad(Math.floor(sec / 3600))}h ${pad(Math.floor((sec % 3600) / 60))}m ${pad(sec % 60)}s`;
}
