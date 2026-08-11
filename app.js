import { registerStudent, loginStudent, logoutStudent, observeStudentAuth } from "./firebase-student.js";

/* ===========================================================
   LEXICON — Vocabulary Trainer with Spaced Repetition (SM-2)
   =========================================================== */

const LEGACY_STORAGE_KEY = "lexicon_data_v1";
const USERS_STORAGE_KEY = "lexicon_users_v1";
const SESSION_STORAGE_KEY = "lexicon_session_v1";
const LAST_LOGIN_STORAGE_KEY = "lexicon_last_login_v1";
const userStorageKey = id => `lexicon_data_v1_${id}`;
const MS_DAY = 24 * 60 * 60 * 1000;

/* ---------- Default / demo data ---------- */
function makeDemoData() {
  const now = Date.now();
  const demoWords = [
    ["apple", "яблоко", "I ate a red apple."],
    ["journey", "путешествие", "Our journey took three days."],
    ["stubborn", "упрямый", "He is too stubborn to admit it."],
    ["whisper", "шептать", "She whispered the secret."],
    ["harvest", "урожай", "The harvest was good this year."],
    ["gratitude", "благодарность", "I felt deep gratitude for their help."],
    ["wander", "бродить", "We wandered around the old town."],
    ["fragile", "хрупкий", "Handle the glass, it's fragile."],
    ["courage", "смелость", "It took courage to speak up."],
    ["blossom", "цвести", "The trees blossom in April."]
  ];
  const intermediateWords = [
    ["achieve", "достигать", "She worked hard to achieve her goal."],
    ["aware", "осведомлённый", "Are you aware of the changes?"],
    ["benefit", "преимущество", "Regular practice has a clear benefit."],
    ["challenge", "испытание", "Learning a language is an exciting challenge."],
    ["improve", "улучшать", "Reading helps improve your vocabulary."],
    ["require", "требовать", "This task will require patience."],
    ["reliable", "надёжный", "We need a reliable source of information."],
    ["variety", "разнообразие", "The course offers a variety of exercises."]
  ];
  const advancedWords = [
    ["ambiguous", "неоднозначный", "The final sentence remains ambiguous."],
    ["coherent", "последовательный", "Her argument was clear and coherent."],
    ["comprehensive", "всесторонний", "The guide provides a comprehensive overview."],
    ["deteriorate", "ухудшаться", "Conditions may deteriorate during the night."],
    ["inevitable", "неизбежный", "Some degree of change is inevitable."],
    ["meticulous", "скрупулёзный", "He is meticulous about every detail."],
    ["substantial", "существенный", "The project requires substantial investment."],
    ["versatile", "универсальный", "This is a versatile tool for designers."]
  ];
  const makeCards = (words, prefix) => words.map((w, i) => ({
    id: `${prefix}_${i}`,
    word: w[0], translation: w[1], example: w[2],
    repetitions: 0, interval: 0, ease: 2.5, due: now, stage: "new"
  }));
  return {
    decks: [
      {
        id: "deck_demo",
        name: "English Basics",
        level: "Beginner",
        lang: "en-GB",
        createdAt: now,
        cards: makeCards(demoWords, "card")
      },
      {
        id: "deck_intermediate",
        name: "English Intermediate",
        level: "Intermediate",
        lang: "en-GB",
        createdAt: now + 1,
        cards: makeCards(intermediateWords, "card_intermediate")
      },
      {
        id: "deck_advanced",
        name: "English Advanced",
        level: "Advanced",
        lang: "en-GB",
        createdAt: now + 2,
        cards: makeCards(advancedWords, "card_advanced")
      }
    ],
    history: [],   // { date: 'YYYY-MM-DD', reviews: n, correct: n }
    settings: { autoSpeak: true, speechRate: 0.9 },
    streak: { count: 0, lastDate: null }
  };
}

let DATA = null;
let currentUser = null;
let TEACHER_DATA = { grades: [], attendance: [], homework: [] };

function loadData(userId) {
  try {
    // Existing single-user progress becomes the first registered user's data.
    const ownRaw = localStorage.getItem(userStorageKey(userId));
    const isFirstUser = getUsers()[0]?.id === userId;
    const raw = ownRaw || (isFirstUser ? localStorage.getItem(LEGACY_STORAGE_KEY) : null);
    if (raw) {
      const saved = JSON.parse(raw);
      const defaults = makeDemoData();
      return {
        ...defaults,
        ...saved,
        decks: [
          ...(Array.isArray(saved.decks) ? saved.decks.map(deck => ({
            ...deck,
            level: deck.level || defaults.decks.find(item => item.id === deck.id)?.level
          })) : []),
          ...defaults.decks.filter(deck => !Array.isArray(saved.decks)
            || !saved.decks.some(savedDeck => savedDeck.id === deck.id))
        ],
        settings: { ...defaults.settings, ...(saved.settings || {}) }
      };
    }
  } catch (e) { console.warn("Failed to parse storage", e); }
  const demo = makeDemoData();
  saveData(demo);
  return demo;
}
function saveData(d = DATA) {
  if (!currentUser) return;
  localStorage.setItem(userStorageKey(currentUser.id), JSON.stringify(d));
}
function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * MS_DAY);
  return d.toISOString().slice(0, 10);
}
function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

/* ---------- SM-2 algorithm ----------
   grade: 0 again, 1 hard, 2 good, 3 easy   */
function applySM2(card, grade) {
  let { repetitions, interval, ease } = card;

  card.attempts = (card.attempts || 0) + 1;
  card.failures = (card.failures || 0) + (grade < 2 ? 1 : 0);
  card.lastGrade = grade;
  card.lastReviewedAt = Date.now();

  if (grade === 0) {
    repetitions = 0;
    interval = 0; // due again in minutes -> we treat as "today, immediately"
    ease = Math.max(1.3, ease - 0.2);
  } else {
    ease = ease + (0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));
    ease = Math.max(1.3, ease);
    repetitions += 1;

    if (repetitions === 1) {
      interval = grade === 1 ? 1 : grade === 2 ? 1 : 3;
    } else if (repetitions === 2) {
      interval = grade === 1 ? 2 : grade === 2 ? 3 : 6;
    } else {
      interval = Math.round(interval * ease);
    }
    if (grade === 1) interval = Math.max(1, Math.round(interval * 0.6));
    if (grade === 3) interval = Math.round(interval * 1.3) + 1;
  }

  card.repetitions = repetitions;
  card.ease = Math.round(ease * 100) / 100;
  card.interval = interval;
  card.due = Date.now() + (grade === 0 ? 5 * 60 * 1000 : interval * MS_DAY);

  if (repetitions === 0) card.stage = "new";
  else if (interval >= 21 && repetitions >= 3) card.stage = "mastered";
  else card.stage = "learning";

  return card;
}

