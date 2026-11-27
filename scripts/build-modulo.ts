/**
 * Genera modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md a partir de las MISMAS fuentes
 * que usa la aplicación (agent/prompt.md y src/knowledge/ordenes-compra.md), para que no diverjan.
 * Uso: bun run scripts/build-modulo.ts
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { escribir } from "../src/domain/archivos"

const root = join(import.meta.dir, "..")
const prompt = readFileSync(join(root, "agent", "prompt.md"), "utf8")
const conocimiento = readFileSync(join(root, "src", "knowledge", "ordenes-compra.md"), "utf8")

escribir(
  join(root, "modulo", "agent.md"),
  `---
description: Prepara, valida y crea órdenes de compra en SAP a partir del paquete de correo (solicitud, cotización, aprobación); bloquea lo que no cumple control y pide confirmación humana para excepciones.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}`,
)

escribir(
  join(root, "modulo", "skill", "ordenes-compra", "SKILL.md"),
  `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia — reglas de control RC1–RC10, acciones sugeridas, datos de la OC y maestros de IVA y condiciones de pago.
---

${conocimiento}`,
)

console.log("modulo/ regenerado desde agent/prompt.md y src/knowledge/ordenes-compra.md")
