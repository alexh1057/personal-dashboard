"use strict";

/* ---------------- utilities ---------------- */
const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function startOfWeek(d = new Date()) { // Monday
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function startOfMonth(d = new Date()) {
  const x = startOfDay(d); x.setDate(1); return x;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  const [y, m, dd] = iso.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString([], { day: "numeric", month: "short" });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function pickRandom(arr, n) {
  const pool = [...arr];
  const out = [];
  while (pool.length && out.length < n) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/* ---------------- tab navigation ---------------- */
const TAB_BODY_CLASS = {
  "tab-learn": "on-learn",
  "tab-habits": "on-habits",
  "tab-lift": "on-lift",
  "tab-focus": "on-focus",
  "tab-tips": "on-tips",
  "tab-play": "on-play",
};

function activateTab(tabId, remember = true) {
  if (!TAB_BODY_CLASS[tabId]) tabId = "tab-learn";
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === tabId));
  document.body.className = TAB_BODY_CLASS[tabId];
  // charts read --tab-accent, so redraw the newly visible one
  if (tabId === "tab-lift") renderLiftChart();
  if (tabId === "tab-focus") renderDwWeekChart();
  if (tabId === "tab-play") jumpOnShow(); else jumpPause();
  if (remember) {
    save("dash.tab", tabId);
    history.replaceState(null, "", "#" + tabId.replace("tab-", ""));
  }
}

document.querySelectorAll(".tabbtn").forEach(btn => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

/* reopen on the tab you were last using (or one named in the URL hash) */
function initialTab() {
  const fromHash = "tab-" + location.hash.replace("#", "");
  if (TAB_BODY_CLASS[fromHash]) return fromHash;
  const saved = load("dash.tab", null);
  return TAB_BODY_CLASS[saved] ? saved : "tab-learn";
}

/* ---------------- feedback ---------------- */
let toastTimer = null;
function toast(msg, good = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("good", good);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
function popEl(el) {
  if (!el) return;
  el.classList.remove("pop");
  void el.offsetWidth; // restart the animation
  el.classList.add("pop");
}
function buzz(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ================================================================
   SECTION 1 — LEARNINGS & MEMORY (persisted in localStorage)

   Two evidence-led choices here:
   - Review is RETRIEVAL, not re-reading. Across 159 studies retrieval
     practice beats restudy at g ~= 0.50, with 81% of comparisons favouring
     it, and the advantage grows with the retention interval. So a review
     shows only the cue (category + date), you try to recall, and the text
     is revealed afterwards. Re-reading is the control condition that loses.
   - Intervals expand (SM-2 lite). The interval should be long enough that
     retrieval is effortful but short enough that it still succeeds, so each
     item carries its own ease factor and due date rather than everything
     being reviewed on the same cadence.
   ================================================================ */
let learnings = load("dash.learnings", []);
// { id, text, category, ts, ease, interval, due:'YYYY-MM-DD', reps, lapses }
let reviewPoints = load("dash.reviewpoints", 0);
let pendingReview = null;   // { type, points, queue:[], idx, revealed }
let reviewsDone = load("dash.reviewsdone", {}); // type -> ISO date last completed

/* older entries predate scheduling — give them a schedule on load */
let _migrated = false;
for (const l of learnings) {
  if (l.ease === undefined) {
    l.ease = 2.5; l.interval = 0; l.reps = 0; l.lapses = 0; l.due = todayISO();
    _migrated = true;
  }
}
if (_migrated) save("dash.learnings", learnings);

function dueLearnings() {
  const t = todayISO();
  return learnings.filter(l => (l.due || t) <= t);
}

function renderLearnStats() {
  $("learn-count").textContent = learnings.length;
  $("review-points").textContent = reviewPoints;
}

function renderLearningList() {
  const list = $("learning-list");
  list.innerHTML = "";
  const sorted = [...learnings].sort((a, b) => b.ts - a.ts);
  for (const l of sorted) {
    const li = document.createElement("li");
    const age = Math.floor((Date.now() - l.ts) / DAY);
    const when = age === 0 ? fmtTime(l.ts) : age === 1 ? "yesterday" : `${age}d ago`;
    li.innerHTML = `<span>${esc(l.text)}</span>
      <span class="learning-meta">${when}${l.category ? ` <span class="cat-tag">${esc(l.category)}</span>` : ""}${
        l.reps ? ` <span class="rep-tag">${l.reps}× recalled</span>` : ""}</span>`;
    list.appendChild(li);
  }
  $("learn-empty").hidden = learnings.length > 0;
  renderPalace();
  renderCategoryDatalist();
  renderSpacedRep();
}

function renderCategoryDatalist() {
  const cats = [...new Set(learnings.map(l => l.category).filter(Boolean))];
  $("category-list").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
}

function renderPalace() {
  const palace = $("memory-palace");
  const groups = {};
  for (const l of learnings) {
    const key = l.category || "Unsorted";
    (groups[key] = groups[key] || []).push(l);
  }
  palace.innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="palace-room">
      <h4>${esc(cat)} <span class="room-count">(${items.length})</span></h4>
      <ul>${items.map(l => `<li>${esc(l.text)}</li>`).join("")}</ul>
    </div>`).join("");
}

$("add-learning").addEventListener("click", () => {
  const text = $("learning-input").value.trim();
  if (!text) return;
  learnings.push({
    id: Date.now() + Math.random(),
    text,
    category: $("learning-category").value.trim(),
    ts: Date.now(),
    ease: 2.5, interval: 0, reps: 0, lapses: 0,
    due: isoOffset(1), // first retrieval attempt tomorrow, not the same day
  });
  save("dash.learnings", learnings);
  $("learning-input").value = "";
  $("learning-category").value = "";
  renderLearnStats();
  renderLearningList();
  popEl($("learn-count"));
  buzz(15);
  toast(`Captured · ${learnings.length} saved`);
});

/* view toggle: list vs memory palace */
$("learn-view-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  $("learn-view-toggle").querySelectorAll(".seg").forEach(b => b.classList.toggle("active", b === btn));
  const palaceMode = btn.dataset.view === "palace";
  $("learning-list").hidden = palaceMode;
  $("memory-palace").hidden = !palaceMode;
});

/* review reward system — each tier now runs as a retrieval session */
const REVIEW_CONFIG = {
  daily:   { days: 7,  count: 1, points: 1, label: "Daily review", scope: "due today, or the past week" },
  weekly:  { days: 31, count: 3, points: 3, label: "Weekly review", scope: "3 from the past month" },
  monthly: { days: 92, count: 5, points: 5, label: "Monthly review", scope: "5 from the past quarter" },
};

function startReview(type) {
  const cfg = REVIEW_CONFIG[type];
  const msg = $("review-msg");
  if (reviewsDone[type] === todayISO()) {
    msg.textContent = "Already done today — come back tomorrow.";
    return;
  }
  // the daily review prefers whatever the schedule says is actually due
  let eligible = type === "daily" ? dueLearnings() : [];
  if (eligible.length === 0) {
    eligible = learnings.filter(l => l.ts >= Date.now() - cfg.days * DAY);
  }
  if (eligible.length === 0) {
    msg.textContent = "Nothing to review in that window yet — capture something first.";
    return;
  }
  msg.textContent = "";
  pendingReview = {
    type, points: cfg.points,
    queue: pickRandom(eligible, cfg.count),
    idx: 0, revealed: false, recalled: 0,
  };
  $("review-area").hidden = false;
  renderReviewStep();
}

function renderReviewStep() {
  const p = pendingReview;
  if (!p) return;
  const l = p.queue[p.idx];
  const cfg = REVIEW_CONFIG[p.type];
  const ago = Math.max(0, Math.floor((Date.now() - l.ts) / DAY));
  const when = ago === 0 ? "earlier today" : ago === 1 ? "yesterday" : `${ago} days ago`;

  $("review-area-title").textContent = `${cfg.label} — ${p.idx + 1} of ${p.queue.length}`;
  $("review-items").innerHTML = `
    <li class="recall-card">
      <div class="recall-cue">${l.category ? `<span class="cat-tag">${esc(l.category)}</span>` : ""}
        <span class="recall-when">logged ${when}</span></div>
      <div class="recall-prompt">${p.revealed ? esc(l.text) : "What did you learn? Try to recall it before revealing."}</div>
    </li>`;
  $("review-items").querySelector(".recall-prompt").classList.toggle("revealed", p.revealed);

  $("review-reveal").hidden = p.revealed;
  $("review-grade").hidden = !p.revealed;
  $("review-complete").hidden = true;
}

/* SM-2 lite: interval expands on success, collapses on a miss */
function scheduleLearning(l, grade) { // 0 forgot, 1 got it, 2 easy
  if (grade === 0) {
    l.reps = 0;
    l.interval = 1;
    l.lapses = (l.lapses || 0) + 1;
    l.ease = Math.max(1.3, l.ease - 0.2);
  } else {
    l.reps = (l.reps || 0) + 1;
    if (l.reps === 1) l.interval = 1;
    else if (l.reps === 2) l.interval = 3;
    else l.interval = Math.round(l.interval * l.ease);
    if (grade === 2) {
      l.ease = Math.min(3.2, l.ease + 0.15);
      l.interval = Math.round(l.interval * 1.3);
    }
  }
  l.interval = Math.max(1, Math.min(365, l.interval));
  l.due = isoOffset(l.interval);
}

$("review-daily").addEventListener("click", () => startReview("daily"));
$("review-weekly").addEventListener("click", () => startReview("weekly"));
$("review-monthly").addEventListener("click", () => startReview("monthly"));

$("review-reveal").addEventListener("click", () => {
  if (!pendingReview) return;
  pendingReview.revealed = true;
  renderReviewStep();
});

$("review-grade").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-grade]");
  if (!btn || !pendingReview) return;
  const p = pendingReview;
  const grade = +btn.dataset.grade;
  scheduleLearning(p.queue[p.idx], grade);
  if (grade > 0) p.recalled++;
  save("dash.learnings", learnings);

  if (p.idx < p.queue.length - 1) {
    p.idx++;
    p.revealed = false;
    renderReviewStep();
    return;
  }
  // session finished — award the points
  reviewPoints += p.points;
  reviewsDone[p.type] = todayISO();
  save("dash.reviewpoints", reviewPoints);
  save("dash.reviewsdone", reviewsDone);
  $(`review-${p.type}`).classList.add("done");
  const nextDue = p.queue.map(l => l.interval).sort((a, b) => a - b)[0];
  $("review-msg").textContent =
    `+${p.points} point${p.points > 1 ? "s" : ""} · recalled ${p.recalled}/${p.queue.length}. ` +
    `Next one comes back in ${nextDue} day${nextDue === 1 ? "" : "s"}.`;
  pendingReview = null;
  $("review-area").hidden = true;
  renderLearnStats();
  renderLearningList();
  popEl($("review-points"));
  buzz([20, 40, 20]);
  toast(`+${p.points} point${p.points > 1 ? "s" : ""} · ${reviewPoints} total`, true);
});

/* what the schedule says is due right now */
function renderSpacedRep() {
  const card = $("spaced-rep-card");
  if (learnings.length === 0) { card.hidden = true; return; }
  card.hidden = false;
  const due = dueLearnings();
  const next = learnings
    .filter(l => l.due > todayISO())
    .sort((a, b) => a.due.localeCompare(b.due))[0];

  if (due.length) {
    $("spaced-rep-msg").innerHTML =
      `<strong>${due.length}</strong> ${due.length === 1 ? "learning is" : "learnings are"} due for recall. ` +
      `Run the daily review — trying to remember before you look is what makes it stick.`;
    $("spaced-rep-item").hidden = true;
  } else {
    $("spaced-rep-msg").textContent = next
      ? `Nothing due today. Next one comes back on ${fmtDate(next.due)}.`
      : "Nothing due today.";
    $("spaced-rep-item").hidden = true;
  }
}

/* ================================================================
   SECTION 2 — HABITS (persisted in localStorage)

   Design follows the habit-formation literature rather than the
   usual streak-counter pattern:
   - Lally et al. (2010) fitted asymptotic automaticity curves and found a
     median 66 days to 95% of asymptote (range 18-254). Singh et al. (2024)
     meta-analysis: medians 59-66 days, individual range 4-335. The "21 day
     rule" has no empirical basis.
   - Lally also found that missing a SINGLE day did not materially affect
     habit formation, so a streak that resets to zero on one miss punishes
     something the evidence says is harmless. We surface "never miss twice"
     and trailing consistency instead, and keep the streak as a minor stat.
   - Implementation intentions ("when X, I will Y") reliably help, so a cue
     is required at creation. Cue TYPE (time-based vs routine-based) shows
     no meaningful difference, so any text is accepted.
   ================================================================ */
let habits = load("dash.habits", []); // { id, name, cue, created:'YYYY-MM-DD', done:{ISO:true} }

/* First-run habits. All daily: Lally's automaticity curve is built on daily
   repetition in a consistent context, and daily cues form habits faster than
   intermittent ones — so anything plausibly daily is daily, sized small enough
   to actually be daily (a 10-minute tidy, not a full clean).
   Note the phone habit is phrased as an ACTION, not an avoidance. "Use my phone
   less" has no cue-behaviour loop to automate; moving the phone to a named place
   does. Same for bed: the action is starting the wind-down, not "being asleep". */
const SEED_HABITS = [
  { name: "Read 10 pages",              cue: "get into bed" },
  { name: "Review the day — 3 lines",   cue: "close my laptop for the day" },
  { name: "10-minute tidy",             cue: "finish washing up after dinner" },
  { name: "10 minutes of mobility",     cue: "finish my morning coffee" },
  { name: "Phone on the hallway shelf", cue: "sit down on the sofa after dinner" },
  { name: "Start winding down for bed", cue: "hear my 21:15 alarm" },
];

if (!load("dash.seeded", false) && habits.length === 0) {
  habits = SEED_HABITS.map((h, i) => ({
    id: Date.now() + i, name: h.name, cue: h.cue, created: todayISO(), done: {},
  }));
  save("dash.habits", habits);
  save("dash.seeded", true);
}

const REPS_TO_95 = 66;          // Lally median repetitions to 95% of asymptote
const AUTO_K = REPS_TO_95 / 3;  // 1-e^-3 = 0.95, so strength(66) = 95%

function isoOffset(days) {
  const d = startOfDay();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* automaticity estimate: asymptotic in the number of repetitions actually done */
function automaticity(h) {
  const reps = Object.keys(h.done).length;
  return 1 - Math.exp(-reps / AUTO_K);
}

/* days the habit has existed (inclusive of today) */
function habitAgeDays(h) {
  return Math.max(1, Math.round((startOfDay().getTime() - new Date(h.created + "T12:00").getTime()) / DAY) + 1);
}

/* completions / opportunities over the trailing `window` days, capped at habit age */
function consistency(h, window = 30) {
  const days = Math.min(window, habitAgeDays(h));
  let hit = 0;
  for (let i = 0; i < days; i++) if (h.done[isoOffset(-i)]) hit++;
  return { hit, days, pct: days ? Math.round((hit / days) * 100) : 0 };
}

function currentStreak(h) {
  let n = 0;
  // today only counts if done; otherwise the streak is measured to yesterday
  let i = h.done[todayISO()] ? 0 : 1;
  while (h.done[isoOffset(-i)]) { n++; i++; }
  return n;
}

/* at risk = missed yesterday (and existed then) and not yet done today */
function atRiskOfSecondMiss(h) {
  const y = isoOffset(-1);
  if (h.created > y) return false;
  return !h.done[y] && !h.done[todayISO()];
}

function renderHabits() {
  const list = $("habit-list");
  const today = todayISO();
  const doneToday = habits.filter(h => h.done[today]).length;
  $("habit-today").textContent = `${doneToday}/${habits.length}`;
  $("habit-empty").hidden = habits.length > 0;

  list.innerHTML = habits.map(h => {
    const pct = Math.round(automaticity(h) * 100);
    const c = consistency(h);
    const streak = currentStreak(h);
    const isDone = !!h.done[today];
    const risk = atRiskOfSecondMiss(h);

    // 28-day strip, oldest -> today
    let strip = "";
    for (let i = 27; i >= 0; i--) {
      const iso = isoOffset(-i);
      const cls = iso < h.created ? "pre" : h.done[iso] ? "done" : "missed";
      strip += `<span class="strip-cell ${cls}${i === 0 ? " today" : ""}"></span>`;
    }

    return `<li class="habit-item">
      <button class="habit-check ${isDone ? "done" : ""} ${risk ? "at-risk" : ""}"
              data-id="${h.id}" aria-pressed="${isDone}"
              aria-label="Mark ${esc(h.name)} done for today">${isDone ? "✓" : ""}</button>
      <div class="habit-main">
        <div class="habit-name">${esc(h.name)}</div>
        <div class="habit-cue"><span class="cue-lead">When I</span> ${esc(h.cue)}</div>
        <div class="habit-strip">${strip}</div>
        <div class="habit-meter">
          <div class="habit-meter-track"><div class="habit-meter-fill" style="width:${pct}%"></div></div>
          <div class="habit-stats">
            <span><span class="num">${pct}%</span> automatic</span>
            <span><span class="num">${Object.keys(h.done).length}</span>/${REPS_TO_95} reps</span>
            <span><span class="num">${c.pct}%</span> last ${c.days}d</span>
            ${streak > 1 ? `<span><span class="num">${streak}</span> in a row</span>` : ""}
          </div>
        </div>
      </div>
      <button class="habit-del" data-del="${h.id}" aria-label="Delete ${esc(h.name)}">✕</button>
    </li>`;
  }).join("");

  // never-miss-twice alert
  const risky = habits.filter(atRiskOfSecondMiss);
  $("miss-twice-card").hidden = risky.length === 0;
  if (risky.length) {
    const names = risky.map(h => h.name).join(", ");
    $("miss-twice-msg").innerHTML =
      `You missed <strong>${esc(names)}</strong> yesterday. Missing one day doesn't set you back — ` +
      `missing two in a row is what breaks the pattern. Get ${risky.length > 1 ? "them" : "it"} done today.`;
  }

  renderSleep();
  renderScreenTime();
  renderRewards();
  renderTips(); // the per-habit advice keys off the stats above
}

$("habit-list").addEventListener("click", (e) => {
  const check = e.target.closest(".habit-check");
  if (check) {
    const h = habits.find(x => String(x.id) === check.dataset.id);
    if (!h) return;
    const today = todayISO();
    const wasDone = !!h.done[today];
    if (wasDone) delete h.done[today];
    else h.done[today] = true;
    save("dash.habits", habits);
    renderHabits();
    if (!wasDone) {
      buzz(20);
      const pct = Math.round(automaticity(h) * 100);
      const reps = Object.keys(h.done).length;
      toast(reps >= REPS_TO_95
        ? `🌱 ${h.name} — ${reps} reps, past the 66-rep median`
        : `${h.name} done · ${pct}% automatic`, true);
    }
    return;
  }
  const del = e.target.closest(".habit-del");
  if (del) {
    const h = habits.find(x => String(x.id) === del.dataset.del);
    if (!h) return;
    if (confirm(`Delete “${h.name}”? Its history will be lost.`)) {
      habits = habits.filter(x => x !== h);
      save("dash.habits", habits);
      renderHabits();
      toast("Habit deleted");
    }
  }
});

/* ---------------- sleep ----------------
   One number and one rating, logged against the morning you wake up.
   Deliberately minimal: acute sleep loss measurably cuts strength (~6% on
   handgrip) and degrades working memory and inhibitory control, so it's worth
   capturing — but no causal claims are drawn from n=1 data here, just the raw
   log and a 7-night average for context. */
let sleep = load("dash.sleep", {}); // { 'YYYY-MM-DD': { hours, quality } }
let sleepDraft = 7.5;

function todaySleep() { return sleep[todayISO()]; }

function renderSleep() {
  const s = todaySleep();
  const hours = s ? s.hours : sleepDraft;
  $("sleep-hours").textContent = hours.toFixed(1).replace(/\.0$/, "");
  $("sleep-quality").querySelectorAll(".qual").forEach(b =>
    b.classList.toggle("sel", !!s && +b.dataset.q === s.quality));
  // an imported night has hours but no quality until you rate it
  $("sleep-msg").textContent = !s
    ? "How well did you sleep? 1 = wrecked, 5 = fully rested."
    : s.quality
      ? `Logged ${s.hours}h · quality ${s.quality}/5. Tap again to change it.`
      : `Imported ${s.hours}h — tap a number to rate how it felt.`;

  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const rec = sleep[isoOffset(-i)];
    if (rec) last7.push(rec.hours);
  }
  $("sleep-avg").textContent = last7.length
    ? `${(last7.reduce((a, b) => a + b, 0) / last7.length).toFixed(1)}h avg · ${last7.length} night${last7.length === 1 ? "" : "s"}`
    : "no nights logged yet";

  // 14-night strip, bar height scaled across a 4h-9h band
  let strip = "";
  for (let i = 13; i >= 0; i--) {
    const iso = isoOffset(-i);
    const rec = sleep[iso];
    const pct = rec ? Math.max(8, Math.min(100, ((rec.hours - 4) / 5) * 100)) : 0;
    strip += `<span class="sleep-night" title="${iso}"><i style="height:${pct}%"></i></span>`;
  }
  $("sleep-strip").innerHTML = strip;
}

function saveSleep(hours, quality) {
  sleep[todayISO()] = { hours, quality };
  save("dash.sleep", sleep);
  renderSleep();
}

$("sleep-minus").addEventListener("click", () => {
  const s = todaySleep();
  const next = Math.max(0, (s ? s.hours : sleepDraft) - 0.5);
  if (s) saveSleep(next, s.quality); else { sleepDraft = next; renderSleep(); }
});
$("sleep-plus").addEventListener("click", () => {
  const s = todaySleep();
  const next = Math.min(14, (s ? s.hours : sleepDraft) + 0.5);
  if (s) saveSleep(next, s.quality); else { sleepDraft = next; renderSleep(); }
});
$("sleep-quality").addEventListener("click", (e) => {
  const btn = e.target.closest(".qual");
  if (!btn) return;
  const s = todaySleep();
  const h = s ? s.hours : sleepDraft;
  saveSleep(h, +btn.dataset.q);
  buzz(15);
  toast(`Sleep logged · ${h}h`);
});

/* ================================================================
   TIPS — per-habit advice, matched to how the habit is actually going

   Matching is by keyword on the habit name rather than a stored key, so it
   still works for habits seeded before this existed and for anything you
   add yourself. Anything unmatched falls back to the generic set.
   ================================================================ */
const TIP_SETS = [
  {
    match: /read|book|pages/i,
    tips: [
      ["Leave the book physically on the pillow.", "A cue you can't miss beats one you have to remember. If the book lives in another room, the habit depends on willpower instead of the environment."],
      ["Ten pages is the floor, not the target.", "On a wrecked night, read one page. The repetition is what builds automaticity — volume isn't. One page keeps the chain; zero breaks it."],
      ["Abandon books you aren't enjoying.", "Most reading habits die defending a book the reader stopped liking 80 pages ago. The habit is reading, not finishing."],
      ["It doubles as the phone substitute.", "Your hands need something at bedtime. If the book isn't there, the phone will be."],
    ],
  },
  {
    match: /review|journal|reflect/i,
    tips: [
      ["Hold the line at three lines.", "Journalling habits usually die from scope creep, not lack of interest. Three lines is finishable on a bad day, and finishable is the whole point."],
      ["Use a fixed prompt so you're never staring at a blank page.", "What went well · what didn't · one thing for tomorrow. Deciding what to write is the friction, so remove that decision."],
      ["Feed anything worth keeping into the Learn tab.", "The review is where you notice the insight; the Learn tab is what stops you losing it. It'll come back for recall later."],
      ["Do it at the laptop, before you get up.", "The cue is closing the laptop. If you stand up first, it won't happen."],
    ],
  },
  {
    match: /tidy|clean|flat|hous/i,
    tips: [
      ["Set an actual 10-minute timer and stop when it goes.", "Stopping on time is what makes this repeatable. If it routinely runs to 40 minutes you'll start avoiding it."],
      ["One room or one surface. Not the flat.", "The daily version exists to prevent the three-hour weekend blitz, not to replicate it in miniature."],
      ["Think 'reset', not 'clean'.", "Put things back where they live. Deep cleaning is a different job with a different cadence."],
      ["Start with the surface you see first when you walk in.", "Visible order does most of the psychological work for the least effort."],
    ],
  },
  {
    match: /mobility|stretch|yoga|flexib/i,
    tips: [
      ["Morning is deliberate, not arbitrary.", "Stretching habits have been found to hold better when practised in the morning than the evening — which is exactly why this one is pinned to your coffee."],
      ["Same mat, same square metre, every time.", "Context stability is one of the strongest drivers of automaticity. Same place, same order, same first movement."],
      ["Point it at your lifts.", "Hips and ankles for the squat, t-spine and shoulders for the overhead press. Mobility that removes a limiter gets repeated; generic stretching doesn't."],
      ["Two minutes counts on a bad day.", "A short session keeps the cue-behaviour link alive. Skipping is the only thing that damages it."],
    ],
  },
  {
    match: /phone|screen|shelf/i,
    tips: [
      ["The habit is the walk to the shelf, not the not-scrolling.", "You can't make an absence automatic. You can make an action automatic, and the action removes the temptation for you."],
      ["Distance is the mechanism. Willpower isn't.", "Every extra step between you and the phone is doing work that self-control would otherwise have to do all evening."],
      ["Put the charger on the shelf.", "Give the phone a legitimate reason to live there. 'It's charging' is a much easier story than 'I'm resisting it'."],
      ["If you need it, fetch it deliberately.", "The walk is the pause. Getting up on purpose is completely different from reaching for it without noticing."],
    ],
  },
  {
    match: /\bbed\b|wind[- ]?down|winding down|sleep/i,
    tips: [
      ["The habit is starting the wind-down. Nothing else.", "You can't will yourself asleep, so 'asleep by 21:30' isn't a trackable behaviour. Starting a routine at 21:15 is."],
      ["Protect the wake time harder than the bedtime.", "A consistent wake time anchors your body clock more reliably than a consistent bedtime, and it makes the bedtime easier by itself."],
      ["Drop the lights before you drop the pace.", "Light is the strongest signal your circadian system takes. Dimming is a faster win than any other part of the routine."],
      ["A bad night doesn't mean a failed habit.", "You're tracking whether you started the routine, not how you slept. Mark it done — the sleep log is where the outcome lives."],
    ],
  },
];

const GENERIC_TIPS = [
  ["Keep the cue fixed.", "Automaticity is built by the same trigger firing in the same context. If you keep moving when you do it, you're restarting the clock each time."],
  ["Make it small enough to survive a bad day.", "The version you'd still do while tired and behind on work is the version that becomes automatic."],
  ["Attach it to something already automatic.", "An existing routine is a far more reliable trigger than an intention, because it's already happening without you deciding."],
  ["Never miss twice.", "One missed day doesn't measurably set the habit back. Two in a row is what turns a slip into a stop."],
];

function tipsFor(habit) {
  const set = TIP_SETS.find(t => t.match.test(habit.name));
  return set ? set.tips : GENERIC_TIPS;
}

/* how is this habit actually doing? drives which advice leads */
function diagnose(h) {
  const reps = Object.keys(h.done).length;
  const c = consistency(h, 14);
  const age = habitAgeDays(h);
  const pct = Math.round(automaticity(h) * 100);

  if (age <= 3 || reps === 0) {
    return { state: "new", label: "just started",
      advice: reps === 0
        ? "Nothing logged yet. The first few reps buy more automaticity than any later ones, so getting today done matters more than it will in a month."
        : `${reps} rep${reps === 1 ? "" : "s"} in. Early repetitions move the needle fastest — this is the stretch worth protecting.` };
  }
  if (c.pct >= 85) {
    return { state: "solid", label: "holding",
      advice: `${c.hit} of the last ${c.days} days, ${pct}% automatic. This one's working — don't redesign it. Keep the cue exactly where it is and let the reps accumulate.` };
  }
  if (c.pct >= 50) {
    return { state: "wobbly", label: "wobbling",
      advice: `${c.hit} of the last ${c.days} days. Not broken, but drifting. Usually the cue has become unreliable rather than the habit becoming unwanted — check whether the trigger still happens at a predictable time.` };
  }
  return { state: "slipping", label: "slipping",
    advice: `Only ${c.hit} of the last ${c.days} days. That's a sign the behaviour is too big rather than that you lack discipline. Shrink it to something you'd do on your worst day, and rebuild from there.` };
}

function renderTips() {
  const list = $("tips-list");
  $("tips-empty").hidden = habits.length > 0;
  list.innerHTML = habits.map(h => {
    const d = diagnose(h);
    return `<div class="card tip-card">
      <div class="tip-head">
        <div>
          <div class="tip-name">${esc(h.name)}</div>
          <div class="tip-cue"><span class="cue-lead">When I</span> ${esc(h.cue)}</div>
        </div>
        <span class="state-badge ${d.state}">${d.label}</span>
      </div>
      <div class="tip-diagnosis">${esc(d.advice)}</div>
      <ul class="tip-list">
        ${tipsFor(h).map(([lead, body]) => `<li><strong>${esc(lead)}</strong> ${esc(body)}</li>`).join("")}
      </ul>
    </div>`;
  }).join("");
}

/* ---------------- sleep import from Shortcuts ----------------
   iOS Shortcuts can read Health sleep samples; it cannot write into this app's
   storage. So the handoff is a payload the Shortcut puts on the clipboard (or
   in a ?sleep= query param) and we parse here. The parser is deliberately
   forgiving because the payload is hand-built in Shortcuts:
     "7.5"                          -> last night
     "sleep=7.5"                    -> last night
     "2026-08-07=7.5; 2026-08-08=6.75"  -> backfill, one night per pair
   Note a Shortcut opening the URL may land in Safari rather than the installed
   web app, which on iOS is a separate storage container — hence clipboard first. */
function parseSleepPayload(text) {
  const out = [];
  if (!text) return out;
  const cleaned = String(text).trim().replace(/^sleep\s*=\s*/i, "");
  // dated pairs first
  const dated = [...cleaned.matchAll(/(\d{4}-\d{2}-\d{2})\s*[=:]\s*(\d+(?:\.\d+)?)/g)];
  if (dated.length) {
    for (const m of dated) {
      const h = parseFloat(m[2]);
      if (h > 0 && h <= 24) out.push({ date: m[1], hours: h });
    }
    return out;
  }
  // otherwise a bare number applies to today (capture any sign so it fails the range check)
  const bare = cleaned.match(/(-?\d+(?:\.\d+)?)/);
  if (bare) {
    const h = parseFloat(bare[1]);
    if (h > 0 && h <= 24) out.push({ date: todayISO(), hours: h });
  }
  return out;
}

function applySleepImport(text, source) {
  const rows = parseSleepPayload(text);
  const msg = $("import-msg");
  if (!rows.length) {
    msg.textContent = "Couldn't read that. Expected a number like 7.5, or lines of YYYY-MM-DD=hours.";
    return 0;
  }
  for (const r of rows) {
    const existing = sleep[r.date];
    // keep any quality rating already given for that night
    sleep[r.date] = { hours: r.hours, quality: existing ? existing.quality : null };
  }
  save("dash.sleep", sleep);
  renderSleep();
  msg.textContent = `Imported ${rows.length} night${rows.length === 1 ? "" : "s"}${source ? ` from ${source}` : ""}.`;
  toast(`⌚ ${rows.length} night${rows.length === 1 ? "" : "s"} imported`, true);
  return rows.length;
}

$("sleep-import").addEventListener("click", async () => {
  const msg = $("import-msg");
  try {
    const text = await navigator.clipboard.readText();
    if (text && parseSleepPayload(text).length) {
      applySleepImport(text, "clipboard");
      $("import-fallback").hidden = true;
      return;
    }
    msg.textContent = "Clipboard didn't contain sleep data — paste it below instead.";
  } catch {
    msg.textContent = "Couldn't read the clipboard — paste below instead.";
  }
  $("import-fallback").hidden = false;
  $("import-text").focus();
});

$("import-go").addEventListener("click", () => {
  if (applySleepImport($("import-text").value, "paste")) {
    $("import-text").value = "";
    $("import-fallback").hidden = true;
  }
});

/* ?sleep=<payload> lets a Shortcut push data by opening a URL */
(function importFromUrl() {
  const p = new URLSearchParams(location.search).get("sleep");
  if (!p) return;
  // strip the param so a refresh doesn't re-import
  history.replaceState(null, "", location.pathname + location.hash);
  window.addEventListener("load", () => applySleepImport(p, "link"));
})();

/* ---------------- screen time ----------------
   Manual by necessity: iOS exposes no read access to Screen Time usage to any
   third party — no Shortcuts action, and the native Screen Time API hands back
   opaque tokens under an entitlement. One number a week is the honest option. */
let screenTime = load("dash.screentime", {}); // { weekKeyISO: hoursPerDay }

function renderScreenTime() {
  const wk = weekKey();
  const cur = screenTime[wk];
  $("st-input").value = cur !== undefined ? cur : "";

  const weeks = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(startOfWeek().getTime() - i * 7 * DAY);
    const k = weekKey(d);
    if (screenTime[k] !== undefined) weeks.push({ k, v: screenTime[k] });
  }
  const prior = weeks.slice(1);
  if (cur !== undefined && prior.length) {
    const avg = prior.reduce((a, w) => a + w.v, 0) / prior.length;
    const delta = cur - avg;
    const dir = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "";
    $("st-trend").innerHTML = dir
      ? `<span class="st-delta ${dir}">${delta > 0 ? "+" : ""}${delta.toFixed(1)}h vs recent avg</span>`
      : "level with recent weeks";
  } else {
    $("st-trend").textContent = cur !== undefined ? "first week logged" : "nothing logged yet";
  }

  $("st-log").innerHTML = weeks.map((w, i) =>
    `<li><span>${i === 0 ? "This week" : `Week of ${fmtDate(w.k)}`}</span><span class="st-val">${w.v.toFixed(1)}h/day</span></li>`
  ).join("");
}

$("st-save").addEventListener("click", () => {
  const v = parseFloat($("st-input").value);
  if (!(v >= 0 && v <= 24)) { $("st-input").focus(); return; }
  screenTime[weekKey()] = v;
  save("dash.screentime", screenTime);
  renderScreenTime();
  buzz(15);
  toast(`Screen time logged · ${v.toFixed(1)}h/day`);
});

/* ---------------- vinyl fund ----------------
   Two conditions, both required, evaluated for the current week:
     1. deep work at 100%+ of the trailing 4-week average
     2. habits kept up (>= HABIT_BAR of this week's opportunities so far)
   The deep-work condition self-regulates against early claiming: this week's
   MINUTES are compared against a full week's average, so it can't clear 100%
   on a Monday. Habits are measured against opportunities elapsed so far, so a
   habit created mid-week isn't punished. */
let rewards = load("dash.rewards", []); // [{ week, claimed:'ISO', dwPct, habitPct }]
const HABIT_BAR = 80;      // % of this week's habit opportunities
const DW_FALLBACK_MIN = 300; // 5h — used until a 4-week baseline exists

function weekKey(d = new Date()) {
  const ws = startOfWeek(d);
  return `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
}

/* habit completions vs opportunities elapsed so far this week */
function habitWeekProgress() {
  const ws = startOfWeek();
  const daysElapsed = Math.floor((startOfDay().getTime() - ws.getTime()) / DAY) + 1;
  let hit = 0, opps = 0;
  for (const h of habits) {
    for (let i = 0; i < daysElapsed; i++) {
      const d = new Date(ws.getTime() + i * DAY);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (iso < h.created) continue; // habit didn't exist yet
      opps++;
      if (h.done[iso]) hit++;
    }
  }
  return { hit, opps, pct: opps ? Math.round((hit / opps) * 100) : 0 };
}

function deepWorkWeekProgress() {
  const weekMin = sumMin(dwInRange(startOfWeek()));
  const avgPrior = priorWeeksAvg(4);
  if (avgPrior > 0) {
    return { pct: Math.round((weekMin / avgPrior) * 100), weekMin, baseline: true, targetMin: Math.round(avgPrior) };
  }
  return { pct: Math.round((weekMin / DW_FALLBACK_MIN) * 100), weekMin, baseline: false, targetMin: DW_FALLBACK_MIN };
}

function renderRewards() {
  const dw = deepWorkWeekProgress();
  const hb = habitWeekProgress();
  const dwMet = dw.pct >= 100;
  const hbMet = habits.length > 0 && hb.pct >= HABIT_BAR;
  const alreadyClaimed = rewards.some(r => r.week === weekKey());

  $("records-earned").textContent = rewards.length;
  $("records-pill").querySelector(".stat-label").textContent = rewards.length === 1 ? "record" : "records";

  const cond = (met, label, sub, pct) => `
    <div class="cond ${met ? "met" : ""}">
      <span class="cond-icon">${met ? "✅" : "⬜"}</span>
      <div class="cond-body">
        <div class="cond-label">${label}</div>
        <div class="cond-sub">${sub}</div>
        <div class="cond-track"><div class="cond-fill" style="width:${Math.min(100, pct)}%"></div></div>
      </div>
    </div>`;

  $("reward-conditions").innerHTML =
    cond(dwMet, `Deep work · ${dw.pct}%`,
      dw.baseline
        ? `${dw.weekMin} min this week vs ${dw.targetMin} min 4-week average`
        : `${dw.weekMin} of ${dw.targetMin} min (no 4-week baseline yet)`,
      dw.pct) +
    cond(hbMet, `Habits · ${hb.pct}%`,
      habits.length
        ? `${hb.hit} of ${hb.opps} chances taken this week — need ${HABIT_BAR}%`
        : "Add a habit to start tracking",
      hb.pct);

  const ready = dwMet && hbMet && !alreadyClaimed;
  $("claim-reward").hidden = !ready;
  $("reward-msg").textContent = alreadyClaimed
    ? "Record already claimed this week. Go and put it on."
    : ready
      ? ""
      : "Both bars need to be full. They reset every Monday.";

  $("reward-log").innerHTML = [...rewards].reverse().slice(0, 6).map(r =>
    `<li><span>🎵 Week of ${fmtDate(r.week)}</span><span>${r.dwPct}% deep work · ${r.habitPct}% habits</span></li>`
  ).join("");
}

$("claim-reward").addEventListener("click", () => {
  if (rewards.some(r => r.week === weekKey())) return;
  const dw = deepWorkWeekProgress();
  const hb = habitWeekProgress();
  if (dw.pct < 100 || hb.pct < HABIT_BAR) return; // guard against a stale button
  rewards.push({ week: weekKey(), claimed: todayISO(), dwPct: dw.pct, habitPct: hb.pct });
  save("dash.rewards", rewards);
  renderRewards();
  popEl($("records-earned"));
  buzz([40, 60, 40, 60, 120]);
  toast(`🎵 Record #${rewards.length} earned — go buy it`, true);
});

