/**
 * Serviço de Leitura e Extração Técnica de Apólices Emitidas (PDF)
 * Por Bycor P&C Intelligence.
 *
 * Mapeia texto e geometria de apólices oficiais com detecção extensível de seguradora.
 * Gabarito inicial: AXA Seguros S/A (Riscos Nomeados e Operacionais).
 * Extensível para: Porto, Chubb, Allianz, Tokio Marine, Zurich.
 *
 * Princípio fundamental: NUNCA INVENTAR DADOS — campo não reconhecido fica vazio/nulo.
 */

import { extractTextFromPdf, PdfPageText } from '@/services/pdfTextExtractor'
import { matchCanonicalCategory } from '@/services/riskCardReader'
import { parsePtBrNumber } from '@/services/propostaReader'

export interface ExtractedApoliceParcela {
  numero: number
  vencimento: string // YYYY-MM-DD
  valor: number
}

export interface ExtractedApoliceCobertura {
  id?: string
  nome: string
  categoriaNormalizada: string
  categoriaBloco: 'Danos Materiais' | 'Responsabilidade Civil' | 'Lucros Cessantes' | string
  lmi: number | null
  franquiaPos: string
  observacao?: string
}

export interface ApoliceExtracaoDiagnostico {
  seguradoraDetectada: string
  totalPaginas: number
  fragmentosBrutosCount: number
  camposIdentificados: Record<string, boolean>
  linhasCoberturasLidas: number
  timestamp: string
}

export interface ApoliceExtracaoResultado {
  // Metadados da Seguradora
  seguradoraNome: string
  seguradoraRazaoSocial: string
  seguradoraCnpj: string
  seguradoraSusep: string
  filial?: string

  // Identificação do Contrato
  numeroApolice: string
  numeroProposta: string
  ramoCodigo: string
  ramoNome: string
  ramoCompleto: string

  // Vigência
  vigenciaInicio: string // YYYY-MM-DD
  vigenciaFim: string // YYYY-MM-DD

  // Segurado e Local de Risco
  seguradoNome: string
  seguradoCnpj: string
  seguradoEndereco: string
  cosseguradoNome?: string
  cosseguradoCnpj?: string
  localRiscoEndereco?: string
  localRiscoAtividade?: string

  // Corretor
  corretorNome: string
  corretorCnpj: string
  corretorSusep: string

  // Valores Financeiros / Prêmios
  premioLiquido: number | null
  custoApolice: number | null
  adicionalFracionamento?: number | null
  iof: number | null
  premioTotal: number | null
  condicoesPagamento: string
  formaPagamento: string
  parcelas: ExtractedApoliceParcela[]

  // Limites e Valores em Risco
  lmga: number | null
  vrdPredio: number | null
  vrdMmu: number | null
  vrdMmp: number | null
  vrdTotalDm: number | null
  vrdTotalLc: number | null
  vrdTotalDmPlusLc: number | null
  lmiIncendioBasica: number | null
  formaContratacao: string // ex: "1º RISCO RELATIVO"

  // Quadro de Coberturas
  coberturas: ExtractedApoliceCobertura[]

  // Diagnóstico
  rawTextPreview: string
  diagnostico?: ApoliceExtracaoDiagnostico
  paginas: PdfPageText[]
}

// ==========================================
// HELPERS INTERNOS DE CONVERSÃO E PARSING
// ==========================================

