'use strict';

/* ──────────────────────────────────────────
   CONFIG
────────────────────────────────────────── */
const CONFIG = {
  EXAM_DURATION_SECONDS: 3 * 60 * 60,
  MARKS_PER_CORRECT: 2,
  NEGATIVE_MARKING: 0,
  PASS_PERCENTAGE: 40,
  STORAGE_KEY: 'ugcnet_mock_v3',
  JSON_FOLDER: './json/'
};

const STATUS = Object.freeze({
  NOT_VISITED:  'not-visited',
  NOT_ANSWERED: 'not-answered',
  ANSWERED:     'answered',
  MARKED:       'marked',
  MARKED_ANS:   'answered-marked',
});

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
const state = {
  questions:      [],
  userAnswers:    {},
  qStatus:        {},
  currentIndex:   0,
  timerSeconds:   CONFIG.EXAM_DURATION_SECONDS,
  timerInterval:  null,
  examStarted:    false,
  examFinished:   false,
  activePaper:    1,
  darkMode:       false,
};

/* ──────────────────────────────────────────
   HELPERS
────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const setHTML = (id, v) => { const e = $(id); if (e) e.innerHTML  = v; };

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active-page', p.id === pageId)
  );
  window.scrollTo(0, 0);
}

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  showPage('page-home');
  initDarkMode();
  bindHome();
  bindInstructions();
  bindExam();
  bindResult();
  await loadAllQuestions();
  restoreProgress();
});

/* ──────────────────────────────────────────
   LOAD QUESTIONS FROM json/ FOLDER
   Loads every .json file found there.
   Falls back to questions.json for compat.
────────────────────────────────────────── */
async function loadAllQuestions() {
  // Try to fetch a manifest first, else fall back to questions.json
  let allQuestions = [];

  // Try manifest.json listing all files
  try {
    const manifestRes = await fetch(CONFIG.JSON_FOLDER + 'manifest.json', { cache: 'no-store' });
    if (manifestRes.ok) {
      const files = await manifestRes.json(); // expects ["questions.json", "extra.json", ...]
      for (const file of files) {
        const data = await fetchJSON(CONFIG.JSON_FOLDER + file);
        if (Array.isArray(data)) allQuestions = allQuestions.concat(data);
      }
      state.questions = allQuestions;
      initStatuses();
      updateHomeStats();
      return;
    }
  } catch (_) { /* no manifest */ }

  // Fallback: load ./json/questions.json directly
  try {
    const data = await fetchJSON(CONFIG.JSON_FOLDER + 'questions.json');
    if (Array.isArray(data)) {
      state.questions = data;
    } else if (data && Array.isArray(data.questions)) {
      state.questions = data.questions;
    }
  } catch (err) {
    // Last resort: try root questions.json (legacy)
    try {
      const data = await fetchJSON('./questions.json');
      if (Array.isArray(data)) state.questions = data;
    } catch (_) {
      console.error('Could not load any questions:', err);
      showLoadError();
      return;
    }
  }

  initStatuses();
  updateHomeStats();
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function showLoadError() {
  const body = document.querySelector('.hero-subtitle');
  if (body) body.innerHTML = '<strong style="color:#dc2626">⚠️ Could not load questions. Add JSON files to the <code>json/</code> folder.</strong>';
}

function initStatuses() {
  state.questions.forEach((_, i) => {
    if (!(i in state.qStatus)) state.qStatus[i] = STATUS.NOT_VISITED;
  });
}

function updateHomeStats() {
  setText('stat-q-count', state.questions.length || 150);
  setText('inst-total-q', state.questions.length || 150);
}

/* ──────────────────────────────────────────
   DARK MODE
────────────────────────────────────────── */
function initDarkMode() {
  const saved = localStorage.getItem('ugcnet_dark');
  if (saved === '1') { document.body.classList.add('dark-mode'); state.darkMode = true; updateDarkBtns(); }
}

function toggleDark() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark-mode', state.darkMode);
  localStorage.setItem('ugcnet_dark', state.darkMode ? '1' : '0');
  updateDarkBtns();
}

function updateDarkBtns() {
  const icon = state.darkMode ? '☀️' : '🌙';
  ['btn-dark-mode','btn-dark-mode-2','btn-dark-mode-3'].forEach(id => {
    const el = $(id); if (el) el.textContent = icon;
  });
}

