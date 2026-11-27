# Reto 03 — Agente conversacional "Órdenes de Compra SAP"

Agente que lee el paquete de compra (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros con las reglas RC1–RC10, construye la OC, genera la evidencia de aprobación y la crea en un SAP simulado. Los bloqueos se devuelven al humano y las excepciones piden confirmación explícita.

**Link de prueba:** _(se completa al desplegar)_

## Requisitos

- [Bun](https://bun.sh) 1.1 o superior
- Una clave de la API de Anthropic

## Levantar en local (un comando)

```bash
cp .env.example .env        # y pon tu ANTHROPIC_API_KEY
bun install && bun run dev  # http://localhost:3000
```

## Variables de entorno

| Variable | Obligatoria | Default | Uso |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (para el chat) | — | Clave del modelo. Solo vive en el backend. |
| `LLM_MODEL` | No | `claude-opus-5-5` | Modelo de Claude |
| `PORT` | No | `3000` | Puerto HTTP |
| `MAX_ITERACIONES` | No | `25` | Tope de ciclos modelo → herramienta por turno |
| `MAX_TOKENS_SESION` | No | `300000` | Tope de tokens por sesión (control de costo) |
| `LLM_TIMEOUT_MS` | No | `90000` | Timeout de la llamada al modelo |

## Verificación sin modelo

```bash
bun install && bun run demo.ts
```

Procesa los 6 casos llamando directamente a las herramientas, muestra la idempotencia (`sol-001` dos veces) y la confirmación explícita de `sol-004`. No necesita clave. Limpia `out/` al inicio.

Resultado esperado:

| Caso | Resultado |
|---|---|
| sol-001 | OC 4500000001 creada |
| sol-002 | Bloqueada: `PROVEEDOR_INEXISTENTE` |
| sol-003 | Bloqueada: `APROBADOR_SIN_AUTORIDAD` |
| sol-004 | Pide confirmación: `DIFERENCIA_COTIZACION` (6 %) → OC tras confirmar |
| sol-005 | Pide confirmación: `OC_RETROACTIVA`, `retroactiva = true` |
| sol-006 | Pide confirmación: `IVA_DERIVADO` (C1); condiciones de pago derivadas (Z030) |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` (nunca expone la clave) |

## Estructura

```
agent/prompt.md               comportamiento (system prompt)
src/knowledge/                conocimiento del proceso
src/tools/oc.ts               herramientas (oc_leer_paquete, oc_validar, oc_construir_payload, oc_generar_evidencia, oc_crear)
src/tools/registry.ts         validación zod de argumentos, ejecución y log
src/domain/                   reglas puras: lectura del paquete, RC1–RC10, payload, evidencia, control
src/sap/adapter.ts, mock.ts   interfaz SapAdapter y SAP simulado en out/sap/
src/llm/adapter.ts            interfaz del proveedor LLM; anthropic.ts es la implementación
src/agent/loop.ts             ciclo del agente, tope de iteraciones y confirmación humana
src/server.ts                 API HTTP (Bun.serve) y front estático
web/index.html                chat
modulo/                       bonus: agente empaquetado (bun run modulo lo regenera)
```

## Salidas (`out/`)

- `out/sap/ordenes.jsonl`: OC creadas
- `out/control.csv`: cada intento (creada, bloqueada, pendiente_confirmacion, idempotente)
- `out/log.jsonl`: cada llamada a una herramienta
- `out/<caso>/aprobacion.txt`, `aprobacion.pdf`, `trazabilidad.json`, `payload.json`