function allCards() {
  return DATA.decks.flatMap(d => d.cards.map(c => ({ ...c, deckId: d.id, deckName: d.name, lang: d.lang })));
}
function dueCards(deckId = null) {
  const now = Date.now();
  let cards = allCards();
  if (deckId) cards = cards.filter(c => c.deckId === deckId);
  return cards.filter(c => c.due <= now);
}

/* =========================================================
   NAVIGATION
   ========================================================= */
const views = ["dashboard", "decks", "deckDetail", "study", "homework", "settings"];
function showView(name) {
  views.forEach(v => {
    document.getElementById("view-" + v).classList.toggle("active", v === name);
  });
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  if (name === "dashboard") renderDashboard();
  if (name === "decks") renderDeckList();
  if (name === "study") renderStudyPicker();
  if (name === "homework") renderStudentHomework();
}

function getAssignedHomework(studentId) {
  const assignments = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith("classtrack_data_v1_")) continue;
    try {
      const teacherData = JSON.parse(localStorage.getItem(key));
      (teacherData.homework || []).forEach(item => {
        if (item.studentId === studentId) assignments.push(item);
      });
    } catch (error) { console.warn("Failed to read homework", error); }
  }
  return assignments.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}

function renderStudentHomework() {
  if (!currentUser) return;
  const assignments = getAssignedHomework(currentUser.id);
  const done = assignments.filter(item => item.status === "done").length;
  const pending = assignments.filter(item => item.status === "pending").length;
  document.getElementById("studentHomeworkSummary").innerHTML = `
    <div><strong>${assignments.length}</strong><span>всего заданий</span></div>
    <div><strong>${pending}</strong><span>в работе</span></div>
    <div><strong>${done}</strong><span>выполнено</span></div>`;
  const labels = { done: "Выполнено", pending: "В работе", missed: "Не выполнено" };
  document.getElementById("studentHomeworkList").innerHTML = assignments.length
    ? assignments.map(item => `<article class="student-homework-card">
      <div><span class="record-status status-${item.status}">${labels[item.status] || item.status}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.deckName || item.subject || "Общее задание")}</p></div>
      <div class="homework-due"><span>Срок сдачи</span><strong>${item.dueDate || "Не указан"}</strong></div>
    </article>`).join("")
    : '<div class="teacher-empty">Учитель пока не назначил домашних заданий.</div>';
}

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

/* =========================================================
   TEXT TO SPEECH
   ========================================================= */
let activeUtterance = null;
let speechTimer = null;
let availableVoices = [];
let voicesReadyPromise = null;
let speechRequestId = 0;

function waitForVoices() {
  const loaded = window.speechSynthesis.getVoices();
  if (loaded.length) {
    availableVoices = loaded;
    return Promise.resolve(loaded);
  }
  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      availableVoices = window.speechSynthesis.getVoices();
      resolve(availableVoices);
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 800);
  }).finally(() => {
    voicesReadyPromise = null;
  });
  return voicesReadyPromise;
}

function getPreferredVoice(lang = "en-GB") {
  const voices = availableVoices.length
    ? availableVoices
    : window.speechSynthesis.getVoices();
  const rawLang = String(lang || "en-GB").toLowerCase();
  const requestedLang = rawLang === "en" || rawLang.startsWith("en-") ? "en-gb" : rawLang;

  if (requestedLang === "en-gb") {
    const preferredBritishNames = [
      "Google UK English Female",
      "Google UK English Male",
      "Microsoft Sonia",
      "Microsoft Ryan",
      "Microsoft Libby",
      "Microsoft Hazel",
      "Daniel",
      "Serena",
      "Kate"
    ];
    const britishVoices = voices.filter(voice => voice.lang.toLowerCase() === "en-gb");

    for (const preferredName of preferredBritishNames) {
      const match = britishVoices.find(voice =>
        voice.name.toLowerCase().includes(preferredName.toLowerCase()));
      if (match) return match;
    }

    return britishVoices[0]
      || voices.find(voice => voice.lang.toLowerCase().startsWith("en-"))
      || voices.find(voice => voice.lang.toLowerCase() === "en");
  }

  const baseLanguage = requestedLang.split("-")[0];
  return voices.find(voice => voice.lang.toLowerCase() === requestedLang)
    || voices.find(voice => voice.lang.toLowerCase().split("-")[0] === baseLanguage);
}

function speak(text, lang) {
  if (!("speechSynthesis" in window)) {
    alert("Ваш браузер не поддерживает озвучку речи.");
    return;
  }

  const value = String(text ?? "").trim();
  if (!value) return;

  const requestedLang = typeof lang === "string" && lang.trim() ? lang.trim() : "en-GB";
  const voiceLang = /^en(?:-|$)/i.test(requestedLang) ? "en-GB" : requestedLang;
  const rate = Number(DATA.settings?.speechRate);
  const requestId = ++speechRequestId;

  clearTimeout(speechTimer);
  window.speechSynthesis.cancel();

  // Chrome can ignore an utterance started immediately after cancel().
  speechTimer = setTimeout(async () => {
    await waitForVoices();
    if (requestId !== speechRequestId) return;
    const utter = new SpeechSynthesisUtterance(value);
    utter.lang = voiceLang;
    utter.rate = Number.isFinite(rate) ? Math.min(1.5, Math.max(0.5, rate)) : 0.9;
    utter.pitch = 1;
    utter.volume = 1;

    const preferredVoice = getPreferredVoice(voiceLang);
    if (preferredVoice) utter.voice = preferredVoice;

    // Keep a reference until completion: some browsers otherwise stop playback.
    activeUtterance = utter;
    const release = () => {
      if (activeUtterance === utter) activeUtterance = null;
    };
    utter.onend = release;
    utter.onerror = release;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utter);
  }, 50);
}
// Ask the browser to load installed voices without replacing other listeners.
if ("speechSynthesis" in window) {
  const updateVoices = () => {
    availableVoices = window.speechSynthesis.getVoices();
  };
  updateVoices();
  window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
}

/* =========================================================
   DASHBOARD
   ========================================================= */
let activityChartInstance = null;
let stageChartInstance = null;

