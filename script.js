/**
 * UGC NET Philosophy Mock Test — script.js
 * ==========================================
 * Pure vanilla JS. No frameworks, no build step.
 *
 * Expected HTML element IDs (mirror these in your index.html):
 *
 * Pages (sections toggled visible/hidden):
 *   #page-home | #page-instructions | #page-exam | #page-result
 *
 * Home:
 *   #btn-goto-instructions
 *
 * Instructions:
 *   #agree-checkbox | #btn-start-test
 *
 * Exam – header:
 *   #exam-title | #timer-display | #candidate-name | #current-paper-label
 *
 * Exam – sidebar:
 *   #palette-container
 *   #legend-container  (optional; colored legend boxes)
 *   #palette-paper1-btn | #palette-paper2-btn  (paper-switcher buttons in palette)
 *
 * Exam – question area:
 *   #question-number | #subject-label | #question-text | #options-container
 *
 * Exam – bottom bar:
 *   #btn-save-next | #btn-mark-review | #btn-clear | #btn-prev | #btn-submit
 *
 * Result:
 *   #result-score | #result-correct | #result-wrong | #result-attempted
 *   #result-unattempted | #result-percentage | #result-status
 *   #topic-performance-container | #btn-restart | #btn-review-answers
 *
 * Extras (optional):
 *   #btn-dark-mode  (dark-mode toggle)
 *   #btn-fullscreen (fullscreen toggle)
 *   #btn-submit-header (secondary submit in header)
 *   #progress-bar   (thin bar below header showing completion %)
 */

'use strict';

/* ─────────────────────────────────────────────
   0.  CONSTANTS
───────────────────────────────────────────── */
const EXAM_DURATION_SECONDS = 3 * 60 * 60; // 3 hours
const MARKS_PER_QUESTION    = 2;
const NEGATIVE_MARKING      = 0;           // 0 = no negative marking
const PASS_PERCENTAGE       = 40;          // cutoff for pass/fail display

const STATUS = {
  NOT_VISITED : 'not-visited', // Gray  – default
  NOT_ANSWERED: 'not-answered',// Red   – visited but no option picked
  ANSWERED    : 'answered',    // Green – option picked and saved
  MARKED      : 'marked',      // Purple– marked for review (no answer)
  MARKED_ANS  : 'marked-answered', // Purple-green – marked AND answered
};

const LS_KEY = 'ugcnet_mock_progress';

/* ─────────────────────────────────────────────
   1.  STATE
───────────────────────────────────────────── */
let state = {
  questions       : [],     // full question array after fetch
  userAnswers     : {},     // { qIndex: optionIndex | null }
  questionStatus  : {},     // { qIndex: STATUS.* }
  currentIndex    : 0,
  timerSeconds    : EXAM_DURATION_SECONDS,
  timerInterval   : null,
  examStarted     : false,
  examFinished    : false,
  activePaperFilter: 1,     // which paper palette is showing (1 or 2)
  darkMode        : false,
  soundAlerted    : false,  // 5-min warning sound fired
};

/* ─────────────────────────────────────────────
   2.  DOM HELPERS
───────────────────────────────────────────── */
const $  = (id)  => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function showPage(pageId) {
  ['page-home', 'page-instructions', 'page-exam', 'page-result']
    .forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('active-page', id === pageId);
    });
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

