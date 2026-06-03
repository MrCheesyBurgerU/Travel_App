// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CAT_EMOJI = { food: "🍽️", activity: "🎉", place: "📍" };
const CAT_LABEL = { food: "Comida", activity: "Actividad", place: "Lugar" };

// Nominatim requires at most 1 req/s — debounce covers this
const SEARCH_DEBOUNCE_MS = 420;

// Matches "19.4326, -99.1332" / "19.4326,-99.1332" / "19.4326 -99.1332"
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;


// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let entries        = [];
let currentFilter  = "all";
let currentRating  = 3;
let editingId      = null;
let tempMarker     = null;
let markers        = {};        // entry.id → Leaflet marker
let pendingLatLng  = null;
let pendingCountry = null;      // resolved by reverse-geocode or Nominatim search
let pendingCountryCode = null;
let currentRole    = "admin";   // updated after /api/me resolves


// ═══════════════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════════════

const map = L.map("map", { zoomControl: false }).setView([20, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

map.on("click", (ev) => {
  if (currentRole !== "admin") { showAuthToast(); return; }
  pendingLatLng = ev.latlng;
  openModal(null, ev.latlng.lat, ev.latlng.lng);
});


// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function starsHtml(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-MX", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ISO 3166-1 alpha-2 code → flag emoji (e.g. "MX" → 🇲🇽)
function countryFlag(code) {
  if (!code || code.length !== 2) return "🌍";
  return [...code.toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join("");
}

function makeIcon(cat) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-icon marker-${cat}"></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  });
}

function entryCardHtml(e) {
  return `
    <div class="entry-card cat-${e.category}" data-category="${e.category}" onclick="openView(${e.id})">
      <div class="entry-card-header">
        <span class="entry-card-title">${CAT_EMOJI[e.category]} ${e.title}</span>
        <span class="entry-card-stars">${starsHtml(e.rating)}</span>
      </div>
      <div class="entry-card-meta">
        <span class="cat-badge cat-${e.category}">${CAT_LABEL[e.category]}</span>
        ${e.location_name ? `<span>📌 ${e.location_name}</span>` : ""}
      </div>
    </div>`;
}


// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function fetchEntries() {
  // Resolve role and entries in parallel
  const [roleData, data] = await Promise.all([
    apiFetch("/api/me").catch(() => ({ role: "admin" })),
    apiFetch("/api/entries"),
  ]);
  currentRole = roleData.role;
  entries = data;
  applyRoleUI();
  render();
  entries.length > 0 ? fitToEntries() : tryGeolocation();
}

function applyRoleUI() {
  const btn = document.getElementById("auth-btn"); // null when auth is disabled locally
  if (currentRole === "admin") {
    if (btn) { btn.textContent = "⎋ Salir"; btn.classList.add("auth-admin"); }
    document.getElementById("map").style.cursor = "";
    document.getElementById("hint").style.display = "";
  } else {
    if (btn) { btn.textContent = "🔐"; btn.classList.remove("auth-admin"); }
    document.getElementById("map").style.cursor = "grab";
    document.getElementById("hint").style.display = "none";
  }
}

const saveEntry   = (data) => apiFetch("/api/entries", { method: "POST", body: JSON.stringify(data) });
const updateEntry = (id, data) => apiFetch(`/api/entries/${id}`, { method: "PUT", body: JSON.stringify(data) });
const deleteEntry = (id) => apiFetch(`/api/entries/${id}`, { method: "DELETE" });

function fitToEntries() {
  map.fitBounds(entries.map(e => [e.lat, e.lng]), { padding: [50, 50], maxZoom: 14 });
}

function tryGeolocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => map.flyTo([coords.latitude, coords.longitude], 13, { duration: 1.5 }),
    () => {}  // silently ignore denial
  );
}

// Silent reverse-geocode — updates pendingCountry / pendingCountryCode in background
async function reverseGeocode(lat, lng) {
  try {
    const data = await apiFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
    );
    pendingCountry     = data.address?.country      || null;
    pendingCountryCode = data.address?.country_code?.toUpperCase() || null;
  } catch {
    pendingCountry = pendingCountryCode = null;
  }
}


// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

function render() {
  renderStats();
  renderList();
  renderMarkers();
}

function renderStats() {
  const total     = entries.length;
  const countries = new Set(entries.map(e => e.country).filter(Boolean)).size;

  document.getElementById("stat-total").textContent     = total;
  document.getElementById("stat-countries").textContent = countries;

  ["all", "food", "activity", "place"].forEach(cat => {
    const n = cat === "all" ? total : entries.filter(e => e.category === cat).length;
    const badge = document.getElementById(`badge-${cat}`);
    if (badge) badge.textContent = n > 0 ? n : "";
  });
}