/* ──────────────────────────────────────────
   HOME BINDINGS
────────────────────────────────────────── */
function bindHome() {
  $('btn-dark-mode')?.addEventListener('click', toggleDark);
  $('btn-goto-instructions')?.addEventListener('click', () => showPage('page-instructions'));
  $('btn-goto-instructions-2')?.addEventListener('click', () => showPage('page-instructions'));
  $('btn-scroll-features')?.addEventListener('click', () => {
    $('features')?.scrollIntoView({ behavior: 'smooth' });
  });
}

/* ──────────────────────────────────────────
   INSTRUCTIONS BINDINGS
────────────────────────────────────────── */
function bindInstructions() {
  $('btn-dark-mode-2')?.addEventListener('click', toggleDark);
  $('btn-back-home')?.addEventListener('click', () => showPage('page-home'));

  const cb  = $('agree-checkbox');
  const btn = $('btn-start-test');
  if (cb && btn) {
    cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
    btn.addEventListener('click', startExam);
  }
}

/* ──────────────────────────────────────────
   START EXAM
────────────────────────────────────────── */
function startExam() {
  if (!state.questions.length) {
    alert('Questions not loaded yet. Please wait or check the json/ folder.');
    return;
  }
  state.examStarted  = true;
  state.examFinished = false;
  showPage('page-exam');
  buildPalette();
  renderQuestion();
  startTimer();
  saveProgress();
}

/* ──────────────────────────────────────────
   TIMER
────────────────────────────────────────── */
function startTimer() {
  clearInterval(state.timerInterval);
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerSeconds = Math.max(0, state.timerSeconds - 1);
    updateTimerDisplay();
    if (state.timerSeconds <= 0) {
      clearInterval(state.timerInterval);
      submitExam(true); // auto-submit
    }
    saveProgress();
  }, 1000);
}

function updateTimerDisplay() {
  const s = state.timerSeconds;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const fmt = `${pad(h)}:${pad(m)}:${pad(sec)}`;
  setText('timer-display', fmt);

  const block = $('timer-block');
  if (block) {
    block.classList.toggle('warning',  s <= 1800 && s > 300);
    block.classList.toggle('critical', s <= 300);
  }
}

const pad = n => String(n).padStart(2, '0');

/* ──────────────────────────────────────────
   RENDER QUESTION
────────────────────────────────────────── */
function renderQuestion() {
  const q = state.questions[state.currentIndex];
  if (!q) return;

  const paperNum = q.paper || (state.currentIndex < 50 ? 1 : 2);
  const paperLabel = `Paper ${paperNum === 1 ? 'I' : 'II'}`;

  // Mark as visited (not-visited → not-answered) unless already answered/marked
  if (state.qStatus[state.currentIndex] === STATUS.NOT_VISITED) {
    state.qStatus[state.currentIndex] = STATUS.NOT_ANSWERED;
  }

  setText('question-number', `Question ${state.currentIndex + 1} of ${state.questions.length}`);
  setText('subject-label', q.topic || 'General');
  setText('q-paper-badge', paperLabel);
  setText('current-paper-badge', paperLabel);
  setHTML('question-text', q.question || 'Question text unavailable');

  renderOptions(q);
  updateProgress();
  updatePalette();
  updateNavButtons();

  // Scroll question body to top
  const body = $('question-body');
  if (body) body.scrollTop = 0;
}

function renderOptions(q) {
  const container = $('options-container');
  if (!container) return;
  container.innerHTML = '';

  const options = Array.isArray(q.options) ? q.options : [];
  options.forEach((opt, idx) => {
    const label = document.createElement('label');
    label.className = 'option-item';
    const isSelected = state.userAnswers[state.currentIndex] === idx;
    label.innerHTML = `
      <input type="radio" name="q-option" value="${idx}" ${isSelected ? 'checked' : ''}>
      <span class="option-letter">${String.fromCharCode(65 + idx)}.</span>
      <span class="option-text">${opt}</span>
    `;
    label.addEventListener('change', () => {
      state.userAnswers[state.currentIndex] = idx;
      // If currently marked, keep marked-answered; else set answered
      if (state.qStatus[state.currentIndex] === STATUS.MARKED) {
        state.qStatus[state.currentIndex] = STATUS.MARKED_ANS;
      } else {
        state.qStatus[state.currentIndex] = STATUS.ANSWERED;
      }
      saveProgress();
      updatePalette();
    });
    container.appendChild(label);
  });
}

