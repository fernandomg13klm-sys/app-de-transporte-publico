"use strict";

/* ===================== Utilidades ===================== */
const $ = (s) => document.querySelector(s);
const money = (n) => "$" + n.toFixed(2);
const toRad = (d) => (d * Math.PI) / 180;

function distKm(a, b) {
  const R = 6371, dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km");
const fmtMin = (sec) => (sec < 60 ? "< 1 min" : Math.round(sec / 60) + " min");
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const kmhToKms = (v) => v / 3600;

function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
}

/* ===================== Cartera / pagos ===================== */
const wallet = {
  balance: store("mt_balance") ?? 50,
  history: store("mt_history") ?? [{ t: Date.now(), desc: "Saldo de bienvenida", amt: 50 }],
  save() { store("mt_balance", this.balance); store("mt_history", this.history); render.wallet(); },
  add(amt, desc) { this.balance += amt; this.history.unshift({ t: Date.now(), desc, amt }); this.save(); },
  charge(amt, desc) {
    if (amt > this.balance) return false;
    this.balance -= amt; this.history.unshift({ t: Date.now(), desc, amt: -amt }); this.save();
    return true;
  },
};
const ticketCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

/* ===================== Rutas de camión ===================== */
// Cada ruta es de ida y vuelta: agregamos las paradas de regreso para formar un circuito continuo
ROUTES.forEach((r) => {
  const ida = r.stops.length;
  r.stops = [...r.stops, ...r.stops.slice(0, -1).reverse().map((s) => [s[0] + " (regreso)", s[1], s[2]])];
  r.terminal = ida - 1;
  r.cum = [0];
  for (let i = 1; i < r.stops.length; i++) {
    r.cum.push(r.cum[i - 1] + distKm(r.stops[i - 1].slice(1), r.stops[i].slice(1)));
  }
  r.length = r.cum[r.cum.length - 1];
});

// Unidades en circulación (simuladas: en producción llegan por GPS)
const BUS_DRIVERS = ["Don Ramiro", "Lupita", "Chuy", "Toño", "Martha", "Beto", "Rafa", "Elena", "Paco"];
const buses = [];
ROUTES.forEach((r, ri) => {
  for (let k = 0; k < 3; k++) {
    buses.push({
      route: r, s: (r.length * k) / 3 + Math.random() * 0.3, dwell: 0,
      driver: BUS_DRIVERS[(ri * 3 + k) % BUS_DRIVERS.length],
      plate: `JAL-${100 + ri * 10 + k}-${"ABC"[k]}`,
    });
  }
});