function renderDashboard() {
  const cards = allCards();
  const total = cards.length;
  const mastered = cards.filter(c => c.stage === "mastered").length;
  const due = dueCards().length;

  const last30 = DATA.history.slice(-30);
  const totalReviews = last30.reduce((s, h) => s + h.reviews, 0);
  const totalCorrect = last30.reduce((s, h) => s + h.correct, 0);
  const accuracy = totalReviews ? Math.round((totalCorrect / totalReviews) * 100) : 0;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statMastered").textContent = mastered;
  document.getElementById("statDue").textContent = due;
  document.getElementById("statAccuracy").textContent = accuracy + "%";
  document.getElementById("streakNum").textContent = DATA.streak.count || 0;

  renderMotivationBars(total, mastered);

  renderActivityChart();
  renderStageChart(cards);
  renderDeckProgressList();
}

function renderMotivationBars(total, mastered) {
  const weeklyReviews = Array.from({ length: 7 }, (_, index) => todayStr(-index))
    .reduce((sum, day) => sum + (DATA.history.find(item => item.date === day)?.reviews || 0), 0);
  const weeklyTarget = 35;
  const masteryPercent = total ? Math.round((mastered / total) * 100) : 0;
  const streak = DATA.streak.count || 0;

  document.getElementById("weeklyGoalValue").textContent = `${weeklyReviews} / ${weeklyTarget}`;
  document.getElementById("weeklyGoalFill").style.width = `${Math.min(100, weeklyReviews / weeklyTarget * 100)}%`;
  document.getElementById("weeklyGoalMessage").textContent = weeklyReviews >= weeklyTarget
    ? "Цель выполнена — отличный темп!" : `Ещё ${weeklyTarget - weeklyReviews} повторений до цели.`;

  document.getElementById("masteryGoalValue").textContent = `${masteryPercent}%`;
  document.getElementById("masteryGoalFill").style.width = `${masteryPercent}%`;
  document.getElementById("masteryGoalMessage").textContent = masteryPercent >= 80
    ? "Ты почти у цели — продолжай!" : "Каждая карточка приближает к свободной речи.";

  document.getElementById("streakGoalValue").textContent = `${Math.min(streak, 7)} / 7`;
  document.getElementById("streakGoalFill").style.width = `${Math.min(100, streak / 7 * 100)}%`;
  document.getElementById("streakGoalMessage").textContent = streak >= 7
    ? "Неделя без пропусков — великолепно!" : "Возвращайся завтра, чтобы сохранить серию.";
}

function renderActivityChart() {
  const labels = [];
  const values = [];
  for (let i = 13; i >= 0; i--) {
    const day = todayStr(-i);
    labels.push(day.slice(5)); // MM-DD
    const entry = DATA.history.find(h => h.date === day);
    values.push(entry ? entry.reviews : 0);
  }
  const ctx = document.getElementById("activityChart").getContext("2d");
  if (activityChartInstance) activityChartInstance.destroy();
  activityChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Повторений",
        data: values,
        fill: true,
        tension: 0.35,
        backgroundColor: "rgba(168,198,159,0.25)",
        borderColor: "#7fa574",
        pointBackgroundColor: "#7fa574",
        pointRadius: 3,
        borderWidth: 2.5
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: "#8b8072" }, grid: { color: "#f0ead9" } },
        x: { ticks: { color: "#8b8072" }, grid: { display: false } }
      }
    }
  });
}

function renderStageChart(cards) {
  const newCount = cards.filter(c => c.stage === "new").length;
  const learningCount = cards.filter(c => c.stage === "learning").length;
  const masteredCount = cards.filter(c => c.stage === "mastered").length;

  const ctx = document.getElementById("stageChart").getContext("2d");
  if (stageChartInstance) stageChartInstance.destroy();
  stageChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Новые", "Изучаются", "Освоены"],
      datasets: [{
        data: [newCount, learningCount, masteredCount],
        backgroundColor: ["#e8c88a", "#f0b48a", "#a8c69f"],
        borderColor: "#fffdf9",
        borderWidth: 3
      }]
    },
    options: {
      cutout: "68%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#4a4034", boxWidth: 12, padding: 14 } }
      }
    }
  });
}

function renderDeckProgressList() {
  const container = document.getElementById("deckProgressList");
  container.innerHTML = "";
  DATA.decks.forEach(deck => {
    const total = deck.cards.length;
    const mastered = deck.cards.filter(c => c.stage === "mastered").length;
    const pct = total ? Math.round((mastered / total) * 100) : 0;
    const row = document.createElement("div");
    row.className = "deck-progress-item";
    row.innerHTML = `
      <div class="deck-progress-top">
        <strong>${escapeHtml(deck.name)}</strong>
        <span>${mastered}/${total} освоено</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    `;
    container.appendChild(row);
  });
  if (!DATA.decks.length) {
    container.innerHTML = '<p style="color:var(--ink-soft)">Пока нет колод — создай первую во вкладке «Колоды».</p>';
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* =========================================================
   DECKS LIST
   ========================================================= */
let currentDeckId = null;

function renderDeckList() {
  const list = document.getElementById("deckList");
  list.innerHTML = "";
  if (!DATA.decks.length) {
    list.innerHTML = '<div class="deck-empty">Пока нет колод. Нажми «Новая колода», чтобы начать.</div>';
    return;
  }
  DATA.decks.forEach(deck => {
    const total = deck.cards.length;
    const mastered = deck.cards.filter(c => c.stage === "mastered").length;
    const pct = total ? Math.round((mastered / total) * 100) : 0;
    const levelKey = ["beginner", "intermediate", "advanced"].includes(deck.level?.toLowerCase())
      ? deck.level.toLowerCase() : "custom";
    const levelCode = { beginner: "A1", intermediate: "B1", advanced: "C1", custom: "MY" }[levelKey];
    const card = document.createElement("div");
    card.className = `deck-card deck-card--${levelKey}`;
    card.innerHTML = `
      <div class="deck-cover" aria-hidden="true">
        <span class="deck-level-code">${levelCode}</span>
        <span class="deck-cover-word">Vocabulary</span>
      </div>
      <div class="deck-card-body">
        ${deck.level ? `<span class="deck-level">${escapeHtml(deck.level)}</span>` : `<span class="deck-level">Personal deck</span>`}
        <h4>${escapeHtml(deck.name)}</h4>
        <div class="deck-meta">${total} слов &bull; ${langLabel(deck.lang)}</div>
        <div class="deck-progress-heading"><span>Прогресс</span><strong>${pct}%</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    `;
    card.addEventListener("click", () => openDeckDetail(deck.id));
    list.appendChild(card);
  });
}

function langLabel(code) {
  const map = {
    "en-GB": "Английский (UK)", "en-US": "Английский (US)", "es-ES": "Испанский",
    "fr-FR": "Французский", "de-DE": "Немецкий", "it-IT": "Итальянский",
    "pt-PT": "Португальский", "ja-JP": "Японский", "ko-KR": "Корейский",
    "zh-CN": "Китайский", "ru-RU": "Русский", "tr-TR": "Турецкий"
  };
  return map[code] || code;
}

function openDeckDetail(deckId) {
  currentDeckId = deckId;
  const deck = DATA.decks.find(d => d.id === deckId);
  document.getElementById("deckDetailTitle").textContent = deck.name;
  renderWordTable();
  views.forEach(v => document.getElementById("view-" + v).classList.remove("active"));
  document.getElementById("view-deckDetail").classList.add("active");
}

function renderWordTable() {
  const deck = DATA.decks.find(d => d.id === currentDeckId);
  const tbody = document.getElementById("wordTableBody");
  tbody.innerHTML = "";
  if (!deck.cards.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);padding:30px;">В колоде пока нет слов</td></tr>';
    return;
  }
  deck.cards.forEach(card => {
    const stageLabels = { new: "Новое", learning: "Изучается", mastered: "Освоено" };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="icon-btn speak-cell" data-word="${escapeHtml(card.word)}" data-lang="${deck.lang}" title="Озвучить">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button></td>
      <td><strong>${escapeHtml(card.word)}</strong></td>
      <td style="color:var(--ink-soft);">&rarr;</td>
      <td>${escapeHtml(card.translation)}</td>
      <td></td>
      <td><span class="stage-badge stage-${card.stage}">${stageLabels[card.stage]}</span></td>
      <td><button class="icon-btn delete-card" data-id="${card.id}" title="Удалить">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".speak-cell").forEach(btn => {
    btn.addEventListener("click", () => speak(btn.dataset.word, btn.dataset.lang));
  });
  tbody.querySelectorAll(".delete-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const deck = DATA.decks.find(d => d.id === currentDeckId);
      deck.cards = deck.cards.filter(c => c.id !== btn.dataset.id);
      saveData();
      renderWordTable();
    });
  });
}