function updateProgress() {
  const answered = Object.values(state.qStatus).filter(
    s => s === STATUS.ANSWERED || s === STATUS.MARKED_ANS
  ).length;
  const total = state.questions.length;
  const pct = total > 0 ? (answered / total * 100).toFixed(0) : 0;
  const fill = $('progress-fill');
  if (fill) fill.style.width = pct + '%';
  setText('progress-text', `${answered} / ${total}`);
}

function updateNavButtons() {
  const prev = $('btn-prev');
  const next = $('btn-next');
  if (prev) prev.disabled = (state.currentIndex === 0);
  if (next) next.textContent = state.currentIndex === state.questions.length - 1
    ? 'Save & Finish ✓' : 'Save & Next →';
}

/* ──────────────────────────────────────────
   QUESTION PALETTE
────────────────────────────────────────── */
function buildPalette() {
  const container = $('palette-container');
  if (!container) return;
  container.innerHTML = '';

  state.questions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.className = `palette-btn ${state.qStatus[idx]}`;
    btn.id = `pal-btn-${idx}`;
    btn.textContent = idx + 1;

    const paperNum = q.paper || (idx < 50 ? 1 : 2);
    btn.dataset.paper = paperNum;
    if (paperNum !== state.activePaper) btn.classList.add('hidden');

    btn.addEventListener('click', () => {
      state.currentIndex = idx;
      renderQuestion();
      // Auto-close sidebar on mobile
      if (window.innerWidth < 768) closeSidebar();
    });
    container.appendChild(btn);
  });

  updatePaletteStats();
}

function updatePalette() {
  state.questions.forEach((q, idx) => {
    const btn = $(`pal-btn-${idx}`);
    if (!btn) return;
    const paperNum = q.paper || (idx < 50 ? 1 : 2);
    btn.className = `palette-btn ${state.qStatus[idx]}`;
    if (paperNum !== state.activePaper) btn.classList.add('hidden');
    if (idx === state.currentIndex) btn.classList.add('current');
  });
  updatePaletteStats();
}

function updatePaletteStats() {
  let answered = 0, notAnswered = 0, marked = 0, notVisited = 0;
  Object.values(state.qStatus).forEach(s => {
    if (s === STATUS.ANSWERED)     answered++;
    else if (s === STATUS.MARKED_ANS) { answered++; marked++; }
    else if (s === STATUS.NOT_ANSWERED) notAnswered++;
    else if (s === STATUS.MARKED)  marked++;
    else notVisited++;
  });
  setText('stat-answered',     answered);
  setText('stat-not-answered', notAnswered);
  setText('stat-marked',       marked);
  setText('stat-not-visited',  notVisited);
}

function switchPaper(paperNum) {
  state.activePaper = paperNum;
  $('tab-paper-1')?.classList.toggle('active', paperNum === 1);
  $('tab-paper-2')?.classList.toggle('active', paperNum === 2);
  updatePalette();
}

/* ──────────────────────────────────────────
   EXAM BINDINGS
────────────────────────────────────────── */
function bindExam() {
  $('btn-dark-mode-3')?.addEventListener('click', toggleDark);
  $('btn-palette-toggle')?.addEventListener('click', toggleSidebar);
  $('btn-sidebar-close')?.addEventListener('click', closeSidebar);

  $('tab-paper-1')?.addEventListener('click', () => switchPaper(1));
  $('tab-paper-2')?.addEventListener('click', () => switchPaper(2));

  $('btn-prev')?.addEventListener('click', () => {
    if (state.currentIndex > 0) { state.currentIndex--; renderQuestion(); saveProgress(); }
  });

  $('btn-next')?.addEventListener('click', () => {
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex++;
      renderQuestion();
      saveProgress();
    } else {
      openSubmitModal();
    }
  });

  $('btn-clear')?.addEventListener('click', () => {
    delete state.userAnswers[state.currentIndex];
    state.qStatus[state.currentIndex] = STATUS.NOT_ANSWERED;
    renderQuestion();
    saveProgress();
  });

  $('btn-mark')?.addEventListener('click', () => {
    const cur = state.qStatus[state.currentIndex];
    if (cur === STATUS.ANSWERED || cur === STATUS.MARKED_ANS) {
      state.qStatus[state.currentIndex] = STATUS.MARKED_ANS;
    } else {
      state.qStatus[state.currentIndex] = STATUS.MARKED;
    }
    // Move to next question
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex++;
    }
    renderQuestion();
    saveProgress();
  });

  $('btn-submit')?.addEventListener('click', openSubmitModal);
  $('btn-submit-sidebar')?.addEventListener('click', openSubmitModal);

  $('btn-modal-cancel')?.addEventListener('click', closeSubmitModal);
  $('btn-modal-submit')?.addEventListener('click', () => submitExam(false));
}

