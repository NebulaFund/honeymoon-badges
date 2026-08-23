/* ============================================================
   Badge Case
   Edit REMOTE_URL to point at your hosted badges.json.
   Leave it null to use the badges.json sitting next to this file.
   ============================================================ */
const REMOTE_URL = null;   // e.g. "https://yoav.github.io/badges/badges.json"

const TIERS = {
  bronze:   { label: "Bronze",   glow: "#c98b52", order: 1 },
  silver:   { label: "Silver",   glow: "#c9d2e0", order: 2 },
  gold:     { label: "Gold",     glow: "#f2c14e", order: 3 },
  platinum: { label: "Platinum", glow: "#7fe3e0", order: 4 },
};

const CACHE_KEY = "badgecase.data.v1";
const $ = (id) => document.getElementById(id);

/* ---------- data ---------- */
async function loadData() {
  const sources = [REMOTE_URL, "badges.json"].filter(Boolean);
  for (const url of sources) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      const data = await res.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      return { data, stale: false };
    } catch (_) { /* try next */ }
  }
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) return { data: JSON.parse(cached), stale: true };
  return { data: null, stale: false };
}


/* ---------- artwork prep ----------
   Badge art usually arrives as a medallion floating on a white page.
   Crop to the medallion and key the white out — flood-filled inward from
   the border, so white *inside* the art (snow, a white helicopter) stays.
   Images that already have transparency are passed through untouched. */
const artCache = new Map();

function prepareArt(src) {
  if (artCache.has(src)) return artCache.get(src);
  const job = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(src);
    img.onload  = () => { try { resolve(trimToBadge(img) || src); } catch (_) { resolve(src); } };
    img.src = src;
  });
  artCache.set(src, job);
  return job;
}

function trimToBadge(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, W, H), d = im.data;

  // already transparent at the corners -> nothing to do
  if ([0, (W - 1) * 4, (H - 1) * W * 4, (W * H - 1) * 4].every(i => d[i + 3] < 8)) return null;

  // The page colour, as the median of the border pixels — it is not always white; some art
  // sits on a light grey that drifts across the image.
  const chan = [[], [], []];
  const sample = (x, y) => { const i = (y * W + x) * 4; chan[0].push(d[i]); chan[1].push(d[i+1]); chan[2].push(d[i+2]); };
  for (let x = 0; x < W; x += 4) { sample(x, 0); sample(x, H - 1); }
  for (let y = 0; y < H; y += 4) { sample(0, y); sample(W - 1, y); }
  const bg = chan.map(a => a.sort((p, q) => p - q)[a.length >> 1]);

  // Step 1 — remove the page. Deliberately conservative: only pixels close to the page
  // colour, flood-filled inward so white inside the art survives. A drop shadow is far from the
  // page colour and stays behind; it gets removed geometrically in step 2 instead. Chasing
  // it here with a looser rule walks the fill down soft gradients into the artwork.
  const TOL = 30;
  const isPage = i => Math.hypot(d[i] - bg[0], d[i+1] - bg[1], d[i+2] - bg[2]) <= TOL;
  const seen = new Uint8Array(W * H), stack = [];
  const seed = (x, y) => { const p = y * W + x; if (!seen[p] && isPage(p * 4)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p - x) / W;
    d[p * 4 + 3] = 0;
    if (x > 0)     seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0)     seed(x, y - 1);
    if (y < H - 1) seed(x, y + 1);
  }

  // Step 2 — the medallion is a disc, so find the largest circle that fits inside what is
  // left and throw away everything outside it. That removes the drop shadow, which clings to
  // the edge as a thin crescent, without any colour rule having to tell shadow from artwork
  // (it can't: the contact shadow and the badge's own outline occupy the same darkness).
  const INF = 1e9, dist = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) dist[p] = d[p * 4 + 3] > 10 ? INF : 0;
  const D1 = 1, D2 = 1.4142;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (!dist[p]) continue;
    let v = dist[p];
    if (y > 0)             v = Math.min(v, dist[p - W] + D1);
    if (x > 0)             v = Math.min(v, dist[p - 1] + D1);
    if (y > 0 && x > 0)    v = Math.min(v, dist[p - W - 1] + D2);
    if (y > 0 && x < W-1)  v = Math.min(v, dist[p - W + 1] + D2);
    dist[p] = v;
  }
  let best = 0, bcx = 0, bcy = 0;
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x; if (!dist[p]) continue;
    let v = dist[p];
    if (y < H-1)            v = Math.min(v, dist[p + W] + D1);
    if (x < W-1)            v = Math.min(v, dist[p + 1] + D1);
    if (y < H-1 && x < W-1) v = Math.min(v, dist[p + W + 1] + D2);
    if (y < H-1 && x > 0)   v = Math.min(v, dist[p + W - 1] + D2);
    dist[p] = v;
    if (v > best) { best = v; bcx = x; bcy = y; }
  }
  if (best < Math.min(W, H) * 0.08) return null;   // no disc found — leave the art alone

  const R = best;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    const r = Math.hypot(x - bcx, y - bcy);
    if (r > R) d[i + 3] = 0;
    else if (r > R - 1.5) d[i + 3] = Math.round(d[i + 3] * (R - r) / 1.5);
  }

  // square crop around the disc, with a little breathing room
  ctx.putImageData(im, 0, 0);
  const side = Math.ceil(R * 2 * 1.06);
  const size = Math.min(512, side);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  out.getContext("2d").drawImage(cv, bcx - side / 2, bcy - side / 2, side, side, 0, 0, size, size);
  return out.toDataURL("image/png");
}