document.getElementById("backToDecks").addEventListener("click", () => showView("decks"));

/* --- New deck modal --- */
const deckModal = document.getElementById("deckModal");
document.getElementById("newDeckBtn").addEventListener("click", () => {
  document.getElementById("deckNameInput").value = "";
  deckModal.hidden = false;
});
document.getElementById("deckModalCancel").addEventListener("click", () => deckModal.hidden = true);
document.getElementById("deckModalSave").addEventListener("click", () => {
  const name = document.getElementById("deckNameInput").value.trim();
  const lang = document.getElementById("deckLangInput").value;
  if (!name) return;
  DATA.decks.push({ id: uid("deck"), name, lang, createdAt: Date.now(), cards: [] });
  saveData();
  deckModal.hidden = true;
  renderDeckList();
});

/* --- New card modal --- */
const cardModal = document.getElementById("cardModal");
const cardForm = document.getElementById("cardForm");
const cardFormError = document.getElementById("cardFormError");

function closeCardModal() {
  cardModal.hidden = true;
  cardFormError.textContent = "";
}

document.getElementById("addCardBtn").addEventListener("click", () => {
  cardForm.reset();
  cardFormError.textContent = "";
  cardModal.hidden = false;
  requestAnimationFrame(() => document.getElementById("cardWordInput").focus());
});
document.getElementById("cardModalCancel").addEventListener("click", closeCardModal);
cardForm.addEventListener("submit", (event) => {
  event.preventDefault();
  cardFormError.textContent = "";
  const word = document.getElementById("cardWordInput").value.trim();
  const translation = document.getElementById("cardTransInput").value.trim();
  const example = document.getElementById("cardExampleInput").value.trim();
  const deck = DATA.decks.find(d => d.id === currentDeckId);

  if (!deck) {
    cardFormError.textContent = "Не удалось определить выбранную колоду. Откройте её заново.";
    return;
  }
  if (!word || !translation) {
    cardFormError.textContent = "Заполните слово и перевод.";
    return;
  }
  if (deck.cards.some(card => card.word.trim().toLocaleLowerCase() === word.toLocaleLowerCase())) {
    cardFormError.textContent = "Такое слово уже есть в этой колоде.";
    document.getElementById("cardWordInput").focus();
    return;
  }

  deck.cards.push({
    id: uid("card"), word, translation, example,
    repetitions: 0, interval: 0, ease: 2.5, due: Date.now(), stage: "new"
  });
  saveData();
  closeCardModal();
  renderWordTable();
});

cardModal.addEventListener("click", event => {
  if (event.target === cardModal) closeCardModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !cardModal.hidden) closeCardModal();
});

document.getElementById("studyDeckBtn").addEventListener("click", () => {
  showView("study");
  startStudy(currentDeckId);
});

/* --- Export / Import --- */
document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lexicon-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (imported.decks) {
        DATA = imported;
        saveData();
        renderDeckList();
        renderDashboard();
        alert("Данные успешно импортированы!");
      }
    } catch (err) {
      alert("Не удалось прочитать файл. Проверь, что это корректный экспорт Lexicon.");
    }
  };
  reader.readAsText(file);
});

/* =========================================================
   STUDY SESSION
   ========================================================= */
let studyQueue = [];
let studyIndex = 0;
let studyTotal = 0;
let studyStats = { reviews: 0, correct: 0 };
let currentStudyDeck = null;

function renderStudyPicker() {
  const list = document.getElementById("studyDeckList");
  list.innerHTML = "";
  document.getElementById("studyPicker").hidden = false;
  document.getElementById("studySession").hidden = true;
  document.getElementById("studyDone").hidden = true;

  if (!DATA.decks.length) {
    list.innerHTML = '<div class="deck-empty">Сначала создай колоду во вкладке «Колоды».</div>';
    return;
  }
  DATA.decks.forEach(deck => {
    const due = dueCards(deck.id).length;
    const card = document.createElement("div");
    card.className = "deck-card";
    card.innerHTML = `
      <h4>${escapeHtml(deck.name)}</h4>
      <div class="deck-meta">${due} карточек к повторению</div>
      <div class="deck-pct">${due ? "Готово к тренировке" : "Всё повторено \u2014 загляни позже"}</div>
    `;
    card.addEventListener("click", () => startStudy(deck.id));
    list.appendChild(card);
  });
}

function startStudy(deckId) {
  currentStudyDeck = DATA.decks.find(d => d.id === deckId);
  studyQueue = dueCards(deckId);
  studyIndex = 0;
  studyTotal = studyQueue.length;
  studyStats = { reviews: 0, correct: 0 };

  document.getElementById("studyDeckTitle").textContent = currentStudyDeck?.name || "Vocabulary";
  document.getElementById("studyDeckLevel").textContent = currentStudyDeck?.level || "Personal deck";

  document.getElementById("studyPicker").hidden = true;
  document.getElementById("studyDone").hidden = true;

  if (!studyTotal) {
    renderStudyReward(true);
    document.getElementById("studySession").hidden = true;
    document.getElementById("studyDone").hidden = false;
    return;
  }
  document.getElementById("studySession").hidden = false;
  showCurrentCard();
}