function toggleSidebar() {
  $('exam-sidebar')?.classList.toggle('open');
}

function closeSidebar() {
  $('exam-sidebar')?.classList.remove('open');
}

/* ──────────────────────────────────────────
   SUBMIT MODAL
────────────────────────────────────────── */
function openSubmitModal() {
  // Build stats
  let answered = 0, notAnswered = 0, marked = 0, notVisited = 0;
  Object.values(state.qStatus).forEach(s => {
    if (s === STATUS.ANSWERED)      answered++;
    else if (s === STATUS.MARKED_ANS) { answered++; marked++; }
    else if (s === STATUS.NOT_ANSWERED) notAnswered++;
    else if (s === STATUS.MARKED)   marked++;
    else notVisited++;
  });
  setHTML('modal-stats', `
    <div class="modal-stat-grid">
      <div class="modal-stat green-bg"><span>${answered}</span><small>Answered</small></div>
      <div class="modal-stat red-bg"><span>${notAnswered}</span><small>Not Answered</small></div>
      <div class="modal-stat purple-bg"><span>${marked}</span><small>Marked</small></div>
      <div class="modal-stat gray-bg"><span>${notVisited}</span><small>Not Visited</small></div>
    </div>
  `);
  $('submit-modal')?.classList.add('open');
}

function closeSubmitModal() {
  $('submit-modal')?.classList.remove('open');
}

/* ──────────────────────────────────────────
   SUBMIT EXAM
────────────────────────────────────────── */
function submitExam(auto = false) {
  closeSubmitModal();
  clearInterval(state.timerInterval);
  state.examFinished = true;
  localStorage.removeItem(CONFIG.STORAGE_KEY);
  calculateAndShowResults();
  showPage('page-result');
  if (auto) {
    const header = document.querySelector('.result-header p');
    if (header) header.textContent = 'Time expired – auto-submitted';
  }
}

