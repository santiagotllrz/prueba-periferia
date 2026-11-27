# SOLUCIÓN — Reto 03 · Agente "Órdenes de Compra SAP"

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra y verifica de memoria quién puede aprobar qué; eso le cuesta tiempo, genera errores que se corrigen en el cierre contable y deja sin medir las OC retroactivas. Les duele a la analista, a Contabilidad y Auditoría, y a la dirección.

## 2. Arquitectura

```
┌──────────────┐  POST /api/chat   ┌────────────────────────────────────────────┐
│ web/index.html│ ───────────────▶ │ src/server.ts (Bun.serve)                   │
│ chat, tool    │ ◀─────────────── │   └─ src/agent/loop.ts  (ciclo del agente)  │
│ calls, banner │  reply/toolCalls │        ├─ src/llm/adapter.ts → anthropic.ts │
│ confirmación  │  needsConfirm.   │        └─ src/tools/registry.ts (zod + log) │
└──────────────┘                   │             └─ src/tools/oc.ts             │
                                   │                  └─ src/domain/* (reglas)   │
                                   │                  └─ src/sap/mock.ts          │
                                   └──────────────┬──────────────────┬──────────┘
                                         fixtures/ (solo lectura)   out/ (escritura)
```

- **Comportamiento:** `agent/prompt.md`, cargado en cada turno; se puede editar sin reiniciar.
- **Conocimiento:** `src/knowledge/ordenes-compra.md`, que se concatena al system prompt.
- **Ejecución:** `src/tools/oc.ts` es la capa fina que expone las herramientas. Las reglas viven en `src/domain/` como funciones puras (`validar.ts`, `payload.ts`, `paquete.ts`). Si cambia una regla de negocio, se toca `src/domain/`, nunca el servidor.
- `demo.ts` y `modulo/tools/oc.ts` importan las mismas herramientas que el servidor.

## 3. Ciclo del agente

`src/agent/loop.ts`:

1. Se agrega el mensaje del usuario al historial de la sesión (en memoria).
2. Bucle de hasta `MAX_ITERACIONES` (25): se llama a `llm.enviar(system, mensajes, herramientas)`. Si el modelo pide herramientas, cada una pasa por `ejecutarHerramienta`, que valida los argumentos con zod, ejecuta, nunca lanza y escribe en `out/log.jsonl`. Los resultados vuelven al modelo. Si al llegar al tope no hay respuesta final, el agente devuelve lo que tiene y avisa.
3. **Tope de costo:** los tokens de entrada y salida se acumulan por sesión. Al pasar `MAX_TOKENS_SESION`, la sesión deja de llamar al modelo.
4. **Confirmación humana (CA3), en dos capas:**
   - *Prompt:* si hay confirmaciones, el agente termina el turno con una pregunta y no llama `oc_crear`.
   - *Código (no depende del modelo):* `oc_crear` solo acepta `confirmado=true` si `ctx.confirmacionHumana` es verdadero. El backend lo calcula así: el turno anterior quedó en estado `esperandoConfirmacion` y el mensaje actual del usuario es afirmativo ("confirmo", "sí", "procede"…). Si el modelo intenta auto-confirmarse, la herramienta lo rechaza y queda una fila `pendiente_confirmacion` en `control.csv`. `demo.ts` muestra los dos caminos.
   - El front recibe `needsConfirmation` y resalta el mensaje con un banner y los botones "Confirmo / No crear".
5. **Errores (CA5):** los errores del SDK (autenticación, rate limit, timeout, conexión) se traducen a un mensaje claro en el chat y la sesión sigue viva.

## 4. Elección del modelo

- **Proveedor:** Anthropic, modelo `claude-opus-5-5` (configurable con `LLM_MODEL`), con esfuerzo `low`. El trabajo es orquestar herramientas y resumir; la lógica de negocio es determinista y no depende del modelo, así que no hace falta pensar mucho.
- **Por qué:** maneja bien el uso de herramientas y las instrucciones en español, y no "rellena" valores cuando el prompt lo prohíbe.
- **Costo estimado por caso:** unas 4 a 6 llamadas por caso. Cada una lleva unos 3.000 tokens de entrada (prompt, herramientas e historial) y unos 300 de salida. En total son unos 20.000 tokens de entrada y 2.000 de salida, que a $4 / $20 por millón dan ≈ **USD 0,12 por caso**. Con 30 OC al mes son unos USD 4. Se puede bajar con `LLM_MODEL=claude-haiku-5-5` (≈ USD 0,003 por caso) o con caché del prompt.

