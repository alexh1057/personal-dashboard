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
document.querySelectorAll(".tabbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === btn.dataset.tab));
  });
});

/* ================================================================
   SECTION 1 — LEARNINGS & MEMORY (in-memory only, resets on close)
   ================================================================ */
const learnings = [];       // { id, text, category, ts }
let reviewPoints = 0;
let pendingReview = null;   // { type, points }
const reviewsDone = {};     // type -> true once completed this session

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
    li.innerHTML = `<span>${esc(l.text)}</span>
      <span class="learning-meta">${fmtTime(l.ts)}${l.category ? ` <span class="cat-tag">${esc(l.category)}</span>` : ""}</span>`;
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
  });
  $("learning-input").value = "";
  $("learning-category").value = "";
  renderLearnStats();
  renderLearningList();
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

/* review reward system */
const REVIEW_CONFIG = {
  daily:   { days: 7,  count: 1, points: 1, label: "Daily review — 1 learning from the past 7 days" },
  weekly:  { days: 31, count: 3, points: 3, label: "Weekly review — 3 learnings from the past month" },
  monthly: { days: 92, count: 5, points: 5, label: "Monthly review — 5 learnings from the past quarter" },
};

function startReview(type) {
  const cfg = REVIEW_CONFIG[type];
  const msg = $("review-msg");
  if (reviewsDone[type]) {
    msg.textContent = "Already completed this session — capture more learnings and come back tomorrow!";
    return;
  }
  const cutoff = Date.now() - cfg.days * DAY;
  const eligible = learnings.filter(l => l.ts >= cutoff);
  if (eligible.length === 0) {
    msg.textContent = "No learnings in that window yet — capture something first.";
    return;
  }
  msg.textContent = "";
  const picked = pickRandom(eligible, cfg.count);
  pendingReview = { type, points: cfg.points };
  $("review-area-title").textContent = cfg.label;
  $("review-items").innerHTML = picked.map(l => `
    <li>${esc(l.text)}
      <span class="meta">${fmtTime(l.ts)}${l.category ? ` · ${esc(l.category)}` : ""}</span>
    </li>`).join("");
  $("review-complete").textContent = `Review complete ✓ (+${cfg.points} pt${cfg.points > 1 ? "s" : ""})`;
  $("review-area").hidden = false;
}

$("review-daily").addEventListener("click", () => startReview("daily"));
$("review-weekly").addEventListener("click", () => startReview("weekly"));
$("review-monthly").addEventListener("click", () => startReview("monthly"));

$("review-complete").addEventListener("click", () => {
  if (!pendingReview) return;
  reviewPoints += pendingReview.points;
  reviewsDone[pendingReview.type] = true;
  $(`review-${pendingReview.type}`).classList.add("done");
  $("review-msg").textContent = `+${pendingReview.points} point${pendingReview.points > 1 ? "s" : ""}! Total: ${reviewPoints} review point${reviewPoints === 1 ? "" : "s"} this session.`;
  pendingReview = null;
  $("review-area").hidden = true;
  renderLearnStats();
});

/* spaced repetition prompt: suggest reviewing something ~3 weeks old */
function renderSpacedRep() {
  const card = $("spaced-rep-card");
  if (learnings.length === 0) { card.hidden = true; return; }
  card.hidden = false;
  const cutoff = Date.now() - 21 * DAY;
  const old = learnings.filter(l => l.ts <= cutoff);
  if (old.length) {
    const pick = old[Math.floor(Math.random() * old.length)];
    $("spaced-rep-msg").textContent = "Review something from 3 weeks ago:";
    $("spaced-rep-item").textContent = pick.text + (pick.category ? ` — ${pick.category}` : "");
    $("spaced-rep-item").hidden = false;
  } else {
    const oldest = learnings.reduce((a, b) => (a.ts < b.ts ? a : b));
    const ageMin = Math.max(1, Math.round((Date.now() - oldest.ts) / 60000));
    $("spaced-rep-msg").textContent =
      `Nothing 3+ weeks old yet (oldest entry is ${ageMin} min old). Re-read your oldest learning anyway — retrieval is what makes it stick.`;
    $("spaced-rep-item").textContent = oldest.text;
    $("spaced-rep-item").hidden = false;
  }
}

/* ================================================================
   SECTION 2 — STRENGTH TRAINING (persisted in localStorage)
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
  liftLog.push(entry);
  save("dash.lifts", liftLog);
  $("lift-weight").value = "";
  $("lift-note").value = "";
  $("e1rm-preview").hidden = true;
  chartLift = entry.lift;
  renderLiftChartToggle();
  renderLiftChart();
  renderLiftHistory();
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

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  // horizontal gridlines + labels
  for (let g = 0; g <= 3; g++) {
    const v = lo + (g / 3) * (hi - lo);
    const gy = y(v);
    svg += `<line class="chart-axis" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"/>`;
    svg += `<text class="chart-label" x="${padL - 6}" y="${gy + 3}" text-anchor="end">${v.toFixed(0)}</text>`;
  }
  // line
  svg += `<polyline class="chart-line" points="${entries.map((e, i) => `${x(i).toFixed(1)},${y(e.e1rm).toFixed(1)}`).join(" ")}"/>`;
  // dots + x labels (thin labels if many points)
  const labelEvery = Math.max(1, Math.ceil(entries.length / 6));
  entries.forEach((e, i) => {
    svg += `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(e.e1rm).toFixed(1)}" r="3.5"/>`;
    if (i % labelEvery === 0 || i === entries.length - 1) {
      svg += `<text class="chart-label" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtDate(e.date)}</text>`;
    }
  });
  svg += `</svg>`;
  holder.innerHTML = svg;
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
   SECTION 3 — DEEP WORK (persisted in localStorage)
   ================================================================ */
