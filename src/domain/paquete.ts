import { z } from "zod"
import { casoValido, leerJson, leerTexto, mensajeError, rutaFixture } from "./archivos"
import {
  AprobacionRawSchema,
  CorreoSchema,
  SolicitudSchema,
  err,
  ok,
  type AprobacionRaw,
  type Cotizacion,
  type Paquete,
  type Resultado,
} from "./tipos"

/** "COP 11.400.000" o "11.400.000,50" → 11400000 / 11400000.5 */
export function parseMonto(txt: string): number | null {
  const limpio = txt.replace(/[^\d.,]/g, "")
  if (!limpio) return null
  const normal = limpio.replace(/\./g, "").replace(",", ".")
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

/** "900.555.111-2" → "900555111" (sin dígito de verificación) */
export function normalizarNit(txt: string): string {
  return txt.split("-")[0]!.replace(/\D/g, "")
}

function campo(texto: string, regex: RegExp): string | null {
  const m = texto.match(regex)
  return m?.[1]?.trim() ?? null
}

function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function parseCotizacion(texto: string): Cotizacion | null {
  const totalTxt = campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/im)
  const total = totalTxt ? parseMonto(totalTxt) : null
  if (total === null) return null
  const fecha = campo(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)
  const dias = campo(texto, /Validez[^:\n]*:\s*(\d+)\s*d/i)
  const nit = campo(texto, /^NIT:\s*([\d.\-]+)/im)
  return {
    referencia: campo(texto, /^COTIZACI[ÓO]N\s+(\S+)/im),
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/im) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total,
    moneda: campo(texto, /^TOTAL[^:\n]*:\s*([A-Z]{3})/im) ?? "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

export function parseFactura(texto: string): Paquete["factura"] {
  const numero = campo(texto, /FACTURA[^\n]*No\.?\s*(\S+)/i)
  const fecha = campo(texto, /Fecha[^:\n]*:\s*(\d{4}-\d{2}-\d{2})/i)
  const totalTxt = campo(texto, /^TOTAL:\s*(.+)$/im)
  const total = totalTxt ? parseMonto(totalTxt) : null
  if (!numero || !fecha || total === null) return null
  return { numero, fecha, total }
}

export function esAprobado(cuerpo: string): boolean {
  return /\baprobado\b/i.test(cuerpo) && !/\bno\s+aprobado\b/i.test(cuerpo)
}

export function leerAprobacionRaw(root: string, caso: string): AprobacionRaw | null {
  const raw = leerJson(rutaFixture(root, "solicitudes", caso, "aprobacion.json"))
  if (raw === null) return null
  const p = AprobacionRawSchema.safeParse(raw)
  return p.success ? p.data : null
}

function formatoZod(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
}

/** Lee y normaliza el paquete de un caso. Nunca lanza. */
export function leerPaquete(root: string, caso: string): Resultado<Paquete> {
  if (!casoValido(caso)) return err(`Nombre de caso inválido: "${caso}"`)
  try {
    const base = (f: string) => rutaFixture(root, "solicitudes", caso, f)
    const correoRaw = leerJson(base("correo.json"))
    const solicitudRaw = leerJson(base("solicitud.json"))
    if (correoRaw === null && solicitudRaw === null)
      return err(`El caso "${caso}" no existe en fixtures/reto-03/solicitudes/`)
    if (solicitudRaw === null)
      return err("Falta solicitud.json (Excel de solicitud). Pídelo al solicitante.")
    const sol = SolicitudSchema.safeParse(solicitudRaw)
    if (!sol.success) return err(`Solicitud inválida: ${formatoZod(sol.error)}`)
    const correo = CorreoSchema.safeParse(correoRaw)

    const faltantes: string[] = []
    if (!correo.success) faltantes.push("correo")
    const cotTxt = leerTexto(base("cotizacion.txt"))
    const cotizacion = cotTxt ? parseCotizacion(cotTxt) : null
    if (!cotizacion) faltantes.push("cotizacion")
    const ap = leerAprobacionRaw(root, caso)
    if (!ap) faltantes.push("aprobacion")
    const facTxt = leerTexto(base("factura.txt"))

    return ok({
      correo: correo.success
        ? { id: correo.data.id, de: correo.data.de, asunto: correo.data.asunto, fecha: correo.data.fecha }
        : { id: `${caso}-correo`, de: "", asunto: "", fecha: "" },
      solicitud: sol.data,
      cotizacion,
      aprobacion: ap ? { de: ap.de, fecha: ap.fecha, aprobado: esAprobado(ap.cuerpo), texto: ap.cuerpo } : null,
      factura: facTxt ? parseFactura(facTxt) : null,
      faltantes,
    })
  } catch (e) {
    return err(`No se pudo leer el paquete "${caso}": ${mensajeError(e)}`)
  }
}
