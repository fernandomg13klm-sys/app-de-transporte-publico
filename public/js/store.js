"use strict";
/*
 * Almacén de datos local: cuentas, sesiones, saldo, boletos y viajes.
 * Por ahora todo se guarda en este navegador (localStorage) y se comparte entre
 * pestañas abiertas. Todas las funciones son async y tienen la misma forma que
 * tendrá la API del servidor, así que después solo se cambia este archivo.
 */
const Store = (() => {
  const DB_KEY = "muevet_db_v2";
  const LIVE_KEY = "muevet_live_v1";
  const SESSION_KEY = "muevet_session";

  class AppError extends Error {}
  const fail = (msg) => { throw new AppError(msg); };

  /* ---------- Persistencia ---------- */
  const empty = () => ({ nextId: 1, users: [], transactions: [], tickets: [], trips: [], platform: [] });
  let memDb = null, memLive = {};
  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* sin almacenamiento */ } }
  const loadDb = () => read(DB_KEY, null) ?? memDb ?? empty();
  const loadLive = () => read(LIVE_KEY, null) ?? memLive;

  // Avisos de cambios a otras pestañas
  const listeners = new Set();
  const chan = "BroadcastChannel" in window ? new BroadcastChannel("muevet") : null;
  const emit = () => listeners.forEach((f) => f());
  chan?.addEventListener("message", emit);
  window.addEventListener("storage", (e) => { if (e.key === DB_KEY || e.key === LIVE_KEY) emit(); });
  const announce = () => { chan?.postMessage("change"); emit(); };

  // Lee, modifica y guarda en un solo paso
  function mutate(fn) {
    const db = loadDb();
    const result = fn(db);
    memDb = db; write(DB_KEY, db); announce();
    return result;
  }

  /* ---------- Contraseñas (PBKDF2, nunca se guarda la contraseña) ---------- */
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
  async function hashPassword(password, salt) {
    if (!crypto.subtle) fail("Tu navegador no permite crear cuentas seguras. Actualízalo o usa Chrome/Safari.");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
    return hex(bits);
  }

  /* ---------- Utilidades ---------- */
  const now = () => Date.now();
  const fee = (base) => Math.round(base * CONFIG.commission);
  const publicUser = (u) => u && ({
    id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
    routeId: u.routeId ?? null, plate: u.plate ?? null, balance: u.balance,
  });
  const findUser = (db, id) => db.users.find((u) => u.id === id) ?? fail("Cuenta no encontrada.");

  function ledger(db, user, amount, description) {
    if (amount < 0 && user.balance + amount < 0) fail("Saldo insuficiente.");
    user.balance += amount;
    db.transactions.push({ id: db.nextId++, userId: user.id, amount, description, at: now() });
  }
  const platformFee = (db, amount, description) => db.platform.push({ amount, description, at: now() });

  /* ---------- Cuentas y sesión ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function register({ name, email, phone, password, role, routeId, plate }) {
    name = (name ?? "").trim(); email = (email ?? "").trim().toLowerCase();
    phone = (phone ?? "").replace(/[^\d+]/g, ""); plate = (plate ?? "").trim().toUpperCase();
    if (name.length < 2) fail("Escribe tu nombre.");
    if (!EMAIL_RE.test(email)) fail("Escribe un correo válido.");
    if (phone.replace(/\D/g, "").length < 10) fail("Escribe un teléfono de 10 dígitos.");
    if ((password ?? "").length < 6) fail("La contraseña debe tener al menos 6 caracteres.");
    if (!["pasajero", "camion", "taxi"].includes(role)) fail("Elige el tipo de cuenta.");
    if (role === "camion" && !routeById(routeId)) fail("Elige la ruta que manejas.");
    if (role !== "pasajero" && plate.length < 3) fail(role === "taxi" ? "Escribe las placas del taxi." : "Escribe el número de unidad.");
    if (loadDb().users.some((u) => u.email === email)) fail("Ya existe una cuenta con ese correo.");

    const salt = randomHex(16);
    const passHash = await hashPassword(password, salt);
    const user = mutate((db) => {
      if (db.users.some((u) => u.email === email)) fail("Ya existe una cuenta con ese correo.");
      const u = {
        id: db.nextId++, name, email, phone, role, passHash, salt, balance: 0, createdAt: now(),
        routeId: role === "camion" ? routeId : null, plate: role === "pasajero" ? null : plate,
      };
      db.users.push(u);
      if (role === "pasajero" && CONFIG.welcomeBonus > 0) ledger(db, u, CONFIG.welcomeBonus, "Saldo de bienvenida");
      return u;
    });
    startSession(user.id, true);
    return publicUser(user);
  }

  async function login(email, password, remember) {
    email = (email ?? "").trim().toLowerCase();
    const u = loadDb().users.find((x) => x.email === email);
    // Se calcula el hash aunque no exista la cuenta para no revelar qué correos están registrados
    const h = await hashPassword(password ?? "", u?.salt ?? "x");
    if (!u || h !== u.passHash) fail("Correo o contraseña incorrectos.");
    startSession(u.id, remember);
    return publicUser(u);
  }

  // La sesión vive en la pestaña (sessionStorage) y, si eliges "mantener sesión", también en el navegador.
  function startSession(userId, remember) {
    const s = JSON.stringify({ userId, at: now() });
    try { sessionStorage.setItem(SESSION_KEY, s); } catch {}
    try { if (remember) localStorage.setItem(SESSION_KEY, s); else localStorage.removeItem(SESSION_KEY); } catch {}
  }
  async function logout() {
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch {}
  }
  async function currentUser() {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "null"); } catch {}
    if (!s) return null;
    return publicUser(loadDb().users.find((u) => u.id === s.userId)) ?? null;
  }
  const getUser = (id) => publicUser(loadDb().users.find((u) => u.id === id));

  /* ---------- Cartera ---------- */
  async function wallet(userId) {
    const db = loadDb();
    return {
      balance: findUser(db, userId).balance,
      history: db.transactions.filter((t) => t.userId === userId).sort((a, b) => b.id - a.id).slice(0, 50),
    };
  }
  async function topup(userId, amount) {
    if (!Number.isInteger(amount) || amount < 1000 || amount > 200000) fail("La recarga debe ser de $10 a $2,000.");
    // Aquí después se conecta la pasarela de pago real. Por ahora es un pago de prueba.
    mutate((db) => ledger(db, findUser(db, userId), amount, "Recarga (pago de prueba)"));
  }

  /* ---------- Boletos de camión ---------- */
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

  async function buyTicket(userId, routeId) {
    const r = routeById(routeId) ?? fail("Ruta no válida.");
    return mutate((db) => {
      const u = findUser(db, userId);
      if (u.role !== "pasajero") fail("Solo los pasajeros compran boletos.");
      const base = CONFIG.busFare, f = fee(base);
      ledger(db, u, -(base + f), `Pasaje ${r.id}`);
      platformFee(db, f, `Comisión pasaje ${r.id}`);
      let code; do code = newCode(); while (db.tickets.some((t) => t.code === code));
      const t = { code, userId, routeId, base, fee: f, at: now(), usedAt: null, driverId: null };
      db.tickets.push(t);
      return { ...t, expiresAt: t.at + CONFIG.ticketMinutes * 60000 };
    });
  }
  async function myTickets(userId) {
    const limit = now() - CONFIG.ticketMinutes * 60000;
    return loadDb().tickets.filter((t) => t.userId === userId && !t.usedAt && t.at > limit)
      .map((t) => ({ ...t, expiresAt: t.at + CONFIG.ticketMinutes * 60000 })).reverse();
  }
  async function validateTicket(driverId, code) {
    code = (code ?? "").trim().toUpperCase();
    return mutate((db) => {
      const d = findUser(db, driverId);
      if (d.role !== "camion") fail("Solo los choferes de camión validan boletos.");
      const t = db.tickets.find((x) => x.code === code) ?? fail("Ese código no existe.");
      if (t.usedAt) fail("Ese boleto ya se usó.");
      if (t.routeId !== d.routeId) fail(`Ese boleto es de la ${routeById(t.routeId).name}.`);
      if (now() - t.at > CONFIG.ticketMinutes * 60000) fail("Ese boleto ya venció.");
      t.usedAt = now(); t.driverId = d.id;
      ledger(db, d, t.base, `Pasaje validado ${t.code}`);
      return { ...t, passenger: findUser(db, t.userId).name };
    });
  }

  /* ---------- Taxis ---------- */
  function quote(from, dest) {
    const km = Geo.distKm(from, [dest.lat, dest.lng]) * CONFIG.roadFactor;
    const base = Math.round(CONFIG.taxiBase + km * CONFIG.taxiPerKm);
    const f = fee(base);
    return { km, base, fee: f, total: base + f };
  }

  const ACTIVE = ["requested", "accepted", "arrived", "ontrip"];
  function expire(db) {
    db.trips.forEach((t) => {
      if (t.status === "requested" && now() - t.at > CONFIG.requestTimeoutMs) { t.status = "expired"; t.updatedAt = now(); }
    });
  }
  const isBusy = (db, driverId) => db.trips.some((t) => t.driverId === driverId && ACTIVE.includes(t.status));

  async function requestTrip(userId, driver, destIndex, pickup) {
    const dest = DESTS[destIndex] ?? fail("Elige un destino.");
    if (!driver || driver.kind !== "taxi") fail("Ese taxi ya no está disponible.");
    return mutate((db) => {
      expire(db);
      const u = findUser(db, userId);
      if (u.role !== "pasajero") fail("Solo los pasajeros piden taxi.");
      if (db.trips.some((t) => t.passengerId === userId && ACTIVE.includes(t.status))) fail("Ya tienes un viaje en curso.");
      if (isBusy(db, driver.id)) fail("Ese taxi acaba de tomar otro viaje.");
      const q = quote(pickup, dest);
      if (u.balance < q.total) fail(`Saldo insuficiente: el viaje cuesta ${money(q.total)}.`);
      const t = {
        id: db.nextId++, passengerId: userId, passengerName: u.name, passengerPhone: u.phone,
        driverId: driver.id, driverName: driver.name, plate: driver.plate, demo: !!driver.demo,
        pickup, dest, base: q.base, fee: q.fee, total: q.total, km: q.km,
        status: "requested", payment: null, at: now(), updatedAt: now(), botPos: driver.demo ? [driver.lat, driver.lng] : null,
      };
      db.trips.push(t);
      return t;
    });
  }

  // Viaje actual del usuario (o el último que terminó hace poco, para avisar cómo terminó)
  async function currentTrip(user) {
    const db = loadDb();
    const key = user.role === "pasajero" ? "passengerId" : "driverId";
    const mine = db.trips.filter((t) => t[key] === user.id).sort((a, b) => b.id - a.id);
    return mine.find((t) => ACTIVE.includes(t.status) && !(t.status === "requested" && now() - t.at > CONFIG.requestTimeoutMs))
      ?? mine.find((t) => now() - t.updatedAt < 20000) ?? null;
  }

  // Cambios de estado del viaje. who = "passenger" | "driver" | "bot"
  const TRANSITIONS = {
    accept: { from: ["requested"], to: "accepted", who: ["driver", "bot"] },
    reject: { from: ["requested"], to: "rejected", who: ["driver", "bot"] },
    arrived: { from: ["accepted"], to: "arrived", who: ["driver", "bot"] },
    start: { from: ["arrived"], to: "ontrip", who: ["driver", "passenger", "bot"] },
    finish: { from: ["ontrip"], to: "done", who: ["driver", "bot"] },
    cancel: { from: ["requested", "accepted", "arrived"], to: "cancelled", who: ["driver", "passenger"] },
  };
  async function tripAction(tripId, action, actor) {
    return mutate((db) => {
      expire(db);
      const t = db.trips.find((x) => x.id === tripId) ?? fail("Viaje no encontrado.");
      const tr = TRANSITIONS[action] ?? fail("Acción no válida.");
      const role = actor === "bot" ? "bot" : actor === t.passengerId ? "passenger" : actor === t.driverId ? "driver" : null;
      if (!role || !tr.who.includes(role)) fail("No puedes hacer eso en este viaje.");
      if (!tr.from.includes(t.status)) fail("El viaje ya cambió de estado.");
      t.status = tr.to; t.updatedAt = now();
      if (t.status === "cancelled") t.cancelledBy = role;
      if (t.status === "done") {
        const p = findUser(db, t.passengerId);
        if (p.balance >= t.total) {
          ledger(db, p, -t.total, `Taxi ${t.plate} → ${t.dest.name}`);
          platformFee(db, t.fee, `Comisión taxi viaje ${t.id}`);
          const d = db.users.find((u) => u.id === t.driverId);
          if (d) ledger(db, d, t.base, `Viaje ${t.id} → ${t.dest.name}`);
          t.payment = "app";
        } else t.payment = "efectivo";
      }
      return t;
    });
  }
  // Los taxis de ejemplo guardan su posición dentro del viaje
  async function setBotPos(tripId, pos) {
    mutate((db) => { const t = db.trips.find((x) => x.id === tripId); if (t) t.botPos = pos; });
  }
  async function busyDriverIds() {
    const db = loadDb();
    return new Set(db.trips.filter((t) => ACTIVE.includes(t.status) && !(t.status === "requested" && now() - t.at > CONFIG.requestTimeoutMs)).map((t) => t.driverId));
  }
  const activeBotTrips = () => loadDb().trips.filter((t) => t.demo && ACTIVE.includes(t.status));

  /* ---------- Ubicación en vivo de choferes ---------- */
  function setLocation(user, loc) {
    const live = loadLive();
    live[user.id] = {
      id: user.id, kind: user.role, name: user.name, plate: user.plate, routeId: user.routeId,
      lat: loc.lat, lng: loc.lng, s: loc.s ?? null, dwell: 0, demo: false, at: now(),
    };
    memLive = live; write(LIVE_KEY, live); chan?.postMessage("change");
  }
  function clearLocation(userId) {
    const live = loadLive();
    delete live[userId];
    memLive = live; write(LIVE_KEY, live); chan?.postMessage("change");
  }
  function liveDrivers() {
    return Object.values(loadLive()).filter((d) => now() - d.at < CONFIG.liveTimeoutMs);
  }

  return {
    AppError, onChange: (f) => listeners.add(f),
    register, login, logout, currentUser, getUser,
    wallet, topup, buyTicket, myTickets, validateTicket,
    quote, requestTrip, currentTrip, tripAction, setBotPos, busyDriverIds, activeBotTrips,
    setLocation, clearLocation, liveDrivers,
  };
})();

const money = (cents) => "$" + (cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