function renderList() {
  const list = document.getElementById("entry-list");
  const filtered = currentFilter === "all"
    ? entries
    : entries.filter(e => e.category === currentFilter);

  if (filtered.length === 0) {
    const msg = currentFilter === "all"
      ? "Sin entradas aún.<br>¡Haz clic en el mapa para agregar la primera! 🌟"
      : `Sin entradas de ${CAT_LABEL[currentFilter]} aún.`;
    list.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  // Group by country, preserving recency order (API returns newest-first)
  const grouped = new Map();
  for (const e of filtered) {
    const key = e.country || "__none__";
    if (!grouped.has(key)) {
      grouped.set(key, {
        label: e.country      || "Sin país",
        code:  e.country_code || null,
        items: [],
      });
    }
    grouped.get(key).items.push(e);
  }

  list.innerHTML = [...grouped.values()].map(group => {
    const { items } = group;
    const total = items.length;
    const label = total === 1 ? "lugar" : "lugares";
    const globalAvg = (items.reduce((s, e) => s + e.rating, 0) / total).toFixed(1);

    // Per-category: count + average rating (only categories with entries)
    const catStat = (cat, emoji) => {
      const sub = items.filter(e => e.category === cat);
      if (!sub.length) return null;
      const avg = (sub.reduce((s, e) => s + e.rating, 0) / sub.length).toFixed(1);
      return `<span class="ch-cat">${emoji} ${sub.length} <span class="ch-cat-avg">⭐${avg}</span></span>`;
    };
    const cats = [
      catStat("food",     "🍽️"),
      catStat("activity", "🎉"),
      catStat("place",    "📍"),
    ].filter(Boolean).join(`<span class="cs">·</span>`);

    const hasCat  = (cat) => items.some(e => e.category === cat);
    const ccBtn   = (cat, label) => hasCat(cat)
      ? `<button class="cc-filter" data-cat="${cat}">${label}</button>`
      : "";

    return `
      <div class="country-group">
        <div class="country-header">
          <div class="ch-row">
            <span class="country-name">${countryFlag(group.code)} ${group.label}</span>
            <span class="country-count">${total} ${label} · ⭐${globalAvg}</span>
          </div>
          <div class="ch-stats">${cats}</div>
          <div class="country-cat-filters">
            <button class="cc-filter active" data-cat="all">Todos</button>
            ${ccBtn("food",     "🍽️ Comida")}
            ${ccBtn("activity", "🎉 Actividad")}
            ${ccBtn("place",    "📍 Lugar")}
          </div>
          <div class="country-search-wrap">
            <span class="country-search-icon">🔍</span>
            <input class="country-search" type="text"
                   placeholder="Buscar en ${group.label}…" autocomplete="off" />
            <button class="country-search-clear hidden" tabindex="-1">✕</button>
          </div>
        </div>
        ${items.map(entryCardHtml).join("")}
        <div class="country-no-results hidden">Sin resultados</div>
      </div>`;
  }).join("");
}

// ── Per-country search (event delegation — wired once, works for all groups) ──
const entryList = document.getElementById("entry-list");

entryList.addEventListener("input", (e) => {
  if (e.target.classList.contains("country-search"))
    filterGroup(e.target.closest(".country-group"));
});

entryList.addEventListener("click", (e) => {
  // Clear search
  if (e.target.classList.contains("country-search-clear")) {
    const group = e.target.closest(".country-group");
    group.querySelector(".country-search").value = "";
    filterGroup(group);
    return;
  }
  // Per-country category filter
  if (e.target.classList.contains("cc-filter")) {
    const group = e.target.closest(".country-group");
    group.querySelectorAll(".cc-filter").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    group.dataset.catFilter = e.target.dataset.cat;
    filterGroup(group);
  }
});

function filterGroup(group) {
  const q         = group.querySelector(".country-search")?.value.trim().toLowerCase() || "";
  const catFilter = group.dataset.catFilter || "all";
  const clearBtn  = group.querySelector(".country-search-clear");
  const noResult  = group.querySelector(".country-no-results");

  if (clearBtn) clearBtn.classList.toggle("hidden", !q);

  let visible = 0;
  group.querySelectorAll(".entry-card").forEach(card => {
    const matchSearch = !q || card.textContent.toLowerCase().includes(q);
    const matchCat    = catFilter === "all" || card.dataset.category === catFilter;
    const show        = matchSearch && matchCat;
    card.style.display = show ? "" : "none";
    if (show) visible++;
  });

  if (noResult) noResult.classList.toggle("hidden", visible > 0);
}

function renderMarkers() {
  const currentIds = new Set(entries.map(e => e.id));
  for (const [id, m] of Object.entries(markers)) {
    if (!currentIds.has(Number(id))) { map.removeLayer(m); delete markers[id]; }
  }
  for (const e of entries) {
    if (markers[e.id]) continue;
    const m = L.marker([e.lat, e.lng], { icon: makeIcon(e.category) }).addTo(map);
    m.on("click", () => openView(e.id));
    markers[e.id] = m;
  }
}


// ═══════════════════════════════════════════════════════════════
// ENTRY FORM MODAL
// ═══════════════════════════════════════════════════════════════

function openModal(entry, lat, lng, prefillLocation = "") {
  editingId = entry ? entry.id : null;

  // When editing, country is already stored — don't overwrite
  if (entry) { pendingCountry = pendingCountryCode = null; }

  document.getElementById("modal-title").textContent     = entry ? "Editar entrada" : "Nueva entrada";
  document.getElementById("edit-id").value               = editingId || "";
  document.getElementById("lat").value                   = lat;
  document.getElementById("lng").value                   = lng;
  document.getElementById("title").value                 = entry ? entry.title : "";
  document.getElementById("location-name").value         = entry ? (entry.location_name || "") : prefillLocation;
  document.getElementById("description").value           = entry ? (entry.description || "") : "";
  document.querySelector(`input[name="category"][value="${entry ? entry.category : "food"}"]`).checked = true;
  setStars(entry ? entry.rating : 3);

  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("title").focus();

  if (!entry) {
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lng], { icon: makeIcon("food"), opacity: 0.6 }).addTo(map);
    // Only reverse-geocode if country not already known (e.g. from a search result)
    if (!pendingCountry) reverseGeocode(lat, lng);
  }
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  pendingLatLng = pendingCountry = pendingCountryCode = editingId = null;
}

