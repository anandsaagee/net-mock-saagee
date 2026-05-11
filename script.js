```javascript id="h4p2ka"
/**
 * UGC NET Philosophy Mock Test Engine
 * Scalable production-grade architecture
 * Supports:
 * - Unlimited JSON files
 * - Manifest-based loading
 * - Balanced randomization
 * - Duplicate prevention
 * - Persistent sessions
 * - Topic analytics
 * - Dark mode
 * - Review mode
 */

'use strict';

/* ═══════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════ */

const CONFIG = {
  duration: 3 * 60 * 60,
  marksPerQ: 2,
  passMark: 40,
  storageKey: 'ugcnet_session_v2',
  examQuestionCount: 100,
  persistDelay: 300,
};

/* ═══════════════════════════════════════════
   STATUS
═══════════════════════════════════════════ */

const S = {
  UNVISITED: 'unvisited',
  UNANSWERED: 'unanswered',
  ANSWERED: 'answered',
  MARKED: 'marked',
  MARKED_ANS: 'marked-ans',
};

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */

const exam = {
  questionBank: [],
  questions: [],
  answers: {},
  status: {},
  index: 0,
  remaining: CONFIG.duration,
  ticker: null,
  started: false,
  finished: false,
  darkMode: false,
};

/* ═══════════════════════════════════════════
   DOM
═══════════════════════════════════════════ */

const el = id => document.getElementById(id);
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

  on('btn-goto-instructions', () => {
    showPage('page-instructions');
  });

  const checkbox = el('agree-checkbox');
  const startBtn = el('btn-start-test');

  if (checkbox && startBtn) {

    startBtn.disabled = true;

    checkbox.addEventListener('change', () => {
      startBtn.disabled = !checkbox.checked;
    });

    startBtn.addEventListener('click', loadAndStart);
  }

  on('btn-save-next', saveAndNext);
  on('btn-mark-review', markForReview);
  on('btn-clear', clearResponse);
  on('btn-prev', () => goto(exam.index - 1));
  on('btn-submit', confirmSubmit);
  on('btn-submit-header', confirmSubmit);
  on('btn-restart', restart);
  on('btn-review', enterReviewMode);
  on('btn-dark-mode', toggleDark);

  document.addEventListener('keydown', handleKey);

  document.addEventListener('fullscreenchange', () => {
    setText(
      'btn-fullscreen',
      document.fullscreenElement
        ? '⛶ Exit'
        : '⛶ Fullscreen'
    );
  });

  on('btn-fullscreen', toggleFullscreen);

  document.addEventListener('contextmenu', e => {
    e.preventDefault();
  });

  document.addEventListener('copy', e => {
    e.preventDefault();
  });
}

function on(id, fn) {
  const node = el(id);
  if (node) node.addEventListener('click', fn);
}

/* ═══════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════ */

const PAGES = [
  'page-home',
  'page-instructions',
  'page-exam',
  'page-result'
];

function showPage(id) {

  PAGES.forEach(p => {

    const node = el(p);

    if (!node) return;

    node.classList.toggle(
      'active-page',
      p === id
    );
  });
}

/* ═══════════════════════════════════════════
   LOAD QUESTION BANK
═══════════════════════════════════════════ */

async function loadAndStart() {

  try {

    toast('Loading question bank...', 'info');

    const bank = await loadQuestionBank();

    if (!bank.length) {
      toast('No valid questions found', 'danger');
      return;
    }

    exam.questionBank = bank;

    exam.questions = buildBalancedExam(
      bank,
      CONFIG.examQuestionCount
    );

    initialiseExam();

    startExam();

  } catch (err) {

    console.error(err);

    toast(
      'Failed to load question bank',
      'danger'
    );
  }
}

async function loadQuestionBank() {

  const manifestRes = await fetch(
    './data/manifest.json',
    {
      cache: 'no-store'
    }
  );

  if (!manifestRes.ok) {
    throw new Error('manifest.json missing');
  }

  const manifest = await manifestRes.json();

  if (
    !manifest.files ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('Invalid manifest format');
  }

  const allQuestions = [];

  for (const file of manifest.files) {

    try {

      const res = await fetch(
        `./data/${file}`,
        {
          cache: 'no-store'
        }
      );

      if (!res.ok) {
        console.warn(`${file} skipped`);
        continue;
      }

      const data = await res.json();

      if (!Array.isArray(data)) {
        console.warn(`${file} invalid`);
        continue;
      }

      allQuestions.push(...data);

    } catch (err) {

      console.warn(
        `${file} failed`,
        err
      );
    }
  }

  return sanitizeQuestions(allQuestions);
}

/* ═══════════════════════════════════════════
   SANITIZER
═══════════════════════════════════════════ */

function sanitizeQuestions(questions) {

  const seen = new Set();

  const clean = [];

  for (const q of questions) {

    if (
      !q.id ||
      !q.question ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      typeof q.answer !== 'number'
    ) {

      console.warn('Invalid question', q);

      continue;
    }

    if (seen.has(q.id)) {

      console.warn(
        'Duplicate skipped',
        q.id
      );

      continue;
    }

    seen.add(q.id);

    clean.push({
      id: q.id,
      paper: q.paper || 2,
      topic: q.topic || 'General',
      difficulty: q.difficulty || 'medium',
      question: String(q.question).trim(),
      options: q.options.map(o =>
        String(o).trim()
      ),
      answer: q.answer,
    });
  }

  return clean;
}

/* ═══════════════════════════════════════════
   BALANCED RANDOMIZATION
═══════════════════════════════════════════ */

function buildBalancedExam(
  questionBank,
  totalQuestions = 100
) {

  const grouped = {};

  for (const q of questionBank) {

    const key = q.topic;

    if (!grouped[key]) {
      grouped[key] = [];
    }

    grouped[key].push(q);
  }

  const topics = Object.keys(grouped);

  if (!topics.length) return [];

  const perTopic = Math.floor(
    totalQuestions / topics.length
  );

  let selected = [];

  for (const topic of topics) {

    const shuffled = shuffle([
      ...grouped[topic]
    ]);

    selected.push(
      ...shuffled.slice(0, perTopic)
    );
  }

  const remaining =
    totalQuestions - selected.length;

  if (remaining > 0) {

    const used = new Set(
      selected.map(q => q.id)
    );

    const leftovers =
      questionBank.filter(
        q => !used.has(q.id)
      );

    selected.push(
      ...shuffle(leftovers).slice(
        0,
        remaining
      )
    );
  }

  return shuffle(selected);
}

function shuffle(arr) {

  for (
    let i = arr.length - 1;
    i > 0;
    i--
  ) {

    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [arr[i], arr[j]] =
      [arr[j], arr[i]];
  }

  return arr;
}

/* ═══════════════════════════════════════════
   INITIALISE
═══════════════════════════════════════════ */

function initialiseExam() {

  exam.questions.forEach((_, i) => {

    exam.answers[i] = null;

    exam.status[i] = S.UNVISITED;
  });

  exam.index = 0;
  exam.remaining = CONFIG.duration;
  exam.finished = false;
  exam.started = true;
}

/* ═══════════════════════════════════════════
   START EXAM
═══════════════════════════════════════════ */

function startExam() {

  showPage('page-exam');

  buildPalette();

  goto(0);

  startTimer();

  updateProgress();

  guardUnload(true);
}

/* ═══════════════════════════════════════════
   TIMER
═══════════════════════════════════════════ */

function startTimer() {

  clearInterval(exam.ticker);

  renderTimer();

  exam.ticker = setInterval(() => {

    if (exam.remaining <= 0) {

      clearInterval(exam.ticker);

      autoSubmit();

      return;
    }

    exam.remaining--;

    renderTimer();

    persist();

  }, 1000);
}

function renderTimer() {

  const h = Math.floor(
    exam.remaining / 3600
  );

  const m = Math.floor(
    (exam.remaining % 3600) / 60
  );

  const s = exam.remaining % 60;

  setText(
    'timer-display',
    `${pad(h)}:${pad(m)}:${pad(s)}`
  );
}

/* ═══════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════ */

let prevIndex = null;

function goto(idx) {

  if (
    idx < 0 ||
    idx >= exam.questions.length
  ) return;

  prevIndex = exam.index;

  if (
    exam.status[idx] === S.UNVISITED
  ) {
    exam.status[idx] = S.UNANSWERED;
  }

  exam.index = idx;

  const q = exam.questions[idx];

  setText(
    'question-number',
    `Question ${idx + 1} of ${exam.questions.length}`
  );

  setText(
    'subject-label',
    q.topic
  );

  setText(
    'paper-label',
    `Paper ${q.paper}`
  );

  setText(
    'question-text',
    q.question
  );

  const wrap = el('options-container');

  if (!wrap) return;

  wrap.innerHTML = '';

  q.options.forEach((opt, i) => {

    const lbl =
      document.createElement('label');

    lbl.className =
      'option' +
      (
        exam.answers[idx] === i
          ? ' option-selected'
          : ''
      );

    const radio =
      document.createElement('input');

    radio.type = 'radio';
    radio.name = 'opt';
    radio.value = i;

    radio.checked =
      exam.answers[idx] === i;

    if (exam.finished) {

      radio.disabled = true;

    } else {

      radio.addEventListener(
        'change',
        () => pickAnswer(idx, i)
      );
    }

    const txt =
      document.createElement('span');

    txt.innerHTML =
      `<b>${'ABCD'[i]}.</b> ${opt}`;

    lbl.append(
      radio,
      txt
    );

    wrap.appendChild(lbl);
  });

  if (prevIndex !== null) {
    updatePaletteBtn(prevIndex);
  }

  updatePaletteBtn(idx);

  updateProgress();
}

/* ═══════════════════════════════════════════
   ANSWERS
═══════════════════════════════════════════ */

function pickAnswer(idx, optIdx) {

  exam.answers[idx] = optIdx;

  if (
    exam.status[idx] === S.MARKED ||
    exam.status[idx] === S.MARKED_ANS
  ) {

    exam.status[idx] =
      S.MARKED_ANS;

  } else {

    exam.status[idx] =
      S.ANSWERED;
  }

  updatePaletteBtn(idx);

  updateProgress();

  persist();
}

/* ═══════════════════════════════════════════
   CONTROLS
═══════════════════════════════════════════ */

function saveAndNext() {

  persist();

  if (
    exam.index <
    exam.questions.length - 1
  ) {

    goto(exam.index + 1);

  } else {

    toast(
      'Last question reached',
      'info'
    );
  }
}

function markForReview() {

  const i = exam.index;

  exam.status[i] =
    exam.answers[i] !== null
      ? S.MARKED_ANS
      : S.MARKED;

  updatePaletteBtn(i);

  persist();

  saveAndNext();
}

function clearResponse() {

  const i = exam.index;

  exam.answers[i] = null;

  exam.status[i] = S.UNANSWERED;

  goto(i);

  persist();
}

function confirmSubmit() {

  const unanswered =
    exam.questions.length -
    countAttempted();

  if (
    unanswered > 0 &&
    !confirm(
      `${unanswered} unanswered.\nSubmit anyway?`
    )
  ) return;

  submitExam();
}

let submitting = false;

function submitExam() {

  if (submitting) return;

  submitting = true;

  clearInterval(exam.ticker);

  exam.finished = true;

  guardUnload(false);

  persist();

  showResult(calcResult());
}

function autoSubmit() {

  toast(
    'Time up! Submitting...',
    'danger'
  );

  setTimeout(
    submitExam,
    1000
  );
}

/* ═══════════════════════════════════════════
   RESULT
═══════════════════════════════════════════ */

function calcResult() {

  let correct = 0;
  let wrong = 0;
  let attempted = 0;

  const byTopic = {};

  exam.questions.forEach((q, i) => {

    const topic = q.topic;

    if (!byTopic[topic]) {

      byTopic[topic] = {
        correct: 0,
        total: 0
      };
    }

    byTopic[topic].total++;

    if (exam.answers[i] !== null) {

      attempted++;

      if (
        exam.answers[i] === q.answer
      ) {

        correct++;

        byTopic[topic].correct++;

      } else {

        wrong++;
      }
    }
  });

  const score =
    correct * CONFIG.marksPerQ;

  const maxScore =
    exam.questions.length *
    CONFIG.marksPerQ;

  const pct =
    ((score / maxScore) * 100)
      .toFixed(1);

  return {
    correct,
    wrong,
    attempted,
    unattempted:
      exam.questions.length -
      attempted,
    score,
    maxScore,
    pct,
    passed:
      parseFloat(pct) >=
      CONFIG.passMark,
    byTopic,
  };
}

function showResult(r) {

  showPage('page-result');

  setText(
    'result-score',
    `${r.score} / ${r.maxScore}`
  );

  setText(
    'result-correct',
    r.correct
  );

  setText(
    'result-wrong',
    r.wrong
  );

  setText(
    'result-attempted',
    r.attempted
  );

  setText(
    'result-unattempted',
    r.unattempted
  );

  setText(
    'result-pct',
    `${r.pct}%`
  );

  const status =
    el('result-status');

  if (status) {

    status.textContent =
      r.passed
        ? 'PASS'
        : 'FAIL';

    status.className =
      r.passed
        ? 'badge-pass'
        : 'badge-fail';
  }

  renderTopicBars(r.byTopic);
}

/* ═══════════════════════════════════════════
   TOPIC ANALYTICS
═══════════════════════════════════════════ */

function renderTopicBars(byTopic) {

  const wrap = el('topic-wrap');

  if (!wrap) return;

  wrap.innerHTML = '';

  Object.entries(byTopic)
    .forEach(([topic, d]) => {

      const pct = Math.round(
        (d.correct / d.total) * 100
      );

      const row =
        document.createElement('div');

      row.className = 'topic-row';

      row.innerHTML = `
        <div class="topic-name">${topic}</div>
        <div class="topic-bar-track">
          <div class="topic-bar"
               style="width:${pct}%"></div>
        </div>
        <div class="topic-pct">
          ${pct}%
        </div>
      `;

      wrap.appendChild(row);
    });
}

/* ═══════════════════════════════════════════
   PALETTE
═══════════════════════════════════════════ */

function buildPalette() {

  const wrap = el('question-palette');

  if (!wrap) return;

  wrap.innerHTML = '';

  exam.questions.forEach((q, i) => {

    const btn =
      document.createElement('button');

    btn.id = `pb-${i}`;

    btn.className =
      `pal-btn ${exam.status[i]}`;

    btn.textContent = i + 1;

    btn.title = q.topic;

    btn.addEventListener(
      'click',
      () => goto(i)
    );

    wrap.appendChild(btn);
  });
}

function updatePaletteBtn(i) {

  const btn = el(`pb-${i}`);

  if (!btn) return;

  btn.className =
    `pal-btn ${exam.status[i]}` +
    (
      i === exam.index
        ? ' pal-current'
        : ''
    );
}

/* ═══════════════════════════════════════════
   PROGRESS
═══════════════════════════════════════════ */

function updateProgress() {

  const done = countAttempted();

  const total =
    exam.questions.length;

  const pct =
    total > 0
      ? (done / total) * 100
      : 0;

  const bar =
    el('progress-fill');

  if (bar) {
    bar.style.width = pct + '%';
  }

  setText(
    'answered-count',
    `${done}/${total}`
  );
}

function countAttempted() {

  return Object.values(
    exam.answers
  ).filter(v => v !== null).length;
}

/* ═══════════════════════════════════════════
   REVIEW
═══════════════════════════════════════════ */

function enterReviewMode() {

  showPage('page-exam');

  goto(0);
}

/* ═══════════════════════════════════════════
   RESTART
═══════════════════════════════════════════ */

function restart() {

  if (
    !confirm(
      'Restart exam?'
    )
  ) return;

  clearInterval(exam.ticker);

  localStorage.removeItem(
    CONFIG.storageKey
  );

  location.reload();
}

/* ═══════════════════════════════════════════
   STORAGE
═══════════════════════════════════════════ */

let persistTimer = null;

function persist() {

  clearTimeout(persistTimer);

  persistTimer = setTimeout(() => {

    if (!exam.started) return;

    localStorage.setItem(
      CONFIG.storageKey,
      JSON.stringify({
        questions: exam.questions,
        answers: exam.answers,
        status: exam.status,
        index: exam.index,
        remaining: exam.remaining,
        darkMode: exam.darkMode,
        savedAt: Date.now(),
      })
    );

  }, CONFIG.persistDelay);
}

function tryResume() {

  try {

    const raw =
      localStorage.getItem(
        CONFIG.storageKey
      );

    if (!raw) return;

    const snap = JSON.parse(raw);

    if (
      !Array.isArray(
        snap.questions
      )
    ) {
      throw new Error();
    }

    if (
      !confirm(
        'Resume unfinished exam?'
      )
    ) {

      localStorage.removeItem(
        CONFIG.storageKey
      );

      return;
    }

    Object.assign(exam, {
      questions: snap.questions,
      answers: snap.answers,
      status: snap.status,
      index: snap.index,
      remaining: snap.remaining,
      darkMode: snap.darkMode,
      started: true,
    });

    if (exam.darkMode) {
      document.body.classList.add(
        'dark'
      );
    }

    startExam();

    goto(exam.index);

  } catch (err) {

    localStorage.removeItem(
      CONFIG.storageKey
    );
  }
}

/* ═══════════════════════════════════════════
   FULLSCREEN
═══════════════════════════════════════════ */

function toggleFullscreen() {

  if (
    !document.fullscreenElement
  ) {

    document.documentElement
      .requestFullscreen()
      .catch(() => {});

  } else {

    document.exitFullscreen();
  }
}

/* ═══════════════════════════════════════════
   DARK MODE
═══════════════════════════════════════════ */

function toggleDark() {

  exam.darkMode =
    !exam.darkMode;

  document.body.classList.toggle(
    'dark',
    exam.darkMode
  );

  persist();
}

/* ═══════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════ */

function handleKey(e) {

  if (
    !exam.started ||
    exam.finished
  ) return;

  const map = {

    ArrowRight:
      saveAndNext,

    ArrowLeft:
      () => goto(exam.index - 1),

    Enter:
      saveAndNext,

    m:
      markForReview,

    M:
      markForReview,

    c:
      clearResponse,

    C:
      clearResponse,
  };

  if (map[e.key]) {

    e.preventDefault();

    map[e.key]();
  }

  if (
    e.altKey &&
    '1234'.includes(e.key)
  ) {

    const idx = +e.key - 1;

    pickAnswer(
      exam.index,
      idx
    );

    goto(exam.index);
  }
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */

let toastTimer = null;

function toast(
  msg,
  type = 'info',
  duration = 3000
) {

  let t = el('toast');

  if (!t) {

    t =
      document.createElement('div');

    t.id = 'toast';

    document.body.appendChild(t);
  }

  t.textContent = msg;

  t.className =
    `toast toast-${type} toast-show`;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {

    t.classList.remove(
      'toast-show'
    );

  }, duration);
}

/* ═══════════════════════════════════════════
   UNLOAD GUARD
═══════════════════════════════════════════ */

function guardUnload(on) {

  window.onbeforeunload = on
    ? e => {
        e.preventDefault();

        return (
          e.returnValue =
          'Exam running'
        );
      }
    : null;
}

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */

const pad = n =>
  String(n).padStart(2, '0');

function setText(id, value) {

  const node = el(id);

  if (node) {
    node.textContent = value;
  }
}
```