/* ─────────────────────────────────────────────
   3.  PAGE ROUTING – HOME & INSTRUCTIONS
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  showPage('page-home');
  bindHomeEvents();
  bindInstructionEvents();
  bindExamEvents();
  bindResultEvents();
  bindExtras();
  restoreProgress(); // try to resume an in-progress exam
});

function bindHomeEvents() {
  const btn = $('btn-goto-instructions');
  if (btn) btn.addEventListener('click', () => showPage('page-instructions'));
}

function bindInstructionEvents() {
  const checkbox = $('agree-checkbox');
  const startBtn = $('btn-start-test');
  if (!checkbox || !startBtn) return;

  startBtn.disabled = true;

  checkbox.addEventListener('change', () => {
    startBtn.disabled = !checkbox.checked;
  });

  startBtn.addEventListener('click', async () => {
    await initExam();
  });
}

/* ─────────────────────────────────────────────
   4.  QUESTION DATA – FETCH & INIT
───────────────────────────────────────────── */
async function initExam() {
  if (state.questions.length === 0) {
    try {
      const res = await fetch('questions.json');
      if (!res.ok) throw new Error('Could not load questions.json');
      state.questions = await res.json();
    } catch (err) {
      alert('⚠ Failed to load questions: ' + err.message + '\nMake sure questions.json is in the same folder.');
      return;
    }
  }

  // Initialise answer/status maps
  state.questions.forEach((_, i) => {
    if (!(i in state.userAnswers))   state.userAnswers[i]    = null;
    if (!(i in state.questionStatus)) state.questionStatus[i] = STATUS.NOT_VISITED;
  });

  state.currentIndex  = 0;
  state.examStarted   = true;
  state.examFinished  = false;
  state.soundAlerted  = false;

  showPage('page-exam');
  preventUnload(true);
  renderQuestion(state.currentIndex);
  buildPalette();
  startTimer();
  updateProgress();
}

/* ─────────────────────────────────────────────
   5.  TIMER
───────────────────────────────────────────── */
function startTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(tickTimer, 1000);
  updateTimerDisplay();
}

function tickTimer() {
  if (state.timerSeconds <= 0) {
    clearInterval(state.timerInterval);
    autoSubmit();
    return;
  }
  state.timerSeconds--;
  updateTimerDisplay();

  // 5-minute sound alert
  if (state.timerSeconds === 300 && !state.soundAlerted) {
    state.soundAlerted = true;
    playBeep(440, 600); // A4 tone, 600 ms
    showToast('⏰ 5 minutes remaining!', 'warning');
  }
  // 1-minute urgent alert
  if (state.timerSeconds === 60) {
    showToast('🚨 Only 1 minute left!', 'danger');
  }

  saveProgress();
}

