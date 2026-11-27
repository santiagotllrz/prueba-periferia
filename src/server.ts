import { readFileSync } from "node:fs"
import { join } from "node:path"
import { turno, type Sesion } from "./agent/loop"
import { AnthropicAdapter, errorLlmLegible } from "./llm/anthropic"
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

const server = Bun.serve({
  port: Number(env("PORT", "3000")),
  idleTimeout: 255,
  routes: {
    "/": () => new Response(Bun.file(join(root, "web", "index.html"))),
    "/api/health": () => json({ ok: true, provider: llm.proveedor, model: llm.modelo, llm_configurado: !!process.env.ANTHROPIC_API_KEY }),
    "/api/sessions/:id": (req) => {
      const s = sesiones.get(req.params.id)
      return s ? json({ id: s.id, historial: s.vista, esperandoConfirmacion: s.esperandoConfirmacion, tokensUsados: s.tokensUsados }) : json({ error: "Sesión no encontrada" }, 404)
    },
    "/api/chat": {
      POST: async (req) => {
        let body: { sessionId?: unknown; message?: unknown }
        try {
          body = (await req.json()) as typeof body
        } catch {
          return json({ error: "Cuerpo JSON inválido" }, 400)
        }
        if (typeof body.sessionId !== "string" || !/^[\w-]{1,64}$/.test(body.sessionId)) return json({ error: "sessionId inválido" }, 400)
        if (typeof body.message !== "string" || !body.message.trim()) return json({ error: "message vacío" }, 400)
        const s = sesion(body.sessionId)
        const r = await turno(s, body.message.slice(0, MAX_MENSAJE), llm, { ...cfgBase, system: systemPrompt() }, errorLlmLegible)
        return json(r)
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