/* ──────────────────────────────────────────
   RESULTS
────────────────────────────────────────── */
function calculateAndShowResults() {
  let correct = 0, wrong = 0, unattempted = 0;
  let p1correct = 0, p1total = 0, p2correct = 0, p2total = 0;
  const topicMap = {};

  state.questions.forEach((q, idx) => {
    const paperNum = q.paper || (idx < 50 ? 1 : 2);
    if (paperNum === 1) p1total++; else p2total++;

    const topic = q.topic || 'General';
    if (!topicMap[topic]) topicMap[topic] = { correct: 0, total: 0 };
    topicMap[topic].total++;

    const ans = state.userAnswers[idx];
    if (ans === undefined || ans === null) { unattempted++; return; }
    if (ans === q.answer) {
      correct++;
      topicMap[topic].correct++;
      if (paperNum === 1) p1correct++; else p2correct++;
    } else {
      wrong++;
    }
  });

  const attempted  = correct + wrong;
  const totalScore = correct * CONFIG.MARKS_PER_CORRECT;
  const maxScore   = state.questions.length * CONFIG.MARKS_PER_CORRECT;
  const percentage = maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(1) : 0;
  const passed     = parseFloat(percentage) >= CONFIG.PASS_PERCENTAGE;
  const accuracy   = attempted > 0 ? ((correct / attempted) * 100).toFixed(1) : 0;
  const p1pct      = p1total > 0 ? ((p1correct / p1total) * 100).toFixed(1) : 0;
  const p2pct      = p2total > 0 ? ((p2correct / p2total) * 100).toFixed(1) : 0;

  // Score card
  setHTML('result-score-card', `
    <div class="score-main ${passed ? 'pass' : 'fail'}">
      <div class="score-circle">
        <span class="score-num">${totalScore}</span>
        <span class="score-max">/ ${maxScore}</span>
      </div>
      <div class="score-badge ${passed ? 'pass' : 'fail'}">${passed ? '🎉 PASS' : '❌ FAIL'}</div>
      <div class="score-pct">${percentage}%</div>
    </div>
    <div class="score-grid">
      <div class="score-item green"><span>${correct}</span><small>Correct</small></div>
      <div class="score-item red"><span>${wrong}</span><small>Wrong</small></div>
      <div class="score-item gray"><span>${unattempted}</span><small>Unattempted</small></div>
      <div class="score-item blue"><span>${accuracy}%</span><small>Accuracy</small></div>
    </div>
  `);

  // Paper-wise breakdown
  setHTML('result-breakdown', `
    <h2 class="result-section-title">📊 Paper-wise Breakdown</h2>
    <div class="breakdown-grid">
      <div class="breakdown-card">
        <h3>Paper I – General Aptitude</h3>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar" style="width:${p1pct}%"></div>
        </div>
        <p>${p1correct} / ${p1total} correct &nbsp;·&nbsp; ${p1pct}%</p>
      </div>
      <div class="breakdown-card">
        <h3>Paper II – Philosophy</h3>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar" style="width:${p2pct}%"></div>
        </div>
        <p>${p2correct} / ${p2total} correct &nbsp;·&nbsp; ${p2pct}%</p>
      </div>
    </div>
    <h2 class="result-section-title" style="margin-top:32px">📚 Topic-wise Analysis</h2>
    <div class="topic-table-wrap">
      <table class="topic-table">
        <thead><tr><th>Topic</th><th>Correct</th><th>Total</th><th>Score</th></tr></thead>
        <tbody>${Object.entries(topicMap).map(([topic, d]) => `
          <tr>
            <td>${topic}</td>
            <td>${d.correct}</td>
            <td>${d.total}</td>
            <td>
              <div class="topic-bar-wrap">
                <div class="topic-bar" style="width:${d.total > 0 ? (d.correct/d.total*100).toFixed(0) : 0}%"></div>
                <span>${d.total > 0 ? (d.correct/d.total*100).toFixed(0) : 0}%</span>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `);

  // Answer key
  let ansKeyHTML = '<h2 class="result-section-title">📋 Answer Review</h2><div class="answer-key-list">';
  state.questions.forEach((q, idx) => {
    const userAns = state.userAnswers[idx];
    const correct2 = userAns === q.answer;
    const unattempted2 = userAns === undefined || userAns === null;
    const statusClass = unattempted2 ? 'ak-unattempted' : correct2 ? 'ak-correct' : 'ak-wrong';
    const icon = unattempted2 ? '—' : correct2 ? '✓' : '✗';
    ansKeyHTML += `
      <div class="ak-item ${statusClass}">
        <div class="ak-header">
          <span class="ak-num">Q${idx + 1}</span>
          <span class="ak-icon">${icon}</span>
          <span class="ak-topic">${q.topic || ''}</span>
        </div>
        <p class="ak-question">${q.question}</p>
        ${!unattempted2 ? `<p class="ak-your">Your Answer: <strong>${q.options[userAns] || 'N/A'}</strong></p>` : '<p class="ak-your">Not attempted</p>'}
        <p class="ak-correct-ans">Correct Answer: <strong>${q.options[q.answer] !== undefined ? q.options[q.answer] : 'N/A'}</strong></p>
      </div>`;
  });
  ansKeyHTML += '</div>';
  setHTML('result-answer-key', ansKeyHTML);
}

/* ──────────────────────────────────────────
   RESULT BINDINGS
────────────────────────────────────────── */
function bindResult() {
  $('btn-restart')?.addEventListener('click', () => {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    location.reload();
  });
  $('btn-home-result')?.addEventListener('click', () => showPage('page-home'));
}

/* ──────────────────────────────────────────
   LOCAL STORAGE — SAVE / RESTORE
────────────────────────────────────────── */
function saveProgress() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
      userAnswers:   state.userAnswers,
      qStatus:       state.qStatus,
      currentIndex:  state.currentIndex,
      timerSeconds:  state.timerSeconds,
      examStarted:   state.examStarted,
    }));
  } catch (e) { /* storage full */ }
}

function restoreProgress() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.examStarted && state.questions.length) {
      state.userAnswers  = d.userAnswers  || {};
      state.qStatus      = d.qStatus      || {};
      state.currentIndex = d.currentIndex || 0;
      state.timerSeconds = d.timerSeconds || CONFIG.EXAM_DURATION_SECONDS;
      state.examStarted  = true;
      // Re-init any missing statuses
      initStatuses();
      // Ask user if they want to resume
      if (confirm('You have an exam in progress. Resume it?')) {
        showPage('page-exam');
        buildPalette();
        renderQuestion();
        startTimer();
      } else {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        state.examStarted  = false;
        state.userAnswers  = {};
        state.qStatus      = {};
        state.currentIndex = 0;
        state.timerSeconds = CONFIG.EXAM_DURATION_SECONDS;
        initStatuses();
      }
    }
  } catch (e) { localStorage.removeItem(CONFIG.STORAGE_KEY); }
}
