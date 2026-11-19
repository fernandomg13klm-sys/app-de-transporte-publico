"use strict";
/*
 * Choferes de ejemplo para que el mapa tenga movimiento mientras no hay choferes reales.
 * Sus posiciones dependen solo de la hora, así que todas las pestañas los ven en el mismo lugar.
 * Se apagan con CONFIG.demoDrivers = false.
 */
const Sim = (() => {
  const BUS_DRIVERS = ["Don Ramiro", "Lupita", "Chuy", "Toño", "Martha", "Beto", "Rafa", "Elena", "Paco"];
  const TAXI_DRIVERS = ["Juan P.", "María L.", "Roberto G.", "Ana S.", "Luis M.", "Carmen R.", "Pedro V.", "Sofía H."];
  const v = CONFIG.busSpeedKmh / 3600;

  // Línea de tiempo de cada ruta: tramo en movimiento + espera en cada parada
  const timelines = ROUTES.map((r) => {
    const parts = [];
    for (let i = 1; i < r.stops.length; i++) {
      parts.push({ type: "move", s0: r.cum[i - 1], s1: r.cum[i], dur: (r.cum[i] - r.cum[i - 1]) / v });
      parts.push({ type: "dwell", s0: r.cum[i], dur: CONFIG.dwellSeconds });
    }
    return { r, parts, total: parts.reduce((a, p) => a + p.dur, 0) };
  });

  function busAt(tl, t) {
    let x = ((t % tl.total) + tl.total) % tl.total;
    for (const p of tl.parts) {
      if (x < p.dur) {
        if (p.type === "dwell") return { s: p.s0 >= tl.r.length - 1e-9 ? 0 : p.s0, dwell: p.dur - x };
        return { s: p.s0 + (p.s1 - p.s0) * (x / p.dur), dwell: 0 };
      }
      x -= p.dur;
    }
    return { s: 0, dwell: 0 };
  }

  // Taxis: recorren óvalos alrededor del centro a ~25 km/h
  const taxiDefs = TAXI_DRIVERS.map((name, i) => ({
    id: "demo-t" + i, name, plate: `TX-${2300 + i * 7}`, rating: (4.4 + ((i * 37) % 6) / 10).toFixed(1),
    ry: 0.006 + (i % 4) * 0.004, rx: 0.008 + ((i + 1) % 3) * 0.006,
    oy: ((i % 3) - 1) * 0.006, ox: ((i % 4) - 1.5) * 0.007, ph: i * 0.8, dir: i % 2 ? 1 : -1,
  }));

  function drivers(nowMs, busy, botTrips) {
    if (!CONFIG.demoDrivers) return [];
    const t = nowMs / 1000;
    const list = [];
    timelines.forEach((tl, ri) => {
      for (let k = 0; k < 3; k++) {
        const { s, dwell } = busAt(tl, t + (tl.total * k) / 3);
        const [lat, lng] = Geo.posOnRoute(tl.r, s);
        list.push({
          id: `demo-b${ri}${k}`, kind: "camion", name: BUS_DRIVERS[(ri * 3 + k) % BUS_DRIVERS.length],
          plate: `JAL-${100 + ri * 10 + k}`, routeId: tl.r.id, lat, lng, s, dwell, demo: true,
        });
      }
    });
    const tripByDriver = new Map(botTrips.map((x) => [x.driverId, x]));
    taxiDefs.forEach((d) => {
      const trip = tripByDriver.get(d.id);
      let pos;
      if (trip?.botPos) pos = trip.botPos;
      else {
        const R = (d.rx + d.ry) / 2 * 111, w = (6.9 / 1000) / R; // 6.9 m/s
        const a = d.ph + d.dir * w * t;
        pos = [CONFIG.center[0] + d.oy + d.ry * Math.sin(a), CONFIG.center[1] + d.ox + d.rx * Math.cos(a)];
      }
      list.push({ id: d.id, kind: "taxi", name: d.name, plate: d.plate, rating: d.rating, lat: pos[0], lng: pos[1], demo: true, busy: busy.has(d.id) });
    });
    return list;
  }

  // Avanza los viajes con taxis de ejemplo (aceptan solos, llegan por ti y te llevan)
  async function tickTrips(dtSec) {
    const step = (CONFIG.taxiSpeedKmh * 6 / 3600) * dtSec; // van x6 más rápido para que la demo no tarde
    for (const trip of Store.activeBotTrips()) {
      try {
        if (trip.status === "requested" && Date.now() - trip.at > 2500) await Store.tripAction(trip.id, "accept", "bot");
        else if (trip.status === "accepted") {
          const pos = Geo.moveToward(trip.botPos, trip.pickup, step);
          await Store.setBotPos(trip.id, pos);
          if (Geo.distKm(pos, trip.pickup) < 0.001) await Store.tripAction(trip.id, "arrived", "bot");
        } else if (trip.status === "ontrip") {
          const dest = [trip.dest.lat, trip.dest.lng];
          const pos = Geo.moveToward(trip.botPos, dest, step);
          await Store.setBotPos(trip.id, pos);
          if (Geo.distKm(pos, dest) < 0.001) await Store.tripAction(trip.id, "finish", "bot");
        }
      } catch { /* otra pestaña ya lo movió */ }
    }
  }

  return { drivers, tickTrips };
})();
