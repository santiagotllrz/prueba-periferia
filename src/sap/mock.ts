import { agregarLinea, leerTexto, rutaOut } from "../domain/archivos"
import { cargarMaestros } from "../domain/maestros"
import type { OrdenCompra, SapAdapter } from "./adapter"

type Registro = { numero_oc: string; fecha: string; orden: OrdenCompra }

const PRIMER_NUMERO = 4500000001

/** SAP simulado sobre out/sap/ordenes.jsonl. Numeración secuencial desde 4500000001. */
export class SapMock implements SapAdapter {
  constructor(private readonly root: string) {}

  private get ruta() {
    return rutaOut(this.root, "sap", "ordenes.jsonl")
  }

  private registros(): Registro[] {
    const t = leerTexto(this.ruta)
    if (!t) return []
    return t
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Registro)
  }

  async consultarProveedor(nit: string) {
    const p = cargarMaestros(this.root).proveedores.find((x) => x.nit === nit)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = this.registros().find((x) => x.orden.referencia.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  async crearOrden(orden: OrdenCompra) {
    const existente = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id)
    if (existente) throw new Error(`Ya existe la OC ${existente.numero_oc} para ${orden.referencia.solicitud_id}`)
    const numero_oc = String(PRIMER_NUMERO + this.registros().length)
    const fecha = new Date().toISOString()
    agregarLinea(this.ruta, JSON.stringify({ numero_oc, fecha, orden } satisfies Registro))
    return { numero_oc, fecha }
  }
}