function posOnRoute(r, s) {
  for (let i = 1; i < r.cum.length; i++) {
    if (s <= r.cum[i]) {
      const t = (s - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
      return lerp(r.stops[i - 1].slice(1), r.stops[i].slice(1), t);
    }
  }
  return r.stops[r.stops.length - 1].slice(1);
}
// Índice de la última parada que el camión ya pasó
const lastStopIdx = (r, s) => { let i = 0; while (i + 1 < r.cum.length && r.cum[i + 1] <= s) i++; return i; };

// Segundos para que un camión en la posición s llegue a la parada i (si da la vuelta, cuenta el regreso a la base)
function busEtaToStop(bus, i) {
  const r = bus.route, v = kmhToKms(CONFIG.busSpeedKmh);
  if (bus.dwell > 0 && lastStopIdx(r, bus.s) === i) return { sec: 0, dist: 0 }; // ya está en la parada
  let dist, stopsBetween;
  if (bus.s <= r.cum[i] + 1e-6) {
    dist = r.cum[i] - bus.s;
    stopsBetween = Math.max(0, i - lastStopIdx(r, bus.s) - 1);
  } else {
    dist = r.length - bus.s + r.cum[i];  // termina vuelta y regresa al inicio
    stopsBetween = r.stops.length - 1 - lastStopIdx(r, bus.s) + i;
  }
  return { sec: dist / v + stopsBetween * CONFIG.dwellSeconds + bus.dwell, dist };
}

function nextBusFor(route, i) {
  return buses
    .filter((b) => b.route === route)
    .map((b) => ({ bus: b, ...busEtaToStop(b, i) }))
    .sort((a, b) => a.sec - b.sec)[0];
}

/* ===================== Taxis ===================== */
let me = [CONFIG.center[0] - 0.004, CONFIG.center[1] - 0.006];
const taxis = TAXI_NAMES.map((name, i) => ({
  id: i, name, plate: `TX-${2300 + i * 7}`, rating: (4.3 + Math.random() * 0.7).toFixed(1),
  pos: [CONFIG.center[0] + (Math.random() - 0.5) * 0.04, CONFIG.center[1] + (Math.random() - 0.5) * 0.05],
  heading: Math.random() * Math.PI * 2, busy: false,
}));
const taxiEtaSec = (km) => (km * 1.3) / kmhToKms(CONFIG.taxiSpeedKmh); // 1.3 = factor por calles
const taxiFare = (km) => {
  const base = CONFIG.taxiBase + km * 1.3 * CONFIG.taxiPerKm;
  const fee = base * CONFIG.serviceFee;
  return { base, fee, total: base + fee };
};

// Destinos posibles = todas las paradas conocidas
const DESTS = [...new Map(ROUTES.flatMap((r) => r.stops).map((s) => [s[0], s])).values()];

// Viaje activo de taxi: {taxi, dest, phase: 'pickup'|'arrived'|'trip'|'done'}
let trip = null;

/* ===================== Mapa ===================== */
const map = L.map("map", { zoomControl: false }).setView(CONFIG.center, 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap",
}).addTo(map);

const icon = (emoji) => L.divIcon({ className: "vehicle-icon", html: emoji, iconSize: [24, 24], iconAnchor: [12, 12] });
const meMarker = L.marker(me, { icon: L.divIcon({ className: "me-icon", iconSize: [16, 16] }) }).addTo(map).bindTooltip("Tú");

const busLayer = L.layerGroup().addTo(map);
const taxiLayer = L.layerGroup();
const routeLines = {};
const stopMarkers = {};
ROUTES.forEach((r) => {
  routeLines[r.id] = L.polyline(r.stops.map((s) => s.slice(1)), { color: r.color, weight: 5, opacity: 0.85 });
  stopMarkers[r.id] = L.layerGroup(r.stops.map((s, i) =>
    L.circleMarker(s.slice(1), { radius: 6, color: r.color, fillColor: "#fff", fillOpacity: 1, weight: 3 })
      .bindTooltip(s[0]).on("click", () => { $("#stopSelect").value = i; render.bus(); })));
});
buses.forEach((b) => { b.marker = L.marker(posOnRoute(b.route, b.s), { icon: icon("🚌") }).bindTooltip(`${b.route.id} · ${b.driver}`); });
taxis.forEach((t) => {
  t.marker = L.marker(t.pos, { icon: icon("🚕") }).bindTooltip(`${t.name} · ${t.plate}`).addTo(taxiLayer);
});
let tripLine = null;

if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition((p) => {
    const here = [p.coords.latitude, p.coords.longitude];
    // Solo usamos tu ubicación real si estás dentro de la zona de servicio de la demo
    if (distKm(here, CONFIG.center) < 15) { me = here; meMarker.setLatLng(me); }
  }, () => {}, { timeout: 5000 });
}

/* ===================== Estado de UI ===================== */
let view = "bus";
let route = ROUTES[0];

$("#routeSelect").innerHTML = ROUTES.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
$("#destSelect").innerHTML = DESTS.map((d, i) => `<option value="${i}">${d[0]}</option>`).join("");

function fillStops() {
  $("#stopSelect").innerHTML = route.stops.map((s, i) => `<option value="${i}">${s[0]}</option>`).join("");
}

function selectRoute(id) {
  route = ROUTES.find((r) => r.id === id);
  busLayer.clearLayers();
  routeLines[route.id].addTo(busLayer);
  stopMarkers[route.id].addTo(busLayer);
  buses.filter((b) => b.route === route).forEach((b) => b.marker.addTo(busLayer));
  fillStops();
  map.fitBounds(routeLines[route.id].getBounds(), { padding: [30, 30] });
  render.bus();
}

