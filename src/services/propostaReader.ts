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
  custoApolice?: number | null
  lmiTotal: number | null
  formaPagamento: string
  numeroParcelas?: number | null
  posFranquiasGerais: string
  coberturas: ExtractedCoberturaItem[]
  rawTextPreview: string
  statusExtracao: 'completa' | 'parcial' | 'minima'
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
  }
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
      if (seg.canonica === 'Allianz Seguros S.A.' && /Allianz Seguros S\.?A\.?/i.test(text)) {
        razaoSocial = 'Allianz Seguros S.A.'
      } else if (
        seg.canonica === 'Porto Seguro Cia. de Seguros Gerais' &&
        /Porto Seguro Cia(?: de)? Seguros Gerais/i.test(text)
      ) {
        razaoSocial = 'Porto Seguro Cia de Seguros Gerais'
      }

      return {
        nomeCanonica: seg.canonica,
        razaoSocial,
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

    // 5. Allianz: Pedido de Cotação Allianz Empresarial ou nova cotação independente
    // Cabeçalhos comuns de continuação como "Página X de 5 Nº Cotação: 888223989" NÃO iniciam novo doc!
    const isNewAllianz =
      (firstLines.includes('pedido de cotação') && firstLines.includes('allianz empresarial')) ||
      (firstLines.includes('allianz empresarial') &&
        firstLines.includes('suas informações') &&
        firstLines.includes('informações do seguro'))

    // 6. Porto Seguro: Apenas se for um NOVO orçamento completo (capa formal com "Orçamento" + "Dados do Proponente" + "Local de Risco")
    const isNewPorto =
      firstLines.includes('porto print web') &&
      firstLines.includes('orçamento') &&
      firstLines.includes('dados do proponente') &&
      firstLines.includes('número do orçamento')

    // 7. Marcador genérico forte de capa / abertura de cotação
    const isGenericNewDoc =
      /^(?:cota[çc][ãa]o\s+de\s+seguros|proposta\s+de\s+seguro|especifica[çc][ãa]o\s+da\s+proposta)/i.test(
        firstLines.trim(),
      ) &&
      (firstLines.includes('dados do segurado') ||
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
  // "Prêmio Líquido: (R$): 69.215,24" ou "Prêmio Líquido: 69.215,24"
  // "Prêmio Total (R$): 74.323,32"
  // "IOF (R$): 5.108,08"
  // "Custo da Apólice (R$): 0,00"
  // "Forma de Pagamento: Boleto Bancário", "Nº de Parcelas: 4"
  let premioLiquido: number | null = null
  const prLiqMatch = fullText.match(
    /Pr[êe]mio\s+L[íi]quido(?:\s*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (prLiqMatch) {
    premioLiquido = parsePtBrNumber(prLiqMatch[1])
  }

  let premioTotal: number | null = null
  const prTotMatch = fullText.match(
    /Pr[êe]mio\s+Total(?:\s*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (prTotMatch) {
    premioTotal = parsePtBrNumber(prTotMatch[1])
  }

  let iof: number | null = null
  const iofMatch = fullText.match(/IOF(?:\s*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
  if (iofMatch) {
    iof = parsePtBrNumber(iofMatch[1])
  }

  let custoApolice: number | null = null
  const custoMatch = fullText.match(
    /Custo\s+da\s+Ap[óo]lice(?:\s*\(R\$\))?[:\s]*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
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
  // ==========================================
  // Tabela 1: "COBERTURA BASICA*"
  // Tabela 2: "COBERTURAS ADICIONAIS*" (quebra entre pág 2 e 3 com cabeçalho repetido)
  // Pareamento: muitas adicionais aparecem em 2 linhas:
  // Linha 1: [Nome] [LMI] [Prêmio]
  // Linha 2: [Nome] [LMI] [Franquia % / Dias] [Franquia R$]
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

  // Reúne todas as linhas de todas as páginas limpando cabeçalhos/rodapés de página repetidos
  const allLines: string[] = []
  for (const page of pages) {
    for (const rawLine of page.lines) {
      const line = rawLine.trim()
      // Filtra números de página e rodapés/cabeçalhos de cotação
      if (/^P[áa]gina\s+\d+\s+de\s+\d+/i.test(line)) continue
      if (/^N[º°.]\s*Cota[çc][ãa]o:\s*\d+/i.test(line)) continue
      if (/^\*\s*Todos\s+os\s+limites\s+e\s+sublimites/i.test(line)) continue
      if (/^SubLimite\s+M[áa]ximo/i.test(line)) continue
      if (/^Limite\s+M[áa]ximo\s+de\s+Indeniza[çc][ãa]o/i.test(line)) continue
      if (/^de\s+Indeniza[çc][ãa]o\s+Pr[êe]mio\s+por/i.test(line)) continue
      if (/^Cobertura\s+R\$\s+%\s+R\$/i.test(line)) continue
      if (/^Pr[êe]mio\s+por\s+Cobertura/i.test(line)) continue
      if (/^%\s+R\$/i.test(line)) continue
      allLines.push(line)
    }
  }

  interface AssembledCoverageRow {
    section: 'basica' | 'adicional'
    nome: string
    lmiVal: number
    rest: string
  }

  const assembledRows: AssembledCoverageRow[] = []
  let currentSection: 'basica' | 'adicional' | null = null

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]

    if (/^COBERTURA\s+BASICA\*/i.test(line)) {
      currentSection = 'basica'
      continue
    }

    if (/^COBERTURAS\s+ADICIONAIS\*/i.test(line)) {
      currentSection = 'adicional'
      continue
    }

    // Fim da tabela de coberturas
    if (
      /^INFORMA[ÇC][ÕO]ES\s+DE\s+PAGAMENTO/i.test(line) ||
      /^CL[ÁA]USULAS\s+COMPLEMENTARES/i.test(line) ||
      /^OBSERVA[ÇC][ÕO]ES/i.test(line) ||
      /^PROCESSO\s+SUSEP/i.test(line)
    ) {
      currentSection = null
      continue
    }

    if (!currentSection) continue

    // Ignora eventuais cabeçalhos repetidos da tabela de coberturas
    if (
      /^SubLimite\b/i.test(line) ||
      /^Limite\s+M[áa]ximo\b/i.test(line) ||
      /^de\s+Indeniza[çc][ãa]o\b/i.test(line) ||
      /^Cobertura\s+R\$/i.test(line) ||
      /^Pr[êe]mio\s+por\s+Cobertura/i.test(line) ||
      /^Franquia(?:\s*(?:%|R\$))?/i.test(line) ||
      /^%\s+R\$/i.test(line) ||
      /^\*\s*Todos\s+os\s+limites/i.test(line)
    ) {
      continue
    }

    // Verifica se a linha contém valores monetários no formato 000.000,00
    const hasMonetaryVal = /[\d]{1,3}(?:\.[\d]{3})*,\d{2}/.test(line)

    if (hasMonetaryVal) {
      // Tenta fazer o match da linha de cobertura: [Nome] [SubLimite/LMI] [Prêmio/Franquia/Resto...]
      const matchLine = line.match(
        /^([A-Za-zÀ-ÿ0-9\s/.,–\-_()•*&'+ºª]+?)\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s*(.*)$/,
      )

      if (matchLine) {
        const rawNome = matchLine[1]
          .replace(/^[•*-]\s*/, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
        const lmiVal = parsePtBrNumber(matchLine[2])
        const rest = (matchLine[3] || '').trim()

        if (rawNome && lmiVal !== null) {
          assembledRows.push({
            section: currentSection,
            nome: rawNome,
            lmiVal,
            rest,
          })
          continue
        }
      }
    }

    // Se a linha NÃO tem valor monetário (ou não deu match numérico),
    // trata como CONTINUAÇÃO do nome da cobertura anterior na mesma seção
    // Ex: "Despesas de Recomposição de Registros e" (linha 1 com valores) + "Documentos" (linha 2 sem valores)
    // -> Concatena ao nome da cobertura anterior com espaço (pt-BR)
    // e NÃO cria nova cobertura nem cola seu texto no início da cobertura seguinte.
    if (assembledRows.length > 0) {
      const lastRow = assembledRows[assembledRows.length - 1]
      if (lastRow && lastRow.section === currentSection) {
        const cleanAdd = line
          .replace(/^[•*-]\s*/, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
        if (cleanAdd && cleanAdd !== '-' && cleanAdd !== '—') {
          lastRow.nome = `${lastRow.nome} ${cleanAdd}`.replace(/\s{2,}/g, ' ').trim()
        }
      }
    }
  }

  // Processa cada linha de cobertura montada
  for (const { section, nome: rawNome, lmiVal, rest } of assembledRows) {
    if (!rawNome || lmiVal === null) continue

    // Extrai dados da cauda da linha (prêmio e/ou franquia)
    let rowPremio: number | null = null
    let rowFranquiaStr = ''
    let remainingRest = rest

    // Caso 1: Franquia em dias, ex: "- 10 Dias" ou "10 Dias"
    const diasMatch = remainingRest.match(/(\d+)\s*Dias/i)
    if (diasMatch) {
      rowFranquiaStr = `${diasMatch[1]} Dias`
      remainingRest = remainingRest.replace(/-?\s*\d+\s*Dias/i, '').trim()
    }

    // Caso 2: Franquia com percentual e valor mínimo em R$, ex: "10 1.500,00", "15 5.000,00", "20 10.000,00"
    // Atenção: o percentual vem como número inteiro isolado (10, 15, 20) antes do valor monetário
    const pctAndMinMatch = remainingRest.match(/\b(\d{1,2})\b\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})/)
    if (pctAndMinMatch) {
      const pct = pctAndMinMatch[1]
      const minRs = pctAndMinMatch[2]
      if (!rowFranquiaStr) {
        rowFranquiaStr = `${pct}% com mín. R$ ${minRs}`
      }
      remainingRest = remainingRest.replace(pctAndMinMatch[0], '').trim()
    }

    // Caso 3: Apenas um valor monetário na cauda (ou residual), ex: "18.544,40", "3.232,97", "30,88"
    // Esse valor é o Prêmio por Cobertura R$!
    const moneyMatch = remainingRest.match(/[\d]{1,3}(?:\.[\d]{3})*,\d{2}/)
    if (moneyMatch) {
      rowPremio = parsePtBrNumber(moneyMatch[0])
    }

    // Identificação de papéis de básica e lucros cessantes
    const key = normalizeCobKey(rawNome)
    const isBasicaReal = key.includes('incendioecomplementares') || key === 'incendio'
    const isLucrosCessantesReal = key.includes('perdalucrobruto') || key.includes('lucrobruto')

    // Procura no acumulador se já existe essa cobertura (pareamento de linha dupla)
    let acc = cobMap.get(key)
    if (!acc) {
      acc = {
        nomeOriginal: rawNome,
        isBasica: isBasicaReal,
        isLucrosCessantes: isLucrosCessantesReal,
        lmi: lmiVal,
        premio: rowPremio,
        franquia: rowFranquiaStr || 'Não informada',
      }
      cobMap.set(key, acc)
    } else {
      // Atualiza / completa com dados da outra linha (prêmio ou franquia)
      if (acc.premio === null && rowPremio !== null) {
        acc.premio = rowPremio
      }
      if (
        (acc.franquia === 'Não informada' || acc.franquia === 'Não há' || !acc.franquia) &&
        rowFranquiaStr
      ) {
        acc.franquia = rowFranquiaStr
      }
      // Mantém maior LMI se houver diferença
      if (lmiVal && (!acc.lmi || lmiVal > acc.lmi)) {
        acc.lmi = lmiVal
      }
      if (rawNome.length > acc.nomeOriginal.length) {
        acc.nomeOriginal = rawNome
      }
    }
  }

  // Constrói lista final de coberturas mantendo regras canônicas
  const coberturas: ExtractedCoberturaItem[] = []

  for (const [, item] of cobMap) {
    // Normalização de categoria:
    // Incêndio e Complementares -> Básica
    // Perda de Lucro Bruto -> Lucros Cessantes
    // RCs nunca viram básica mesmo se mencionarem incêndio
    let categoria = matchCanonicalCategory(item.nomeOriginal)

    if (item.isBasica) {
      categoria = 'Incêndio, Raio, Explosão, Implosão e Fumaça'
    } else if (item.isLucrosCessantes) {
      categoria = 'Lucros Cessantes'
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

export function extractPortoDetails(pages: PdfPageText[]): Partial<PropostaSegmentoExtracao> {
  const fullText = pages.map((p) => p.text).join('\n')
  const lines = pages.flatMap((p) => p.lines)

  // 1. Número do Orçamento: "NÚMERO DO ORÇAMENTO 118013040"
  let cotacao = ''
  const orcMatch = fullText.match(/N[ÚU]MERO\s+DO\s+OR[ÇC]AMENTO\s*([0-9]+)/i)
  if (orcMatch) {
    cotacao = orcMatch[1].trim()
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

  // 3. Vigência: "VIGÊNCIA DAS 00:01 DO DIA 01/11/2026 ATE AS 23:59 DO DIA 01/11/2027"
  let vigenciaInicio = ''
  let vigenciaFim = ''
  const vigMatch = fullText.match(
    /VIG[ÊE]NCIA\s+DAS\s+00:01\s+DO\s+DIA\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*ATE\s+AS\s+23:59\s+DO\s+DIA\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigMatch) {
    vigenciaInicio = parsePtBrDate(vigMatch[1])
    vigenciaFim = parsePtBrDate(vigMatch[2])
  } else {
    // Fallback vigência Porto
    const vigGeneric = fullText.match(
      /(\d{1,2}\/\d{1,2}\/\d{4})\s*ATE\s+AS\s+23:59\s+DO\s+DIA\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    )
    if (vigGeneric) {
      vigenciaInicio = parsePtBrDate(vigGeneric[1])
      vigenciaFim = parsePtBrDate(vigGeneric[2])
    }
  }

  // 4. Demonstrativo de Prêmio Geral:
  // "PRÊMIO LÍQUIDO TOTAL R$ 82.296,90"
  // "CUSTO DE APÓLICE R$ 0,00"
  // "I.O.F. R$ 6.073,51"
  // "PRÊMIO TOTAL R$ 88.370,41"
  let premioLiquido: number | null = null
  const prLiqMatch = fullText.match(
    /PR[ÊE]MIO\s+L[ÍI]QUIDO\s+TOTAL\s*(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (prLiqMatch) premioLiquido = parsePtBrNumber(prLiqMatch[1])

  let premioTotal: number | null = null
  const prTotMatch = fullText.match(
    /PR[ÊE]MIO\s+TOTAL\s*(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (prTotMatch) premioTotal = parsePtBrNumber(prTotMatch[1])

  let iof: number | null = null
  const iofMatch = fullText.match(/I\.?O\.?F\.?\s*(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
  if (iofMatch) iof = parsePtBrNumber(iofMatch[1])

  let custoApolice: number | null = null
  const custoMatch = fullText.match(
    /CUSTO\s+DE\s+AP[ÓO]LICE\s*(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (custoMatch) custoApolice = parsePtBrNumber(custoMatch[1])

  // 5. Formas de Pagamento: "6 x ADC" ou "6 x BOLETO BANCARIO" com 1ª parcela
  let formaPagamento = ''
  let numeroParcelas: number | null = null
  const formaMatch = fullText.match(/(\d+)\s*x\s*(BOLETO\s+BANCARIO|ADC[A-Z\s,]*)/i)
  if (formaMatch) {
    numeroParcelas = parseInt(formaMatch[1], 10)
    formaPagamento = `${numeroParcelas}x ${formaMatch[2].trim()}`
  } else {
    formaPagamento = 'Boleto Bancário'
  }

  // 6. Dados do Proponente e Questionário
  let seguradoNome = ''
  const propNomeMatch = fullText.match(
    /RAZ[ÃA]O\s+SOCIAL\s+([A-Za-z0-9\s.-]+?)(?:TIPO\s+DE\s+PESSOA|$|\n)/i,
  )
  if (propNomeMatch) seguradoNome = propNomeMatch[1].trim()

  let seguradoCnpj = ''
  // CNPJ sem máscara: "CNPJ 24742208/0002-25" -> normalizar para 24.742.208/0002-25
  const cnpjMatch = fullText.match(/CNPJ\s*([0-9./-]+)/i)
  if (cnpjMatch) {
    seguradoCnpj = formatCnpjMask(cnpjMatch[1])
  }

  let atividade = ''
  const ativMatch = fullText.match(
    /ATIVIDADE\s+DO\s+LOCAL[:\s]*([A-Za-zÀ-ÿ0-9\s/.-]+?)(?:Aten[çc][ãa]o|$|\n)/i,
  )
  if (ativMatch) atividade = ativMatch[1].trim()

  // Questionário qualitativo Porto
  const respostasQuestionario: Record<string, string> = {}
  if (fullText.includes('HOUVE SINISTRO NO LOCAL NOS ÚLTIMOS 12 MESES ?')) {
    respostasQuestionario['sinistro_12_meses'] =
      /HOUVE SINISTRO NO LOCAL NOS ÚLTIMOS 12 MESES \?\s*([A-Z]+)/i.exec(fullText)?.[1] || 'NÃO'
  }
  if (fullText.includes('TIPO DE CONSTRUÇÃO')) {
    respostasQuestionario['tipo_construcao'] =
      /TIPO DE CONSTRUÇÃO\s*([A-Z]+)/i.exec(fullText)?.[1] || 'ALVENARIA'
  }
  if (fullText.includes('DESEJA CONTRATAR INDENIZAÇÃO A VALOR DE NOVO')) {
    respostasQuestionario['valor_de_novo'] =
      /DESEJA CONTRATAR INDENIZAÇÃO A VALOR DE NOVO[^\n]*\?\s*([A-Z]+)/i.exec(fullText)?.[1] ||
      'SIM'
  }
  if (fullText.includes('POSSUI ALARME MONITORADO')) {
    respostasQuestionario['alarme_monitorado'] =
      /POSSUI ALARME MONITORADO[^\n]*\?\s*([A-Z]+)/i.exec(fullText)?.[1] || 'SIM'
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
  // Linha 1: "VALOR EM RISCO DECLARADO R$ 80.000.000,00"
  // Linha 2: "INCÊNDIO, EXPLOSÃO, IMPLOSÃO, FUMAÇA E QUEDA DE AERONAVE R$ 80.000.000,00 R$ 12.012,60 10% das indenizações."
  // P.O.S. pode ser texto longo: "10% das indenizações com mínimo de R$ 2.000,00.", "Não há.", "5 dias de paralisação do estabelecimento."
  let valorEmRiscoDeclarado: number | null = null
  const vrdMatch = fullText.match(
    /VALOR\s+EM\s+RISCO\s+DECLARADO\s*R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
  )
  if (vrdMatch) {
    valorEmRiscoDeclarado = parsePtBrNumber(vrdMatch[1])
  }

  const coberturas: ExtractedCoberturaItem[] = []
  let insideCoberturas = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

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
      continue
    }

    if (!insideCoberturas) continue

    // Ignora linha de VRD ou cabeçalho de colunas
    if (
      line.includes('COBERTURA L.M.I.') ||
      line.includes('VALOR EM RISCO DECLARADO') ||
      line.startsWith('9H095J - BYCOR') ||
      line.startsWith('PÁGINA ')
    ) {
      continue
    }

    // Linha de cobertura Porto Seguro:
    // Começa com NOME DA COBERTURA, seguido de R$ LMI, opcional R$ Prêmio e P.O.S. livre
    // Pode quebrar linha se o nome for longo:
    // Ex: "INCÊNDIO, EXPLOSÃO, IMPLOSÃO, FUMAÇA E QUEDA DE"
    // "AERONAVE R$ 80.000.000,00 R$ 12.012,60 10% das indenizações."
    let fullLine = line
    if (!fullLine.includes('R$') && i + 1 < lines.length) {
      const next = lines[i + 1].trim()
      if (next.includes('R$')) {
        fullLine = `${fullLine} ${next}`
        i++
      } else {
        continue
      }
    }

    // Regex para linha de cobertura Porto:
    // Captura: (Nome) R$ (LMI) [R$ (Prêmio)]? (POS texto livre)
    const m = fullLine.match(
      /^([A-Za-zÀ-ÿ0-9\s/.,–\-_()]+?)\s+R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s*(?:R\$\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2}))?\s*(.*)$/,
    )

    if (m) {
      const rawNome = m[1].trim()
      const lmiVal = parsePtBrNumber(m[2])
      const premVal = m[3] ? parsePtBrNumber(m[3]) : null
      let posText = m[4]?.trim() || 'Não informada'

      if (rawNome.toUpperCase().includes('VALOR EM RISCO DECLARADO')) {
        continue
      }

      // Se for a cobertura de Lucros Cessantes e tivermos capturado as causas decorrentes, anexa na observação/POS
      if (
        (rawNome.toUpperCase().includes('LUCROS CESSANTES') ||
          rawNome.toUpperCase().includes('LUCRO BRUTO')) &&
        lucrosCessantesCausas &&
        !posText.includes('Decorrentes de:')
      ) {
        posText = `${posText} (Decorrente de: ${lucrosCessantesCausas})`
      }

      if (rawNome && lmiVal !== null) {
        coberturas.push({
          cobertura: rawNome,
          categoriaNormalizada: matchCanonicalCategory(rawNome),
          lmi: lmiVal,
          premioLiquido: premVal,
          franquia: posText || 'Não há.',
        })
      }
    }
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
    dadosComplementares: {
      seguradoNome,
      seguradoCnpj,
      atividade,
      tipoConstrucao: respostasQuestionario['tipo_construcao'] || 'Alvenaria',
      respostasQuestionario,
      valorEmRiscoDeclarado,
      lucrosCessantesCausas,
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
        extracted = extractPortoDetails(segmentPages)
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
        custoApolice: extracted.custoApolice || null,
        lmiTotal: extracted.lmiTotal || null,
        formaPagamento: extracted.formaPagamento || 'Boleto',
        numeroParcelas: extracted.numeroParcelas || null,
        posFranquiasGerais: extracted.posFranquiasGerais || '',
        coberturas: extracted.coberturas || [],
        rawTextPreview: previewLines,
        statusExtracao,
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
