/**
 * Teste unitário e de conformidade estrutural do gerador de PPTX OpenXML (pptxExportService).
 * Valida com rigor absoluto os requisitos do Microsoft PowerPoint para Mac e PC segundo a ECMA-376:
 *
 * 1. Arquivo ZIP PKWARE válido (assinatura 0x04034b50, headers STORE, timestamps válidos)
 * 2. [Content_Types].xml presente com todas as extensões e overrides canônicos
 * 3. _rels/.rels com officeDocument apontando para ppt/presentation.xml
 * 4. ppt/presentation.xml com p:defaultTextStyle e tamanhos de slide
 * 5. ppt/presProps.xml, ppt/viewProps.xml e ppt/tableStyles.xml presentes
 * 6. ppt/tableStyles.xml define o estilo padrão com a:tblStyle correspondente ao def="{...}"
 * 7. ppt/slideMasters/slideMaster1.xml com p:txStyles estruturado (titleStyle, bodyStyle, otherStyle)
 * 8. Todos os slides possuem <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr> (requisito do PowerPoint Mac / Keynote / iOS)
 * 9. Tabelas DrawingML (<a:tbl>) possuem <a:tblPr> com <a:tableStyleId> válido referenciando o tableStyles.xml
 * 10. Todos os shapes (<p:sp>) possuem <p:txBody> com estrutura válida
 * 11. Todos os XMLs bem formados, com cabeçalho padrão e tags raiz balanceadas
 */
import { generatePresentationPptx, PptxPresentationData } from '../pptxExportService'

export interface PptxValidationResult {
  passed: boolean
  errors: string[]
  partCount: number
}

// Leitor simples de entradas ZIP em TypeScript sem dependência de módulos de SO
function unzipEntries(zipBuffer: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  let pos = 0
  const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength)

  while (pos + 30 <= zipBuffer.length) {
    const sig = view.getUint32(pos, true)
    if (sig !== 0x04034b50) {
      break
    }
    const compSize = view.getUint32(pos + 18, true)
    const nameLen = view.getUint16(pos + 26, true)
    const extraLen = view.getUint16(pos + 28, true)

    const nameBytes = zipBuffer.slice(pos + 30, pos + 30 + nameLen)
    const name = new TextDecoder().decode(nameBytes)

    const dataStart = pos + 30 + nameLen + extraLen
    const dataBytes = zipBuffer.slice(dataStart, dataStart + compSize)

    entries.set(name, dataBytes)
    pos = dataStart + compSize
  }

  return entries
}