$("add-habit").addEventListener("click", () => {
  const cue = $("habit-cue").value.trim();
  const name = $("habit-name").value.trim();
  const msg = $("habit-form-msg");
  if (!name) { msg.textContent = "Give the habit a name."; $("habit-name").focus(); return; }
  if (!cue) {
    // the cue is the evidence-backed part — don't let it be skipped
    msg.textContent = "Add a cue. A habit without a trigger is just a wish — the “when” is what makes it stick.";
    $("habit-cue").focus();
    return;
  }
  habits.push({ id: Date.now(), name, cue, created: todayISO(), done: {} });
  save("dash.habits", habits);
  $("habit-cue").value = "";
  $("habit-name").value = "";
  msg.textContent = "";
  renderHabits();
  buzz(15);
  toast(`🌱 Tracking “${name}”`, true);
});

/* ================================================================
   SECTION 3 — STRENGTH TRAINING (persisted in localStorage)
   ================================================================ */
const LIFTS = ["Bench Press", "Trap Bar Deadlift", "Overhead Press", "High Bar Squat"];
let liftLog = load("dash.lifts", []); // { id, lift, weight, reps, rpe, date, note }
let chartLift = LIFTS[0];
let historyRange = "today";

/* RPE select: 6 to 10 in 0.5 steps (below 6 barely changes e1RM for top sets) */
(function initRpe() {
  const sel = $("lift-rpe");
  for (let r = 10; r >= 6; r -= 0.5) {
    const opt = document.createElement("option");
    opt.value = r; opt.textContent = r === 10 ? "10 (max)" : r;
    sel.appendChild(opt);
  }
  sel.value = "8";
})();
$("lift-date").value = todayISO();

