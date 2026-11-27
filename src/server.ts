import { readFileSync } from "node:fs"
import { join } from "node:path"
import { turno, type Evento, type Sesion } from "./agent/loop"
import { AnthropicAdapter, errorLlmLegible, tipoCredencial } from "./llm/anthropic"
import type { LlmAdapter } from "./llm/adapter"

const root = join(import.meta.dir, "..")
const env = (k: string, d: string) => process.env[k] || d

const cfgBase = {
  maxIteraciones: Number(env("MAX_ITERACIONES", "25")),
  maxTokensSesion: Number(env("MAX_TOKENS_SESION", "300000")),
  directory: root,
}

/** Comportamiento (agent/prompt.md) + conocimiento (src/knowledge/) se cargan de archivos, no del código. */
function systemPrompt(): string {
  const prompt = readFileSync(join(root, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(root, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${prompt}\n\n---\n# Conocimiento del proceso\n\n${conocimiento}`
}

const llm: LlmAdapter = new AnthropicAdapter(env("LLM_MODEL", "claude-opus-5-5"), Number(env("LLM_TIMEOUT_MS", "90000")))
const sesiones = new Map<string, Sesion>()
const MAX_MENSAJE = 4000

function sesion(id: string): Sesion {
  let s = sesiones.get(id)
  if (!s) {
    s = { id, mensajes: [], vista: [], esperandoConfirmacion: false, tokensUsados: 0 }
    sesiones.set(id, s)
  }
  return s
}

const json = (data: unknown, status = 200) => Response.json(data, { status })

/** Valida el cuerpo { sessionId, message } común a /api/chat y /api/chat/stream. */
async function leerEntrada(req: Request): Promise<{ sessionId: string; message: string } | { error: string }> {
  let body: { sessionId?: unknown; message?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return { error: "Cuerpo JSON inválido" }
  }
  if (typeof body.sessionId !== "string" || !/^[\w-]{1,64}$/.test(body.sessionId)) return { error: "sessionId inválido" }
  if (typeof body.message !== "string" || !body.message.trim()) return { error: "message vacío" }
  return { sessionId: body.sessionId, message: body.message.slice(0, MAX_MENSAJE) }
}

const server = Bun.serve({
  port: Number(env("PORT", "3000")),
  idleTimeout: 255,
  routes: {
    "/": () => new Response(Bun.file(join(root, "web", "index.html"))),
    "/api/health": () => json({ ok: true, provider: llm.proveedor, model: llm.modelo, credencial: tipoCredencial(), llm_configurado: tipoCredencial() !== "ninguna" }),
    "/api/sessions/:id": (req) => {
      const s = sesiones.get(req.params.id)
      return s ? json({ id: s.id, historial: s.vista, esperandoConfirmacion: s.esperandoConfirmacion, tokensUsados: s.tokensUsados }) : json({ error: "Sesión no encontrada" }, 404)
    },
    "/api/chat": {
      POST: async (req) => {
        const e = await leerEntrada(req)
        if ("error" in e) return json({ error: e.error }, 400)
        const r = await turno(sesion(e.sessionId), e.message, llm, { ...cfgBase, system: systemPrompt() }, errorLlmLegible)
        return json(r)
      },
    },
    /** Misma API que /api/chat pero transmite eventos en vivo (Server-Sent Events): texto, herramientas y fin. */
    "/api/chat/stream": {
      POST: async (req) => {
        const e = await leerEntrada(req)
        if ("error" in e) return json({ error: e.error }, 400)
        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(ctrl) {
            const enviar = (ev: Evento) => {
              try {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
              } catch {
                /* el cliente cerró la conexión; el turno termina igual */
              }
            }
            try {
              await turno(sesion(e.sessionId), e.message, llm, { ...cfgBase, system: systemPrompt() }, errorLlmLegible, enviar)
            } catch {
              enviar({ tipo: "fin", reply: "⚠️ Error interno al procesar el mensaje.", toolCalls: [], needsConfirmation: false })
            }
            ctrl.close()
          },
        })
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" },
        })
      },
    },
  },
  fetch: () => json({ error: "No encontrado" }, 404),
  error: (e) => {
    console.error("Error del servidor:", e.message)
    return json({ error: "Error interno" }, 500)
  },
})

console.log(`Agente OC escuchando en http://localhost:${server.port} · modelo ${llm.modelo}`)