document.getElementById("cancel-btn").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});

// ── Star rating input ─────────────────────────────────────────
function setStars(n) {
  currentRating = n;
  document.getElementById("rating").value = n;
  document.querySelectorAll(".star").forEach(s =>
    s.classList.toggle("on", Number(s.dataset.v) <= n)
  );
}

document.querySelectorAll(".star").forEach(s => {
  s.addEventListener("click",      () => setStars(Number(s.dataset.v)));
  s.addEventListener("mouseenter", () => {
    document.querySelectorAll(".star").forEach(x =>
      x.classList.toggle("on", Number(x.dataset.v) <= Number(s.dataset.v))
    );
  });
});
document.getElementById("star-input").addEventListener("mouseleave", () => setStars(currentRating));

// ── Form submit ───────────────────────────────────────────────
document.getElementById("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    title:         document.getElementById("title").value.trim(),
    description:   document.getElementById("description").value.trim(),
    category:      document.querySelector("input[name='category']:checked").value,
    rating:        Number(document.getElementById("rating").value),
    lat:           parseFloat(document.getElementById("lat").value),
    lng:           parseFloat(document.getElementById("lng").value),
    location_name: document.getElementById("location-name").value.trim(),
    country:       pendingCountry,
    country_code:  pendingCountryCode,
  };

  try {
    if (editingId) {
      const updated = await updateEntry(editingId, payload);
      entries = entries.map(e => e.id === editingId ? updated : e);
      if (markers[editingId]) markers[editingId].setIcon(makeIcon(updated.category));
    } else {
      const created = await saveEntry(payload);
      entries.unshift(created);
    }
    closeModal();
    render();
  } catch (err) {
    console.error("Error guardando entrada:", err);
  }
});


// ═══════════════════════════════════════════════════════════════
// VIEW MODAL
// ═══════════════════════════════════════════════════════════════

