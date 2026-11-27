import { z } from "zod"
import { agregarLinea, mensajeError, rutaOut } from "../domain/archivos"
import type { ToolCtx } from "../domain/tipos"
import * as oc from "./oc"

export type Herramienta = {
  description: string
  args: Record<string, z.ZodType>
  execute(args: never, ctx: ToolCtx): Promise<string>
}

export type DefinicionHerramienta = { name: string; description: string; input_schema: Record<string, unknown> }

/** Registro: cada export de src/tools/oc.ts → "oc_<export>". */
export const HERRAMIENTAS: Record<string, Herramienta> = Object.fromEntries(
  Object.entries(oc).map(([nombre, h]) => [`oc_${nombre}`, h as Herramienta]),
)

export function definiciones(): DefinicionHerramienta[] {
  return Object.entries(HERRAMIENTAS).map(([name, h]) => {
    const { $schema: _omit, ...schema } = z.toJSONSchema(z.object(h.args)) as Record<string, unknown>
    return { name, description: h.description, input_schema: schema }
  })
}

function resumen(resultado: string): string {
  try {
    const r = JSON.parse(resultado) as { ok: boolean; error?: string; data?: Record<string, unknown> }
    if (!r.ok) return `error: ${r.error}`
    const d = r.data ?? {}
    if ("numero_oc" in d) return `OC ${String(d.numero_oc)}${d.idempotente ? " (idempotente)" : ""}`
    if ("apta" in d) return `apta=${String(d.apta)}`
    return "ok"
  } catch {
    return "respuesta no JSON"
  }
}

/** Valida argumentos con zod, ejecuta, nunca lanza, y registra en out/log.jsonl (CA4). */
export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: ToolCtx): Promise<string> {
  const h = HERRAMIENTAS[nombre]
  let salida: string
  if (!h) salida = JSON.stringify({ ok: false, error: `Herramienta desconocida: ${nombre}` })
  else {
    const parsed = z.object(h.args).safeParse(args ?? {})
    if (!parsed.success)
      salida = JSON.stringify({ ok: false, error: `Argumentos inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` })
    else {
      try {
        salida = await h.execute(parsed.data as never, ctx)
      } catch (e) {
        salida = JSON.stringify({ ok: false, error: mensajeError(e) })
      }
    }
  }
  const ok = salida.startsWith('{"ok":true')
  try {
    agregarLinea(
      rutaOut(ctx.directory, "log.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: nombre, args, ok, resumen: resumen(salida) }),
    )
  } catch {
    /* el log nunca debe tumbar la herramienta */
  }
  return salida
}
