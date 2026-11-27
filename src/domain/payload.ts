import { sha256, textoEvidencia } from "./evidencia"
import { OrdenCompraSchema, type AprobacionRaw, type OrdenCompra, type Paquete, type Validacion } from "./tipos"

export type Traza = Record<string, string>

function unidad(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  if (/\bmensualidad|por mes\b/i.test(descripcion)) return "MES"
  return "UN"
}

/** Construye la OC (PRD 7.4) y su trazabilidad campo → fuente. Requiere validación sin bloqueos. */
export function construirOrden(
  p: Paquete,
  v: Validacion,
  ap: AprobacionRaw,
  confirmadoPor: string | null,
): { orden: OrdenCompra; traza: Traza } {
  const s = p.solicitud
  const prov = v.derivados.proveedor
  if (!prov) throw new Error("Proveedor no resuelto: la solicitud tiene bloqueos")
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor ?? ""
  const pago = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor ?? ""

  const orden = OrdenCompraSchema.parse({
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre },
    moneda: s.moneda,
    condiciones_pago: pago,
    aprobador: { email: ap.de, fecha_aprobacion: ap.fecha, evidencia_sha256: sha256(textoEvidencia(ap)) },
    posiciones: [
      {
        numero: 10,
        descripcion: s.descripcion.slice(0, 40),
        cantidad: s.cantidad,
        unidad: unidad(s.descripcion),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: confirmadoPor })),
  })

  const traza: Traza = {
    "referencia.solicitud_id": "solicitud",
    "referencia.correo_id": "correo",
    "referencia.cotizacion_ref": p.cotizacion ? "cotizacion" : "ausente",
    sociedad: "constante (sociedad 1000)",
    organizacion_compras: "constante (org. compras 1000)",
    proveedor: prov.fuente,
    moneda: "solicitud",
    condiciones_pago: s.condiciones_pago ? "solicitud" : `derivado (${v.derivados.condiciones_pago?.fuente})`,
    "aprobador.email": "aprobacion",
    "aprobador.fecha_aprobacion": "aprobacion",
    "aprobador.evidencia_sha256": "derivado (sha256 de out/<caso>/aprobacion.txt)",
    "posiciones[0].descripcion": "solicitud (truncada a 40)",
    "posiciones[0].cantidad": "solicitud",
    "posiciones[0].unidad": "derivado (texto de la descripción)",
    "posiciones[0].precio_unitario": "solicitud",
    "posiciones[0].centro_costo": "solicitud + maestro.centros-costo",
    "posiciones[0].subarea": "solicitud + maestro.centros-costo",
    "posiciones[0].indicador_iva": s.indicador_iva ? "solicitud + maestro.indicadores-iva" : `derivado (${v.derivados.indicador_iva?.fuente})`,
    excepciones: "validación (confirmaciones)",
  }
  return { orden, traza }
}
