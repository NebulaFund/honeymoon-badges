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
  // Throw out angles whose outermost edge is nowhere near the typical one before fitting.
  // The generated art often carries a sparkle watermark in a corner, far outside the badge;
  // left in, it drags the fitted circle outward for the angles that point at it.
  const radii = [];
  for (let k = 0; k < RAYS; k++) if (far[k] > 0) radii.push(far[k]);
  if (radii.length < RAYS * 0.5) return null;
  const med = radii.slice().sort((a, b) => a - b)[radii.length >> 1];
  let pts = [];
  for (let k = 0; k < RAYS; k++)
    if (far[k] > med * 0.75 && far[k] < med * 1.25) pts.push([fx[k], fy[k]]);
  if (pts.length < RAYS * 0.4) return null;

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
let allBadges = [], tierFilter = null;

function render({ data, stale }) {
  const tray = $("tray");
  if (!data) {
    tray.innerHTML = `<p class="empty-state">Couldn't load the badge list, and there's no saved copy yet.<br>Check the connection and reopen.</p>`;
    return;
  }

  $("case-title").textContent = data.title || "Badge Case";
  document.title = data.title || "Badge Case";

  allBadges = (data.badges || []).slice().sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;        // earned first
    if (a.earned) return (b.earnedDate || "").localeCompare(a.earnedDate || ""); // newest first
    return (TIERS[a.tier]?.order ?? 99) - (TIERS[b.tier]?.order ?? 99);
  });

  const earned = allBadges.filter(b => b.earned);
  // number each earned badge by the order she got it — "#3 of 12"
  earned.slice().sort((a, b) => (a.earnedDate || "").localeCompare(b.earnedDate || ""))
        .forEach((b, i) => { b._num = i + 1; b._total = allBadges.length; });
  const pct = allBadges.length ? Math.round((earned.length / allBadges.length) * 100) : 0;

  $("case-subtitle").textContent = data.subtitle || `${earned.length} badges collected`;
  $("ring-pct").textContent = pct + "%";
  $("ring-count").textContent = `${earned.length} / ${allBadges.length}`;
  const C = 2 * Math.PI * 43;
  requestAnimationFrame(() => { $("ring-fill").style.strokeDashoffset = C * (1 - pct / 100); });

  // the tier counters double as filters: tap one to see only that tier, tap again for all
  $("tier-bar").innerHTML = Object.entries(TIERS).map(([key, t]) => {
    const n = earned.filter(b => b.tier === key).length;
    return `<button type="button" class="tier-chip" data-t="${key}" aria-pressed="false"
              aria-label="${t.label}: ${n} earned"${n ? "" : " disabled"}><i></i><b>${n}</b></button>`;
  }).join("");
  $("tier-bar").querySelectorAll(".tier-chip").forEach(chip =>
    chip.addEventListener("click", () => {
      tierFilter = tierFilter === chip.dataset.t ? null : chip.dataset.t;
      drawTray();
    }));

  drawTray();
  $("foot-note").textContent = stale ? "Showing your saved copy — offline" : (data.footer || "");
}

function drawTray() {
  const tray = $("tray");
  document.querySelectorAll(".tier-chip").forEach(c => {
    const on = c.dataset.t === tierFilter;
    c.classList.toggle("on", on);
    c.setAttribute("aria-pressed", String(on));
  });
  $("tier-bar").classList.toggle("filtering", !!tierFilter);

  // a filter shows only earned badges of that tier; locked slots have no tier to match
  const visible = tierFilter ? allBadges.filter(b => b.earned && b.tier === tierFilter) : allBadges;
  const swipeable = visible.filter(b => b.earned);

  tray.innerHTML = "";
  if (tierFilter) {
    const t = TIERS[tierFilter];
    const note = document.createElement("div");
    note.className = "filter-note";
    note.innerHTML = `<span><i style="--dot:${t.glow}"></i>${t.label} · ${visible.length} badge${visible.length === 1 ? "" : "s"}</span>
                      <button type="button">Show all</button>`;
    note.querySelector("button").addEventListener("click", () => { tierFilter = null; drawTray(); });
    tray.appendChild(note);
  }

  visible.forEach(b => {
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
    if (b.image) prepareArt(b.image).then(url => { el.querySelector("img").src = url; });
    // earned badges open into a viewer she can swipe through; a locked one opens on its own
    el.addEventListener("click", () =>
      b.earned ? openViewer(swipeable, swipeable.indexOf(b)) : openViewer([b], 0));
    tray.appendChild(el);
  });
}

/* ---------- viewer ----------
   Full screen, one badge per page, swipe sideways through whatever the case is showing.
   Paging is native horizontal scroll-snap, so it moves with the phone's own momentum. */
let viewerList = [], viewerIndex = 0;

function slideHTML(b) {
  const t = TIERS[b.tier];
  const meta = [];
  if (b.earned && b.earnedDate) meta.push(`<div><dt>Earned</dt><dd>${formatDate(b.earnedDate)}</dd></div>`);
  if (b.earned) meta.push(`<div><dt>Number</dt><dd>#${b._num} of ${b._total}</dd></div>`);
  const desc = b.earned ? (b.description || "") : (b.hint || "Keep going — this one is still waiting.");
  return `
    <article class="slide" data-earned="${!!b.earned}" style="--glow:${t?.glow || "#cfa64f"}">
      <div class="slide-badge">${b.image ? '<img alt="">' : '<span class="slide-noart"></span>'}</div>
      <div class="slide-text">
        <span class="tier-pill">${b.earned ? (t?.label || "") : "Locked"}</span>
        <h2>${b.earned ? escapeHtml(b.name) : "Not yet earned"}</h2>
        <p class="slide-desc">${escapeHtml(desc)}</p>
        <dl class="slide-meta">${meta.join("")}</dl>
      </div>
    </article>`;
}

function openViewer(list, index) {
  viewerList = list;
  const track = $("viewer-track");
  track.innerHTML = list.map(slideHTML).join("");
  track.querySelectorAll(".slide").forEach((slide, i) => {
    const img = slide.querySelector("img");
    if (img) prepareArt(list[i].image).then(url => { img.src = url; });
  });
  $("viewer").hidden = false;
  document.body.classList.add("viewing");
  track.scrollLeft = index * track.clientWidth;      // after unhiding, so the width is real
  syncViewer();
  $("viewer-close").focus({ preventScroll: true });
  if (navigator.vibrate) navigator.vibrate(8);
}

function closeViewer() {
  $("viewer").hidden = true;
  document.body.classList.remove("viewing");
  $("viewer-track").innerHTML = "";
}

function syncViewer() {
  const track = $("viewer-track"), n = viewerList.length;
  viewerIndex = Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  $("viewer-count").textContent = n > 1 ? `${viewerIndex + 1} / ${n}` : "";
  $("viewer-prev").hidden = n < 2 || viewerIndex === 0;
  $("viewer-next").hidden = n < 2 || viewerIndex === n - 1;
}

function step(dir) {
  const track = $("viewer-track");
  track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" });
}

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
$("viewer-close").addEventListener("click", closeViewer);
$("viewer-prev").addEventListener("click", () => step(-1));
$("viewer-next").addEventListener("click", () => step(1));
$("viewer-track").addEventListener("scroll", () => requestAnimationFrame(syncViewer), { passive: true });
document.addEventListener("keydown", e => {
  if ($("viewer").hidden) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
});
// keep the same badge in view when the phone rotates
addEventListener("resize", () => {
  if ($("viewer").hidden) return;
  const track = $("viewer-track");
  track.scrollLeft = viewerIndex * track.clientWidth;
});

loadData().then(render);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