function showCurrentCard() {
  clearTimeout(speechTimer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  const flipInner = document.getElementById("flipInner");
  flipInner.classList.remove("flipped");
  document.getElementById("gradeRow").hidden = true;

  const card = studyQueue[studyIndex];
  document.getElementById("flipWordFront").textContent = card.word;
  document.getElementById("flipWordBack").textContent = card.translation;
  document.getElementById("flipExample").textContent = card.example || "";

  document.getElementById("studyCounter").textContent = `${studyIndex + 1} / ${studyTotal}`;
  document.getElementById("studyProgressFill").style.width = `${((studyIndex + 1) / studyTotal) * 100}%`;

  if (DATA.settings.autoSpeak) {
    speechTimer = setTimeout(() => {
      if (studyQueue[studyIndex] === card) speak(card.word, currentStudyDeck?.lang);
    }, 300);
  }
}

document.getElementById("flipCard").addEventListener("click", () => {
  const flipInner = document.getElementById("flipInner");
  const wasFlipped = flipInner.classList.contains("flipped");
  flipInner.classList.toggle("flipped");
  document.getElementById("gradeRow").hidden = wasFlipped;
});

document.getElementById("speakFront").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = studyQueue[studyIndex];
  if (card) speak(card.word, currentStudyDeck?.lang);
});
document.querySelectorAll(".grade-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const grade = parseInt(btn.dataset.grade, 10);
    gradeCurrentCard(grade);
  });
});

function gradeCurrentCard(grade) {
  const cardRef = studyQueue[studyIndex];
  const deck = DATA.decks.find(d => d.id === cardRef.deckId);
  const realCard = deck.cards.find(c => c.id === cardRef.id);
  applySM2(realCard, grade);
  saveData();

  studyStats.reviews += 1;
  if (grade >= 2) studyStats.correct += 1;

  studyIndex += 1;
  if (studyIndex >= studyTotal) {
    finishStudySession();
  } else {
    showCurrentCard();
  }
}

function finishStudySession() {
  recordHistory(studyStats.reviews, studyStats.correct);
  updateStreak();
  renderStudyReward();
  document.getElementById("studySession").hidden = true;
  document.getElementById("studyDone").hidden = false;
}

function renderStudyReward(alreadyComplete = false) {
  const accuracy = studyStats.reviews
    ? Math.round(studyStats.correct / studyStats.reviews * 100) : 0;
  const deckName = currentStudyDeck?.name || "колоды";
  const messages = alreadyComplete
    ? "Все карточки уже повторены. Можно отдохнуть и вернуться к ним позже!"
    : accuracy >= 90
    ? "Великолепный результат — слова уже становятся частью активного словаря!"
    : accuracy >= 70
      ? "Отличный темп! Ещё немного практики — и слова закрепятся надолго."
      : "Каждое повторение делает память сильнее. Продолжай в том же духе!";

  document.getElementById("rewardTitle").textContent = alreadyComplete
    ? `«${deckName}» уже завершена!` : `Колода «${deckName}» пройдена!`;
  document.getElementById("rewardMessage").textContent = messages;
  document.getElementById("rewardReviews").textContent = studyStats.reviews;
  document.getElementById("rewardAccuracy").textContent = `${accuracy}%`;
  document.getElementById("rewardStreak").textContent = DATA.streak.count || 0;
}

function recordHistory(reviews, correct) {
  const day = todayStr();
  let entry = DATA.history.find(h => h.date === day);
  if (!entry) {
    entry = { date: day, reviews: 0, correct: 0 };
    DATA.history.push(entry);
  }
  entry.reviews += reviews;
  entry.correct += correct;
  // keep history reasonably small
  if (DATA.history.length > 120) DATA.history = DATA.history.slice(-120);
  saveData();
}

function updateStreak() {
  const today = todayStr();
  const yesterday = todayStr(-1);
  if (DATA.streak.lastDate === today) {
    // already counted today
  } else if (DATA.streak.lastDate === yesterday) {
    DATA.streak.count += 1;
    DATA.streak.lastDate = today;
  } else {
    DATA.streak.count = 1;
    DATA.streak.lastDate = today;
  }
  saveData();
}

document.getElementById("doneBackBtn").addEventListener("click", () => renderStudyPicker());

/* =========================================================
   SETTINGS
   ========================================================= */
function initSettingsUI() {
  document.getElementById("autoSpeakToggle").checked = DATA.settings.autoSpeak;
  document.getElementById("speechRate").value = DATA.settings.speechRate;
}
document.getElementById("autoSpeakToggle").addEventListener("change", (e) => {
  DATA.settings.autoSpeak = e.target.checked;
  saveData();
});
document.getElementById("speechRate").addEventListener("input", (e) => {
  DATA.settings.speechRate = parseFloat(e.target.value);
  saveData();
});
document.getElementById("resetAllBtn").addEventListener("click", () => {
  if (confirm("Точно сбросить весь прогресс? Это действие необратимо.")) {
    DATA = makeDemoData();
    saveData();
    showView("dashboard");
    renderDeckList();
    initSettingsUI();
  }
});

/* =========================================================
   INIT
   ========================================================= */
function getUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "[]");
    return Array.isArray(users) ? users : [];
  } catch (e) {
    console.warn("Failed to parse participants", e);
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashPassword(password, salt) {
  const value = new TextEncoder().encode(`${salt}:${password}`);
  return bytesToHex(await crypto.subtle.digest("SHA-256", value));
}

let authMode = "login";
const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  document.querySelector(".auth-card").classList.toggle("auth-card--register", registering);
  document.getElementById("authTitle").textContent = registering ? "Регистрация участника" : "Вход участника";
  document.getElementById("authSubtitle").textContent = registering
    ? "Создай отдельный профиль для своего прогресса."
    : "Войди, чтобы продолжить обучение со своим прогрессом.";
  document.getElementById("authSubmit").textContent = registering ? "Зарегистрироваться" : "Войти";
  document.getElementById("authSwitch").textContent = registering
    ? "Уже есть аккаунт? Войти"
    : "Нет аккаунта? Зарегистрироваться";
  document.getElementById("participantPassword").autocomplete = registering ? "new-password" : "current-password";
  document.getElementById("studentNameField").hidden = !registering;
  document.getElementById("studentDisplayName").required = registering;
  document.getElementById("registrationGuide").hidden = !registering;
  authError.textContent = "";
}

