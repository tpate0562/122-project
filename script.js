"use strict";

/* =========================================================
   CONFIG — paste your Google Apps Script Web App URL below.
   (Deploy > New deployment > Web app > Execute as: Me,
    Who has access: Anyone.) It should look like:
    https://script.google.com/macros/s/AKfyc.../exec
   ========================================================= */
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxVy9kOmqfoxFydk6FqUSnm9QKlGKroGNfiX4vBdoSz_byXhy2ixqOaKBPxTbf9bKxKCA/exec";

/* 8 gray targets, each 32 apart in RGB, starting from black.
   (The last is capped at 255 = white, so its step is 31.) */
const GRAYS = [32, 64, 96, 128, 160, 192, 224, 255];
const REPS = 5;                 // times each gray is tested (logged)
const WARMUP_GRAY = 255;        // first trial, NOT logged
const START_COLOR = "#000000";  // every trial starts black

const INTRO_MS = 650;           // brief "get ready" before a normal trial
const WARMUP_INTRO_MS = 1100;   // a little longer for the practice round
const OK_MS = 500;              // how long the "✓" stays up

/* =========================================================
   Helpers
   ========================================================= */
const $ = (id) => document.getElementById(id);
const hex2 = (n) => n.toString(16).padStart(2, "0");
const grayHex = (v) => `#${hex2(v)}${hex2(v)}${hex2(v)}`;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================================================
   DOM refs + state
   ========================================================= */
const arenaEl = $("arena");
const arenaText = $("arenaText");
const arenaSub = $("arenaSub");
const hudProgress = $("hudProgress");

let participantName = "";
let sessionId = "";
let sequence = [];              // [warmup, ...40 trials]
let trials = [];                // logged per-trial records (warm-up excluded)
const loggedTotal = GRAYS.length * REPS;   // 40
let currentIndex = 0;
let state = "menu";             // menu | intro | waiting | arming | ready | ok | toosoon | done
let changeTime = 0;

let introTimer = null, changeTimer = null, okTimer = null, tooSoonTimer = null;
function clearTimers() {
  [introTimer, changeTimer, okTimer, tooSoonTimer].forEach(clearTimeout);
  introTimer = changeTimer = okTimer = tooSoonTimer = null;
}

function showScreen(id) {
  ["menu", "arena", "done"].forEach((s) =>
    $(s).classList.toggle("is-active", s === id)
  );
}
function setArena(hex) { arenaEl.style.backgroundColor = hex; }

/* =========================================================
   Test flow
   ========================================================= */
function buildSequence() {
  // One unlogged warm-up (black -> white), then REPS of each gray, shuffled.
  const warm = { from: START_COLOR, to: grayHex(WARMUP_GRAY), gray: WARMUP_GRAY, warmup: true };
  let main = [];
  for (let r = 0; r < REPS; r++) main = main.concat(GRAYS);
  main = shuffle(main).map((g) => ({ from: START_COLOR, to: grayHex(g), gray: g, warmup: false }));
  return [warm, ...main];
}

function startTest() {
  sequence = buildSequence();
  trials = [];
  sessionId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  currentIndex = 0;
  showScreen("arena");
  beginRound(0);
}

function beginRound(i) {
  clearTimers();
  currentIndex = i;
  const round = sequence[i];
  arenaEl.classList.remove("state-ok", "state-toosoon");
  setArena(round.from); // always start black

  if (round.warmup) {
    hudProgress.textContent = "Warm-up";
    arenaText.textContent = "Warm-up";
    arenaSub.textContent = "Practice round — won't be counted";
  } else {
    hudProgress.textContent = `Trial ${i} / ${loggedTotal}`; // warm-up is index 0
    arenaText.textContent = "Get ready";
    arenaSub.textContent = "";
  }

  state = "intro";
  introTimer = setTimeout(() => {
    // Clear the text so the ONLY thing that changes is the background.
    arenaText.textContent = "";
    arenaSub.textContent = "";
    state = "waiting";
    const delay = 1000 + Math.random() * 3000; // 1.0 – 4.0s
    changeTimer = setTimeout(fireChange, delay);
  }, round.warmup ? WARMUP_INTRO_MS : INTRO_MS);
}

