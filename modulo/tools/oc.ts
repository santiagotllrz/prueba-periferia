/**
 * Herramientas del agente, importables sin el servidor HTTP.
 * Re-exporta exactamente las mismas herramientas que usa la aplicación (no es una copia).
 * Nombre visible para el modelo: oc_<export>. Contrato: execute(args, ctx) → string JSON { ok, data | error }.
 */
export * from "../../src/tools/oc"
export { HERRAMIENTAS, definiciones, ejecutarHerramienta } from "../../src/tools/registry"
export type { ToolCtx } from "../../src/domain/tipos"