/* Epley with RPE adjustment:
   reps in reserve = 10 - RPE, effective reps = reps + RIR,
   e1RM = weight * (1 + effectiveReps / 30) */
function estimate1RM(weight, reps, rpe) {
  const rir = Math.max(0, 10 - rpe);
  const effReps = reps + rir;
  return weight * (1 + effReps / 30);
}

/* ---------------- autoregulation ----------------
   Invert the same Epley+RPE model used to estimate e1RM, so a target weight
   is whatever produces the given reps at the given RPE from your recent best.
   Basis is the best e1RM in the last 3 weeks, not all-time: a stale PR from
   six months ago is not a sane prescription for today. */
function targetWeight(e1rm, reps, rpe) {
  const rir = Math.max(0, 10 - rpe);
  return e1rm / (1 + (reps + rir) / 30);
}
const round2p5 = (w) => Math.round(w / 2.5) * 2.5;

function bestE1rmBetween(lift, fromDaysAgo, toDaysAgo) {
  const from = isoOffset(-fromDaysAgo), to = isoOffset(-toDaysAgo);
  const vals = liftLog
    .filter(l => l.lift === lift && l.date > from && l.date <= to)
    .map(l => estimate1RM(l.weight, l.reps, l.rpe));
  return vals.length ? Math.max(...vals) : null;
}

