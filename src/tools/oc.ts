import { z } from "zod"
import { escribir, mensajeError, rutaOut } from "../domain/archivos"
import { registrarControl } from "../domain/control"
import { generarEvidencia } from "../domain/evidencia"
import { cargarMaestros } from "../domain/maestros"
import { leerAprobacionRaw, leerPaquete } from "../domain/paquete"
import { construirOrden } from "../domain/payload"
import { err, ok, type Paquete, type Resultado, type ToolCtx, type Validacion } from "../domain/tipos"
import { validarPaquete } from "../domain/validar"
import { SapMock } from "../sap/mock"

/*
 * Herramientas del agente. Cada export → nombre "oc_<export>" para el modelo.
 * Regla de diseño: las herramientas releen el caso desde fixtures en lugar de confiar en
 * el paquete/payload que envía el modelo, así el modelo no puede alterar montos ni datos.
 */

const casoArg = z.string().describe("Carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo 'sol-001'")
const ignorado = (que: string) =>
  z.unknown().optional().describe(`Opcional. ${que} — la herramienta lo recalcula desde las fuentes; no lo modifiques.`)

const json = (r: Resultado<unknown>) => JSON.stringify(r)

function cargarYValidar(root: string, caso: string): Resultado<{ paquete: Paquete; validacion: Validacion }> {
  const p = leerPaquete(root, caso)
  if (!p.ok) return p
  try {
    return ok({ paquete: p.data, validacion: validarPaquete(p.data, cargarMaestros(root)) })
  } catch (e) {
    return err(`Maestros ilegibles: ${mensajeError(e)}`)
  }
}

export const leer_paquete = {
  description: "Lee el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso y los devuelve normalizados.",
  args: { caso: casoArg },
  async execute(args: { caso: string }, ctx: ToolCtx): Promise<string> {
    const r = leerPaquete(ctx.directory, args.caso)
    if (!r.ok) return json(r)
    const { cotizacion, ...resto } = r.data
    return json(ok({ ...resto, cotizacion: cotizacion ? { ...cotizacion, texto: `${cotizacion.texto.slice(0, 300)}…` } : null }))
  },
}

export const validar = {
  description: "Valida un caso contra los maestros y reglas RC1–RC10; devuelve apta, bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: { caso: casoArg, paquete: ignorado("Paquete leído con oc_leer_paquete") },
  async execute(args: { caso: string; paquete?: unknown }, ctx: ToolCtx): Promise<string> {
    const r = cargarYValidar(ctx.directory, args.caso)
    return json(r.ok ? ok(r.data.validacion) : r)
  },
}

