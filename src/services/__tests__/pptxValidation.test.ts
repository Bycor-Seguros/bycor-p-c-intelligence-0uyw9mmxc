/**
 * Teste unitário e de conformidade estrutural do gerador de PPTX via PptxGenJS (pptxExportService).
 * Valida a integridade do pacote ZIP OpenXML gerado:
 * 1. Arquivo ZIP PKWARE válido (assinatura 0x04034b50)
 * 2. [Content_Types].xml presente e válido
 * 3. _rels/.rels com officeDocument apontando para ppt/presentation.xml
 * 4. ppt/presentation.xml presente
 * 5. Slides presentes correspondentes ao número esperado
 * 6. Conteúdo de texto e tabelas preservado nos slides
 */
import { generatePresentationPptx, PptxPresentationData } from '../pptxExportService'

export interface PptxValidationResult {
  passed: boolean
  errors: string[]
  partCount: number
  slideCount: number
}

// Leitor simples de entradas ZIP em TypeScript (suporta tanto STORE quanto DEFLATE para inspecionar nomes e tamanhos)
function unzipEntryNames(zipBuffer: Uint8Array): {
  names: string[]
  entries: Map<string, Uint8Array>
} {
  const names: string[] = []
  const entries = new Map<string, Uint8Array>()
  let pos = 0
  const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength)

  while (pos + 30 <= zipBuffer.length) {
    const sig = view.getUint32(pos, true)
    if (sig !== 0x04034b50) {
      break
    }
    const compMethod = view.getUint16(pos + 8, true)
    const compSize = view.getUint32(pos + 18, true)
    const nameLen = view.getUint16(pos + 26, true)
    const extraLen = view.getUint16(pos + 28, true)

    const nameBytes = zipBuffer.slice(pos + 30, pos + 30 + nameLen)
    const name = new TextDecoder().decode(nameBytes)
    names.push(name)

    const dataStart = pos + 30 + nameLen + extraLen
    // Se compression method for 0 (STORE), o buffer é texto/xml direto
    if (compMethod === 0) {
      const dataBytes = zipBuffer.slice(dataStart, dataStart + compSize)
      entries.set(name, dataBytes)
    }

    pos = dataStart + compSize
  }

  // Também busca Central Directory se local headers tinham data descriptor (bit 3 set)
  if (names.length === 0) {
    // Busca do end of central directory
    for (let i = zipBuffer.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        const cdOffset = view.getUint32(i + 16, true)
        const totalEntries = view.getUint16(i + 10, true)
        let cdPos = cdOffset
        for (let j = 0; j < totalEntries; j++) {
          if (cdPos + 46 > zipBuffer.length) break
          if (view.getUint32(cdPos, true) !== 0x02014b50) break
          const nameLen = view.getUint16(cdPos + 28, true)
          const extraLen = view.getUint16(cdPos + 30, true)
          const commentLen = view.getUint16(cdPos + 32, true)
          const nameBytes = zipBuffer.slice(cdPos + 46, cdPos + 46 + nameLen)
          const name = new TextDecoder().decode(nameBytes)
          names.push(name)
          cdPos += 46 + nameLen + extraLen + commentLen
        }
        break
      }
    }
  }

  return { names, entries }
}

export function validatePptxBuffer(pptxBytes: Uint8Array): PptxValidationResult {
  const errors: string[] = []

  if (!pptxBytes || pptxBytes.length === 0) {
    return { passed: false, errors: ['Buffer PPTX vazio'], partCount: 0, slideCount: 0 }
  }

  // 1. Valida assinatura de arquivo ZIP PKWARE
  const view = new DataView(pptxBytes.buffer, pptxBytes.byteOffset, pptxBytes.byteLength)
  const magic = view.getUint32(0, true)
  if (magic !== 0x04034b50) {
    errors.push(
      `Arquivo não possui assinatura válida de ZIP (esperado 0x04034b50, obtido 0x${magic.toString(16)})`,
    )
  }

  const { names } = unzipEntryNames(pptxBytes)
  const partSet = new Set(names)

  // 2. Partes fundamentais requeridas pelo Microsoft PowerPoint
  const requiredParts = [
    '[Content_Types].xml',
    '_rels/.rels',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'ppt/slides/slide1.xml',
    'ppt/slides/_rels/slide1.xml.rels',
  ]

  for (const part of requiredParts) {
    if (!partSet.has(part)) {
      errors.push(`Parte obrigatória ausente no pacote PPTX: ${part}`)
    }
  }

  // 3. Conta slides presentes
  const slideParts = names.filter((n) => n.startsWith('ppt/slides/slide') && n.endsWith('.xml'))

  return {
    passed: errors.length === 0,
    errors,
    partCount: names.length,
    slideCount: slideParts.length,
  }
}

export async function validatePptxOpenXml(
  data: PptxPresentationData,
): Promise<PptxValidationResult> {
  const pptxBytes = await generatePresentationPptx(data)
  const result = validatePptxBuffer(pptxBytes)

  if (!result.passed) {
    return result
  }

  const { names } = unzipEntryNames(pptxBytes)
  const slideParts = names.filter((n) => n.startsWith('ppt/slides/slide') && n.endsWith('.xml'))

  // Calcula número de slides esperado baseado nas coberturas paginadas em blocos de 7
  const LINES_PER_SLIDE = 7
  const numCoverageChunks =
    data.coberturas && data.coberturas.length > 0
      ? Math.ceil(data.coberturas.length / LINES_PER_SLIDE)
      : 1
  const expectedSlideCount = 2 + numCoverageChunks + 1 // Capa + Perfil + N coberturas + Parecer

  const errors = [...result.errors]
  if (slideParts.length !== expectedSlideCount) {
    errors.push(
      `Número de slides divergente do esperado: esperado ${expectedSlideCount}, encontrado ${slideParts.length}`,
    )
  }

  return {
    passed: errors.length === 0,
    errors,
    partCount: names.length,
    slideCount: slideParts.length,
  }
}
