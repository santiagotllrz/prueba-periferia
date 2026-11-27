/**
 * demo.ts — ejecuta las herramientas sin modelo de lenguaje (PRD 6.6).
 * Uso: bun install && bun run demo.ts
 */
import { readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { ToolCtx } from "./src/domain/tipos"
import { ejecutarHerramienta } from "./src/tools/registry"

const root = import.meta.dir
rmSync(join(root, "out"), { recursive: true, force: true })

type R = { ok: boolean; error?: string; data?: Record<string, unknown> }
const ctx: ToolCtx = { directory: root, sessionId: "demo", confirmacionHumana: false }
const run = async (tool: string, args: Record<string, unknown>, c: ToolCtx = ctx) =>
  JSON.parse(await ejecutarHerramienta(tool, args, c)) as R
const codigos = (xs: unknown) => (Array.isArray(xs) ? xs.map((x: { codigo: string }) => x.codigo).join(", ") || "—" : "—")

const casos = readdirSync(join(root, "fixtures/reto-03/solicitudes")).sort()

for (const caso of casos) {
  console.log(`\n=== ${caso} ===`)
  const paquete = await run("oc_leer_paquete", { caso })
  if (!paquete.ok) {
    console.log(`  error: ${paquete.error}`)
    continue
  }
  const v = await run("oc_validar", { caso })
  const d = v.data ?? {}
  console.log(`  apta: ${String(d.apta)} | retroactiva: ${String(d.retroactiva)}`)
  console.log(`  bloqueos: ${codigos(d.bloqueos)}`)
  console.log(`  confirmaciones: ${codigos(d.confirmaciones)}`)
  if (d.derivados && Object.keys(d.derivados).length > 1) console.log(`  derivados: ${JSON.stringify(d.derivados)}`)
  const ev = await run("oc_generar_evidencia", { caso })
  console.log(`  evidencia: ${ev.ok ? `${String(ev.data?.ruta)} sha256=${String(ev.data?.sha256).slice(0, 12)}…` : ev.error}`)
  const pl = await run("oc_construir_payload", { caso })
  console.log(`  payload: ${pl.ok ? `ok → ${String(pl.data?.ruta_trazabilidad)}` : pl.error}`)
  const oc = await run("oc_crear", { caso })
  console.log(`  oc_crear: ${oc.ok ? `OC ${String(oc.data?.numero_oc)}` : oc.error}`)
}

console.log("\n=== Idempotencia: sol-001 por segunda vez ===")
const rep = await run("oc_crear", { caso: "sol-001" })
console.log(`  OC ${String(rep.data?.numero_oc)} idempotente=${String(rep.data?.idempotente)}`)

console.log("\n=== sol-004: confirmado=true sin confirmación humana (debe rechazar) ===")
const falsa = await run("oc_crear", { caso: "sol-004", confirmado: true })
console.log(`  ${falsa.ok ? "CREADA (mal)" : falsa.error}`)

console.log("\n=== sol-004 con confirmación explícita del usuario ===")
const conf = await run("oc_crear", { caso: "sol-004", confirmado: true }, { ...ctx, confirmacionHumana: true })
console.log(`  ${conf.ok ? `OC ${String(conf.data?.numero_oc)} · evidencia ${String(conf.data?.evidencia)}` : conf.error}`)

console.log("\n=== Caso inexistente (manejo de errores) ===")
console.log(`  ${(await run("oc_leer_paquete", { caso: "sol-999" })).error}`)
console.log(`  ${(await run("oc_leer_paquete", { caso: "../etc" })).error}`)

console.log("\nArchivos: out/sap/ordenes.jsonl, out/control.csv, out/log.jsonl, out/<caso>/")
