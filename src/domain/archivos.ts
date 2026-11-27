import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join, dirname } from "node:path"

export const FIXTURES = ["fixtures", "reto-03"] as const

export function rutaFixture(root: string, ...partes: string[]): string {
  return join(root, ...FIXTURES, ...partes)
}

export function rutaOut(root: string, ...partes: string[]): string {
  return join(root, "out", ...partes)
}

/** Nombre de caso seguro: evita path traversal (../) desde argumentos del modelo. */
export function casoValido(caso: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,40}$/i.test(caso)
}

export function leerTexto(ruta: string): string | null {
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

export function leerJson(ruta: string): unknown {
  const t = leerTexto(ruta)
  if (t === null) return null
  return JSON.parse(t) as unknown
}

export function escribir(ruta: string, contenido: string | Uint8Array): void {
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, contenido)
}

export function agregarLinea(ruta: string, linea: string): void {
  mkdirSync(dirname(ruta), { recursive: true })
  appendFileSync(ruta, linea.endsWith("\n") ? linea : linea + "\n")
}

export function mensajeError(e: unknown): string {
  if (e instanceof SyntaxError) return `JSON malformado: ${e.message}`
  if (e instanceof Error) return e.message
  return String(e)
}
