# MueveT · App de transporte público (camiones y taxis de calle)

Web app (PWA) para pasajeros, pensada para **camiones urbanos** y **taxis de calle que no usan app**.

## Qué hace

**🚌 Camiones**
- Eliges la **ruta** y ves por dónde va (ida y vuelta, paradas, distancia y duración de la vuelta) dibujada en el mapa.
- **Tiempo de parada en parada**: cuánto se tarda de cada parada a la siguiente y en cuántos minutos llega el próximo camión a cada una.
- **A cuánto está el chofer**: eliges tu parada y te dice qué unidad viene, el nombre del chofer, a cuántos metros/km está y en cuántos minutos llega.
- **Pagar pasaje** desde la app (pasaje + 15% de comisión): se descuenta del saldo y genera un código para mostrar al chofer o al validador.

**🚕 Taxis de calle**
- Lista de taxis cercanos con distancia y tiempo de llegada.
- Eliges destino y ves la tarifa estimada (banderazo + por km + 15% de comisión de la app).
- Pides el taxi, ves cómo se acerca y la ruta del viaje en el mapa; al llegar se **cobra automáticamente** del saldo y se desglosa lo que recibe el chofer y la comisión de la app.
- El chofer no necesita instalar nada: en producción solo usaría un gafete con QR y un rastreador GPS.

**💳 Cartera**
- Saldo, recargas e historial de movimientos.

## Cómo correrla

No necesita instalar nada. Desde la carpeta del proyecto:

```bash
python3 -m http.server 8000
```

y abre <http://localhost:8000> (en el celular se puede "Agregar a pantalla de inicio").

## Importante: es un prototipo

- **Ubicaciones simuladas.** Los camiones y taxis se mueven por simulación (`js/app.js`, sección "Simulación"). Para que sea real se necesita un backend que reciba el GPS de cada unidad (rastreador o celular del chofer) y lo mande a la app.
- **Pagos simulados.** El saldo se guarda solo en el navegador. Para cobrar dinero de verdad hay que conectar una pasarela (por ejemplo Mercado Pago, Conekta, Stripe, OpenPay) y llevar el saldo en el servidor.
- **Rutas de ejemplo.** Las rutas y paradas de `js/data.js` son de muestra en Guadalajara; se reemplazan por las rutas reales de tu ciudad (se pueden importar desde GTFS si la ciudad lo publica).
- Los tiempos se calculan con velocidad promedio (`CONFIG` en `js/data.js`); con GPS real conviene usar velocidades históricas por tramo y hora.
