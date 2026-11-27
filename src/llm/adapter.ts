import type { DefinicionHerramienta } from "../tools/registry"

/** Bloques neutrales: el ciclo del agente no conoce el formato de ningún proveedor. */
export type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  /** Bloque propio del proveedor (p. ej. razonamiento) que debe devolverse intacto. */
  | { type: "opaco"; proveedor: string; raw: unknown }

export type Mensaje = { role: "user" | "assistant"; content: Bloque[] }

export type RespuestaLlm = {
  bloques: Bloque[]
  fin: "fin_turno" | "herramientas" | "limite_tokens" | "rechazo" | "otro"
  uso: { entrada: number; salida: number }
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  /** Si se pasa `onTexto`, la implementación transmite el texto en vivo (streaming) mientras se genera. */
  enviar(
    system: string,
    mensajes: Mensaje[],
    herramientas: DefinicionHerramienta[],
    onTexto?: (delta: string) => void,
  ): Promise<RespuestaLlm>
}
