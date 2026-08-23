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

  // Step 2 — find the rim. The medallion is a true circle, so fit one rather than trusting
  // the leftover blob, which still has the drop shadow stuck to it. The signal that
  // separates them is detail, not colour or brightness: the badge is full of edges, while
  // the page and its shadow are smooth ramps. So take the outermost *edge* pixel along each
  // angle — that is the rim — and fit a circle through those points.
  const lum = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) lum[p] = d[p*4] * .299 + d[p*4+1] * .587 + d[p*4+2] * .114;

  const EDGE = 26;
  let ecx = 0, ecy = 0, ecount = 0;
  const edge = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    const g = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + W] - lum[p - W]);
    if (g > EDGE) { edge[p] = 1; ecx += x; ecy += y; ecount++; }
  }
  if (ecount < 500) return null;
  ecx /= ecount; ecy /= ecount;

  // outermost edge pixel per angle, ignoring specks with no edge neighbours
  const RAYS = 720, far = new Float64Array(RAYS), fx = new Float64Array(RAYS), fy = new Float64Array(RAYS);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    if (!edge[p]) continue;
    if (edge[p-1] + edge[p+1] + edge[p-W] + edge[p+W] < 2) continue;   // isolated noise
    const dx = x - ecx, dy = y - ecy, r = Math.hypot(dx, dy);
    let k = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * RAYS);
    if (k >= RAYS) k = RAYS - 1;
    if (r > far[k]) { far[k] = r; fx[k] = x; fy[k] = y; }
  }
  let pts = [];
  for (let k = 0; k < RAYS; k++) if (far[k] > 0) pts.push([fx[k], fy[k]]);
  if (pts.length < RAYS * 0.5) return null;

  // algebraic circle fit, twice, dropping points that miss the fitted radius
  let bcx = ecx, bcy = ecy, R = 0;
  for (let pass = 0; pass < 3; pass++) {
    let Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sxz=0,Syz=0,Sz=0;
    const n = pts.length;
    for (const [x, y] of pts) {
      const z = x*x + y*y;
      Sx+=x; Sy+=y; Sxx+=x*x; Syy+=y*y; Sxy+=x*y; Sxz+=x*z; Syz+=y*z; Sz+=z;
    }
    const m = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], v = [Sxz, Syz, Sz];
    for (let i = 0; i < 3; i++) {                        // gaussian elimination
      let p = i;
      for (let j = i+1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
      [m[i], m[p]] = [m[p], m[i]]; [v[i], v[p]] = [v[p], v[i]];
      if (!m[i][i]) return null;
      for (let j = i+1; j < 3; j++) {
        const f = m[j][i] / m[i][i];
        for (let c = i; c < 3; c++) m[j][c] -= f * m[i][c];
        v[j] -= f * v[i];
      }
    }
    const sol = [0,0,0];
    for (let i = 2; i >= 0; i--) {
      let t = v[i];
      for (let c = i+1; c < 3; c++) t -= m[i][c] * sol[c];
      sol[i] = t / m[i][i];
    }
    bcx = sol[0] / 2; bcy = sol[1] / 2;
    R = Math.sqrt(Math.max(0, sol[2] + bcx*bcx + bcy*bcy));
    if (pass < 2) {
      const tol = Math.max(3, R * 0.04);
      const keep = pts.filter(([x,y]) => Math.abs(Math.hypot(x-bcx, y-bcy) - R) <= tol);
      if (keep.length < RAYS * 0.4) break;
      pts = keep;
    }
  }
  if (!(R > Math.min(W, H) * 0.15) || R > Math.max(W, H) * 0.6) return null;

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
