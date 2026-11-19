"use strict";

/* ===================== Utilidades ===================== */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km");
const fmtMin = (sec) => (sec < 60 ? "< 1 min" : Math.round(sec / 60) + " min");
const fmtTime = (ms) => new Date(ms).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
const ROLE_NAME = { pasajero: "Pasajero", camion: "Chofer de camión", taxi: "Taxista" };

// Solo reemplaza el HTML si cambió (así no se pierden toques en botones que se redibujan)
function setHTML(el, html) { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }

function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

function modal(html, actions = [["Listo", "primary"]]) {
  $("#modalBody").innerHTML = html;
  const box = $("#modalActions");
  box.innerHTML = "";
  actions.forEach(([label, cls, fn]) => {
    const b = document.createElement("button");
    b.className = "btn " + cls; b.type = "button"; b.textContent = label;
    b.onclick = async () => {
      if (fn) { try { if (await fn() === false) return; } catch (e) { return showError(e); } }
      $("#modal").close();
    };
    box.appendChild(b);
  });
  if (!$("#modal").open) $("#modal").showModal();
}
function showError(e) {
  if (!(e instanceof Store.AppError)) console.error(e);
  const msg = e instanceof Store.AppError ? e.message : "Algo salió mal. Intenta de nuevo.";
  if ($("#modal").open) { const p = $("#modalBody .error") ?? $("#modalBody").appendChild(Object.assign(document.createElement("p"), { className: "error" })); p.textContent = msg; }
  else toast("⚠️ " + msg);
}
async function run(fn) { try { await fn(); } catch (e) { showError(e); } }

/* ===================== Estado ===================== */
const S = {
  user: null, view: null,
  me: [CONFIG.center[0] - 0.004, CONFIG.center[1] - 0.006], meSource: "ejemplo", gpsWatch: null,
  pickMode: false, drivers: [], trip: null,
  filters: { camion: true, taxi: true, routes: new Set(ROUTES.map((r) => r.id)) },
  routeId: ROUTES[0].id, stopIdx: 0, destIdx: 0,
  // Solo choferes
  duty: false, pos: null, posSource: null, s: null, simulate: false, dwell: 0, wander: null,
};
// Avisos de fin de viaje ya mostrados (por usuario, para no repetirlos en otra pestaña)
const shownKey = (id) => `muevet_shown_${S.user.id}_${id}`;
const wasShown = (id) => { try { return !!localStorage.getItem(shownKey(id)); } catch { return false; } };
const markShown = (id) => { try { localStorage.setItem(shownKey(id), "1"); } catch {} };

/* ===================== Inicio de sesión / registro ===================== */
function initAuth() {
  $("#registerForm [name=routeId]").innerHTML = ROUTES.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");

  $$("[data-auth]").forEach((b) => b.addEventListener("click", () => {
    $$("[data-auth]").forEach((x) => x.classList.toggle("active", x === b));
    $("#loginForm").classList.toggle("hidden", b.dataset.auth !== "login");
    $("#registerForm").classList.toggle("hidden", b.dataset.auth !== "register");
  }));

  const syncRole = () => {
    const role = $("#registerForm [name=role]:checked").value;
    $$("#registerForm .driver-only").forEach((el) => el.classList.toggle("hidden", role === "pasajero"));
    $$("#registerForm .camion-only").forEach((el) => el.classList.toggle("hidden", role !== "camion"));
    $("[data-plate-label]").textContent = role === "camion" ? "Número de unidad (económico)" : "Placas del taxi";
  };
  $$("#registerForm [name=role]").forEach((r) => r.addEventListener("change", syncRole));

  const submit = (form, fn) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form), err = $("[data-error]", form);
    err.textContent = ""; btn.disabled = true;
    try { await fn(Object.fromEntries(new FormData(form))); form.reset(); syncRole(); }
    catch (ex) { err.textContent = ex instanceof Store.AppError ? ex.message : "No se pudo completar. Intenta de nuevo."; if (!(ex instanceof Store.AppError)) console.error(ex); }
    finally { btn.disabled = false; }
  });
  submit($("#loginForm"), async (f) => enterApp(await Store.login(f.email, f.password, !!f.remember)));
  submit($("#registerForm"), async (f) => {
    const user = await Store.register(f);
    enterApp(user);
    toast(user.role === "pasajero" ? `¡Bienvenido, ${user.name}! Te regalamos ${money(CONFIG.welcomeBonus)} de saldo.` : `¡Bienvenido, ${user.name}! Activa "En servicio" para aparecer en el mapa.`, 5000);
  });
}

