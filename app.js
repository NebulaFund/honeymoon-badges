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

  // already transparent at the corners → nothing to do
  if ([0, (W - 1) * 4, (H - 1) * W * 4, (W * H - 1) * 4].every(i => d[i + 3] < 8)) return null;

  const WHITE = 238, SOFT = 202;
  const seen = new Uint8Array(W * H), stack = [];
  const push = (x, y) => {
    const p = y * W + x;
    if (seen[p]) return;
    const i = p * 4;
    if (d[i] < WHITE || d[i + 1] < WHITE || d[i + 2] < WHITE) return;
    seen[p] = 1; stack.push(p);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p - x) / W;
    d[p * 4 + 3] = 0;
    if (x > 0)     push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0)     push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }

  // feather the anti-aliased fringe the flood fill leaves behind
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4;
    if (!d[i + 3]) continue;
    const edge = (x > 0 && !d[(p - 1) * 4 + 3]) || (x < W - 1 && !d[(p + 1) * 4 + 3]) ||
                 (y > 0 && !d[(p - W) * 4 + 3]) || (y < H - 1 && !d[(p + W) * 4 + 3]);
    if (!edge) continue;
    const L = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    if (L > SOFT) d[i + 3] = Math.max(0, Math.round(255 * (WHITE - L) / (WHITE - SOFT)));
  }

  // bounding box of what survived
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 10) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;

  // square crop around it, with a little breathing room
  ctx.putImageData(im, 0, 0);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const side = Math.ceil(Math.max(bw, bh) * 1.05);
  const size = Math.min(512, side);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  out.getContext("2d").drawImage(
    cv, x0 - (side - bw) / 2, y0 - (side - bh) / 2, side, side, 0, 0, size, size);
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