function openParticipant(user, rememberSession = true) {
  currentUser = user;
  if (user.firebase) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } else if (rememberSession) {
    localStorage.setItem(SESSION_STORAGE_KEY, user.id);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.setItem(SESSION_STORAGE_KEY, user.id);
  }
  if (user.role === "teacher") {
    authScreen.hidden = true;
    app.hidden = true;
    document.getElementById("teacherScreen").hidden = false;
    document.getElementById("teacherName").textContent = user.name;
    loadTeacherRecords();
    renderTeacherDashboard();
    return;
  }
  DATA = loadData(user.id);
  // Persist legacy/default data under this participant's own key immediately.
  saveData();
  document.getElementById("participantDisplayName").textContent = user.name;
  document.getElementById("participantAvatar").textContent = user.name.charAt(0).toUpperCase();
  document.getElementById("dashboardGreeting").textContent = `С возвращением, ${user.name}!`;
  authScreen.hidden = true;
  document.getElementById("teacherScreen").hidden = true;
  app.hidden = false;
  initSettingsUI();
  showView("dashboard");
  renderDeckList();
}

document.getElementById("authSwitch").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  const login = document.getElementById("participantName").value.trim();
  const studentName = document.getElementById("studentDisplayName").value.trim();
  const password = document.getElementById("participantPassword").value;
  const rememberLogin = document.getElementById("rememberLogin").checked;
  const users = getUsers();
  const existingTeacher = users.find(user => user.role === "teacher"
    && user.name.toLocaleLowerCase() === login.toLocaleLowerCase());

  try {
    if (authMode === "register") {
      const profile = await registerStudent({ name: studentName, login, password, remember: rememberLogin });
      const user = { id: profile.uid, name: profile.name, login: profile.login, role: "student", firebase: true,
        hw1: profile.hw1, hw2: profile.hw2, hw3: profile.hw3, hw4: profile.hw4, hw5: profile.hw5 };
      const oldIndex = users.findIndex(item => item.id === user.id);
      if (oldIndex >= 0) users[oldIndex] = user; else users.push(user);
      saveUsers(users);
      openParticipant(user, rememberLogin);
    } else {
      if (existingTeacher) {
        if (await hashPassword(password, existingTeacher.salt) !== existingTeacher.passwordHash) {
          throw new Error("Неверный логин или пароль.");
        }
        openParticipant(existingTeacher, rememberLogin);
      } else {
        const profile = await loginStudent({ login, password, remember: rememberLogin });
        const user = { id: profile.uid, name: profile.name, login: profile.login, role: "student", firebase: true,
          hw1: profile.hw1, hw2: profile.hw2, hw3: profile.hw3, hw4: profile.hw4, hw5: profile.hw5 };
        const oldIndex = users.findIndex(item => item.id === user.id);
        if (oldIndex >= 0) users[oldIndex] = user; else users.push(user);
        saveUsers(users);
        openParticipant(user, rememberLogin);
      }
    }
    if (rememberLogin) localStorage.setItem(LAST_LOGIN_STORAGE_KEY, login);
    else localStorage.removeItem(LAST_LOGIN_STORAGE_KEY);
    authForm.reset();
  } catch (error) {
    authError.textContent = error.message || "Не удалось выполнить вход.";
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (currentUser?.firebase) await logoutStudent();
  localStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  currentUser = null;
  DATA = null;
  app.hidden = true;
  authScreen.hidden = false;
  setAuthMode("login");
});

document.getElementById("teacherLogoutBtn").addEventListener("click", () => {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  currentUser = null;
  document.getElementById("teacherScreen").hidden = true;
  authScreen.hidden = false;
  setAuthMode("login");
});

function getStudentData(user) {
  try {
    const raw = localStorage.getItem(userStorageKey(user.id));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Failed to read student data", error);
    return null;
  }
}

function renderTeacherDashboard() {
  const students = getUsers().filter(user => (user.role || "student") === "student");
  const reports = students.map(user => {
    const data = getStudentData(user);
    const cards = data?.decks?.flatMap(deck => deck.cards || []) || [];
    const history = data?.history || [];
    const reviews = history.reduce((sum, item) => sum + (item.reviews || 0), 0);
    const correct = history.reduce((sum, item) => sum + (item.correct || 0), 0);
    const weak = cards.filter(card => (card.failures || 0) > 0)
      .sort((a, b) => (b.failures || 0) - (a.failures || 0)).slice(0, 5);
    return { user, data, cards, reviews, accuracy: reviews ? Math.round(correct / reviews * 100) : 0,
      mastered: cards.filter(card => card.stage === "mastered").length, weak };
  });

  const totalMastered = reports.reduce((sum, report) => sum + report.mastered, 0);
  const totalReviews = reports.reduce((sum, report) => sum + report.reviews, 0);
  const averageGrade = TEACHER_DATA.grades.length
    ? Math.round(TEACHER_DATA.grades.reduce((sum, item) => sum + item.score, 0) / TEACHER_DATA.grades.length) : 0;
  const attendanceRate = TEACHER_DATA.attendance.length
    ? Math.round(TEACHER_DATA.attendance.filter(item => item.status !== "absent").length / TEACHER_DATA.attendance.length * 100) : 0;
  const homeworkRate = TEACHER_DATA.homework.length
    ? Math.round(TEACHER_DATA.homework.filter(item => item.status === "done").length / TEACHER_DATA.homework.length * 100) : 0;
  document.getElementById("teacherSummary").innerHTML = `
    <div><strong>${reports.length}</strong><span>учеников</span></div>
    <div><strong>${totalReviews}</strong><span>повторений</span></div>
    <div><strong>${totalMastered}</strong><span>слов освоено</span></div>
    <div><strong>${averageGrade}</strong><span>средний балл</span></div>
    <div><strong>${attendanceRate}%</strong><span>посещаемость</span></div>
    <div><strong>${homeworkRate}%</strong><span>ДЗ выполнено</span></div>`;

  const grid = document.getElementById("studentReportGrid");
  grid.innerHTML = reports.length ? reports.map(report => {
    const total = report.cards.length;
    const progress = total ? Math.round(report.mastered / total * 100) : 0;
    const weakWords = report.weak.length ? report.weak.map(card =>
      `<span>${escapeHtml(card.word)} <b>${card.failures}×</b></span>`).join("") : "<em>Ошибок пока нет</em>";
    return `<article class="student-report">
      <div class="student-report-head"><span class="participant-avatar">${escapeHtml(report.user.name.charAt(0).toUpperCase())}</span><div><h2>${escapeHtml(report.user.name)}</h2><p>${total} слов в обучении</p></div></div>
      <div class="student-metrics"><div><strong>${progress}%</strong><span>освоено</span></div><div><strong>${report.accuracy}%</strong><span>точность</span></div><div><strong>${report.data?.streak?.count || 0}</strong><span>серия</span></div></div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      <h3>Требуют внимания</h3><div class="weak-words">${weakWords}</div>
    </article>`;
  }).join("") : '<div class="teacher-empty">Пока нет зарегистрированных учеников.</div>';

  renderTeacherRecords();
  renderTeacherDecks();
}

