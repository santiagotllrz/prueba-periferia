import Anthropic from "@anthropic-ai/sdk"
import type { DefinicionHerramienta } from "../tools/registry"
import type { Bloque, LlmAdapter, Mensaje, RespuestaLlm } from "./adapter"

/**
 * La identidad de Claude Code va como primer bloque de sistema cuando se usa
 * el token OAuth de suscripción (`sk-ant-oat01…`). La API reserva esa ruta a su
 * propio cliente: sin esta línea como primer bloque de `system`, rechaza la llamada.
 */
const IDENTIDAD_CLAUDE_CODE = "You are Claude Code, Anthropic's official CLI for Claude."

/** Tipo de credencial según el prefijo: clave de API (sk-ant-api…) o token OAuth (sk-ant-oat…). */
export function tipoCredencial(): "api_key" | "oauth" | "ninguna" {
  const k = (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "").trim()
  if (!k) return "ninguna"
  return k.startsWith("sk-ant-oat") || !!process.env.ANTHROPIC_AUTH_TOKEN ? "oauth" : "api_key"
}

/**
 * Implementación del adaptador para Claude (Messages API).
 * Credencial desde variable de entorno: ANTHROPIC_API_KEY acepta una clave de API (x-api-key)
 * o un token OAuth sk-ant-oat… (Authorization: Bearer + beta oauth + identidad Claude Code).
 * También soporta ANTHROPIC_AUTH_TOKEN.
 */
export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  private readonly client: Anthropic

  constructor(readonly modelo: string, timeoutMs: number) {
    const clave = (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "").trim()
    this.client =
      tipoCredencial() === "oauth"
        ? new Anthropic({
            apiKey: null,
            authToken: clave,
            defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
            timeout: timeoutMs,
            maxRetries: 1,
          })
        : new Anthropic({ apiKey: clave, timeout: timeoutMs, maxRetries: 1 })
  }

  private aParam(b: Bloque): Anthropic.ContentBlockParam {
    switch (b.type) {
      case "text":
        return { type: "text", text: b.text }
      case "tool_use":
        return { type: "tool_use", id: b.id, name: b.name, input: b.input }
      case "tool_result":
        return { type: "tool_result", tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error }
      case "opaco":
        return b.raw as Anthropic.ContentBlockParam
    }
  }

  private deBloque(b: Anthropic.ContentBlock): Bloque {
    if (b.type === "text") return { type: "text", text: b.text }
    if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input }
    return { type: "opaco", proveedor: this.proveedor, raw: b }
  }

  async enviar(system: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const esOauth = tipoCredencial() === "oauth"
    const systemParam: string | Anthropic.TextBlockParam[] = esOauth
      ? [
          { type: "text", text: IDENTIDAD_CLAUDE_CODE },
          { type: "text", text: system },
        ]
      : system

    const r = await this.client.messages.create({
      model: this.modelo,
      max_tokens: 16000,
      system: systemParam,
      output_config: { effort: "low" },
      tools: herramientas.map((h) => ({
        name: h.name,
        description: h.description,
        input_schema: h.input_schema as Anthropic.Tool.InputSchema,
      })),
      messages: mensajes.map((m) => ({ role: m.role, content: m.content.map((b) => this.aParam(b)) })),
    })
    const fin: RespuestaLlm["fin"] =
      r.stop_reason === "end_turn" ? "fin_turno"
      : r.stop_reason === "tool_use" ? "herramientas"
      : r.stop_reason === "max_tokens" ? "limite_tokens"
      : r.stop_reason === "refusal" ? "rechazo"
      : "otro"
    return { bloques: r.content.map((b) => this.deBloque(b)), fin, uso: { entrada: r.usage.input_tokens, salida: r.usage.output_tokens } }
  }
}

/** Traduce errores del SDK a lenguaje claro (CA5). Nunca incluye la clave. */
export function errorLlmLegible(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError)
    return "El token o clave del modelo es inválido o fue revocado (ANTHROPIC_API_KEY). Si usas OAuth, genera uno nuevo con `claude setup-token`."
  if (e instanceof Anthropic.PermissionDeniedError)
    return "El token no tiene permiso de inferencia. Debe ser un token de `claude setup-token` (sk-ant-oat01…) o una API key de consola (sk-ant-api03…)."
  if (e instanceof Anthropic.RateLimitError)
    return "Se agotó el límite de uso del proveedor o de tu plan por ahora. Intenta en unos segundos."
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "El modelo tardó demasiado en responder (timeout). Intenta de nuevo."
  if (e instanceof Anthropic.APIConnectionError) return "No hay conexión con el proveedor del modelo."
  if (e instanceof Anthropic.APIError) return `El proveedor del modelo respondió con error ${String(e.status ?? "")}.`
  return "Error inesperado al llamar al modelo."
}
