/**
 * Leitor de Propostas de Seguradoras (P&C Intelligence)
 *
 * Suporta extração de PDFs reais (AXA, Chubb, Tokio Marine, Zurich e outras).
 * Inclui detecção e desdobramento de arquivos com múltiplos documentos mesclados,
 * extração de dados cadastrais (CNPJ, SUSEP, Cotação), datas, valores monetários,
 * prêmios líquidos/totais, IOF, parcelamento e tabela estruturada de coberturas com LMI e Franquias.
 */

import { matchCanonicalCategory } from '@/services/riskCardReader'
import { canonicalizeInsurerName } from '@/services/guardiaImporter'
import { extractTextFromPdf, PdfPageText } from '@/services/pdfTextExtractor'

export interface ExtractedCoberturaItem {
  cobertura: string
  categoriaNormalizada: string
  lmi: number | null
  premioLiquido: number | null
  franquia: string
}

export interface SeguradoraDetectada {
  nomeCanonica: string // 'AXA', 'Chubb', 'Tokio Marine', 'Zurich', etc.
  razaoSocial: string
  cnpj?: string
  susep?: string
  confianca: 'alta' | 'media' | 'baixa'
}

export interface PropostaSegmentoExtracao {
  id: string
  titulo: string
  paginaInicio: number
  paginaFim: number
  seguradora: SeguradoraDetectada
  numeroCotacao: string
  versao: string
  dataCotacao: string
  validadeCotacao: string
  vigenciaInicio: string
  vigenciaFim: string
  premioLiquido: number | null
  premioTotal: number | null
  iof: number | null
  lmiTotal: number | null
  formaPagamento: string
  posFranquiasGerais: string
  coberturas: ExtractedCoberturaItem[]
  rawTextPreview: string
  statusExtracao: 'completa' | 'parcial' | 'minima'
}

export interface LeitorPropostaResultado {
  totalPaginas: number
  documentos: PropostaSegmentoExtracao[]
  erro?: string
}

// ==========================================
// REGEX E HELPERS DE CONVERSÃO
// ==========================================