## 5. Diseño del adaptador SAP real (PRD 7.5)

- **Opción elegida:** OData `API_PURCHASEORDER_PROCESS_SRV` (S/4HANA), expuesto a través de SAP Integration Suite o API Management. Es la API estándar y está liberada; usa HTTP y JSON, se audita fácil y no requiere un conector RFC en el servidor. Si el sistema es ECC sin OData, la alternativa es `BAPI_PO_CREATE1` vía RFC desde un microservicio con SAP NW RFC SDK.
- **Mapeo:** `proveedor.codigo_sap` → `Supplier`; `sociedad` → `CompanyCode`; `organizacion_compras` → `PurchasingOrganization`; `condiciones_pago` → `PaymentTerms`; `moneda` → `DocumentCurrency`. Cada posición va a `to_PurchaseOrderItem`: `numero` → `PurchaseOrderItem`, `descripcion` → `PurchaseOrderItemText`, `cantidad` / `unidad` → `OrderQuantity` / `PurchaseOrderQuantityUnit`, `precio_unitario` → `NetPriceAmount`, `indicador_iva` → `TaxCode`, y `centro_costo` en `to_AccountAssignment` (`CostCenter`, categoría K). La subárea va en un campo de usuario o en el texto. La referencia `solicitud_id` va en `PurchaseOrder` externo o en un texto de cabecera. La evidencia se adjunta con la API de Attachments (GOS).
- **Autenticación:** OAuth2 client credentials (o un certificado X.509) de un usuario técnico con permisos mínimos (ME21N y objeto M_BEST_*). Las credenciales viven en un gestor de secretos (OCI Vault, Azure Key Vault) y las lee solo el adaptador. Nunca están en el prompt, en el agente ni en los logs.
- **Idempotencia y errores parciales:** antes de crear, `buscarOrdenPorReferencia(solicitud_id)` consulta SAP por la referencia. Los reintentos se hacen con backoff solo si hay timeout o un 5xx, y siempre con una consulta previa por referencia. Si SAP crea la cabecera pero falla en el adjunto, la OC queda creada, el adjunto pasa a una cola de reintento y en `control.csv` se registra `creada_con_advertencia`.
- **Plan B (si no hay conexión):** el agente hace todo igual hasta el payload y genera (a) un resumen "listo para pegar" en ME21N, campo por campo, y (b) un archivo de carga masiva (CSV para LSMW o la app Fiori *Import Purchase Orders*). El ahorro de validación y de digitación se mantiene; solo cambia el último clic.

## 6. Decisiones y trade-offs

1. **Las herramientas releen el caso en lugar de confiar en el `paquete` o el `payload` que envía el modelo.** El contrato del PRD los recibe como argumento: se aceptan, pero se ignoran y se recalculan desde los fixtures. *Alternativa descartada:* usar lo que manda el modelo, porque abre la puerta a que el modelo "arregle" un monto (riesgo explícito del PRD). *Costo:* algo más de lectura de disco, que es despreciable.
2. **La confirmación humana se verifica en código, no solo en el prompt.** *Descartado:* confiar en que el modelo respete el prompt. Un modelo puede auto-confirmarse; aquí la herramienta lo impide.
3. **Las reglas son funciones puras en `src/domain/` y el LLM solo orquesta.** *Descartado:* que el modelo evalúe las reglas desde el conocimiento, porque no sería determinista ni testeable. `demo.ts` prueba todas las reglas sin el modelo.
4. **Bun.serve con HTML plano, sin framework.** *Descartado:* React o Next, porque con un tiempo de 2 horas el front plano arranca en menos de 2 minutos y no tiene paso de build.
5. **Sesiones en memoria.** *Descartado:* guardarlas en archivo. Si el servidor se reinicia, se pierden las conversaciones, pero no los resultados (`out/` es la fuente de verdad e `oc_crear` es idempotente).

