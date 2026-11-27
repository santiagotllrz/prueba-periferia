import type { Bloque, LlmAdapter, Mensaje } from "../llm/adapter"
import { definiciones, ejecutarHerramienta } from "../tools/registry"

export type LlamadaVisible = { nombre: string; args: unknown; ok: boolean; resumen: string; resultado: string }

export type Sesion = {
  id: string
  mensajes: Mensaje[]
  vista: Array<{ rol: "usuario" | "agente"; texto: string; toolCalls?: LlamadaVisible[]; needsConfirmation?: boolean }>
  esperandoConfirmacion: boolean
  tokensUsados: number
}

export type Config = { maxIteraciones: number; maxTokensSesion: number; directory: string; system: string }

const CONFIRMA = /\b(s[ií]|confirmo|confirmado|procede|procedan|adelante|cr[eé]ala|crear|dale|ok|apruebo|de acuerdo)\b/i
const NIEGA = /\b(no|cancela|espera|det[eé]n)\b/i

/** Confirmación humana (CA3): solo vale si el agente preguntó en el turno anterior y el usuario respondió afirmativamente. */
export function esConfirmacion(sesion: Sesion, mensaje: string): boolean {
  return sesion.esperandoConfirmacion && CONFIRMA.test(mensaje) && !NIEGA.test(mensaje.replace(/\bno\s+hay\b/gi, ""))
}

function resumir(resultado: string): { ok: boolean; resumen: string; pideConfirmacion: boolean } {
  try {
    const r = JSON.parse(resultado) as { ok: boolean; error?: string; data?: Record<string, unknown> }
    const pide =
      (!r.ok && r.data?.requiere_confirmacion === true) ||
      (r.ok && Array.isArray(r.data?.confirmaciones) && (r.data.confirmaciones as unknown[]).length > 0 && r.data.apta === true) ||
      (r.ok && Array.isArray(r.data?.confirmaciones_pendientes) && (r.data.confirmaciones_pendientes as unknown[]).length > 0)
    if (!r.ok) return { ok: false, resumen: r.error ?? "error", pideConfirmacion: pide }
    const d = r.data ?? {}
    const resumen =
      "numero_oc" in d ? `OC ${String(d.numero_oc)}${d.idempotente ? " (ya existía)" : ""}`
      : "apta" in d ? `apta=${String(d.apta)}, ${(d.bloqueos as unknown[]).length} bloqueos, ${(d.confirmaciones as unknown[]).length} confirmaciones`
      : "sha256" in d ? `evidencia ${String(d.ruta)}`
      : "orden" in d ? `payload listo (${String(d.ruta_trazabilidad)})`
      : "solicitud" in d ? "paquete leído"
      : "ok"
    return { ok: true, resumen, pideConfirmacion: pide }
  } catch {
    return { ok: false, resumen: "respuesta no JSON", pideConfirmacion: false }
  }
}

/** Ciclo del agente: prompt → modelo → herramientas → … → respuesta, con tope de iteraciones (CA1). */
export async function turno(
  sesion: Sesion,
  mensajeUsuario: string,
  llm: LlmAdapter,
  cfg: Config,
  errorLegible: (e: unknown) => string,
): Promise<{ reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }> {
  const confirmacionHumana = esConfirmacion(sesion, mensajeUsuario)
  sesion.vista.push({ rol: "usuario", texto: mensajeUsuario })
  sesion.mensajes.push({ role: "user", content: [{ type: "text", text: mensajeUsuario }] })

  const toolCalls: LlamadaVisible[] = []
  let pideConfirmacion = false
  let reply = ""

  if (sesion.tokensUsados >= cfg.maxTokensSesion) {
    reply = "Se alcanzó el tope de tokens de esta sesión. Abre una sesión nueva para continuar."
  } else {
    for (let i = 0; i < cfg.maxIteraciones; i++) {
      let r
      try {
        r = await llm.enviar(cfg.system, sesion.mensajes, definiciones())
      } catch (e) {
        reply = `⚠️ ${errorLegible(e)}`
        if (i === 0) sesion.mensajes.pop() // se descarta el mensaje para poder reintentar sin romper el historial
        break
      }
      sesion.tokensUsados += r.uso.entrada + r.uso.salida
      sesion.mensajes.push({ role: "assistant", content: r.bloques })
      const texto = r.bloques.filter((b): b is Extract<Bloque, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n")
      const usos = r.bloques.filter((b): b is Extract<Bloque, { type: "tool_use" }> => b.type === "tool_use")

      if (r.fin !== "herramientas" || usos.length === 0) {
        reply = texto || (r.fin === "rechazo" ? "El modelo no pudo responder a esta solicitud." : "(sin respuesta)")
        break
      }
      const resultados: Bloque[] = []
      for (const u of usos) {
        const resultado = await ejecutarHerramienta(u.name, u.input, { directory: cfg.directory, sessionId: sesion.id, confirmacionHumana })
        const s = resumir(resultado)
        pideConfirmacion ||= s.pideConfirmacion
        toolCalls.push({ nombre: u.name, args: u.input, ok: s.ok, resumen: s.resumen, resultado })
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: resultado, is_error: !s.ok })
      }
      sesion.mensajes.push({ role: "user", content: resultados })
      if (i === cfg.maxIteraciones - 1)
        reply = `${texto}\n\n_Se alcanzó el tope de ${cfg.maxIteraciones} iteraciones. Esto es lo que tengo; pide continuar si falta algo._`
    }
  }

  const creada = toolCalls.some((t) => t.nombre === "oc_crear" && t.ok)
  sesion.esperandoConfirmacion = pideConfirmacion && !creada
  sesion.vista.push({ rol: "agente", texto: reply, toolCalls, needsConfirmation: sesion.esperandoConfirmacion })
  return { reply, toolCalls, needsConfirmation: sesion.esperandoConfirmacion }
}
