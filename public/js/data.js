"use strict";
// Configuración y rutas. Los montos están en centavos (MXN) para evitar errores de redondeo.
const CONFIG = {
  center: [20.6767, -103.3475],
  busSpeedKmh: 18,      // velocidad promedio de camión en ciudad
  taxiSpeedKmh: 24,     // velocidad promedio de taxi
  dwellSeconds: 30,     // tiempo detenido en cada parada
  roadFactor: 1.3,      // las calles no van en línea recta
  busFare: 1100,        // pasaje de camión: $11.00
  taxiBase: 1310,       // banderazo: $13.10
  taxiPerKm: 750,       // $7.50 por km
  commission: 0.15,     // comisión de la app en cada compra (15%)
  ticketMinutes: 60,    // vigencia del boleto
  welcomeBonus: 5000,   // saldo de regalo al crear cuenta de pasajero ($50)
  liveTimeoutMs: 30000, // un chofer que no manda ubicación en 30 s deja de aparecer
  requestTimeoutMs: 90000, // una solicitud de taxi sin respuesta se cancela en 90 s
  demoDrivers: true,    // choferes de ejemplo para que el mapa no esté vacío
};

const ROUTES = [
  {
    id: "R1", name: "Ruta 1 · Centro – Minerva", color: "#e4572e",
    stops: [
      ["Catedral", 20.6767, -103.3470], ["Av. Juárez / 16 de Sep.", 20.6741, -103.3505],
      ["Federalismo", 20.6738, -103.3577], ["Av. Chapultepec", 20.6735, -103.3685],
      ["Av. Américas", 20.6740, -103.3780], ["Minerva", 20.6745, -103.3880],
    ],
  },
  {
    id: "R2", name: "Ruta 2 · Plaza del Sol – Centro", color: "#2e86ab",
    stops: [
      ["Plaza del Sol", 20.6497, -103.4012], ["López Mateos / Niños Héroes", 20.6610, -103.3925],
      ["Arcos de Guadalajara", 20.6730, -103.3887], ["Av. Vallarta / Chapultepec", 20.6752, -103.3690],
      ["Parque Revolución", 20.6742, -103.3555], ["Catedral", 20.6767, -103.3470],
    ],
  },
  {
    id: "R3", name: "Ruta 3 · Centro – Tlaquepaque", color: "#3bb273",
    stops: [
      ["San Juan de Dios", 20.6745, -103.3390], ["Plaza Patria Oriente", 20.6660, -103.3350],
      ["Revolución / Gigantes", 20.6555, -103.3280], ["Glorieta Niños Héroes Sur", 20.6450, -103.3200],
      ["Tlaquepaque Centro", 20.6405, -103.3115],
    ],
  },
].map(Geo.buildRoute);

const routeById = (id) => ROUTES.find((r) => r.id === id);

// Destinos para taxi = todas las paradas conocidas, sin repetir
const DESTS = [...new Map(ROUTES.flatMap((r) => r.stops.slice(0, r.terminal + 1)).map((s) => [s[0], s])).values()]
  .map(([name, lat, lng]) => ({ name, lat, lng }));