/* flat or falling across two consecutive 3-week blocks, with enough data to mean it */
function plateauState(lift) {
  const recent = bestE1rmBetween(lift, 21, 0);
  const prior = bestE1rmBetween(lift, 42, 21);
  const nRecent = liftLog.filter(l => l.lift === lift && l.date > isoOffset(-21)).length;
  if (recent === null || prior === null || nRecent < 3) return null;
  if (recent < prior * 0.98) return "declining";
  if (recent <= prior * 1.01) return "flat";
  return null;
}

function renderTargets() {
  const reps = parseInt($("lift-reps").value, 10);
  const rpe = parseFloat($("lift-rpe").value);
  const rows = LIFTS.map(lift => {
    const e = bestE1rmBetween(lift, 21, 0);
    if (e === null) return null;
    const p = plateauState(lift);
    return `<li>
      <div>
        <div class="target-name">${esc(lift)}${p ? `<span class="plateau-badge">${p === "flat" ? "plateau" : "declining"}</span>` : ""}</div>
        <div class="target-sub">e1RM ${e.toFixed(1)} kg in the last 3 weeks${p ? " · consider a deload week" : ""}</div>
      </div>
      <div class="target-weight">${round2p5(targetWeight(e, reps, rpe))} kg</div>
    </li>`;
  }).filter(Boolean);
  $("target-list").innerHTML = rows.join("");
  $("target-empty").hidden = rows.length > 0;
}

function renderSuggestion() {
  const lift = $("lift-select").value;
  const reps = parseInt($("lift-reps").value, 10);
  const rpe = parseFloat($("lift-rpe").value);
  const e = bestE1rmBetween(lift, 21, 0);
  const row = $("suggest-row");
  if (e === null) { row.hidden = true; return; }
  const w = round2p5(targetWeight(e, reps, rpe));
  $("suggest-text").innerHTML =
    `<strong>${w} kg</strong> for ${reps} @ RPE ${rpe}<br>from your ${e.toFixed(1)} kg e1RM in the last 3 weeks`;
  row.dataset.weight = w;
  row.hidden = false;
}

$("suggest-use").addEventListener("click", () => {
  $("lift-weight").value = $("suggest-row").dataset.weight;
  updateE1rmPreview();
  buzz(10);
});

["lift-select", "lift-reps", "lift-rpe"].forEach(id =>
  $(id).addEventListener("change", () => { renderSuggestion(); renderTargets(); }));

function updateE1rmPreview() {
  const w = parseFloat($("lift-weight").value);
  const preview = $("e1rm-preview");
  if (!w || w <= 0) { preview.hidden = true; return; }
  const reps = parseInt($("lift-reps").value, 10);
  const rpe = parseFloat($("lift-rpe").value);
  const e = estimate1RM(w, reps, rpe);
  preview.textContent = `Estimated 1RM: ${e.toFixed(1)} kg  (${w} kg × ${reps} @ RPE ${rpe})`;
  preview.hidden = false;
}
["lift-weight", "lift-reps", "lift-rpe"].forEach(id => {
  $(id).addEventListener("input", updateE1rmPreview);
});

$("add-lift").addEventListener("click", () => {
  const weight = parseFloat($("lift-weight").value);
  if (!weight || weight <= 0) { $("lift-weight").focus(); return; }
  const entry = {
    id: Date.now(),
    lift: $("lift-select").value,
    weight,
    reps: parseInt($("lift-reps").value, 10),
    rpe: parseFloat($("lift-rpe").value),
    date: $("lift-date").value || todayISO(),
    note: $("lift-note").value.trim(),
  };
  // is this an all-time e1RM PR for this lift? (check before pushing)
  const e = estimate1RM(entry.weight, entry.reps, entry.rpe);
  const prevBest = Math.max(0, ...liftLog
    .filter(l => l.lift === entry.lift)
    .map(l => estimate1RM(l.weight, l.reps, l.rpe)));
  const isPR = e > prevBest;

  liftLog.push(entry);
  save("dash.lifts", liftLog);
  buzz(isPR ? [30, 50, 30, 50, 60] : 15);
  toast(isPR ? `🏆 PR! ${entry.lift} e1RM ${e.toFixed(1)} kg` : `Logged · e1RM ${e.toFixed(1)} kg`, isPR);
  $("lift-weight").value = "";
  $("lift-note").value = "";
  $("e1rm-preview").hidden = true;
  chartLift = entry.lift;
  renderLiftChartToggle();
  renderLiftChart();
  renderLiftHistory();
  renderSuggestion();
  renderTargets();
});

function renderLiftChartToggle() {
  const el = $("chart-lift-toggle");
  el.innerHTML = LIFTS.map(l =>
    `<button class="seg ${l === chartLift ? "active" : ""}" data-lift="${esc(l)}">${esc(l.replace("Trap Bar ", "TB ").replace("High Bar ", "HB "))}</button>`
  ).join("");
}
$("chart-lift-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  chartLift = btn.dataset.lift;
  renderLiftChartToggle();
  renderLiftChart();
});

function renderLiftChart() {
  const holder = $("lift-chart");
  const entries = liftLog
    .filter(l => l.lift === chartLift)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map(l => ({ ...l, e1rm: estimate1RM(l.weight, l.reps, l.rpe) }));
  $("chart-empty").hidden = entries.length > 0;
  if (entries.length === 0) { holder.innerHTML = ""; return; }

  const W = 520, H = 220, padL = 44, padR = 14, padT = 14, padB = 30;
  const vals = entries.map(e => e.e1rm);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 5) { lo -= 3; hi += 3; }
  const span = hi - lo;
  lo -= span * 0.1; hi += span * 0.1;

  const x = (i) => entries.length === 1
    ? (padL + (W - padL - padR) / 2)
    : padL + (i / (entries.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const accent = getComputedStyle(document.body).getPropertyValue("--tab-accent").trim() || "#4f8cff";
  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e.e1rm).toFixed(1)}`).join(" ");
  const baseline = H - padB;

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient></defs>`;

  // recessive gridlines + y ticks
  for (let g = 0; g <= 3; g++) {
    const v = lo + (g / 3) * (hi - lo);
    const gy = y(v);
    svg += `<line class="chart-grid" x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}"/>`;
    svg += `<text class="chart-label" x="${padL - 8}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${v.toFixed(0)}</text>`;
  }

  // area wash under the line (~10-20% opacity, never a saturated block)
  if (entries.length > 1) {
    svg += `<polygon class="chart-area" points="${x(0).toFixed(1)},${baseline} ${pts} ${x(entries.length - 1).toFixed(1)},${baseline}"/>`;
  }
  svg += `<polyline class="chart-line" points="${pts}"/>`;

  // dots carry a 2px surface ring (set in CSS via stroke)
  const labelEvery = Math.max(1, Math.ceil(entries.length / 6));
  entries.forEach((e, i) => {
    svg += `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(e.e1rm).toFixed(1)}" r="4"/>`;
    if (i % labelEvery === 0 || i === entries.length - 1) {
      svg += `<text class="chart-label" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtDate(e.date)}</text>`;
    }
  });
  // label only the final value directly — never every point
  const last = entries[entries.length - 1];
  svg += `<text class="chart-value" x="${(x(entries.length - 1) + 2).toFixed(1)}" y="${(y(last.e1rm) - 10).toFixed(1)}" text-anchor="end">${last.e1rm.toFixed(0)} kg</text>`;

  // generous tap targets for the tooltip
  const hitW = (W - padL - padR) / Math.max(1, entries.length);
  entries.forEach((e, i) => {
    svg += `<rect class="chart-hit" data-i="${i}" x="${(x(i) - hitW / 2).toFixed(1)}" y="${padT}" width="${hitW.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}"/>`;
  });
  svg += `</svg>`;
  holder.innerHTML = svg;

  const tip = $("lift-tip");
  tip.innerHTML = `<strong>${last.e1rm.toFixed(1)} kg</strong> latest · tap a point for detail`;
  holder.querySelectorAll(".chart-hit").forEach(hit => {
    hit.addEventListener("click", () => {
      const e = entries[+hit.dataset.i];
      tip.innerHTML = `<strong>${e.e1rm.toFixed(1)} kg</strong> e1RM · ${e.weight} kg × ${e.reps} @ RPE ${e.rpe} · ${fmtDate(e.date)}${e.note ? ` · “${esc(e.note)}”` : ""}`;
    });
  });
}

$("history-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  historyRange = btn.dataset.range;
  $("history-toggle").querySelectorAll(".seg").forEach(b => b.classList.toggle("active", b === btn));
  renderLiftHistory();
});

