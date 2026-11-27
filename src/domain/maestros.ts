import { z } from "zod"
import { leerJson, rutaFixture } from "./archivos"
import { CentroCostoSchema, CodigoSchema, ProveedorSchema, type CentroCosto, type Proveedor } from "./tipos"

export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  iva: Array<{ codigo: string; descripcion: string }>
  pagos: Array<{ codigo: string; descripcion: string }>
}

/** Carga los maestros. Lanza si están corruptos; quien llama lo convierte en { ok:false }. */
export function cargarMaestros(root: string): Maestros {
  const m = (f: string) => leerJson(rutaFixture(root, "maestros", f))
  return {
    proveedores: z.array(ProveedorSchema).parse(m("proveedores.json")),
    centros: z.array(CentroCostoSchema).parse(m("centros-costo.json")),
    iva: z.array(CodigoSchema).parse(m("indicadores-iva.json")),
    pagos: z.array(CodigoSchema).parse(m("condiciones-pago.json")),
  }
}

export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?a\.?s\.?|s\.?a\.?|ltda\.?)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
}

export function buscarProveedor(
  maestros: Maestros,
  nit: string | undefined,
  nombre: string,
): { proveedor: Proveedor; por: "nit" | "nombre" } | null {
  if (nit) {
    const p = maestros.proveedores.find((x) => x.nit === nit)
    return p ? { proveedor: p, por: "nit" } : null
  }
  const n = normalizarNombre(nombre)
  const p = maestros.proveedores.find((x) => normalizarNombre(x.nombre) === n)
  return p ? { proveedor: p, por: "nombre" } : null
}
