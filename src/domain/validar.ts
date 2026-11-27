import { buscarProveedor, type Maestros } from "./maestros"
import type { Derivados, Hallazgo, Paquete, Validacion } from "./tipos"

const TOLERANCIA_COTIZACION = 0.02
const TOLERANCIA_TOTAL = 1

const cop = (n: number) => n.toLocaleString("es-CO")
const fecha = (iso: string) => iso.slice(0, 10)

/** Aplica las reglas RC1–RC10 del PRD (sección 7.3). Función pura: misma entrada, misma salida. */
export function validarPaquete(p: Paquete, m: Maestros): Validacion {
  const s = p.solicitud
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const derivados: Derivados = {}
  const b = (regla: string, codigo: string, detalle: string) => bloqueos.push({ regla, codigo, detalle })
  const c = (regla: string, codigo: string, detalle: string) => confirmaciones.push({ regla, codigo, detalle })

  // RC1 · proveedor existe y está activo
  const prov = buscarProveedor(m, s.proveedor_nit, s.proveedor_nombre)
  if (!prov) {
    b("RC1", "PROVEEDOR_INEXISTENTE",
      `El proveedor "${s.proveedor_nombre}"${s.proveedor_nit ? ` (NIT ${s.proveedor_nit})` : ""} no existe en el maestro de proveedores. Acción: solicitar a Compras la creación del proveedor en SAP (RUT, certificación bancaria) antes de crear la OC.`)
  } else if (!prov.proveedor.activo) {
    b("RC1", "PROVEEDOR_INACTIVO", `El proveedor ${prov.proveedor.nombre} (${prov.proveedor.codigo_sap}) está inactivo. Acción: reactivarlo en SAP o elegir otro proveedor.`)
  } else {
    derivados.proveedor = {
      codigo_sap: prov.proveedor.codigo_sap,
      nit: prov.proveedor.nit,
      nombre: prov.proveedor.nombre,
      fuente: `maestro.proveedores (por ${prov.por})`,
    }
  }

  // RC4 · subárea del centro de costo
  const centro = m.centros.find((x) => x.centro_costo === s.centro_costo)
  if (!centro) b("RC4", "CENTRO_COSTO_INEXISTENTE", `El centro de costo ${s.centro_costo} no existe en el maestro.`)
  else if (!centro.subareas.includes(s.subarea))
    b("RC4", "SUBAREA_INVALIDA", `La subárea "${s.subarea}" no pertenece a ${s.centro_costo} (válidas: ${centro.subareas.join(", ")}).`)

  // RC2 / RC3 · aprobación válida y dentro del tope
  const ap = p.aprobacion
  if (!ap) b("RC2", "SIN_APROBACION", "No hay correo de aprobación. Acción: pedir al líder del centro de costo que responda 'Aprobado'.")
  else if (!ap.aprobado) b("RC2", "APROBACION_SIN_TEXTO", `El correo de ${ap.de} no contiene la palabra "Aprobado".`)
  else if (centro) {
    const aprobador = centro.aprobadores.find((a) => a.email.toLowerCase() === ap.de.toLowerCase())
    if (!aprobador) {
      b("RC2", "APROBADOR_SIN_AUTORIDAD",
        `${ap.de} no es aprobador del centro ${s.centro_costo}. Aprobadores válidos: ${centro.aprobadores.map((a) => `${a.email} (tope ${cop(a.tope)})`).join(", ")}. Acción: pedir la aprobación a uno de ellos.`)
    } else if (s.valor_total > aprobador.tope) {
      b("RC3", "MONTO_SUPERA_TOPE", `Valor ${cop(s.valor_total)} supera el tope de ${ap.de} (${cop(aprobador.tope)}) en ${s.centro_costo}. Acción: escalar a un aprobador con tope suficiente.`)
    }
  }

  // RC10 · cantidad × unitario = total
  const calculado = s.cantidad * s.valor_unitario
  if (!Number.isFinite(calculado) || Math.abs(calculado - s.valor_total) > TOLERANCIA_TOTAL)
    b("RC10", "TOTAL_INCONSISTENTE", `cantidad × valor_unitario = ${cop(calculado)} pero valor_total = ${cop(s.valor_total)}. Acción: corregir la solicitud.`)

  if (s.moneda !== "COP" && s.moneda !== "USD") b("MON", "MONEDA_DESCONOCIDA", `Moneda "${s.moneda}" no soportada (COP o USD).`)

  // RC5 · cotización vs solicitud
  if (!p.cotizacion) c("RC5", "SIN_COTIZACION", "No hay cotización adjunta. ¿Crear la OC sin cotización?")
  else {
    const dif = Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total
    if (dif > TOLERANCIA_COTIZACION)
      c("RC5", "DIFERENCIA_COTIZACION",
        `Cotización ${cop(p.cotizacion.total)} vs solicitud ${cop(s.valor_total)} (diferencia ${(dif * 100).toFixed(2)} %, tolerancia 2 %). La OC se crea por el valor de la solicitud.`)
  }

  // RC6 · IVA
  if (s.indicador_iva) {
    if (!m.iva.some((x) => x.codigo === s.indicador_iva)) b("RC6", "IVA_DESCONOCIDO", `Indicador IVA "${s.indicador_iva}" no existe en el maestro.`)
  } else if (prov?.proveedor.activo) {
    derivados.indicador_iva = { valor: prov.proveedor.indicador_iva_default, fuente: "maestro.proveedores.indicador_iva_default" }
    c("RC6", "IVA_DERIVADO", `La solicitud no informa indicador de IVA. Se propone ${prov.proveedor.indicador_iva_default} (default del proveedor).`)
  }

  // RC7 · condiciones de pago
  if (s.condiciones_pago) {
    if (!m.pagos.some((x) => x.codigo === s.condiciones_pago)) b("RC7", "PAGO_DESCONOCIDO", `Condición de pago "${s.condiciones_pago}" no existe en el maestro.`)
  } else if (prov?.proveedor.activo) {
    derivados.condiciones_pago = { valor: prov.proveedor.condiciones_pago_default, fuente: "maestro.proveedores.condiciones_pago_default" }
  }

  // RC8 · retroactiva
  const retroactiva = !!p.factura && fecha(p.factura.fecha) < s.fecha_solicitud
  if (retroactiva && p.factura)
    c("RC8", "OC_RETROACTIVA", `La factura ${p.factura.numero} (${fecha(p.factura.fecha)}) es anterior a la solicitud (${s.fecha_solicitud}). Quedará marcada retroactiva = true en el log de control.`)

  // RC9 · aprobación posterior a la solicitud
  if (ap && fecha(ap.fecha) < s.fecha_solicitud)
    c("RC9", "APROBACION_ANTERIOR", `La aprobación (${fecha(ap.fecha)}) es anterior a la fecha de solicitud (${s.fecha_solicitud}).`)

  return { solicitud_id: s.solicitud_id, apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva }
}
