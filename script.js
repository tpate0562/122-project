"use strict";

/* =========================================================
   Color math — perceptual difference (CIE76 ΔE in Lab space)
   ========================================================= */
function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function rgbToXyz({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  return {
    x: (R * 0.4124 + G * 0.3576 + B * 0.1805) * 100,
    y: (R * 0.2126 + G * 0.7152 + B * 0.0722) * 100,
    z: (R * 0.0193 + G * 0.1192 + B * 0.9505) * 100,
  };
}
function xyzToLab({ x, y, z }) {
  const xn = 95.047, yn = 100.0, zn = 108.883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn), fy = f(y / yn), fz = f(z / zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function deltaE(hex1, hex2) {
  const a = xyzToLab(rgbToXyz(hexToRgb(hex1)));
  const b = xyzToLab(rgbToXyz(hexToRgb(hex2)));
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/* =========================================================
   Color tracks
   ========================================================= */
const TRACKS = {
  grayscale: {
    pairs: [
      { from: "#000000", to: "#ffffff", label: "Black → White" },
      { from: "#000000", to: "#cccccc", label: "Black → Light Gray" },
      { from: "#000000", to: "#888888", label: "Black → Gray" },
      { from: "#000000", to: "#555555", label: "Black → Dark Gray" },
      { from: "#000000", to: "#333333", label: "Black → Charcoal" },
    ],
  },
  reds: {
    pairs: [
      { from: "#e60000", to: "#ffffff", label: "Red → White" },
      { from: "#e60000", to: "#ffc0cb", label: "Red → Pink" },
      { from: "#e60000", to: "#ff9a9a", label: "Red → Light Red" },
      { from: "#e60000", to: "#8b0000", label: "Red → Dark Red" },
      { from: "#e60000", to: "#b30000", label: "Red → Deeper Red" },
    ],
  },
  mixed: {
    pairs: [
      { from: "#000000", to: "#ffffff", label: "Black → White" },
      { from: "#1565c0", to: "#ffeb3b", label: "Blue → Yellow" },
      { from: "#2e7d32", to: "#c62828", label: "Green → Red" },
      { from: "#e60000", to: "#ff9a9a", label: "Red → Light Red" },
      { from: "#303030", to: "#4a4a4a", label: "Dark Gray → Gray" },
      { from: "#1565c0", to: "#1e88e5", label: "Blue → Lighter Blue" },
      { from: "#6a1b9a", to: "#ab47bc", label: "Purple → Light Purple" },
    ],
  },
};

/* =========================================================
   Small helpers
   ========================================================= */
const $ = (id) => document.getElementById(id);
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function mean(xs) { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* =========================================================
   DOM refs + state
   ========================================================= */
const arenaEl = $("arena");
const arenaText = $("arenaText");
const arenaSub = $("arenaSub");
const hudProgress = $("hudProgress");

let selectedTrack = "grayscale";
let rounds = [];
let results = [];
let currentIndex = 0;
let state = "menu"; // menu | intro | waiting | arming | ready | result | toosoon | summary
let changeTime = 0;
let lastSettings = null;

let introTimer = null, changeTimer = null, resultTimer = null, tooSoonTimer = null;
function clearTimers() {
  [introTimer, changeTimer, resultTimer, tooSoonTimer].forEach(clearTimeout);
  introTimer = changeTimer = resultTimer = tooSoonTimer = null;
}

function showScreen(id) {
  ["menu", "arena", "summary"].forEach((s) =>
    $(s).classList.toggle("is-active", s === id)
  );
}
function setArena(hex) { arenaEl.style.backgroundColor = hex; }

/* =========================================================
   Build the list of rounds for a test
   ========================================================= */
function buildRounds(track, n) {
  if (track === "custom") {
    const from = $("customFrom").value;
    const to = $("customTo").value;
    const dE = deltaE(from, to);
    return Array.from({ length: n }, () => ({
      from, to, label: "Custom pair", deltaE: dE,
    }));
  }
  const base = TRACKS[track].pairs.map((p) => ({ ...p, deltaE: deltaE(p.from, p.to) }));
  let pool = shuffle(base);
  while (pool.length < n) pool.push(base[Math.floor(Math.random() * base.length)]);
  return shuffle(pool.slice(0, n));
}

/* =========================================================
   Test flow
   ========================================================= */
function startTest() {
  const n = parseInt($("trialsInput").value, 10);
  lastSettings = { track: selectedTrack, n };
  rounds = buildRounds(selectedTrack, n);
  results = [];
  currentIndex = 0;
  showScreen("arena");
  beginRound(0);
}

function beginRound(i) {
  clearTimers();
  currentIndex = i;
  const round = rounds[i];
  arenaEl.classList.remove("state-result", "state-toosoon");
  setArena(round.from);
  hudProgress.textContent = `Round ${i + 1} / ${rounds.length}`;
  state = "intro";
  arenaText.textContent = `Round ${i + 1}`;
  arenaSub.textContent = "Click the instant the color changes";

  introTimer = setTimeout(() => {
    // Clear the center text so the ONLY thing that changes is the
    // background color — that keeps subtle changes genuinely subtle.
    arenaText.textContent = "";
    arenaSub.textContent = "";
    state = "waiting";
    const delay = 1000 + Math.random() * 3000; // 1.0 – 4.0s
    changeTimer = setTimeout(fireChange, delay);
  }, 850);
}

function fireChange() {
  state = "arming";
  setArena(rounds[currentIndex].to);
  // Record the timestamp as close to the actual paint as we can.
  requestAnimationFrame(() => {
    changeTime = performance.now();
    state = "ready";
  });
}

function recordReaction() {
  const rt = Math.round(performance.now() - changeTime);
  results.push({ ...rounds[currentIndex], rt });
  state = "result";
  arenaEl.classList.add("state-result");
  arenaText.textContent = `${rt} ms`;
  arenaSub.textContent = feedbackFor(rt);
  resultTimer = setTimeout(() => {
    arenaEl.classList.remove("state-result");
    if (currentIndex + 1 < rounds.length) beginRound(currentIndex + 1);
    else finish();
  }, 950);
}

function tooSoon() {
  clearTimeout(changeTimer);
  state = "toosoon";
  arenaEl.classList.add("state-toosoon");
  setArena(rounds[currentIndex].from);
  arenaText.textContent = "Too soon!";
  arenaSub.textContent = "Wait for the color to change.";
  tooSoonTimer = setTimeout(() => {
    arenaEl.classList.remove("state-toosoon");
    beginRound(currentIndex); // redo the same round
  }, 1100);
}

function feedbackFor(rt) {
  if (rt < 220) return "Lightning fast!";
  if (rt < 300) return "Excellent";
  if (rt < 380) return "Great";
  if (rt < 480) return "Solid";
  if (rt < 650) return "Not bad";
  return "Spotted it!";
}

function finish() {
  clearTimers();
  state = "summary";
  showSummary();
  showScreen("summary");
}

/* =========================================================
   Input handling
   ========================================================= */
function registerInput() {
  if (state === "waiting") tooSoon();
  else if (state === "ready") recordReaction();
  // intro / arming / result / toosoon → ignore
}
arenaEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#quitBtn")) return;
  registerInput();
});
document.addEventListener("keydown", (e) => {
  if (state === "menu" || state === "summary") return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    registerInput();
  }
});

/* =========================================================
   Results + insight
   ========================================================= */
function pearson(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}
function linreg(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

function showSummary() {
  const rts = results.map((r) => r.rt);
  const des = results.map((r) => r.deltaE);

  $("statAvg").textContent = Math.round(mean(rts)) + " ms";
  $("statBest").textContent = Math.min(...rts) + " ms";
  $("statMedian").textContent = Math.round(median(rts)) + " ms";
  $("statCount").textContent = results.length;

  const deRange = Math.max(...des) - Math.min(...des);
  const constantColors = deRange < 2; // custom / single-pair case

  // Insight text
  let insight = "";
  if (constantColors) {
    const spread = Math.round(Math.max(...rts) - Math.min(...rts));
    insight = `Same color change every round, so this measures your <strong>consistency</strong>. ` +
      `Your times ranged across <strong>${spread} ms</strong> (best ${Math.min(...rts)} ms, ` +
      `slowest ${Math.max(...rts)} ms).`;
  } else if (results.length >= 4) {
    const r = pearson(des, rts);
    const sorted = results.slice().sort((a, b) => a.deltaE - b.deltaE);
    const third = Math.max(1, Math.floor(sorted.length / 3));
    const hardMean = mean(sorted.slice(0, third).map((x) => x.rt));   // smallest ΔE
    const easyMean = mean(sorted.slice(-third).map((x) => x.rt));     // largest ΔE
    const extra = Math.round(hardMean - easyMean);
    if (!isNaN(r) && r <= -0.3) {
      insight = `Clear pattern: the bigger the color jump, the faster you reacted ` +
        `(correlation <strong>r = ${r.toFixed(2)}</strong>). Subtle changes cost you about ` +
        `<strong>${Math.abs(extra)} ms</strong> versus the obvious ones.`;
    } else if (!isNaN(r) && r >= 0.3) {
      insight = `Interesting — you were actually <strong>slower</strong> on the bigger color jumps ` +
        `this time (r = ${r.toFixed(2)}). Probably noise; try a few more rounds.`;
    } else {
      insight = `Your reaction stayed fairly steady regardless of how different the colors were ` +
        `(weak correlation, r = ${isNaN(r) ? "—" : r.toFixed(2)}). ` +
        (extra > 0 ? `Subtle changes were ~${extra} ms slower on average.` : "");
    }
  } else {
    insight = "Run a few more rounds to see how color difference affects your speed.";
  }
  $("insight").innerHTML = insight;

  renderTable();
  // Wait one frame so the canvas has its on-screen width before drawing.
  requestAnimationFrame(() => drawChart(constantColors));
}

function descForDelta(dE) {
  if (dE < 8) return "subtle";
  if (dE < 20) return "mild";
  if (dE < 45) return "clear";
  return "huge";
}

function renderTable() {
  const body = $("resultsBody");
  body.innerHTML = "";
  results.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${i + 1}</td>` +
      `<td><span class="swatch-pair">` +
        `<span class="sw" style="background:${r.from}"></span>` +
        `<span class="ar">→</span>` +
        `<span class="sw" style="background:${r.to}"></span>` +
        `&nbsp;${r.label}</span></td>` +
      `<td>${r.deltaE.toFixed(1)} <span class="ar">(${descForDelta(r.deltaE)})</span></td>` +
      `<td class="time">${r.rt} ms</td>`;
    body.appendChild(tr);
  });
}

/* =========================================================
   Chart (scatter: ΔE vs reaction time, with trend line)
   ========================================================= */
function drawChart(constantColors) {
  const canvas = $("chart");
  const cssW = canvas.clientWidth || 720;
  const cssH = 380;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 56, padR = 22, padT = 18, padB = 46;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const rts = results.map((r) => r.rt);
  const useRoundsAxis = constantColors;
  const xs = useRoundsAxis ? results.map((_, i) => i + 1) : results.map((r) => r.deltaE);

  let xMin, xMax;
  if (useRoundsAxis) { xMin = 1; xMax = results.length; }
  else { xMin = 0; xMax = Math.max(...xs) * 1.05 || 1; }
  let yMin = Math.max(0, Math.min(...rts) - 40);
  let yMax = Math.max(...rts) + 40;
  if (yMax - yMin < 60) yMax = yMin + 60;
  if (xMax - xMin < 1e-6) xMax = xMin + 1;

  const X = (v) => padL + ((v - xMin) / (xMax - xMin)) * plotW;
  const Y = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue("--muted").trim() || "#9aa6b2";
  const border = css.getPropertyValue("--border").trim() || "#2a313c";
  const accent = css.getPropertyValue("--accent").trim() || "#4f9dff";

  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;

  // Y grid + labels
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = yMin + ((yMax - yMin) * i) / yTicks;
    const y = Y(val);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.fillText(Math.round(val), padL - 8, y);
  }

  // X labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = useRoundsAxis ? Math.min(results.length, 10) : 5;
  for (let i = 0; i <= xTicks; i++) {
    const val = xMin + ((xMax - xMin) * i) / xTicks;
    const x = X(val);
    ctx.fillStyle = muted;
    ctx.fillText(useRoundsAxis ? Math.round(val) : Math.round(val), x, padT + plotH + 8);
  }

  // Axis titles
  ctx.fillStyle = muted;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText(
    useRoundsAxis ? "round number" : "color difference (ΔE — bigger = more different)",
    padL + plotW / 2,
    padT + plotH + 26
  );
  ctx.save();
  ctx.translate(16, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("reaction time (ms)", 0, 0);
  ctx.restore();

  // Trend line (only when ΔE actually varies)
  if (!useRoundsAxis) {
    const { slope, intercept } = linreg(xs, rts);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(X(xMin), Y(slope * xMin + intercept));
    ctx.lineTo(X(xMax), Y(slope * xMax + intercept));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Points — filled with each round's target color
  results.forEach((r, i) => {
    const x = X(useRoundsAxis ? i + 1 : r.deltaE);
    const y = Y(r.rt);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = r.to;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.stroke();
  });
}

/* =========================================================
   Menu wiring
   ========================================================= */
function selectTrack(track) {
  selectedTrack = track;
  document.querySelectorAll(".track").forEach((b) =>
    b.classList.toggle("is-selected", b.dataset.track === track)
  );
  $("customField").hidden = track !== "custom";
}

document.querySelectorAll(".track").forEach((btn) => {
  btn.addEventListener("click", () => selectTrack(btn.dataset.track));
});

$("trialsInput").addEventListener("input", (e) => {
  $("trialsValue").textContent = e.target.value;
});

function syncCustomSwatches() {
  $("customSwatchFrom").style.background = $("customFrom").value;
  $("customSwatchTo").style.background = $("customTo").value;
}
$("customFrom").addEventListener("input", syncCustomSwatches);
$("customTo").addEventListener("input", syncCustomSwatches);

$("startBtn").addEventListener("click", () => {
  state = "menu";
  startTest();
});
$("quitBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  clearTimers();
  state = "menu";
  showScreen("menu");
});
$("againBtn").addEventListener("click", () => {
  if (!lastSettings) return;
  selectedTrack = lastSettings.track;
  startTest();
});
$("menuBtn").addEventListener("click", () => {
  state = "menu";
  showScreen("menu");
});

// init
selectTrack("grayscale");
syncCustomSwatches();
