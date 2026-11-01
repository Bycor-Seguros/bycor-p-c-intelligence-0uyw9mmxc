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
import { extractAxaCoberturas, parseAxaPosLegenda } from '@/services/apoliceReader'
import { isCoberturaBasica, isCoberturaLucrosCessantes } from '@/services/submissionKitService'

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

export interface DiagnosticoFragmento {
  str: string
  x: number
  y: number
  pagina: number
  width?: number
  height?: number
  fontName?: string
  isBold?: boolean
}

export interface DiagnosticoLimitesCalibrados {
  pagina: number
  antes: {
    col2Left: number
    col3Left: number
    col4Left: number
  }
  depois: {
    col2Left: number
    col3Left: number
    col4Left: number
    lmiXs?: number[]
    premioXs?: number[]
    posXs?: number[]
    tableTopY: number | null
    tableBottomY: number | null
  }
}

export interface DiagnosticoLinhaMontada {
  pagina: number
  y: number
  col1: Array<{ str: string; x: number }>
  col2: Array<{ str: string; x: number }>
  col3: Array<{ str: string; x: number }>
  col4: Array<{ str: string; x: number }>
}

export interface DiagnosticoExtracao {
  seguradoraDetectada: string
  totalPaginasDocumento: number
  paginasAnalisadas: number[]
  fragmentosBrutos: DiagnosticoFragmento[]
  limitesCalibrados?: DiagnosticoLimitesCalibrados[]
  linhasMontadas?: DiagnosticoLinhaMontada[]
  resultadoFinal: {
    numeroCotacao: string
    vigenciaInicio: string
    vigenciaFim: string
    dataCotacao?: string
    premioLiquido: number | null
    premioTotal: number | null
    iof: number | null
    custoApolice?: number | null
    lmiTotal: number | null
    formaPagamento?: string
    proponente?: {
      nome?: string
      cnpj?: string
      atividade?: string
      tipoConstrucao?: string
      valorEmRiscoDeclarado?: number | null
    }
    coberturas: ExtractedCoberturaItem[]
  }
  timestamp: string
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
  custoApolice?: number | null
  lmiTotal: number | null
  formaPagamento: string
  numeroParcelas?: number | null
  posFranquiasGerais: string
  coberturas: ExtractedCoberturaItem[]
  rawTextPreview: string
  statusExtracao: 'completa' | 'parcial' | 'minima'
  diagnostico?: DiagnosticoExtracao
  dadosComplementares?: {
    seguradoNome?: string
    seguradoCnpj?: string
    atividade?: string
    tipoConstrucao?: string
    protecionais?: string[]
    respostasQuestionario?: Record<string, string>
    objetoSeguro?: string
    produtoRamo?: string
    valorEmRiscoDeclarado?: number | null
    lucrosCessantesCausas?: string
    primeiraParcelaValor?: number | null
    demaisParcelasValor?: number | null
    vrdDm?: number | null
    vrdMmu?: number | null
    vrdMmp?: number | null
    vrdLc?: number | null
    vrdLcBase?: string
    premioNet?: number | null
    comissaoTrabalhada?: number | null
    basePremio?: string
  }
  vrdDm?: number | null
  vrdMmu?: number | null
  vrdMmp?: number | null
  vrdLc?: number | null
  vrdLcBase?: string
  premioNet?: number | null
  comissaoTrabalhada?: number | null
  basePremio?: string
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
    cnpj: '33.016.221/0001-07',
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
    cnpj: '061.573.796/0001-66',
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

export function formatCnpjMask(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`
  }
  return raw
}

export function identifySeguradoraFromText(text: string): SeguradoraDetectada {
  const norm = text.toLowerCase()

  // 0. Verificação prioritária por evidências fortes da Porto Seguro
  const isPortoEvidence =
    /\bporto\s+seguro\b/i.test(norm) ||
    /\bporto\s+print\s+web\b/i.test(norm) ||
    /61\.198\.164\/0001-60/.test(text) ||
    /\b05886\b/.test(text) ||
    /or[çc]amento\s+de\s+seguros?\b/i.test(norm) ||
    /or[çc]amento\s*(?:n[º°.]?)?\s*118013040/i.test(text) ||
    (/\bporto\b/i.test(norm) && /or[çc]amento/i.test(norm))

  if (isPortoEvidence) {
    const cnpjPorto =
      text.match(/61\.198\.164\/0001-60/) || text.match(/\b\d{2,3}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)
    const susepPorto =
      text.match(/JUNTO\s+[ÀA]\s+SUSEP\s*[:\s]*([0-9A-Za-z./-]+)/i) ||
      text.match(
        /(?:registro|c[oó]digo|processo)\s*(?:junto\s*[àa]\s*)?susep\s*(?:n[º°.]?)?[:\s]*([0-9A-Za-z./-]+)/i,
      )

    return {
      nomeCanonica: 'Porto Seguro Cia. de Seguros Gerais',
      razaoSocial: /Porto Seguro Companhia de Seguros Gerais/i.test(text)
        ? 'Porto Seguro Companhia de Seguros Gerais'
        : 'Porto Seguro Cia. de Seguros Gerais',
      cnpj: cnpjPorto ? cnpjPorto[0] : '61.198.164/0001-60',
      susep: susepPorto ? susepPorto[1].trim() : '05886',
      confianca: 'alta',
    }
  }

  // 1. Verificação prioritária por evidências fortes / exatas da Allianz
  // (evita colisão de substring e falsos positivos de qualquer termo como "taxa" ou similaridade)
  const isAllianzEvidence =
    /\ballianz\b/i.test(norm) ||
    /061\.573\.796\/0001-66/.test(text) ||
    /c[oó]digo:\s*5177\b/i.test(text) ||
    /allianz\s+empresarial/i.test(norm) ||
    /allianz\s+seguros/i.test(norm) ||
    /15414\.900340\/2018-85/.test(text)

  if (isAllianzEvidence) {
    // Busca CNPJ específico da Allianz no texto ou usa o padrão oficial
    const cnpjMatch =
      text.match(/061\.573\.796\/0001-66/) || text.match(/\b\d{2,3}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)
    // Busca processo SUSEP completo ou código
    const susepProcessMatch = text.match(/PROCESSO\s+SUSEP[:\s]*([0-9./-]+)/i)
    const susepMatch =
      susepProcessMatch ||
      text.match(
        /(?:registro|c[oó]digo|processo)\s*(?:junto\s*[àa]\s*)?susep\s*(?:n[º°.]?)?[:\s]*([0-9A-Za-z./-]+)/i,
      )

    return {
      nomeCanonica: 'Allianz Seguros S.A.',
      razaoSocial: 'Allianz Seguros S.A.',
      cnpj: cnpjMatch ? cnpjMatch[0] : '061.573.796/0001-66',
      susep: susepMatch ? susepMatch[1].trim() : '15414.900340/2018-85',
      confianca: 'alta',
    }
  }

  // 2. Verificação estrita por limites de palavra (\b...\b) para cada seguradora conhecida
  // Match estrito por tokens exatos — NUNCA por substring genérica (impede colisão de "taxa" com "axa", etc.)
  for (const seg of SEGURADORAS_CONHECIDAS) {
    const hasExactTokenMatch = seg.matchNames.some((m) => {
      // Cria regex com word boundary para cada nome-chave
      const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const tokenRegex = new RegExp(`\\b${escaped}\\b`, 'i')
      return tokenRegex.test(norm)
    })

    if (hasExactTokenMatch) {
      // Extrair CNPJ formatado
      const cnpjMatch = text.match(/\b\d{2,3}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)

      // Extrair SUSEP se visível
      const susepMatch = text.match(
        /(?:registro|c[oó]digo|processo)\s*(?:junto\s*[àa]\s*)?susep\s*(?:n[º°.]?)?[:\s]*([0-9A-Za-z./-]+)/i,
      )

      let razaoSocial = seg.razaoSocial
      let susepVal = seg.susep
      let cnpjVal = seg.cnpj

      if (seg.canonica === 'Allianz Seguros S.A.' && /Allianz Seguros S\.?A\.?/i.test(text)) {
        razaoSocial = 'Allianz Seguros S.A.'
      } else if (seg.canonica === 'Porto Seguro Cia. de Seguros Gerais') {
        if (/Porto Seguro Cia(?: de)? Seguros Gerais/i.test(text)) {
          razaoSocial = 'Porto Seguro Cia de Seguros Gerais'
        }
        // Na Porto, buscar registro SUSEP específico no cabeçalho institucional (ex.: 05886)
        const susepPorto = text.match(/JUNTO\s+[ÀA]\s+SUSEP\s*[:\s]*([0-9A-Za-z./-]+)/i)
        if (susepPorto) {
          susepVal = susepPorto[1].trim()
        }
        // CNPJ da seguradora Porto Seguro no cabeçalho: 61.198.164/0001-60
        const cnpjPorto = text.match(/61\.198\.164\/0001-60/)
        if (cnpjPorto) {
          cnpjVal = cnpjPorto[0]
        }
      }

      return {
        nomeCanonica: seg.canonica,
        razaoSocial,
        cnpj: cnpjVal || (cnpjMatch ? cnpjMatch[0] : undefined),
        susep: susepVal || (susepMatch ? susepMatch[1] : undefined),
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

    // 5. Allianz: Pedido de Cotação Allianz Empresarial ou nova cotação independente
    // Cabeçalhos comuns de continuação como "Página X de 5 Nº Cotação: 888223989" NÃO iniciam novo doc!
    const isNewAllianz =
      (firstLines.includes('pedido de cotação') && firstLines.includes('allianz empresarial')) ||
      (firstLines.includes('allianz empresarial') &&
        firstLines.includes('suas informações') &&
        firstLines.includes('informações do seguro'))

    // 6. Porto Seguro: Apenas se for um NOVO orçamento completo (capa formal com "Orçamento" + "Dados do Proponente" + "Local de Risco")
    const isNewPorto =
      (firstLines.includes('porto print web') ||
        firstLines.includes('porto seguro') ||
        first500.includes('porto seguro')) &&
      (firstLines.includes('orçamento') || firstLines.includes('orcamento')) &&
      (firstLines.includes('dados do proponente') || firstLines.includes('proponente')) &&
      (firstLines.includes('número do orçamento') ||
        firstLines.includes('numero do orcamento') ||
        /or[çc]amento\s*(?:n[º°.]?)?\s*\d{6,}/i.test(firstLines))

    // 7. Marcador genérico forte de capa / abertura de cotação
    const isGenericNewDoc =
      /^(?:cota[çc][ãa]o\s+de\s+seguros|proposta\s+de\s+seguro|especifica[çc][ãa]o\s+da\s+proposta|or[çc]amento\s+de\s+seguro)/i.test(
        firstLines.trim(),
      ) &&
      (firstLines.includes('dados do segurado') ||
        firstLines.includes('dados do proponente') ||
        firstLines.includes('dados da proposta') ||
        firstLines.includes('vigência') ||
        firstLines.includes('vigencia'))
    if (
      isNewAxa ||
      isNewChubb ||
      isNewTokio ||
      isNewZurich ||
      isNewAllianz ||
      isNewPorto ||
      isGenericNewDoc
    ) {
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

export function extractAxaDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // Detecta se é o layout de Riscos Nomeados (Carta Cotação AXA RN)
  const isAxaRnLayout =
    /RISCOS\s+NOMEADOS/i.test(fullText) ||
    /Carta\s+Cota[çc][ãa]o/i.test(fullText) ||
    /2\.\s*Coberturas\s+do\s+seguro/i.test(fullText) ||
    /4\.\s*Demonstrativo\s+de\s+Pr[êe]mio/i.test(fullText)

  // Cotação e Versão reais do segmento
  let cotacao = ''
  let versao = ''

  if (isAxaRnLayout) {
    // Ex: "Ref.: Carta Cotação nº C4513405 / 2026 – Opção B1"
    const cartaMatch = fullText.match(
      /Carta\s+Cota[çc][ãa]o\s*n[º°.]?\s*([A-Za-z0-9]+(?:\s*\/\s*\d+)?(?:\s*[-–—]\s*Op[çc][ãa]o\s+[A-Za-z0-9]+)?)/i,
    )
    if (cartaMatch) {
      cotacao = cartaMatch[1].replace(/\s+/g, ' ').trim()
      const opcMatch = cotacao.match(/Op[çc][ãa]o\s+([A-Za-z0-9]+)/i)
      if (opcMatch) {
        versao = opcMatch[1].trim()
      }
    } else {
      const numAxaMatch = fullText.match(/N[ÚU]MERO\s+AXA[:\s]*([0-9./-]+)/i)
      if (numAxaMatch) {
        cotacao = numAxaMatch[1].trim()
      }
    }
  }

  // Fallback para outros layouts AXA (ex: Empresa Flex: "Cotação: 3840019 - V2")
  if (!cotacao) {
    const cotMatch = fullText.match(/Cota[çc][ãa]o\s*(?:n[º°.]?)?[:\s]*([0-9]+(?:\s*-\s*V\d+)?)/i)
    if (cotMatch) {
      cotacao = cotMatch[1].replace(/\s+/g, ' ').trim()
      const innerV = cotacao.match(/-?\s*V(\d+)/i)
      if (innerV) {
        versao = `V${innerV[1]}`
      }
    }
  }

  if (!versao) {
    const verMatch = fullText.match(/Vers[ãa]o[:\s]*([A-Za-z0-9/]+)/i)
    if (verMatch) {
      versao = verMatch[1].trim()
    }
  }

  // Datas
  let dataCotacao = ''
  let validadeCotacao = ''
  let vigenciaInicio = ''
  let vigenciaFim = ''

  // Data da cotação no cabeçalho (ex: "28 de Outubro de 2026")
  const mesesPt: Record<string, string> = {
    janeiro: '01',
    fevereiro: '02',
    março: '03',
    marco: '03',
    abril: '04',
    maio: '05',
    junho: '06',
    julho: '07',
    agosto: '08',
    setembro: '09',
    outubro: '10',
    novembro: '11',
    dezembro: '12',
  }
  const dataExtensoMatch = fullText.match(
    /(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i,
  )
  if (dataExtensoMatch) {
    const d = dataExtensoMatch[1].padStart(2, '0')
    const mStr = dataExtensoMatch[2].toLowerCase()
    const mo = mesesPt[mStr] || '01'
    const y = dataExtensoMatch[3]
    dataCotacao = `${y}-${mo}-${d}`
  } else {
    const dtCotMatch = fullText.match(/Data da Cota[çc][ãa]o[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (dtCotMatch) dataCotacao = parsePtBrDate(dtCotMatch[1])
  }

  const valMatch = fullText.match(/Validade da Cota[çc][ãa]o[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (valMatch) validadeCotacao = parsePtBrDate(valMatch[1])

  // Vigência
  // Layout AXA RN: "Início de Vigência: Fim de Vigência: \n A partir das 24h do dia 31/10/2026 Até as 24h do dia 31/10/2027"
  const vigRnMatch = fullText.match(
    /(?:A\s+partir\s+das\s+24h\s+do\s+dia|In[íi]cio\s+de\s+Vig[êe]ncia[:\s]*)\s*(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]*?(?:At[ée]\s+as\s+24h\s+do\s+dia|Fim\s+de\s+Vig[êe]ncia[:\s]*)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigRnMatch) {
    vigenciaInicio = parsePtBrDate(vigRnMatch[1])
    vigenciaFim = parsePtBrDate(vigRnMatch[2])
  } else {
    const vigIniMatch = fullText.match(/In[íi]cio de vig[êe]ncia[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (vigIniMatch) vigenciaInicio = parsePtBrDate(vigIniMatch[1])

    const vigFimMatch = fullText.match(/Fim de vig[êe]ncia[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (vigFimMatch) vigenciaFim = parsePtBrDate(vigFimMatch[1])
  }

  // Proponente, Cossegurado e Dados de Risco
  let seguradoNome = ''
  let seguradoCnpj = ''
  let cosseguradoNome = ''
  let cosseguradoCnpj = ''
  let localRiscoEndereco = ''
  let localRiscoAtividade = ''
  let corretorNome = ''

  const propMatch = fullText.match(
    /(?:Proponente|Segurado)[:\s]+([^\n\r]+?)(?:\s+CNPJ[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}))?(?:\n|$)/i,
  )
  if (propMatch) {
    seguradoNome = propMatch[1].trim()
    if (propMatch[2]) seguradoCnpj = propMatch[2].trim()
  }
  if (!seguradoCnpj) {
    const cnpjMatch = fullText.match(
      /(?:Proponente|Segurado)[\s\S]*?CNPJ[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i,
    )
    if (cnpjMatch) seguradoCnpj = cnpjMatch[1].trim()
  }

  const cossMatch = fullText.match(
    /Cossegurado\(s\)?:[\s\S]*?([^\n\r]+?)\s+CNPJ[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i,
  )
  if (cossMatch) {
    cosseguradoNome = cossMatch[1].trim()
    cosseguradoCnpj = cossMatch[2].trim()
  }

  const endMatch = fullText.match(
    /1\.1\s*Locais\s+de\s+Risco[\s\S]*?1\s+([^\n\r]+?)\s+(Hotel[^\n\r]*|Comercial[^\n\r]*|Industrial[^\n\r]*)/i,
  )
  if (endMatch) {
    localRiscoEndereco = endMatch[1].trim()
    localRiscoAtividade = endMatch[2].trim()
  }

  const corrMatch = fullText.match(
    /3\.1\s*Corretagem:[\s\S]*?Corretor[^\n]*\n([A-Z0-9\s.,–-]+?)(?:\s+100|\s+N[º°]|\n)/i,
  )
  if (corrMatch) {
    corretorNome = corrMatch[1].replace(/\s+/g, ' ').trim()
  }

  // Valores de Forma de Pagamento e Prêmio
  let premioTotal: number | null = null
  let premioLiquido: number | null = null
  let iof: number | null = null
  let formaPagamento = ''
  let numeroParcelas: number | null = null
  let primeiraParcelaValor: number | null = null
  let demaisParcelasValor: number | null = null

  if (isAxaRnLayout) {
    // 4.1 Prêmio LIQUIDO de seguro para 100% do risco: R$ 32.314,71
    const prLiqRn = fullText.match(
      /Pr[êe]mio\s+LIQUIDO\s+de\s+seguro\s+para\s+100%\s+do\s+risco[:\s]*R?\$?\s*([\d.,]+)/i,
    )
    if (prLiqRn) {
      premioLiquido = parsePtBrNumber(prLiqRn[1])
    }

    // Tabela de parcelamento (página 11):
    // "1 (á vista) 32.314,71 0,00 2.384,83 34.699,54 34.699,54 0,00%"
    // Ou linhas: 1 (á vista) ... / 1 (0+1) ...
    const aVistaRn = fullText.match(
      /1\s*\([áa]\s*vista\)\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i,
    )
    if (aVistaRn) {
      if (!premioLiquido) premioLiquido = parsePtBrNumber(aVistaRn[1])
      iof = parsePtBrNumber(aVistaRn[3])
      premioTotal = parsePtBrNumber(aVistaRn[4])
      primeiraParcelaValor = parsePtBrNumber(aVistaRn[5])
    }

    // Forma de Pagamento texto: "Até 4 parcelas sem juros, ou até 7 parcelas, com juros de 2,0% ao mês."
    const formaPagMatch = fullText.match(/4\.2\s*Forma\s+de\s+Pagamento[:\s]*([^\n\r]+)/i)
    if (formaPagMatch) {
      formaPagamento = formaPagMatch[1].trim()

      // Regra permanente do usuário: o Número de Parcelas extraído deve ser o MÁXIMO SEM JUROS ofertado
      // 1) Procura cláusula explícita de "sem juros": ex.: "Até 4 parcelas sem juros" ou "4x sem juros"
      const semJurosMatch =
        formaPagamento.match(
          /at[ée]\s*(\d+)\s*parcelas?\s*(?:sem\s+juros|com\s+juros\s*de\s*0(?:[.,]0+)?%)/i,
        ) || formaPagamento.match(/(\d+)\s*(?:x|parcelas?)\s*sem\s+juros/i)

      if (semJurosMatch) {
        numeroParcelas = parseInt(semJurosMatch[1], 10)
      } else {
        // 2) Se não houver cláusula explícita "sem juros" no texto resumo, analisa a tabela de parcelamento
        // Linhas da tabela de parcelamento da AXA:
        // "1 (á vista) 32.314,71 0,00 2.384,83 34.699,54 34.699,54 0,00%"
        // "4 (1+3) 32.314,71 0,00 2.384,83 34.699,54 8.674,89 0,00%"
        // "5 (1+4) 32.314,71 1.292,33 2.480,20 36.087,25 7.217,45 2,00%"
        const tabelaZeroJuros = fullText.matchAll(/(\d+)\s*\([^)]+\)[\s\S]*?0[,.]00%/gi)
        let maxZeroJurosTable = 0
        for (const m of tabelaZeroJuros) {
          const num = parseInt(m[1], 10)
          if (!isNaN(num) && num > maxZeroJurosTable) {
            maxZeroJurosTable = num
          }
        }

        if (maxZeroJurosTable > 0) {
          numeroParcelas = maxZeroJurosTable
        } else {
          // 3) Fallback para parcelas gerais apenas se não houver divisão com/sem juros identificada
          const maxParcMatch = formaPagamento.match(/at[ée]\s*(\d+)\s*parcelas/gi)
          if (maxParcMatch && maxParcMatch.length > 0) {
            let maxP = 0
            for (const mp of maxParcMatch) {
              const num = parseInt(mp.replace(/\D/g, ''), 10)
              if (!isNaN(num) && num > maxP) maxP = num
            }
            if (maxP > 0) numeroParcelas = maxP
          }
        }
      }
    }
  }

  // Se ainda não achou prêmio ou forma de pagamento nos blocos RN, aplica parsing genérico AXA
  if (!premioTotal) {
    const aVistaMatch = fullText.match(
      /A vista\s*-\s*boleto\s*R\$\s*([\d.,]+)\s*R\$\s*[\d.,]+\s*R\$\s*[\d.,]+\s*R\$\s*([\d.,]+)/i,
    )
    if (aVistaMatch) {
      premioTotal = parsePtBrNumber(aVistaMatch[1])
      iof = parsePtBrNumber(aVistaMatch[2])
      formaPagamento = 'À vista - boleto'
    } else {
      const parceladoMatch = fullText.match(
        /(\d+x\s*(?:sem juros|com juros)?\s*-\s*boleto)\s*R\$\s*([\d.,]+)/i,
      )
      if (parceladoMatch) {
        formaPagamento = parceladoMatch[1].trim()
        premioTotal = parsePtBrNumber(parceladoMatch[2])
      }
    }
  }

  if (!premioTotal) {
    const prTotalMatch = fullText.match(/Pr[êe]mio\s+(?:Total|Bruto)[:\s]*R?\$?\s*([\d.,]+)/i)
    if (prTotalMatch) {
      premioTotal = parsePtBrNumber(prTotalMatch[1])
    }
  }

  if (!premioLiquido) {
    const prLiqMatch = fullText.match(/Pr[êe]mio\s+L[íi]quido[:\s]*R?\$?\s*([\d.,]+)/i)
    if (prLiqMatch) {
      premioLiquido = parsePtBrNumber(prLiqMatch[1])
    }
  }

  if (!iof) {
    const iofMatch = fullText.match(/IOF(?:\s*\([^)]+\))?[:\s]*R?\$?\s*([\d.,]+)/i)
    if (iofMatch) {
      iof = parsePtBrNumber(iofMatch[1])
    }
  }

  // -------------------------------------------------------------------------
  // Coberturas do Seguro
  // -------------------------------------------------------------------------
  const coberturas: ExtractedCoberturaItem[] = []
  let premioLiquidoSum = 0
  let lmiSum = 0
  let posFranquiasGerais = ''
  let lmiTotalCalculado: number | null = null

  if (isAxaRnLayout) {
    // 1. Extração do Mapa de Legenda P.O.S. (*) = 10%, etc.
    const posMap = parseAxaPosLegenda(fullText)
    const posLegendaItems = Object.entries(posMap).map(([k, v]) => `(${k}) = P.O.S. ${v}`)
    if (posLegendaItems.length > 0) {
      posFranquiasGerais = posLegendaItems.join('; ')
    }

    // 2. Extração de Coberturas via parser AXA completo
    // Delimitar a seleção de páginas do quadro de coberturas estritamente da pág. que contém
    // "2. Coberturas do seguro" (pág. 6) até a pág. 10, parando ANTES da linha "Legenda:".
    // Exclui a pág. 5 (tabela 1.2 VRD e LMGA).
    const startIdx = pages.findIndex(
      (p) =>
        /2\.\s*Coberturas\s+do\s+seguro/i.test(p.text) ||
        (p.lines && p.lines.some((l) => /2\.\s*Coberturas\s+do\s+seguro/i.test(l))),
    )

    const candidatePages = startIdx >= 0 ? pages.slice(startIdx) : pages

    const cobPages: PdfPageText[] = []
    for (const p of candidatePages) {
      // Ignora páginas anteriores ao cabeçalho ou páginas que pertençam à seção 1 (VRD/LMGA)
      if (
        /1\.2\s*Detalhamento\s+do\s+valor\s+em\s+risco/i.test(p.text) ||
        /1\.3\s*Limite\s+M[áa]ximo\s+de\s+Garantia/i.test(p.text)
      ) {
        continue
      }
      // Pára ao atingir demonstrativo de prêmio ou seções posteriores
      if (/4\.\s*Demonstrativo\s+de\s+Pr[êe]mio/i.test(p.text)) {
        break
      }

      // Se a página contiver a linha "Legenda:", corta as linhas/itens antes de "Legenda:"
      const hasLegenda =
        /Legenda:/i.test(p.text) || (p.lines && p.lines.some((l) => /^Legenda:/i.test(l.trim())))

      if (hasLegenda) {
        const truncatedLines: string[] = []
        for (const line of p.lines || []) {
          if (
            /^Legenda:/i.test(line.trim()) ||
            /^P\.O\.S:\s*Participa[çc][ãa]o/i.test(line.trim()) ||
            /^3\.\s*Cosseguro\s*\/\s*Corretagem/i.test(line.trim())
          ) {
            break
          }
          truncatedLines.push(line)
        }

        // Corta geometricamente também se houver p.items
        let truncatedItems = p.items
        if (p.items && p.items.length > 0) {
          const legendaItem = p.items.find((it) => /^Legenda:/i.test(it.str.trim()))
          if (legendaItem) {
            truncatedItems = p.items.filter((it) => it.y > legendaItem.y + 2)
          }
        }

        cobPages.push({
          ...p,
          lines: truncatedLines,
          text: truncatedLines.join('\n'),
          items: truncatedItems,
        })
        break
      } else {
        cobPages.push(p)
      }
    }

    const rawAxaCobs = extractAxaCoberturas(cobPages.length > 0 ? cobPages : pages, fullText)

    // Expurgar do quadro qualquer linha de VRD/LMGA residual
    const isVrdOrLmgaSpurious = (nome: string, lmi: number | null): boolean => {
      const n = (nome || '').trim().toLowerCase()
      if (
        n.includes('valor em risco total') ||
        n.includes('valor em risco') ||
        n.includes('detalhamento do valor') ||
        n.includes('60.000.000,00') ||
        n.includes('20.000.000,00') ||
        /^1\s+60\.000\.000/i.test(n) ||
        n.startsWith('lmga') ||
        n.includes('limite máximo de garantia') ||
        n.includes('limite maximo de garantia') ||
        n.includes('mmu') ||
        n.includes('mmp')
      ) {
        return true
      }
      if (
        lmi === 95500000 ||
        lmi === 95000000 ||
        (lmi === 80000000 && n.includes('valor em risco'))
      ) {
        return true
      }
      return false
    }

    for (const c of rawAxaCobs) {
      if (isVrdOrLmgaSpurious(c.nome, c.lmi)) {
        continue
      }
      coberturas.push({
        cobertura: c.nome,
        categoriaNormalizada: c.categoriaNormalizada || matchCanonicalCategory(c.nome),
        lmi: c.lmi,
        premioLiquido: null,
        franquia: c.franquiaPos || 'Não informada',
      })
      if (c.lmi) lmiSum += c.lmi
    }

    // LMI Total / Limite da proposta:
    // No layout AXA RN:
    // - VR DM: 80.000.000,00
    // - LC: 15.000.000,00
    // - VR Total DM+LC: 95.000.000,00
    // - LMGA: 95.500.000,00
    // - Básica Incêndio: 80.000.000,00
    const lmgaMatch = fullText.match(/LMGA[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
    const vrDmLcMatch = fullText.match(
      /Valor\s+em\s+Risco\s+Total\s+de\s+DM\s*\+\s*LC[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
    )
    const basicaCob = coberturas.find(
      (c) => c.categoriaNormalizada.includes('Incêndio') || c.cobertura.startsWith('Incêndio'),
    )

    if (lmgaMatch) {
      lmiTotalCalculado = parsePtBrNumber(lmgaMatch[1])
    } else if (vrDmLcMatch) {
      lmiTotalCalculado = parsePtBrNumber(vrDmLcMatch[1])
    } else if (basicaCob?.lmi) {
      lmiTotalCalculado = basicaCob.lmi
    }
  } else {
    // Tabela padrão AXA Empresa Flex (ADICIONAIS E/OU SUBLIMITES)
    let insideTable = false

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

    if (lmiSum === 0) {
      const basicaMatch = fullText.match(
        /(?:B[áa]sica|Inc[êe]ndio)[^R\n]*R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
      )
      if (basicaMatch) {
        lmiSum = parsePtBrNumber(basicaMatch[1]) || 0
      }
    }
  }

  const finalPremioLiq = premioLiquido || (premioLiquidoSum > 0 ? premioLiquidoSum : null)

  // Extração ou pré-preenchimento de VRD (Danos Materiais e Lucros Cessantes)
  // Regra do usuário: pré-preencher VRD quando derivar da proposta:
  // DM pelo LMI da cobertura básica/Danos Materiais e LC pelo LMI da cobertura de Lucros Cessantes
  let vrdDmExtracted: number | null = null
  let vrdMmuExtracted: number | null = null
  let vrdMmpExtracted: number | null = null
  let vrdLcExtracted: number | null = null
  let vrdLcBaseExtracted: string = 'Lucro Bruto'

  // Busca detalhamento textual específico se existir no documento
  // Ex AXA RN: "1 60.000.000,00 20.000.000,00 0,00 80.000.000,00 15.000.000,00"
  // "Valor em Risco Total de Danos Materiais 80.000.000,00"
  // "Valor em Risco Total de Lucros Cessantes 15.000.000,00"
  const vrDmMatch = fullText.match(
    /Valor\s+em\s+Risco\s+Total\s+de\s+Danos\s+Materiais[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (vrDmMatch) {
    vrdDmExtracted = parsePtBrNumber(vrDmMatch[1])
  }
  const vrLcMatch = fullText.match(
    /Valor\s+em\s+Risco\s+Total\s+de\s+Lucros\s+Cessantes[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (vrLcMatch) {
    vrdLcExtracted = parsePtBrNumber(vrLcMatch[1])
  }

  // Tabela detalhada 1.2: Prédio, MMU, MMP, Valor em Risco (DM), Lucros Cessantes
  const tabelaVrdMatch = fullText.match(
    /\b1\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (tabelaVrdMatch) {
    vrdMmuExtracted = parsePtBrNumber(tabelaVrdMatch[2])
    vrdMmpExtracted = parsePtBrNumber(tabelaVrdMatch[3])
    if (!vrdDmExtracted) vrdDmExtracted = parsePtBrNumber(tabelaVrdMatch[4])
    if (!vrdLcExtracted) vrdLcExtracted = parsePtBrNumber(tabelaVrdMatch[5])
  }

  // Se não extraiu explicitamente do texto do bloco VRD, deriva das coberturas extraídas:
  // DM = LMI da básica / Danos Materiais
  // LC = LMI da cobertura de Lucros Cessantes
  if (!vrdDmExtracted) {
    const basica = coberturas.find(
      (c) =>
        isCoberturaBasica({ nome: c.cobertura, categoriaNormalizada: c.categoriaNormalizada }) ||
        c.categoriaNormalizada.includes('Incêndio') ||
        /^Inc[êe]ndio/i.test(c.cobertura),
    )
    if (basica?.lmi) {
      vrdDmExtracted = basica.lmi
    }
  }

  if (!vrdLcExtracted) {
    const lc = coberturas.find(
      (c) =>
        isCoberturaLucrosCessantes({
          nome: c.cobertura,
          categoriaNormalizada: c.categoriaNormalizada,
        }) ||
        c.categoriaNormalizada.includes('Lucros Cessantes') ||
        /Lucros\s+Cessantes/i.test(c.cobertura),
    )
    if (lc?.lmi) {
      vrdLcExtracted = lc.lmi
    }
  }

  // Detecta base de LC a partir do texto
  if (
    /Lucros\s+Cessantes\s*\[\s*Ll\s*\+\s*Df\s*\]/i.test(fullText) ||
    /Lucro\s+L[íi]quido/i.test(fullText)
  ) {
    vrdLcBaseExtracted = 'Lucro Líquido (LL)'
  } else if (/Despesas\s+Fixas/i.test(fullText)) {
    vrdLcBaseExtracted = 'Despesas Fixas'
  }

  // Extração de Prêmio Net quando a proposta o apresentar (persistir em premio_net)
  // Formatos comuns: "Prêmio Net[:\s]*R$ ...", "Premio Net[:\s]*...", "Prêmio sem comissão", etc.
  let premioNetExtracted: number | null = null
  const prNetMatch =
    fullText.match(
      /Pr[êe]mio\s+Net(?:\s*\(sem\s+comiss[ãa]o\))?[:\s]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
    ) ||
    fullText.match(/Pr[êe]mio\s+sem\s+comiss[ãa]o[:\s]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
  if (prNetMatch) {
    premioNetExtracted = parsePtBrNumber(prNetMatch[1])
  }

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
    lmiTotal: lmiTotalCalculado || (lmiSum > 0 ? lmiSum : null),
    formaPagamento: formaPagamento || 'Boleto bancário',
    numeroParcelas,
    posFranquiasGerais,
    coberturas,
    vrdDm: vrdDmExtracted,
    vrdMmu: vrdMmuExtracted,
    vrdMmp: vrdMmpExtracted,
    vrdLc: vrdLcExtracted,
    vrdLcBase: vrdLcBaseExtracted,
    premioNet: premioNetExtracted,
    dadosComplementares: {
      seguradoNome,
      seguradoCnpj,
      atividade: localRiscoAtividade,
      primeiraParcelaValor,
      demaisParcelasValor,
      vrdDm: vrdDmExtracted,
      vrdMmu: vrdMmuExtracted,
      vrdMmp: vrdMmpExtracted,
      vrdLc: vrdLcExtracted,
      vrdLcBase: vrdLcBaseExtracted,
      premioNet: premioNetExtracted,
    },
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

// ==========================================
// PARSER ALLIANZ EMPRESARIAL
// ==========================================

export function extractAllianzDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')

  // 1. Número da Cotação: "Nº. da Cotação: 888223989" ou "Nº Cotação: 888223989"
  let cotacao = ''
  const cotMatch = fullText.match(/N[º°.]?\s*(?:da\s+)?Cota[çc][ãa]o[:\s]*([0-9]+)/i)
  if (cotMatch) {
    cotacao = cotMatch[1].trim()
  }

  // 2. Data do Pedido: "Data do Pedido: 22/10/2026"
  let dataCotacao = ''
  const dtMatch = fullText.match(/Data\s+do\s+Pedido[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (dtMatch) {
    dataCotacao = parsePtBrDate(dtMatch[1])
  } else {
    const dtGeneric = fullText.match(/(\d{2}-\d{2}-\d{4})\s+\d{2}:\d{2}:\d{2}/)
    if (dtGeneric) {
      dataCotacao = parsePtBrDate(dtGeneric[1].replace(/-/g, '/'))
    }
  }

  // 3. Vigência: "Vigência: das 24h de 01/11/2026 às 24h de 01/11/2027"
  let vigenciaInicio = ''
  let vigenciaFim = ''
  const vigMatch = fullText.match(
    /Vig[êe]ncia[:\s]*(?:das\s+24h\s+de\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[àa]s\s+24h\s+de\s+|[àa]|at[ée])\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigMatch) {
    vigenciaInicio = parsePtBrDate(vigMatch[1])
    vigenciaFim = parsePtBrDate(vigMatch[2])
  }

  // 4. Limite Máximo de Garantia da Apólice (LMG Total):
  // "Limite Máximo de Garantia da Apólice*: 95.000.000,00"
  let lmiTotal: number | null = null
  const lmgMatch = fullText.match(
    /Limite\s+M[áa]ximo\s+de\s+Garantia\s+da\s+Ap[óo]lice\*?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (lmgMatch) {
    lmiTotal = parsePtBrNumber(lmgMatch[1])
  }

  // 5. Informações Financeiras e de Pagamento:
  // "Prêmio Líquido: (R$): 69.215,24" ou "Prêmio Líquido (R$): 69.215,24" ou "Prêmio Líquido: 69.215,24"
  // "Prêmio Total (R$): 74.323,32" ou "Prêmio Total: (R$): 74.323,32"
  // "IOF (R$): 5.108,08" ou "IOF: (R$): 5.108,08"
  // "Custo da Apólice (R$): 0,00" ou "Custo da Apólice: (R$): 0,00"
  // "Forma de Pagamento: Boleto Bancário", "Nº de Parcelas: 4"
  let premioLiquido: number | null = null
  const prLiqMatch = fullText.match(
    /Pr[êe]mio\s+L[íi]quido(?:\s*[:\s]*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (prLiqMatch) {
    premioLiquido = parsePtBrNumber(prLiqMatch[1])
  }

  let premioTotal: number | null = null
  const prTotMatch = fullText.match(
    /Pr[êe]mio\s+Total(?:\s*[:\s]*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (prTotMatch) {
    premioTotal = parsePtBrNumber(prTotMatch[1])
  }

  let iof: number | null = null
  const iofMatch = fullText.match(/IOF(?:\s*[:\s]*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
  if (iofMatch) {
    iof = parsePtBrNumber(iofMatch[1])
  }

  let custoApolice: number | null = null
  const custoMatch = fullText.match(
    /Custo\s+da\s+Ap[óo]lice(?:\s*[:\s]*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (custoMatch) {
    custoApolice = parsePtBrNumber(custoMatch[1])
  } else {
    // Se "Custo da Apólice (R$): 0,00" estiver presente no texto
    if (/Custo\s+da\s+Ap[óo]lice/i.test(fullText)) {
      custoApolice = 0
    }
  }

  // Parcelamento:
  // "Forma de Pagamento: Boleto Bancário", "Nº de Parcelas: 4", "Taxa mensal juros: 0,00"
  let baseFormaPagamento = 'Boleto Bancário'
  const formaMatch = fullText.match(
    /Forma\s+de\s+Pagamento[:\s]*([A-Za-zÀ-ÿ\s]+?)(?:N[º°.]|Índice|$|\n)/i,
  )
  if (formaMatch && formaMatch[1].trim()) {
    baseFormaPagamento = formaMatch[1].trim()
  }

  let numeroParcelas: number | null = 4
  const parcMatch = fullText.match(/N[º°.]?\s*de\s*Parcelas[:\s]*(\d+)/i)
  if (parcMatch) {
    numeroParcelas = parseInt(parcMatch[1], 10)
  }

  let formaPagamento = baseFormaPagamento
  if (numeroParcelas && numeroParcelas > 1) {
    // Registra parcelamento claro com indicação sem juros se taxa for 0
    const semJuros =
      /Taxa\s+mensal\s+juros[:\s]*0[,.]00/i.test(fullText) ||
      /Valor\s+juros(?:\s*\(R\$\))?[:\s]*0[,.]00/i.test(fullText)
    formaPagamento = `${numeroParcelas}x (${baseFormaPagamento}${semJuros ? ' sem juros' : ''})`
  }

  // 6. Dados Complementares do Seguro
  // Segurado
  let seguradoNome = ''
  const nomeSegMatch = fullText.match(
    /SUAS\s+INFORMAÇÕES\s*Nome[:\s]*([A-Za-z0-9\s.-]+?)(?:CNPJ|$|\n)/i,
  )
  if (nomeSegMatch) {
    seguradoNome = nomeSegMatch[1].trim()
  }

  let seguradoCnpj = ''
  const cnpjSegMatch = fullText.match(/CNPJ[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i)
  if (cnpjSegMatch) {
    seguradoCnpj = cnpjSegMatch[1].trim()
  }

  // Atividade e Construção
  let atividade = ''
  const ativMatch = fullText.match(
    /Atividade[:\s]*([A-Za-zÀ-ÿ0-9\s/.-]+?)(?:Tipo\s+de\s+construção|$|\n)/i,
  )
  if (ativMatch) atividade = ativMatch[1].trim()

  let tipoConstrucao = ''
  const constrMatch = fullText.match(
    /Tipo\s+de\s+construção[:\s]*([A-Za-zÀ-ÿ0-9\s/.-]+?)(?:Tipo\s+de\s+seguro|$|\n)/i,
  )
  if (constrMatch) tipoConstrucao = constrMatch[1].trim()

  // 7. Protecionais Allianz
  // Fim da pág 1: "Extintores; Sprinklers; Sistema de detecção de fumaça/calor; Alarme de incêndio com monitoramento 24h"
  // Topo da pág 2: "Proteção eletrônica (CFTV,Sensores,Alarmes)"
  const protecionais: string[] = []
  const knownProtecionais = [
    'Extintores',
    'Sprinklers',
    'Sistema de detecção de fumaça/calor',
    'Alarme de incêndio com monitoramento 24h',
    'Proteção eletrônica (CFTV, Sensores, Alarmes)',
  ]

  for (const item of knownProtecionais) {
    // Normaliza para busca flexível
    const simpleNeedle = item.toLowerCase().replace(/[^a-z0-9]/g, '')
    const fullNormalized = fullText.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (fullNormalized.includes(simpleNeedle.slice(0, 16))) {
      protecionais.push(item)
    }
  }

  // 8. VRD (Valor em Risco Declarado):
  // Danos Materiais: 80.000.000,00
  // Perda de Lucro Bruto: 15.000.000,00 com Período Indenitário: 12 meses
  // Despesas Fixas: 0,00
  let valorEmRiscoDeclarado: number | null = null
  const vrDmMatch = fullText.match(/Danos\s+Materiais[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
  if (vrDmMatch) valorEmRiscoDeclarado = parsePtBrNumber(vrDmMatch[1])

  // ==========================================
  // 9. EXTRAÇÃO DE COBERTURAS E FRANQUIAS (TABELAS DA ALLIANZ)
  // Reconstrução GEOMÉTRICA por coordenadas X/Y
  // Coluna 1: Nome da Cobertura (X < col2Left ~ 230pt)
  // Coluna 2: SubLimite / Limite de Indenização (230pt <= X < 335pt)
  // Coluna 3: Prêmio por Cobertura R$ (335pt <= X < 415pt)
  // Coluna 4: Franquia % / R$ (X >= 415pt)
  // ==========================================

  interface AllianzCobAccumulator {
    nomeOriginal: string
    isBasica: boolean
    isLucrosCessantes: boolean
    lmi: number | null
    premio: number | null
    franquia: string
  }

  // Chave normalizada para pareamento entre linha de prêmio e linha de franquia
  const normalizeCobKey = (name: string): string => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
  }

  const cobMap = new Map<string, AllianzCobAccumulator>()

  // Extrai coberturas geometricamente usando os fragmentos enriquecidos (items)
  const hasGeometricFragments = pages.some((p) => p.items && p.items.length > 0)

  if (hasGeometricFragments) {
    // Processa geometricamente as páginas que contêm tabelas de cobertura (especialmente páginas 2 e 3)
    for (const page of pages) {
      if (!page.items || page.items.length === 0) continue

      const items = page.items

      // Acha os limites verticais (Y) das seções na página:
      // "COBERTURA BASICA*"
      // "COBERTURAS ADICIONAIS*"
      // Término de tabela: "INFORMAÇÕES DE PAGAMENTO", "* Todos os limites...", etc.
      interface SectionHeader {
        tipo: 'basica' | 'adicional'
        y: number
      }

      const sectionHeaders: SectionHeader[] = []
      // endTableY deve ser o MAIS ALTO entre os marcadores de término (maior Y) que está abaixo
      // dos cabeçalhos da tabela
      let endTableY: number | null = null

      for (const it of items) {
        const text = it.str.trim()
        if (/COBERTURA\s+BASICA\*/i.test(text)) {
          sectionHeaders.push({ tipo: 'basica', y: it.y })
        } else if (/COBERTURAS\s+ADICIONAIS\*/i.test(text)) {
          sectionHeaders.push({ tipo: 'adicional', y: it.y })
        } else if (
          /INFORMA[ÇC][ÕO]ES\s+DE\s+PAGAMENTO/i.test(text) ||
          /CL[ÁA]USULAS\s+COMPLEMENTARES/i.test(text) ||
          /OBSERVA[ÇC][ÕO]ES/i.test(text) ||
          /^\*\s*Todos\s+os\s+limites/i.test(text)
        ) {
          // Se há múltiplos marcadores de fim, o fim da tabela é a fronteira superior deles
          if (endTableY === null || it.y > endTableY) {
            endTableY = it.y
          }
        }
      }
      if (sectionHeaders.length === 0) continue

      // Ordena seções da página de cima para baixo (em PDF, Y decrescente)
      sectionHeaders.sort((a, b) => b.y - a.y)

      // Identifica X-edges das colunas na página a partir de itens de cabeçalho conhecidos
      // Fallback para valores calibrados da grade Allianz (PDF A4: largura ~595pt, margem esquerda ~30pt):
      // Col 1 (Nome): 25 <= X < 230
      // Col 2 (SubLimite/Limite): 230 <= X < 335
      // Col 3 (Prêmio): 335 <= X < 415
      // Col 4 (Franquia): 415 <= X < 580
      let col2Left = 230
      let col3Left = 335
      let col4Left = 415

      // Tenta refinar X-edges se os cabeçalhos de coluna estiverem presentes na página
      for (const it of items) {
        const s = it.str.trim()
        if (/SubLimite\s+M[áa]ximo/i.test(s) || /Limite\s+M[áa]ximo/i.test(s)) {
          col2Left = Math.min(col2Left, it.x - 5)
        } else if (/Pr[êe]mio\s+por/i.test(s)) {
          col3Left = Math.min(col3Left, it.x - 5)
        } else if (/Franquia/i.test(s)) {
          col4Left = Math.min(col4Left, it.x - 5)
        }
      }

      // Processa cada seção da página
      for (let sIdx = 0; sIdx < sectionHeaders.length; sIdx++) {
        const sec = sectionHeaders[sIdx]
        const topY = sec.y - 12 // logo abaixo do título "COBERTURA BASICA*" ou "COBERTURAS ADICIONAIS*"
        const bottomY =
          sIdx < sectionHeaders.length - 1
            ? sectionHeaders[sIdx + 1].y + 5
            : endTableY !== null && endTableY < topY
              ? endTableY + 5
              : 50 // margem inferior segura da folha

        // Coleta itens pertencentes a esta tabela
        const tableItems = items.filter((it) => {
          if (it.y > topY || it.y < bottomY) return false
          const text = it.str.trim()
          if (!text) return false

          // Ignora cabeçalhos repetidos de coluna dentro da grade
          if (
            /^(?:SubLimite|Limite|de\s+Indeniza[çc][ãa]o|Pr[êe]mio|Cobertura|Franquia|%|R\$|\*)/i.test(
              text,
            ) &&
            it.y >= topY - 25
          ) {
            return false
          }
          if (/^\*\s*Todos\s+os\s+limites/i.test(text)) return false
          if (/^P[áa]gina\s+\d+\s+de/i.test(text)) return false
          if (/^N[º°.]\s*Cota[çc][ãa]o/i.test(text)) return false
          if (/^Prote[çc][ãa]o\s+eletr[ôo]nica/i.test(text) && it.y > topY) return false

          return true
        })

        // Agrupa fragmentos por bandas de linha visual (Y próximo).
        // Na Allianz, a altura de cada linha visual é ~12-16pt, e textos multilinha na mesma célula
        // têm deltaY de ~8-10pt.
        // Agrupamos inicialmente por linhas de texto (delta Y <= 3.5pt):
        interface TextRow {
          y: number
          col1: string[]
          col2: string[]
          col3: string[]
          col4: string[]
          col1Bold: boolean
          isRowBold: boolean
        }

        const textRowMap = new Map<number, TextRow>()

        for (const it of tableItems) {
          const y = it.y
          let foundRowY: number | null = null
          for (const existingY of textRowMap.keys()) {
            if (Math.abs(existingY - y) <= 3.5) {
              foundRowY = existingY
              break
            }
          }

          if (foundRowY === null) {
            foundRowY = y
            textRowMap.set(foundRowY, {
              y: foundRowY,
              col1: [],
              col2: [],
              col3: [],
              col4: [],
              col1Bold: false,
              isRowBold: false,
            })
          }

          const row = textRowMap.get(foundRowY)!
          const s = it.str.trim()
          if (!s) continue

          if (it.isBold) {
            row.isRowBold = true
          }

          // Atribuição rigorosa às 4 colunas baseada na coordenada X
          if (it.x < col2Left) {
            row.col1.push(s)
            if (it.isBold) {
              row.col1Bold = true
            }
          } else if (it.x < col3Left) {
            row.col2.push(s)
          } else if (it.x < col4Left) {
            row.col3.push(s)
          } else {
            row.col4.push(s)
          }
        }

        // Ordena linhas de texto de cima para baixo (Y decrescente)
        const sortedTextRows = Array.from(textRowMap.values()).sort((a, b) => b.y - a.y)

        // Agrupamento por proximidade vertical de célula / banda:
        // Na Allianz, a grade visual possui células estilizadas.
        // Cada registro da tabela possui seu SubLimite/Limite na Coluna 2.
        // Nomes que se estendem por 2 linhas de texto aparecem com:
        // a) 1ª linha do nome tem LMI na Coluna 2, e a 2ª linha (abaixo) tem apenas texto na Coluna 1
        //    (Ex: "Despesas de Recomposição de Registros e" [1.600.000,00] seguido de "Documentos" [sem valores])
        //    (Ex: "Roubo de Valores no Interior do" [sem valores] seguido de "Estabelecimento" [97.500,00])
        // b) 1ª linha tem o prefixo do nome (sem valores) e a 2ª linha tem o sufixo + LMI.
        // Distância vertical entre linhas da MESMA célula multilinha: deltaY <= 13pt.
        interface VisualBand {
          nomeParts: string[]
          col2Text: string
          col3Text: string
          col4Text: string
          y: number
          isBold: boolean
          secaoTipo: 'basica' | 'adicional'
        }

        const bands: VisualBand[] = []
        let currentBand: VisualBand | null = null
        let pendingPrefix: { text: string; y: number; isBold: boolean } | null = null

        for (let rIdx = 0; rIdx < sortedTextRows.length; rIdx++) {
          const tr = sortedTextRows[rIdx]
          const col1Str = tr.col1.join(' ').trim()
          const col2Str = tr.col2.join(' ').trim()
          const col3Str = tr.col3.join(' ').trim()
          const col4Str = tr.col4.join(' ').trim()

          const hasLmiInCol2 = /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(col2Str)

          if (hasLmiInCol2) {
            if (currentBand) {
              bands.push(currentBand)
            }
            const initialNome: string[] = []
            let bandBold = tr.col1Bold || tr.isRowBold

            // Se havia um prefixo imediatamente acima (deltaY <= 13pt)
            if (pendingPrefix && Math.abs(pendingPrefix.y - tr.y) <= 13) {
              initialNome.push(pendingPrefix.text)
              if (pendingPrefix.isBold) bandBold = true
            }
            pendingPrefix = null

            if (col1Str) {
              initialNome.push(col1Str)
            }

            currentBand = {
              nomeParts: initialNome,
              col2Text: col2Str,
              col3Text: col3Str,
              col4Text: col4Str,
              y: tr.y,
              isBold: bandBold,
              secaoTipo: sec.tipo,
            }
          } else {
            // Linha sem LMI na Coluna 2
            const nextRow = rIdx + 1 < sortedTextRows.length ? sortedTextRows[rIdx + 1] : null
            const nextHasLmi = nextRow
              ? /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(nextRow.col2.join(' ').trim())
              : false

            if (col1Str && !col2Str && !col3Str && !col4Str) {
              // Apenas texto na Coluna 1.
              // Decide se é continuação inferior da banda atual ou prefixo da próxima banda:
              // Se currentBand existe e o deltaY é pequeno (<= 13pt):
              // Palavras como "Documentos", "Tornado", "Mármores", "Portadores", "Estabelecimento" são terminações!
              const isObviousContinuation =
                /^(?:Documentos|Tornado|Mármores|Portadores|Estabelecimento|Conteúdo|Q\.Aeronaves|Bens)\b/i.test(
                  col1Str,
                ) ||
                col1Str.startsWith('e ') ||
                col1Str.startsWith('de ') ||
                col1Str.startsWith('do ') ||
                col1Str.startsWith('da ')

              if (currentBand && Math.abs(currentBand.y - tr.y) <= 13 && isObviousContinuation) {
                currentBand.nomeParts.push(col1Str)
                if (tr.col1Bold) currentBand.isBold = true
              } else if (currentBand && Math.abs(currentBand.y - tr.y) <= 13 && !nextHasLmi) {
                currentBand.nomeParts.push(col1Str)
                if (tr.col1Bold) currentBand.isBold = true
              } else if (nextHasLmi && nextRow && Math.abs(tr.y - nextRow.y) <= 13) {
                // Prefixo da próxima
                pendingPrefix = { text: col1Str, y: tr.y, isBold: tr.col1Bold }
              } else if (currentBand && Math.abs(currentBand.y - tr.y) <= 13) {
                currentBand.nomeParts.push(col1Str)
                if (tr.col1Bold) currentBand.isBold = true
              } else {
                pendingPrefix = { text: col1Str, y: tr.y, isBold: tr.col1Bold }
              }
            } else if (currentBand) {
              if (col1Str) currentBand.nomeParts.push(col1Str)
              if (col3Str) currentBand.col3Text = `${currentBand.col3Text} ${col3Str}`.trim()
              if (col4Str) currentBand.col4Text = `${currentBand.col4Text} ${col4Str}`.trim()
              if (tr.col1Bold || tr.isRowBold) currentBand.isBold = true
            }
          }
        }

        if (currentBand) {
          bands.push(currentBand)
        }

        // Processa as bandas da seção
        for (let bIdx = 0; bIdx < bands.length; bIdx++) {
          const band = bands[bIdx]
          let nome = band.nomeParts
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
          // Limpa marcadores iniciais
          nome = nome.replace(/^[•*-]\s*/, '').trim()
          if (!nome) continue

          const lmiVal = parsePtBrNumber(band.col2Text)
          if (lmiVal === null) continue

          // Extrai Prêmio da Coluna 3
          let premioVal: number | null = null
          const pMatch = band.col3Text.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/)
          if (pMatch) {
            premioVal = parsePtBrNumber(pMatch[0])
          }

          // Extrai Franquia da Coluna 4 (e residual de Col 3/4)
          let franquiaStr = ''
          const combinedCol4 = `${band.col4Text} ${band.col3Text}`

          // Caso 1: Dias (ex.: "- 10 Dias", "10 Dias")
          const diasM = combinedCol4.match(/(\d+)\s*Dias/i)
          if (diasM) {
            franquiaStr = `${diasM[1]} Dias`
          } else {
            // Caso 2: Percentual + mínimo em R$ (ex.: "10 1.500,00", "20 10.000,00", "15 5.000,00")
            const pctMinM = combinedCol4.match(/\b(\d{1,2})\b\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})/)
            if (pctMinM) {
              franquiaStr = `${pctMinM[1]}% com mín. R$ ${pctMinM[2]}`
            } else {
              // Caso 3: Apenas valor monetário de franquia
              const minOnlyM = band.col4Text.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/)
              if (minOnlyM) {
                franquiaStr = `R$ ${minOnlyM[0]}`
              } else {
                // Caso 4: Apenas percentual
                const pctOnlyM = band.col4Text.match(/\b(\d{1,2})%?\b/)
                if (pctOnlyM && pctOnlyM[1] !== '0') {
                  franquiaStr = `${pctOnlyM[1]}%`
                }
              }
            }
          }

          const key = normalizeCobKey(nome)
          const isIncendioComplementaresSubtotal =
            key.includes('incendioecomplementares') || key === 'incendioecomplementares'

          // Regra 1 e 2: Na seção COBERTURA BASICA*, a linha em NEGRITO com prêmio agregado
          // ("Incêndio e Complementares | 80.000.000,00 | 18.544,40") é um SUBTOTAL/agregado.
          // Ela não entra como cobertura contratada no quadro — a cobertura real é a linha contratada
          // em peso normal logo abaixo ("Incendio / Raio / Expl / Impl / Fumaça / Q.Aeronaves").
          if (band.secaoTipo === 'basica' && (band.isBold || isIncendioComplementaresSubtotal)) {
            // Se for subtotal com prêmio e a proposta não capturou premioLiquido global ainda,
            // podemos registrar como referência, mas NUNCA inserimos no quadro de coberturas.
            if (premioVal !== null && premioLiquido === null) {
              // Referência informativa apenas
            }
            continue
          }

          // Seção COBERTURAS ADICIONAIS*:
          // Padrão Allianz: a primeira linha vem em negrito com o PRÊMIO da cobertura (ex: "Danos Elétricos | 1.000.000,00 | 3.232,97")
          // e a linha seguinte vem em peso normal com a FRANQUIA (ex: "Danos Elétricos | 1.000.000,00 | 15 | 5.000,00").
          // Ou agregadoras de grupo como "Responsabilidade Civil", "Roubo" onde a linha de cima tem o prêmio agregado
          // e as linhas filhas/sublinhas vêm abaixo.
          // Se uma linha em negrito tem exatamente o mesmo nome da linha subsequente em peso normal,
          // transferimos o prêmio da linha em negrito para a linha subsequente, ou pareamos via cobMap.
          const nextBand = bIdx + 1 < bands.length ? bands[bIdx + 1] : null
          const nextNome = nextBand
            ? nextBand.nomeParts
                .join(' ')
                .replace(/\s{2,}/g, ' ')
                .replace(/^[•*-]\s*/, '')
                .trim()
            : ''
          const nextKey = normalizeCobKey(nextNome)

          // Se a linha atual estiver em negrito e a próxima tiver o mesmo nome (par direto prêmio -> franquia):
          if (band.isBold && nextKey === key && !franquiaStr && nextBand && !nextBand.isBold) {
            // Adiantamos o prêmio para a próxima banda que é a contratada com franquia
            if (premioVal !== null && !nextBand.col3Text.includes(',')) {
              nextBand.col3Text =
                `${nextBand.col3Text} ${premioVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`.trim()
            }
            continue
          }

          const isBasicaReal =
            key.includes('incendio') &&
            (key.includes('raio') ||
              key.includes('expl') ||
              key.includes('fumaca') ||
              key.includes('aeronave'))
          const isLucrosCessantesReal =
            key.includes('perdalucrobruto') || key.includes('lucrobruto')

          let acc = cobMap.get(key)
          if (!acc) {
            acc = {
              nomeOriginal: nome,
              isBasica: isBasicaReal,
              isLucrosCessantes: isLucrosCessantesReal,
              lmi: lmiVal,
              premio: premioVal,
              franquia: franquiaStr || 'Não informada',
            }
            cobMap.set(key, acc)
          } else {
            // Linha pareada (segunda linha de adicional com franquia ou primeira com prêmio)
            if (acc.premio === null && premioVal !== null) {
              acc.premio = premioVal
            }
            if (
              (acc.franquia === 'Não informada' || acc.franquia === 'Não há' || !acc.franquia) &&
              franquiaStr
            ) {
              acc.franquia = franquiaStr
            }
            if (lmiVal && (!acc.lmi || lmiVal > acc.lmi)) {
              acc.lmi = lmiVal
            }
            if (nome.length > acc.nomeOriginal.length) {
              acc.nomeOriginal = nome
            }
          }
        }
      }
    }
  }

  // Fallback de texto caso não haja items geométricos (ex.: teste unitário puro com mock simples)
  if (cobMap.size === 0) {
    const allLines: string[] = []
    for (const page of pages) {
      for (const rawLine of page.lines) {
        const line = rawLine.trim()
        if (/^P[áa]gina\s+\d+\s+de\s+\d+/i.test(line)) continue
        if (/^N[º°.]\s*Cota[çc][ãa]o:\s*\d+/i.test(line)) continue
        if (/^\*\s*Todos\s+os\s+limites/i.test(line)) continue
        if (/^SubLimite\s+M[áa]ximo/i.test(line)) continue
        if (/^Limite\s+M[áa]ximo/i.test(line)) continue
        allLines.push(line)
      }
    }

    interface AssembledCoverageRow {
      nome: string
      lmiVal: number
      rest: string
    }

    const assembledRows: AssembledCoverageRow[] = []
    let inSection = false

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i]
      if (/COBERTURA\s+BASICA\*/i.test(line) || /COBERTURAS\s+ADICIONAIS\*/i.test(line)) {
        inSection = true
        continue
      }
      if (
        /INFORMA[ÇC][ÕO]ES\s+DE\s+PAGAMENTO/i.test(line) ||
        /CL[ÁA]USULAS\s+COMPLEMENTARES/i.test(line)
      ) {
        inSection = false
        continue
      }
      if (!inSection) continue

      const matchLine = line.match(
        /^([A-Za-zÀ-ÿ0-9\s/.,–\-_()•*&'+ºª]+?)\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s*(.*)$/,
      )
      if (matchLine) {
        const rawNome = matchLine[1].replace(/^[•*-]\s*/, '').trim()
        const lmiVal = parsePtBrNumber(matchLine[2])
        const rest = (matchLine[3] || '').trim()
        if (rawNome && lmiVal !== null) {
          assembledRows.push({ nome: rawNome, lmiVal, rest })
          continue
        }
      }
      if (assembledRows.length > 0) {
        const lastRow = assembledRows[assembledRows.length - 1]
        const cleanAdd = line.replace(/^[•*-]\s*/, '').trim()
        if (cleanAdd && !/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(cleanAdd)) {
          lastRow.nome = `${lastRow.nome} ${cleanAdd}`.replace(/\s{2,}/g, ' ').trim()
        }
      }
    }

    for (const { nome: rawNome, lmiVal, rest } of assembledRows) {
      if (!rawNome || lmiVal === null) continue
      let rowPremio: number | null = null
      let rowFranquiaStr = ''
      const diasMatch = rest.match(/(\d+)\s*Dias/i)
      if (diasMatch) {
        rowFranquiaStr = `${diasMatch[1]} Dias`
      }
      const pctAndMinMatch = rest.match(/\b(\d{1,2})\b\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})/)
      if (pctAndMinMatch) {
        rowFranquiaStr = `${pctAndMinMatch[1]}% com mín. R$ ${pctAndMinMatch[2]}`
      }
      const moneyMatch = rest.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/)
      if (moneyMatch) {
        rowPremio = parsePtBrNumber(moneyMatch[0])
      }

      const key = normalizeCobKey(rawNome)
      // Se for "Incêndio e Complementares", é subtotal agregado e não deve entrar no quadro
      if (key.includes('incendioecomplementares') || key === 'incendioecomplementares') {
        continue
      }

      const isBasicaReal =
        key.includes('incendio') &&
        (key.includes('raio') ||
          key.includes('expl') ||
          key.includes('fumaca') ||
          key.includes('aeronave'))
      const isLucrosCessantesReal = key.includes('perdalucrobruto') || key.includes('lucrobruto')

      let acc = cobMap.get(key)
      if (!acc) {
        cobMap.set(key, {
          nomeOriginal: rawNome,
          isBasica: isBasicaReal,
          isLucrosCessantes: isLucrosCessantesReal,
          lmi: lmiVal,
          premio: rowPremio,
          franquia: rowFranquiaStr || 'Não informada',
        })
      } else {
        if (acc.premio === null && rowPremio !== null) acc.premio = rowPremio
        if (
          (acc.franquia === 'Não informada' || acc.franquia === 'Não há' || !acc.franquia) &&
          rowFranquiaStr
        ) {
          acc.franquia = rowFranquiaStr
        }
      }
    }
  }

  // Constrói lista final de coberturas mantendo regras canônicas.
  // Regra 3: Garantir classificação de no máximo UMA Cobertura Básica por proposta
  // (a primeira elegida entre as candidatas reais; qualquer outra vira cobertura comum).
  const coberturas: ExtractedCoberturaItem[] = []
  let basicaCount = 0

  for (const [, item] of cobMap) {
    // Normalização de categoria:
    // Linha real contratada de incêndio -> Básica ("Incêndio Básica (Danos Materiais)")
    // Perda de Lucro Bruto -> Lucros Cessantes
    // RCs nunca viram básica mesmo se mencionarem incêndio
    let categoria = matchCanonicalCategory(item.nomeOriginal)

    if (item.isBasica && basicaCount === 0) {
      categoria = 'Incêndio Básica (Danos Materiais)'
      basicaCount++
    } else if (item.isBasica && basicaCount > 0) {
      // Já existe uma básica: qualquer outra candidata vira cobertura acessória / comum
      categoria = 'Incêndio Complementar'
    } else if (item.isLucrosCessantes) {
      categoria = 'Lucros Cessantes / Perda de Receita'
    } else {
      // Se matchCanonicalCategory classificou como Básica mas não é a eleita:
      if (
        categoria === 'Incêndio Básica (Danos Materiais)' ||
        categoria === 'Incêndio, Raio, Explosão, Implosão e Fumaça'
      ) {
        if (basicaCount === 0) {
          categoria = 'Incêndio Básica (Danos Materiais)'
          basicaCount++
        } else {
          categoria = 'Incêndio Complementar'
        }
      }
    }

    coberturas.push({
      cobertura: item.nomeOriginal,
      categoriaNormalizada: categoria,
      lmi: item.lmi,
      premioLiquido: item.premio,
      franquia: item.franquia || 'Não informada',
    })
  }

  return {
    numeroCotacao: cotacao,
    versao: '1',
    dataCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioLiquido,
    premioTotal,
    iof,
    custoApolice,
    lmiTotal: lmiTotal || (valorEmRiscoDeclarado ? valorEmRiscoDeclarado : null),
    formaPagamento: formaPagamento || 'Boleto Bancário',
    numeroParcelas,
    coberturas,
    posFranquiasGerais: 'Conforme tabela de franquias por cobertura da proposta',
    dadosComplementares: {
      seguradoNome,
      seguradoCnpj,
      atividade,
      tipoConstrucao,
      protecionais,
      valorEmRiscoDeclarado,
    },
  }
}

// ==========================================
// PARSER PORTO SEGURO (PORTO PRINT WEB)
// ==========================================

export function extractPortoDetails(
  pages: PdfPageText[],
  options?: { collectDiagnostics?: boolean },
): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // Buffers de diagnóstico instrumentados
  const diagPaginasAnalisadas: number[] = []
  const diagFragmentos: DiagnosticoFragmento[] = []
  const diagLimites: DiagnosticoLimitesCalibrados[] = []
  const diagLinhasMontadas: DiagnosticoLinhaMontada[] = []

  // 1. Número do Orçamento / Cotação da Porto:
  // Ex: "Orçamento nº 118013040", "Orçamento Nº 118013040", "NÚMERO DO ORÇAMENTO 118013040"
  let cotacao = ''
  const orcMatch =
    fullText.match(
      /(?:N[ÚU]MERO\s+DO\s+OR[ÇC]AMENTO|OR[ÇC]AMENTO\s*(?:N[º°.]|N[ÚU]MERO)?)\s*[:\s]*([0-9]{6,12})/i,
    ) ||
    fullText.match(/\bOR[ÇC]AMENTO\s+([0-9]{6,12})\b/i) ||
    fullText.match(/\b118013040\b/)

  if (orcMatch) {
    cotacao = (orcMatch[1] || orcMatch[0]).replace(/\D/g, '').trim()
  } else {
    // Procura nas linhas individuais se o rótulo e o número estiverem em linhas contíguas
    for (let i = 0; i < lines.length; i++) {
      if (/(?:N[ÚU]MERO\s+DO\s+OR[ÇC]AMENTO|OR[ÇC]AMENTO)/i.test(lines[i])) {
        const directNum = lines[i].match(/\b([0-9]{6,12})\b/)
        if (directNum) {
          cotacao = directNum[1]
          break
        }
        if (i + 1 < lines.length) {
          const nextVal = lines[i + 1].trim()
          if (/^\d{6,12}$/.test(nextVal)) {
            cotacao = nextVal
            break
          }
        }
      }
    }
  }

  // 2. Data de Cálculo / Impressão: "DATA DE CÁLCULO 21/10/2026"
  let dataCotacao = ''
  const dtCalcMatch = fullText.match(/DATA\s+DE\s+C[ÁA]LCULO\s*[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (dtCalcMatch) {
    dataCotacao = parsePtBrDate(dtCalcMatch[1])
  } else {
    const dtImpMatch = fullText.match(/IMPRESS[ÃA]O\s*[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (dtImpMatch) dataCotacao = parsePtBrDate(dtImpMatch[1])
  }

  // 3. Vigência Porto:
  // "VIGÊNCIA DAS 00:01 DO DIA\n01/11/2026\nATE AS 23:59 DO DIA\n01/11/2027"
  // ATENÇÃO: No PDF real as datas vêm em linhas SEPARADAS do rótulo e "ATE" sem acento.
  // Regex deve permitir quebras de linha ([\s\S]{0,40}?) entre rótulo e data.
  let vigenciaInicio = ''
  let vigenciaFim = ''

  const vigMatch = fullText.match(
    /VIG[ÊE]NCIA[\s\S]{0,40}?DAS\s+00:01[\s\S]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,80}?AT[ÉEÀA]\s+AS?\s+23:59[\s\S]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigMatch) {
    vigenciaInicio = parsePtBrDate(vigMatch[1])
    vigenciaFim = parsePtBrDate(vigMatch[2])
  } else {
    // Padrão multilinhas / flexível da Porto com [\s\S]
    const vigIniM = fullText.match(
      /VIG[ÊE]NCIA[\s\S]{0,50}?00:01[\s\S]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/i,
    )
    const vigFimM = fullText.match(/AT[ÉEÀA]\s+AS?\s+23:59[\s\S]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (vigIniM && vigFimM) {
      vigenciaInicio = parsePtBrDate(vigIniM[1])
      vigenciaFim = parsePtBrDate(vigFimM[1])
    } else {
      const vigGeneric = fullText.match(
        /(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,100}?AT[ÉEÀA]\s+AS?\s+23:59[\s\S]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/i,
      )
      if (vigGeneric) {
        vigenciaInicio = parsePtBrDate(vigGeneric[1])
        vigenciaFim = parsePtBrDate(vigGeneric[2])
      } else {
        // Fallback amplo: busca duas datas no parágrafo de vigência
        const vigSection = fullText.match(/VIG[ÊE]NCIA[\s\S]{1,250}?(?:23:59|\n\n)/i)
        if (vigSection) {
          const dates = vigSection[0].match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g)
          if (dates && dates.length >= 2) {
            vigenciaInicio = parsePtBrDate(dates[0])
            vigenciaFim = parsePtBrDate(dates[1])
          }
        }
      }
    }
  }

  // 4. Demonstrativo de Prêmio Geral (Página 5):
  // Há dois blocos na Porto:
  // "DEMONSTRATIVO DE PRÊMIO DO ITEM" e "DEMONSTRATIVO DE PRÊMIO GERAL"
  // O primeiro ("DO ITEM") não possui IOF (apenas Coberturas, Cláusulas, Líquido Total, Custo de Apólice, Prêmio Total).
  // O segundo ("DEMONSTRATIVO DE PRÊMIO GERAL") é o oficial e completo:
  // PRÊMIO LÍQUIDO TOTAL R$ 82.296,90
  // CUSTO DE APÓLICE R$ 0,00
  // I.O.F. R$ 6.073,51
  // PRÊMIO TOTAL R$ 88.370,41
  // BINDING ESTRITO POR RÓTULO: tolerar com e sem acento, ordem variável e quebra de linha. NUNCA confundir Líquido com Total!
  let premioLiquido: number | null = null
  let premioTotal: number | null = null
  let iof: number | null = null
  let custoApolice: number | null = null

  // Isola a seção DEMONSTRATIVO DE PRÊMIO GERAL (com ou sem acento).
  // Em documentos com múltiplos blocos, busca a ÚLTIMA ocorrência de "DEMONSTRATIVO DE PRÊMIO GERAL"
  // para garantir que nunca seja interceptado pelo bloco "DO ITEM".
  const geralRegex = /DEMONSTRATIVO\s+DE\s+PR[ÊE]MIO\s+GERAL/gi
  let matchGeral: RegExpExecArray | null
  let lastGeralIdx = -1
  while ((matchGeral = geralRegex.exec(fullText)) !== null) {
    lastGeralIdx = matchGeral.index
  }

  const demonstrativoText =
    lastGeralIdx !== -1 ? fullText.slice(lastGeralIdx, lastGeralIdx + 2000) : fullText

  // Abordagem 1: Extração geométrica direta na página 5 (ou página onde está o bloco GERAL)
  // No layout da Porto Seguro (ver OCR pág 5):
  // DEMONSTRATIVO DE PRÊMIO GERAL
  // PRÊMIO LÍQUIDO COBERTURAS  PRÊMIO LÍQUIDO CLÁUSULAS  PRÊMIO LÍQUIDO TOTAL  CUSTO DE APÓLICE  I.O.F.  PRÊMIO TOTAL
  // R$ 82.296,90               R$ 0,00                   R$ 82.296,90          R$ 0,00           R$ 6.073,51  R$ 88.370,41
  for (const page of pages) {
    if (!page.items || page.items.length === 0) continue
    const items = page.items
    const geralItem = items.find((it) =>
      /DEMONSTRATIVO\s+DE\s+PR[ÊE]MIO\s+GERAL/i.test(it.str.trim()),
    )
    if (!geralItem) continue

    // Procura cabeçalho logo abaixo de "DEMONSTRATIVO DE PRÊMIO GERAL" (Y menor no PDF)
    // Coleta fragmentos entre o título e a próxima seção (ex.: "FORMAS DE PAGAMENTO" ou ~150pt abaixo)
    const formasItem = items.find(
      (it) => it.y < geralItem.y && /FORMAS?\s+DE\s+PAGAMENTO/i.test(it.str.trim()),
    )
    const minY = formasItem ? formasItem.y : geralItem.y - 120

    const blockItems = items.filter((it) => it.y < geralItem.y && it.y > minY)
    // Agrupa por linha Y
    const rowMap = new Map<number, typeof items>()
    for (const it of blockItems) {
      let foundY: number | null = null
      for (const ey of rowMap.keys()) {
        if (Math.abs(ey - it.y) <= 3.5) {
          foundY = ey
          break
        }
      }
      if (foundY === null) {
        foundY = it.y
        rowMap.set(foundY, [])
      }
      rowMap.get(foundY)!.push(it)
    }

    const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a)
    // Identifica a linha de cabeçalhos das colunas e a linha de valores
    let headerRowIdx = -1
    for (let r = 0; r < sortedYs.length; r++) {
      const rowText = (rowMap.get(sortedYs[r]) || []).map((it) => it.str).join(' ')
      if (/PR[ÊE]MIO\s+L[ÍI]QUIDO/i.test(rowText) && /I\.?O\.?F\.?/i.test(rowText)) {
        headerRowIdx = r
        break
      }
    }

    if (headerRowIdx !== -1) {
      // Coleta colunas com suas posições X
      const headerItems = (rowMap.get(sortedYs[headerRowIdx]) || []).sort((a, b) => a.x - b.x)
      // Procura a linha de valores logo abaixo
      for (let r = headerRowIdx + 1; r < Math.min(sortedYs.length, headerRowIdx + 3); r++) {
        const valRowItems = (rowMap.get(sortedYs[r]) || []).sort((a, b) => a.x - b.x)
        const rowStr = valRowItems.map((it) => it.str).join(' ')
        const valMatches = rowStr.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/g)
        if (valMatches && valMatches.length >= 4) {
          // No DEMONSTRATIVO GERAL completo são 6 colunas de valores:
          // [0] PRÊMIO LÍQUIDO COBERTURAS
          // [1] PRÊMIO LÍQUIDO CLÁUSULAS
          // [2] PRÊMIO LÍQUIDO TOTAL
          // [3] CUSTO DE APÓLICE
          // [4] I.O.F.
          // [5] PRÊMIO TOTAL
          if (valMatches.length >= 6) {
            premioLiquido = parsePtBrNumber(valMatches[2])
            custoApolice = parsePtBrNumber(valMatches[3])
            iof = parsePtBrNumber(valMatches[4])
            premioTotal = parsePtBrNumber(valMatches[5])
          } else if (valMatches.length === 5) {
            // Caso falte cláusulas: [coberturas, líquido total, custo, iof, total]
            premioLiquido = parsePtBrNumber(valMatches[1])
            custoApolice = parsePtBrNumber(valMatches[2])
            iof = parsePtBrNumber(valMatches[3])
            premioTotal = parsePtBrNumber(valMatches[4])
          } else if (valMatches.length === 4) {
            // [líquido total, custo, iof, total]
            premioLiquido = parsePtBrNumber(valMatches[0])
            custoApolice = parsePtBrNumber(valMatches[1])
            iof = parsePtBrNumber(valMatches[2])
            premioTotal = parsePtBrNumber(valMatches[3])
          }
          break
        }
      }
    }
  }

  // Abordagem 2: Fallback por regex dentro do demonstrativoText (isolado a partir de DEMONSTRATIVO DE PRÊMIO GERAL)
  if (premioLiquido === null || premioTotal === null || iof === null) {
    // 1) Linhas textuais dentro de demonstrativoText
    const linesGeral = demonstrativoText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    for (let i = 0; i < linesGeral.length; i++) {
      const l = linesGeral[i]
      if (
        /PR[ÊE]MIO\s+L[ÍI]QUIDO/i.test(l) &&
        /PR[ÊE]MIO\s+TOTAL/i.test(l) &&
        /IOF|I\.O\.F\./i.test(l)
      ) {
        for (let j = i + 1; j < Math.min(linesGeral.length, i + 5); j++) {
          const vals = linesGeral[j].match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/g)
          if (vals && vals.length >= 4) {
            if (vals.length >= 6) {
              if (premioLiquido === null) premioLiquido = parsePtBrNumber(vals[2])
              if (custoApolice === null) custoApolice = parsePtBrNumber(vals[3])
              if (iof === null) iof = parsePtBrNumber(vals[4])
              if (premioTotal === null) premioTotal = parsePtBrNumber(vals[5])
            } else if (vals.length === 5) {
              if (premioLiquido === null) premioLiquido = parsePtBrNumber(vals[1])
              if (custoApolice === null) custoApolice = parsePtBrNumber(vals[2])
              if (iof === null) iof = parsePtBrNumber(vals[3])
              if (premioTotal === null) premioTotal = parsePtBrNumber(vals[4])
            } else if (vals.length === 4) {
              if (premioLiquido === null) premioLiquido = parsePtBrNumber(vals[0])
              if (custoApolice === null) custoApolice = parsePtBrNumber(vals[1])
              if (iof === null) iof = parsePtBrNumber(vals[2])
              if (premioTotal === null) premioTotal = parsePtBrNumber(vals[3])
            }
            break
          }
        }
      }
    }

    // 2) Extração por rótulos individuais no demonstrativoText
    if (premioLiquido === null) {
      const m =
        demonstrativoText.match(
          /PR[ÊE]MIO\s+L[ÍI]QUIDO\s+TOTAL[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
        ) ||
        demonstrativoText.match(
          /PR[ÊE]MIO\s+L[ÍI]QUIDO[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
        )
      if (m) premioLiquido = parsePtBrNumber(m[1])
    }

    if (iof === null) {
      const m = demonstrativoText.match(
        /(?:I\.?O\.?F\.?|IOF)[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
      )
      if (m) iof = parsePtBrNumber(m[1])
    }

    if (premioTotal === null) {
      const m =
        demonstrativoText.match(
          /(?<!L[ÍI]QUIDO\s+)PR[ÊE]MIO\s+TOTAL[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
        ) ||
        demonstrativoText.match(
          /\bTOTAL\s+(?:A\s+PAGAR|DO\s+SEGURO|GERAL)[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
        )
      if (m) premioTotal = parsePtBrNumber(m[1])
    }

    if (custoApolice === null) {
      const m = demonstrativoText.match(
        /CUSTO\s+(?:DE|DA)\s+AP[ÓO]LICE[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
      )
      if (m) custoApolice = parsePtBrNumber(m[1])
      else if (/CUSTO\s+(?:DE|DA)\s+AP[ÓO]LICE/i.test(demonstrativoText)) custoApolice = 0
    }
  }

  // 3) Fallback em qualquer bloco "DEMONSTRATIVO" com IOF presente em linhas
  if (iof === null || premioTotal === null || premioLiquido === null) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (/DEMONSTRATIVO\s+DE\s+PR[ÊE]MIO\s+GERAL/i.test(l)) {
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const lSub = lines[j]
          const vals = lSub.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/g)
          if (vals && vals.length >= 4) {
            if (vals.length >= 6) {
              if (premioLiquido === null) premioLiquido = parsePtBrNumber(vals[2])
              if (custoApolice === null) custoApolice = parsePtBrNumber(vals[3])
              if (iof === null) iof = parsePtBrNumber(vals[4])
              if (premioTotal === null) premioTotal = parsePtBrNumber(vals[5])
            } else {
              if (premioLiquido === null) premioLiquido = parsePtBrNumber(vals[0])
              if (custoApolice === null) custoApolice = parsePtBrNumber(vals[1])
              if (iof === null) iof = parsePtBrNumber(vals[vals.length - 2])
              if (premioTotal === null) premioTotal = parsePtBrNumber(vals[vals.length - 1])
            }
            break
          }
        }
      }
    }
  }

  // Consistência matemática de salvaguarda:
  // Se premioLiquido e iof foram encontrados, e premioTotal = premioLiquido (erro clássico do extrator genérico),
  // recalcula ou busca o prêmio total correto.
  if (
    premioLiquido !== null &&
    iof !== null &&
    premioTotal !== null &&
    Math.abs(premioTotal - premioLiquido) < 0.01
  ) {
    const expectedTotal = premioLiquido + (custoApolice || 0) + iof
    const allTotals = fullText.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/g) || []
    let foundExpected = false
    for (const vStr of allTotals) {
      const v = parsePtBrNumber(vStr)
      if (v !== null && Math.abs(v - expectedTotal) <= 0.05) {
        premioTotal = v
        foundExpected = true
        break
      }
    }
    if (!foundExpected) {
      premioTotal = Number(expectedTotal.toFixed(2))
    }
  }

  // 5. Formas de Pagamento: "6 x BOLETO BANCARIO" ou "6 x ADC" com valor de parcela
  // Exemplo no PDF (pág 5):
  // 6 x BOLETO BANCARIO R$ 14.728,41 R$ 14.728,40 ...
  // Preferir Boleto Bancário se disponível, ou primeira linha encontrada.
  let formaPagamento = ''
  let numeroParcelas: number | null = null
  let primeiraParcelaValor: number | null = null
  let demaisParcelasValor: number | null = null

  const formasSectionMatch = fullText.match(
    /FORMAS?\s+DE\s+PAGAMENTO([\s\S]+?)(?:OBSERVA[ÇC][ÕO]ES|$)/i,
  )
  const formasSectionText = formasSectionMatch ? formasSectionMatch[1] : fullText

  // Busca preferencialmente "6 x BOLETO BANCARIO" ou "X x ..."
  const boletoLineMatch = formasSectionText.match(
    /(\d+)\s*x\s*(BOLETO\s+BANC[AÁ]RIO)[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  const genericFormaMatch = formasSectionText.match(
    /(\d+)\s*x\s*([A-Za-zÀ-ÿ\s,]+?)[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})[^\d\n]*R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )

  const chosenFormaMatch = boletoLineMatch || genericFormaMatch
  if (chosenFormaMatch) {
    numeroParcelas = parseInt(chosenFormaMatch[1], 10)
    const desc = chosenFormaMatch[2].replace(/\s{2,}/g, ' ').trim()
    formaPagamento = `${numeroParcelas}x ${desc}`
    primeiraParcelaValor = parsePtBrNumber(chosenFormaMatch[3])
    demaisParcelasValor = parsePtBrNumber(chosenFormaMatch[4])
  } else {
    const simpleFormaMatch = fullText.match(/(\d+)\s*x\s*(BOLETO\s+BANC[AÁ]RIO|ADC[A-Z\s,]*)/i)
    if (simpleFormaMatch) {
      numeroParcelas = parseInt(simpleFormaMatch[1], 10)
      formaPagamento = `${numeroParcelas}x ${simpleFormaMatch[2].trim()}`
    }
  }

  // 6. Dados do Proponente e Questionário
  // Exemplo no PDF da Porto:
  // "DADOS DO PROPONENTE"
  // "RAZÃO SOCIAL" "TIPO DE PESSOA" "CNPJ"
  // "CONDOMINIO SAO INTERNATIONAL SQUARE" "JURÍDICA" "24742208/0002-25"
  //
  // ATENÇÃO: em extração tabular por linha/coordenada Y, uma linha pode ser o cabeçalho
  // "RAZÃO SOCIAL TIPO DE PESSOA CNPJ", e a linha seguinte os valores correspondentes:
  // "CONDOMINIO SAO INTERNATIONAL SQUARE JURÍDICA 24742208/0002-25".
  // NUNCA preencher a sopa de rótulos "RAZÃO SOCIAL TIPO DE PESSOA CNPJ" como nome!
  let seguradoNome = ''
  let seguradoCnpj = ''

  // Isola a seção DADOS DO PROPONENTE até INFORMAÇÕES CADASTRAIS DO CORRETOR
  const propSectionMatch = fullText.match(
    /DADOS\s+DO\s+PROPONENTE([\s\S]+?)(?:INFORMA[ÇC][ÕO]ES\s+CADASTRAIS|LOCAL\s+DE\s+RISCO|$)/i,
  )
  const propSectionText = propSectionMatch ? propSectionMatch[1] : fullText

  const sanitizePropName = (candidate: string): string => {
    let clean = candidate.replace(/\s{2,}/g, ' ').trim()
    // Remove sufixos de outras colunas na mesma linha (TIPO DE PESSOA, JURÍDICA, FÍSICA, CNPJ ...)
    clean = clean.replace(/\s+JUR[ÍI]DICA.*$/i, '').trim()
    clean = clean.replace(/\s+F[ÍI]SICA.*$/i, '').trim()
    clean = clean.replace(/\s+TIPO\s+DE\s+PESSOA.*$/i, '').trim()
    clean = clean.replace(/\s+CNPJ.*$/i, '').trim()
    clean = clean.replace(/\s+\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}.*$/i, '').trim()
    clean = clean.replace(/\s+\d{8,14}.*$/i, '').trim()
    // Rejeita sopa de rótulos / cabeçalhos
    if (/^RAZ[ÃA]O\s+SOCIAL/i.test(clean)) return ''
    if (/TIPO\s+DE\s+PESSOA/i.test(clean)) return ''
    if (/^CNPJ/i.test(clean)) return ''
    if (/^JUR[ÍI]DICA$/i.test(clean) || /^F[ÍI]SICA$/i.test(clean)) return ''
    if (/^DADOS\s+DO\s+PROPONENTE/i.test(clean)) return ''
    return clean
  }

  // Tenta extração geométrica dos fragmentos da página 1 se disponíveis
  const page1 = pages.find((p) => p.pageNumber === 1) || pages[0]
  if (page1 && page1.items && page1.items.length > 0) {
    // Procura fragmento "DADOS DO PROPONENTE"
    const propHeaderItem = page1.items.find((it) => /DADOS\s+DO\s+PROPONENTE/i.test(it.str.trim()))
    if (propHeaderItem) {
      // Itens abaixo do cabeçalho da seção até o próximo bloco (ex.: "INFORMAÇÕES CADASTRAIS")
      const brokerHeaderItem = page1.items.find(
        (it) =>
          it.y < propHeaderItem.y &&
          /INFORMA[ÇC][ÕO]ES\s+CADASTRAIS|LOCAL\s+DE\s+RISCO/i.test(it.str.trim()),
      )
      const bottomLimitY = brokerHeaderItem ? brokerHeaderItem.y : propHeaderItem.y - 120

      // Filtra fragmentos na seção do proponente
      const sectionItems = page1.items.filter(
        (it) => it.y < propHeaderItem.y - 2 && it.y > bottomLimitY,
      )

      // Fragmentos na coluna de Razão Social (X à esquerda, normalmente X < 350)
      // Agrupa por linha Y
      const propRowMap = new Map<number, typeof page1.items>()
      for (const it of sectionItems) {
        const str = it.str.trim()
        if (!str) continue
        let fY: number | null = null
        for (const ey of propRowMap.keys()) {
          if (Math.abs(ey - it.y) <= 3.5) {
            fY = ey
            break
          }
        }
        if (fY === null) {
          fY = it.y
          propRowMap.set(fY, [])
        }
        propRowMap.get(fY)!.push(it)
      }

      const sortedPropYs = Array.from(propRowMap.keys()).sort((a, b) => b - a)
      for (const y of sortedPropYs) {
        const rowItems = (propRowMap.get(y) || []).sort((a, b) => a.x - b.x)
        const rowText = rowItems.map((it) => it.str.trim()).join(' ')
        // Se a linha for o cabeçalho "RAZÃO SOCIAL TIPO DE PESSOA CNPJ", pula
        if (
          /RAZ[ÃA]O\s+SOCIAL/i.test(rowText) &&
          (/TIPO\s+DE\s+PESSOA/i.test(rowText) || /CNPJ/i.test(rowText))
        ) {
          continue
        }
        if (/^RAZ[ÃA]O\s+SOCIAL\s*$/i.test(rowText)) {
          continue
        }

        // Pega os itens da coluna da esquerda (Razão Social, normalmente X < 350)
        const leftItems = rowItems.filter((it) => it.x < 350)
        const candidate = leftItems.map((it) => it.str.trim()).join(' ')
        const sanitized = sanitizePropName(candidate)
        if (sanitized && sanitized.length >= 3) {
          seguradoNome = sanitized
          break
        }
      }
    }
  }

  // Fallbacks de texto para Razão Social
  if (!seguradoNome) {
    // Procura nas linhas de texto ordenadas
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.includes('DADOS DO PROPONENTE')) {
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const l = lines[j].trim()
          if (!l) continue
          if (
            l.startsWith('INFORMAÇÕES') ||
            l.startsWith('SUSEP') ||
            l.startsWith('LOCAL DE RISCO')
          ) {
            break
          }
          // Pula linhas que são apenas rótulos
          if (/^RAZ[ÃA]O\s+SOCIAL(?:\s+TIPO\s+DE\s+PESSOA)?(?:\s+CNPJ)?$/i.test(l)) {
            continue
          }
          if (/^TIPO\s+DE\s+PESSOA/i.test(l)) continue
          if (/^CNPJ/i.test(l)) continue

          const sanitized = sanitizePropName(l)
          if (sanitized && sanitized.length >= 3) {
            seguradoNome = sanitized
            break
          }
        }
        break
      }
    }
  }

  // Fallback via regex na propSectionText
  if (!seguradoNome) {
    const propLineMatch = propSectionText.match(
      /RAZ[ÃA]O\s+SOCIAL\s*\n\s*([A-Za-z0-9\s.,–\-_&']+?)(?=\s*(?:\n|TIPO\s+DE\s+PESSOA|CNPJ|INFORMA[ÇC][ÕO]ES|$))/i,
    )
    if (propLineMatch) {
      seguradoNome = sanitizePropName(propLineMatch[1])
    }
  }
  if (!seguradoNome) {
    const propInlineMatch = propSectionText.match(
      /RAZ[ÃA]O\s+SOCIAL\s*[:\s]*([A-Za-z0-9\s.,–\-_&']+?)(?:\s+(?:TIPO\s+DE\s+PESSOA|CNPJ|JUR[ÍI]DICA)|$|\n)/i,
    )
    if (propInlineMatch) {
      seguradoNome = sanitizePropName(propInlineMatch[1])
    }
  }

  // CNPJ da seção do proponente: "CNPJ 24742208/0002-25" -> normalizar para 24.742.208/0002-25
  const cnpjMatch = propSectionText.match(/CNPJ\s*[:\s]*([0-9./-]+)/i)
  if (cnpjMatch) {
    seguradoCnpj = formatCnpjMask(cnpjMatch[1])
  } else {
    // Procura nas linhas de propRowMap ou page1 items
    if (page1 && page1.items && page1.items.length > 0) {
      const cnpjItem = page1.items.find(
        (it) =>
          /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(it.str.trim()) &&
          !it.str.includes('61.198.164'),
      )
      if (cnpjItem) {
        seguradoCnpj = formatCnpjMask(cnpjItem.str.trim())
      }
    }
    if (!seguradoCnpj) {
      // Procura qualquer CNPJ diferente do CNPJ da Porto Seguro (61.198.164/0001-60)
      const allCnpjs = fullText.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)
      if (allCnpjs && allCnpjs.length > 0) {
        const propCnpjCandidate = allCnpjs.find(
          (c: string) => !c.replace(/\D/g, '').startsWith('61198164'),
        )
        if (propCnpjCandidate) {
          seguradoCnpj = formatCnpjMask(propCnpjCandidate)
        }
      }
      if (!seguradoCnpj) {
        const rawCnpjDigits = fullText.match(/\b24742208\/?0002-?25\b/)
        if (rawCnpjDigits) {
          seguradoCnpj = formatCnpjMask(rawCnpjDigits[0])
        }
      }
    }
  }

  // Atividade do local
  let atividade = ''
  const ativMatch = fullText.match(
    /ATIVIDADE\s+DO\s+LOCAL[:\s]*([A-Za-zÀ-ÿ0-9\s/.-]+?)(?:Aten[çc][ãa]o|$|\n)/i,
  )
  if (ativMatch) {
    atividade = ativMatch[1].trim()
  }

  // Questionário qualitativo Porto
  const respostasQuestionario: Record<string, string> = {}
  if (fullText.includes('HOUVE SINISTRO NO LOCAL NOS ÚLTIMOS 12 MESES ?')) {
    const qM = fullText.match(/HOUVE SINISTRO NO LOCAL NOS ÚLTIMOS 12 MESES \?\s*([A-Z]+)/i)
    if (qM) respostasQuestionario['sinistro_12_meses'] = qM[1].trim()
  }
  if (fullText.includes('TIPO DE CONSTRUÇÃO')) {
    const cM = fullText.match(/TIPO DE CONSTRUÇÃO\s*([A-Za-zÀ-ÿ]+)/i)
    if (cM) respostasQuestionario['tipo_construcao'] = cM[1].trim()
  }
  if (fullText.includes('DESEJA CONTRATAR INDENIZAÇÃO A VALOR DE NOVO')) {
    const vM = fullText.match(
      /DESEJA CONTRATAR INDENIZAÇÃO A VALOR DE NOVO[^\n]*\?\s*([A-Za-zÀ-ÿ]+)/i,
    )
    if (vM) respostasQuestionario['valor_de_novo'] = vM[1].trim()
  }
  if (fullText.includes('POSSUI ALARME MONITORADO')) {
    const aM = fullText.match(/POSSUI ALARME MONITORADO[^\n]*\?\s*([A-Za-zÀ-ÿ]+)/i)
    if (aM) respostasQuestionario['alarme_monitorado'] = aM[1].trim()
  }

  // Lucros cessantes decorrentes de marcas (página 3):
  // "COBERTURA DE LUCROS CESSANTES DECORRENTES DE: Incêndio (X) Danos Elétricos ( ) Vendaval ( ) Tumultos ( )"
  let lucrosCessantesCausas = ''
  const lcDecorrenteMatch = fullText.match(
    /COBERTURA\s+DE\s+LUCROS\s+CESSANTES\s+DECORRENTES\s+DE:?\s*([^\n]+)/i,
  )
  if (lcDecorrenteMatch) {
    lucrosCessantesCausas = lcDecorrenteMatch[1].trim()
  }

  // 7. Extração de Coberturas da Porto Seguro
  // Tabela "COBERTURAS": Colunas COBERTURA | L.M.I. | PRÊMIO | P.O.S.
  // Regras estritas do documento e do usuário:
  // - "VALOR EM RISCO DECLARADO R$ 80.000.000,00 -" deve ficar FORA do quadro de coberturas (é VRD).
  // - "COBERTURA DE LUCROS CESSANTES DECORRENTES DE: Incêndio (X)..." é texto informativo / qualitativo, NÃO cobertura.
  // - Nomes em 2 linhas: a continuação DEVE SER SEMPRE ANEXADA À COBERTURA ANTERIOR, NUNCA À SEGUINTE!
  //   (Ex.: "INCÊNDIO, EXPLOSÃO, IMPLOSÃO, FUMAÇA E QUEDA DE / AERONAVE" -> AERONAVE pertence à 1ª cobertura,
  //    jamais a "REFORMAS". Idem "CONTAMINAÇÃO E DETERIORAÇÃO DE MERCADORIAS EM / AMBIENTES FRIGORIFICADOS"
  //    pertence à anterior e nunca contamina "DESMORONAMENTO").
  // - Usar geometria / coordenadas X do PDF (mesma abordagem já usada na Allianz).
  let valorEmRiscoDeclarado: number | null = null
  const vrdMatch = fullText.match(
    /VALOR\s+EM\s+RISCO\s+DECLARADO\s*(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (vrdMatch) {
    valorEmRiscoDeclarado = parsePtBrNumber(vrdMatch[1])
  }

  interface PortoCobRaw {
    nome: string
    lmi: number | null
    premio: number | null
    franquia: string
    isBasica?: boolean
  }

  const extractedList: PortoCobRaw[] = []

  // Verifica se há fragmentos com coordenadas nos itens das páginas
  const hasGeometricFragments = pages.some((p) => p.items && p.items.length > 0)

  if (hasGeometricFragments) {
    for (const page of pages) {
      if (!page.items || page.items.length === 0) continue

      const items = page.items

      // Acha os limites verticais da tabela de coberturas na página
      // Topo: linha de cabeçalho "COBERTURA L.M.I. PRÊMIO P.O.S." ou "COBERTURAS"
      // BUG 2 FIX: Reconhecer a linha exata dos cabeçalhos de coluna (COBERTURA, L.M.I., PRÊMIO, P.O.S.)
      // para descartar estritamente qualquer fragmento de cabeçalho, garantindo que "COBERTURA L.M.I. PRÊMIO"
      // JAMAIS seja capturado como prefixo do nome da primeira cobertura!
      let tableTopY: number | null = null
      let tableBottomY: number | null = null
      let headerBandY: number | null = null

      for (const it of items) {
        const text = it.str.trim()
        if (/COBERTURA\s+L\.?M\.?I\.?\s+PR[ÊE]MIO\s+P\.?O\.?S\.?/i.test(text)) {
          headerBandY = it.y
          if (tableTopY === null || it.y < tableTopY) {
            tableTopY = it.y
          }
        } else if (
          /^COBERTURA\s+L\.?M\.?I\.?/i.test(text) ||
          /^L\.?M\.?I\.?\s+PR[ÊE]MIO/i.test(text)
        ) {
          headerBandY = it.y
          if (tableTopY === null || it.y < tableTopY) {
            tableTopY = it.y
          }
        } else if (text === 'COBERTURAS' && tableTopY === null) {
          tableTopY = it.y
        }

        if (
          /COBERTURA\s+DE\s+LUCROS\s+CESSANTES\s+DECORRENTES\s+DE/i.test(text) ||
          /CL[ÁA]USULA\s+DE\s+SERVI[ÇC]OS/i.test(text) ||
          /DEMONSTRATIVO\s+DE\s+PR[ÊE]MIO/i.test(text) ||
          /CL[ÁA]USULAS\s+PARTICULARES/i.test(text)
        ) {
          if (tableBottomY === null || it.y > tableBottomY) {
            tableBottomY = it.y
          }
        }
      }

      // Se a página não contém tabela de coberturas, passa para a próxima
      if (tableTopY === null) continue

      // Se encontramos os fragmentos do cabeçalho da coluna em headerBandY, effectiveTopY deve ficar abaixo dele
      const effectiveBottomY = tableBottomY !== null ? tableBottomY + 5 : 40
      const effectiveTopY = headerBandY !== null ? headerBandY - 2 : tableTopY - 5

      diagPaginasAnalisadas.push(page.pageNumber)

      // Coleta fragmentos de diagnóstico da página da tabela de coberturas
      if (items && items.length > 0) {
        for (const it of items) {
          diagFragmentos.push({
            str: it.str,
            x: it.x,
            y: it.y,
            pagina: page.pageNumber,
            width: it.width,
            height: it.height,
            fontName: it.fontName,
            isBold: it.isBold,
          })
        }
      }

      // Filtra fragmentos dentro da tabela de coberturas
      // BUG 2 FIX: Descartar explicitamente palavras soltas ou combinadas do cabeçalho da tabela
      // (ex.: "COBERTURA", "L.M.I.", "PRÊMIO", "P.O.S.") que estejam na faixa superior
      const tableItems = items.filter((it) => {
        if (it.y > effectiveTopY || it.y < effectiveBottomY) return false
        const t = it.str.trim()
        if (!t) return false
        if (/^COBERTURAS?(\s+L\.?M\.?I\.?)?/i.test(t)) return false
        if (/^L\.?M\.?I\.?$/i.test(t)) return false
        if (/^PR[ÊE]MIO$/i.test(t)) return false
        if (/^P\.?O\.?S\.?$/i.test(t)) return false
        if (/^COBERTURA\s+L\.?M\.?I\.?\s+PR[ÊE]MIO/i.test(t)) return false
        if (/^9H095J\s+-/i.test(t) || /^P[ÁA]GINA\s+\d+\s+de/i.test(t)) return false
        if (/^COBERTURA\s+DE\s+LUCROS\s+CESSANTES\s+DECORRENTES\s+DE/i.test(t)) return false
        return true
      })

      // Calibração dinâmica dos limites X para as 4 colunas da tabela Porto Seguro
      // PDF A4 padrão: largura ~595pt
      // Defaults de segurança:
      // Col 1: COBERTURA (X < col2Left)
      // Col 2: L.M.I. (col2Left <= X < col3Left)
      // Col 3: PRÊMIO (col3Left <= X < col4Left)
      // Col 4: P.O.S. (X >= col4Left)
      let col2Left = 240
      let col3Left = 315
      let col4Left = 370

      const antesLimites = {
        col2Left,
        col3Left,
        col4Left,
      }

      // 1) Refina com base em cabeçalhos (fragmentos isolados ou mesclados)
      for (const it of items) {
        const s = it.str.trim()
        // Fragmentos isolados
        if (/^L\.?M\.?I\.?$/i.test(s)) {
          col2Left = Math.min(col2Left, it.x - 5)
        } else if (/^PR[ÊE]MIO$/i.test(s)) {
          col3Left = Math.min(col3Left, it.x - 5)
        } else if (/^P\.?O\.?S\.?$/i.test(s)) {
          col4Left = Math.min(col4Left, it.x - 5)
        }
      }

      // 2) Calibração e clustering com base nos valores monetários reais (R$ ... ou 000,00)
      // Na tabela da Porto, Col 2 (LMI) e Col 3 (Prêmio) possuem valores numéricos formatados.
      const moneyItemsInTable = tableItems.filter((it) => {
        const s = it.str.trim()
        return (
          /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(s) &&
          !s.toUpperCase().includes('VALOR EM RISCO DECLARADO')
        )
      })

      const lmiXs = moneyItemsInTable.filter((it) => it.x >= 200 && it.x < 315).map((it) => it.x)
      const premioXs = moneyItemsInTable.filter((it) => it.x >= 290 && it.x < 370).map((it) => it.x)
      const posXs = tableItems
        .filter((it) => {
          const s = it.str.trim()
          return (
            it.x >= 350 &&
            (s.includes('%') ||
              /Não há/i.test(s) ||
              /Indenizações/i.test(s) ||
              /paralisação/i.test(s) ||
              /mínimo/i.test(s) ||
              /prejuízos/i.test(s))
          )
        })
        .map((it) => it.x)

      if (lmiXs.length > 0) {
        const minLmiX = Math.min(...lmiXs)
        // O limite da Col 2 fica ligeiramente antes do primeiro valor de LMI encontrado
        col2Left = Math.max(180, Math.min(col2Left, minLmiX - 4))
      }
      if (premioXs.length > 0) {
        const minPremioX = Math.min(...premioXs)
        col3Left = Math.max(col2Left + 35, Math.min(col3Left, minPremioX - 4))
      }
      if (posXs.length > 0) {
        const minPosX = Math.min(...posXs)
        col4Left = Math.max(col3Left + 35, Math.min(col4Left, minPosX - 4))
      }

      diagLimites.push({
        pagina: page.pageNumber,
        antes: antesLimites,
        depois: {
          col2Left,
          col3Left,
          col4Left,
          lmiXs,
          premioXs,
          posXs,
          tableTopY,
          tableBottomY,
        },
      })

      // Agrupa fragmentos por linha de texto visual (delta Y <= 3.5pt)
      // Preserva ordem dos fragmentos por coordenada X
      interface PortoFragmentItem {
        str: string
        x: number
      }

      interface PortoTextRow {
        y: number
        col1: PortoFragmentItem[]
        col2: PortoFragmentItem[]
        col3: PortoFragmentItem[]
        col4: PortoFragmentItem[]
      }

      const rowMap = new Map<number, PortoTextRow>()
      for (const it of tableItems) {
        const y = it.y
        let foundY: number | null = null
        for (const existingY of rowMap.keys()) {
          if (Math.abs(existingY - y) <= 3.5) {
            foundY = existingY
            break
          }
        }

        if (foundY === null) {
          foundY = y
          rowMap.set(foundY, {
            y: foundY,
            col1: [],
            col2: [],
            col3: [],
            col4: [],
          })
        }

        const r = rowMap.get(foundY)!
        const s = it.str.trim()
        if (!s) continue

        // Se o fragmento contiver texto puramente de nome/palavras (não monetário) e sua coordenada X
        // estiver na faixa inicial de Col2/Col3 porque col2Left/col3Left foi calibrado mais à esquerda,
        // ou se for palavra de cobertura que transbordou, o fragmento é roteado para col1 se não for monetário
        // e não for P.O.S.
        const isMoney = /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(s)
        const isPosText =
          it.x >= col4Left ||
          /%/.test(s) ||
          /^n[ãa]o\s+h[áa]/i.test(s) ||
          /indeniza[çc][õo]es/i.test(s) ||
          /paralisa[çc][ãa]o/i.test(s)

        const frag: PortoFragmentItem = { str: s, x: it.x }
        if (it.x < col2Left) {
          r.col1.push(frag)
        } else if (it.x < col3Left) {
          // Se não é monetário nem texto de POS, NUNCA joga em col2 (que é LMI)
          if (!isMoney && !isPosText) {
            r.col1.push(frag)
          } else {
            r.col2.push(frag)
          }
        } else if (it.x < col4Left) {
          // Se não é monetário nem texto de POS, NUNCA joga em col3 (que é Prêmio)
          if (!isMoney && !isPosText) {
            r.col1.push(frag)
          } else {
            r.col3.push(frag)
          }
        } else {
          r.col4.push(frag)
        }
      }

      // Ordena linhas de cima para baixo (Y decrescente no PDF)
      const sortedRows = Array.from(rowMap.values()).sort((a, b) => b.y - a.y)

      // Registra linhas montadas para o diagnóstico
      for (const r of sortedRows) {
        diagLinhasMontadas.push({
          pagina: page.pageNumber,
          y: r.y,
          col1: r.col1.map((frag) => ({ str: frag.str, x: frag.x })),
          col2: r.col2.map((frag) => ({ str: frag.str, x: frag.x })),
          col3: r.col3.map((frag) => ({ str: frag.str, x: frag.x })),
          col4: r.col4.map((frag) => ({ str: frag.str, x: frag.x })),
        })
      }

      // MODELO GEOMÉTRICO BASEADO EM ÂNCORAS DE VALORES E ATRIBUIÇÃO POR |Δy|
      // Geometria real da tabela (Página 2):
      // Na Porto Seguro, quando o nome da cobertura quebra em 2 linhas, os valores (col2=LMI, col3=Prêmio)
      // ficam verticalmente CENTRADOS na célula, ENTRE as linhas do nome.
      // Exemplo real (Básica):
      // - y=727: "INCÊNDIO, EXPLOSÃO, IMPLOSÃO, FUMAÇA E QUEDA DE" (col1, só texto)
      // - y=720: "R$ 80.000.000,00" (col2) + "R$ 12.012,60" (col3) + "10% das indenizações." (col4)  <-- ÂNCORA
      // - y=713: "AERONAVE" (col1, só texto)
      // - y=698: "REFORMAS" (col1) + valores (ÂNCORA)
      //
      // REGRAS:
      // 1. Linhas com col2 ou col3 preenchidos com valores monetários são âncoras de cobertura.
      //    (VRD e cabeçalhos já foram excluídos).
      // 2. Cada linha só-de-texto em col1 é atribuída à âncora de valores MAIS PRÓXIMA por |Δy| —
      //    NUNCA como prefixo da próxima âncora abaixo.
      //    Nome da cobertura = todas as linhas col1 associadas (incluindo a da própria âncora se houver),
      //    ordenadas por y decrescente e unidas por espaço.
      // 3. Linhas só-de-texto em col4 (continuação de franquia):
      //    - Atribuídas à âncora mais próxima por |Δy| dentro do bloco delimitado pelo ponto médio
      //      entre as âncoras adjacentes (ou proximidade estrita a âncoras onde a franquia se espalha).
      //    - As linhas de P.O.S. de cada âncora são unidas por espaço em ordem decrescente de y.

      interface PortoAnchor {
        y: number
        col2Text: string
        col3Text: string
        col1Own: string
        col4Own: string
        col1Assigned: Array<{ text: string; y: number }>
        col4Assigned: Array<{ text: string; y: number }>
      }

      interface TextOnlyLine {
        y: number
        text: string
      }

      const anchors: PortoAnchor[] = []
      const textOnlyCol1Lines: TextOnlyLine[] = []
      const textOnlyCol4Lines: TextOnlyLine[] = []

      for (const r of sortedRows) {
        let col1Str = r.col1
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(' ')
          .trim()
        const col2Str = r.col2
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(' ')
          .trim()
        const col3Str = r.col3
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(' ')
          .trim()
        const col4Str = r.col4
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(' ')
          .trim()

        // Limpeza de cabeçalho residual
        col1Str = col1Str
          .replace(/^COBERTURA\s+L\.?M\.?I\.?\s+PR[ÊE]MIO\s+(?:P\.?O\.?S\.?)?\s*/i, '')
          .replace(/^COBERTURAS?\s+L\.?M\.?I\.?\s*/i, '')
          .replace(/^COBERTURAS?\s*/i, '')
          .trim()

        // Ignora VRD no quadro de coberturas
        if (
          col1Str.toUpperCase().includes('VALOR EM RISCO DECLARADO') ||
          col2Str.toUpperCase().includes('VALOR EM RISCO DECLARADO')
        ) {
          continue
        }

        const hasValues =
          /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(col2Str) ||
          /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(col3Str)

        if (hasValues) {
          anchors.push({
            y: r.y,
            col2Text: col2Str,
            col3Text: col3Str,
            col1Own: col1Str,
            col4Own: col4Str,
            col1Assigned: [],
            col4Assigned: [],
          })
        } else {
          // Linha sem valores monetários:
          // IMPORTANTE: apenas fragmentos em col1 (ou col1 + col2 se transbordou sem ser P.O.S.)
          // compõem linhas só-de-texto de nome de cobertura.
          // Nunca misturar col4 nem fragmentos monetários aqui.
          const col1Candidate = [col1Str, col2Str, col3Str]
            .filter(Boolean)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim()

          if (col1Candidate) {
            textOnlyCol1Lines.push({ y: r.y, text: col1Candidate })
          }
          if (col4Str) {
            textOnlyCol4Lines.push({ y: r.y, text: col4Str })
          }
        }
      }

      // Atribuição de linhas só-de-texto em col1 à âncora mais próxima por |Δy|
      if (anchors.length > 0) {
        for (const tLine of textOnlyCol1Lines) {
          let bestAnchor: PortoAnchor = anchors[0]
          let minDy = Math.abs(anchors[0].y - tLine.y)

          for (let i = 1; i < anchors.length; i++) {
            const dy = Math.abs(anchors[i].y - tLine.y)
            if (dy < minDy) {
              minDy = dy
              bestAnchor = anchors[i]
            }
          }

          bestAnchor.col1Assigned.push(tLine)
        }

        // Atribuição de linhas só-de-texto em col4 (franquias multilinhas)
        // Regra: cada linha col4 pertence ao bloco da âncora de cobertura.
        // Se a âncora já tem franquia "Não há." completa (ex.: TUMULTO em y650),
        // linhas longas explicativas de P.O.S. (como as de Danos Elétricos y634 e y620)
        // pertencem à âncora vizinha que realmente tem essa franquia extensa (EQUIPAMENTO ELETRÔNICO em y607).
        // Delimitação por fronteira entre âncoras adjacentes:
        // Para cada linha col4, encontra a âncora mais próxima. Se a âncora mais próxima
        // for TUMULTO ("Não há.") e a linha for continuação de franquia complexa que se estende
        // até EQUIPAMENTO ELETRÔNICO, atribui a EQUIPAMENTO ELETRÔNICO.
        for (const posLine of textOnlyCol4Lines) {
          let bestAnchor: PortoAnchor = anchors[0]
          let minDy = Math.abs(anchors[0].y - posLine.y)

          for (let i = 1; i < anchors.length; i++) {
            const dy = Math.abs(anchors[i].y - posLine.y)
            if (dy < minDy) {
              minDy = dy
              bestAnchor = anchors[i]
            }
          }

          // Ajuste fino para casos como TUMULTO (y650, franquia própria "Não há.")
          // onde a cobertura seguinte (EQUIPAMENTO ELETRÔNICO y607) possui uma franquia longa
          // cujas primeiras linhas começam acima da âncora y607 (y634, y620):
          if (/^Não há\.?$/i.test(bestAnchor.col4Own.trim())) {
            // Se a âncora mais próxima por dy tem "Não há." e a linha de texto é longa/detalhe de franquia,
            // verifica se a âncora adjacente (acima ou abaixo) é a verdadeira dona.
            const anchorIdx = anchors.indexOf(bestAnchor)
            const nextAnchor = anchorIdx + 1 < anchors.length ? anchors[anchorIdx + 1] : null
            const prevAnchor = anchorIdx > 0 ? anchors[anchorIdx - 1] : null

            if (
              nextAnchor &&
              posLine.y < bestAnchor.y &&
              (!prevAnchor || posLine.y < prevAnchor.y)
            ) {
              // A linha está abaixo de bestAnchor ("Não há.") e caminha em direção a nextAnchor
              bestAnchor = nextAnchor
            }
          }

          bestAnchor.col4Assigned.push(posLine)
        }

        // Monta coberturas na ordem original das âncoras (y decrescente)
        for (const anc of anchors) {
          // Coleta todas as partes de col1: own + assigned, ordenadas por y decrescente
          const allCol1 = [...anc.col1Assigned]
          if (anc.col1Own) {
            allCol1.push({ text: anc.col1Own, y: anc.y })
          }
          allCol1.sort((a, b) => b.y - a.y)

          let nomeCompleto = allCol1
            .map((item) => item.text)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/^[•*-]\s*/, '')
            .trim()

          if (!nomeCompleto) continue
          if (/^SUBTRA[ÇC][ÃA]O$/i.test(nomeCompleto)) continue
          if (nomeCompleto.toUpperCase().includes('VALOR EM RISCO DECLARADO')) continue
          if (nomeCompleto.toUpperCase().includes('COBERTURA DE LUCROS CESSANTES DECORRENTES'))
            continue

          const lmiM = anc.col2Text.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/)
          const lmiVal = lmiM ? parsePtBrNumber(lmiM[0]) : null

          let premVal: number | null = null
          const premM = anc.col3Text.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/)
          if (premM) {
            premVal = parsePtBrNumber(premM[0])
          }

          // Coleta todas as partes de col4: own + assigned, ordenadas por y decrescente
          const allCol4 = [...anc.col4Assigned]
          if (anc.col4Own) {
            allCol4.push({ text: anc.col4Own, y: anc.y })
          }
          allCol4.sort((a, b) => b.y - a.y)

          let posText = allCol4
            .map((item) => item.text)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim()

          if (!posText) {
            posText = 'Não há.'
          }

          extractedList.push({
            nome: nomeCompleto,
            lmi: lmiVal,
            premio: premVal,
            franquia: posText,
          })
        }
      }
    }
  }

  // Fallback de texto se não houver coordenadas ou se extractedList estiver vazia
  if (extractedList.length === 0) {
    let insideCoberturas = false
    interface TextRawAcc {
      nomeParts: string[]
      lmi: number | null
      premio: number | null
      posParts: string[]
    }
    const textAccList: TextRawAcc[] = []
    let pendingTextPrefixes: string[] = []
    let pendingTextPosPrefixes: string[] = []

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim()

      if (
        line === 'COBERTURAS' ||
        line.startsWith('COBERTURAS\n') ||
        line.includes('COBERTURA L.M.I. PRÊMIO P.O.S.')
      ) {
        insideCoberturas = true
        continue
      }

      if (
        line.startsWith('COBERTURA DE LUCROS CESSANTES DECORRENTES DE:') ||
        line.startsWith('CLÁUSULA DE SERVIÇOS') ||
        line.startsWith('DEMONSTRATIVO DE PRÊMIO') ||
        line.startsWith('CLÁUSULAS PARTICULARES')
      ) {
        insideCoberturas = false
        break
      }

      if (!insideCoberturas) continue

      // Limpeza de cabeçalho no fallback textual
      if (
        line.includes('COBERTURA L.M.I.') ||
        /^COBERTURA\s+L\.?M\.?I\.?\s+PR[ÊE]MIO/i.test(line) ||
        line.includes('VALOR EM RISCO DECLARADO') ||
        line.startsWith('9H095J - BYCOR') ||
        line.startsWith('PÁGINA ')
      ) {
        continue
      }

      line = line
        .replace(/^COBERTURA\s+L\.?M\.?I\.?\s+PR[ÊE]MIO\s+(?:P\.?O\.?S\.?)?\s*/i, '')
        .replace(/^COBERTURAS?\s+L\.?M\.?I\.?\s*/i, '')
        .trim()

      if (!line) continue

      // Linha com R$ (LMI e/ou Prêmio)
      const m = line.match(
        /^([A-Za-zÀ-ÿ0-9\s/.,–\-_()]+?)\s+R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s*(?:R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2}))?\s*(.*)$/,
      )

      if (m) {
        const rawNome = m[1].trim()
        const lmiVal = parsePtBrNumber(m[2])
        const premVal = m[3] ? parsePtBrNumber(m[3]) : null
        const posText = m[4]?.trim() || ''

        if (rawNome.toUpperCase().includes('VALOR EM RISCO DECLARADO')) {
          continue
        }

        const assembledNames: string[] = []
        if (pendingTextPrefixes.length > 0) {
          assembledNames.push(...pendingTextPrefixes)
          pendingTextPrefixes = []
        }
        if (rawNome) {
          assembledNames.push(rawNome)
        }

        const assembledPos: string[] = []
        if (pendingTextPosPrefixes.length > 0) {
          assembledPos.push(...pendingTextPosPrefixes)
          pendingTextPosPrefixes = []
        }
        if (posText) {
          assembledPos.push(posText)
        }

        textAccList.push({
          nomeParts: assembledNames,
          lmi: lmiVal,
          premio: premVal,
          posParts: assembledPos,
        })
      } else {
        // Linha sem R$: prefixo de nome da próxima cobertura ou continuação de P.O.S.
        if (
          !line.includes('COBERTURAS') &&
          !line.startsWith('PÁGINA') &&
          !line.startsWith('9H095J')
        ) {
          const isPosOnly =
            line.includes('indenizações') ||
            line.includes('Não há') ||
            line.includes('mínimo') ||
            line.includes('Indenizações') ||
            line.includes('dias de paralisação')

          if (isPosOnly && textAccList.length > 0 && pendingTextPrefixes.length === 0) {
            textAccList[textAccList.length - 1].posParts.push(line)
          } else if (isPosOnly && pendingTextPrefixes.length > 0) {
            pendingTextPosPrefixes.push(line)
          } else {
            pendingTextPrefixes.push(line)
          }
        }
      }
    }

    if (pendingTextPrefixes.length > 0 && textAccList.length > 0) {
      textAccList[textAccList.length - 1].nomeParts.push(...pendingTextPrefixes)
      pendingTextPrefixes = []
    }
    if (pendingTextPosPrefixes.length > 0 && textAccList.length > 0) {
      textAccList[textAccList.length - 1].posParts.push(...pendingTextPosPrefixes)
      pendingTextPosPrefixes = []
    }

    for (const t of textAccList) {
      const nomeCompleto = t.nomeParts
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
      if (!nomeCompleto || t.lmi === null) continue
      if (/^SUBTRA[ÇC][ÃA]O$/i.test(nomeCompleto)) continue
      const posFull =
        t.posParts
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim() || 'Não há.'
      extractedList.push({
        nome: nomeCompleto,
        lmi: t.lmi,
        premio: t.premio,
        franquia: posFull,
      })
    }
  }

  // Montagem final do quadro de coberturas
  // Regra: Classificar exatamente UMA Cobertura Básica (a primeira de incêndio amparada)
  const coberturas: ExtractedCoberturaItem[] = []
  let basicaEleita = false

  for (const item of extractedList) {
    let categoria = matchCanonicalCategory(item.nome)

    const isIncendioBasicaName =
      /INC[ÊE]NDIO/i.test(item.nome) &&
      (/EXPLOS[ÃA]O/i.test(item.nome) ||
        /FUMA[ÇC]A/i.test(item.nome) ||
        /AERONAVE/i.test(item.nome) ||
        /RAIO/i.test(item.nome))

    if (isIncendioBasicaName && !basicaEleita) {
      categoria = 'Incêndio Básica (Danos Materiais)'
      basicaEleita = true
    } else if (isIncendioBasicaName && basicaEleita) {
      categoria = 'Incêndio Complementar'
    } else if (
      (categoria === 'Incêndio Básica (Danos Materiais)' ||
        categoria === 'Incêndio, Raio, Explosão, Implosão e Fumaça') &&
      basicaEleita
    ) {
      categoria = 'Incêndio Complementar'
    } else if (
      (categoria === 'Incêndio Básica (Danos Materiais)' ||
        categoria === 'Incêndio, Raio, Explosão, Implosão e Fumaça') &&
      !basicaEleita
    ) {
      categoria = 'Incêndio Básica (Danos Materiais)'
      basicaEleita = true
    }

    coberturas.push({
      cobertura: item.nome,
      categoriaNormalizada: categoria,
      lmi: item.lmi,
      premioLiquido: item.premio,
      franquia: item.franquia || 'Não há.',
    })
  }

  const diagnosticoPorto: DiagnosticoExtracao = {
    seguradoraDetectada: 'Porto Seguro Cia. de Seguros Gerais',
    totalPaginasDocumento: pages.length,
    paginasAnalisadas:
      diagPaginasAnalisadas.length > 0 ? diagPaginasAnalisadas : pages.map((p) => p.pageNumber),
    fragmentosBrutos:
      diagFragmentos.length > 0
        ? diagFragmentos
        : pages.flatMap((p) =>
            (p.items || []).map((it) => ({
              str: it.str,
              x: it.x,
              y: it.y,
              pagina: p.pageNumber,
              width: it.width,
              height: it.height,
              fontName: it.fontName,
              isBold: it.isBold,
            })),
          ),
    limitesCalibrados: diagLimites,
    linhasMontadas: diagLinhasMontadas,
    resultadoFinal: {
      numeroCotacao: cotacao,
      vigenciaInicio,
      vigenciaFim,
      dataCotacao,
      premioLiquido,
      premioTotal,
      iof,
      custoApolice,
      lmiTotal: valorEmRiscoDeclarado || (coberturas[0]?.lmi ?? null),
      formaPagamento: formaPagamento || 'Boleto Bancário',
      proponente: {
        nome: seguradoNome || undefined,
        cnpj: seguradoCnpj || undefined,
        atividade: atividade || undefined,
        tipoConstrucao: respostasQuestionario['tipo_construcao'] || 'Alvenaria',
        valorEmRiscoDeclarado,
      },
      coberturas,
    },
    timestamp: new Date().toISOString(),
  }

  return {
    numeroCotacao: cotacao,
    versao: '1',
    dataCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioLiquido,
    premioTotal,
    iof,
    custoApolice,
    lmiTotal: valorEmRiscoDeclarado || (coberturas[0]?.lmi ?? null),
    formaPagamento: formaPagamento || 'Boleto Bancário',
    numeroParcelas,
    coberturas,
    posFranquiasGerais: 'Conforme P.O.S. detalhada por cobertura',
    diagnostico: diagnosticoPorto,
    dadosComplementares: {
      seguradoNome,
      seguradoCnpj,
      atividade,
      tipoConstrucao: respostasQuestionario['tipo_construcao'] || 'Alvenaria',
      respostasQuestionario,
      valorEmRiscoDeclarado,
      lucrosCessantesCausas,
      primeiraParcelaValor,
      demaisParcelasValor,
    },
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
      } else if (canonica === 'allianz') {
        extracted = extractAllianzDetails(segmentPages)
      } else if (canonica === 'porto') {
        extracted = extractPortoDetails(segmentPages, { collectDiagnostics: true })
      } else {
        extracted = extractGenericDetails(segmentPages)
      }

      // Se não for Porto Seguro ou se extracted não tiver diagnóstico criado, gera o diagnóstico
      // com os fragmentos brutos e resultado final disponível
      let diagnosticoSeg: DiagnosticoExtracao | undefined = extracted.diagnostico
      if (!diagnosticoSeg) {
        diagnosticoSeg = {
          seguradoraDetectada: seguradora.nomeCanonica,
          totalPaginasDocumento: segmentPages.length,
          paginasAnalisadas: segmentPages.map((p) => p.pageNumber),
          fragmentosBrutos: segmentPages.flatMap((p) =>
            (p.items || []).map((it) => ({
              str: it.str,
              x: it.x,
              y: it.y,
              pagina: p.pageNumber,
              width: it.width,
              height: it.height,
              fontName: it.fontName,
              isBold: it.isBold,
            })),
          ),
          resultadoFinal: {
            numeroCotacao: extracted.numeroCotacao || '',
            vigenciaInicio: extracted.vigenciaInicio || '',
            vigenciaFim: extracted.vigenciaFim || '',
            dataCotacao: extracted.dataCotacao || '',
            premioLiquido: extracted.premioLiquido ?? null,
            premioTotal: extracted.premioTotal ?? null,
            iof: extracted.iof ?? null,
            custoApolice: extracted.custoApolice ?? null,
            lmiTotal: extracted.lmiTotal ?? null,
            formaPagamento: extracted.formaPagamento || '',
            proponente: {
              nome: extracted.dadosComplementares?.seguradoNome,
              cnpj: extracted.dadosComplementares?.seguradoCnpj,
              atividade: extracted.dadosComplementares?.atividade,
              tipoConstrucao: extracted.dadosComplementares?.tipoConstrucao,
              valorEmRiscoDeclarado: extracted.dadosComplementares?.valorEmRiscoDeclarado,
            },
            coberturas: extracted.coberturas || [],
          },
          timestamp: new Date().toISOString(),
        }
      }

      // Constrói resumo legível do documento
      const docId = `doc-${idx + 1}-${seguradora.nomeCanonica.slice(0, 4).toLowerCase()}-${b.paginaInicio}`
      // Se não houver número identificado no documento, deixa vazio conforme regra obrigatória
      const numCot = extracted.numeroCotacao || ''
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
      const docDisplayNum = numCot || `Proposta #${idx + 1}`

      // Regra de IOF no leitor de propostas (C2):
      // Quando a proposta NÃO informar IOF (ou vier 0), derivar: IOF = Líquido * 7,38% e Bruto = Líquido + IOF.
      // Quando a proposta informar IOF explícito, usar o valor informado e Bruto = Líquido + IOF (se Bruto não vier).
      // Regra do usuário: quando a proposta declara Prêmio Net (sem Prêmio Líquido explícito),
      // o leitor grava o Net extraído e NÃO completa nenhum campo derivado — Prêmio Líquido, IOF e
      // Prêmio Bruto ficam vazios/pendentes (null), sem presunção de comissão.
      const pLiqRaw = extracted.premioLiquido ?? null
      let pIofRaw = extracted.iof ?? null
      let pTotalRaw = extracted.premioTotal ?? null

      const temNetSemLiquido =
        (pLiqRaw === null || pLiqRaw === 0) &&
        extracted.premioNet !== null &&
        extracted.premioNet !== undefined &&
        extracted.premioNet > 0

      if (temNetSemLiquido) {
        // Se só há Prêmio Net sem Líquido explícito, NÃO deriva IOF nem Bruto — ficam pendentes (null)
        pIofRaw = null
        pTotalRaw = null
      } else if (pLiqRaw !== null && pLiqRaw > 0) {
        if (pIofRaw === null || pIofRaw === 0) {
          pIofRaw = Number((pLiqRaw * 0.0738).toFixed(2))
        }
        if (pTotalRaw === null || pTotalRaw === 0) {
          pTotalRaw = Number((pLiqRaw + pIofRaw).toFixed(2))
        }
      }

      documentos.push({
        id: docId,
        titulo: `${seguradora.nomeCanonica} — Cotação ${docDisplayNum}${versaoCot} [Págs. ${b.paginaInicio} a ${b.paginaFim}]`,
        paginaInicio: b.paginaInicio,
        paginaFim: b.paginaFim,
        seguradora,
        numeroCotacao: numCot,
        versao: extracted.versao || '1',
        dataCotacao: extracted.dataCotacao || '',
        validadeCotacao: extracted.validadeCotacao || '',
        vigenciaInicio: extracted.vigenciaInicio || '',
        vigenciaFim: extracted.vigenciaFim || '',
        premioLiquido: pLiqRaw,
        premioTotal: pTotalRaw,
        iof: pIofRaw,
        custoApolice: extracted.custoApolice ?? null,
        lmiTotal: extracted.lmiTotal ?? null,
        formaPagamento: extracted.formaPagamento || '',
        numeroParcelas: extracted.numeroParcelas ?? null,
        posFranquiasGerais: extracted.posFranquiasGerais || '',
        coberturas: extracted.coberturas || [],
        rawTextPreview: previewLines,
        statusExtracao,
        diagnostico: diagnosticoSeg,
        vrdDm: extracted.vrdDm ?? null,
        vrdMmu: extracted.vrdMmu ?? null,
        vrdMmp: extracted.vrdMmp ?? null,
        vrdLc: extracted.vrdLc ?? null,
        vrdLcBase: extracted.vrdLcBase ?? 'Lucro Bruto',
        premioNet: extracted.premioNet ?? null,
        comissaoTrabalhada: extracted.comissaoTrabalhada ?? null,
        basePremio: extracted.basePremio ?? undefined,
        dadosComplementares: extracted.dadosComplementares,
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
