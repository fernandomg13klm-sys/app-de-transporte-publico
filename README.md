# MueveT · App de transporte público (camiones y taxis de calle)

App para **pasajeros**, **choferes de camión** y **taxistas de calle**, con mapa en vivo, cuentas y cobro con 15% de comisión para la app.

## Cómo abrirla

- **Lo más fácil:** abre `dist/MueveT.html` con doble clic. Es toda la app en un solo archivo y necesita internet solo para el mapa.
- **Para trabajar en el código:**

  ```bash
  npm start
  ```

  y abre <http://localhost:8000>.
- Si cambias el código, vuelve a generar el archivo único:

  ```bash
  npm run build
  ```

## Qué hace

**Cuentas**
- Crear cuenta como pasajero, chofer de camión (con su ruta y número de unidad) o taxista (con sus placas).
- Iniciar y cerrar sesión, con opción de mantener la sesión iniciada.
- Las contraseñas no se guardan: se guarda solo una huella cifrada (PBKDF2).

**🗺️ Mapa en vivo (todos)**
- Muestra los camiones de cada ruta (con su color y número) y los taxis libres u ocupados.
- Al tocar un vehículo ves quién maneja, su unidad o placas, su ruta, por dónde va y a cuánto está de ti.
- Puedes filtrar por camiones, taxis o rutas, y ver una lista de los más cercanos.
- Botones para centrarte en tu ubicación (📍), poner tu ubicación a mano (✋) y ver toda la ciudad (🗺️).

**🧍 Pasajero**
- **Camiones:** qué ruta va, tiempo de parada en parada, en cuánto llega el próximo camión, qué chofer viene y a cuánto está. Paga el pasaje y recibe un código para el chofer.
- **Taxis:** eliges destino, ves la tarifa con el desglose, pides un taxi y lo sigues en el mapa. Se cobra al terminar el viaje.
- **Cartera:** saldo, recargas, boletos activos e historial.

**🚌 Chofer de camión**
- Botón **En servicio**: comparte su ubicación por GPS y aparece en el mapa de los pasajeros.
- Ve en qué parada va y valida los códigos de pasaje (cada código sirve una sola vez, solo en su ruta y por 60 minutos).

**🚕 Taxista**
- Botón **En servicio** para recibir viajes.
- Acepta o rechaza solicitudes, ve la línea hacia el pasajero y luego hacia el destino, y termina el viaje para cobrarlo.

**💰 Comisión**
- Cada compra (pasaje o viaje) lleva **15% de comisión** encima del precio. El chofer recibe el precio completo y la app se queda con la comisión.
- Las tarifas y la comisión se cambian en `public/js/data.js` (`CONFIG`).

## Probar pasajero y chofer al mismo tiempo

Abre la app en **dos pestañas del mismo navegador**. En una crea una cuenta de taxista y activa **En servicio** con "Simular recorrido". En la otra crea una cuenta de pasajero y pide ese taxi. Las dos pestañas se comunican en vivo.

## Limitaciones actuales (se resuelven al conectar el servidor)

- **Los datos viven en el navegador.** Las cuentas, el saldo y los viajes se guardan en el dispositivo (localStorage) y solo se comparten entre pestañas del mismo navegador. Para que un chofer en su celular aparezca en el celular de un pasajero hace falta el servidor. `public/js/store.js` ya tiene la misma forma que tendrá la API, así que solo se cambia ese archivo.
- **Pagos de prueba.** Las recargas no cobran dinero real. Falta conectar la pasarela (Mercado Pago, Stripe, etc.).
- **Choferes de ejemplo.** Los vehículos marcados como `demo` son de ejemplo para que el mapa no esté vacío. Se apagan con `CONFIG.demoDrivers = false`.
- **Rutas de ejemplo** en Guadalajara (`public/js/data.js`). Se reemplazan por las rutas reales.
- El GPS del navegador solo funciona en `https://`, en `localhost` o al abrir el archivo directo. Si no hay GPS, el chofer puede poner su ubicación a mano o usar "Simular recorrido".