function teacherStorageKey() {
  return `classtrack_data_v1_${currentUser.id}`;
}

function loadTeacherRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(teacherStorageKey()) || "{}");
    TEACHER_DATA = {
      grades: Array.isArray(saved.grades) ? saved.grades : [],
      attendance: Array.isArray(saved.attendance) ? saved.attendance : [],
      homework: Array.isArray(saved.homework) ? saved.homework : []
    };
  } catch (error) {
    TEACHER_DATA = { grades: [], attendance: [], homework: [] };
  }
}

function saveTeacherRecords() {
  localStorage.setItem(teacherStorageKey(), JSON.stringify(TEACHER_DATA));
}

function teacherStudents() {
  return getUsers().filter(user => (user.role || "student") === "student");
}

function studentName(id) {
  return teacherStudents().find(user => user.id === id)?.name || "Удалённый ученик";
}

function studentDecks(studentId) {
  return getStudentData({ id: studentId })?.decks || [];
}

function renderGradeDeckOptions() {
  const studentId = document.getElementById("gradeStudent").value;
  const select = document.getElementById("gradeSubject");
  const decks = studentDecks(studentId);
  select.innerHTML = decks.length
    ? '<option value="">Выберите колоду</option>' + decks.map(deck =>
      `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join("")
    : '<option value="">У ученика нет колод</option>';
  select.disabled = !decks.length;
  updateAutomaticGradeScore();
}

function calculateDeckScore(deck) {
  const cards = deck?.cards || [];
  if (!cards.length) return 0;
  const attempts = cards.reduce((sum, card) => sum + (card.attempts || 0), 0);
  const failures = cards.reduce((sum, card) => sum + (card.failures || 0), 0);
  const reviewed = cards.filter(card => (card.attempts || 0) > 0 || card.stage !== "new").length;
  const accuracy = attempts ? Math.max(0, (attempts - failures) / attempts) : 0;
  const coverage = reviewed / cards.length;
  return Math.round(accuracy * 70 + coverage * 30);
}

function updateAutomaticGradeScore() {
  const studentId = document.getElementById("gradeStudent").value;
  const deckId = document.getElementById("gradeSubject").value;
  const deck = studentDecks(studentId).find(item => item.id === deckId);
  document.getElementById("gradeScore").value = deckId ? calculateDeckScore(deck) : "";
  document.getElementById("gradeDate").value = todayStr();
}

function renderHomeworkDeckOptions() {
  const studentId = document.getElementById("homeworkStudent").value;
  const select = document.getElementById("homeworkSubject");
  const decks = studentDecks(studentId);
  select.innerHTML = decks.length
    ? '<option value="">Выберите колоду</option>' + decks.map(deck =>
      `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join("")
    : '<option value="">У ученика нет колод</option>';
  select.disabled = !decks.length;
}

function renderTeacherRecords() {
  const students = teacherStudents();
  const options = students.length
    ? students.map(user => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("")
    : '<option value="">Нет учеников</option>';
  ["gradeStudent", "attendanceStudent", "homeworkStudent", "teacherDeckStudent"].forEach(id => {
    const select = document.getElementById(id);
    const selected = select.value;
    select.innerHTML = options;
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  });
  renderGradeDeckOptions();
  renderHomeworkDeckOptions();
  document.getElementById("gradeDate").value ||= todayStr();
  document.getElementById("attendanceDate").value ||= todayStr();
  document.getElementById("homeworkDueDate").value ||= todayStr(7);

  document.getElementById("gradesBody").innerHTML = TEACHER_DATA.grades.length
    ? TEACHER_DATA.grades.slice().reverse().map(item => `<tr><td>${escapeHtml(studentName(item.studentId))}</td><td>${escapeHtml(item.deckName || item.subject || "—")}</td><td><span class="score-badge">${item.score}</span></td><td>${item.date}</td><td><button class="record-delete" data-kind="grades" data-id="${item.id}">×</button></td></tr>`).join("")
    : '<tr><td colspan="5" class="empty-cell">Оценок пока нет</td></tr>';
  const attendanceLabels = { present: "Присутствовал", absent: "Отсутствовал", late: "Опоздал" };
  document.getElementById("attendanceBody").innerHTML = TEACHER_DATA.attendance.length
    ? TEACHER_DATA.attendance.slice().reverse().map(item => `<tr><td>${escapeHtml(studentName(item.studentId))}</td><td>${item.date}</td><td><span class="record-status status-${item.status}">${attendanceLabels[item.status]}</span></td><td><button class="record-delete" data-kind="attendance" data-id="${item.id}">×</button></td></tr>`).join("")
    : '<tr><td colspan="4" class="empty-cell">Отметок пока нет</td></tr>';
  const homeworkLabels = { done: "Выполнено", pending: "В работе", missed: "Не выполнено" };
  document.getElementById("homeworkBody").innerHTML = TEACHER_DATA.homework.length
    ? TEACHER_DATA.homework.slice().reverse().map(item => `<tr><td>${escapeHtml(studentName(item.studentId))}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.deckName || item.subject || "—")}</td><td>${item.dueDate || "—"}</td><td><span class="record-status status-${item.status}">${homeworkLabels[item.status]}</span></td><td><button class="record-delete" data-kind="homework" data-id="${item.id}">×</button></td></tr>`).join("")
    : '<tr><td colspan="6" class="empty-cell">Заданий пока нет</td></tr>';
}

function renderTeacherDecks() {
  const students = teacherStudents();
  const items = students.flatMap(student => studentDecks(student.id).map(deck => ({ student, deck })));
  document.getElementById("teacherDeckGrid").innerHTML = items.length ? items.map(({ student, deck }) => {
    const total = deck.cards?.length || 0;
    const mastered = deck.cards?.filter(card => card.stage === "mastered").length || 0;
    return `<article class="teacher-deck-card"><div class="teacher-deck-owner"><span class="participant-avatar">${escapeHtml(student.name.charAt(0).toUpperCase())}</span><span>${escapeHtml(student.name)}</span></div><span class="deck-level">${escapeHtml(deck.level || "Personal deck")}</span><h2>${escapeHtml(deck.name)}</h2><p>${total} слов · ${mastered} освоено</p><div class="progress-track"><div class="progress-fill" style="width:${total ? mastered / total * 100 : 0}%"></div></div></article>`;
  }).join("") : '<div class="teacher-empty">У учеников пока нет колод.</div>';
}

document.querySelectorAll("[data-teacher-view]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-teacher-view]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".teacher-view").forEach(view => view.classList.toggle("active", view.id === `teacher-view-${button.dataset.teacherView}`));
  });
});