function updateTimerDisplay() {
  const h = Math.floor(state.timerSeconds / 3600);
  const m = Math.floor((state.timerSeconds % 3600) / 60);
  const s = state.timerSeconds % 60;
  const display = `${pad(h)}:${pad(m)}:${pad(s)}`;
  setText('timer-display', display);

  const timerEl = $('timer-display');
  if (timerEl) {
    timerEl.classList.toggle('timer-warning', state.timerSeconds <= 300);
    timerEl.classList.toggle('timer-danger',  state.timerSeconds <= 60);
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

/* ─────────────────────────────────────────────
   6.  RENDER QUESTION
───────────────────────────────────────────── */
function renderQuestion(index) {
  const q = state.questions[index];
  if (!q) return;

  // Mark as visited if it was NOT_VISITED
  if (state.questionStatus[index] === STATUS.NOT_VISITED) {
    state.questionStatus[index] = STATUS.NOT_ANSWERED;
  }

  // Header meta
  setText('question-number', `Question ${index + 1} of ${state.questions.length}`);
  setText('subject-label',   q.topic || (q.paper === 1 ? 'Paper I – General' : 'Paper II – Philosophy'));
  setText('current-paper-label', q.paper === 1 ? 'Paper I' : 'Paper II – Philosophy');

  // Question text
  setHTML('question-text', q.question);

  // Options
  const container = $('options-container');
  if (!container) return;
  container.innerHTML = '';

  q.options.forEach((opt, i) => {
    const label = document.createElement('label');
    label.className = 'option-label';

    const radio = document.createElement('input');
    radio.type  = 'radio';
    radio.name  = 'q-option';
    radio.value = i;
    radio.checked = state.userAnswers[index] === i;
    radio.addEventListener('change', () => {
      state.userAnswers[index] = i;
      // Update status to answered (preserve marked-answered)
      if (state.questionStatus[index] === STATUS.MARKED ||
          state.questionStatus[index] === STATUS.MARKED_ANS) {
        state.questionStatus[index] = STATUS.MARKED_ANS;
      } else {
        state.questionStatus[index] = STATUS.ANSWERED;
      }
      updatePaletteButton(index);
      updateProgress();
    });

    const span = document.createElement('span');
    span.className = 'option-text';
    span.innerHTML = `<b>${String.fromCharCode(65 + i)}.</b> ${opt}`;

    label.appendChild(radio);
    label.appendChild(span);
    container.appendChild(label);
  });

  updatePalette();
  scrollPaletteToActive(index);
}

/* ─────────────────────────────────────────────
   7.  PALETTE
───────────────────────────────────────────── */
function buildPalette() {
  // Build palette for both papers; shown/hidden via activePaperFilter
  renderPaletteForPaper(1);
  renderPaletteForPaper(2);
  setupPaperSwitcher();
  switchPaletteView(1);
}

function renderPaletteForPaper(paper) {
  const containerId = `palette-paper${paper}`;
  let container = $(containerId);
  if (!container) {
    // Create a sub-container inside palette-container
    const parent = $('palette-container');
    if (!parent) return;
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'palette-paper-grid';
    parent.appendChild(container);
  }
  container.innerHTML = '';

  state.questions.forEach((q, i) => {
    if (q.paper !== paper) return;
    const btn  = createPaletteBtn(i);
    container.appendChild(btn);
  });
}

function createPaletteBtn(index) {
  const q   = state.questions[index];
  const btn = document.createElement('button');
  btn.id        = `pal-btn-${index}`;
  btn.className = `palette-btn status-${state.questionStatus[index]}`;

  // Show local index within paper (1-based)
  const localIndex = state.questions
    .slice(0, index + 1)
    .filter(x => x.paper === q.paper).length;
  btn.textContent = localIndex;
  btn.setAttribute('title', `Q${index + 1}: ${q.topic}`);

  btn.addEventListener('click', () => navigateTo(index));
  return btn;
}

function updatePalette() {
  state.questions.forEach((_, i) => updatePaletteButton(i));
}

function updatePaletteButton(index) {
  const btn = $(`pal-btn-${index}`);
  if (!btn) return;
  btn.className = `palette-btn status-${state.questionStatus[index]}`;
  if (index === state.currentIndex) btn.classList.add('palette-btn-current');
}

function setupPaperSwitcher() {
  const btn1 = $('palette-paper1-btn');
  const btn2 = $('palette-paper2-btn');
  if (btn1) btn1.addEventListener('click', () => switchPaletteView(1));
  if (btn2) btn2.addEventListener('click', () => switchPaletteView(2));
}

function switchPaletteView(paper) {
  state.activePaperFilter = paper;
  ['palette-paper1', 'palette-paper2'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = id.endsWith(String(paper)) ? 'grid' : 'none';
  });
  // highlight active switcher button
  [$('palette-paper1-btn'), $('palette-paper2-btn')].forEach((btn, i) => {
    if (btn) btn.classList.toggle('active-paper-btn', i + 1 === paper);
  });
}

function scrollPaletteToActive(index) {
  const btn = $(`pal-btn-${index}`);
  if (btn) btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ─────────────────────────────────────────────
   8.  NAVIGATION
───────────────────────────────────────────── */
function navigateTo(index) {
  if (index < 0 || index >= state.questions.length) return;
  state.currentIndex = index;
  renderQuestion(index);

  // Auto-switch palette paper view to match question
  const paper = state.questions[index].paper;
  if (paper !== state.activePaperFilter) switchPaletteView(paper);

  updatePalette();
  updateProgress();
}

function bindExamEvents() {
  safeClick('btn-save-next',    handleSaveNext);
  safeClick('btn-mark-review',  handleMarkForReview);
  safeClick('btn-clear',        handleClearResponse);
  safeClick('btn-prev',         handlePrev);
  safeClick('btn-submit',       handleSubmitClick);
  safeClick('btn-submit-header',handleSubmitClick);
}

function safeClick(id, fn) {
  const el = $(id);
  if (el) el.addEventListener('click', fn);
}

function handleSaveNext() {
  const idx = state.currentIndex;
  // Ensure the current answer is persisted (radio already updates state)
  if (state.userAnswers[idx] !== null) {
    if (state.questionStatus[idx] === STATUS.MARKED) {
      state.questionStatus[idx] = STATUS.MARKED_ANS;
    } else {
      state.questionStatus[idx] = STATUS.ANSWERED;
    }
  } else {
    if (state.questionStatus[idx] === STATUS.NOT_VISITED) {
      state.questionStatus[idx] = STATUS.NOT_ANSWERED;
    }
  }
  updatePaletteButton(idx);
  updateProgress();
  saveProgress();

  // Move to next question
  if (idx < state.questions.length - 1) {
    navigateTo(idx + 1);
  } else {
    showToast('You are on the last question.', 'info');
  }
}

function handleMarkForReview() {
  const idx = state.currentIndex;
  if (state.userAnswers[idx] !== null) {
    state.questionStatus[idx] = STATUS.MARKED_ANS;
  } else {
    state.questionStatus[idx] = STATUS.MARKED;
  }
  updatePaletteButton(idx);
  saveProgress();

  // Move to next
  if (idx < state.questions.length - 1) navigateTo(idx + 1);
}

function handleClearResponse() {
  const idx = state.currentIndex;
  state.userAnswers[idx] = null;
  state.questionStatus[idx] = STATUS.NOT_ANSWERED;
  // De-select all radios visually
  $$('input[name="q-option"]').forEach(r => r.checked = false);
  updatePaletteButton(idx);
  updateProgress();
  saveProgress();
}

function handlePrev() {
  if (state.currentIndex > 0) navigateTo(state.currentIndex - 1);
}

function handleSubmitClick() {
  const attempted = Object.values(state.userAnswers).filter(v => v !== null).length;
  const total     = state.questions.length;
  const unattempted = total - attempted;

  if (unattempted > 0) {
    const confirmed = confirm(
      `You have ${unattempted} unanswered question(s).\n\n` +
      `Attempted: ${attempted} / ${total}\n\n` +
      `Are you sure you want to submit?`
    );
    if (!confirmed) return;
  }
  submitExam();
}

/* ─────────────────────────────────────────────
   9.  SUBMIT & SCORE CALCULATION
───────────────────────────────────────────── */
function autoSubmit() {
  showToast('⏰ Time up! Submitting your exam…', 'danger');
  setTimeout(submitExam, 1500);
}

function submitExam() {
  clearInterval(state.timerInterval);
  state.examFinished = true;
  preventUnload(false);
  saveProgress(); // persist final state

  const result = calculateResult();
  showResultPage(result);
}

function calculateResult() {
  let correct = 0, wrong = 0, attempted = 0;
  const topicMap = {}; // { topicName: { correct, total } }

  state.questions.forEach((q, i) => {
    const topic = q.topic || 'General';
    if (!topicMap[topic]) topicMap[topic] = { correct: 0, total: 0 };
    topicMap[topic].total++;

    const userAns = state.userAnswers[i];
    if (userAns !== null && userAns !== undefined) {
      attempted++;
      if (userAns === q.answer) {
        correct++;
        topicMap[topic].correct++;
      } else {
        wrong++;
      }
    }
  });

  const score      = correct * MARKS_PER_QUESTION - wrong * NEGATIVE_MARKING;
  const maxScore   = state.questions.length * MARKS_PER_QUESTION;
  const percentage = maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : '0.0';
  const passed     = parseFloat(percentage) >= PASS_PERCENTAGE;

  return {
    score, maxScore, correct, wrong, attempted,
    unattempted: state.questions.length - attempted,
    percentage, passed, topicMap,
    timeTaken: EXAM_DURATION_SECONDS - state.timerSeconds,
  };
}

/* ─────────────────────────────────────────────
   10.  RESULT PAGE
───────────────────────────────────────────── */
function showResultPage(r) {
  showPage('page-result');

  setText('result-score',       `${r.score} / ${r.maxScore}`);
  setText('result-correct',     r.correct);
  setText('result-wrong',       r.wrong);
  setText('result-attempted',   r.attempted);
  setText('result-unattempted', r.unattempted);
  setText('result-percentage',  `${r.percentage}%`);

  const statusEl = $('result-status');
  if (statusEl) {
    statusEl.textContent  = r.passed ? '✅ PASS' : '❌ FAIL';
    statusEl.className    = r.passed ? 'result-pass' : 'result-fail';
  }

  // Time taken
  const ttEl = $('result-time-taken');
  if (ttEl) ttEl.textContent = formatDuration(r.timeTaken);

  // Topic-wise breakdown
  renderTopicPerformance(r.topicMap);
}

function renderTopicPerformance(topicMap) {
  const container = $('topic-performance-container');
  if (!container) return;
  container.innerHTML = '';

  const sorted = Object.entries(topicMap).sort((a, b) => b[1].total - a[1].total);

  sorted.forEach(([topic, data]) => {
    const pct = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'topic-row';
    row.innerHTML = `
      <div class="topic-name">${topic}</div>
      <div class="topic-bar-wrap">
        <div class="topic-bar" style="width:${pct}%" data-pct="${pct}"></div>
      </div>
      <div class="topic-stat">${data.correct}/${data.total} (${pct}%)</div>
    `;
    container.appendChild(row);
  });

  // Animate bars after insertion
  requestAnimationFrame(() => {
    container.querySelectorAll('.topic-bar').forEach(bar => {
      bar.style.transition = 'width 0.8s ease';
    });
  });
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function bindResultEvents() {
  safeClick('btn-restart', handleRestart);
  safeClick('btn-review-answers', handleReviewAnswers);
}

function handleRestart() {
  if (!confirm('This will clear your current test progress. Start fresh?')) return;
  clearProgress();
  resetState();
  showPage('page-home');
}

function handleReviewAnswers() {
  // Switch to exam page in read-only review mode
  state.examFinished = true;
  showPage('page-exam');
  navigateTo(0);
  renderReviewBanner();
}

function renderReviewBanner() {
  const header = $('exam-header');
  if (!header) return;
  const banner = document.createElement('div');
  banner.id        = 'review-banner';
  banner.className = 'review-banner';
  banner.textContent = '📋 REVIEW MODE – Answers are read-only';
  header.prepend(banner);
}

/* ─────────────────────────────────────────────
   11.  PROGRESS BAR
───────────────────────────────────────────── */
function updateProgress() {
  const answered   = Object.values(state.userAnswers).filter(v => v !== null).length;
  const total      = state.questions.length;
  const pct        = total > 0 ? (answered / total) * 100 : 0;

  const bar = $('progress-bar');
  if (bar) bar.style.width = `${pct}%`;

  // Also update the header count if present
  setText('answered-count', `${answered}/${total} Answered`);
}

/* ─────────────────────────────────────────────
   12.  LOCAL STORAGE – SAVE / RESTORE / CLEAR
───────────────────────────────────────────── */
function saveProgress() {
  if (!state.examStarted || state.examFinished) return;
  const snapshot = {
    questions       : state.questions,
    userAnswers     : state.userAnswers,
    questionStatus  : state.questionStatus,
    currentIndex    : state.currentIndex,
    timerSeconds    : state.timerSeconds,
    darkMode        : state.darkMode,
    savedAt         : Date.now(),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // Storage quota exceeded – silently ignore
  }
}

function restoreProgress() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    // Only restore if saved within the last 4 hours
    if (Date.now() - snap.savedAt > 4 * 60 * 60 * 1000) {
      clearProgress();
      return;
    }
    const resume = confirm(
      '⚡ You have an unfinished exam session.\n\nWould you like to resume where you left off?'
    );
    if (!resume) { clearProgress(); return; }

    state.questions       = snap.questions;
    state.userAnswers     = snap.userAnswers;
    state.questionStatus  = snap.questionStatus;
    state.currentIndex    = snap.currentIndex;
    state.timerSeconds    = snap.timerSeconds;
    state.darkMode        = snap.darkMode || false;
    state.examStarted     = true;

    if (state.darkMode) document.body.classList.add('dark-mode');

    showPage('page-exam');
    buildPalette();
    renderQuestion(state.currentIndex);
    startTimer();
    updateProgress();
    preventUnload(true);
  } catch (e) {
    clearProgress();
  }
}

function clearProgress() {
  localStorage.removeItem(LS_KEY);
}

function resetState() {
  clearInterval(state.timerInterval);
  state.questions       = [];
  state.userAnswers     = {};
  state.questionStatus  = {};
  state.currentIndex    = 0;
  state.timerSeconds    = EXAM_DURATION_SECONDS;
  state.timerInterval   = null;
  state.examStarted     = false;
  state.examFinished    = false;
  state.soundAlerted    = false;
}

/* ─────────────────────────────────────────────
   13.  PREVENT ACCIDENTAL NAVIGATION
───────────────────────────────────────────── */
function preventUnload(active) {
  if (active) {
    window.onbeforeunload = (e) => {
      const msg = 'Your exam is in progress. Leaving will not submit your answers.';
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    };
  } else {
    window.onbeforeunload = null;
  }
}

/* ─────────────────────────────────────────────
   14.  EXTRAS – DARK MODE, FULLSCREEN, TOAST, BEEP
───────────────────────────────────────────── */
function bindExtras() {
  safeClick('btn-dark-mode',  toggleDarkMode);
  safeClick('btn-fullscreen', toggleFullscreen);
}

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark-mode', state.darkMode);
  const btn = $('btn-dark-mode');
  if (btn) btn.textContent = state.darkMode ? '☀ Light' : '🌙 Dark';
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    const btn = $('btn-fullscreen');
    if (btn) btn.textContent = '⛶ Exit Fullscreen';
  } else {
    document.exitFullscreen();
    const btn = $('btn-fullscreen');
    if (btn) btn.textContent = '⛶ Fullscreen';
  }
}