function renderLiftHistory() {
  const list = $("lift-history");
  let rows = [];
  const withE = liftLog.map(l => ({ ...l, e1rm: estimate1RM(l.weight, l.reps, l.rpe) }));

  if (historyRange === "today") {
    rows = withE.filter(l => l.date === todayISO());
  } else if (historyRange === "week") {
    const ws = startOfWeek();
    rows = withE.filter(l => new Date(l.date + "T12:00") >= ws);
  } else { // all-time PRs: best e1RM per lift
    for (const lift of LIFTS) {
      const best = withE.filter(l => l.lift === lift).sort((a, b) => b.e1rm - a.e1rm)[0];
      if (best) rows.push({ ...best, isPR: true });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  list.innerHTML = rows.map(l => `
    <li>
      <div class="row-main">
        <span>${l.isPR ? '<span class="pr-star">★</span> ' : ""}${esc(l.lift)} — ${l.weight} kg × ${l.reps} @ RPE ${l.rpe}</span>
        <span class="e1rm-badge">e1RM ${l.e1rm.toFixed(1)} kg</span>
      </div>
      <div class="row-sub">${fmtDate(l.date)}${l.note ? ` · “${esc(l.note)}”` : ""}</div>
    </li>`).join("");
  $("history-empty").hidden = rows.length > 0;
}

/* ================================================================
   SECTION 4 — DEEP WORK (persisted in localStorage)
   ================================================================ */
let dwLog = load("dash.deepwork", []); // { id, ts, minutes, type }
let timer = { running: false, endTs: 0, startTs: 0, plannedMin: 25, interval: null };
let selectedMin = 25;

const DW_TYPES = [
  { key: "mit", label: "MIT" },
  { key: "secondary", label: "Secondary" },
  { key: "admin", label: "Household Admin" },
];
const DW_TYPE_LABEL = Object.fromEntries(DW_TYPES.map(t => [t.key, t.label]));
let selectedType = "mit";

$("type-select").addEventListener("click", (e) => {
  const chip = e.target.closest(".type-chip");
  if (!chip) return;
  selectedType = chip.dataset.type;
  $("type-select").querySelectorAll(".type-chip").forEach(c => c.classList.toggle("active", c === chip));
});

$("duration-presets").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  selectedMin = parseInt(chip.dataset.min, 10);
  $("custom-min").value = "";
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === chip));
  if (!timer.running) renderTimerDisplay(selectedMin * 60);
});
$("custom-min").addEventListener("input", () => {
  const v = parseInt($("custom-min").value, 10);
  if (v > 0) {
    selectedMin = Math.min(240, v);
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    if (!timer.running) renderTimerDisplay(selectedMin * 60);
  }
});
document.querySelector('.chip[data-min="25"]').classList.add("active");

const RING_CIRCUMFERENCE = 2 * Math.PI * 44; // r=44 in the 100x100 viewBox

function renderTimerDisplay(totalSeconds, fraction) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.max(0, Math.round(totalSeconds % 60));
  $("timer-display").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  // fraction = proportion elapsed (0 = just started, 1 = done); the ring fills as it runs
  const f = fraction === undefined ? 0 : Math.min(1, Math.max(0, fraction));
  $("ring-progress").setAttribute("stroke-dashoffset", (RING_CIRCUMFERENCE * (1 - f)).toFixed(2));
}

function tick() {
  const totalMs = timer.plannedMin * 60000;
  const remainMs = Math.max(0, timer.endTs - Date.now());
  renderTimerDisplay(remainMs / 1000, 1 - remainMs / totalMs);
  if (remainMs <= 0) finishSession(timer.plannedMin);
}

$("timer-start").addEventListener("click", () => {
  timer.plannedMin = selectedMin;
  timer.startTs = Date.now();
  timer.endTs = timer.startTs + selectedMin * 60000;
  timer.running = true;
  timer.interval = setInterval(tick, 250);
  $("timer-start").hidden = true;
  $("timer-stop").hidden = false;
  $("timer-display").classList.add("running");
  $("timer-display").classList.remove("finished");
  $("timer-hint").textContent = `Deep work until ${fmtTime(timer.endTs)}. Keep the tab open.`;
});

$("timer-stop").addEventListener("click", () => {
  const elapsedMin = (Date.now() - timer.startTs) / 60000;
  stopTimerUI();
  if (elapsedMin >= 1) {
    recordSession(Math.round(elapsedMin));
    $("timer-hint").textContent = `Stopped early — logged ${Math.round(elapsedMin)} min.`;
  } else {
    $("timer-hint").textContent = "Stopped — under a minute, nothing logged.";
  }
  if (elapsedMin >= 1) toast(`Stopped early · ${Math.round(elapsedMin)} min logged`);
  renderTimerDisplay(selectedMin * 60);
});

function finishSession(minutes) {
  stopTimerUI();
  recordSession(minutes);
  $("timer-display").classList.add("finished");
  $("timer-hint").textContent = `Session complete — ${minutes} min logged. Nice work.`;
  buzz([200, 100, 200]);
  toast(`✅ ${minutes} min ${DW_TYPE_LABEL[selectedType]} complete`, true);
  renderTimerDisplay(0, 1);
}

function stopTimerUI() {
  clearInterval(timer.interval);
  timer.running = false;
  $("timer-start").hidden = false;
  $("timer-stop").hidden = true;
  $("timer-display").classList.remove("running");
}

function recordSession(minutes) {
  dwLog.push({ id: Date.now(), ts: Date.now(), minutes, type: selectedType });
  save("dash.deepwork", dwLog);
  renderDeepWork();
}

function dwInRange(fromDate) {
  return dwLog.filter(s => s.ts >= fromDate.getTime());
}
function sumMin(sessions) { return sessions.reduce((a, s) => a + s.minutes, 0); }
function fmtHours(min) {
  const h = min / 60;
  return h >= 10 ? `${h.toFixed(0)}h` : `${h.toFixed(1)}h`;
}

function streakDays() {
  const daysWithWork = new Set(dwLog.map(s => startOfDay(new Date(s.ts)).getTime()));
  let streak = 0;
  let d = startOfDay().getTime();
  // today counts if worked; otherwise streak counts back from yesterday
  if (!daysWithWork.has(d)) d -= DAY;
  while (daysWithWork.has(d)) { streak++; d -= DAY; }
  return streak;
}

/* average weekly minutes over the `numWeeks` full weeks immediately before the current week */
function priorWeeksAvg(numWeeks = 4) {
  const ws = startOfWeek().getTime();
  let total = 0;
  for (let i = 1; i <= numWeeks; i++) {
    const d0 = ws - i * 7 * DAY;
    const d1 = d0 + 7 * DAY;
    total += sumMin(dwLog.filter(s => s.ts >= d0 && s.ts < d1));
  }
  return total / numWeeks;
}

function renderDeepWork() {
  const today = dwInRange(startOfDay());
  const week = dwInRange(startOfWeek());
  const month = dwInRange(startOfMonth());

  $("dw-today-n").textContent = today.length;
  $("dw-week-n").textContent = week.length;
  $("dw-month-n").textContent = month.length;
  const weekMin = sumMin(week);
  $("dw-today-h").textContent = fmtHours(sumMin(today));
  $("dw-week-h").textContent = fmtHours(weekMin);
  $("dw-month-h").textContent = fmtHours(sumMin(month));

  // weekly score: this week's minutes as a percentage of the trailing 4-week average
  const avgPrior = priorWeeksAvg(4);
  const scorePill = $("dw-score-pill");
  if (avgPrior <= 0) {
    $("dw-score").textContent = weekMin > 0 ? "New" : "—";
    scorePill.title = weekMin > 0
      ? "No sessions in the prior 4 weeks to compare against yet."
      : "Log a session to start tracking your weekly score.";
  } else {
    const pct = Math.round((weekMin / avgPrior) * 100);
    $("dw-score").textContent = `${pct}%`;
    scorePill.title = `This week: ${weekMin} min · 4-week avg: ${Math.round(avgPrior)} min`;
  }

  // motivation
  const streak = streakDays();
  let msg = "";
  if (week.length === 0) msg = "No sessions yet this week — start with just 25 minutes.";
  else if (streak >= 3) msg = `🔥 ${streak}-day streak and ${week.length} session${week.length > 1 ? "s" : ""} this week — exceptional consistency!`;
  else if (week.length >= 3) msg = `${week.length} sessions this week — stay on track!`;
  else msg = `${week.length} session${week.length > 1 ? "s" : ""} this week — one more today keeps momentum going.`;
  $("dw-motivate").textContent = msg;

  renderTypeBreakdown(week);
  renderDwWeekChart();
  renderDwLog();
  renderRewards(); // the vinyl fund depends on this week's deep-work total
}

function typeOf(s) {
  return DW_TYPE_LABEL[s.type] ? s.type : "other";
}

function renderTypeBreakdown(week) {
  $("type-breakdown").innerHTML = DW_TYPES.map(t => {
    const sessions = week.filter(s => typeOf(s) === t.key);
    return `<div class="type-pill ${t.key}">
      <span class="stat-num">${sessions.length}</span>
      <span class="stat-label">${esc(t.label)} · ${fmtHours(sumMin(sessions))}</span>
    </div>`;
  }).join("");
}

function renderDwWeekChart() {
  const ws = startOfWeek();
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayBuckets = days.map((_, i) => {
    const d0 = ws.getTime() + i * DAY, d1 = d0 + DAY;
    const sessions = dwLog.filter(s => s.ts >= d0 && s.ts < d1);
    const byType = {};
    for (const t of [...DW_TYPES.map(t => t.key), "other"]) {
      byType[t] = sumMin(sessions.filter(s => typeOf(s) === t));
    }
    return byType;
  });
  const totals = dayBuckets.map(b => Object.values(b).reduce((a, v) => a + v, 0));
  const W = 520, H = 180, padL = 34, padR = 8, padT = 16, padB = 28;
  const maxV = Math.max(60, ...totals);
  const slot = (W - padL - padR) / 7;
  const bwidth = Math.min(38, slot * 0.6); // cap thickness — never fill the slot
  const GAP = 3;    // 2px surface gap between stacked segments (viewBox units)
  const R = 6;      // 4px rounded data-end at the top of the stack
  const plotH = H - padT - padB;
  const todayIdx = Math.floor((startOfDay().getTime() - ws.getTime()) / DAY);
  const stackOrder = ["mit", "secondary", "admin", "other"];

  // top segment gets rounded top corners, square at the baseline
  const roundedTop = (x, y, w, h, r) => {
    const rr = Math.min(r, h, w / 2);
    return `M${x},${(y + h).toFixed(1)} L${x},${(y + rr).toFixed(1)} Q${x},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)} ` +
           `L${(x + w - rr).toFixed(1)},${y.toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)} ` +
           `L${(x + w).toFixed(1)},${(y + h).toFixed(1)} Z`;
  };

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  // recessive gridlines
  for (let g = 1; g <= 2; g++) {
    const gy = padT + (g / 2) * plotH;
    svg += `<line class="chart-grid" x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}"/>`;
  }
  svg += `<line class="chart-axis" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>`;
  svg += `<text class="chart-label" x="${padL - 8}" y="${padT + 4}" text-anchor="end">${maxV}m</text>`;

  dayBuckets.forEach((byType, i) => {
    const cx = padL + i * slot + slot / 2;
    const bx = cx - bwidth / 2;
    const present = stackOrder.filter(k => byType[k] > 0);
    let yCursor = H - padB;

    present.forEach((key, si) => {
      const rawH = (byType[key] / maxV) * plotH;
      const isTop = si === present.length - 1;
      // reserve the surface gap above every segment except the topmost
      const segH = Math.max(4, rawH - (isTop ? 0 : GAP));
      yCursor -= segH;
      svg += isTop
        ? `<path class="chart-bar ${key}" d="${roundedTop(bx, yCursor, bwidth, segH, R)}"/>`
        : `<rect class="chart-bar ${key}" x="${bx.toFixed(1)}" y="${yCursor.toFixed(1)}" width="${bwidth.toFixed(1)}" height="${segH.toFixed(1)}"/>`;
      yCursor -= isTop ? 0 : GAP;
    });

    svg += `<text class="chart-label${i === todayIdx ? " today" : ""}" x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle">${days[i]}</text>`;
    if (totals[i] > 0) {
      svg += `<text class="chart-value" x="${cx.toFixed(1)}" y="${(yCursor - 6).toFixed(1)}" text-anchor="middle">${totals[i]}</text>`;
    }
    svg += `<rect class="chart-hit" data-i="${i}" x="${(padL + i * slot).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH.toFixed(1)}"/>`;
  });
  svg += `</svg>`;
  $("dw-week-chart").innerHTML = svg;
  $("chart-legend").innerHTML = DW_TYPES.map(t =>
    `<span class="legend-item"><span class="legend-dot ${t.key}"></span>${esc(t.label)}</span>`
  ).join("");

  const tip = $("dw-tip");
  const weekTotal = totals.reduce((a, v) => a + v, 0);
  tip.innerHTML = weekTotal
    ? `<strong>${fmtHours(weekTotal)}</strong> this week · tap a day for the split`
    : "Tap a day for its breakdown";
  $("dw-week-chart").querySelectorAll(".chart-hit").forEach(hit => {
    hit.addEventListener("click", () => {
      const i = +hit.dataset.i;
      const b = dayBuckets[i];
      if (!totals[i]) { tip.innerHTML = `<strong>${days[i]}</strong> · no sessions`; return; }
      const parts = DW_TYPES.filter(t => b[t.key] > 0).map(t => `${t.label} ${b[t.key]}m`);
      if (b.other > 0) parts.push(`Other ${b.other}m`);
      tip.innerHTML = `<strong>${days[i]} · ${totals[i]}m</strong> — ${parts.join(" · ")}`;
    });
  });
}

