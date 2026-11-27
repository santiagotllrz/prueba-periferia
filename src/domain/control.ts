import { existsSync } from "node:fs"
import { agregarLinea, rutaOut } from "./archivos"
import type { Hallazgo } from "./tipos"

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "error"

const CABECERA = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

const csv = (v: string) => `"${v.replace(/"/g, '""')}"`

/** Agrega una fila a out/control.csv por cada intento de creación (HU-5). */
export function registrarControl(
  root: string,
  fila: { solicitud_id: string; resultado: ResultadoControl; numero_oc: string | null; retroactiva: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[] },
): void {
  const ruta = rutaOut(root, "control.csv")
  if (!existsSync(ruta)) agregarLinea(ruta, CABECERA)
  agregarLinea(
    ruta,
    [
      csv(fila.solicitud_id),
      fila.resultado,
      fila.numero_oc ?? "",
      String(fila.retroactiva),
      csv(fila.bloqueos.map((b) => b.codigo).join("|")),
      csv(fila.confirmaciones.map((c) => c.codigo).join("|")),
      new Date().toISOString(),
    ].join(","),
  )
}