function enterApp(user) {
  S.user = user;
  $("#authScreen").classList.add("hidden");
  $("#appScreen").classList.remove("hidden");
  initMap();
  map.invalidateSize();
  const views = VIEWS[user.role];
  $("#tabs").innerHTML = views.map(([id, icon, label]) => `<button class="tab" data-view="${id}" type="button">${icon}<span>${label}</span></button>`).join("");
  $$("#tabs .tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  if (user.role === "pasajero") startPassengerGps();
  else S.pos = user.role === "camion" ? routeById(user.routeId).stops[0].slice(1) : [...CONFIG.center];
  show(views[0][0]);
  tick();
}

async function logout() {
  if (S.duty) setDuty(false);
  if (S.gpsWatch != null) navigator.geolocation.clearWatch(S.gpsWatch);
  Object.assign(S, { user: null, view: null, gpsWatch: null, duty: false, pickMode: false, simulate: false, trip: null });
  await Store.logout();
  $("#appScreen").classList.add("hidden");
  $("#authScreen").classList.remove("hidden");
  $("[data-auth=login]").click();
}

/* ===================== Mapa ===================== */
let map, meMarker, tripLine, selectedLine;
const markers = new Map();
const stopLayers = {};

function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true }).setView(CONFIG.center, 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  map.zoomControl.setPosition("bottomleft");

  ROUTES.forEach((r) => {
    L.polyline(r.stops.map((s) => s.slice(1)), { color: r.color, weight: 4, opacity: 0.45 }).addTo(map).bindTooltip(r.name, { sticky: true });
    stopLayers[r.id] = L.layerGroup(r.stops.slice(0, r.terminal + 1).map((s, i) =>
      L.circleMarker(s.slice(1), { radius: 5, color: r.color, fillColor: "#fff", fillOpacity: 1, weight: 3 })
        .bindTooltip(`${esc(s[0])} · ${r.id}`)
        .on("click", () => { if (S.user?.role === "pasajero") { S.routeId = r.id; S.stopIdx = i; show("bus"); } }))).addTo(map);
  });
  selectedLine = L.polyline([], { weight: 7, opacity: 0.95 });
  tripLine = L.polyline([], { color: "#ffb400", weight: 4, dashArray: "8 8" });

  meMarker = L.marker(S.me, { icon: L.divIcon({ className: "me-icon", iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(map).bindTooltip("Tú");

  map.on("click", (e) => {
    if (!S.pickMode) return;
    const p = [e.latlng.lat, e.latlng.lng];
    if (S.user.role === "pasajero") { S.me = p; S.meSource = "manual"; }
    else { S.pos = p; S.posSource = "manual"; S.simulate = false; S.s = null; }
    setPickMode(false);
    toast("📍 Ubicación actualizada");
    tick();
  });
  $("#locateBtn").addEventListener("click", () => map.flyTo(myPos(), 16));
  $("#pickBtn").addEventListener("click", () => setPickMode(!S.pickMode));
  $("#allBtn").addEventListener("click", () => map.fitBounds(L.latLngBounds(ROUTES.flatMap((r) => r.stops.map((s) => s.slice(1)))), { padding: [20, 20] }));
}

const myPos = () => (S.user?.role === "pasajero" ? S.me : S.pos ?? S.me);

function setPickMode(on) {
  S.pickMode = on;
  $("#pickBtn").classList.toggle("active", on);
  $("#map").classList.toggle("picking", on);
  banner(on ? "Toca el mapa para poner tu ubicación" : null);
}
function banner(msg) { const b = $("#mapBanner"); b.textContent = msg ?? ""; b.classList.toggle("hidden", !msg); }

function driverIcon(d, self) {
  const r = d.kind === "camion" ? routeById(d.routeId) : null;
  const html = d.kind === "camion"
    ? `<div class="veh${self ? " self" : ""}" style="--c:${r?.color ?? "#555"}"><span>🚌</span><b>${esc(d.routeId)}</b></div>`
    : `<div class="veh taxi${d.busy ? " busy" : ""}${self ? " self" : ""}"><span>🚕</span>${self ? "<b>Tú</b>" : ""}</div>`;
  return L.divIcon({ className: "veh-wrap", html, iconSize: [40, 28], iconAnchor: [20, 14] });
}

function driverInfo(d) {
  const km = Geo.distKm(myPos(), [d.lat, d.lng]);
  const r = d.kind === "camion" ? routeById(d.routeId) : null;
  let extra;
  if (r) {
    const at = d.s != null ? r.stops[Geo.lastStopIdx(r, d.s)][0] : null;
    extra = `${esc(r.name)}${at ? `<br>${d.dwell > 0 ? "Detenido en" : "Pasó por"} ${esc(at)}` : ""}`;
  } else extra = `${d.busy ? "🔴 Ocupado" : "🟢 Libre"}${d.rating ? ` · ⭐ ${d.rating}` : ""} · llega en ${fmtMin(Geo.taxiEtaSec(km))}`;
  return `<b>${esc(d.name)}</b>${d.demo ? ' <span class="tag">demo</span>' : ""}<br>
    ${d.kind === "camion" ? "Unidad" : "Placas"} ${esc(d.plate)}<br>${extra}<br>
    <span class="muted">A ${fmtDist(km)} de ti</span>`;
}

const visible = (d) => (d.kind === "taxi" ? S.filters.taxi : S.filters.camion && S.filters.routes.has(d.routeId));

function updateMap() {
  const seen = new Set();
  for (const d of S.drivers) {
    const self = S.user && d.id === S.user.id;
    if (self || !visible(d)) continue;
    seen.add(d.id);
    let m = markers.get(d.id);
    const key = `${d.kind}|${d.routeId}|${d.busy}`;
    if (!m) {
      m = L.marker([d.lat, d.lng], { icon: driverIcon(d) }).bindPopup(() => driverInfo(m.driver)).addTo(map);
      markers.set(d.id, m);
    } else {
      m.setLatLng([d.lat, d.lng]);
      if (m.key !== key) m.setIcon(driverIcon(d));
      if (m.isPopupOpen()) m.setPopupContent(driverInfo(d));
    }
    m.driver = d; m.key = key;
  }
  for (const [id, m] of markers) if (!seen.has(id)) { map.removeLayer(m); markers.delete(id); }

  // El propio usuario: punto azul (pasajero) o su vehículo (chofer)
  if (S.user?.role === "pasajero") { meMarker.setLatLng(S.me); meMarker.setIcon(L.divIcon({ className: "me-icon", iconSize: [18, 18] })); }
  else if (S.user) {
    meMarker.setLatLng(S.pos);
    const key = "self" + S.duty;
    if (meMarker.key !== key) {
      meMarker.setIcon(driverIcon({ kind: S.user.role, routeId: S.user.routeId }, true));
      meMarker.setOpacity(S.duty ? 1 : 0.5); meMarker.key = key;
    }
  }

  // Línea del viaje en taxi
  const t = S.trip;
  if (t && ["accepted", "arrived", "ontrip", "requested"].includes(t.status)) {
    const taxiPos = S.user.role === "taxi" ? S.pos : (() => { const d = S.drivers.find((x) => x.id === t.driverId); return d ? [d.lat, d.lng] : null; })();
    const dest = [t.dest.lat, t.dest.lng];
    const pts = t.status === "ontrip" ? [taxiPos, dest] : [taxiPos, t.pickup, dest];
    tripLine.setLatLngs(pts.filter(Boolean)).addTo(map);
  } else tripLine.remove();

  // Ruta seleccionada resaltada
  if (S.view === "bus" || (S.view === "service" && S.user.role === "camion")) {
    const r = routeById(S.view === "bus" ? S.routeId : S.user.routeId);
    selectedLine.setLatLngs(r.stops.map((s) => s.slice(1))).setStyle({ color: r.color }).addTo(map);
  } else selectedLine.remove();
}

/* ===================== GPS ===================== */
function startPassengerGps() {
  if (!("geolocation" in navigator)) return;
  S.gpsWatch = navigator.geolocation.watchPosition((p) => {
    if (S.meSource === "manual") return;
    const here = [p.coords.latitude, p.coords.longitude];
    if (Geo.distKm(here, CONFIG.center) > 40) {
      if (S.meSource !== "fuera") toast("Estás fuera de la zona de servicio. Usamos una ubicación de ejemplo; puedes cambiarla con ✋.", 6000);
      S.meSource = "fuera"; return;
    }
    S.me = here; S.meSource = "gps";
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function setDuty(on) {
  S.duty = on;
  if (on) {
    if ("geolocation" in navigator && !S.simulate) {
      S.posSource = S.posSource === "manual" ? "manual" : "buscando";
      S.gpsWatch = navigator.geolocation.watchPosition((p) => {
        if (S.simulate || S.posSource === "manual") return;
        const here = [p.coords.latitude, p.coords.longitude];
        if (S.user.role === "camion") {
          const proj = Geo.projectOnRoute(routeById(S.user.routeId), here, S.s);
          S.s = proj.d < 0.3 ? proj.s : null; // a más de 300 m de la ruta = fuera de ruta
        }
        S.pos = here; S.posSource = "gps";
      }, () => { if (S.posSource === "buscando") S.posSource = "sin-gps"; }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    }
    publishLocation();
  } else {
    if (S.gpsWatch != null) navigator.geolocation.clearWatch(S.gpsWatch);
    S.gpsWatch = null;
    Store.clearLocation(S.user.id);
  }
}

function publishLocation() {
  if (!S.duty || !S.pos) return;
  if (S.user.role === "camion" && S.s == null && S.posSource !== "gps") {
    const proj = Geo.projectOnRoute(routeById(S.user.routeId), S.pos, null);
    S.s = proj.d < 0.3 ? proj.s : null;
  }
  Store.setLocation(S.user, { lat: S.pos[0], lng: S.pos[1], s: S.s });
}
window.addEventListener("pagehide", () => { if (S.duty) Store.clearLocation(S.user.id); });

// "Simular recorrido": mueve al chofer solo, útil para probar sin salir a la calle
function simulateDriver(dt) {
  if (S.user.role === "camion") {
    const r = routeById(S.user.routeId);
    if (S.s == null) S.s = Geo.projectOnRoute(r, S.pos, null).s;
    if (S.dwell > 0) { S.dwell = Math.max(0, S.dwell - dt); return; }
    const before = Geo.lastStopIdx(r, S.s);
    S.s += (CONFIG.busSpeedKmh / 3600) * dt * 4; // x4 para que se note
    if (S.s >= r.length) { S.s = 0; S.dwell = 10; }
    else if (Geo.lastStopIdx(r, S.s) > before) S.dwell = 10;
    S.pos = Geo.posOnRoute(r, S.s);
  } else {
    const t = S.trip;
    const target = t?.status === "accepted" ? t.pickup : t?.status === "ontrip" ? [t.dest.lat, t.dest.lng]
      : t?.status === "arrived" ? null : (S.wander ??= [CONFIG.center[0] + (Math.random() - 0.5) * 0.03, CONFIG.center[1] + (Math.random() - 0.5) * 0.04]);
    if (!target) return;
    S.pos = Geo.moveToward(S.pos, target, (CONFIG.taxiSpeedKmh / 3600) * dt * 6);
    if (target === S.wander && Geo.distKm(S.pos, target) < 0.01) S.wander = null;
  }
}

/* ===================== Ciclo en tiempo real ===================== */
let ticking = false, lastTick = Date.now();
async function tick() {
  if (!S.user || ticking) return;
  ticking = true;
  try {
    const now = Date.now(), dt = Math.min(5, (now - lastTick) / 1000); lastTick = now;
    if (S.user.role === "pasajero") await Sim.tickTrips(dt);
    else if (S.duty && S.simulate) simulateDriver(dt);
    publishLocation();

    const busy = await Store.busyDriverIds();
    S.drivers = [...Sim.drivers(now, busy, Store.activeBotTrips()), ...Store.liveDrivers().map((d) => ({ ...d, busy: busy.has(d.id) }))];
    S.user = (await Store.getUser(S.user.id)) ?? S.user;
    const prev = S.trip;
    S.trip = await Store.currentTrip(S.user);
    notifyTrip(prev, S.trip);

    $("#walletChip").textContent = money(S.user.balance);
    updateMap();
    VIEW_IMPL[S.view]?.update?.();
  } catch (e) { console.error(e); }
  finally { ticking = false; }
}
setInterval(tick, 1000);
let quick;
Store.onChange(() => { clearTimeout(quick); quick = setTimeout(tick, 120); });

function notifyTrip(prev, t) {
  if (!t) return;
  const passenger = S.user.role === "pasajero";
  if (!passenger && t.status === "requested" && prev?.id !== t.id) {
    toast(`🔔 Nuevo viaje de ${t.passengerName}`, 6000);
    navigator.vibrate?.([200, 100, 200]);
    if (S.view !== "service") show("service");
  }
  if (passenger && prev?.id === t.id && prev.status !== t.status) {
    const msg = { accepted: `✅ ${t.driverName} aceptó tu viaje y va por ti`, arrived: "🚕 ¡Tu taxi llegó!" }[t.status];
    if (msg) { toast(msg); navigator.vibrate?.(200); }
  }
  if (["done", "cancelled", "rejected", "expired"].includes(t.status) && !wasShown(t.id)) {
    markShown(t.id);
    if (t.status === "done") {
      const paid = t.payment === "app";
      modal(passenger
        ? `<h3>✅ Llegaste a ${esc(t.dest.name)}</h3><p>${paid ? `Se cobraron <b>${money(t.total)}</b> de tu saldo:<br>${money(t.base)} para ${esc(t.driverName)} + ${money(t.fee)} de comisión de la app.` : `No alcanzó tu saldo. Paga <b>${money(t.total)}</b> en efectivo al chofer.`}</p>`
        : `<h3>✅ Viaje terminado</h3><p>${paid ? `Ganaste <b>${money(t.base)}</b>, ya está en tus ganancias.` : `El pasajero no tenía saldo: cóbrale <b>${money(t.total)}</b> en efectivo.`}</p>`);
    } else if (t.status === "cancelled" && (passenger ? t.cancelledBy === "driver" : t.cancelledBy === "passenger")) {
      modal(`<h3>Viaje cancelado</h3><p>${passenger ? "El chofer canceló el viaje. Pide otro taxi." : "El pasajero canceló el viaje."}</p>`);
    } else if (passenger && (t.status === "rejected" || t.status === "expired")) {
      modal(`<h3>${t.status === "rejected" ? "El taxi no aceptó" : "Nadie respondió"}</h3><p>Pide otro taxi de la lista.</p>`);
    }
  }
}

/* ===================== Vistas ===================== */
const VIEWS = {
  pasajero: [["map", "🗺️", "Mapa"], ["bus", "🚌", "Camiones"], ["taxi", "🚕", "Taxis"], ["wallet", "💳", "Cartera"], ["account", "👤", "Cuenta"]],
  camion: [["service", "🟢", "Servicio"], ["map", "🗺️", "Mapa"], ["wallet", "💰", "Ganancias"], ["account", "👤", "Cuenta"]],
  taxi: [["service", "🟢", "Servicio"], ["map", "🗺️", "Mapa"], ["wallet", "💰", "Ganancias"], ["account", "👤", "Cuenta"]],
};

function show(view) {
  S.view = view;
  $$("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  const panel = $("#panel");
  panel.innerHTML = ""; panel.scrollTop = 0;
  VIEW_IMPL[view].mount(panel);
  VIEW_IMPL[view].update?.();
  updateMap();
}

const VIEW_IMPL = {};

/* ---------- Mapa (todos) ---------- */
VIEW_IMPL.map = {
  mount(p) {
    p.innerHTML = `
      <div class="card">
        <div id="mvCount" class="strong"></div>
        <div class="chips" id="mvFilters">
          <button class="chip" data-f="camion" type="button">🚌 Camiones</button>
          <button class="chip" data-f="taxi" type="button">🚕 Taxis</button>
          ${ROUTES.map((r) => `<button class="chip" data-r="${r.id}" type="button"><span class="pill" style="background:${r.color}"></span>${r.id}</button>`).join("")}
        </div>
      </div>
      <h3>Cerca de ti</h3>
      <ul class="list" id="mvList"></ul>
      <p class="muted small">Toca un vehículo en el mapa para ver quién maneja, su ruta y a cuánto está. Los marcados como <span class="tag">demo</span> son de ejemplo.</p>`;
    $("#mvFilters").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      if (b.dataset.f) S.filters[b.dataset.f] = !S.filters[b.dataset.f];
      else S.filters.routes.has(b.dataset.r) ? S.filters.routes.delete(b.dataset.r) : S.filters.routes.add(b.dataset.r);
      this.update(); updateMap();
    });
    $("#mvList").addEventListener("click", (e) => {
      const li = e.target.closest("[data-id]"); if (!li) return;
      const m = markers.get(isNaN(li.dataset.id) ? li.dataset.id : +li.dataset.id);
      if (m) { map.flyTo(m.getLatLng(), 16); m.openPopup(); }
    });
  },
  update() {
    const others = S.drivers.filter((d) => d.id !== S.user.id);
    const buses = others.filter((d) => d.kind === "camion").length, taxis = others.filter((d) => d.kind === "taxi");
    setHTML($("#mvCount"), `${buses} camiones y ${taxis.length} taxis en servicio · ${taxis.filter((t) => !t.busy).length} taxis libres`);
    $$("#mvFilters .chip").forEach((c) => c.classList.toggle("on", c.dataset.f ? S.filters[c.dataset.f] : S.filters.routes.has(c.dataset.r)));
    const near = others.filter(visible).map((d) => ({ d, km: Geo.distKm(myPos(), [d.lat, d.lng]) })).sort((a, b) => a.km - b.km).slice(0, 8);
    setHTML($("#mvList"), near.length ? near.map(({ d, km }) => {
      const r = routeById(d.routeId);
      return `<li data-id="${esc(d.id)}"><span class="ico">${d.kind === "camion" ? "🚌" : "🚕"}</span>
        <div class="grow"><b>${esc(d.name)}</b>${d.demo ? ' <span class="tag">demo</span>' : ""}
        <div class="muted small">${d.kind === "camion" ? `<span class="pill" style="background:${r?.color}"></span>${esc(r?.name)}` : `${esc(d.plate)} · ${d.busy ? "ocupado" : "libre"}`}</div></div>
        <div class="right"><b>${fmtDist(km)}</b>${d.kind === "taxi" ? `<div class="muted small">${fmtMin(Geo.taxiEtaSec(km))}</div>` : ""}</div></li>`;
    }).join("") : `<li class="muted">No hay vehículos con estos filtros.</li>`);
  },
};

/* ---------- Camiones (pasajero) ---------- */
function nextBus(r, i) {
  return S.drivers.filter((d) => d.kind === "camion" && d.routeId === r.id && d.s != null)
    .map((d) => ({ d, ...Geo.busEta(r, d.s, d.dwell, i) })).sort((a, b) => a.sec - b.sec)[0];
}

VIEW_IMPL.bus = {
  mount(p) {
    p.innerHTML = `
      <label class="field">Ruta<select id="routeSelect">${ROUTES.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select></label>
      <div class="route-info" id="routeInfo"></div>
      <label class="field">Tu parada<select id="stopSelect"></select></label>
      <div class="card highlight" id="nextBus"></div>
      <button class="btn primary" id="payBusBtn" type="button">Pagar pasaje · ${money(CONFIG.busFare + Math.round(CONFIG.busFare * CONFIG.commission))}</button>
      <div id="myTickets"></div>
      <h3>Tiempo de parada en parada</h3>
      <ol class="stops" id="stopList"></ol>`;
    const fillStops = () => {
      const r = routeById(S.routeId);
      $("#stopSelect").innerHTML = r.stops.map((s, i) => `<option value="${i}">${esc(s[0])}</option>`).join("");
      $("#stopSelect").value = S.stopIdx = Math.min(S.stopIdx, r.stops.length - 1);
    };
    $("#routeSelect").value = S.routeId;
    fillStops();
    const fit = () => map.fitBounds(L.latLngBounds(routeById(S.routeId).stops.map((s) => s.slice(1))), { padding: [30, 30] });
    fit();
    $("#routeSelect").addEventListener("change", (e) => { S.routeId = e.target.value; S.stopIdx = 0; fillStops(); fit(); this.update(); updateMap(); });
    $("#stopSelect").addEventListener("change", (e) => { S.stopIdx = +e.target.value; this.update(); });
    $("#stopList").addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) { S.stopIdx = +li.dataset.i; $("#stopSelect").value = S.stopIdx; this.update(); } });
    $("#payBusBtn").addEventListener("click", () => {
      const r = routeById(S.routeId), base = CONFIG.busFare, fee = Math.round(base * CONFIG.commission);
      modal(`<h3>Pagar pasaje</h3><p>${esc(r.name)}</p>
        <table class="breakdown"><tr><td>Pasaje</td><td>${money(base)}</td></tr>
        <tr><td>Comisión app (${Math.round(CONFIG.commission * 100)}%)</td><td>${money(fee)}</td></tr>
        <tr class="total"><td>Total</td><td>${money(base + fee)}</td></tr></table>
        <p class="muted small">Tu saldo: ${money(S.user.balance)}</p>`, [
        ["Pagar", "primary", async () => {
          const t = await Store.buyTicket(S.user.id, r.id);
          setTimeout(() => modal(`<h3>✅ Pasaje pagado</h3><p>Dile este código al chofer al subir:</p>
            <div class="code">${t.code}</div><p class="muted small">Válido en ${r.id} hasta las ${new Date(t.expiresAt).toLocaleTimeString("es-MX", { timeStyle: "short" })}. También lo ves en esta pantalla.</p>`), 0);
        }],
        ["Cancelar", "ghost"],
      ]);
    });
  },
  async update() {
    const r = routeById(S.routeId), i = S.stopIdx, v = CONFIG.busSpeedKmh / 3600;
    const total = r.length / v + (r.stops.length - 1) * CONFIG.dwellSeconds;
    setHTML($("#routeInfo"), `<span class="pill" style="background:${r.color}"></span>Va de <b>${esc(r.stops[0][0])}</b> a <b>${esc(r.stops[r.terminal][0])}</b> y regresa · ${r.terminal + 1} paradas · ${fmtDist(r.length)} · vuelta completa ≈ ${fmtMin(total)}`);
    const nb = nextBus(r, i);
    setHTML($("#nextBus"), nb ? `
      <div class="muted">Próximo camión a <b>${esc(r.stops[i][0])}</b></div>
      <div class="big">${fmtMin(nb.sec)}</div>
      <div>Chofer <b>${esc(nb.d.name)}</b> · unidad ${esc(nb.d.plate)}${nb.d.demo ? ' <span class="tag">demo</span>' : ""}</div>
      <div class="muted">Está a <b>${fmtDist(nb.km)}</b> de tu parada · ${nb.d.dwell > 0 ? "detenido en" : "pasó por"} ${esc(r.stops[Geo.lastStopIdx(r, nb.d.s)][0])}</div>
      <div class="muted small">Tú estás a ${fmtDist(Geo.distKm(S.me, r.stops[i].slice(1)))} de esta parada</div>`
      : `<div class="muted">No hay camiones de esta ruta en servicio ahora.</div>`);
    setHTML($("#stopList"), r.stops.map((s, k) => {
      const seg = k === 0 ? "Inicio de ruta"
        : `${fmtDist(r.cum[k] - r.cum[k - 1])} · ${fmtMin((r.cum[k] - r.cum[k - 1]) / v + CONFIG.dwellSeconds)} desde la anterior`;
      const eta = nextBus(r, k);
      return `<li data-i="${k}" class="${k === i ? "mine" : ""}${k === r.terminal ? " terminal" : ""}" style="color:${r.color}">
        <span class="dot"></span><span class="txt">${esc(s[0])}<span class="seg">${seg}</span></span>
        <span class="eta">${eta ? fmtMin(eta.sec) : "—"}</span></li>`;
    }).join(""));
    const tickets = await Store.myTickets(S.user.id);
    setHTML($("#myTickets"), tickets.length ? `<h3>Mis boletos activos</h3>` + tickets.map((t) => `
      <div class="card ticket"><div class="code small-code">${t.code}</div>
      <div class="muted small">${esc(routeById(t.routeId).name)} · vence ${new Date(t.expiresAt).toLocaleTimeString("es-MX", { timeStyle: "short" })}</div></div>`).join("") : "");
  },
};

/* ---------- Taxis (pasajero) ---------- */
VIEW_IMPL.taxi = {
  mount(p) {
    p.innerHTML = `
      <div id="tripBox"></div>
      <div id="taxiSearch">
        <label class="field">¿A dónde vas?<select id="destSelect">${DESTS.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join("")}</select></label>
        <div class="card" id="taxiQuote"></div>
        <h3>Taxis libres cerca de ti</h3>
        <ul class="list" id="taxiList"></ul>
      </div>`;
    $("#destSelect").value = S.destIdx;
    $("#destSelect").addEventListener("change", (e) => { S.destIdx = +e.target.value; this.update(); });
    $("#taxiList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-taxi]"); if (!b) return;
      const d = S.drivers.find((x) => String(x.id) === b.dataset.taxi);
      if (!d || d.busy) return toast("Ese taxi ya no está disponible.");
      const dest = DESTS[S.destIdx], q = Store.quote(S.me, dest);
      modal(`<h3>Pedir taxi</h3><p><b>${esc(d.name)}</b> · ${esc(d.plate)}<br>Destino: ${esc(dest.name)}</p>
        <table class="breakdown"><tr><td>Viaje (${fmtDist(q.km)})</td><td>${money(q.base)}</td></tr>
        <tr><td>Comisión app (${Math.round(CONFIG.commission * 100)}%)</td><td>${money(q.fee)}</td></tr>
        <tr class="total"><td>Total</td><td>${money(q.total)}</td></tr></table>
        <p class="muted small">Se cobra de tu saldo al terminar el viaje.</p>`, [
        ["Confirmar", "primary", async () => { await Store.requestTrip(S.user.id, d, S.destIdx, S.me); tick(); }],
        ["Cancelar", "ghost"],
      ]);
    });
    $("#tripBox").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      run(async () => { await Store.tripAction(S.trip.id, b.dataset.act, S.user.id); tick(); });
    });
  },
  update() {
    const t = S.trip, active = t && ["requested", "accepted", "arrived", "ontrip"].includes(t.status);
    $("#taxiSearch").classList.toggle("hidden", !!active);
    if (active) {
      const d = S.drivers.find((x) => x.id === t.driverId);
      const pos = d ? [d.lat, d.lng] : null;
      const toMe = pos ? Geo.distKm(pos, t.pickup) : null, toDest = pos ? Geo.distKm(pos, [t.dest.lat, t.dest.lng]) : null;
      const status = {
        requested: `⏳ Esperando a que <b>${esc(t.driverName)}</b> acepte…`,
        accepted: `🚕 <b>${esc(t.driverName)}</b> va por ti${pos ? ` · está a <b>${fmtDist(toMe)}</b> · llega en <b>${fmtMin(Geo.taxiEtaSec(toMe))}</b>` : ""}`,
        arrived: `✅ <b>Tu taxi llegó.</b> Busca las placas <b>${esc(t.plate)}</b>.`,
        ontrip: `En camino a <b>${esc(t.dest.name)}</b>${pos ? ` · faltan ${fmtDist(toDest)} (${fmtMin(Geo.taxiEtaSec(toDest))})` : ""}`,
      }[t.status];
      const btns = {
        requested: `<button class="btn ghost" data-act="cancel" type="button">Cancelar</button>`,
        accepted: `<button class="btn ghost" data-act="cancel" type="button">Cancelar</button>`,
        arrived: `<button class="btn primary" data-act="start" type="button">Ya me subí</button><button class="btn ghost" data-act="cancel" type="button">Cancelar</button>`,
        ontrip: "",
      }[t.status];
      setHTML($("#tripBox"), `<div class="card highlight">
        <div class="muted">Ruta: tu ubicación → ${esc(t.dest.name)}</div>
        <p>${status}</p>
        <div class="muted small">${esc(t.driverName)} · ${esc(t.plate)} · Total ${money(t.total)} (incluye comisión ${money(t.fee)})</div>
        <div class="row-btns">${btns}</div></div>`);
      return;
    }
    setHTML($("#tripBox"), "");
    const dest = DESTS[S.destIdx], q = Store.quote(S.me, dest);
    setHTML($("#taxiQuote"), `<div class="muted">Viaje estimado a <b>${esc(dest.name)}</b></div>
      <div class="big">${money(q.total)}</div>
      <div class="muted small">${fmtDist(q.km)} · ≈ ${fmtMin(Geo.taxiEtaSec(q.km / CONFIG.roadFactor))} · banderazo ${money(CONFIG.taxiBase)} + ${money(CONFIG.taxiPerKm)}/km + ${Math.round(CONFIG.commission * 100)}% comisión</div>`);
    const list = S.drivers.filter((d) => d.kind === "taxi" && !d.busy).map((d) => ({ d, km: Geo.distKm(d.lat ? [d.lat, d.lng] : S.me, S.me) })).sort((a, b) => a.km - b.km);
    setHTML($("#taxiList"), list.length ? list.map(({ d, km }) => `
      <li><span class="ico">🚕</span><div class="grow"><b>${esc(d.name)}</b>${d.rating ? ` ⭐ ${d.rating}` : ""}${d.demo ? ' <span class="tag">demo</span>' : ""}
        <div class="muted small">${esc(d.plate)} · a ${fmtDist(km)} · llega en ${fmtMin(Geo.taxiEtaSec(km))}</div></div>
        <button class="btn small" data-taxi="${esc(d.id)}" type="button">Pedir</button></li>`).join("")
      : `<li class="muted">No hay taxis libres ahora.</li>`);
  },
};

