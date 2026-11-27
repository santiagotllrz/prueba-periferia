import { createHash } from "node:crypto"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { escribir, rutaOut } from "./archivos"
import type { AprobacionRaw } from "./tipos"

export function textoEvidencia(ap: AprobacionRaw): string {
  return [
    `De: ${ap.de}`,
    `Para: ${ap.para ?? ""}`,
    `Fecha: ${ap.fecha}`,
    `Asunto: ${ap.asunto}`,
    "",
    ap.cuerpo,
    "",
  ].join("\n")
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** Helvetica estándar solo soporta WinAnsi: se reemplazan caracteres fuera de rango. */
function seguroWinAnsi(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
}

async function generarPdf(texto: string, hash: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595, 842])
  let y = 800
  page.drawText("Evidencia de aprobación - Orden de compra", { x: 50, y, size: 14, font: bold })
  y -= 30
  for (const linea of texto.split("\n")) {
    page.drawText(seguroWinAnsi(linea).slice(0, 95), { x: 50, y, size: 11, font })
    y -= 16
  }
  y -= 20
  page.drawText(`SHA-256 del contenido: ${hash}`, { x: 50, y, size: 8, font })
  pdf.setTitle("Evidencia de aprobación")
  return pdf.save()
}

/** Escribe out/<caso>/aprobacion.txt (P0) y aprobacion.pdf (P1). */
export async function generarEvidencia(root: string, caso: string, ap: AprobacionRaw) {
  const cuerpo = textoEvidencia(ap)
  const hash = sha256(cuerpo)
  const rutaTxt = rutaOut(root, caso, "aprobacion.txt")
  escribir(rutaTxt, `${cuerpo}\n---\nsha256: ${hash}\n`)
  const rutaPdf = rutaOut(root, caso, "aprobacion.pdf")
  escribir(rutaPdf, await generarPdf(cuerpo, hash))
  return { ruta: `out/${caso}/aprobacion.txt`, ruta_pdf: `out/${caso}/aprobacion.pdf`, sha256: hash }
}