/* ===================== Render ===================== */
const render = {
  bus() {
    const myStop = +$("#stopSelect").value || 0;
    const nb = nextBusFor(route, myStop);
    const first = route.stops[0][0], last = route.stops[route.terminal][0];
    const total = route.length / kmhToKms(CONFIG.busSpeedKmh) + (route.stops.length - 2) * CONFIG.dwellSeconds;
    $("#routeInfo").innerHTML =
      `<span class="pill" style="background:${route.color}"></span>Va de <b>${first}</b> a <b>${last}</b> · ` +
      `${route.terminal + 1} paradas · ida y vuelta ${fmtDist(route.length)} · vuelta completa ≈ ${fmtMin(total)}`;

    if (nb) {
      const at = route.stops[lastStopIdx(route, nb.bus.s)][0];
      $("#nextBus").innerHTML = `
        <div class="muted">Próximo camión a <b>${route.stops[myStop][0]}</b></div>
        <div class="big">${fmtMin(nb.sec)}</div>
        <div>Chofer <b>${nb.bus.driver}</b> · unidad ${nb.bus.plate}</div>
        <div class="muted">Está a <b>${fmtDist(nb.dist)}</b> de tu parada · ${nb.bus.dwell > 0 ? "detenido en" : "pasó por"} ${at}</div>`;
    }

    $("#stopList").innerHTML = route.stops.map((s, i) => {
      const seg = i === 0 ? "Inicio de ruta"
        : `${fmtDist(route.cum[i] - route.cum[i - 1])} · ${fmtMin((route.cum[i] - route.cum[i - 1]) / kmhToKms(CONFIG.busSpeedKmh) + CONFIG.dwellSeconds)} desde la anterior`;
      const eta = nextBusFor(route, i);
      return `<li class="${i === myStop ? "mine" : ""}" style="color:${route.color}">
        <span class="dot"></span>
        <span style="color:var(--fg)">${s[0]}<span class="seg">${seg}</span></span>
        <span class="eta" style="color:var(--fg)">${fmtMin(eta.sec)}</span></li>`;
    }).join("");
  },

  taxi() {
    const dest = DESTS[+$("#destSelect").value || 0];
    const tripKm = distKm(me, dest.slice(1));
    const f = taxiFare(tripKm);

    if (trip) {
      const t = trip.taxi, toMe = distKm(t.pos, me), toDest = distKm(t.pos, trip.dest.slice(1));
      const status = {
        pickup: `🚕 <b>${t.name}</b> va por ti · está a <b>${fmtDist(toMe)}</b> · llega en ${fmtMin(taxiEtaSec(toMe))}`,
        arrived: `✅ Tu taxi llegó. Placas <b>${t.plate}</b>.`,
        trip: `En camino a <b>${trip.dest[0]}</b> · faltan ${fmtDist(toDest)} (${fmtMin(taxiEtaSec(toDest))})`,
      }[trip.phase];
      const btn = trip.phase === "arrived" ? `<button class="btn primary" id="startTrip">Abordar e iniciar viaje</button>`
        : trip.phase === "pickup" ? `<button class="btn ghost" id="cancelTrip" style="width:100%;margin-top:10px">Cancelar</button>` : "";
      $("#taxiQuote").innerHTML = `<div class="muted">Ruta: Tu ubicación → ${trip.dest[0]}</div>
        <div style="margin:6px 0">${status}</div>
        <div class="muted">Tarifa: ${money(trip.fare.total)} (incluye comisión ${money(trip.fare.fee)})</div>${btn}`;
      $("#startTrip")?.addEventListener("click", () => { trip.phase = "trip"; render.taxi(); });
      $("#cancelTrip")?.addEventListener("click", endTrip);
    } else {
      $("#taxiQuote").innerHTML = `<div class="muted">Viaje estimado a <b>${dest[0]}</b></div>
        <div class="big">${money(f.total)}</div>
        <div class="muted">${fmtDist(tripKm * 1.3)} · ≈ ${fmtMin(taxiEtaSec(tripKm))} · banderazo ${money(CONFIG.taxiBase)} + ${money(CONFIG.taxiPerKm)}/km + comisión app ${Math.round(CONFIG.serviceFee * 100)}%</div>`;
    }

    const list = taxis.filter((t) => !t.busy).map((t) => ({ t, km: distKm(t.pos, me) })).sort((a, b) => a.km - b.km);
    $("#taxiList").innerHTML = list.map(({ t, km }) => `
      <li><div><b>${t.name}</b> ⭐ ${t.rating}
        <div class="meta">${t.plate} · a ${fmtDist(km)} · llega en ${fmtMin(taxiEtaSec(km))}</div></div>
        ${trip ? "" : `<button class="btn small" data-taxi="${t.id}">Pedir</button>`}</li>`).join("");
  },

  wallet() {
    $("#walletChip").textContent = money(wallet.balance);
    $("#balanceBig").textContent = money(wallet.balance);
    $("#history").innerHTML = wallet.history.slice(0, 30).map((h) => `
      <li><span>${h.desc}<br><span class="muted">${new Date(h.t).toLocaleString("es-MX")}</span></span>
      <b class="${h.amt < 0 ? "neg" : "pos"}">${h.amt < 0 ? "-" : "+"}${money(Math.abs(h.amt))}</b></li>`).join("");
  },
};