/* ---------- Cartera / Ganancias ---------- */
VIEW_IMPL.wallet = {
  mount(p) {
    const passenger = S.user.role === "pasajero";
    p.innerHTML = `
      <div class="card balance"><div class="muted">${passenger ? "Saldo disponible" : "Tus ganancias"}</div><div class="big" id="balanceBig"></div></div>
      ${passenger ? `<h3>Recargar saldo</h3>
        <div class="chips" id="topups">${[5000, 10000, 20000, 50000].map((a) => `<button class="chip" data-amt="${a}" type="button">+${money(a)}</button>`).join("")}</div>
        <p class="muted small">Pagos de prueba: todavía no se cobra dinero real.</p>`
        : `<p class="muted small">Recibes el pasaje o la tarifa completa; la comisión de ${Math.round(CONFIG.commission * 100)}% la paga el pasajero. Los retiros a tu cuenta se activan cuando conectemos los pagos reales.</p>`}
      <h3>Movimientos</h3><ul class="history" id="history"></ul>`;
    $("#topups")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-amt]"); if (!b) return;
      const amt = +b.dataset.amt;
      modal(`<h3>Recargar ${money(amt)}</h3><p class="muted">Pago de prueba. Aquí se conectará la pasarela de pago (tarjeta, OXXO, SPEI).</p>`,
        [["Pagar", "primary", async () => { await Store.topup(S.user.id, amt); toast(`✅ Recargaste ${money(amt)}`); tick(); }], ["Cancelar", "ghost"]]);
    });
  },
  async update() {
    const w = await Store.wallet(S.user.id);
    setHTML($("#balanceBig"), money(w.balance));
    setHTML($("#history"), w.history.length ? w.history.map((h) => `
      <li><span>${esc(h.description)}<br><span class="muted small">${fmtTime(h.at)}</span></span>
      <b class="${h.amount < 0 ? "neg" : "pos"}">${h.amount < 0 ? "−" : "+"}${money(Math.abs(h.amount))}</b></li>`).join("")
      : `<li class="muted">Todavía no hay movimientos.</li>`);
  },
};