function openView(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;

  document.getElementById("view-cat-badge").innerHTML =
    `<span class="cat-badge cat-${e.category}">${CAT_EMOJI[e.category]} ${CAT_LABEL[e.category]}</span>`;
  document.getElementById("view-title").textContent       = e.title;
  document.getElementById("view-location").textContent    = e.location_name
    ? `📌 ${e.location_name}`
    : `📌 ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`;
  document.getElementById("view-country").textContent     = e.country
    ? `${countryFlag(e.country_code)} ${e.country}`
    : "";
  document.getElementById("view-stars").textContent       = starsHtml(e.rating) + ` (${e.rating}/5)`;
  document.getElementById("view-description").textContent = e.description || "Sin notas.";
  document.getElementById("view-date").textContent        = "Agregado el " + formatDate(e.created_at);

  const isAdmin = currentRole === "admin";
  document.getElementById("view-delete-btn").classList.toggle("hidden", !isAdmin);
  document.getElementById("view-edit-btn").classList.toggle("hidden", !isAdmin);

  document.getElementById("view-overlay").classList.remove("hidden");
  map.panTo([e.lat, e.lng]);

  document.getElementById("view-delete-btn").onclick = async () => {
    if (!confirm("¿Eliminar esta entrada?")) return;
    try {
      await deleteEntry(e.id);
      if (markers[e.id]) { map.removeLayer(markers[e.id]); delete markers[e.id]; }
      entries = entries.filter(x => x.id !== e.id);
      closeView();
      render();
    } catch (err) {
      console.error("Error eliminando entrada:", err);
    }
  };

  document.getElementById("view-edit-btn").onclick = () => {
    closeView();
    openModal(e, e.lat, e.lng);
  };
}

function closeView() {
  document.getElementById("view-overlay").classList.add("hidden");
}

document.getElementById("close-view").addEventListener("click", closeView);
document.getElementById("view-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("view-overlay")) closeView();
});


// ═══════════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════════

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.cat;
    renderList();
  });
});


// ═══════════════════════════════════════════════════════════════
// SEARCH — place search + coordinate paste
// ═══════════════════════════════════════════════════════════════

let searchDebounce = null;
let searchMarker   = null;

const searchContainer = document.getElementById("map-search");
const searchInput     = document.getElementById("search-input");
const searchResults   = document.getElementById("search-results");
const searchClear     = document.getElementById("search-clear");

// Prevent map events from leaking through the search widget
L.DomEvent.disableClickPropagation(searchContainer);
L.DomEvent.disableScrollPropagation(searchContainer);

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle("hidden", !q);
  clearTimeout(searchDebounce);
  if (q.length < 2) { hideResults(); return; }
  if (tryCoords(q)) return;
  searchDebounce = setTimeout(() => geocode(q), SEARCH_DEBOUNCE_MS);
});

// Instant coordinate detection on paste (no debounce needed)
searchInput.addEventListener("paste", (e) => {
  const pasted = (e.clipboardData || window.clipboardData).getData("text").trim();
  if (pasted) setTimeout(() => { searchClear.classList.remove("hidden"); tryCoords(pasted); }, 0);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape")    { clearSearch(); return; }
  if (e.key === "ArrowDown") { e.preventDefault(); searchResults.querySelector(".search-result-item")?.focus(); }
});

searchClear.addEventListener("click", clearSearch);

// Collapse results when clicking anywhere outside the search widget
document.addEventListener("click", (e) => {
  if (!searchContainer.contains(e.target)) hideResults();
});

// ── Coordinate detection ──────────────────────────────────────
function tryCoords(q) {
  const m = q.match(COORD_RE);
  if (!m) return false;

  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showSearchMsg("⚠️ Coordenadas fuera de rango — lat ±90, lng ±180");
    return true;
  }

  hideResults();
  searchInput.value = `${lat}, ${lng}`;
  map.flyTo([lat, lng], 17, { animate: true, duration: 1 });
  placeSearchMarker(lat, lng, `${lat}, ${lng}`);
  return true;
}

// ── Nominatim place search ────────────────────────────────────
async function geocode(q) {
  try {
    const url = "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q, format: "json", limit: "5", addressdetails: "1" });
    const data = await apiFetch(url);
    showResults(data);
  } catch {
    hideResults();
  }
}

function showResults(results) {
  if (!results.length) { showSearchMsg("No se encontraron lugares"); return; }

  searchResults.innerHTML = results.map(r => {
    const parts   = r.display_name.split(",");
    const name    = parts.slice(0, 3).join(",");
    const sub     = parts.slice(3, 5).join(",").trim();
    const type    = (r.type || r.class || "").replace(/_/g, " ");
    const country = r.address?.country      || "";
    const code    = (r.address?.country_code || "").toUpperCase();
    return `
      <li class="search-result-item" tabindex="0"
          data-lat="${r.lat}" data-lng="${r.lon}"
          data-name="${r.display_name}" data-short="${name}"
          data-country="${country}" data-code="${code}">
        <span class="result-name">${name}</span>
        <span class="result-type">${[type, sub].filter(Boolean).join(" · ")}</span>
      </li>`;
  }).join("");

  searchResults.classList.remove("hidden");

  searchResults.querySelectorAll(".search-result-item").forEach(item => {
    item.addEventListener("click",   () => selectResult(item));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter")     { selectResult(item); return; }
      if (e.key === "Escape")    { clearSearch(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); (item.nextElementSibling || item).focus(); }
      if (e.key === "ArrowUp")   {
        e.preventDefault();
        item.previousElementSibling ? item.previousElementSibling.focus() : searchInput.focus();
      }
    });
  });
}