/* ---- Toast notification ---- */
let toastTimeout = null;
function showToast(message, type = 'info') {
  let toast = $('toast-message');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-message';
    document.body.appendChild(toast);
  }
  toast.textContent  = message;
  toast.className    = `toast toast-${type} toast-visible`;

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('toast-visible');
  }, 3500);
}

/* ---- Web Audio API beep ---- */
function playBeep(frequency = 440, duration = 500) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (e) {
    // AudioContext not supported – silently skip
  }
}

/* ─────────────────────────────────────────────
   15.  KEYBOARD SHORTCUTS
───────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (!state.examStarted || state.examFinished) return;

  // Alt+1..4 → choose option A..D
  if (e.altKey && ['1','2','3','4'].includes(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    const radios = $$('input[name="q-option"]');
    if (radios[idx]) {
      radios[idx].checked = true;
      radios[idx].dispatchEvent(new Event('change'));
    }
    return;
  }

  switch (e.key) {
    case 'ArrowRight':
    case 'Enter':
      if (!e.target.matches('button, input')) handleSaveNext();
      break;
    case 'ArrowLeft':
      handlePrev();
      break;
    case 'm':
    case 'M':
      handleMarkForReview();
      break;
    case 'c':
    case 'C':
      if (!e.target.matches('input')) handleClearResponse();
      break;
  }
});

/* ─────────────────────────────────────────────
   16.  PAPER NAVIGATION HELPERS
         (jump to first question of a paper)
───────────────────────────────────────────── */
function jumpToPaper(paper) {
  const idx = state.questions.findIndex(q => q.paper === paper);
  if (idx !== -1) navigateTo(idx);
}

// Expose globally in case HTML uses onclick=""
window.jumpToPaper = jumpToPaper;
window.navigateTo  = navigateTo;
window.switchPaletteView = switchPaletteView;