/* ---------- Cuenta ---------- */
VIEW_IMPL.account = {
  mount(p) {
    const u = S.user, r = routeById(u.routeId);
    p.innerHTML = `
      <div class="card">
        <div class="big">${esc(u.name)}</div>
        <div class="muted">${ROLE_NAME[u.role]}</div>
        <dl class="info">
          <dt>Correo</dt><dd>${esc(u.email)}</dd>
          <dt>Teléfono</dt><dd>${esc(u.phone)}</dd>
          ${r ? `<dt>Ruta</dt><dd>${esc(r.name)}</dd>` : ""}
          ${u.plate ? `<dt>${u.role === "camion" ? "Unidad" : "Placas"}</dt><dd>${esc(u.plate)}</dd>` : ""}
        </dl>
      </div>
      <button class="btn primary" id="logoutBtn" type="button">Cerrar sesión</button>
      <div class="card tip"><b>💡 Para probar pasajero y chofer a la vez</b>
        <p class="small">Abre la app en otra pestaña de este mismo navegador y entra con otra cuenta (por ejemplo, una de taxista). Las dos pestañas se ven en el mapa en vivo y pueden hacer un viaje completo.</p></div>`;
    $("#logoutBtn").addEventListener("click", logout);
  },
};

/* ---------- Servicio (choferes) ---------- */
VIEW_IMPL.service = {
  mount(p) {
    const bus = S.user.role === "camion";
    const r = routeById(S.user.routeId);
    p.innerHTML = `
      <button class="duty" id="dutyBtn" type="button"></button>
      <div class="card">
        <div class="strong">Tu ubicación</div>
        <div id="gpsStatus" class="muted small"></div>
        <label class="check"><input type="checkbox" id="simChk"> Simular recorrido (para probar sin manejar)</label>
      </div>
      ${bus ? `
        <div class="route-info"><span class="pill" style="background:${r.color}"></span><b>${esc(r.name)}</b> · unidad ${esc(S.user.plate)}</div>
        <div class="card" id="busPos"></div>
        <h3>Validar boleto</h3>
        <form id="validateForm" class="inline-form">
          <input name="code" placeholder="Código del pasajero" maxlength="6" autocapitalize="characters" autocomplete="off" required>
          <button class="btn small" type="submit">Validar</button>
        </form>
        <div id="validateResult"></div>`
      : `<div id="driverTrip"></div>`}`;
    $("#dutyBtn").addEventListener("click", () => { setDuty(!S.duty); this.update(); tick(); });
    $("#simChk").checked = S.simulate;
    $("#simChk").addEventListener("change", (e) => {
      S.simulate = e.target.checked;
      if (S.simulate) { S.posSource = "simulado"; if (!S.duty) setDuty(true); }
      else S.posSource = S.gpsWatch != null ? "buscando" : null;
      this.update(); tick();
    });
    $("#validateForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = e.target.code;
      run(async () => {
        try {
          const t = await Store.validateTicket(S.user.id, input.value);
          $("#validateResult").innerHTML = `<div class="card ok">✅ Boleto válido de <b>${esc(t.passenger)}</b>. Ganaste ${money(t.base)}.</div>`;
          navigator.vibrate?.(150); input.value = ""; tick();
        } catch (ex) {
          if (!(ex instanceof Store.AppError)) throw ex;
          $("#validateResult").innerHTML = `<div class="card bad">❌ ${esc(ex.message)}</div>`;
          navigator.vibrate?.([100, 60, 100]);
        }
      });
    });
    $("#driverTrip")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      run(async () => { await Store.tripAction(S.trip.id, b.dataset.act, S.user.id); tick(); });
    });
  },
  update() {
    const b = $("#dutyBtn");
    b.className = "duty " + (S.duty ? "on" : "off");
    setHTML(b, S.duty ? "🟢 En servicio<small>Los pasajeros te ven en el mapa. Toca para salir.</small>" : "⚪ Fuera de servicio<small>Toca para empezar a trabajar</small>");
    const src = {
      gps: "📡 Usando el GPS de tu celular.", buscando: "📡 Buscando señal GPS…",
      "sin-gps": "⚠️ No se pudo usar el GPS. Da permiso de ubicación, o toca ✋ y luego el mapa para ponerla a mano.",
      manual: "✋ Ubicación puesta a mano. Toca ✋ para cambiarla.", simulado: "🤖 Recorrido simulado.",
    }[S.posSource] ?? "Activa el servicio para compartir tu ubicación.";
    setHTML($("#gpsStatus"), src);

    if (S.user.role === "camion") {
      const r = routeById(S.user.routeId);
      setHTML($("#busPos"), S.s != null
        ? `Vas ${S.dwell > 0 ? "detenido en" : "después de"} <b>${esc(r.stops[Geo.lastStopIdx(r, S.s)][0])}</b>; sigue <b>${esc(r.stops[(Geo.lastStopIdx(r, S.s) + 1) % r.stops.length][0])}</b>`
        : `<span class="muted">${S.duty ? "Estás fuera de tu ruta (a más de 300 m)." : "Activa el servicio para que los pasajeros sepan a cuánto vienes."}</span>`);
      return;
    }

    const t = S.trip, box = $("#driverTrip");
    if (!t || !["requested", "accepted", "arrived", "ontrip"].includes(t.status)) {
      setHTML(box, `<div class="card muted">${S.duty ? "Esperando viajes… Cuando un pasajero te pida, aparecerá aquí." : "Activa el servicio para recibir viajes."}</div>`);
      return;
    }
    const toPickup = Geo.distKm(S.pos, t.pickup), toDest = Geo.distKm(S.pos, [t.dest.lat, t.dest.lng]);
    const call = t.passengerPhone ? `<a class="btn ghost" href="tel:${esc(t.passengerPhone)}">📞 Llamar</a>` : "";
    const body = {
      requested: `<div class="strong">🔔 Nuevo viaje</div><p><b>${esc(t.passengerName)}</b> está a ${fmtDist(toPickup)}<br>Destino: <b>${esc(t.dest.name)}</b> (${fmtDist(t.km)})<br>Ganas: <b>${money(t.base)}</b></p>
        <div class="row-btns"><button class="btn primary" data-act="accept" type="button">Aceptar</button><button class="btn ghost" data-act="reject" type="button">Rechazar</button></div>`,
      accepted: `<div class="strong">Ve por ${esc(t.passengerName)}</div><p>Está a <b>${fmtDist(toPickup)}</b> (${fmtMin(Geo.taxiEtaSec(toPickup))}). Sigue la línea amarilla del mapa.</p>
        <div class="row-btns"><button class="btn primary" data-act="arrived" type="button">Ya llegué</button>${call}<button class="btn ghost" data-act="cancel" type="button">Cancelar</button></div>`,
      arrived: `<div class="strong">Esperando a ${esc(t.passengerName)}</div><p>Cuando se suba, inicia el viaje.</p>
        <div class="row-btns"><button class="btn primary" data-act="start" type="button">Iniciar viaje</button>${call}<button class="btn ghost" data-act="cancel" type="button">Cancelar</button></div>`,
      ontrip: `<div class="strong">Llevando a ${esc(t.passengerName)}</div><p>Destino: <b>${esc(t.dest.name)}</b> · faltan ${fmtDist(toDest)}</p>
        <div class="row-btns"><button class="btn primary" data-act="finish" type="button">Terminar y cobrar ${money(t.total)}</button></div>`,
    }[t.status];
    setHTML(box, `<div class="card highlight">${body}</div>`);
  },
};

/* ===================== Arranque ===================== */
initAuth();
Store.currentUser().then((u) => { if (u) enterApp(u); });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