/* ===================== Modal ===================== */
function modal(html, actions) {
  $("#modalBody").innerHTML = html;
  $("#modalActions").innerHTML = "";
  actions.forEach(([label, cls, fn]) => {
    const b = document.createElement("button");
    b.className = "btn " + cls; b.textContent = label;
    b.onclick = () => { $("#modal").close(); fn?.(); };
    $("#modalActions").appendChild(b);
  });
  $("#modal").showModal();
}

function needBalance(amount) {
  modal(`<h3>Saldo insuficiente</h3><p>Necesitas ${money(amount)} y tienes ${money(wallet.balance)}.</p>`,
    [["Recargar", "primary", () => switchView("wallet")], ["Cerrar", "ghost"]]);
}

/* ===================== Acciones ===================== */
$("#routeSelect").addEventListener("change", (e) => selectRoute(e.target.value));
$("#stopSelect").addEventListener("change", render.bus);
$("#destSelect").addEventListener("change", render.taxi);
$("#walletChip").addEventListener("click", () => switchView("wallet"));

$("#payBusBtn").addEventListener("click", () => {
  const fare = CONFIG.busFare;
  modal(`<h3>Pagar pasaje</h3><p>${route.name}<br>Tarifa: <b>${money(fare)}</b></p>`, [
    ["Pagar", "primary", () => {
      if (!wallet.charge(fare, `Pasaje ${route.id}`)) return needBalance(fare);
      modal(`<h3>✅ Pasaje pagado</h3><p>Muestra este código al chofer o escanéalo en el validador:</p>
        <div class="code">${ticketCode()}</div><p class="muted">Válido 60 min en ${route.id}.</p>`, [["Listo", "primary"]]);
    }],
    ["Cancelar", "ghost"],
  ]);
});

$("#taxiList").addEventListener("click", (e) => {
  const id = e.target.dataset.taxi;
  if (id === undefined) return;
  const t = taxis[+id], dest = DESTS[+$("#destSelect").value || 0];
  const fare = taxiFare(distKm(me, dest.slice(1)));
  if (fare.total > wallet.balance) return needBalance(fare.total);
  modal(`<h3>Pedir taxi</h3><p><b>${t.name}</b> · ${t.plate}<br>Destino: ${dest[0]}<br>
    Tarifa estimada: <b>${money(fare.total)}</b></p><p class="muted">Se cobra de tu saldo al terminar el viaje.</p>`, [
    ["Confirmar", "primary", () => {
      t.busy = true; trip = { taxi: t, dest, fare, phase: "pickup" };
      tripLine = L.polyline([t.pos, me, dest.slice(1)], { color: "#ffb400", weight: 4, dashArray: "8 8" }).addTo(taxiLayer);
      render.taxi();
    }],
    ["Cancelar", "ghost"],
  ]);
});