export function parsePtBrNumber(val: string | null | undefined): number | null {
  if (!val) return null
  const cleaned = val
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parsePtBrDate(val: string | null | undefined): string {
  if (!val) return ''
  const m = val.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (m) {
    const d = m[1].padStart(2, '0')
    const mo = m[2].padStart(2, '0')
    const y = m[3]
    return `${y}-${mo}-${d}`
  }
  return ''
}

function cleanCnpj(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Normaliza razão social canônica conhecida
const SEGURADORAS_CONHECIDAS: Array<{
  matchNames: string[]
  canonica: string
  razaoSocial: string
  cnpj?: string
  susep?: string
}> = [
  {
    matchNames: ['axa', 'axa seguros'],
    canonica: 'AXA Seguros S.A.',
    razaoSocial: 'AXA Seguros, S.A.',
    cnpj: '19.323.190/0001-06',
    susep: '0285-2',
  },
  {
    matchNames: ['chubb', 'chubb seguros'],
    canonica: 'Chubb Seguros Brasil S.A.',
    razaoSocial: 'Chubb Seguros Brasil S.A.',
    cnpj: '03.502.099/0001-18',
    susep: '06513',
  },
  {
    matchNames: ['tokio marine', 'tokio'],
    canonica: 'Tokio Marine Seguradora S.A.',
    razaoSocial: 'Tokio Marine Seguradora S.A.',
    cnpj: '33.164.021/0001-00',
    susep: '06157',
  },
  {
    matchNames: ['zurich', 'zurich minas brasil'],
    canonica: 'Zurich Minas Brasil Seguros S.A.',
    razaoSocial: 'Zurich Minas Brasil Seguros S.A.',
    cnpj: '17.197.385/0001-21',
    susep: '05495',
  },
  {
    matchNames: ['porto seguro', 'porto'],
    canonica: 'Porto Seguro Cia. de Seguros Gerais',
    razaoSocial: 'Porto Seguro Companhia de Seguros Gerais',
    cnpj: '61.198.164/0001-60',
    susep: '05886',
  },
  {
    matchNames: ['mitsui', 'msig', 'mitsui sumitomo'],
    canonica: 'Mitsui Sumitomo Seguros S.A.',
    razaoSocial: 'Mitsui Sumitomo Seguros S.A.',
    cnpj: '33.048.406/0001-49',
    susep: '05266',
  },
  {
    matchNames: ['ezze', 'ezze seguros'],
    canonica: 'Ezze Seguros S.A.',
    razaoSocial: 'Ezze Seguros S.A.',
    cnpj: '31.534.848/0001-24',
    susep: '03158',
  },
  {
    matchNames: ['allianz'],
    canonica: 'Allianz Seguros S.A.',
    razaoSocial: 'Allianz Seguros S.A.',
    cnpj: '61.573.796/0001-66',
    susep: '05177',
  },
  {
    matchNames: ['mapfre'],
    canonica: 'Mapfre Seguros Gerais S.A.',
    razaoSocial: 'Mapfre Seguros Gerais S.A.',
    cnpj: '61.074.175/0001-38',
    susep: '06238',
  },
]

export function identifySeguradoraFromText(text: string): SeguradoraDetectada {
  const norm = text.toLowerCase()

  for (const seg of SEGURADORAS_CONHECIDAS) {
    if (seg.matchNames.some((m) => norm.includes(m))) {
      // Extrair CNPJ se visível no texto
      const cnpjMatch = text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)
      // Extrair SUSEP se visível
      const susepMatch = text.match(
        /(?:registro|c[oó]digo|processo)\s*susep[:\s]*([0-9A-Za-z./-]+)/i,
      )

      return {
        nomeCanonica: seg.canonica,
        razaoSocial: seg.razaoSocial,
        cnpj: cnpjMatch ? cnpjMatch[0] : seg.cnpj,
        susep: susepMatch ? susepMatch[1] : seg.susep,
        confianca: 'alta',
      }
    }
  }

  // Fallback genérico: tenta capturar padrão "Seguradora X" ou "X Seguros"
  const genericMatch = text.match(
    /([A-Z][A-Za-z0-9\s&.-]{3,35}\b(?:Seguros|Seguradora|Cia de Seguros)\b)/i,
  )
  if (genericMatch) {
    return {
      nomeCanonica: genericMatch[1].trim(),
      razaoSocial: genericMatch[1].trim(),
      confianca: 'media',
    }
  }

  return {
    nomeCanonica: 'Seguradora Não Identificada',
    razaoSocial: '',
    confianca: 'baixa',
  }
}

// ==========================================
// DIVISÃO DE DOCUMENTOS MESCLADOS
// ==========================================

export function detectDocumentBoundaries(pages: PdfPageText[]): Array<{
  paginaInicio: number
  paginaFim: number
  tipo: string
}> {
  if (pages.length === 0) return []

  const splitPoints: number[] = [1] // Página 1 é sempre início do 1º doc

  // Padrões de início de documento / cotação independente por seguradora ou cabeçalho formal
  for (let i = 1; i < pages.length; i++) {
    const p = pages[i]
    const text = p.text
    const firstLines = p.lines.slice(0, 14).join(' ').toLowerCase()
    const first500 = text.slice(0, 700).toLowerCase()

    // 1. AXA: Novo cabeçalho formal "Cotação de Seguros AXA Empresa Flex" ou
    // "Cotação de Seguros" + "AXA Seguros" ou nova cotação "Cotação: XXXXX - VX" no topo
    const isNewAxa =
      firstLines.includes('cotação de seguros axa') ||
      (firstLines.includes('cotação de seguros') &&
        (firstLines.includes('axa empresa flex') || first500.includes('axa empresa flex'))) ||
      ((firstLines.includes('axa seguros') || first500.includes('axa seguros')) &&
        (firstLines.includes('cotação de seguros') ||
          firstLines.includes('dados do segurado') ||
          /cota[çc][ãa]o[:\s]*\d{5,}/i.test(firstLines)))

    // 2. Chubb: "Proposta Property Online", "Chubb Seguros Brasil" com "Número da Cotação" no topo,
    // ou "Cotação Chubb" ou "Proposta nº" com Chubb
    const isNewChubb =
      firstLines.includes('proposta property online') ||
      (firstLines.includes('chubb') &&
        (firstLines.includes('proposta property online') ||
          firstLines.includes('número da cotação') ||
          firstLines.includes('numero da cotacao') ||
          firstLines.includes('quadro de coberturas') ||
          firstLines.includes('especificação do seguro'))) ||
      ((first500.includes('chubb seguros') || first500.includes('property online')) &&
        (firstLines.includes('número da cotação') ||
          firstLines.includes('numero da cotacao') ||
          firstLines.includes('proposta property online')))

    // 3. Tokio Marine: "Proposta de Seguro Tokio Marine", "Dados da Proposta" + Tokio Marine + "Proposta nº.",
    // ou "Tokio Marine Seguradora" no cabeçalho com início de dados cadastrais
    const isNewTokio =
      firstLines.includes('proposta de seguro tokio marine') ||
      (firstLines.includes('tokio marine seguradora') && firstLines.includes('proposta')) ||
      (firstLines.includes('dados da proposta') &&
        (first500.includes('tokio marine') || firstLines.includes('tokio marine')) &&
        /proposta\s*n[º°.]/i.test(firstLines)) ||
      (firstLines.includes('proposta de seguro') &&
        (firstLines.includes('tokio') || first500.includes('tokio marine')))

    // 4. Zurich: "Cotação de Seguros" com Zurich, "Cotação no." com Zurich,
    // "Sobre a Zurich" (página de abertura institucional de cotação), ou
    // cabeçalho de cotação Zurich Minas Brasil
    const isNewZurich =
      ((firstLines.includes('cotação de seguros') || firstLines.includes('cotacao de seguros')) &&
        (firstLines.includes('zurich') || first500.includes('zurich'))) ||
      (/cota[çc][ãa]o\s*no\.?/i.test(firstLines) &&
        (firstLines.includes('zurich') || first500.includes('zurich'))) ||
      firstLines.includes('sobre a zurich') ||
      (firstLines.includes('zurich minas brasil') &&
        (firstLines.includes('cotação') ||
          firstLines.includes('proposta') ||
          firstLines.includes('apólice')))

    // 5. Marcador genérico forte de capa / abertura de cotação
    const isGenericNewDoc =
      /^(?:cota[çc][ãa]o\s+de\s+seguros|proposta\s+de\s+seguro|especifica[çc][ãa]o\s+da\s+proposta)/i.test(
        firstLines.trim(),
      ) &&
      (firstLines.includes('dados do segurado') ||
        firstLines.includes('dados da proposta') ||
        firstLines.includes('vigência') ||
        firstLines.includes('vigencia'))

    if (isNewAxa || isNewChubb || isNewTokio || isNewZurich || isGenericNewDoc) {
      // Distância mínima reduzida para 2 páginas (uma cotação resumida pode ter 2 a 3 páginas)
      const lastPoint = splitPoints[splitPoints.length - 1]
      if (p.pageNumber - lastPoint >= 2) {
        splitPoints.push(p.pageNumber)
      }
    }
  }

  const boundaries: Array<{ paginaInicio: number; paginaFim: number; tipo: string }> = []
  for (let idx = 0; idx < splitPoints.length; idx++) {
    const start = splitPoints[idx]
    const end =
      idx < splitPoints.length - 1 ? splitPoints[idx + 1] - 1 : pages[pages.length - 1].pageNumber
    boundaries.push({
      paginaInicio: start,
      paginaFim: end,
      tipo: `Documento ${idx + 1}`,
    })
  }

  return boundaries
}

// ==========================================
// PARSERS ESPECÍFICOS POR SEGURADORA
// ==========================================

function extractAxaDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // Cotação e Versão reais do segmento
  let cotacao = ''
  let versao = ''

  // Formato: "Cotação: 3840019 - V2" ou "Cotação nº 3840019" ou "Cotação: 3840019"
  const cotMatch = fullText.match(/Cota[çc][ãa]o\s*(?:n[º°.]?)?[:\s]*([0-9]+(?:\s*-\s*V\d+)?)/i)
  if (cotMatch) {
    cotacao = cotMatch[1].replace(/\s+/g, ' ').trim()
    const innerV = cotacao.match(/-?\s*V(\d+)/i)
    if (innerV) {
      versao = `V${innerV[1]}`
    }
  }

  const verMatch = fullText.match(/Vers[ãa]o[:\s]*([A-Za-z0-9/]+)/i)
  if (verMatch) {
    versao = verMatch[1].trim()
  }

  // Datas
  let dataCotacao = ''
  let validadeCotacao = ''
  let vigenciaInicio = ''
  let vigenciaFim = ''

  const dtCotMatch = fullText.match(/Data da Cota[çc][ãa]o[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (dtCotMatch) dataCotacao = parsePtBrDate(dtCotMatch[1])

  const valMatch = fullText.match(/Validade da Cota[çc][ãa]o[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (valMatch) validadeCotacao = parsePtBrDate(valMatch[1])

  const vigIniMatch = fullText.match(/In[íi]cio de vig[êe]ncia[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (vigIniMatch) vigenciaInicio = parsePtBrDate(vigIniMatch[1])

  const vigFimMatch = fullText.match(/Fim de vig[êe]ncia[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (vigFimMatch) vigenciaFim = parsePtBrDate(vigFimMatch[1])

  // Valores de Forma de Pagamento e Prêmio
  let premioTotal: number | null = null
  let premioLiquido: number | null = null
  let iof: number | null = null
  let formaPagamento = ''

  // Ex: "A vista - boleto R$ 10.362,77 R$ 0,00 R$ 0,00 R$ 712,21"
  const aVistaMatch = fullText.match(
    /A vista\s*-\s*boleto\s*R\$\s*([\d.,]+)\s*R\$\s*[\d.,]+\s*R\$\s*[\d.,]+\s*R\$\s*([\d.,]+)/i,
  )
  if (aVistaMatch) {
    premioTotal = parsePtBrNumber(aVistaMatch[1])
    iof = parsePtBrNumber(aVistaMatch[2])
    formaPagamento = 'À vista - boleto'
  } else {
    // Linha genérica de forma de pagamento com parcelas
    const parceladoMatch = fullText.match(
      /(\d+x\s*(?:sem juros|com juros)?\s*-\s*boleto)\s*R\$\s*([\d.,]+)/i,
    )
    if (parceladoMatch) {
      formaPagamento = parceladoMatch[1].trim()
      premioTotal = parsePtBrNumber(parceladoMatch[2])
    }
  }

  // Busca de prêmio total se ainda nulo
  if (!premioTotal) {
    const prTotalMatch = fullText.match(/Pr[êe]mio\s+(?:Total|Bruto)[:\s]*R?\$?\s*([\d.,]+)/i)
    if (prTotalMatch) {
      premioTotal = parsePtBrNumber(prTotalMatch[1])
    }
  }

  // Busca de prêmio líquido
  const prLiqMatch = fullText.match(/Pr[êe]mio\s+L[íi]quido[:\s]*R?\$?\s*([\d.,]+)/i)
  if (prLiqMatch) {
    premioLiquido = parsePtBrNumber(prLiqMatch[1])
  }

  // Tabela ADICIONAIS E/OU SUBLIMITES
  // Cobertura Local Limite Máximo de Indenização Prêmio Líquido Franquia
  const coberturas: ExtractedCoberturaItem[] = []
  let insideTable = false
  let premioLiquidoSum = 0
  let lmiSum = 0

  for (const line of lines) {
    if (line.includes('ADICIONAIS E/OU SUBLIMITES') || line.includes('QUADRO DE COBERTURAS')) {
      insideTable = true
      continue
    }
    if (
      insideTable &&
      (line.includes('PROTECIONAIS DO RISCO') ||
        line.includes('Serviço De Assistência') ||
        line.includes('OBSERVAÇÕES IMPORTANTES') ||
        line.includes('CLÁUSULAS APLICÁVEIS'))
    ) {
      insideTable = false
      break
    }

    if (insideTable) {
      // Regex para linha de cobertura AXA:
      // Nome da Cobertura ... R$ 70.000,00 ... R$ 653,35 ... Franquia
      const cobMatch = line.match(
        /^([A-Za-zÀ-ÿ0-9\s/\-_()]+?)\s+(?:\d\s+)?R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s*(.*)$/i,
      )
      if (cobMatch) {
        const nomeCob = cobMatch[1].trim()
        const lmiVal = parsePtBrNumber(cobMatch[2])
        const premVal = parsePtBrNumber(cobMatch[3])
        const franq = cobMatch[4].trim()

        if (nomeCob && !nomeCob.toLowerCase().startsWith('cobertura') && lmiVal !== null) {
          coberturas.push({
            cobertura: nomeCob,
            categoriaNormalizada: matchCanonicalCategory(nomeCob),
            lmi: lmiVal,
            premioLiquido: premVal,
            franquia: franq || 'Não informada',
          })
          if (lmiVal) lmiSum += lmiVal
          if (premVal) premioLiquidoSum += premVal
        }
      }
    }
  }

  // Se não extraiu do texto, busca LMI da Básica
  if (lmiSum === 0) {
    const basicaMatch = fullText.match(
      /(?:B[áa]sica|Inc[êe]ndio)[^R\n]*R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
    )
    if (basicaMatch) {
      lmiSum = parsePtBrNumber(basicaMatch[1]) || 0
    }
  }

  const finalPremioLiq = premioLiquido || (premioLiquidoSum > 0 ? premioLiquidoSum : null)

  return {
    numeroCotacao: cotacao || '',
    versao: versao || '1',
    dataCotacao,
    validadeCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioTotal,
    premioLiquido: finalPremioLiq,
    iof,
    lmiTotal: lmiSum > 0 ? lmiSum : null,
    formaPagamento: formaPagamento || 'Boleto bancário',
    coberturas,
  }
}

function extractChubbDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // Cotação / Proposta Chubb:
  // "Número da Cotação 4.220.159 Versão 1" ou "Proposta Property Online ... Proposta nº 4.220.159"
  let cotacao = ''
  let versao = ''
  const cotMatch = fullText.match(/N[úu]mero da Cota[çc][ãa]o\s*([0-9.]+)/i)
  if (cotMatch) {
    cotacao = cotMatch[1].trim()
  } else {
    const propMatch = fullText.match(/Proposta\s*(?:n[º°.]|número)?\s*([0-9.]+)/i)
    if (propMatch) cotacao = propMatch[1].trim()
  }

  const verMatch = fullText.match(/Vers[ãa]o\s*([0-9A-Za-z]+)/i)
  if (verMatch) versao = verMatch[1].trim()

  // Prêmio total Chubb
  let premioTotal: number | null = null
  let premioLiquido: number | null = null
  let iof: number | null = null

  const premMatch = fullText.match(/Pr[êe]mio\s+(?:total|bruto)\s*[:\s]*R?\$?\s*([\d.,]+)/i)
  if (premMatch) {
    premioTotal = parsePtBrNumber(premMatch[1])
  }

  const premLiqMatch = fullText.match(/Pr[êe]mio\s+l[íi]quido\s*[:\s]*R?\$?\s*([\d.,]+)/i)
  if (premLiqMatch) {
    premioLiquido = parsePtBrNumber(premLiqMatch[1])
  }

  const iofMatch = fullText.match(/I\.?O\.?F\.?\s*[:\s]*R?\$?\s*([\d.,]+)/i)
  if (iofMatch) {
    iof = parsePtBrNumber(iofMatch[1])
  }

  // Datas
  let dataCotacao = ''
  let vigenciaInicio = ''
  let vigenciaFim = ''

  const dtMatch = fullText.match(/Data\s*[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (dtMatch) dataCotacao = parsePtBrDate(dtMatch[1])

  const vigMatch = fullText.match(
    /Vig[êe]ncia[:\s]*(?:das\s+24\s+horas\s+do\s+dia\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[àa]|at[ée])\s*(?:[àa]s\s+24\s+horas\s+do\s+dia\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigMatch) {
    vigenciaInicio = parsePtBrDate(vigMatch[1])
    vigenciaFim = parsePtBrDate(vigMatch[2])
  }

  // Coberturas Chubb
  const coberturas: ExtractedCoberturaItem[] = []
  let lmiSum = 0

  for (const line of lines) {
    const cobMatch = line.match(
      /^([A-Za-zÀ-ÿ0-9\s/\-_()]{4,45})\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s+([\d.,]+)?\s*(.*)$/i,
    )
    if (cobMatch) {
      const nomeCob = cobMatch[1].trim()
      const lmiVal = parsePtBrNumber(cobMatch[2])
      const premVal = cobMatch[3] ? parsePtBrNumber(cobMatch[3]) : null
      const franquia = cobMatch[4]?.trim() || ''

      const lower = nomeCob.toLowerCase()
      if (
        nomeCob.length > 3 &&
        !lower.includes('condições especiais') &&
        !lower.includes('av. nações') &&
        !lower.includes('chubb seguros') &&
        !lower.includes('endereço') &&
        !lower.includes('vigência') &&
        lmiVal !== null &&
        lmiVal > 100
      ) {
        coberturas.push({
          cobertura: nomeCob,
          categoriaNormalizada: matchCanonicalCategory(nomeCob),
          lmi: lmiVal,
          premioLiquido: premVal,
          franquia: franquia || 'Franquia conforme condições',
        })
        lmiSum += lmiVal
      }
    }
  }

  // Tenta capturar LMI Básica da Chubb se a soma ficou zero
  if (lmiSum === 0) {
    const basicaChubb = fullText.match(/Cobertura\s+B[áa]sica\s*[:\s]*R?\$?\s*([\d.,]+)/i)
    if (basicaChubb) {
      lmiSum = parsePtBrNumber(basicaChubb[1]) || 0
    }
  }

  return {
    numeroCotacao: cotacao || '',
    versao: versao || '1',
    dataCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioTotal,
    premioLiquido,
    iof,
    lmiTotal: lmiSum > 0 ? lmiSum : null,
    coberturas,
  }
}

function extractTokioDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // Proposta nº. 13115243 Versão nº. 4 / Data: 05/12/2025
  let cotacao = ''
  let versao = ''
  const propMatch = fullText.match(/Proposta\s*(?:nº|n°|n\.|número)?\s*[:\s]*([0-9]+)/i)
  if (propMatch) cotacao = propMatch[1]

  const verMatch = fullText.match(/Vers[ãa]o\s*(?:nº|n°|n\.|número)?\s*[:\s]*([0-9A-Za-z]+)/i)
  if (verMatch) versao = verMatch[1]

  let dataCotacao = ''
  const dtMatch = fullText.match(/Data[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (dtMatch) dataCotacao = parsePtBrDate(dtMatch[1])

  let vigenciaInicio = ''
  let vigenciaFim = ''
  const vigTokio = fullText.match(
    /Vig[êe]ncia[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[àa]|at[ée])\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigTokio) {
    vigenciaInicio = parsePtBrDate(vigTokio[1])
    vigenciaFim = parsePtBrDate(vigTokio[2])
  }

  // Prêmio Total / Líquido Tokio Marine
  let premioTotal: number | null = null
  let premioLiquido: number | null = null
  let iof: number | null = null

  const premTotalMatch = fullText.match(/Pr[êe]mio\s+Total[:\s]*R?\$?\s*([\d.,]+)/i)
  if (premTotalMatch) premioTotal = parsePtBrNumber(premTotalMatch[1])

  const premLiqMatch = fullText.match(/Pr[êe]mio\s+L[íi]quido[:\s]*R?\$?\s*([\d.,]+)/i)
  if (premLiqMatch) premioLiquido = parsePtBrNumber(premLiqMatch[1])

  const iofTokio = fullText.match(/I\.?O\.?F\.?[:\s]*R?\$?\s*([\d.,]+)/i)
  if (iofTokio) iof = parsePtBrNumber(iofTokio[1])

  // Coberturas Tokio Marine
  const coberturas: ExtractedCoberturaItem[] = []
  let lmiSum = 0

  for (const line of lines) {
    // Linha com Importância Segurada / Limite
    const m = line.match(
      /^([A-Za-zÀ-ÿ0-9\s/\-_()]+?)\s+R\$\s*([\d.,]+)\s*(?:R\$\s*([\d.,]+))?\s*(.*)$/i,
    )
    if (m) {
      const nome = m[1].trim()
      const valLmi = parsePtBrNumber(m[2])
      const valPrem = m[3] ? parsePtBrNumber(m[3]) : null
      const rest = m[4]?.trim() || ''

      const lower = nome.toLowerCase()
      if (
        nome.length > 3 &&
        !lower.includes('proposta de seguro') &&
        !lower.includes('tokio marine') &&
        !lower.includes('informações gerais') &&
        valLmi &&
        valLmi > 500
      ) {
        coberturas.push({
          cobertura: nome,
          categoriaNormalizada: matchCanonicalCategory(nome),
          lmi: valLmi,
          premioLiquido: valPrem,
          franquia: rest || 'Conforme apólice',
        })
        lmiSum += valLmi
      }
    }
  }

  return {
    numeroCotacao: cotacao || '',
    versao: versao || '1',
    dataCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioTotal,
    premioLiquido,
    iof,
    lmiTotal: lmiSum > 0 ? lmiSum : null,
    coberturas,
  }
}

function extractZurichDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // Cotação No.
  let cotacao = ''
  let versao = ''
  const cotMatch = fullText.match(
    /Cota[çc][ãa]o\s*(?:No\.?|n[º°.]|número)?\s*[:\s]*([0-9A-Za-z./-]+)/i,
  )
  if (cotMatch) cotacao = cotMatch[1].trim()

  const verMatch = fullText.match(/Vers[ãa]o\s*[:\s]*([0-9A-Za-z]+)/i)
  if (verMatch) versao = verMatch[1].trim()

  // Datas
  let dataCotacao = ''
  let vigenciaInicio = ''
  let vigenciaFim = ''

  const dtMatch = fullText.match(/Data\s*[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (dtMatch) dataCotacao = parsePtBrDate(dtMatch[1])

  const vigMatch = fullText.match(
    /Vig[êe]ncia[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[àa]|at[ée])\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigMatch) {
    vigenciaInicio = parsePtBrDate(vigMatch[1])
    vigenciaFim = parsePtBrDate(vigMatch[2])
  }

  // R$ 149.150,97 (Total para parcelamento em 4 vezes = R$ 160.158,31)
  let premioLiquido: number | null = null
  let premioTotal: number | null = null
  let formaPagamento = ''

  const premZurichMatch = fullText.match(
    /R\$\s*([\d.,]+)\s*\(Total para parcelamento[^=]*=\s*R\$\s*([\d.,]+)\)/i,
  )
  if (premZurichMatch) {
    premioLiquido = parsePtBrNumber(premZurichMatch[1])
    premioTotal = parsePtBrNumber(premZurichMatch[2])
    formaPagamento = 'Parcelamento em 4x'
  } else {
    const premLiqAvulso = fullText.match(/Pr[êe]mio\s+L[íi]quido\s*[:\s]*R?\$?\s*([\d.,]+)/i)
    if (premLiqAvulso) premioLiquido = parsePtBrNumber(premLiqAvulso[1])

    const premTotAvulso = fullText.match(/Pr[êe]mio\s+Total\s*[:\s]*R?\$?\s*([\d.,]+)/i)
    if (premTotAvulso) premioTotal = parsePtBrNumber(premTotAvulso[1])
  }

  // Coberturas contratadas, Limites e Franquias
  const coberturas: ExtractedCoberturaItem[] = []
  let lmiSum = 0

  for (const line of lines) {
    const directMatch = line.match(/[-]?\s*R?\$?\s*([\d.,]+)\s+para\s+([A-Za-zÀ-ÿ0-9\s–/\-_()]+)/i)
    if (directMatch) {
      const val = parsePtBrNumber(directMatch[1])
      const nome = directMatch[2].trim()
      if (val && nome) {
        coberturas.push({
          cobertura: nome,
          categoriaNormalizada: matchCanonicalCategory(nome),
          lmi: val,
          premioLiquido: null,
          franquia: 'Conforme apólice Zurich',
        })
        lmiSum += val
      }
      continue
    }

    const tableMatch = line.match(
      /^([A-Za-zÀ-ÿ0-9\s–/\-_()]{4,50})\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s*(.*)$/i,
    )
    if (tableMatch) {
      const nome = tableMatch[1].trim()
      const val = parsePtBrNumber(tableMatch[2])
      const rest = tableMatch[3]?.trim() || ''

      const lower = nome.toLowerCase()
      if (
        val &&
        !lower.includes('cotação') &&
        !lower.includes('zurich') &&
        !lower.includes('endereço')
      ) {
        coberturas.push({
          cobertura: nome,
          categoriaNormalizada: matchCanonicalCategory(nome),
          lmi: val,
          premioLiquido: null,
          franquia: rest || 'Conforme condições',
        })
        lmiSum += val
      }
    }
  }

  // Se lmiSum zerado, busca LMI da Básica / Incêndio
  if (lmiSum === 0) {
    const basicaMatch = fullText.match(
      /(?:Cobertura\s+B[áa]sica|Inc[êe]ndio)[^R\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
    )
    if (basicaMatch) {
      lmiSum = parsePtBrNumber(basicaMatch[1]) || 0
    }
  }

  return {
    numeroCotacao: cotacao || '',
    versao: versao || '1',
    dataCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioLiquido,
    premioTotal,
    lmiTotal: lmiSum > 0 ? lmiSum : null,
    formaPagamento: formaPagamento || 'Conforme cotação',
    coberturas,
  }
}

// Fallback genérico para qualquer outra seguradora
function extractGenericDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')

  let cotacao = ''
  const cotMatch = fullText.match(
    /(?:cota[çc][ãa]o|proposta)\s*(?:nº|n°|no\.?|número)?[:\s]*([0-9A-Za-z./-]+)/i,
  )
  if (cotMatch) cotacao = cotMatch[1].trim()

  let premioTotal: number | null = null
  const prMatch = fullText.match(
    /(?:pr[êe]mio\s+total|pr[êe]mio\s+bruto|valor\s+total)[:\s]*R?\$?\s*([\d.,]+)/i,
  )
  if (prMatch) premioTotal = parsePtBrNumber(prMatch[1])

  let premioLiquido: number | null = null
  const prLiqMatch = fullText.match(/(?:pr[êe]mio\s+l[íi]quido)[:\s]*R?\$?\s*([\d.,]+)/i)
  if (prLiqMatch) premioLiquido = parsePtBrNumber(prLiqMatch[1])

  let lmiTotal: number | null = null
  const lmiMatch = fullText.match(
    /(?:lmi|lmg|limite\s+m[áa]ximo|import[âa]ncia\s+segurada)[:\s]*R?\$?\s*([\d.,]+)/i,
  )
  if (lmiMatch) lmiTotal = parsePtBrNumber(lmiMatch[1])

  return {
    numeroCotacao: cotacao,
    premioTotal,
    premioLiquido,
    lmiTotal,
    coberturas: [],
  }
}

// ==========================================
// FUNÇÃO PRINCIPAL DO LEITOR DE PROPOSTAS
// ==========================================

export async function processPropostaPdf(file: File): Promise<LeitorPropostaResultado> {
  try {
    // 1. Extrai texto das páginas (limite até 350 páginas para cobrir arquivos mesclados)
    const pages = await extractTextFromPdf(file, 350)
    if (pages.length === 0) {
      return {
        totalPaginas: 0,
        documentos: [],
        erro: 'O arquivo PDF não contém camadas de texto legíveis.',
      }
    }

    // 2. Identifica divisões de documentos mesclados
    const boundaries = detectDocumentBoundaries(pages)

    // 3. Processa cada segmento isoladamente
    const documentos: PropostaSegmentoExtracao[] = []

    for (let idx = 0; idx < boundaries.length; idx++) {
      const b = boundaries[idx]
      const segmentPages = pages.filter(
        (p) => p.pageNumber >= b.paginaInicio && p.pageNumber <= b.paginaFim,
      )

      // Identifica primeiras páginas para detecção da seguradora
      const headerSample = segmentPages
        .slice(0, Math.min(segmentPages.length, 6))
        .map((p) => p.text)
        .join('\n')

      const seguradora = identifySeguradoraFromText(headerSample)
      const canonica = canonicalizeInsurerName(seguradora.nomeCanonica)

      let extracted: Partial<PropostaSegmentoExtracao>

      if (canonica === 'axa') {
        extracted = extractAxaDetails(segmentPages)
      } else if (canonica === 'chubb') {
        extracted = extractChubbDetails(segmentPages)
      } else if (canonica === 'tokio') {
        extracted = extractTokioDetails(segmentPages)
      } else if (canonica === 'zurich') {
        extracted = extractZurichDetails(segmentPages)
      } else {
        extracted = extractGenericDetails(segmentPages)
      }

      // Constrói resumo legível do documento
      const docId = `doc-${idx + 1}-${seguradora.nomeCanonica.slice(0, 4).toLowerCase()}-${b.paginaInicio}`
      const numCot = extracted.numeroCotacao || `Proposta #${idx + 1}`
      const versaoCot = extracted.versao ? ` (Versão ${extracted.versao})` : ''
      const premio = extracted.premioTotal || extracted.premioLiquido || null

      let statusExtracao: 'completa' | 'parcial' | 'minima' = 'minima'
      if (
        seguradora.confianca === 'alta' &&
        (premio !== null || (extracted.coberturas && extracted.coberturas.length > 0))
      ) {
        statusExtracao = 'completa'
      } else if (seguradora.confianca !== 'baixa') {
        statusExtracao = 'parcial'
      }

      const previewLines = segmentPages[0]?.lines.slice(0, 8).join('\n') || ''

      documentos.push({
        id: docId,
        titulo: `${seguradora.nomeCanonica} — Cotação ${numCot}${versaoCot} [Págs. ${b.paginaInicio} a ${b.paginaFim}]`,
        paginaInicio: b.paginaInicio,
        paginaFim: b.paginaFim,
        seguradora,
        numeroCotacao: numCot,
        versao: extracted.versao || '1',
        dataCotacao: extracted.dataCotacao || new Date().toISOString().slice(0, 10),
        validadeCotacao: extracted.validadeCotacao || '',
        vigenciaInicio: extracted.vigenciaInicio || '',
        vigenciaFim: extracted.vigenciaFim || '',
        premioLiquido: extracted.premioLiquido || null,
        premioTotal: extracted.premioTotal || null,
        iof: extracted.iof || null,
        lmiTotal: extracted.lmiTotal || null,
        formaPagamento: extracted.formaPagamento || 'Boleto',
        posFranquiasGerais: extracted.posFranquiasGerais || '',
        coberturas: extracted.coberturas || [],
        rawTextPreview: previewLines,
        statusExtracao,
      })
    }

    return {
      totalPaginas: pages.length,
      documentos,
    }
  } catch (err: unknown) {
    console.error('Falha no leitor de proposta PDF:', err)
    return {
      totalPaginas: 0,
      documentos: [],
      erro: (err as Error).message || 'Erro inesperado ao processar PDF.',
    }
  }
}