function renderDwLog() {
  const rows = [...dwLog].sort((a, b) => b.ts - a.ts).slice(0, 15);
  $("dw-log").innerHTML = rows.map(s => {
    const key = typeOf(s);
    const label = DW_TYPE_LABEL[s.type] || "Other";
    return `
    <li>
      <div class="row-main">
        <span>${s.minutes} min <span class="type-tag ${key}">${esc(label)}</span></span>
        <span class="row-sub">${new Date(s.ts).toLocaleDateString([], { day: "numeric", month: "short" })} ${fmtTime(s.ts)}</span>
      </div>
    </li>`;
  }).join("");
  $("dw-empty").hidden = rows.length > 0;
}

/* ================================================================
   SECTION 6 — JUMP (Doodle Jump, rebuilt from an REA model)

   The original was reverse-engineered by watching how it behaves, not
   by decompiling it, and the observations were sorted into McCarthy's
   REA model (Resources, Events, Agents). The model decides how this
   section is split up:
   - RESOURCES are the quantities that events move: altitude (the score),
     upward momentum, platforms, boosters, and the doodler's one life.
   - EVENTS come in give/get pairs, which REA calls "duality". A bounce
     spends a foothold to get momentum. Climbing spends momentum to get
     altitude. A jetpack spends itself to get thrust. Every run keeps a
     ledger of these events, and it's shown when the run ends.
   - AGENTS take part in events: the player (input), the doodler (the
     avatar), the generator (lays platforms) and the monsters.
   The full model, and how each constant was chosen, is in docs/jump-rea.md.
   ================================================================ */
const JUMP = {
  W: 320,                 // world width in units; the original iPhone screen was 320pt
  GRAVITY: 1200,          // units/s²
  BOUNCE_V: 600,          // apex v²/2g = 150 units, about a third of the screen
  SPRING_V: 1000,         // apex ≈ 417 units, a bit under three normal jumps
  BOOSTERS: {
    propeller: { v: 480, secs: 2.5 },
    jetpack:   { v: 860, secs: 3.0 },
  },
  MAX_VX: 380,            // crosses the screen in under a second
  STEER_RATE: 10,         // how quickly vx closes on the target speed (1/s)
  CAMERA_LINE: 0.42,      // the camera follows once the doodler rises above this
  PLAT_W: 58, PLAT_H: 14,
  BODY_W: 40, BODY_H: 40,
  BULLET_V: 900, SHOT_GAP: 0.18,
  REACH: 0.85,            // a usable gap never exceeds this share of a normal jump
  FULL_DIFFICULTY: 25000, // altitude where the difficulty ramp tops out
};
const JUMP_APEX = JUMP.BOUNCE_V ** 2 / (2 * JUMP.GRAVITY); // 150
const JUMP_STEP = 1 / 120; // fixed physics step, so a slow frame can't tunnel through a platform
const JUMP_ITEM = {
  spring:    { w: 16, h: 12 },
  propeller: { w: 26, h: 16 },
  jetpack:   { w: 24, h: 28 },
};
const JUMP_INK = {
  paper: "#11151d", grid: "rgba(255,255,255,.045)",
  static: "#34d399", moving: "#4f8cff", vanish: "#e6e9f2", brown: "#a8754a",
  body: "#c9df4c", trunks: "#6f8f1e", outline: "#26300c",
  hover: "#8b5cf6", patrol: "#ff5f70",
};

let jumpData = load("dash.jump", { best: 0, runs: [] }); // runs: [{ ts, score, cause, ledger }]
let jumpSteerMode = load("dash.jumpsteer", "touch");      // "touch" | "tilt"
let jumpState = null;
let jumpView = null; // { cssW, cssH, dpr, scale }
let jumpRaf = 0, jumpLastTs = 0, jumpAcc = 0;
const jumpInput = { left: false, right: false, tilt: null, pointers: new Map() };
let jumpTiltListening = false;

/* ---------- geometry (the screen wraps left to right) ---------- */
function jumpSpanOverlap(a0, aw, b0, bw) {
  for (const off of [0, -JUMP.W, JUMP.W]) {
    if (a0 + off < b0 + bw && a0 + off + aw > b0) return true;
  }
  return false;
}
function jumpBoxHit(ax, ay, aw, ah, bx, by, bw, bh) {
  return ay < by + bh && ay + ah > by && jumpSpanOverlap(ax, aw, bx, bw);
}
function jumpBob(m, t) {
  return m.kind === "hover" && !m.dead ? Math.sin(t * 2.4 + m.phase) * 5 : 0;
}

/* ---------- agent: the generator ----------
   Lays one platform the doodler can stand on per step, so the climbable
   path is explicit. The gap to it is capped at REACH × a normal jump,
   which is what makes every run climbable. Brown platforms are decoys in
   the gaps and never count as the path. Difficulty is a function of
   altitude only, so a slow climber gets the same course as a fast one. */
function jumpPlatform(type, x, y) {
  return { type, x, y, w: JUMP.PLAT_W, h: JUMP.PLAT_H, vx: 0, item: null,
           broken: false, vy: 0, rot: 0, gone: false, fade: 1 };
}

function jumpSpawnStep(s) {
  const g = s.gen;
  const alt = s.startFeet - g.nextY;
  const d = Math.min(1, alt / JUMP.FULL_DIFFICULTY);
  const reach = JUMP_APEX * JUMP.REACH;
  const gap = Math.min(reach, Math.max(g.minGap, (38 + 80 * d) * (0.75 + Math.random() * 0.5)));
  const y = g.nextY - gap;
  const afterMonster = g.minGap > 0;
  g.minGap = 0;

  const pMoving = alt < 1500 ? 0 : 0.1 + 0.35 * d;
  const pVanish = alt < 4000 ? 0 : 0.05 + 0.15 * d;
  const r = Math.random();
  const type = r < pMoving ? "moving" : r < pMoving + pVanish ? "vanish" : "static";
  const pl = jumpPlatform(type, Math.random() * (JUMP.W - JUMP.PLAT_W), y);
  if (type === "moving") pl.vx = (40 + 90 * d) * (Math.random() < 0.5 ? -1 : 1);
  if (type !== "vanish" && alt > 300) {
    const ir = Math.random();
    const kind = ir < 0.006 ? "jetpack"
      : ir < 0.018 ? "propeller"
      : ir < 0.018 + 0.07 - 0.03 * d ? "spring" : null;
    if (kind) pl.item = { kind, dx: 6 + Math.random() * (JUMP.PLAT_W - 12 - JUMP_ITEM[kind].w), used: 0 };
  }
  s.platforms.push(pl);

  if (!afterMonster && alt > 800 && gap > 50 && Math.random() < 0.12 + 0.25 * d) {
    s.platforms.push(jumpPlatform("brown", Math.random() * (JUMP.W - JUMP.PLAT_W),
                                  y + gap * (0.35 + Math.random() * 0.3)));
  }

  // monsters: spaced out, and parked on the other half from the platform
  // just laid, so going straight up from it never runs into one
  if (alt > 2500 && g.lastMonsterY - y > 700 && Math.random() < 0.035 + 0.06 * d) {
    const kind = alt > 6000 && Math.random() < 0.5 ? "patrol" : "hover";
    const w = 48, h = 34, half = JUMP.W / 2;
    const x = pl.x + pl.w / 2 < half ? half + Math.random() * (half - w) : Math.random() * (half - w);
    const vx = kind === "patrol" ? (50 + 50 * d) * (Math.random() < 0.5 ? -1 : 1) : 0;
    s.monsters.push({ kind, x, y: y - h - 26, w, h, vx, phase: Math.random() * 6.28, dead: false, vy: 0, rot: 0 });
    g.lastMonsterY = y;
    g.minGap = h + 48; // keep the next platform clear of it, bob included
  }
  g.nextY = y;
}

function jumpFill(s) {
  while (s.gen.nextY > s.camY - 140) jumpSpawnStep(s);
}

function jumpNewWorld() {
  const viewH = jumpView ? JUMP.W * jumpView.cssH / jumpView.cssW : 480;
  const groundY = -30;
  const s = {
    mode: "ready", viewH, camY: -viewH, t: 0,
    doodler: { x: JUMP.W / 2 - JUMP.BODY_W / 2, y: groundY - JUMP.BODY_H, w: JUMP.BODY_W, h: JUMP.BODY_H,
               vx: 0, vy: 0, face: 1, boost: null, stunned: false, shootT: 0, squash: 0 },
    platforms: [jumpPlatform("static", JUMP.W / 2 - JUMP.PLAT_W / 2, groundY)],
    monsters: [], bullets: [],
    gen: { nextY: groundY, lastMonsterY: 0, minGap: 0 },
    startFeet: groundY, score: 0, shotCooldown: 0, fallT: -1, cause: null,
    // the run's REA ledger: one counter per kind of event
    ledger: { bounces: 0, springs: 0, boosters: 0, broken: 0, stomped: 0, shot: 0 },
  };
  jumpFill(s);
  return s;
}

/* ---------- agent: the player ---------- */
function jumpSteerValue() {
  const keys = (jumpInput.right ? 1 : 0) - (jumpInput.left ? 1 : 0);
  if (keys) return keys;
  if (jumpSteerMode === "tilt") {
    const t = jumpInput.tilt;
    if (t == null || Math.abs(t) < 1.5) return 0;
    return Math.max(-1, Math.min(1, t / 20));
  }
  let sum = 0;
  for (const z of jumpInput.pointers.values()) sum += z;
  return Math.max(-1, Math.min(1, sum));
}

function jumpOnTilt(e) {
  if (e.gamma == null) return;
  const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  jumpInput.tilt = angle === 90 ? e.beta
    : angle === -90 || angle === 270 ? -e.beta
    : angle === 180 ? -e.gamma : e.gamma;
}

/* iOS only hands over motion data after a tap asks for it */
async function jumpEnableTilt() {
  if (typeof DeviceOrientationEvent === "undefined") {
    toast("This device doesn't report tilt");
    return false;
  }
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      if (await DeviceOrientationEvent.requestPermission() !== "granted") {
        toast("Motion access was declined — using touch");
        return false;
      }
    } catch {
      toast("Couldn't get motion access — using touch");
      return false;
    }
  }
  if (!jumpTiltListening) {
    window.addEventListener("deviceorientation", jumpOnTilt);
    jumpTiltListening = true;
  }
  return true;
}

/* ---------- events ---------- */
// bounce: give a foothold (white platforms are single-use), get momentum.
// A brown platform takes the foothold and gives nothing back.
function jumpLand(s, pl) {
  const p = s.doodler, L = s.ledger;
  if (pl.type === "brown") {
    pl.broken = true;
    L.broken++;
    return;
  }
  p.y = pl.y - p.h;
  const it = pl.item;
  if (it && it.kind === "spring" && jumpSpanOverlap(p.x + 9, p.w - 18, pl.x + it.dx, JUMP_ITEM.spring.w)) {
    p.vy = -JUMP.SPRING_V;
    it.used = 0.25;
    L.springs++;
  } else {
    p.vy = -JUMP.BOUNCE_V;
    L.bounces++;
  }
  p.squash = 0.12;
  if (pl.type === "vanish") pl.gone = true;
}

// shoot: free ammo, rate-limited. Aim leans toward the tap, within ±35°.
function jumpShoot(tx, ty) {
  const s = jumpState;
  if (!s || s.mode !== "playing" || s.doodler.stunned || s.fallT >= 0 || s.shotCooldown > 0) return;
  const p = s.doodler;
  const ox = p.x + p.w / 2, oy = p.y;
  let th = 0; // radians from straight up
  if (tx != null) th = Math.max(-0.6, Math.min(0.6, Math.atan2(tx - ox, oy - ty)));
  s.bullets.push({ x: ox, y: oy, vx: Math.sin(th) * JUMP.BULLET_V, vy: -Math.cos(th) * JUMP.BULLET_V });
  s.shotCooldown = JUMP.SHOT_GAP;
  p.shootT = 0.25;
}