let dwLog = load("dash.deepwork", []); // { id, ts, minutes, focus }
let timer = { running: false, endTs: 0, startTs: 0, plannedMin: 25, interval: null };
let selectedMin = 25;

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

function renderTimerDisplay(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.max(0, Math.round(totalSeconds % 60));
  $("timer-display").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function tick() {
  const remain = Math.max(0, (timer.endTs - Date.now()) / 1000);
  renderTimerDisplay(remain);
  if (remain <= 0) finishSession(timer.plannedMin);
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
  renderTimerDisplay(selectedMin * 60);
});

function finishSession(minutes) {
  stopTimerUI();
  recordSession(minutes);
  $("timer-display").classList.add("finished");
  $("timer-hint").textContent = `Session complete — ${minutes} min logged. Nice work.`;
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  renderTimerDisplay(0);
}

function stopTimerUI() {
  clearInterval(timer.interval);
  timer.running = false;
  $("timer-start").hidden = false;
  $("timer-stop").hidden = true;
  $("timer-display").classList.remove("running");
}

function recordSession(minutes) {
  dwLog.push({ id: Date.now(), ts: Date.now(), minutes, focus: $("focus-area").value.trim() });
  save("dash.deepwork", dwLog);
  $("focus-area").value = "";
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

function renderDeepWork() {
  const today = dwInRange(startOfDay());
  const week = dwInRange(startOfWeek());
  const month = dwInRange(startOfMonth());

  $("dw-today-n").textContent = today.length;
  $("dw-week-n").textContent = week.length;
  $("dw-month-n").textContent = month.length;
  $("dw-today-h").textContent = fmtHours(sumMin(today));
  $("dw-week-h").textContent = fmtHours(sumMin(week));
  $("dw-month-h").textContent = fmtHours(sumMin(month));

  // deep work score: total focused minutes this week
  $("dw-score").textContent = sumMin(week);

  // motivation
  const streak = streakDays();
  let msg = "";
  if (week.length === 0) msg = "No sessions yet this week — start with just 25 minutes.";
  else if (streak >= 3) msg = `🔥 ${streak}-day streak and ${week.length} session${week.length > 1 ? "s" : ""} this week — exceptional consistency!`;
  else if (week.length >= 3) msg = `${week.length} sessions this week — stay on track!`;
  else msg = `${week.length} session${week.length > 1 ? "s" : ""} this week — one more today keeps momentum going.`;
  $("dw-motivate").textContent = msg;

  renderDwWeekChart();
  renderDwLog();
}

function renderDwWeekChart() {
  const ws = startOfWeek();
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const mins = days.map((_, i) => {
    const d0 = ws.getTime() + i * DAY, d1 = d0 + DAY;
    return sumMin(dwLog.filter(s => s.ts >= d0 && s.ts < d1));
  });
  const W = 520, H = 170, padL = 34, padR = 8, padT = 12, padB = 26;
  const maxV = Math.max(60, ...mins);
  const bw = (W - padL - padR) / 7;
  const todayIdx = Math.floor((startOfDay().getTime() - ws.getTime()) / DAY);

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<line class="chart-axis" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>`;
  svg += `<text class="chart-label" x="${padL - 6}" y="${padT + 8}" text-anchor="end">${maxV}m</text>`;
  mins.forEach((v, i) => {
    const bh = v === 0 ? 0 : Math.max(3, (v / maxV) * (H - padT - padB));
    const bx = padL + i * bw + bw * 0.18;
    svg += `<rect class="chart-bar ${i === todayIdx ? "today" : ""}" x="${bx.toFixed(1)}" y="${(H - padB - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3"/>`;
    svg += `<text class="chart-label" x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${days[i]}</text>`;
    if (v > 0) svg += `<text class="chart-label" x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${(H - padB - bh - 4).toFixed(1)}" text-anchor="middle">${v}</text>`;
  });
  svg += `</svg>`;
  $("dw-week-chart").innerHTML = svg;
}

function renderDwLog() {
  const rows = [...dwLog].sort((a, b) => b.ts - a.ts).slice(0, 15);
  $("dw-log").innerHTML = rows.map(s => `
    <li>
      <div class="row-main">
        <span>${s.minutes} min${s.focus ? ` — ${esc(s.focus)}` : ""}</span>
        <span class="row-sub">${new Date(s.ts).toLocaleDateString([], { day: "numeric", month: "short" })} ${fmtTime(s.ts)}</span>
      </div>
    </li>`).join("");
  $("dw-empty").hidden = rows.length > 0;
}

/* ---------------- initial render ---------------- */
renderLearnStats();
renderLearningList();
renderLiftChartToggle();
renderLiftChart();
renderLiftHistory();
renderDeepWork();