function showSearchMsg(msg) {
  searchResults.innerHTML = `<li class="search-no-results">${msg}</li>`;
  searchResults.classList.remove("hidden");
}

function selectResult(item) {
  const lat   = parseFloat(item.dataset.lat);
  const lng   = parseFloat(item.dataset.lng);
  searchInput.value = item.dataset.short;
  hideResults();

  // Country already known from Nominatim — skip reverse-geocode later
  pendingCountry     = item.dataset.country || null;
  pendingCountryCode = item.dataset.code    || null;

  map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
  placeSearchMarker(lat, lng, item.dataset.name);
}

// ── Search result marker (pulsing, draggable) ─────────────────
function placeSearchMarker(lat, lng, locationName) {
  if (searchMarker) map.removeLayer(searchMarker);

  searchMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: "",
      html: `<div class="search-marker-icon">📍</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 38],
    }),
    draggable: true,
    zIndexOffset: 1000,
  }).addTo(map);

  const tooltip = currentRole === "admin"
    ? "Clic para registrar — arrastra para ajustar"
    : "Inicia sesión para registrar este lugar";
  const bindTip = () => searchMarker.bindTooltip(tooltip, {
    permanent: true, direction: "top",
    offset: [0, -42], className: "search-tooltip",
  }).openTooltip();

  bindTip();

  searchMarker.on("click", () => {
    if (currentRole !== "admin") { showAuthToast(); return; }
    const pos  = searchMarker.getLatLng();
    const name = locationName.split(",").slice(0, 2).join(",").trim();
    map.removeLayer(searchMarker);
    searchMarker  = null;
    pendingLatLng = pos;
    openModal(null, pos.lat, pos.lng, name);
  });

  searchMarker.on("dragend", () => {
    // Position changed — re-resolve country for new location
    const pos = searchMarker.getLatLng();
    pendingCountry = pendingCountryCode = null;
    reverseGeocode(pos.lat, pos.lng);
    bindTip();
  });
}

function hideResults() {
  searchResults.classList.add("hidden");
  searchResults.innerHTML = "";
}

function clearSearch() {
  searchInput.value = "";
  searchClear.classList.add("hidden");
  hideResults();
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
}


// ═══════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════════

document.getElementById("auth-btn")?.addEventListener("click", () => {
  if (currentRole === "admin") {
    handleLogout();
  } else {
    openLoginModal();
  }
});

function openLoginModal() {
  document.getElementById("login-user").value = "";
  document.getElementById("login-pass").value = "";
  document.getElementById("login-error").classList.add("hidden");
  document.getElementById("login-overlay").classList.remove("hidden");
  document.getElementById("login-user").focus();
}

function closeLoginModal() {
  document.getElementById("login-overlay").classList.add("hidden");
}

document.getElementById("login-cancel-btn").addEventListener("click", closeLoginModal);
document.getElementById("login-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("login-overlay")) closeLoginModal();
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("login-submit-btn");
  btn.disabled = true;
  btn.textContent = "Entrando…";

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("login-user").value,
        password: document.getElementById("login-pass").value,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      currentRole = data.role;
      applyRoleUI();
      closeLoginModal();
      render(); // refresh buttons in open view modal if any
    } else {
      document.getElementById("login-error").textContent = data.error || "Error al iniciar sesión";
      document.getElementById("login-error").classList.remove("hidden");
      document.getElementById("login-pass").value = "";
      document.getElementById("login-pass").focus();
    }
  } catch {
    document.getElementById("login-error").textContent = "Error de conexión";
    document.getElementById("login-error").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

async function handleLogout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  currentRole = "viewer";
  applyRoleUI();
  render();
}

let toastTimer = null;

function showAuthToast() {
  const toast = document.getElementById("auth-toast");
  toast.classList.remove("hidden", "toast-hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("toast-hide"), 4000);
}

document.getElementById("toast-login-btn").addEventListener("click", () => {
  document.getElementById("auth-toast").classList.add("hidden");
  openLoginModal();
});

// ═══════════════════════════════════════════════════════════════
// HINT + INIT
// ═══════════════════════════════════════════════════════════════

setTimeout(() => document.getElementById("hint").classList.add("fade"), 4000);

fetchEntries();