// hit by a monster: give the one life, get nothing. The run ends once
// the doodler has dropped off the bottom.
function jumpStun(s) {
  const p = s.doodler;
  p.stunned = true;
  p.boost = null;
  p.vx = 0;
  p.vy = Math.max(p.vy, 120);
  s.cause = "monster";
  buzz(60);
}

function jumpUpdate(s, dt) {
  s.t += dt;
  const p = s.doodler, L = s.ledger;
  const prevFeet = p.y + p.h;

  if (!p.stunned) {
    const steer = jumpSteerValue();
    p.vx += (steer * JUMP.MAX_VX - p.vx) * Math.min(1, JUMP.STEER_RATE * dt);
    if (Math.abs(steer) > 0.15) p.face = steer > 0 ? 1 : -1;
  }
  p.x += p.vx * dt;
  const cx = p.x + p.w / 2;
  if (cx < 0) p.x += JUMP.W;
  else if (cx >= JUMP.W) p.x -= JUMP.W;

  // climb: gravity spends momentum, height is what it buys. A booster
  // replaces gravity with steady thrust until it runs out.
  if (p.boost) {
    p.vy = -JUMP.BOOSTERS[p.boost.kind].v;
    if ((p.boost.left -= dt) <= 0) p.boost = null;
  } else {
    p.vy += JUMP.GRAVITY * dt;
  }
  p.y += p.vy * dt;
  p.shootT = Math.max(0, p.shootT - dt);
  p.squash = Math.max(0, p.squash - dt);
  s.shotCooldown = Math.max(0, s.shotCooldown - dt);

  for (const pl of s.platforms) {
    if (pl.vx && !pl.broken) {
      pl.x += pl.vx * dt;
      if (pl.x < 0) { pl.x = 0; pl.vx = -pl.vx; }
      else if (pl.x > JUMP.W - pl.w) { pl.x = JUMP.W - pl.w; pl.vx = -pl.vx; }
    }
    if (pl.broken) { pl.vy += JUMP.GRAVITY * dt; pl.y += pl.vy * dt; pl.rot += dt * 3; }
    if (pl.gone) pl.fade = Math.max(0, pl.fade - dt * 4);
    if (pl.item && pl.item.used) pl.item.used = Math.max(0, pl.item.used - dt);
  }
  for (const m of s.monsters) {
    if (m.dead) { m.vy += JUMP.GRAVITY * dt; m.y += m.vy * dt; m.rot += dt * 4; continue; }
    if (m.vx) {
      m.x += m.vx * dt;
      if (m.x < 0) { m.x = 0; m.vx = -m.vx; }
      else if (m.x > JUMP.W - m.w) { m.x = JUMP.W - m.w; m.vx = -m.vx; }
    }
  }
  for (const b of s.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    for (const m of s.monsters) {
      if (m.dead) continue;
      const my = m.y + jumpBob(m, s.t);
      if (b.x > m.x && b.x < m.x + m.w && b.y > my && b.y < my + m.h) {
        m.dead = true;
        b.spent = true;
        L.shot++;
        break;
      }
    }
  }
  s.bullets = s.bullets.filter(b => !b.spent && b.y > s.camY - 30 && b.x > -20 && b.x < JUMP.W + 20);

  if (!p.stunned) {
    // platforms are one-way: they only catch the doodler on the way down
    if (p.vy > 0) {
      const feet = p.y + p.h;
      for (const pl of s.platforms) {
        if (pl.broken || pl.gone || prevFeet > pl.y || feet < pl.y) continue;
        if (!jumpSpanOverlap(p.x + 9, p.w - 18, pl.x, pl.w)) continue;
        jumpLand(s, pl);
        break;
      }
    }
    // pick up a booster: give the item, get thrust for a few seconds
    for (const pl of s.platforms) {
      const it = pl.item;
      if (!it || it.kind === "spring" || pl.broken) continue;
      const sz = JUMP_ITEM[it.kind];
      if (jumpBoxHit(p.x + 6, p.y + 4, p.w - 12, p.h - 8, pl.x + it.dx, pl.y - sz.h, sz.w, sz.h)) {
        p.boost = { kind: it.kind, left: JUMP.BOOSTERS[it.kind].secs };
        pl.item = null;
        L.boosters++;
      }
    }
    // monsters: landing on one from above is a stomp, anything else costs
    // the life. A booster flies straight through them.
    for (const m of s.monsters) {
      if (m.dead || p.boost) continue;
      const my = m.y + jumpBob(m, s.t);
      if (!jumpBoxHit(p.x + 6, p.y + 4, p.w - 12, p.h - 6, m.x + 4, my + 4, m.w - 8, m.h - 8)) continue;
      if (p.vy > 0 && prevFeet <= my + 14) {
        m.dead = true;
        L.stomped++;
        p.vy = -JUMP.BOUNCE_V;
        p.squash = 0.12;
      } else {
        jumpStun(s);
      }
      break;
    }
  }

  if (s.fallT < 0) {
    // the camera only ever moves up; what drops below the screen is gone
    const line = s.camY + s.viewH * JUMP.CAMERA_LINE;
    if (p.y < line) s.camY = p.y - s.viewH * JUMP.CAMERA_LINE;
    s.score = Math.max(s.score, Math.round(s.startFeet - (p.y + p.h)));
    jumpFill(s);
    const floor = s.camY + s.viewH + 60;
    s.platforms = s.platforms.filter(pl => pl.y < floor && !(pl.gone && pl.fade <= 0));
    s.monsters = s.monsters.filter(m => m.y < floor);
    if (p.y > s.camY + s.viewH) {
      s.fallT = 0;
      if (!s.cause) s.cause = "fell";
    }
  } else {
    // the fall: the camera chases the doodler down past everything, then the run ends
    s.fallT += dt;
    s.camY += (p.y - s.viewH * 0.55 - s.camY) * Math.min(1, 8 * dt);
    if (s.fallT > 0.9) jumpGameOver(s);
  }
}