## 7. Supuestos

- Los montos de la solicitud y de la cotización incluyen IVA. La OC se crea por el valor de la **solicitud**; la cotización solo se compara (RC5).
- La aprobación se compara solo por fecha (sin hora) con `fecha_solicitud`.
- RC3 solo se evalúa si el remitente es aprobador del centro (si no, ya falla RC2). En `sol-003` el bloqueo es RC2: Felipe Vargas es aprobador de CC-3030, no de CC-2020.
- Unidad: "H" si la descripción menciona horas, "MES" si dice mensualidad o "por mes", y "UN" en otro caso.
- "Aprobado" se detecta como palabra completa y se excluye "no aprobado".
- Un indicador de IVA o una condición de pago que no exista en el maestro es un bloqueo (no lo pide el PRD, pero evita crear una OC inválida).

## 8. Cobertura

| HU | Estado | Nota / qué falta para producción |
|---|---|---|
| HU-1 Leer paquete | Hecho | Los adjuntos ausentes se reportan en `faltantes`. Falta leer `.xlsx` y `.pdf` reales (P1). |
| HU-2 Validar | Hecho | RC1–RC10 cubiertas, con bloqueos, confirmaciones y derivados. |
| HU-3 Payload | Hecho | Validado con zod; trazabilidad en `out/<caso>/trazabilidad.json`. |
| HU-4 Evidencia | Hecho | P0 txt con sha256 + P1 pdf (pdf-lib). |
| HU-5 Crear OC | Hecho | Idempotente, numeración desde 4500000001 y `control.csv` en cada intento. |
| HU-6 Errores | Hecho | `{ ok:false, error }` en todas las herramientas; maneja caso inexistente, JSON malformado y nombres de caso inseguros. |
| Front | Hecho | Muestra las tool calls (expandibles), el banner de confirmación y el indicador de "pensando". |
| `oc_leer_excel` | No hecho | P1 opcional. |
| Bonus `modulo/` | Hecho | `agent.md` y `SKILL.md` se generan desde las mismas fuentes (`bun run modulo`); `tools/oc.ts` re-exporta las mismas herramientas. |

Para producción falta: autenticación de usuarios, persistencia de sesiones, el adaptador SAP real, la lectura del buzón de correo y tests unitarios formales (hoy los cubre `demo.ts`).

## 9. Uso de IA

- **Claude Code (Claude Opus):** generó la estructura del proyecto, el código de las herramientas, el ciclo del agente, el front y el borrador de esta documentación, a partir del PRD. Lo usé también para revisar los casos de prueba contra las reglas.
- **Revisión propia:** ejecuté `demo.ts`, comparé cada caso con lo que espera el PRD y verifiqué el tipado (`tsc --noEmit` sin errores).
- **Descartado:** (a) dejar que el modelo pase el payload a `oc_crear`, por el riesgo de que altere montos; (b) confiar solo en el prompt para la confirmación; (c) usar un framework de front, que no hacía falta para el alcance.

## 10. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| El modelo inventa o altera valores | Las herramientas son la única fuente de datos y se recalculan desde el origen; el prompt prohíbe afirmar valores que no salieron de una herramienta. |
| Auto-confirmación del modelo | La confirmación se verifica en código (`ctx.confirmacionHumana`). |
| Maestros desactualizados | En producción se consultan en SAP en línea (`consultarProveedor`) y el maestro necesita un dueño del dato. |
| Correos de aprobación falsificados | Validar DKIM/SPF del correo o pasar a aprobación en un sistema (workflow o firma digital). |
| Costo descontrolado del LLM | Tope de iteraciones y de tokens por sesión, y un modelo configurable a uno más barato. |
| Fuga de la clave | Solo existe como variable de entorno del backend; `/api/health` no la expone; `.env` está en `.gitignore`. |
| Integración SAP no viable | Plan B: resumen listo para pegar o archivo de carga masiva (sección 5). |
| Link público sin autenticación | Agregar una clave de acceso o SSO antes de exponer datos reales; hoy solo se usan datos ficticios. |