export const construir_payload = {
  description: "Construye la orden de compra exactamente como quedaría en SAP y guarda su trazabilidad en out/<caso>/trazabilidad.json; no la crea.",
  args: { caso: casoArg, paquete: ignorado("Paquete"), derivados: ignorado("Derivados de oc_validar") },
  async execute(args: { caso: string; paquete?: unknown; derivados?: unknown }, ctx: ToolCtx): Promise<string> {
    const r = cargarYValidar(ctx.directory, args.caso)
    if (!r.ok) return json(r)
    const { paquete, validacion } = r.data
    if (!validacion.apta)
      return json(err("No se puede construir la OC: la solicitud tiene bloqueos.", { bloqueos: validacion.bloqueos }))
    const ap = leerAprobacionRaw(ctx.directory, args.caso)
    if (!ap) return json(err("Falta el correo de aprobación."))
    try {
      const { orden, traza } = construirOrden(paquete, validacion, ap, null)
      const ruta = `out/${args.caso}/trazabilidad.json`
      escribir(rutaOut(ctx.directory, args.caso, "trazabilidad.json"), JSON.stringify({ orden, trazabilidad: traza }, null, 2))
      escribir(rutaOut(ctx.directory, args.caso, "payload.json"), JSON.stringify(orden, null, 2))
      return json(ok({ orden, trazabilidad: traza, ruta_trazabilidad: ruta, confirmaciones_pendientes: validacion.confirmaciones }))
    } catch (e) {
      return json(err(`Payload inválido: ${mensajeError(e)}`))
    }
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia del correo de aprobación (out/<caso>/aprobacion.txt y .pdf) y devuelve su sha256.",
  args: { caso: casoArg },
  async execute(args: { caso: string }, ctx: ToolCtx): Promise<string> {
    const p = leerPaquete(ctx.directory, args.caso)
    if (!p.ok) return json(p)
    const ap = leerAprobacionRaw(ctx.directory, args.caso)
    if (!ap) return json(err("No hay correo de aprobación en el caso; pídelo al líder aprobador."))
    try {
      return json(ok(await generarEvidencia(ctx.directory, args.caso, ap)))
    } catch (e) {
      return json(err(`No se pudo generar la evidencia: ${mensajeError(e)}`))
    }
  },
}

export const crear = {
  description: "Crea la OC en el SAP simulado si no hay bloqueos; si hay confirmaciones exige confirmado=true tras una confirmación explícita del usuario. Es idempotente por solicitud_id.",
  args: {
    caso: casoArg,
    payload: ignorado("Payload de oc_construir_payload"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje"),
  },
  async execute(args: { caso: string; payload?: unknown; confirmado?: boolean }, ctx: ToolCtx): Promise<string> {
    const r = cargarYValidar(ctx.directory, args.caso)
    if (!r.ok) return json(r)
    const { paquete, validacion: v } = r.data
    const root = ctx.directory
    const control = (resultado: Parameters<typeof registrarControl>[1]["resultado"], numero_oc: string | null) =>
      registrarControl(root, { solicitud_id: v.solicitud_id, resultado, numero_oc, retroactiva: v.retroactiva, bloqueos: v.bloqueos, confirmaciones: v.confirmaciones })

    try {
      const sap = new SapMock(root)
      const existente = await sap.buscarOrdenPorReferencia(v.solicitud_id)
      if (existente) {
        control("idempotente", existente.numero_oc)
        return json(ok({ numero_oc: existente.numero_oc, fecha: null, idempotente: true }))
      }
      if (!v.apta) {
        control("bloqueada", null)
        return json(err("OC bloqueada: no cumple controles.", { bloqueos: v.bloqueos }))
      }
      const confirmadoValido = args.confirmado === true && ctx.confirmacionHumana === true
      if (v.confirmaciones.length > 0 && !confirmadoValido) {
        control("pendiente_confirmacion", null)
        const motivo = args.confirmado && !ctx.confirmacionHumana
          ? "confirmado=true no es válido: el usuario no confirmó explícitamente en su último mensaje."
          : "requiere confirmación explícita"
        return json(err(motivo, { requiere_confirmacion: true, confirmaciones: v.confirmaciones, retroactiva: v.retroactiva }))
      }
      const ap = leerAprobacionRaw(root, args.caso)
      if (!ap) return json(err("Falta el correo de aprobación."))
      const evidencia = await generarEvidencia(root, args.caso, ap)
      const confirmadoPor = v.confirmaciones.length > 0 ? `analista (sesión ${ctx.sessionId})` : null
      const { orden, traza } = construirOrden(paquete, v, ap, confirmadoPor)
      escribir(rutaOut(root, args.caso, "trazabilidad.json"), JSON.stringify({ orden, trazabilidad: traza }, null, 2))
      const creada = await sap.crearOrden(orden)
      control("creada", creada.numero_oc)
      return json(ok({ ...creada, idempotente: false, retroactiva: v.retroactiva, evidencia: evidencia.ruta, evidencia_pdf: evidencia.ruta_pdf }))
    } catch (e) {
      control("error", null)
      return json(err(`No se pudo crear la OC: ${mensajeError(e)}`))
    }
  },
}
