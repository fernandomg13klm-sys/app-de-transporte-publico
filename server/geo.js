// Cálculos de distancia y posición sobre rutas (el cliente tiene una copia de las mismas fórmulas).
const toRad = (d) => (d * Math.PI) / 180;

export function distKm(a, b) {
  const R = 6371, dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const moveToward = (from, to, km) => {
  const d = distKm(from, to);
  return d <= km ? [to[0], to[1]] : lerp(from, to, km / d);
};

// Cada ruta es de ida y vuelta: se agregan las paradas de regreso para formar un circuito continuo.
export function buildRoute(raw) {
  const stops = [...raw.stops, ...raw.stops.slice(0, -1).reverse().map(([n, a, b]) => [n + " (regreso)", a, b])];
  const cum = [0];
  for (let i = 1; i < stops.length; i++) cum.push(cum[i - 1] + distKm(stops[i - 1].slice(1), stops[i].slice(1)));
  return { id: raw.id, name: raw.name, color: raw.color, stops, cum, length: cum.at(-1), terminal: raw.stops.length - 1 };
}

export function posOnRoute(r, s) {
  for (let i = 1; i < r.cum.length; i++) {
    if (s <= r.cum[i]) {
      const t = (s - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
      return lerp(r.stops[i - 1].slice(1), r.stops[i].slice(1), t);
    }
  }
  return r.stops.at(-1).slice(1);
}

export const lastStopIdx = (r, s) => { let i = 0; while (i + 1 < r.cum.length && r.cum[i + 1] <= s) i++; return i; };

// Ubica un punto GPS sobre la ruta. Como la ida y la vuelta pasan por las mismas calles,
// se elige la posición más cercana a la anterior para no "brincar" de sentido.
export function projectOnRoute(r, p, prevS) {
  const k = Math.cos(toRad(p[0]));
  const cands = [];
  for (let i = 1; i < r.stops.length; i++) {
    const a = r.stops[i - 1].slice(1), b = r.stops[i].slice(1);
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1e-12;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
    cands.push({ s: r.cum[i - 1] + t * (r.cum[i] - r.cum[i - 1]), d: distKm(p, lerp(a, b, t)) });
  }
  const min = Math.min(...cands.map((c) => c.d));
  const close = cands.filter((c) => c.d <= min + 0.05);
  if (prevS == null) return close[0];
  const delta = (c) => { let x = (((c.s - prevS) % r.length) + r.length) % r.length; if (x > r.length - 0.3) x -= r.length; return Math.abs(x); };
  return close.sort((a, b) => delta(a) - delta(b))[0];
}
