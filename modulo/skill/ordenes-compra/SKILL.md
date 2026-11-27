---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia — reglas de control RC1–RC10, acciones sugeridas, datos de la OC y maestros de IVA y condiciones de pago.
---

## Proceso de órdenes de compra en Periferia

Cada compra llega por correo con tres piezas: solicitud (Excel), cotización del proveedor (PDF) y correo de aprobación del líder. Algunas traen además la factura: si la factura es anterior a la solicitud, la OC es **retroactiva** (desvío de proceso que la dirección quiere medir).

### Reglas de control (las aplica `oc_validar`)

| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | Proveedor existe en el maestro (por NIT, o por nombre si no hay NIT) y está activo | Bloqueo |
| RC2 | Hay aprobación, contiene "Aprobado" y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | Valor total ≤ tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización vs solicitud difiere ≤ 2 % (sin cotización → confirmar) | Confirmación |
| RC6 | IVA ausente → se deriva del proveedor | Confirmación + derivado |
| RC7 | Condiciones de pago ausentes → se derivan del proveedor | Derivado (solo informar) |
| RC8 | Factura anterior a la solicitud → retroactiva | Confirmación |
| RC9 | Aprobación anterior a la solicitud | Confirmación |
| RC10 | cantidad × valor unitario = valor total (± 1) | Bloqueo |

### Acciones sugeridas típicas

- **Proveedor inexistente**: pedir a Compras crear el proveedor en SAP (RUT, cámara de comercio, certificación bancaria) o usar uno existente.
- **Aprobador sin autoridad**: pedir la aprobación a un aprobador del centro de costo con tope suficiente.
- **Diferencia con la cotización**: confirmar con el solicitante cuál valor es el correcto; la OC se crea por el valor de la solicitud.
- **IVA no informado**: confirmar el indicador propuesto (default del proveedor).

### Datos de la OC

- Sociedad y organización de compras: 1000.
- Posición 10, texto breve máx. 40 caracteres, unidad UN / H (horas) / MES.
- Evidencia de aprobación: `out/<caso>/aprobacion.txt` y `.pdf` con sha256.
- Numeración SAP simulada desde 4500000001; crear dos veces la misma solicitud devuelve la misma OC.
- Cada intento queda en `out/control.csv` (creada, bloqueada, pendiente_confirmacion, idempotente).

### Indicadores y condiciones

- IVA: C0 excluido, C1 19 %, C2 5 %.
- Pago: Z000 inmediato, Z015 15 días, Z030 30 días, Z060 60 días.