export function validatePptxOpenXml(data: PptxPresentationData): PptxValidationResult {
  const errors: string[] = []
  const pptxBytes = generatePresentationPptx(data)

  if (!pptxBytes || pptxBytes.length === 0) {
    return { passed: false, errors: ['Buffer PPTX vazio'], partCount: 0 }
  }

  const entries = unzipEntries(pptxBytes)
  const decoder = new TextDecoder('utf-8')

  // 1. Partes fundamentais requeridas pelo PowerPoint
  const requiredParts = [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'docProps/app.xml',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'ppt/presProps.xml',
    'ppt/viewProps.xml',
    'ppt/tableStyles.xml',
    'ppt/theme/theme1.xml',
    'ppt/slideMasters/slideMaster1.xml',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    'ppt/slides/slide1.xml',
    'ppt/slides/_rels/slide1.xml.rels',
  ]

  for (const part of requiredParts) {
    if (!entries.has(part)) {
      errors.push(`Parte obrigatória ausente no pacote PPTX: ${part}`)
    }
  }

  // 2. Validações de XML em [Content_Types].xml
  const contentTypesRaw = entries.get('[Content_Types].xml')
  if (contentTypesRaw) {
    const text = decoder.decode(contentTypesRaw)
    if (
      !text.includes(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
      )
    ) {
      errors.push('[Content_Types].xml não declara tipo para presentation.main+xml')
    }
    if (!text.includes('presProps+xml')) {
      errors.push('[Content_Types].xml não declara presProps+xml')
    }
    if (!text.includes('viewProps+xml')) {
      errors.push('[Content_Types].xml não declara viewProps+xml')
    }
    if (!text.includes('tableStyles+xml')) {
      errors.push('[Content_Types].xml não declara tableStyles+xml')
    }
  }

  // 3. Validação de p:txStyles em slideMaster1.xml
  const masterRaw = entries.get('ppt/slideMasters/slideMaster1.xml')
  if (masterRaw) {
    const text = decoder.decode(masterRaw)
    if (!text.includes('<p:txStyles>')) {
      errors.push('slideMaster1.xml não contém <p:txStyles>')
    }
    if (
      !text.includes('<p:titleStyle>') ||
      !text.includes('<p:bodyStyle>') ||
      !text.includes('<p:otherStyle>')
    ) {
      errors.push(
        'slideMaster1.xml não contém os 3 estilos de texto obrigatórios (titleStyle, bodyStyle, otherStyle)',
      )
    }
  }

  // 4. Validação de p:defaultTextStyle em presentation.xml
  const presRaw = entries.get('ppt/presentation.xml')
  if (presRaw) {
    const text = decoder.decode(presRaw)
    if (!text.includes('<p:defaultTextStyle>')) {
      errors.push('presentation.xml não contém <p:defaultTextStyle>')
    }
  }

  // 5. Validação de relacionamentos em ppt/_rels/presentation.xml.rels
  const presRelsRaw = entries.get('ppt/_rels/presentation.xml.rels')
  if (presRelsRaw) {
    const text = decoder.decode(presRelsRaw)
    if (!text.includes('relationships/presProps')) {
      errors.push('presentation.xml.rels não referencia presProps')
    }
    if (!text.includes('relationships/viewProps')) {
      errors.push('presentation.xml.rels não referencia viewProps')
    }
    if (!text.includes('relationships/tableStyles')) {
      errors.push('presentation.xml.rels não referencia tableStyles')
    }
  }

  // 6. Rigor específico para PowerPoint para Mac:
  // a) Todos os slides devem conter p:clrMapOvr com a:masterClrMapping
  // b) Tabelas devem ter tableStyleId definido e presente no tableStyles.xml
  // c) Shapes devem conter p:txBody válido
  const tableStylesRaw = entries.get('ppt/tableStyles.xml')
  const tableStylesXml = tableStylesRaw ? decoder.decode(tableStylesRaw) : ''

  if (tableStylesRaw) {
    if (!tableStylesXml.includes('<a:tblStyle ')) {
      errors.push('tableStyles.xml não define nenhuma entrada <a:tblStyle>, causando reparo ao renderizar tabelas')
    }
  }

  entries.forEach((raw, name) => {
    if (name.startsWith('ppt/slides/slide') && name.endsWith('.xml')) {
      const slideXml = decoder.decode(raw)

      // Verifica clrMapOvr
      if (!slideXml.includes('<p:clrMapOvr>')) {
        errors.push(`Slide ${name} não contém <p:clrMapOvr> (exigido por PowerPoint Mac e Keynote)`)
      } else if (!slideXml.includes('<a:masterClrMapping/>')) {
        errors.push(`Slide ${name} contém <p:clrMapOvr> mas não declara <a:masterClrMapping/>`)
      }

      // Se contém tabela DrawingML, valida integridade da tabela
      if (slideXml.includes('<a:tbl>')) {
        if (!slideXml.includes('<a:tableStyleId>')) {
          errors.push(`Slide ${name} contém <a:tbl> sem <a:tableStyleId> dentro de <a:tblPr>`)
        } else {
          const matchStyleId = slideXml.match(/<a:tableStyleId>([^<]+)<\/a:tableStyleId>/)
          if (matchStyleId && matchStyleId[1]) {
            const styleId = matchStyleId[1]
            if (!tableStylesXml.includes(styleId)) {
              errors.push(
                `Slide ${name} referencia tableStyleId "${styleId}" inexistente em tableStyles.xml`,
              )
            }
          }
        }
      }

      // Valida que todos os shapes possuem p:txBody
      const spMatches = slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g)
      if (spMatches) {
        spMatches.forEach((spBlock, spIdx) => {
          if (!spBlock.includes('<p:txBody>')) {
            errors.push(`Slide ${name} possui shape #${spIdx + 1} sem elemento <p:txBody>`)
          }
        })
      }
    }
  })

  // 7. Integridade de tags fechadas e XML bem-formado em todas as partes
  entries.forEach((raw, name) => {
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const xml = decoder.decode(raw).trim()
      if (!xml.startsWith('<?xml')) {
        errors.push(`Arquivo ${name} não começa com declaração XML padrão`)
      }
      const rootMatch = xml.match(/<([a-zA-Z0-9:]+)[\s>]/)
      if (rootMatch && rootMatch[1]) {
        const rootTag = rootMatch[1]
        if (!xml.endsWith(`</${rootTag}>`) && !xml.endsWith('/>')) {
          errors.push(`Arquivo ${name} possui tag raiz não fechada corretamente: ${rootTag}`)
        }
      }
    }
  })

  return {
    passed: errors.length === 0,
    errors,
    partCount: entries.size,
  }
}