/* ---------- render ---------- */
function render({ data, stale }) {
  const tray = $("tray");
  if (!data) {
    tray.innerHTML = `<p class="empty-state">Couldn't load the badge list, and there's no saved copy yet.<br>Check the connection and reopen.</p>`;
    return;
  }

  $("case-title").textContent = data.title || "Badge Case";
  document.title = data.title || "Badge Case";

  const badges = (data.badges || []).slice().sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;        // earned first
    if (a.earned) return (b.earnedDate || "").localeCompare(a.earnedDate || ""); // newest first
    return (TIERS[a.tier]?.order ?? 99) - (TIERS[b.tier]?.order ?? 99);
  });

  const earned = badges.filter(b => b.earned);
  // number each earned badge by the order she got it — "#3 of 12"
  earned.slice().sort((a, b) => (a.earnedDate || "").localeCompare(b.earnedDate || ""))
        .forEach((b, i) => { b._num = i + 1; b._total = badges.length; });
  const pct = badges.length ? Math.round((earned.length / badges.length) * 100) : 0;

  $("case-subtitle").textContent = data.subtitle || `${earned.length} badges collected`;
  $("ring-pct").textContent = pct + "%";
  $("ring-count").textContent = `${earned.length} / ${badges.length}`;
  const C = 2 * Math.PI * 43;
  requestAnimationFrame(() => { $("ring-fill").style.strokeDashoffset = C * (1 - pct / 100); });

  // tier counters
  $("tier-bar").innerHTML = Object.entries(TIERS).map(([key, t]) => {
    const n = earned.filter(b => b.tier === key).length;
    return `<span class="tier-chip${n ? "" : " empty"}" data-t="${key}"><i></i><b>${n}</b></span>`;
  }).join("");

  // slots
  tray.innerHTML = "";
  badges.forEach(b => {
    const glow = TIERS[b.tier]?.glow || "#cfa64f";
    const el = document.createElement("button");
    el.className = "slot";
    el.type = "button";
    el.dataset.earned = String(!!b.earned);
    el.style.setProperty("--glow", glow);
    el.setAttribute("aria-label",
      b.earned ? `${b.name}, earned` : `Locked badge${b.hint ? ": " + b.hint : ""}`);
    el.innerHTML = `
      <span class="socket">${b.image ? '<img alt="">' : ""}</span>
      <span class="name">${b.earned ? escapeHtml(b.name) : "· · ·"}</span>`;
    if (b.image) prepareArt(b.image).then(url => {
      b._art = url;
      el.querySelector("img").src = url;
      if (openBadge === b) $("sheet-badge").innerHTML = `<img src="${url}" alt="">`;
    });
    el.addEventListener("click", () => openSheet(b, glow));
    tray.appendChild(el);
  });

  $("foot-note").textContent = stale ? "Showing your saved copy — offline" : (data.footer || "");
}

/* ---------- detail sheet ---------- */
let openBadge = null;
function openSheet(b, glow) {
  openBadge = b;
  const sheet = $("sheet"), scrim = $("scrim");
  sheet.style.setProperty("--glow", glow);
  sheet.dataset.earned = String(!!b.earned);

  const art = b._art || b.image;
  $("sheet-badge").innerHTML = art ? `<img src="${art}" alt="">` : `<span class="sheet-noart"></span>`;
  const tierEl = $("sheet-tier");
  tierEl.textContent = b.earned ? (TIERS[b.tier]?.label || "") : "Locked";
  tierEl.hidden = false;

  $("sheet-name").textContent = b.earned ? b.name : "Not yet earned";
  $("sheet-desc").textContent = b.earned
    ? (b.description || "")
    : (b.hint || "Keep going — this one is still waiting.");

  const meta = [];
  if (b.earned && b.earnedDate) meta.push(`<div><dt>Earned</dt><dd>${formatDate(b.earnedDate)}</dd></div>`);
  if (b.earned) meta.push(`<div><dt>Number</dt><dd>#${b._num} of ${b._total}</dd></div>`);
  $("sheet-meta").innerHTML = meta.join("");

  scrim.hidden = false; sheet.hidden = false;
  if (navigator.vibrate) navigator.vibrate(8);
}
function closeSheet() {
  openBadge = null; $("sheet").hidden = true; $("scrim").hidden = true; }

/* ---------- helpers ---------- */
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------- boot ---------- */
$("sheet-close").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

loadData().then(render);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