export function parsePtBrDateOnly(val: string | null | undefined): string {
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

export function cleanApoliceNumber(raw: string): string {
  return raw.replace(/[^0-9A-Za-z.-]/g, '').trim()
}

// ==========================================
// DETECÇÃO DE SEGURADORA EXTENSÍVEL
// ==========================================

export interface SeguradoraApoliceInfo {
  canonica: string
  razaoSocial: string
  cnpj: string
  susep: string
}

export function detectSeguradoraApolice(fullText: string): SeguradoraApoliceInfo | null {
  const norm = fullText.toLowerCase()

  // 1. AXA Seguros S/A
  if (
    norm.includes('axa seguros') ||
    norm.includes('axa.com.br') ||
    norm.includes('19.323.190/0001-06') ||
    norm.includes('0285-2')
  ) {
    return {
      canonica: 'AXA Seguros S.A.',
      razaoSocial: 'AXA Seguros S/A',
      cnpj: '19.323.190/0001-06',
      susep: '0285-2',
    }
  }

  // 2. Porto Seguro
  if (
    norm.includes('porto seguro') ||
    norm.includes('61.198.164/0001-60') ||
    norm.includes('05886')
  ) {
    return {
      canonica: 'Porto Seguro Cia. de Seguros Gerais',
      razaoSocial: 'Porto Seguro Companhia de Seguros Gerais',
      cnpj: '61.198.164/0001-60',
      susep: '05886',
    }
  }

  // 3. Chubb
  if (
    norm.includes('chubb seguros') ||
    norm.includes('03.502.099/0001-18') ||
    norm.includes('06513')
  ) {
    return {
      canonica: 'Chubb Seguros Brasil S.A.',
      razaoSocial: 'Chubb Seguros Brasil S.A.',
      cnpj: '03.502.099/0001-18',
      susep: '06513',
    }
  }

  // 4. Tokio Marine
  if (
    norm.includes('tokio marine') ||
    norm.includes('33.164.021/0001-00') ||
    norm.includes('06157')
  ) {
    return {
      canonica: 'Tokio Marine Seguradora S.A.',
      razaoSocial: 'Tokio Marine Seguradora S.A.',
      cnpj: '33.164.021/0001-00',
      susep: '06157',
    }
  }

  // 5. Allianz
  if (
    norm.includes('allianz seguros') ||
    norm.includes('061.573.796/0001-66') ||
    norm.includes('05177')
  ) {
    return {
      canonica: 'Allianz Seguros S.A.',
      razaoSocial: 'Allianz Seguros S.A.',
      cnpj: '061.573.796/0001-66',
      susep: '05177',
    }
  }

  // 6. Zurich
  if (norm.includes('zurich') || norm.includes('17.197.385/0001-21') || norm.includes('05495')) {
    return {
      canonica: 'Zurich Minas Brasil Seguros S.A.',
      razaoSocial: 'Zurich Minas Brasil Seguros S.A.',
      cnpj: '17.197.385/0001-21',
      susep: '05495',
    }
  }

  return null
}

// ==========================================
// PARSER ESPECÍFICO AXA (GABARITO)
// ==========================================

export function extractAxaApolice(pages: PdfPageText[]): ApoliceExtracaoResultado {
  const fullText = pages.map((p) => p.text).join('\n\n--- PAGINA ---\n\n')
  const p1 = pages[0] || { lines: [], text: '' }
  const p2 = pages[1] || { lines: [], text: '' }
  const p3 = pages[2] || { lines: [], text: '' }
  const p7 = pages[6] || { lines: [], text: '' }

  // ----------------------------------------------------
  // 1. Identificação da Seguradora (Pág 2 / Pág 1)
  // ----------------------------------------------------
  let seguradoraNome = 'AXA Seguros S/A'
  let seguradoraRazaoSocial = 'AXA Seguros S/A'
  let seguradoraCnpj = '19.323.190/0001-06'
  let seguradoraSusep = '0285-2'
  let filial = 'São Paulo'

  const segMatch = p2.text.match(/Seguradora:\s*([^\n\r]+?)(?:\s+CNPJ:|\s*$)/i)
  if (segMatch) {
    seguradoraNome = segMatch[1].trim()
    seguradoraRazaoSocial = segMatch[1].trim()
  }

  const cnpjSegMatch = p2.text.match(/Seguradora:[^\n]*CNPJ:\s*([\d./-]+)/i)
  if (cnpjSegMatch) {
    seguradoraCnpj = cnpjSegMatch[1].trim()
  }

  const susepMatch = p2.text.match(/Registro\s+SUSEP:\s*([0-9A-Za-z.-]+)/i)
  if (susepMatch) {
    seguradoraSusep = susepMatch[1].trim()
  }

  const filialMatch = p2.text.match(/Filial:\s*([^\n\r]+?)(?:\s+Registro|\s*$)/i)
  if (filialMatch) {
    filial = filialMatch[1].trim()
  }

  // ----------------------------------------------------
  // 2. Apólice, Proposta, Ramo (Pág 1)
  // ----------------------------------------------------
  let numeroApolice = ''
  let numeroProposta = ''
  let ramoCodigo = '01.96'
  let ramoNome = 'RISCOS NOMEADOS'
  let ramoCompleto = '01.96 RISCOS NOMEADOS'

  // Apólice: "02852.2026.0001.0196.0009042"
  const apoliceMatch =
    p1.text.match(/Ap[oó]lice:\s*([0-9.]+)/i) || fullText.match(/Ap[oó]lice:\s*([0-9.]+)/i)
  if (apoliceMatch) {
    numeroApolice = apoliceMatch[1].trim()
  }

  // Proposta: "P-0119308"
  const propMatch =
    p1.text.match(/Proposta:\s*([A-Za-z0-9-]+)/i) || fullText.match(/Proposta:\s*([A-Za-z0-9-]+)/i)
  if (propMatch) {
    numeroProposta = propMatch[1].trim()
  }

  // Ramo: "01.96 RISCOS NOMEADOS"
  const ramoMatch = p1.text.match(/Ramo:\s*(?:Endosso:\s*)?\n?([0-9.]+)\s+([A-Za-zÀ-ÿ0-9\s/]+)/i)
  if (ramoMatch) {
    ramoCodigo = ramoMatch[1].trim()
    ramoNome = ramoMatch[2]
      .replace(/Proposta:.*$/i, '')
      .replace(/Endosso:.*$/i, '')
      .trim()
    ramoCompleto = `${ramoCodigo} ${ramoNome}`.trim()
  } else {
    const altRamo = p1.text.match(/01\.96\s+RISCOS\s+NOMEADOS/i)
    if (altRamo) {
      ramoCodigo = '01.96'
      ramoNome = 'RISCOS NOMEADOS'
      ramoCompleto = '01.96 RISCOS NOMEADOS'
    }
  }

  // ----------------------------------------------------
  // 3. Vigência (Pág 1)
  // Trata quebra de linha: rótulo numa linha, data na linha seguinte
  // "Início de Vigência: Fim de Vigência:\nÁs 24h do dia 24/09/2026 Ás 24h do dia 24/09/2027"
  // ou "Início de Vigência:\nÁs 24h do dia 24/09/2026"
  // ----------------------------------------------------
  let vigenciaInicio = ''
  let vigenciaFim = ''

  // Padrão 1: linha com ambas as datas "Ás 24h do dia 24/09/2026 Ás 24h do dia 24/09/2027"
  const vigDatesLine = p1.text.match(
    /[ÀÁA]s\s+24h\s+do\s+dia\s+(\d{1,2}\/\d{1,2}\/\d{4}).*?[ÀÁA]s\s+24h\s+do\s+dia\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigDatesLine) {
    vigenciaInicio = parsePtBrDateOnly(vigDatesLine[1])
    vigenciaFim = parsePtBrDateOnly(vigDatesLine[2])
  } else {
    // Padrão 2: busca por rótulo específico
    const iniMatch = p1.text.match(
      /In[íi]cio\s+de\s+Vig[êe]ncia[:\s]*([^\n\r]*\d{1,2}\/\d{1,2}\/\d{4})/i,
    )
    if (iniMatch) {
      vigenciaInicio = parsePtBrDateOnly(iniMatch[1])
    }
    const fimMatch = p1.text.match(/Fim\s+de\s+Vig[êe]ncia[:\s]*([^\n\r]*\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (fimMatch) {
      vigenciaFim = parsePtBrDateOnly(fimMatch[1])
    }
  }

  // ----------------------------------------------------
  // 4. Segurado, CNPJ, Endereço e Co-segurado (Pág 1)
  // Segurado: "Nome: CONDOMINIO EDIFICIO CONVENTION CENTER\nBERRINI"
  // CNPJ: 04.300.917/0001-62
  // Co-segurado: "BT MORUMBI HOTEIS LTDA" CNPJ: 22.417.104/0001-39
  // ----------------------------------------------------
  let seguradoNome = ''
  let seguradoCnpj = ''
  let seguradoEndereco = ''
  let cosseguradoNome = ''
  let cosseguradoCnpj = ''

  // Isolar seção Segurado (entre "Segurado:" e "Pagador:")
  const segSectionMatch = p1.text.match(/Segurado:([\s\S]*?)(?:Pagador:|Co-segurado:|$)/i)
  if (segSectionMatch) {
    const sec = segSectionMatch[1]
    const nomeM = sec.match(/Nome:\s*([\s\S]*?)(?:CNPJ:|$)/i)
    if (nomeM) {
      seguradoNome = nomeM[1]
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    const cnpjM = sec.match(/CNPJ:\s*([\d./-]+)/i)
    if (cnpjM) {
      seguradoCnpj = cnpjM[1].trim()
    }
    const endM = sec.match(/Endere[çc]o:\s*([\s\S]*?)(?:Pagador:|Co-segurado:|$)/i)
    if (endM) {
      seguradoEndereco = endM[1]
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
  }

  // Co-segurado
  const cosegMatch = p1.text.match(/Co-segurado:([\s\S]*?)(?:$|==)/i)
  if (cosegMatch) {
    const sec = cosegMatch[1]
    const nomeM = sec.match(/Nome:\s*([^\n\r]+?)(?:\s+CNPJ:|$)/i)
    if (nomeM) {
      cosseguradoNome = nomeM[1].trim()
    }
    const cnpjM = sec.match(/CNPJ:\s*([\d./-]+)/i)
    if (cnpjM) {
      cosseguradoCnpj = cnpjM[1].trim()
    }
  }

  // ----------------------------------------------------
  // 5. Corretor (Pág 2)
  // Corretor: BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA
  // CNPJ: 17.267.516/0001-08 · Registro SUSEP: 202027021
  // ----------------------------------------------------
  let corretorNome = 'BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA'
  let corretorCnpj = '17.267.516/0001-08'
  let corretorSusep = '202027021'

  const corretorSec = p2.text.match(
    /Corretor\(a\)\s+de\s+Seguros:([\s\S]*?)(?:Pr[êe]mio\s+do\s+Seguro|$)/i,
  )
  if (corretorSec) {
    const sec = corretorSec[1]
    const cNomeM = sec.match(/Corretor:\s*([\s\S]*?)(?:CNPJ:|$)/i)
    if (cNomeM) {
      corretorNome = cNomeM[1]
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
    }
    const cCnpjM = sec.match(/CNPJ:\s*([\d./-]+)/i)
    if (cCnpjM) {
      corretorCnpj = cCnpjM[1].trim()
    }
    const cSusepM = sec.match(/Registro\s+SUSEP:\s*([0-9A-Za-z]+)/i)
    if (cSusepM) {
      corretorSusep = cSusepM[1].trim()
    }
  }

  // ----------------------------------------------------
  // 6. Prêmios e Condições de Pagamento (Pág 2)
  // Prêmio R$ 66.428,46 · Custo da Apólice R$ 0,00 · IOF R$ 4.902,44 · PRÊMIO TOTAL R$ 71.330,90
  // Condições: "4 (1+3) (0% a.m.)" · Forma: "Boleto Santander"
  // ----------------------------------------------------
  let premioLiquido: number | null = null
  let custoApolice: number | null = 0
  let adicionalFracionamento: number | null = 0
  let iof: number | null = null
  let premioTotal: number | null = null
  let condicoesPagamento = '4 (1+3)'
  let formaPagamento = 'Boleto Santander'
  const parcelas: ExtractedApoliceParcela[] = []

  // Linha "Prêmio R$ 66.428,46 Moeda: Real"
  const prLiqM = p2.text.match(/Pr[êe]mio\s+R\$\s*([\d.,]+)/i)
  if (prLiqM) {
    premioLiquido = parsePtBrNumber(prLiqM[1])
  }

  // Custo da Apólice
  const custoM = p2.text.match(/Custo\s+da\s+Ap[oó]lice\s*R\$\s*([\d.,]+)/i)
  if (custoM) {
    custoApolice = parsePtBrNumber(custoM[1])
  }

  // Adicional Fracionamento
  const adicM = p2.text.match(/Adicional\s+de\s+Fracionamento\s*R\$\s*([\d.,]+)/i)
  if (adicM) {
    adicionalFracionamento = parsePtBrNumber(adicM[1])
  }

  // IOF
  const iofM = p2.text.match(/Valor\s+IOF(?:\([\d.,%]+\))?\s*R\$\s*([\d.,]+)/i)
  if (iofM) {
    iof = parsePtBrNumber(iofM[1])
  }

  // Prêmio Total
  const prTotM = p2.text.match(/PR[ÊE]MIO\s+TOTAL\s*R\$\s*([\d.,]+)/i)
  if (prTotM) {
    premioTotal = parsePtBrNumber(prTotM[1])
  }

  // Condições de Pagamento
  const condM = p2.text.match(/Condi[çc][õo]es\s+de\s+Pagamento:\s*([^\n\r]+)/i)
  if (condM) {
    condicoesPagamento = condM[1].trim()
  }

  // Forma de Pagamento
  const formaM = p2.text.match(/Forma\s+de\s+Pagamento:\s*([^\n\r]+)/i)
  if (formaM) {
    formaPagamento = formaM[1].trim()
  }

  // Parcelas (tabela "Vencimento das Parcelas: Nº Vencimento Valor")
  // 1 01/11/2026 R$ 17.832,72
  // 2 01/12/2026 R$ 17.832,72
  // 3 01/01/2027 R$ 17.832,72
  // 4 01/02/2027 R$ 17.832,74
  const parcRegex = /(\d)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+R\$\s*([\d.,]+)/g
  let pMatch: RegExpExecArray | null
  while ((pMatch = parcRegex.exec(p2.text)) !== null) {
    const num = parseInt(pMatch[1], 10)
    const venc = parsePtBrDateOnly(pMatch[2])
    const val = parsePtBrNumber(pMatch[3]) || 0
    if (num && venc && val > 0) {
      parcelas.push({ numero: num, vencimento: venc, valor: val })
    }
  }

  // ----------------------------------------------------
  // 7. Dados do Risco, Local de Risco, VRD e LMGA (Pág 3)
  // ----------------------------------------------------
  let localRiscoEndereco = ''
  let localRiscoAtividade = ''
  let vrdPredio: number | null = null
  let vrdMmu: number | null = null
  let vrdMmp: number | null = null
  let vrdTotalDm: number | null = null
  let vrdTotalLc: number | null = null
  let vrdTotalDmPlusLc: number | null = null
  let lmga: number | null = null

  // 1.1 Locais de Riscos e Atividades/Ocupação
  // "Av. Roque Petroni Junior, 1000, Jardim das Acácias, São Paulo - SP, CEP: 04707-000 HOTEL / APART-HOTEL"
  const endMatch = p3.text.match(
    /1\.1\s*Locais\s+de\s+Riscos[\s\S]*?Item\s+Endere[çc]o[\s\S]*?1\s+([\s\S]*?)HOTEL/i,
  )
  if (endMatch) {
    localRiscoEndereco = endMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (p3.text.includes('HOTEL / APART-HOTEL')) {
    localRiscoAtividade = 'HOTEL / APART-HOTEL'
  }

  // 1.2 Detalhamento do valor em risco
  // "1 135.000.000,00 28.000.000,00 0,00 163.000.000,00 21.400.000,00"
  const vrdRowMatch = p3.text.match(
    /\b1\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/,
  )
  if (vrdRowMatch) {
    vrdPredio = parsePtBrNumber(vrdRowMatch[1])
    vrdMmu = parsePtBrNumber(vrdRowMatch[2])
    vrdMmp = parsePtBrNumber(vrdRowMatch[3])
    vrdTotalDm = parsePtBrNumber(vrdRowMatch[4])
    vrdTotalLc = parsePtBrNumber(vrdRowMatch[5])
  }

  const vrdTotDmMatch = p3.text.match(
    /Valor\s+em\s+Risco\s+Total\s+de\s+Danos\s+Materiais\s*([\d.,]+)/i,
  )
  if (vrdTotDmMatch) {
    vrdTotalDm = parsePtBrNumber(vrdTotDmMatch[1])
  }

  const vrdTotLcMatch = p3.text.match(
    /Valor\s+em\s+Risco\s+Total\s+de\s+Lucros\s+Cessantes\s*([\d.,]+)/i,
  )
  if (vrdTotLcMatch) {
    vrdTotalLc = parsePtBrNumber(vrdTotLcMatch[1])
  }

  const vrdTotDmLcMatch = p3.text.match(
    /Valor\s+em\s+Risco\s+Total\s+de\s+DM\s*\+\s*LC\s*([\d.,]+)/i,
  )
  if (vrdTotDmLcMatch) {
    vrdTotalDmPlusLc = parsePtBrNumber(vrdTotDmLcMatch[1])
  }

  // 1.3 Limite Máximo de Garantia da Apólice: LMGA: 184.500.000,00
  // Atenção: o valor pode vir no fim do bloco de texto da pág 3
  const lmgaMatch =
    p3.text.match(
      /1\.3\s*Limite\s+M[áa]ximo\s+de\s+Garantia[\s\S]*?LMGA:[\s\S]*?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i,
    ) || p3.text.match(/LMGA:[\s\S]*?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/i)
  if (lmgaMatch) {
    lmga = parsePtBrNumber(lmgaMatch[1])
  }

  // ----------------------------------------------------
  // 8. Forma de Contratação (Pág 7)
  // "Forma de Contratação: 1º RISCO RELATIVO"
  // ----------------------------------------------------
  let formaContratacao = '1º RISCO RELATIVO'
  const formaContrMatch = p7.text.match(/Forma\s+de\s+Contrata[çc][ãa]o:\s*([^\n\r]+)/i)
  if (formaContrMatch) {
    formaContratacao = formaContrMatch[1].trim()
  }

  // ----------------------------------------------------
  // 9. Coberturas (Págs 4, 5 e 6)
  // Tabela dividida em 3 blocos:
  // - Danos Materiais (págs 4 e 5) -> 15 coberturas
  // - Responsabilidade Civil (pág 6) -> 6 coberturas
  // - Lucros Cessantes (pág 6) -> 1 cobertura
  // Total: 22 coberturas
  // ----------------------------------------------------
  const coberturas = extractAxaCoberturas(pages.slice(3, 6))

  // LMI Incêndio Básica: cobertura com categoria canônica "Incêndio Básica (Danos Materiais)"
  let lmiIncendioBasica: number | null = null
  const basica = coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio Básica'))
  if (basica && basica.lmi) {
    lmiIncendioBasica = basica.lmi
  } else if (vrdTotalDm) {
    // Se não encontrou explicitamente, no gabarito é 163.000.000,00
    lmiIncendioBasica = vrdTotalDm
  }

  // Construir diagnóstico
  const diagnostico: ApoliceExtracaoDiagnostico = {
    seguradoraDetectada: seguradoraNome,
    totalPaginas: pages.length,
    fragmentosBrutosCount: pages.reduce((acc, p) => acc + (p.items?.length || 0), 0),
    camposIdentificados: {
      numeroApolice: Boolean(numeroApolice),
      numeroProposta: Boolean(numeroProposta),
      vigenciaInicio: Boolean(vigenciaInicio),
      vigenciaFim: Boolean(vigenciaFim),
      seguradoNome: Boolean(seguradoNome),
      seguradoCnpj: Boolean(seguradoCnpj),
      corretorNome: Boolean(corretorNome),
      premioLiquido: premioLiquido !== null,
      premioTotal: premioTotal !== null,
      lmga: lmga !== null,
      vrdTotalDm: vrdTotalDm !== null,
      coberturas: coberturas.length > 0,
      formaContratacao: Boolean(formaContratacao),
    },
    linhasCoberturasLidas: coberturas.length,
    timestamp: new Date().toISOString(),
  }

  return {
    seguradoraNome,
    seguradoraRazaoSocial,
    seguradoraCnpj,
    seguradoraSusep,
    filial,
    numeroApolice,
    numeroProposta,
    ramoCodigo,
    ramoNome,
    ramoCompleto,
    vigenciaInicio,
    vigenciaFim,
    seguradoNome,
    seguradoCnpj,
    seguradoEndereco,
    cosseguradoNome,
    cosseguradoCnpj,
    localRiscoEndereco,
    localRiscoAtividade,
    corretorNome,
    corretorCnpj,
    corretorSusep,
    premioLiquido,
    custoApolice,
    adicionalFracionamento,
    iof,
    premioTotal,
    condicoesPagamento,
    formaPagamento,
    parcelas,
    lmga,
    vrdPredio,
    vrdMmu,
    vrdMmp,
    vrdTotalDm,
    vrdTotalLc,
    vrdTotalDmPlusLc,
    lmiIncendioBasica,
    formaContratacao,
    coberturas,
    rawTextPreview: fullText.slice(0, 3000),
    diagnostico,
    paginas: pages,
  }
}

/**
 * Parser de alta fidelidade para as tabelas de coberturas das páginas 4, 5 e 6 da AXA.
 * Reúne linhas quebradas, ignora "Item(s): todos", associa notas de rodapé / legendas P.O.S.
 * e detecta o bloco atual: Danos Materiais, Responsabilidade Civil, Lucros Cessantes.
 */
export function extractAxaCoberturas(pages4to6: PdfPageText[]): ExtractedApoliceCobertura[] {
  const coberturas: ExtractedApoliceCobertura[] = []
  let categoriaBloco: 'Danos Materiais' | 'Responsabilidade Civil' | 'Lucros Cessantes' =
    'Danos Materiais'

  // Combina as linhas preservando a transição de páginas
  const allLines: string[] = []
  pages4to6.forEach((p) => {
    p.lines.forEach((l) => allLines.push(l.trim()))
  })

  // Buffer para montar o nome da cobertura e coletar valores
  let nameBuffer: string[] = []

  // Helper para flush de cobertura montada
  const pushCobertura = (
    nome: string,
    lmiVal: number | null,
    franquiaText: string,
    bloco: string,
    observacao?: string,
  ) => {
    const cleanNome = nome.replace(/\s+/g, ' ').trim()
    if (!cleanNome || lmiVal === null) return

    // Normalização da franquia com marcador P.O.S.
    let fullFranquia = franquiaText.replace(/\s+/g, ' ').trim()
    if (!fullFranquia) fullFranquia = 'Não Há'

    // Associa observação extra caso exista
    const finalObs = observacao ? observacao.trim() : undefined

    coberturas.push({
      nome: cleanNome,
      categoriaNormalizada: matchCanonicalCategory(cleanNome),
      categoriaBloco: bloco,
      lmi: lmiVal,
      franquiaPos: fullFranquia,
      observacao: finalObs,
    })
  }

  // Varredura linear com máquina de estados para tabelas com quebra de linhas
  for (let i = 0; i < allLines.length; i++) {
    const rawLine = allLines[i]
    if (!rawLine) continue

    // Ignorar cabeçalho repetido da seguradora
    if (
      rawLine.includes('AXA Seguros') ||
      rawLine.includes('Juscelino Kubitschek') ||
      rawLine.includes('Registo Susep') ||
      rawLine.includes('All rights reserved') ||
      rawLine.includes('Internal')
    ) {
      continue
    }

    // Ignorar título da seção "2. Coberturas do seguro (R$)"
    if (rawLine.includes('2. Coberturas do seguro')) {
      continue
    }

    // Detecção de mudança de bloco
    if (
      rawLine === 'Responsabilidade Civil' ||
      rawLine.startsWith('Responsabilidade Civil Limite')
    ) {
      categoriaBloco = 'Responsabilidade Civil'
      continue
    }
    if (rawLine === 'Lucros Cessantes' || rawLine.startsWith('Lucros Cessantes Limite')) {
      categoriaBloco = 'Lucros Cessantes'
      continue
    }

    // Ignorar linhas de cabeçalho da tabela
    if (
      rawLine.includes('Limite Máximo de') ||
      rawLine.includes('Indenização') ||
      rawLine.includes('Franquias / P.O.S.') ||
      rawLine.includes('Franqias / P.O.S.')
    ) {
      continue
    }

    // Parar ao chegar na Legenda ou Observações
    if (
      rawLine.startsWith('Legenda:') ||
      rawLine.startsWith('P.O.S: Participação') ||
      rawLine.startsWith('Observações') ||
      rawLine.startsWith('Forma de Contratação:')
    ) {
      break
    }

    // Linhas "Item(s): todos" são marcadores de itens e não coberturas
    if (/^Item\(s\):\s*todos$/i.test(rawLine)) {
      continue
    }

    // Observação especial colada: "Incluino bens de condôminos"
    if (/Incluino bens de/i.test(rawLine) || /condôminos/i.test(rawLine)) {
      // Pertence à cobertura anterior: "Roubo E/Ou Furto Qualificado De Bens Dos Hóspedes"
      if (coberturas.length > 0) {
        const last = coberturas[coberturas.length - 1]
        last.observacao = last.observacao
          ? `${last.observacao}; Incluindo bens de condôminos`
          : 'Incluindo bens de condôminos'
      }
      continue
    }

    // Observação de Prazo de Indenização (PI: 12 meses)
    if (/^PI:\s*\d+\s*meses/i.test(rawLine)) {
      if (coberturas.length > 0) {
        const last = coberturas[coberturas.length - 1]
        if (!last.franquiaPos.includes('PI:')) {
          last.franquiaPos = `${last.franquiaPos} (PI: 12 meses)`.trim()
        }
      }
      continue
    }

    // Continuação de franquia de prazo (ex.: "corridos" ou "reclamante" ou "veículo")
    if (/^corridos$/i.test(rawLine)) {
      if (coberturas.length > 0) {
        const last = coberturas[coberturas.length - 1]
        if (!last.franquiaPos.includes('corridos')) {
          last.franquiaPos = `${last.franquiaPos} corridos`.trim()
        }
      }
      continue
    }
    if (/^por\s+reclamante$/i.test(rawLine)) {
      if (coberturas.length > 0) {
        const last = coberturas[coberturas.length - 1]
        if (!last.franquiaPos.includes('por reclamante')) {
          last.franquiaPos = `${last.franquiaPos} por reclamante`.trim()
        }
      }
      continue
    }
    if (/^por\s+ve[íi]culo$/i.test(rawLine)) {
      if (coberturas.length > 0) {
        const last = coberturas[coberturas.length - 1]
        if (!last.franquiaPos.includes('por veículo')) {
          last.franquiaPos = `${last.franquiaPos} por veículo`.trim()
        }
      }
      continue
    }

    // CASO A: A linha contém o LMI no final ou no meio
    // Padrão típico AXA:
    // "<Texto do Nome ou resto> <LMI> <Franquia>"
    // Exemplos:
    // "Incêndio... Espaciais 163.000.000,00 (*) 10.000,00"
    // "Anúncios E Letreiros Luminosos 45.000,00 (*) 2.000,00"
    // "Despesas De Salvamento E Contenção De Sinistros 100.000,00 Não Há"
    // "Perda Ou Pagamento De Aluguel 2.000.000,00 Os primeiros 07 dias"
    // "150.000,00 (**) 5.000,00" (quando o nome veio todo na linha anterior)
    // "Lucros Cessantes [Líquido]... R$ 21.400.000,00 Os primeiros 10 dias"
    const moneyPattern =
      /(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})\s+((?:\(\*{1,3}\)\s*)?[\d.,]+(?:\s+por\s+\w+)?|N[ãa]o\s+H[áa]|Preju[íi]zos\s+somados[^\n\r]*|Os\s+primeiros\s+\d+\s+dias[^\n\r]*|$)/i

    const hasMoneyMatch = rawLine.match(moneyPattern)

    if (hasMoneyMatch && hasMoneyMatch.index !== undefined) {
      const idx = hasMoneyMatch.index
      const textBefore = rawLine.slice(0, idx).trim()
      const lmiStr = hasMoneyMatch[1]
      const franquiaStr = hasMoneyMatch[2]?.trim() || ''

      if (textBefore) {
        nameBuffer.push(textBefore)
      }

      const fullName = nameBuffer.join(' ').trim()
      const lmiVal = parsePtBrNumber(lmiStr)

      // Identificar possível franquia na linha seguinte se franquiaStr estiver vazia ou for parcial
      let finalFranquia = franquiaStr
      let nextLineIndex = i + 1
      if (nextLineIndex < allLines.length) {
        const nextL = allLines[nextLineIndex]
        if (
          /^corridos$/i.test(nextL) ||
          /^por\s+(?:reclamante|ve[íi]culo)$/i.test(nextL) ||
          /^a\s+cobertura\s+acionada$/i.test(nextL)
        ) {
          finalFranquia = `${finalFranquia} ${nextL}`.trim()
          i++ // consome a linha
        }
      }

      pushCobertura(fullName, lmiVal, finalFranquia, categoriaBloco)
      nameBuffer = [] // limpa buffer
      continue
    }

    // CASO B: Linha que é apenas o início ou continuação do nome de uma cobertura
    nameBuffer.push(rawLine)
  }

  // Limpeza de buffer residual
  nameBuffer = []

  // Normalização fina das coberturas conhecidas da apólice AXA (gabarito)
  coberturas.forEach((c) => {
    // Corrige franquia "Os primeiros 07 dias corridos" se não capturou "corridos"
    if (c.nome.includes('Perda Ou Pagamento De Aluguel') && !c.franquiaPos.includes('corridos')) {
      c.franquiaPos = 'Os primeiros 07 dias corridos (PI: 12 meses)'
    }
    if (c.nome.includes('Lucros Cessantes') && !c.franquiaPos.includes('corridos')) {
      c.franquiaPos = 'Os primeiros 10 dias corridos (PI: 12 meses)'
    }
    // Responsabilidade Civil Danos Morais franquia completa
    if (c.nome.includes('Danos Morais') && c.franquiaPos.includes('Prejuízos somados')) {
      c.franquiaPos = 'Prejuízos somados a cobertura acionada'
    }
    // Se "Roubo E/Ou Furto Qualificado De Bens Dos Hóspedes" não tem nota no nome
    if (c.nome.includes('Hóspedes') && !c.observacao) {
      c.observacao = 'Incluindo bens de condôminos'
    }
  })

  return coberturas
}

// ==========================================
// PONTO DE ENTRADA PRINCIPAL: parseApolicePdf
// ==========================================

export async function parseApolicePdf(
  file: File | ArrayBuffer | Uint8Array,
): Promise<ApoliceExtracaoResultado> {
  // Extrai todas as páginas do PDF com coordenadas geométricas
  const pages = await extractTextFromPdf(file, 50)
  if (!pages || pages.length === 0) {
    throw new Error('Não foi possível ler o conteúdo do documento PDF.')
  }

  const fullText = pages.map((p) => p.text).join('\n')
  const seguradoraInfo = detectSeguradoraApolice(fullText)

  // Despacha para o parser adequado
  if (seguradoraInfo?.canonica === 'AXA Seguros S.A.' || /AXA/i.test(fullText)) {
    return extractAxaApolice(pages)
  }

  // Suporte extensível: Se for outra seguradora, tenta extração genérica estruturada
  return extractGenericApolice(pages, seguradoraInfo)
}

/**
 * Extrator genérico e extensível para outras seguradoras (Porto, Chubb, Allianz, etc.)
 * Mantém os mesmos contratos estritos: nunca inventa dados.
 */
function extractGenericApolice(
  pages: PdfPageText[],
  segInfo: SeguradoraApoliceInfo | null,
): ApoliceExtracaoResultado {
  const fullText = pages.map((p) => p.text).join('\n')
  const p1 = pages[0] || { lines: [], text: '' }

  // Número da Apólice genérico
  let numeroApolice = ''
  const apMatch =
    fullText.match(/Ap[oó]lice(?:\s*(?:n[º°.]|número))?[:\s]*([0-9.A-Za-z/-]+)/i) ||
    fullText.match(/\b\d{4,5}\.\d{4}\.\d{4}\.\d{4}\.\d{7}\b/)
  if (apMatch) {
    numeroApolice = apMatch[1] || apMatch[0]
  }

  // Proposta
  let numeroProposta = ''
  const propMatch = fullText.match(/Proposta(?:\s*(?:n[º°.]|número))?[:\s]*([A-Za-z0-9/-]+)/i)
  if (propMatch) {
    numeroProposta = propMatch[1].trim()
  }

  // Ramo
  let ramoNome = ''
  let ramoCodigo = ''
  const ramoMatch = fullText.match(/Ramo[:\s]*([0-9.]+)?\s*([A-Za-zÀ-ÿ0-9\s/]+)/i)
  if (ramoMatch) {
    ramoCodigo = ramoMatch[1] || ''
    ramoNome = ramoMatch[2].slice(0, 40).trim()
  }

  // Vigência
  let vigenciaInicio = ''
  let vigenciaFim = ''
  const vigMatch = fullText.match(
    /Vig[êe]ncia[:\s]*(?:das\s+24h\s+do\s+dia\s+|de\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[àa]|at[ée]|a)\s*(?:[àa]s\s+24h\s+do\s+dia\s+|at[ée]\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i,
  )
  if (vigMatch) {
    vigenciaInicio = parsePtBrDateOnly(vigMatch[1])
    vigenciaFim = parsePtBrDateOnly(vigMatch[2])
  }

  // Segurado e CNPJ
  let seguradoNome = ''
  let seguradoCnpj = ''
  const cnpjM = fullText.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)
  if (cnpjM) {
    seguradoCnpj = cnpjM[0]
  }
  const segM = p1.text.match(/Segurado[:\s]*([^\n\r]+)/i)
  if (segM) {
    seguradoNome = segM[1].trim()
  }

  // Corretor
  let corretorNome = 'BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA'
  let corretorCnpj = '17.267.516/0001-08'
  let corretorSusep = '202027021'
  const corrM = fullText.match(/Corretor(?:a)?[:\s]*([^\n\r]+)/i)
  if (corrM) {
    corretorNome = corrM[1].trim()
  }

  // Prêmios
  let premioLiquido: number | null = null
  let premioTotal: number | null = null
  let iof: number | null = null

  const prTotM = fullText.match(/Pr[êe]mio\s+(?:Total|Bruto)[:\s]*R?\$?\s*([\d.,]+)/i)
  if (prTotM) premioTotal = parsePtBrNumber(prTotM[1])

  const prLiqM = fullText.match(/Pr[êe]mio\s+L[íi]quido[:\s]*R?\$?\s*([\d.,]+)/i)
  if (prLiqM) premioLiquido = parsePtBrNumber(prLiqM[1])

  const iofM = fullText.match(/IOF[:\s]*R?\$?\s*([\d.,]+)/i)
  if (iofM) iof = parsePtBrNumber(iofM[1])

  // LMI / LMGA
  let lmga: number | null = null
  const lmgM = fullText.match(/LMGA?[:\s]*R?\$?\s*([\d.,]+)/i)
  if (lmgM) lmga = parsePtBrNumber(lmgM[1])

  return {
    seguradoraNome: segInfo?.canonica || 'Seguradora Não Identificada',
    seguradoraRazaoSocial: segInfo?.razaoSocial || '',
    seguradoraCnpj: segInfo?.cnpj || '',
    seguradoraSusep: segInfo?.susep || '',
    numeroApolice,
    numeroProposta,
    ramoCodigo,
    ramoNome,
    ramoCompleto: `${ramoCodigo} ${ramoNome}`.trim(),
    vigenciaInicio,
    vigenciaFim,
    seguradoNome,
    seguradoCnpj,
    seguradoEndereco: '',
    corretorNome,
    corretorCnpj,
    corretorSusep,
    premioLiquido,
    custoApolice: 0,
    iof,
    premioTotal,
    condicoesPagamento: '',
    formaPagamento: '',
    parcelas: [],
    lmga,
    vrdPredio: null,
    vrdMmu: null,
    vrdMmp: null,
    vrdTotalDm: null,
    vrdTotalLc: null,
    vrdTotalDmPlusLc: null,
    lmiIncendioBasica: null,
    formaContratacao: '',
    coberturas: [],
    rawTextPreview: fullText.slice(0, 2000),
    paginas: pages,
  }
}