/* ---------- drawing ---------- */
function jumpRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function jumpDrawPlatform(ctx, pl) {
  ctx.save();
  if (pl.gone) ctx.globalAlpha = pl.fade;
  ctx.fillStyle = JUMP_INK[pl.type];
  ctx.strokeStyle = "rgba(0,0,0,.4)";
  ctx.lineWidth = 1.5;
  if (pl.broken) {
    // the two halves tumble apart
    const hw = pl.w / 2;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(pl.x + hw + side * (hw / 2 + pl.rot * 8), pl.y + pl.h / 2);
      ctx.rotate(side * pl.rot);
      jumpRoundRect(ctx, -hw / 2, -pl.h / 2, hw - 2, pl.h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else {
    jumpRoundRect(ctx, pl.x, pl.y, pl.w, pl.h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.3)";
    ctx.fillRect(pl.x + 7, pl.y + 3, pl.w - 14, 2);
    if (pl.type === "brown") {
      ctx.strokeStyle = "rgba(40,20,5,.7)";
      ctx.beginPath();
      ctx.moveTo(pl.x + pl.w / 2 - 3, pl.y + 2);
      ctx.lineTo(pl.x + pl.w / 2 + 2, pl.y + 7);
      ctx.lineTo(pl.x + pl.w / 2 - 2, pl.y + pl.h - 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (pl.item && !pl.broken) jumpDrawItem(ctx, pl);
}

function jumpDrawItem(ctx, pl) {
  const it = pl.item, sz = JUMP_ITEM[it.kind];
  const x = pl.x + it.dx;
  ctx.save();
  ctx.lineWidth = 1.5;
  if (it.kind === "spring") {
    const h = it.used ? 7 : sz.h;
    const top = pl.y - h;
    ctx.strokeStyle = "#b8bfcf";
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) ctx.lineTo(x + (i % 2 ? sz.w - 2 : 2), top + 2 + (h - 4) * i / 4);
    ctx.stroke();
    ctx.fillStyle = "#dfe4ee";
    ctx.fillRect(x, top, sz.w, 2.5);
  } else if (it.kind === "propeller") {
    const top = pl.y - sz.h;
    ctx.fillStyle = "#ff9f45";
    ctx.beginPath();
    ctx.arc(x + sz.w / 2, pl.y - 1, sz.w / 2 - 2, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#4f8cff";
    ctx.fillRect(x + sz.w / 2 - 1, top + 2, 2, 4);
    ctx.fillRect(x + 2, top, sz.w - 4, 2.5);
  } else {
    const top = pl.y - sz.h;
    ctx.fillStyle = "#9aa3b5";
    jumpRoundRect(ctx, x + 1, top, 9, sz.h - 4, 4); ctx.fill();
    jumpRoundRect(ctx, x + sz.w - 10, top, 9, sz.h - 4, 4); ctx.fill();
    ctx.fillStyle = "#ff9f45";
    ctx.fillRect(x + 3, pl.y - 5, 5, 4);
    ctx.fillRect(x + sz.w - 8, pl.y - 5, 5, 4);
  }
  ctx.restore();
}

function jumpDrawMonster(ctx, m, t) {
  const y = m.y + jumpBob(m, t);
  ctx.save();
  ctx.translate(m.x + m.w / 2, y + m.h / 2);
  if (m.dead) { ctx.rotate(m.rot); ctx.globalAlpha = 0.7; }
  ctx.fillStyle = JUMP_INK[m.kind];
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = 1.5;
  if (m.kind === "hover") {
    const flap = Math.sin(t * 14 + m.phase) * 5;
    ctx.beginPath(); ctx.ellipse(-25, -4 + flap, 9, 5, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(25, -4 + flap, 9, 5, 0.4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    for (const lx of [-15, -5, 5, 15]) {
      const kick = Math.sin(t * 12 + lx) * 3;
      ctx.moveTo(lx, 10); ctx.lineTo(lx + kick, 19);
    }
    ctx.strokeStyle = JUMP_INK.patrol; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 1.5;
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, m.w / 2 - 4, m.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // eyes
  ctx.fillStyle = "#fff";
  const eyes = m.kind === "hover" ? [-8, 8] : [0];
  for (const ex of eyes) { ctx.beginPath(); ctx.arc(ex, -4, m.kind === "hover" ? 5 : 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#11151d";
  for (const ex of eyes) { ctx.beginPath(); ctx.arc(ex + 1, -3, m.kind === "hover" ? 2.2 : 3, 0, Math.PI * 2); ctx.fill(); }
  // teeth
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(i * 5 - 2.5, 7); ctx.lineTo(i * 5, 11); ctx.lineTo(i * 5 + 2.5, 7); }
  ctx.fill();
  ctx.restore();
}

function jumpDrawDoodler(ctx, s, x) {
  const p = s.doodler, ink = JUMP_INK;
  ctx.save();
  ctx.translate(x + p.w / 2, p.y + p.h); // origin at the feet
  const sq = p.squash / 0.12;
  ctx.scale(1 + 0.12 * sq, 1 - 0.14 * sq);
  const up = p.shootT > 0;
  if (p.face < 0 && !up) ctx.scale(-1, 1);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (p.boost && p.boost.kind === "jetpack") {
    const flame = 8 + Math.random() * 6;
    ctx.fillStyle = "#ffc247";
    ctx.beginPath(); ctx.moveTo(-23, -12); ctx.lineTo(-19, -12 + flame); ctx.lineTo(-15, -12); ctx.fill();
    ctx.fillStyle = "#9aa3b5";
    jumpRoundRect(ctx, -24, -34, 9, 22, 4); ctx.fill();
  }

  ctx.strokeStyle = ink.outline;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (const lx of [-10, -3, 4, 11]) { ctx.moveTo(lx, -8); ctx.lineTo(lx, -1); ctx.lineTo(lx + 3, -1); }
  ctx.stroke();

  ctx.fillStyle = ink.body;
  ctx.beginPath();
  ctx.moveTo(-15, -8);
  ctx.lineTo(-15, -26);
  ctx.quadraticCurveTo(-15, -40, 0, -40);
  ctx.quadraticCurveTo(15, -40, 15, -26);
  ctx.lineTo(15, -8);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = ink.trunks;
  ctx.fillRect(-16, -15, 32, 8);
  ctx.strokeStyle = ink.body;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let sx = -11; sx <= 11; sx += 5.5) { ctx.moveTo(sx, -15); ctx.lineTo(sx, -7); }
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // snout: points the way it faces, or straight up while shooting
  ctx.fillStyle = ink.body;
  if (up) {
    jumpRoundRect(ctx, -4, -52, 8, 15, 3);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -52, 5, 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    jumpRoundRect(ctx, 11, -31, 14, 8, 3);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(25, -27, 2, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = ink.outline;
  const eyes = up ? [[-5, -31], [5, -31]] : [[2, -30], [8, -30]];
  for (const [ex, ey] of eyes) { ctx.beginPath(); ctx.arc(ex, ey, 1.9, 0, Math.PI * 2); ctx.fill(); }

  if (p.boost && p.boost.kind === "propeller") {
    ctx.fillStyle = "#ff9f45";
    ctx.beginPath(); ctx.arc(0, -39, 10, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#4f8cff";
    const blade = 16 * Math.abs(Math.cos(s.t * 30));
    ctx.fillRect(-1, -54, 2, 6);
    ctx.fillRect(-blade, -55, blade * 2, 2.5);
  }
  if (p.stunned) {
    ctx.fillStyle = "#ffc247";
    for (let k = 0; k < 3; k++) {
      const a = s.t * 6 + k * 2.094;
      ctx.beginPath(); ctx.arc(Math.cos(a) * 14, -47 + Math.sin(a) * 4, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function jumpDraw() {
  const s = jumpState, v = jumpView;
  if (!s || !v) return;
  const ctx = $("jump-canvas").getContext("2d");
  ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, 0, 0);

  // graph paper that scrolls with the world
  ctx.fillStyle = JUMP_INK.paper;
  ctx.fillRect(0, 0, JUMP.W, s.viewH);
  ctx.strokeStyle = JUMP_INK.grid;
  ctx.lineWidth = 1 / v.scale;
  ctx.beginPath();
  for (let gx = 20; gx < JUMP.W; gx += 20) { ctx.moveTo(gx, 0); ctx.lineTo(gx, s.viewH); }
  for (let gy = -(((s.camY % 20) + 20) % 20); gy < s.viewH; gy += 20) { ctx.moveTo(0, gy); ctx.lineTo(JUMP.W, gy); }
  ctx.stroke();

  ctx.save();
  ctx.translate(0, -s.camY);
  // your best so far, marked at the height you reached it
  if (jumpData.best > 0) {
    const by = s.startFeet - jumpData.best;
    if (by > s.camY && by < s.camY + s.viewH) {
      ctx.strokeStyle = "rgba(244,114,182,.55)";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(JUMP.W, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(244,114,182,.85)";
      ctx.font = "800 10px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("BEST", JUMP.W - 6, by - 4);
    }
  }
  for (const pl of s.platforms) jumpDrawPlatform(ctx, pl);
  for (const m of s.monsters) jumpDrawMonster(ctx, m, s.t);
  ctx.fillStyle = "#eef0f6";
  for (const b of s.bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
  const p = s.doodler;
  jumpDrawDoodler(ctx, s, p.x);
  if (p.x < 6) jumpDrawDoodler(ctx, s, p.x + JUMP.W);
  if (p.x + p.w > JUMP.W - 6) jumpDrawDoodler(ctx, s, p.x - JUMP.W);
  ctx.restore();

  // HUD
  ctx.font = "800 22px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillText(s.score.toLocaleString(), 13, 31);
  ctx.fillStyle = "#eef0f6";
  ctx.fillText(s.score.toLocaleString(), 12, 30);
  if (jumpSteerMode === "touch" && s.mode === "playing") {
    const y = s.viewH - 24;
    ctx.fillStyle = "rgba(255,255,255,.13)";
    ctx.font = "800 18px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("◀", JUMP.W * 0.2, y);
    ctx.fillText("▶", JUMP.W * 0.8, y);
    ctx.beginPath(); ctx.arc(JUMP.W / 2, y - 6, 4, 0, Math.PI * 2); ctx.fill();
  }
}

/* ---------- loop, sizing, run lifecycle ---------- */
function jumpLoop(ts) {
  jumpRaf = 0;
  const s = jumpState;
  if (!s || s.mode !== "playing") return;
  jumpAcc += Math.min(0.1, (ts - jumpLastTs) / 1000);
  jumpLastTs = ts;
  while (jumpAcc >= JUMP_STEP && s.mode === "playing") {
    jumpUpdate(s, JUMP_STEP);
    jumpAcc -= JUMP_STEP;
  }
  jumpDraw();
  if (s.mode === "playing") jumpRaf = requestAnimationFrame(jumpLoop);
}
function jumpStartLoop() {
  if (jumpRaf) return;
  jumpLastTs = performance.now();
  jumpAcc = 0;
  jumpRaf = requestAnimationFrame(jumpLoop);
}

function jumpResize() {
  const c = $("jump-canvas");
  const cssW = c.parentElement.clientWidth;
  if (!cssW) return false; // tab hidden
  const top = c.parentElement.getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - $("tabbar").offsetHeight - 14;
  const cssH = Math.round(Math.max(380, Math.min(avail, cssW * 1.7)));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  c.style.height = cssH + "px";
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  jumpView = { cssW, cssH, dpr, scale: cssW / JUMP.W };
  if (jumpState) {
    jumpState.viewH = JUMP.W * cssH / cssW;
    jumpFill(jumpState);
  }
  return true;
}

function jumpShowOverlay(kind, isBest = false) {
  const s = jumpState;
  $("jump-overlay").hidden = false;
  $("jump-pause").hidden = true;
  $("jump-final").hidden = kind === "ready";
  $("jump-final").textContent = s ? s.score.toLocaleString() : "0";
  $("jump-ledger-wrap").hidden = kind !== "over";
  if (kind === "paused") {
    $("jump-kicker").textContent = "Paused";
    $("jump-sub").textContent = "Your run is waiting where you left it.";
    $("jump-go").textContent = "Resume";
  } else if (kind === "over") {
    const L = s.ledger;
    $("jump-kicker").textContent = isBest ? "New best!" : "Run over";
    $("jump-sub").textContent = s.cause === "monster"
      ? "A monster got you. Land on its head or shoot it first."
      : "You fell off the bottom. The screen never scrolls back down.";
    $("jump-ledger").innerHTML = [
      ["Bounces", L.bounces], ["Springs", L.springs], ["Boosters", L.boosters],
      ["Broke", L.broken], ["Stomped", L.stomped], ["Shot", L.shot],
    ].map(([k, n]) => `<div class="stat-box"><span class="stat-num">${n}</span><span class="stat-label">${k}</span></div>`).join("");
    $("jump-go").textContent = "Play again";
  } else {
    $("jump-kicker").textContent = "Endless climber";
    $("jump-sub").textContent = "Land on platforms to bounce. Climb as high as you can and don't fall off the bottom.";
    $("jump-go").textContent = "Play";
  }
}

async function jumpGo() {
  const s = jumpState;
  if (s && s.mode === "paused") { jumpResume(); return; }
  if (jumpSteerMode === "tilt" && !jumpTiltListening && !(await jumpEnableTilt())) {
    jumpSteerMode = "touch";
    save("dash.jumpsteer", jumpSteerMode);
    renderJumpSteer();
  }
  jumpResize();
  jumpState = jumpNewWorld();
  jumpState.mode = "playing";
  jumpState.doodler.vy = -JUMP.BOUNCE_V;
  jumpInput.pointers.clear();
  if (document.activeElement) document.activeElement.blur();
  $("jump-overlay").hidden = true;
  $("jump-pause").hidden = false;
  jumpStartLoop();
}

function jumpPause() {
  const s = jumpState;
  if (!s || s.mode !== "playing") return;
  s.mode = "paused";
  jumpInput.pointers.clear();
  jumpInput.left = jumpInput.right = false;
  jumpShowOverlay("paused");
}
function jumpResume() {
  const s = jumpState;
  if (!s || s.mode !== "paused") return;
  s.mode = "playing";
  $("jump-overlay").hidden = true;
  $("jump-pause").hidden = false;
  jumpStartLoop();
}

function jumpGameOver(s) {
  s.mode = "over";
  const isBest = s.score > jumpData.best;
  if (isBest) jumpData.best = s.score;
  jumpData.runs.unshift({ ts: Date.now(), score: s.score, cause: s.cause || "fell", ledger: s.ledger });
  jumpData.runs = jumpData.runs.slice(0, 20);
  save("dash.jump", jumpData);
  renderJumpMeta();
  jumpShowOverlay("over", isBest);
  if (isBest) popEl($("jump-best"));
}

function jumpOnShow() {
  window.scrollTo(0, 0);
  if (!jumpResize()) return;
  if (!jumpState || jumpState.mode === "ready") {
    jumpState = jumpNewWorld();
    jumpShowOverlay("ready");
  }
  jumpDraw();
}

/* ---------- rendering the cards around the game ---------- */
function renderJumpMeta() {
  $("jump-best").textContent = jumpData.best.toLocaleString();
  const rows = jumpData.runs.slice(0, 6);
  $("jump-runs").innerHTML = rows.map(r => {
    const when = new Date(r.ts);
    const how = r.cause === "monster" ? "caught by a monster" : "fell";
    const best = jumpData.best > 0 && r.score === jumpData.best ? ' <span class="jump-best-tag">best</span>' : "";
    return `
    <li>
      <div class="row-main">
        <span><strong>${r.score.toLocaleString()}</strong>${best}</span>
        <span class="row-sub">${when.toLocaleDateString([], { day: "numeric", month: "short" })} ${fmtTime(r.ts)}</span>
      </div>
      <div class="row-sub">${how} · ${r.ledger.bounces + r.ledger.springs} bounces · ${r.ledger.stomped + r.ledger.shot} monsters</div>
    </li>`;
  }).join("");
  $("jump-runs-empty").hidden = rows.length > 0;
}

function renderJumpSteer() {
  document.querySelectorAll("#jump-steer-toggle .seg").forEach(b =>
    b.classList.toggle("active", b.dataset.steer === jumpSteerMode));
  $("jump-steer-hint").textContent = jumpSteerMode === "tilt"
    ? "Tilt the phone to steer, like the original. Tap anywhere on the game to shoot toward your finger."
    : "Hold the left or right side of the game to steer, and tap the middle to shoot. With a keyboard, use ← → to steer and space to shoot.";
}

/* ---------- wiring ---------- */
$("jump-go").addEventListener("click", jumpGo);
$("jump-pause").addEventListener("click", jumpPause);

$("jump-steer-toggle").addEventListener("click", async (e) => {
  const b = e.target.closest(".seg");
  if (!b || b.dataset.steer === jumpSteerMode) return;
  if (b.dataset.steer === "tilt" && !(await jumpEnableTilt())) return;
  jumpSteerMode = b.dataset.steer;
  save("dash.jumpsteer", jumpSteerMode);
  jumpInput.pointers.clear();
  renderJumpSteer();
});

{
  const c = $("jump-canvas");
  const zoneAt = (e) => {
    const r = c.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };
  c.addEventListener("pointerdown", (e) => {
    const s = jumpState;
    if (!s || s.mode !== "playing") return;
    e.preventDefault();
    const fx = zoneAt(e);
    if (jumpSteerMode === "tilt") {
      const r = c.getBoundingClientRect();
      jumpShoot(fx * JUMP.W, s.camY + ((e.clientY - r.top) / r.height) * s.viewH);
      return;
    }
    if (fx > 0.4 && fx < 0.6) { jumpShoot(); return; }
    jumpInput.pointers.set(e.pointerId, fx < 0.5 ? -1 : 1);
    try { c.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
  });
  c.addEventListener("pointermove", (e) => {
    if (jumpInput.pointers.has(e.pointerId)) jumpInput.pointers.set(e.pointerId, zoneAt(e) < 0.5 ? -1 : 1);
  });
  const release = (e) => jumpInput.pointers.delete(e.pointerId);
  c.addEventListener("pointerup", release);
  c.addEventListener("pointercancel", release);
}

const JUMP_KEYS = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
window.addEventListener("keydown", (e) => {
  if (!document.body.classList.contains("on-play")) return;
  const s = jumpState;
  const playing = s && s.mode === "playing";
  if (JUMP_KEYS[e.code]) {
    jumpInput[JUMP_KEYS[e.code]] = true;
    if (playing) e.preventDefault();
  } else if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    if (playing) { e.preventDefault(); jumpShoot(); }
    else if (e.code === "Space" && !e.repeat && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); jumpGo(); }
  } else if (e.code === "KeyP" || e.code === "Escape") {
    if (playing) jumpPause(); else if (s && s.mode === "paused") jumpResume();
  }
});
window.addEventListener("keyup", (e) => {
  if (JUMP_KEYS[e.code]) jumpInput[JUMP_KEYS[e.code]] = false;
});

document.addEventListener("visibilitychange", () => { if (document.hidden) jumpPause(); });
window.addEventListener("resize", () => {
  if (!document.body.classList.contains("on-play")) return;
  if (jumpResize()) jumpDraw();
});

/* ---------------- initial render ---------------- */
renderJumpMeta();
renderJumpSteer();
renderLearnStats();
renderLearningList();
renderHabits();
renderLiftChartToggle();
renderLiftHistory();
renderSuggestion();
renderTargets();
renderDeepWork();
renderTimerDisplay(selectedMin * 60);
activateTab(initialTab(), false); // also draws the visible chart with the right accent