function fireChange() {
  state = "arming";
  setArena(sequence[currentIndex].to);
  requestAnimationFrame(() => {
    changeTime = performance.now();
    state = "ready";
  });
}

function recordReaction() {
  const rt = Math.round(performance.now() - changeTime);
  const round = sequence[currentIndex];
  if (!round.warmup) {
    // currentIndex doubles as the 1-based trial number (warm-up is index 0).
    trials.push({ trial: currentIndex, gray: round.gray, hex: round.to, rt: rt });
  }
  // Deliberately do NOT show the time — participants don't see their scores.
  state = "ok";
  arenaEl.classList.add("state-ok");
  arenaText.textContent = "✓";
  arenaSub.textContent = round.warmup ? "Here we go — the real test starts now" : "";
  okTimer = setTimeout(() => {
    arenaEl.classList.remove("state-ok");
    if (currentIndex + 1 < sequence.length) beginRound(currentIndex + 1);
    else finish();
  }, OK_MS);
}

function tooSoon() {
  clearTimeout(changeTimer);
  state = "toosoon";
  arenaEl.classList.add("state-toosoon");
  setArena(sequence[currentIndex].from);
  arenaText.textContent = "Too soon!";
  arenaSub.textContent = "Wait for the screen to change.";
  tooSoonTimer = setTimeout(() => {
    arenaEl.classList.remove("state-toosoon");
    beginRound(currentIndex); // redo the same trial (warm-up or not)
  }, 1100);
}

function finish() {
  clearTimers();
  state = "done";
  uploadData();              // fire-and-forget, no confirmation
  $("doneTitle").textContent = `All done${participantName ? ", " + participantName : ""}!`;
  showScreen("done");
}

/* =========================================================
   Upload to Google (silent, no UI feedback)
   One submission carries every logged trial as its own record;
   the Apps Script writes one spreadsheet row per trial.
   ========================================================= */
function uploadData() {
  const payload = {
    name: participantName,
    session: sessionId,
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    trials: trials,            // [{ trial, gray, hex, rt }, ...] (warm-up excluded)
  };
  console.log("[Hue Reflex] submission", payload);

  if (!/^https:\/\//.test(SCRIPT_URL)) {
    console.warn("[Hue Reflex] SCRIPT_URL not set — skipping upload. " +
      "Paste your Apps Script Web App URL into script.js.");
    return;
  }
  try {
    // text/plain + no-cors keeps this a simple request (no CORS preflight),
    // which is all an Apps Script web app needs to receive the body.
    fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (e) {
    /* ignore — nothing the participant should see */
  }
}

/* =========================================================
   Input handling
   ========================================================= */
function registerInput() {
  if (state === "waiting") tooSoon();
  else if (state === "ready") recordReaction();
  // intro / arming / ok / toosoon → ignore
}
arenaEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#quitBtn")) return;
  registerInput();
});
document.addEventListener("keydown", (e) => {
  if (state === "menu" || state === "done") return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    registerInput();
  }
});

/* =========================================================
   Menu wiring
   ========================================================= */
function attemptStart() {
  const name = $("nameInput").value.trim();
  if (!name) {
    $("nameError").hidden = false;
    $("nameInput").focus();
    return;
  }
  $("nameError").hidden = true;
  participantName = name;
  state = "starting";
  startTest();
}

$("startBtn").addEventListener("click", attemptStart);
$("nameInput").addEventListener("input", () => { $("nameError").hidden = true; });
$("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); attemptStart(); }
});

$("quitBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  clearTimers();
  state = "menu";
  showScreen("menu");
});

$("restartBtn").addEventListener("click", () => {
  participantName = "";
  $("nameInput").value = "";
  state = "menu";
  showScreen("menu");
  $("nameInput").focus();
});