document.querySelectorAll("[data-topup]").forEach((b) =>
  b.addEventListener("click", () => {
    const amt = +b.dataset.topup;
    modal(`<h3>Recargar ${money(amt)}</h3><p class="muted">Demo: aquí se conecta la pasarela de pago (tarjeta, OXXO, SPEI).</p>`,
      [["Pagar", "primary", () => wallet.add(amt, "Recarga")], ["Cancelar", "ghost"]]);
  }));

function endTrip() {
  if (trip) trip.taxi.busy = false;
  trip = null;
  if (tripLine) { taxiLayer.removeLayer(tripLine); tripLine = null; }
  render.taxi();
}

function finishTrip() {
  const { fare, dest, taxi } = trip;
  const ok = wallet.charge(fare.total, `Taxi ${taxi.plate} → ${dest[0]}`);
  me = dest.slice(1); meMarker.setLatLng(me);
  endTrip();
  modal(ok ? `<h3>✅ Llegaste a ${dest[0]}</h3><p>Se cobraron <b>${money(fare.total)}</b>:<br>
      ${money(fare.base)} para ${taxi.name} + ${money(fare.fee)} comisión de la app.</p>`
    : `<h3>Llegaste a ${dest[0]}</h3><p>No hubo saldo suficiente; paga ${money(fare.total)} en efectivo.</p>`, [["Listo", "primary"]]);
}

function switchView(v) {
  view = v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  if (v === "taxi") { map.removeLayer(busLayer); taxiLayer.addTo(map); map.setView(me, 14); render.taxi(); }
  else { map.removeLayer(taxiLayer); busLayer.addTo(map); if (v === "bus") render.bus(); }
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

/* ===================== Simulación en tiempo real ===================== */
// En producción esto se reemplaza por posiciones GPS que manda el celular/rastreador de cada unidad.
const TICK = 1; // segundos
setInterval(() => {
  buses.forEach((b) => {
    const r = b.route;
    if (b.dwell > 0) { b.dwell = Math.max(0, b.dwell - TICK); }
    else {
      const before = lastStopIdx(r, b.s);
      b.s += kmhToKms(CONFIG.busSpeedKmh) * TICK;
      if (b.s >= r.length) b.s = 0;                       // vuelve a iniciar la ruta
      else if (lastStopIdx(r, b.s) > before) b.dwell = CONFIG.dwellSeconds; // llegó a parada
    }
    b.marker.setLatLng(posOnRoute(r, b.s));
  });

  const step = kmhToKms(CONFIG.taxiSpeedKmh) * TICK * 6; // los taxis de la demo van acelerados x6
  taxis.forEach((t) => {
    let target = null;
    if (trip?.taxi === t) target = trip.phase === "pickup" ? me : trip.phase === "trip" ? trip.dest.slice(1) : null;
    if (target) {
      const d = distKm(t.pos, target);
      t.pos = d <= step ? target.slice() : lerp(t.pos, target, step / d);
      if (d <= step) {
        if (trip.phase === "pickup") trip.phase = "arrived";
        else if (trip.phase === "trip") { t.marker.setLatLng(t.pos); return finishTrip(); }
      }
      if (tripLine) tripLine.setLatLngs(trip.phase === "trip" ? [t.pos, trip.dest.slice(1)] : [t.pos, me, trip.dest.slice(1)]);
    } else if (!(trip?.taxi === t)) {
      t.heading += (Math.random() - 0.5) * 0.6;            // deambula buscando pasaje
      const dd = step / 6 / 111;
      t.pos = [t.pos[0] + Math.cos(t.heading) * dd, t.pos[1] + Math.sin(t.heading) * dd];
      if (distKm(t.pos, CONFIG.center) > 3) t.heading += Math.PI;
    }
    t.marker.setLatLng(t.pos);
  });

  if (view === "bus") render.bus();
  else if (view === "taxi") render.taxi();
}, TICK * 1000);

/* ===================== Inicio ===================== */
selectRoute(ROUTES[0].id);
render.wallet();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