document.getElementById("gradeStudent").addEventListener("change", renderGradeDeckOptions);
document.getElementById("gradeSubject").addEventListener("change", updateAutomaticGradeScore);
document.getElementById("homeworkStudent").addEventListener("change", renderHomeworkDeckOptions);

const homeworkModal = document.getElementById("homeworkModal");
const homeworkFormError = document.getElementById("homeworkFormError");
function closeHomeworkModal() {
  homeworkModal.hidden = true;
  homeworkFormError.textContent = "";
}
document.getElementById("openHomeworkModal").addEventListener("click", () => {
  document.getElementById("homeworkForm").reset();
  homeworkFormError.textContent = "";
  renderTeacherRecords();
  homeworkModal.hidden = false;
  requestAnimationFrame(() => document.getElementById("homeworkTitle").focus());
});
document.getElementById("homeworkModalCancel").addEventListener("click", closeHomeworkModal);
homeworkModal.addEventListener("click", event => {
  if (event.target === homeworkModal) closeHomeworkModal();
});

const teacherDeckModal = document.getElementById("teacherDeckModal");
const teacherDeckFormError = document.getElementById("teacherDeckFormError");
function closeTeacherDeckModal() {
  teacherDeckModal.hidden = true;
  teacherDeckFormError.textContent = "";
}
document.getElementById("openTeacherDeckModal").addEventListener("click", () => {
  document.getElementById("teacherDeckForm").reset();
  teacherDeckFormError.textContent = "";
  renderTeacherRecords();
  teacherDeckModal.hidden = false;
  requestAnimationFrame(() => document.getElementById("teacherDeckName").focus());
});
document.getElementById("teacherDeckModalCancel").addEventListener("click", closeTeacherDeckModal);
teacherDeckModal.addEventListener("click", event => {
  if (event.target === teacherDeckModal) closeTeacherDeckModal();
});
document.getElementById("teacherDeckForm").addEventListener("submit", event => {
  event.preventDefault();
  const studentId = document.getElementById("teacherDeckStudent").value;
  const name = document.getElementById("teacherDeckName").value.trim();
  const studentData = getStudentData({ id: studentId });
  if (!studentId || !name || !studentData) {
    teacherDeckFormError.textContent = "Выберите ученика с активным профилем и укажите название.";
    return;
  }
  if (studentData.decks.some(deck => deck.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    teacherDeckFormError.textContent = "У этого ученика уже есть колода с таким названием.";
    return;
  }
  studentData.decks.push({ id: uid("deck"), name, level: document.getElementById("teacherDeckLevel").value, lang: document.getElementById("teacherDeckLang").value, createdAt: Date.now(), createdByTeacher: currentUser.id, cards: [] });
  localStorage.setItem(userStorageKey(studentId), JSON.stringify(studentData));
  closeTeacherDeckModal();
  renderTeacherDashboard();
});

document.getElementById("gradeForm").addEventListener("submit", event => {
  event.preventDefault();
  const studentId = document.getElementById("gradeStudent").value;
  if (!studentId) return;
  const deckSelect = document.getElementById("gradeSubject");
  const deckId = deckSelect.value;
  if (!deckId) return;
  const deck = studentDecks(studentId).find(item => item.id === deckId);
  const score = calculateDeckScore(deck);
  TEACHER_DATA.grades.push({ id: uid("grade"), studentId, deckId, deckName: deckSelect.options[deckSelect.selectedIndex].text, score, automatic: true, date: todayStr() });
  saveTeacherRecords(); event.target.reset(); renderTeacherDashboard();
});
document.getElementById("attendanceForm").addEventListener("submit", event => {
  event.preventDefault();
  const studentId = document.getElementById("attendanceStudent").value;
  if (!studentId) return;
  TEACHER_DATA.attendance.push({ id: uid("attendance"), studentId, date: document.getElementById("attendanceDate").value, status: document.getElementById("attendanceStatus").value });
  saveTeacherRecords(); renderTeacherDashboard();
});
document.getElementById("homeworkForm").addEventListener("submit", event => {
  event.preventDefault();
  const studentId = document.getElementById("homeworkStudent").value;
  const deckSelect = document.getElementById("homeworkSubject");
  if (!studentId || !deckSelect.value) {
    homeworkFormError.textContent = "Выберите ученика и его колоду.";
    return;
  }
  TEACHER_DATA.homework.push({ id: uid("homework"), studentId, deckId: deckSelect.value, deckName: deckSelect.options[deckSelect.selectedIndex].text, title: document.getElementById("homeworkTitle").value.trim(), dueDate: document.getElementById("homeworkDueDate").value, status: document.getElementById("homeworkStatus").value });
  saveTeacherRecords(); event.target.reset(); closeHomeworkModal(); renderTeacherDashboard();
});
document.getElementById("teacherScreen").addEventListener("click", event => {
  const button = event.target.closest(".record-delete");
  if (!button) return;
  TEACHER_DATA[button.dataset.kind] = TEACHER_DATA[button.dataset.kind].filter(item => item.id !== button.dataset.id);
  saveTeacherRecords(); renderTeacherDashboard();
});

const persistentSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
const savedSessionId = persistentSessionId || sessionStorage.getItem(SESSION_STORAGE_KEY);
const sessionUser = getUsers().find(user => user.id === savedSessionId && user.role === "teacher");
if (sessionUser) openParticipant(sessionUser, Boolean(persistentSessionId));
else {
  setAuthMode("login");
  document.getElementById("participantName").value = localStorage.getItem(LAST_LOGIN_STORAGE_KEY) || "";
  observeStudentAuth((profile, error) => {
    if (error) authError.textContent = error.message;
    if (!profile || currentUser?.role === "teacher") return;
    const user = { id: profile.uid, name: profile.name, login: profile.login, role: "student", firebase: true,
      hw1: profile.hw1, hw2: profile.hw2, hw3: profile.hw3, hw4: profile.hw4, hw5: profile.hw5 };
    const users = getUsers();
    const oldIndex = users.findIndex(item => item.id === user.id);
    if (oldIndex >= 0) users[oldIndex] = user; else users.push(user);
    saveUsers(users);
    openParticipant(user);
  });
}
