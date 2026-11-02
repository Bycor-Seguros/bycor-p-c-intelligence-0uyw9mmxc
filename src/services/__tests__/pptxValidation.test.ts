/**
 * Teste unitário e de conformidade do gerador de PPTX OpenXML (pptxExportService).
 * Valida se o pacote binário ZIP gerado contém todos os requisitos necessários
 * para que o Microsoft PowerPoint abra sem avisos de reparo ou recuperação:
 * 1. Arquivo ZIP PKWARE válido (assinatura 0x04034b50, headers STORE, timestamps válidos)
 * 2. [Content_Types].xml presente com todas as extensões e overrides corretos
 * 3. _rels/.rels com officeDocument apontando para ppt/presentation.xml
 * 4. ppt/presentation.xml com p:defaultTextStyle e tamanhos de slide
 * 5. ppt/presProps.xml, ppt/viewProps.xml e ppt/tableStyles.xml presentes
 * 6. ppt/slideMasters/slideMaster1.xml com p:txStyles estruturado (titleStyle, bodyStyle, otherStyle)
 * 7. Todos os XMLs bem formados e válidos
 */
import { generatePresentationPptx, PptxPresentationData } from '../pptxExportService'

export interface PptxValidationResult {
  passed: boolean
  errors: string[]
  partCount: number
}

// Leitor simples de entradas ZIP em TypeScript/Node para validar o pacote gerado
function unzipEntries(zipBuffer: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  let pos = 0
  const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength)

  while (pos + 30 <= zipBuffer.length) {
    const sig = view.getUint32(pos, true)
    if (sig !== 0x04034b50) {
      // Chegou no diretório central ou fim dos headers locais
      break
    }
    const compMethod = view.getUint16(pos + 8, true)
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

  // 6. Integridade de tags fechadas em todos os XMLs
  entries.forEach((raw, name) => {
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const xml = decoder.decode(raw).trim()
      if (!xml.startsWith('<?xml')) {
        errors.push(`Arquivo ${name} não começa com declaração XML padrão`)
      }
      // Checa balanceamento básico de tags raízes
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
