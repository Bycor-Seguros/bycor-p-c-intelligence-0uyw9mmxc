import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'
import { CATEGORIAS_48 } from '@/lib/formatters'
import {
  executeWithRetry,
  isRecordIdentical,
  normalizeHeader,
  normalizeMatchText,
  matchesEmpreendimento,
  buildSinistroDedupeKey,
} from '@/services/guardiaImporter'
import { normalizarSeguradora, normalizarNomeSeguradoraSync } from '@/services/seguradoraNormalizer'

// ==========================================
// TIPAGEM DO OBJETO ESTRUTURADO CARTÃO DE RISCO
// ==========================================

export interface RiskCardContact {
  nome: string
  telefone: string
  email: string
}

export interface RiskCardCossegurado {
  cnpj: string
  razaoSocial: string
}

export interface RiskCardSinistro {
  ano: string
  cobertura: string
  valorIndenizado: number | null
  descricao: string
  rawText: string
}

export interface RiskCardVRD {
  percentualIncc: number | null
  inccLabel: string
  predioAtual: number | null
  predioAtualizado: number | null
  danoMaterialMmuAtual: number | null
  danoMaterialMmuAtualizado: number | null
  mmpAtual: number | null
  mmpAtualizado: number | null
  totalAtual: number | null
  totalAtualizado: number | null
  lucrosCessantesAtual: number | null
  lucrosCessantesAtualizado: number | null
  vrdTotalAtual: number | null
  vrdTotalAtualizado: number | null
}

export interface RiskCardCoberturaItem {
  numero: number
  nomeOriginal: string
  categoriaNormalizada: string
  isAtual: number | null
  isAtualizada: number | null
  isEscolhida: number | null
  observacao: string
}

export interface RiskCardConstrucao {
  tipoConstrucao: string
  placasFotovoltaicas: boolean
  placasFotovoltaicasValor?: string
  placasFotovoltaicasLocal?: string
  isopainel: boolean
  telhadoTermoacustico: boolean
  patrimonioHistorico: boolean
  riscoLocalizadoEm: string
  quantidadeAndares: string
  anoConstrucao: number | null
  areaConstruidaM2: string
  numAptosUnidades: string
  estacionamento: string
  elevadores: string
  escadasRolantes: string
  piscina: boolean
  equipamentos: string
  mercadoriasEstocadas: string
  inflamaveis: string
}

export interface RiskCardLucrosCessantes {
  contrataLucrosCessantes: boolean
  planoContinuidade: boolean
  equipamentosCriticos: string
  licencasSanitarias: string
  inventarioEstoque: string
  empresaUnica: string
}

export interface RiskCardData {
  segurado: string
  cnpj: string
  endereco: string
  atividade: string
  atividadeExercida: string
  inicioAtividades: string
  contato: RiskCardContact
  localRisco: string
  vigenciaInicio: string
  vigenciaFim: string
  tipoCobertura: string // 'Prédio' | 'Conteúdo' | 'Prédio + Conteúdo'
  clausulaBeneficiaria: string
  cossegurados: RiskCardCossegurado[]

  // Bloco Seguro
  seguroNovo: boolean
  seguroRenovacao: boolean
  seguradoraAnterior: string
  numeroApoliceAnterior: string
  possuiOutrosSeguros: boolean
  outrosSegurosDetalhe: string
  possuiHistoricoSinistros: boolean
  sinistros: RiskCardSinistro[]

  // Checklists
  protecaoIncendio: Record<string, boolean | string>
  protecaoRoubo: Record<string, boolean | string>
  construcao: RiskCardConstrucao
  lucrosCessantes: RiskCardLucrosCessantes
  vrd: RiskCardVRD
  coberturas: RiskCardCoberturaItem[]

  // Metadados do arquivo
  sheetName: string
  fileName: string
}

// ==========================================
// RESULTADO DO CASAMENTO (DEDUPLICAÇÃO)
// ==========================================

export type MatchOutcomeType = 'RENOVACAO' | 'NOVO_PRODUTO' | 'CLIENTE_NOVO'

export interface DivergenciaField {
  campo: string
  valorApoliceVigente: string | number
  valorCartaoRisco: string | number
  descricao: string
}

export interface RiskCardMatchResult {
  outcome: MatchOutcomeType
  matchedEmpreendimentoId?: string
  matchedEmpreendimentoNome?: string
  matchedEmpreendimentoCnpj?: string
  matchedApoliceId?: string
  matchedApoliceNumero?: string
  matchedApoliceRamo?: string
  produtoCartao: string
  ramoCanonicaCartao: string
  motivo: string
  divergencias: DivergenciaField[]
}

export interface RiskCardImportSummary {
  success: boolean
  outcome: MatchOutcomeType
  empreendimentoId: string
  apoliceId?: string
  documentoId?: string
  createdCount: number
  updatedCount: number
  unchangedCount: number
  sinistrosCreated: number
  sinistrosUnchanged: number
  coberturasCreated: number
  coberturasUpdated: number
  coberturasUnchanged: number
  divergenciasRecorded: number
  auditoriaRodadaId?: string
  errors: string[]
}

// ==========================================
// FUNÇÕES AUXILIARES DE PARSER
// ==========================================

function cleanCnpj(raw: string): string {
  if (!raw) return ''
  return raw.replace(/\D/g, '')
}

function parseCellNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return isNaN(val) ? null : val
  const str = String(val).trim().replace(/\./g, '').replace(',', '.')
  const num = parseFloat(str)
  return isNaN(num) ? null : num
}

function isChecked(text: unknown): boolean {
  if (!text) return false
  const s = String(text).toLowerCase()
  return /\(\s*[xX✓✔]\s*\)/.test(s) || /\[\s*[xX✓✔]\s*\]/.test(s)
}

function extractCheckedOption(text: unknown, options: string[]): string {
  const s = String(text || '')
  for (const opt of options) {
    const regex = new RegExp(`\\(\\s*[xX✓✔]\\s*\\)\\s*${opt}`, 'i')
    if (regex.test(s)) return opt
  }
  return ''
}

// Extrai data ou período (ex: "28.07.2026 a 28.07.2027" ou "01.11.2026")
function parseVigencia(text: string): { inicio: string; fim: string } {
  if (!text) return { inicio: '', fim: '' }
  const clean = text.replace(/[\t\r\n]+/g, ' ').trim()
  const dates = clean.match(/\d{2}[./-]\d{2}[./-]\d{4}/g)
  if (!dates || dates.length === 0) return { inicio: '', fim: '' }

  const toIso = (dStr: string) => {
    const parts = dStr.split(/[./-]/)
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    }
    return dStr
  }

  if (dates.length >= 2) {
    return { inicio: toIso(dates[0]), fim: toIso(dates[1]) }
  }
  return { inicio: toIso(dates[0]), fim: '' }
}

// Mapeamento tolerante de categoria para as 48 categorias canônicas
export function matchCanonicalCategory(rawName: string): string {
  const norm = normalizeMatchText(rawName)
  if (!norm) return rawName

  // Mapeamentos diretos conhecidos do Cartão de Risco
  // Atenção: coberturas de Responsabilidade Civil com menção a incêndio (ex: "RC guarda de veículos com incêndio e roubo")
  // NÃO devem ser classificadas como Incêndio Básica.
  if (norm.includes('guarda de veiculos')) {
    return 'RC Guarda de Veículos de Terceiros'
  }
  if (norm.includes('incendio') || norm.includes('basica') || norm.includes('queda de raio')) {
    return 'Incêndio Básica (Danos Materiais)'
  }
  if (norm.includes('alagamento') && !norm.includes('inundacao')) {
    return 'Alagamento/Inundação'
  }
  if (norm.includes('inundacao')) {
    return 'Alagamento/Inundação'
  }
  if (norm.includes('danos eletricos') || norm.includes('eletrico')) {
    return 'Danos Elétricos'
  }
  if (
    norm.includes('vendaval') ||
    norm.includes('granizo') ||
    norm.includes('cicline') ||
    norm.includes('ciclone')
  ) {
    return 'Vendaval/Granizo/Ciclone/Fumaça'
  }
  if (norm.includes('vidros') || norm.includes('espelhos') || norm.includes('marmores')) {
    return 'Quebra de Vidros/Espelhos/Mármores'
  }
  if (norm.includes('anuncios') || norm.includes('paineis') || norm.includes('letreiros')) {
    return 'Anúncios/Letreiros Luminosos'
  }
  if (norm.includes('recomposicao de registros') || norm.includes('documentos')) {
    return 'Recomposição de Registros/Documentos'
  }
  if (
    norm.includes('roubo') &&
    (norm.includes('segurado') || norm.includes('qualificado de bens'))
  ) {
    return 'Roubo/Furto de Bens do Segurado'
  }
  if (norm.includes('hospedes') || norm.includes('hospede')) {
    return 'Roubo/Furto de Bens/Valores de Hóspedes'
  }
  if (
    norm.includes('valores') &&
    (norm.includes('interior') || norm.includes('transito') || norm.includes('folha'))
  ) {
    return 'Roubo/Furto de Valores (Interior/Trânsito)'
  }
  if (norm.includes('fidelidade')) {
    return 'Fidelidade de Funcionários'
  }
  if (
    norm.includes('tumultos') ||
    norm.includes('greves') ||
    norm.includes('lock out') ||
    norm.includes('lockout')
  ) {
    return 'Tumultos/Greves/Lock-out/Vandalismo'
  }
  if (norm.includes('salvamento') || norm.includes('contencao')) {
    return 'Despesas de Salvamento e Contenção'
  }
  if (norm.includes('desmoronamento')) {
    return 'Desmoronamento'
  }
  if (
    norm.includes('demolicao') ||
    norm.includes('desentulho') ||
    norm.includes('remocao de entulhos')
  ) {
    return 'Demolição e Desentulho'
  }
  if (norm.includes('tubulacoes') || norm.includes('hidraulicas') || norm.includes('rompimento')) {
    return 'Vazamento/Rompimento de Tanques e Tubulações'
  }
  if (
    norm.includes('chuveiros automaticos') ||
    norm.includes('sprinklers') ||
    norm.includes('danos por agua')
  ) {
    return 'Danos por Água / Sprinklers'
  }
  if (norm.includes('quebra de maquinas')) {
    return 'Quebra de Máquinas'
  }
  if (norm.includes('eletronico') || norm.includes('eletronicos')) {
    return 'Equipamentos Eletrônicos'
  }
  if (
    (norm.includes('movel') || norm.includes('moveis')) &&
    (norm.includes('equipamento') || norm.includes('equipamentos'))
  ) {
    return 'Equipamentos Móveis'
  }
  if (
    (norm.includes('estacionario') || norm.includes('estacionarios')) &&
    (norm.includes('equipamento') || norm.includes('equipamentos'))
  ) {
    return 'Equipamentos Estacionários'
  }
  if (
    (norm.includes('portatil') || norm.includes('portateis')) &&
    (norm.includes('equipamento') ||
      norm.includes('equipamentos') ||
      norm.includes('objeto') ||
      norm.includes('objetos'))
  ) {
    return 'Equipamentos Portáteis'
  }
  if (norm.includes('arrendados') || norm.includes('cedidos')) {
    return 'Equipamentos Arrendados/Cedidos a Terceiros'
  }
  if (norm.includes('frigorificados') || norm.includes('deterioracao')) {
    return 'Deterioração de Mercadorias (Frigorificados)'
  }
  if (norm.includes('aluguel') && (norm.includes('perda') || norm.includes('pagamento'))) {
    return 'Perda/Pagamento de Aluguel'
  }
  if (
    norm.includes('lucros cessantes') ||
    norm.includes('lucro bruto') ||
    norm.includes('perda de lucro bruto') ||
    norm.includes('despesas fixas')
  ) {
    return 'Lucros Cessantes / Perda de Receita'
  }
  if (
    norm.includes('incendio e complementares') ||
    (norm.includes('incendio') && norm.includes('complementares'))
  ) {
    return 'Incêndio Básica (Danos Materiais)'
  }
  if (norm.includes('honorarios') && norm.includes('peritos')) {
    return 'Honorários de Peritos'
  }
  if (norm.includes('pequenas obras') || norm.includes('engenharia')) {
    return 'Obras Civis/Pequenas Obras de Engenharia'
  }
  if (norm.includes('despesas com instalacao') || norm.includes('novo local')) {
    return 'Despesas com Instalação em Novo Local'
  }
  if (norm.includes('queimadas')) {
    return 'Incêndio Decorrente de Queimadas em Zonas Rurais'
  }
  if (norm.includes('linhas de transmissao')) {
    return 'Linhas de Transmissão'
  }
  if (norm.includes('obras de arte')) {
    return 'Obras de Arte'
  }
  if (norm.includes('resp civil operacoes') || norm.includes('rc operacoes')) {
    return 'RC Operações (Estabelecimentos Comerciais/Industriais)'
  }
  if (norm.includes('hospedagem') && norm.includes('restaurantes')) {
    return 'RC Hospedagem/Restaurantes/Bares'
  }
  if (norm.includes('danos morais')) {
    return 'RC Danos Morais'
  }
  if (norm.includes('impacto de veiculos')) {
    return 'Impacto de Veículos'
  }
  if (norm.includes('guarda de veiculos') || norm.includes('veiculo')) {
    return 'RC Guarda de Veículos de Terceiros'
  }
  if (norm.includes('portoes') || norm.includes('portao')) {
    return 'RC Portões Automáticos'
  }
  if (norm.includes('empregador')) {
    return 'RC Empregador'
  }
  if (norm.includes('sindico')) {
    return 'RC Síndico'
  }
  if (norm.includes('condominio') && norm.includes('resp')) {
    return 'RC Condomínio'
  }
  if (norm.includes('bens de terceiros')) {
    return 'Bens de Terceiros em Poder do Segurado'
  }
  if (norm.includes('exposicao')) {
    return 'Mercadorias em Exposição'
  }

  // Fallback para casamento por tokens com a lista CATEGORIAS_48
  for (const cat of CATEGORIAS_48) {
    const catNorm = normalizeMatchText(cat)
    if (catNorm === norm || norm.includes(catNorm) || catNorm.includes(norm)) {
      return cat
    }
  }

  return rawName.trim()
}

// Extrai histórico de sinistro de linhas livres do cartão
function parseSinistroLine(line: string): RiskCardSinistro | null {
  if (!line || !line.trim()) return null
  const str = line.trim()
  // Padrões como: "2023 : Vendaval --> Indenização 7.000,00"
  // ou "2024: Danos Elétricos (Placa IGBT) - --> Indenização 18.000,00"
  const anoMatch = str.match(/\b(19\d{2}|20\d{2})\b/)
  const ano = anoMatch ? anoMatch[1] : ''

  // Procura valor após "indenizacao" ou setas "-->" ou no fim
  let valor: number | null = null
  const valorMatch =
    str.match(/indeniza[cç][aã]o\s*[:\s-]*\s*([0-9.,]+)/i) ||
    str.match(/r\$\s*([0-9.,]+)/i) ||
    str.match(/[-–—>]+\s*([0-9.,]+)\s*$/)

  if (valorMatch) {
    valor = parseCellNumber(valorMatch[1])
  }

  // Cobertura e descrição
  let cobertura = ''
  let descricao = str
  const splitSeta = str.split(/-->|–|—|->/)
  if (splitSeta.length > 0) {
    const leftPart = splitSeta[0]
      .replace(ano, '')
      .replace(/[:\s]+/, '')
      .trim()
    cobertura = leftPart
  }

  return {
    ano,
    cobertura: cobertura || 'Sinistro Declarado',
    valorIndenizado: valor,
    descricao: str,
    rawText: str,
  }
}

// ==========================================
// PARSER DO ARQUIVO XLSX DO CARTÃO DE RISCO
// ==========================================

export function isRiskCardWorkbook(workbook: XLSX.WorkBook): boolean {
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) return false
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  if (!sheet) return false

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!rawRows || rawRows.length < 20) return false

  // Procura rótulos característicos do Cartão de Risco na coluna A ou B
  let matchesCount = 0
  const scanLimit = Math.min(rawRows.length, 120)
  for (let r = 0; r < scanLimit; r++) {
    const row = rawRows[r]
    if (!Array.isArray(row)) continue
    const textA = normalizeMatchText(row[0])
    const textB = normalizeMatchText(row[1])
    const combined = `${textA} ${textB}`

    if (combined.includes('dados') || combined.includes('segurado')) matchesCount++
    if (combined.includes('local de risco')) matchesCount++
    if (combined.includes('vigencia para')) matchesCount++
    if (combined.includes('tipo de seguro')) matchesCount++
    if (combined.includes('protecao contra incendio') || combined.includes('protecao contra roubo'))
      matchesCount++
    if (combined.includes('construcao') || combined.includes('tipo de construcao')) matchesCount++
    if (combined.includes('valor em risco declarado') || combined.includes('vrd')) matchesCount++
    if (combined.includes('coberturas')) matchesCount++
  }

  return matchesCount >= 4
}

export function parseRiskCardWorkbook(workbook: XLSX.WorkBook, fileName: string): RiskCardData {
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  const result: RiskCardData = {
    segurado: '',
    cnpj: '',
    endereco: '',
    atividade: '',
    atividadeExercida: '',
    inicioAtividades: '',
    contato: { nome: '', telefone: '', email: '' },
    localRisco: '',
    vigenciaInicio: '',
    vigenciaFim: '',
    tipoCobertura: 'Prédio + Conteúdo',
    clausulaBeneficiaria: '',
    cossegurados: [],
    seguroNovo: false,
    seguroRenovacao: false,
    seguradoraAnterior: '',
    numeroApoliceAnterior: '',
    possuiOutrosSeguros: false,
    outrosSegurosDetalhe: '',
    possuiHistoricoSinistros: false,
    sinistros: [],
    protecaoIncendio: {},
    protecaoRoubo: {},
    construcao: {
      tipoConstrucao: '',
      placasFotovoltaicas: false,
      isopainel: false,
      telhadoTermoacustico: false,
      patrimonioHistorico: false,
      riscoLocalizadoEm: '',
      quantidadeAndares: '',
      anoConstrucao: null,
      areaConstruidaM2: '',
      numAptosUnidades: '',
      estacionamento: '',
      elevadores: '',
      escadasRolantes: '',
      piscina: false,
      equipamentos: '',
      mercadoriasEstocadas: '',
      inflamaveis: '',
    },
    lucrosCessantes: {
      contrataLucrosCessantes: false,
      planoContinuidade: false,
      equipamentosCriticos: '',
      licencasSanitarias: '',
      inventarioEstoque: '',
      empresaUnica: '',
    },
    vrd: {
      percentualIncc: null,
      inccLabel: '',
      predioAtual: null,
      predioAtualizado: null,
      danoMaterialMmuAtual: null,
      danoMaterialMmuAtualizado: null,
      mmpAtual: null,
      mmpAtualizado: null,
      totalAtual: null,
      totalAtualizado: null,
      lucrosCessantesAtual: null,
      lucrosCessantesAtualizado: null,
      vrdTotalAtual: null,
      vrdTotalAtualizado: null,
    },
    coberturas: [],
    sheetName,
    fileName,
  }

  let inCosseguradosBlock = false
  let inCoberturasBlock = false
  let currentSection = ''

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!Array.isArray(row)) continue

    const colA = String(row[0] || '').trim()
    const colB = String(row[1] || '').trim()
    const colC = String(row[2] || '').trim()
    const colD = String(row[3] || '').trim()
    const colE = String(row[4] || '').trim()
    const colF = String(row[5] || '').trim()
    const colG = String(row[6] || '').trim()

    const normA = normalizeMatchText(colA)
    const normC = normalizeMatchText(colC)
    const rowFullText = `${colA} ${colB} ${colC} ${colD} ${colE} ${colF} ${colG}`

    // Fim de blocos
    if (normA.startsWith('seguro') || normA.includes('historico de sinistro')) {
      inCosseguradosBlock = false
    }

    // Identificação básica (Linhas 1 a 20)
    if (normA === 'segurado') {
      // Valor pode estar em colC; às vezes o CNPJ vem concatenado: "Condomínio X - 24.742.208/0002-25"
      const val = colC || colB || colD
      result.segurado = val
      const cnpjMatch = val.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
      if (cnpjMatch) {
        result.cnpj = cnpjMatch[0]
      }
    } else if (normA === 'cnpj') {
      const val = colC || colB || colD
      const cnpjMatch = val.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
      if (cnpjMatch) {
        result.cnpj = cnpjMatch[0]
      } else if (val) {
        result.cnpj = val
      }
    } else if (normA === 'endereco') {
      result.endereco = colC || colD || colB
    } else if (normA === 'atividade') {
      result.atividade = colC || colD || colB
    } else if (normA.includes('atividade exercida')) {
      result.atividadeExercida = colC || colD || colB
    } else if (normA.includes('inicio das atividades')) {
      result.inicioAtividades = colC || colD || colB
    } else if (normA === 'contato') {
      // Linha do contato: ColC rótulo ("Nome" ou "Nome: Jackeline"), ColD valor
      if (normC.includes('nome')) {
        result.contato.nome = colD || colC.replace(/^nome[:\s]*/i, '').trim()
      } else {
        result.contato.nome = colC || colD
      }
    } else if (normC.startsWith('tel') || normC.includes('tel/cel')) {
      result.contato.telefone = colD || colC.replace(/^tel[^:]*[:\s]*/i, '').trim()
    } else if (normC.startsWith('e mail') || normC.startsWith('email')) {
      result.contato.email = colD || colC.replace(/^e-?mail[:\s]*/i, '').trim()
    } else if (normA.includes('local de risco')) {
      result.localRisco = colC || colD || colB
    } else if (normA.includes('vigencia para')) {
      const vig = parseVigencia(colC || colD || colB)
      result.vigenciaInicio = vig.inicio
      result.vigenciaFim = vig.fim
    } else if (normA.includes('tipo de seguro')) {
      const checkPredio = isChecked(colD) && /predio/i.test(colD) && !/conteudo/i.test(colD)
      const checkConteudo = isChecked(colD) && /conteud/i.test(colD)
      const checkAmbos = isChecked(colD) && /predio.*conteud/i.test(colD)
      if (checkAmbos) result.tipoCobertura = 'Prédio + Conteúdo'
      else if (checkConteudo) result.tipoCobertura = 'Conteúdo'
      else if (checkPredio) result.tipoCobertura = 'Prédio'
    } else if (normA.includes('clausula beneficiaria')) {
      result.clausulaBeneficiaria = colC || colD
    } else if (normA.includes('cossegurados')) {
      inCosseguradosBlock = true
      continue
    }

    // Captura de Cossegurados
    if (inCosseguradosBlock && !normA.startsWith('seguro')) {
      const cnpjCell = colC || colB
      const nomeCell = colD || colE
      const cnpjMatch = cnpjCell.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
      if (cnpjMatch || (cleanCnpj(cnpjCell).length === 14 && nomeCell)) {
        result.cossegurados.push({
          cnpj: cnpjMatch ? cnpjMatch[0] : cnpjCell.trim(),
          razaoSocial: nomeCell.trim(),
        })
      }
    }

    // Bloco Seguro: Novo vs Renovação
    const normD = normalizeMatchText(colD)
    if (normA === 'seguro' || normC.includes('novo') || normC.includes('renovacao')) {
      if (isChecked(colC) && /novo/i.test(colC)) result.seguroNovo = true
      if (isChecked(colC) && /renova/i.test(colC)) result.seguroRenovacao = true
    }
    if (normD.includes('seguradora')) {
      const rawSeg = colE || colD.replace(/^seguradora[:\s]*/i, '').trim()
      result.seguradoraAnterior = normalizarNomeSeguradoraSync(rawSeg) || rawSeg
    }
    if (normD.includes('apolice')) {
      result.numeroApoliceAnterior = colE || colD.replace(/^n.*apolice[:\s]*/i, '').trim()
    }
    if (rowFullText.includes('Possui Outros Seguros')) {
      if (isChecked(colE) && /sim/i.test(colE)) {
        result.possuiOutrosSeguros = true
        result.outrosSegurosDetalhe = colF || colG || ''
      }
    }

    // Histórico de sinistro
    if (
      rowFullText.includes('Histórico de Sinistro') ||
      rowFullText.includes('Historico de Sinistro')
    ) {
      if (isChecked(colC) && /sim/i.test(colC)) {
        result.possuiHistoricoSinistros = true
      }
    }
    // Células de sinistro (2023 : Vendaval --> Indenização 7.000,00)
    if (/\b(19\d{2}|20\d{2})\s*:/i.test(rowFullText) || /indeniza[cç][aã]o/i.test(rowFullText)) {
      const rawLine = colE || colD || colC || rowFullText
      const sin = parseSinistroLine(rawLine)
      if (sin && sin.ano) {
        result.possuiHistoricoSinistros = true
        result.sinistros.push(sin)
      }
    }

    // Seção ativa de proteções
    if (
      normA.includes('protecao contra incendio') ||
      normA.includes('protecao contra roubo') ||
      normA.includes('construcao')
    ) {
      if (normA.includes('protecao contra incendio')) {
        currentSection = 'incendio'
      } else if (normA.includes('protecao contra roubo')) {
        currentSection = 'roubo'
      } else if (normA.includes('construcao')) {
        currentSection = 'construcao'
      }
    }

    // Proteção contra Incêndios
    if (currentSection === 'incendio' || normA.includes('protecao contra incendio')) {
      // Se linha não tem rótulo em colC, pode ser continuação ou detalhe
      const rawLabel = colC.replace(/\(\s*[xX✓✔ ]\s*\)/, '').trim()
      const rowChecked = isChecked(colC) || isChecked(colB)
      const subOpts = colF || colE || colD || colG

      if (rawLabel) {
        result.protecaoIncendio[rawLabel] = rowChecked
        if (subOpts) {
          result.protecaoIncendio[`${rawLabel}_detalhe`] = subOpts
        }
      } else if (subOpts && Object.keys(result.protecaoIncendio).length > 0) {
        // Continuação da linha anterior
        const lastKey = Object.keys(result.protecaoIncendio)
          .filter((k) => !k.endsWith('_detalhe'))
          .pop()
        if (lastKey) {
          result.protecaoIncendio[`${lastKey}_detalhe`] =
            (result.protecaoIncendio[`${lastKey}_detalhe`]
              ? `${result.protecaoIncendio[`${lastKey}_detalhe`]}; `
              : '') + subOpts
        }
      }
    }

    // Proteção contra Roubo
    if (currentSection === 'roubo' || normA.includes('protecao contra roubo')) {
      const rawLabel = colC.replace(/\(\s*[xX✓✔ ]\s*\)/, '').trim()
      const rowChecked = isChecked(colC) || isChecked(colB)
      const subOpts = colF || colE || colD || colG

      if (rawLabel) {
        result.protecaoRoubo[rawLabel] = rowChecked
        if (subOpts) {
          result.protecaoRoubo[`${rawLabel}_detalhe`] = subOpts
        }
      } else if (subOpts && Object.keys(result.protecaoRoubo).length > 0) {
        // Continuação da linha anterior (ex: vigilância armada/desarmada / 24h na linha seguinte)
        const lastKey = Object.keys(result.protecaoRoubo)
          .filter((k) => !k.endsWith('_detalhe'))
          .pop()
        if (lastKey) {
          result.protecaoRoubo[`${lastKey}_detalhe`] =
            (result.protecaoRoubo[`${lastKey}_detalhe`]
              ? `${result.protecaoRoubo[`${lastKey}_detalhe`]}; `
              : '') + subOpts
        }
      }
    }

    // Bloco Construção
    if (rowFullText.includes('Tipo de Construção') || rowFullText.includes('Tipo de Construcao')) {
      if (isChecked(colD) && /superior/i.test(colD)) result.construcao.tipoConstrucao = 'Superior'
      else if (isChecked(colD) && /solida/i.test(colD)) result.construcao.tipoConstrucao = 'Sólida'
      else if (isChecked(colD) && /mista/i.test(colD)) result.construcao.tipoConstrucao = 'Mista'
    }
    if (rowFullText.includes('Fotovoltaicas')) {
      result.construcao.placasFotovoltaicas = isChecked(rowFullText) && /sim/i.test(rowFullText)
    }
    if (rowFullText.includes('Isopainel')) {
      result.construcao.isopainel = isChecked(rowFullText) && /sim/i.test(rowFullText)
    }
    if (rowFullText.includes('termo acústica') || rowFullText.includes('termoacustica')) {
      result.construcao.telhadoTermoacustico = isChecked(rowFullText) && /sim/i.test(rowFullText)
    }
    if (
      rowFullText.includes('Patrimônio Histórico') ||
      rowFullText.includes('Patrimonio Historico')
    ) {
      result.construcao.patrimonioHistorico = isChecked(rowFullText) && /sim/i.test(rowFullText)
    }
    if (rowFullText.includes('Quantidade de andares')) {
      result.construcao.quantidadeAndares = colD || colE || colC
    }
    if (rowFullText.includes('Ano de construção') || rowFullText.includes('Ano de construcao')) {
      result.construcao.anoConstrucao = parseCellNumber(colD || colC)
    }
    if (rowFullText.includes('Área Construída') || rowFullText.includes('Area Construida')) {
      result.construcao.areaConstruidaM2 = colD || colC
    }
    if (
      rowFullText.includes('Aptos /Unidades') ||
      (rowFullText.includes('Aptos') && !rowFullText.includes('~'))
    ) {
      result.construcao.numAptosUnidades = colD || colC
    }
    if (rowFullText.includes('Estacionamento')) {
      result.construcao.estacionamento = colD || colE
    }
    if (rowFullText.includes('Elevadores')) {
      result.construcao.elevadores = colD || colE
    }
    if (rowFullText.includes('Escadas Rolantes')) {
      result.construcao.escadasRolantes = colD || colE
    }
    if (rowFullText.includes('Piscina')) {
      // Verifica se a opção Sim está marcada ou se a opção Não está marcada
      const optSim =
        extractCheckedOption(colD, ['Sim']) || extractCheckedOption(rowFullText, ['Sim'])
      const optNao =
        extractCheckedOption(colD, ['Não', 'Nao']) ||
        extractCheckedOption(rowFullText, ['Não', 'Nao'])
      if (optSim) {
        result.construcao.piscina = true
      } else if (optNao) {
        result.construcao.piscina = false
      } else {
        result.construcao.piscina = isChecked(colD) && /sim/i.test(colD) && !/não|nao/i.test(colD)
      }
    }
    if (
      rowFullText.includes('Equipamentos') &&
      (colC.includes('Equipamentos') || colA.includes('Equipamentos'))
    ) {
      result.construcao.equipamentos = colD || colE || ''
    }
    if (rowFullText.includes('Mercadorias Estocadas')) {
      result.construcao.mercadoriasEstocadas = colD || colE
    }
    if (rowFullText.includes('Inflamáveis') || rowFullText.includes('Inflamaveis')) {
      result.construcao.inflamaveis = colD || colE
    }

    // Bloco VRD
    if (
      normA.includes('valor em risco declarado') ||
      normA.includes('vrd') ||
      normC.includes('vrd')
    ) {
      // Cabeçalho de VRD com correção INCC
      const inccMatch =
        rowFullText.match(/(\d+[.,]\d+)\s*%\s*conf\.?\s*incc/i) ||
        rowFullText.match(/incc[^\d]*(\d+[.,]\d+)\s*%/i)
      if (inccMatch) {
        result.vrd.percentualIncc = parseCellNumber(inccMatch[1])
        result.vrd.inccLabel = rowFullText.trim()
      }
    }
    if (normC === 'predio' && (row[3] || row[4])) {
      result.vrd.predioAtual = parseCellNumber(row[3])
      result.vrd.predioAtualizado = parseCellNumber(row[4])
    }
    if (normC.includes('danos materiais') && normC.includes('mmu')) {
      result.vrd.danoMaterialMmuAtual = parseCellNumber(row[3])
      result.vrd.danoMaterialMmuAtualizado = parseCellNumber(row[4])
    }
    if (normC === 'mmp') {
      result.vrd.mmpAtual = parseCellNumber(row[3])
      result.vrd.mmpAtualizado = parseCellNumber(row[4])
    }
    if (normC === 'total' || normC === 'total:') {
      result.vrd.totalAtual = parseCellNumber(row[3])
      result.vrd.totalAtualizado = parseCellNumber(row[4])
    }
    if (normC.includes('lucros cessantes') || normC.includes('desp.fixas')) {
      result.vrd.lucrosCessantesAtual = parseCellNumber(row[3])
      result.vrd.lucrosCessantesAtualizado = parseCellNumber(row[4])
    }
    if (normC.includes('vrd total')) {
      result.vrd.vrdTotalAtual = parseCellNumber(row[3])
      result.vrd.vrdTotalAtualizado = parseCellNumber(row[4])
    }

    // Bloco Coberturas
    if (normA === 'coberturas') {
      inCoberturasBlock = true
      continue
    }

    if (inCoberturasBlock) {
      // Linhas numeradas de coberturas (1..89)
      const numCol = parseCellNumber(colA)
      const nomeCol = colB.trim()
      if (numCol !== null && numCol > 0 && nomeCol) {
        const isAtual = parseCellNumber(row[3])
        const isAtualizada = parseCellNumber(row[4])
        const isEscolhida = parseCellNumber(row[5])
        const obs = String(row[6] || '').trim()

        // Adiciona à lista de coberturas se tiver nome
        const categoriaCanonica = matchCanonicalCategory(nomeCol)
        result.coberturas.push({
          numero: numCol,
          nomeOriginal: nomeCol,
          categoriaNormalizada: categoriaCanonica,
          isAtual,
          isAtualizada,
          isEscolhida,
          observacao: obs,
        })
      }
    }
  }

  // Deduplica se seguro é novo ou renovação com base em valores e campos
  if (!result.seguroNovo && !result.seguroRenovacao) {
    if (result.numeroApoliceAnterior || result.seguradoraAnterior) {
      result.seguroRenovacao = true
    } else {
      result.seguroNovo = true
    }
  }

  return result
}

// ==========================================
// MOTOR DE CASAMENTO E DEDUPLICAÇÃO POR PRODUTO/RAMO
// ==========================================

export async function matchRiskCardAgainstDatabase(
  card: RiskCardData,
): Promise<RiskCardMatchResult> {
  // 1. Identificar o Empreendimento por CNPJ (normalizado) ou por Nome
  const cardCnpjDigits = cleanCnpj(card.cnpj)
  let matchedEmpRecord: Record<string, unknown> | null = null

  if (cardCnpjDigits && cardCnpjDigits.length === 14) {
    try {
      // Busca todos empreendimentos com cnpj preenchido
      const existingEmps = await pb.collection('empreendimentos').getFullList({
        batch: 200,
      })
      for (const e of existingEmps) {
        const empCnpjDigits = cleanCnpj(String(e.cnpj || ''))
        if (empCnpjDigits === cardCnpjDigits) {
          matchedEmpRecord = e as unknown as Record<string, unknown>
          break
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback por Nome de Empreendimento se CNPJ não casou
  if (!matchedEmpRecord) {
    try {
      const allEmps = await pb.collection('empreendimentos').getFullList({ batch: 200 })
      for (const e of allEmps) {
        const nomeBanco = String(e.nome_empreendimento || e.razao_social || '')
        if (matchesEmpreendimento(card.segurado, nomeBanco)) {
          matchedEmpRecord = e as unknown as Record<string, unknown>
          break
        }
      }
    } catch {
      // ignore
    }
  }

  // Deriva produto/ramo do Cartão de Risco
  // Ex: "Prédio + Conteúdo" -> "Riscos Nomeados (Prédio + Conteúdo)" ou "Compreensivo"
  const produtoCartao = card.tipoCobertura || 'Prédio + Conteúdo'
  const ramoCanonicaCartao = produtoCartao.includes('+')
    ? 'Riscos Nomeados (Prédio + Conteúdo)'
    : produtoCartao.includes('Prédio')
      ? 'Riscos Nomeados (Prédio)'
      : 'Empresarial (Conteúdo)'

  // CENÁRIO 3: CLIENTE NOVO
  if (!matchedEmpRecord) {
    return {
      outcome: 'CLIENTE_NOVO',
      produtoCartao,
      ramoCanonicaCartao,
      motivo: `Empreendimento '${card.segurado}' não localizado por CNPJ (${card.cnpj || 'não informado'}) nem por similaridade de nome. Será cadastrado como novo cliente.`,
      divergencias: [],
    }
  }

  const empId = String(matchedEmpRecord.id)
  const empNome = String(
    matchedEmpRecord.nome_empreendimento || matchedEmpRecord.razao_social || card.segurado,
  )
  const empCnpj = String(matchedEmpRecord.cnpj || card.cnpj)

  // 2. Verificar Apólices e Processos existentes deste Empreendimento
  let existingApolices: Array<Record<string, unknown>> = []
  try {
    existingApolices = await pb.collection('apolices').getFullList({
      filter: `id_empreendimento="${empId}"`,
      sort: '-data_fim',
    })
  } catch {
    // ignore
  }

  // Compara produto/ramo: apólices que tratam do mesmo ramo/produto
  let sameProductApolice: Record<string, unknown> | null = null
  for (const ap of existingApolices) {
    const ramoAp = normalizeMatchText(ap.ramo)
    const cardRamoNorm = normalizeMatchText(ramoCanonicaCartao)

    // Se ambos cobrem Prédio + Conteúdo, ou se o ramo coincide
    const isSame =
      ramoAp === cardRamoNorm ||
      (cardRamoNorm.includes('predio') &&
        cardRamoNorm.includes('conteudo') &&
        ramoAp.includes('predio') &&
        ramoAp.includes('conteudo')) ||
      (cardRamoNorm.includes('predio') &&
        !cardRamoNorm.includes('conteudo') &&
        ramoAp.includes('predio') &&
        !ramoAp.includes('conteudo')) ||
      (cardRamoNorm.includes('conteudo') &&
        !cardRamoNorm.includes('predio') &&
        ramoAp.includes('conteudo') &&
        !ramoAp.includes('predio'))

    if (isSame) {
      sameProductApolice = ap
      break
    }
  }

  // CENÁRIO 1: RENOVAÇÃO (Empreendimento existe E produto coincide)
  if (sameProductApolice) {
    const divergencias: DivergenciaField[] = []

    // 1. Identificação / Cadastro
    const cardCnpjStr = card.cnpj ? card.cnpj.trim() : ''
    const apoliceCnpjStr = String(sameProductApolice.cnpj_segurado || '').trim()
    const cardCnpjDig = cleanCnpj(cardCnpjStr)
    const apCnpjDig = cleanCnpj(apoliceCnpjStr)
    if (cardCnpjDig && apCnpjDig && cardCnpjDig !== apCnpjDig) {
      divergencias.push({
        campo: 'CNPJ do Segurado',
        valorApoliceVigente: apoliceCnpjStr,
        valorCartaoRisco: cardCnpjStr,
        descricao: `CNPJ na apólice (${apoliceCnpjStr}) diverge do Cartão de Risco (${cardCnpjStr}).`,
      })
    }

    if (
      card.seguradoraAnterior &&
      card.seguradoraAnterior !== 'A Cotar' &&
      sameProductApolice.seguradora
    ) {
      const segApol = String(sameProductApolice.seguradora).trim().toLowerCase()
      const segCard = card.seguradoraAnterior.trim().toLowerCase()
      if (segApol !== segCard && !segApol.includes(segCard) && !segCard.includes(segApol)) {
        divergencias.push({
          campo: 'Seguradora Anterior / Emitente',
          valorApoliceVigente: String(sameProductApolice.seguradora),
          valorCartaoRisco: card.seguradoraAnterior,
          descricao: `Seguradora vigente é ${sameProductApolice.seguradora} vs ${card.seguradoraAnterior} no Cartão.`,
        })
      }
    }

    if (card.vigenciaInicio && sameProductApolice.data_inicio) {
      const iniApol = String(sameProductApolice.data_inicio).slice(0, 10)
      if (card.vigenciaInicio !== iniApol) {
        divergencias.push({
          campo: 'Início de Vigência',
          valorApoliceVigente: iniApol,
          valorCartaoRisco: card.vigenciaInicio,
          descricao: `Início de vigência na apólice (${iniApol}) diverge do Cartão (${card.vigenciaInicio}).`,
        })
      }
    }

    if (card.vigenciaFim && sameProductApolice.data_fim) {
      const fimApol = String(sameProductApolice.data_fim).slice(0, 10)
      if (card.vigenciaFim !== fimApol) {
        divergencias.push({
          campo: 'Término de Vigência',
          valorApoliceVigente: fimApol,
          valorCartaoRisco: card.vigenciaFim,
          descricao: `Fim de vigência na apólice (${fimApol}) diverge do Cartão (${card.vigenciaFim}).`,
        })
      }
    }

    // 2. VRD por rubrica e LMI Básica
    const apoliceLmiBasica = Number(sameProductApolice.lmi_incendio_basica || 0)
    const cardIsBasica =
      card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isEscolhida ||
      card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isAtualizada ||
      card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isAtual ||
      card.vrd.totalAtualizado ||
      card.vrd.predioAtualizado ||
      0

    if (
      apoliceLmiBasica > 0 &&
      cardIsBasica > 0 &&
      Math.abs(apoliceLmiBasica - Number(cardIsBasica)) > 1000
    ) {
      divergencias.push({
        campo: 'LMI Básica de Incêndio',
        valorApoliceVigente: apoliceLmiBasica,
        valorCartaoRisco: cardIsBasica,
        descricao: `Apólice vigente possui LMI de R$ ${apoliceLmiBasica.toLocaleString('pt-BR')}, enquanto o Cartão de Risco solicita R$ ${Number(cardIsBasica).toLocaleString('pt-BR')}.`,
      })
    }

    const apoliceVrDm = Number(sameProductApolice.valor_em_risco_dm || 0)
    const cardVrDm = Number(
      card.vrd.totalAtualizado ||
        card.vrd.totalAtual ||
        (card.vrd.predioAtualizado || card.vrd.predioAtual || 0) +
          (card.vrd.danoMaterialMmuAtualizado || card.vrd.danoMaterialMmuAtual || 0),
    )
    if (apoliceVrDm > 0 && cardVrDm > 0 && Math.abs(apoliceVrDm - cardVrDm) > 1000) {
      divergencias.push({
        campo: 'Valor em Risco Declarado (VRD Danos Materiais)',
        valorApoliceVigente: apoliceVrDm,
        valorCartaoRisco: cardVrDm,
        descricao: `VRD DM na apólice é R$ ${apoliceVrDm.toLocaleString('pt-BR')} vs R$ ${cardVrDm.toLocaleString('pt-BR')} no Cartão.`,
      })
    }

    const apoliceVrLc = Number(sameProductApolice.valor_em_risco_lc || 0)
    const cardVrLc = Number(
      card.vrd.lucrosCessantesAtualizado || card.vrd.lucrosCessantesAtual || 0,
    )
    if (apoliceVrLc > 0 && cardVrLc > 0 && Math.abs(apoliceVrLc - cardVrLc) > 1000) {
      divergencias.push({
        campo: 'VRD Lucros Cessantes',
        valorApoliceVigente: apoliceVrLc,
        valorCartaoRisco: cardVrLc,
        descricao: `VRD LC na apólice é R$ ${apoliceVrLc.toLocaleString('pt-BR')} vs R$ ${cardVrLc.toLocaleString('pt-BR')} no Cartão.`,
      })
    }

    // 3. Cruzamento prévio de Coberturas da Apólice Vigente vs Cartão
    try {
      const existingCobs = await pb.collection('coberturas').getFullList({
        filter: `id_apolice="${sameProductApolice.id}"`,
      })
      const apCobMap = new Map<string, number>()
      for (const ec of existingCobs) {
        const cat = String(
          ec.categoria_normalizada || matchCanonicalCategory(String(ec.nome_cobertura || '')),
        ).trim()
        const lmi = typeof ec.lmi_rs === 'number' ? ec.lmi_rs : null
        if (cat && lmi !== null) {
          apCobMap.set(cat, lmi)
        }
      }

      for (const cob of card.coberturas) {
        const lmiCartao = cob.isEscolhida ?? cob.isAtualizada ?? cob.isAtual ?? null
        const catCartao = cob.categoriaNormalizada || matchCanonicalCategory(cob.nomeOriginal)
        if (lmiCartao !== null && lmiCartao > 0) {
          if (apCobMap.has(catCartao)) {
            const lmiAp = apCobMap.get(catCartao)!
            if (Math.abs(lmiAp - lmiCartao) > 500) {
              divergencias.push({
                campo: `Cobertura: ${catCartao}`,
                valorApoliceVigente: lmiAp,
                valorCartaoRisco: lmiCartao,
                descricao: `LMI na apólice é R$ ${lmiAp.toLocaleString('pt-BR')} vs R$ ${lmiCartao.toLocaleString('pt-BR')} no Cartão.`,
              })
            }
          } else {
            divergencias.push({
              campo: `Cobertura Só no Cartão: ${catCartao}`,
              valorApoliceVigente: 'Não contratada',
              valorCartaoRisco: lmiCartao,
              descricao: `Cobertura solicitada no Cartão (${catCartao}) não consta na apólice vigente.`,
            })
          }
        }
      }
    } catch {
      // Coberturas não impedem o fluxo de casamento
    }

    return {
      outcome: 'RENOVACAO',
      matchedEmpreendimentoId: empId,
      matchedEmpreendimentoNome: empNome,
      matchedEmpreendimentoCnpj: empCnpj,
      matchedApoliceId: String(sameProductApolice.id),
      matchedApoliceNumero: String(
        sameProductApolice.numero_apolice || sameProductApolice.id_apolice || '',
      ),
      matchedApoliceRamo: String(sameProductApolice.ramo || ''),
      produtoCartao,
      ramoCanonicaCartao,
      motivo: `Empreendimento já cadastrado (${empNome}) com produto idêntico já contratado (${sameProductApolice.ramo || 'Compreensivo/RN'}). Processo tratado como Renovação técnica.`,
      divergencias,
    }
  }

  // CENÁRIO 2: NOVO PRODUTO para cliente existente
  const produtosExistentesDesc =
    existingApolices
      .map((a) => a.ramo)
      .filter(Boolean)
      .join(', ') || 'Nenhum ramo ativo registrado'
  return {
    outcome: 'NOVO_PRODUTO',
    matchedEmpreendimentoId: empId,
    matchedEmpreendimentoNome: empNome,
    matchedEmpreendimentoCnpj: empCnpj,
    produtoCartao,
    ramoCanonicaCartao,
    motivo: `Cliente existente (${empNome}), porém cotando um novo produto/ramo (${ramoCanonicaCartao}). Produtos existentes na base: [${produtosExistentesDesc}]. Não é duplicata.`,
    divergencias: [],
  }
}

// ==========================================
// GRAVAÇÃO IDEMPOTENTE NO POCKETBASE
// ==========================================

export async function saveRiskCardToDatabase(
  card: RiskCardData,
  match: RiskCardMatchResult,
  originalFile: File,
  currentUserEmail: string,
  onProgress?: (msg: string) => void,
): Promise<RiskCardImportSummary> {
  const summary: RiskCardImportSummary = {
    success: false,
    outcome: match.outcome,
    empreendimentoId: '',
    createdCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    sinistrosCreated: 0,
    sinistrosUnchanged: 0,
    coberturasCreated: 0,
    coberturasUpdated: 0,
    coberturasUnchanged: 0,
    divergenciasRecorded: 0,
    errors: [],
  }

  const timestamp = new Date().toISOString()
  let empRecordId = match.matchedEmpreendimentoId || ''

  // Monta mapa estruturado de proteções para persistência direta
  const pInc = card.protecaoIncendio || {}
  const pRoub = card.protecaoRoubo || {}

  // Helper para buscar chave tolerante
  const findKey = (map: Record<string, boolean | string>, ...fragments: string[]) => {
    const keys = Object.keys(map)
    for (const frag of fragments) {
      const normFrag = normalizeMatchText(frag)
      const found = keys.find((k) => normalizeMatchText(k).includes(normFrag))
      if (found) return found
    }
    return null
  }

  const kExt = findKey(pInc, 'extintor')
  const kHid = findKey(pInc, 'hidrante')
  const kSpk = findKey(pInc, 'sprinkler')
  const kDetFum = findKey(pInc, 'detector de fumaca', 'detector')
  const kAlmInc = findKey(pInc, 'alame contra', 'alarme contra incendio', 'alarme incendio')
  const kBrig = findKey(pInc, 'brigada de incendio', 'brigada')
  const kFuncTr = findKey(pInc, 'funcionarios treinados')
  const kParaR = findKey(pInc, 'para-raios', 'para raios', 'spda')
  const kAgua = findKey(pInc, 'agua exclusivo', 'agua para combate')
  const kCo2 = findKey(pInc, 'co2 fm200', 'co2', 'fm200')
  const kExp24 = findKey(pInc, 'expediente 24')
  const kInstElet = findKey(pInc, 'instalacoes eletricas protegidas', 'instalacoes eletricas')
  const kLumProt = findKey(pInc, 'luminarias protegidas')
  const kOutrosInc = findKey(pInc, 'outros')
  const kBombeiros = findKey(pInc, 'corpo de bombeiros')

  const kVig = findKey(pRoub, 'vigilancia')
  const kAlmRoub = findKey(pRoub, 'alarme')
  const kCam = findKey(pRoub, 'cameras de seguranca', 'cameras')
  const kCftv = findKey(pRoub, 'cftv')
  const kCtrlEnt = findKey(pRoub, 'controle de entrada', 'controle de acesso')
  const kGrade = findKey(pRoub, 'grade de protecao')
  const kCerca = findKey(pRoub, 'cerca eletrica')
  const kCofre = findKey(pRoub, 'cofre')
  const kOutrosRoub = findKey(pRoub, 'outros')

  const vigDetalhe = kVig ? String(pRoub[`${kVig}_detalhe`] || '') : ''
  const almIncDetalhe = kAlmInc ? String(pInc[`${kAlmInc}_detalhe`] || '') : ''
  const almRoubDetalhe = kAlmRoub ? String(pRoub[`${kAlmRoub}_detalhe`] || '') : ''
  const camDetalhe = kCam ? String(pRoub[`${kCam}_detalhe`] || '') : ''
  const ctrlEntDetalhe = kCtrlEnt ? String(pRoub[`${kCtrlEnt}_detalhe`] || '') : ''

  const isVigArmada = /armada/i.test(vigDetalhe) && !/desarmada/i.test(vigDetalhe)
  const isVig24h = /24\s*h/i.test(vigDetalhe) || Boolean(pInc[kExp24 || ''])

  // Outros textos
  const outrosIncTexto = kOutrosInc
    ? String(kOutrosInc.replace(/^outros\s*[:\s-]*/i, '') || pInc[`${kOutrosInc}_detalhe`] || '')
    : ''
  const outrosRoubTexto = kOutrosRoub
    ? String(kOutrosRoub.replace(/^outros\s*[:\s-]*/i, '') || pRoub[`${kOutrosRoub}_detalhe`] || '')
    : ''

  // Distância bombeiros e volume de água
  let distBombeirosKm: number | null = null
  let distBombeirosTexto = ''
  if (kBombeiros) {
    const rawB = `${kBombeiros} ${pInc[`${kBombeiros}_detalhe`] || ''}`
    const m = rawB.match(/(\d+(?:[.,]\d+)?)\s*(?:km|quil[oô]metros|m\b)/i)
    if (m) distBombeirosKm = parseCellNumber(m[1])
    distBombeirosTexto = rawB.replace(/.*?qual\s+a\s+dist[aâ]ncia\s*\??\s*[:\s-]*/i, '').trim()
  }

  let volumeAguaM3: number | null = null
  let volumeAguaTexto = ''
  if (kAgua) {
    const rawA = `${kAgua} ${pInc[`${kAgua}_detalhe`] || ''}`
    const m = rawA.match(/(\d+(?:[.,]\d+)?)\s*(?:m3|m³|litros|mil)/i)
    if (m) volumeAguaM3 = parseCellNumber(m[1])
    volumeAguaTexto = rawA.replace(/.*?qual\s+o\s+volume\s*\??\s*[:\s-]*/i, '').trim()
  }

  // Extrai número de andares / subsolo
  let numAndaresNum: number | null = null
  if (card.construcao.quantidadeAndares) {
    const mAndares =
      String(card.construcao.quantidadeAndares).match(/andares\s*[:\s-]*\s*(\d+)/i) ||
      String(card.construcao.quantidadeAndares).match(/^(\d+)/)
    if (mAndares) numAndaresNum = parseInt(mAndares[1], 10)
  }

  // Extrai número de unidades
  let numUnidadesNum: number | null = null
  if (card.construcao.numAptosUnidades) {
    const mU = String(card.construcao.numAptosUnidades).match(/(\d+)/)
    if (mU) numUnidadesNum = parseInt(mU[1], 10)
  }

  // Extrai área construída
  let areaConstruidaNum: number | null = null
  if (card.construcao.areaConstruidaM2) {
    areaConstruidaNum = parseCellNumber(card.construcao.areaConstruidaM2)
  }

  // Elevadores
  const hasElevadores =
    Boolean(card.construcao.elevadores) &&
    !/não|nao/i.test(card.construcao.elevadores.replace(/sim/i, ''))
  let numElevadoresNum: number | null = null
  if (card.construcao.elevadores) {
    const mEl =
      String(card.construcao.elevadores).match(/quantos\s*\??\s*[:\s-]*\s*(\d+)/i) ||
      String(card.construcao.elevadores).match(/(\d+)/)
    if (mEl) numElevadoresNum = parseInt(mEl[1], 10)
  }

  // Vagas estacionamento
  let vagasEstacionamentoNum: number | null = null
  if (card.construcao.estacionamento) {
    const mVagas =
      String(card.construcao.estacionamento).match(/autom[oó]veis\s*[:\s-]*\s*(\d+)/i) ||
      String(card.construcao.estacionamento).match(/(\d+)/)
    if (mVagas) vagasEstacionamentoNum = parseInt(mVagas[1], 10)
  }

  // Objeto completo com dados de proteções e risco
  const protecoesUpdatePayload = {
    prot_extintores: Boolean(kExt && pInc[kExt]),
    prot_hidrantes: Boolean(kHid && pInc[kHid]),
    prot_sprinklers: Boolean(kSpk && pInc[kSpk]),
    prot_detector_fumaca: Boolean(kDetFum && pInc[kDetFum]),
    prot_alarme_incendio: Boolean(kAlmInc && pInc[kAlmInc]),
    prot_brigada_incendio: Boolean((kBrig && pInc[kBrig]) || (kFuncTr && pInc[kFuncTr])),
    prot_pararraios: Boolean(kParaR && pInc[kParaR]),
    prot_agua_exclusiva_incendio: Boolean(kAgua && pInc[kAgua]),
    prot_co2_fm200: Boolean(kCo2 && pInc[kCo2]),
    prot_expediente_24h: Boolean(kExp24 && pInc[kExp24]),
    prot_instalacoes_eletricas_protegidas: Boolean(kInstElet && pInc[kInstElet]),
    prot_luminarias_protegidas: Boolean(kLumProt && pInc[kLumProt]),
    prot_outros_incendio: Boolean(kOutrosInc && pInc[kOutrosInc]),
    prot_outros_incendio_texto: outrosIncTexto,

    prot_vigilancia: Boolean(kVig && pRoub[kVig]),
    vigilancia_armada: isVigArmada,
    vigilancia_24h: isVig24h,
    prot_alarme_roubo: Boolean(kAlmRoub && pRoub[kAlmRoub]),
    prot_cameras_seguranca: Boolean(kCam && pRoub[kCam]),
    prot_cftv: Boolean(kCftv && pRoub[kCftv]),
    prot_controle_entrada: Boolean(kCtrlEnt && pRoub[kCtrlEnt]),
    prot_grade_protecao: Boolean(kGrade && pRoub[kGrade]),
    prot_cerca_eletrica: Boolean(kCerca && pRoub[kCerca]),
    prot_cofres: Boolean(kCofre && pRoub[kCofre]),
    prot_outros_roubo: Boolean(kOutrosRoub && pRoub[kOutrosRoub]),
    prot_outros_roubo_texto: outrosRoubTexto,

    prot_alarme_incendio_detalhe: almIncDetalhe,
    prot_vigilancia_detalhe: vigDetalhe,
    prot_alarme_roubo_detalhe: almRoubDetalhe,
    prot_cameras_seguranca_detalhe: camDetalhe,
    prot_controle_entrada_detalhe: ctrlEntDetalhe,
    dist_bombeiros_texto: distBombeirosTexto,
    volume_agua_exclusivo_texto: volumeAguaTexto,

    reserva_agua_incendio_m3: volumeAguaM3 ?? undefined,
    dist_bombeiros_km: distBombeirosKm ?? undefined,

    // Dados de construção corretos
    possui_piscina: card.construcao.piscina,
    possui_elevador: hasElevadores,
    num_elevadores: numElevadoresNum ?? undefined,
    vagas_estacionamento: vagasEstacionamentoNum ?? undefined,
    num_andares: numAndaresNum ?? undefined,
    num_unidades: numUnidadesNum ?? undefined,
    area_construida_m2: areaConstruidaNum ?? undefined,
    ano_construcao: card.construcao.anoConstrucao ?? undefined,
    tipo_construcao: card.construcao.tipoConstrucao || undefined,

    protecoes_raw_json: {
      incendio: pInc,
      roubo: pRoub,
    },
  }

  // 1. Salvar ou Vincular Empreendimento
  onProgress?.('Verificando cadastro de empreendimento...')
  if (!empRecordId) {
    // Criar Empreendimento
    const empPayload = {
      id_empreendimento: `emp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      nome_empreendimento: card.segurado,
      razao_social: card.segurado,
      cnpj: card.cnpj,
      cossegurado_nome: card.cossegurados.map((c) => c.razaoSocial).join('; '),
      cossegurado_cnpj: card.cossegurados.map((c) => c.cnpj).join('; '),
      endereco: card.endereco || card.localRisco,
      atividade: card.atividade,
      atividade_exercida: card.atividadeExercida,
      segmento: 'Hotéis & Resorts',
      fonte_cartao_risco: card.fileName,
      origem: 'Cartão de Risco',
      imported_at: timestamp,
      imported_by: currentUserEmail,
      ...protecoesUpdatePayload,
    }

    try {
      const createdEmp = await executeWithRetry(() =>
        pb.collection('empreendimentos').create(empPayload),
      )
      empRecordId = createdEmp.id
      summary.empreendimentoId = empRecordId
      summary.createdCount++
    } catch (err) {
      summary.errors.push(`Erro ao criar empreendimento: ${(err as Error).message}`)
      return summary
    }
  } else {
    // Atualização idempotente dos dados do Cartão de Risco (proteções, construção e detalhes)
    try {
      await executeWithRetry(() =>
        pb.collection('empreendimentos').update(empRecordId, {
          ...protecoesUpdatePayload,
          fonte_cartao_risco: card.fileName,
        }),
      )
      summary.updatedCount++
    } catch (err) {
      summary.errors.push(
        `Aviso ao atualizar proteções do empreendimento: ${(err as Error).message}`,
      )
    }
    summary.empreendimentoId = empRecordId
    summary.unchangedCount++
  }

  // 2. Salvar Documento de Origem no módulo C1
  onProgress?.('Arquivando documento de origem no módulo C1...')
  try {
    const docForm = new FormData()
    docForm.append('arquivo', originalFile)
    docForm.append('tipo', 'Cartão de Risco')
    docForm.append('versao', card.fileName)
    docForm.append('data', new Date().toISOString().slice(0, 10))
    docForm.append('vinculado_empreendimento', empRecordId)
    const docRes = await executeWithRetry(() => pb.collection('documentos').create(docForm))
    summary.documentoId = docRes.id
    summary.createdCount++
  } catch (err) {
    summary.errors.push(
      `Aviso: Falha ao arquivar arquivo XLSX na coleção documentos: ${(err as Error).message}`,
    )
  }

  // 3. Processo / Apólice de cotação vinculada
  let apoliceRecordId = match.matchedApoliceId || ''
  onProgress?.('Estruturando processo de cotação/apólice...')

  const vrdTotal = card.vrd.totalAtualizado || card.vrd.totalAtual || 0
  const lmiBasica =
    card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isAtualizada ||
    card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isAtual ||
    0

  if (!apoliceRecordId) {
    // Normaliza seguradora anterior de forma canônica antes de criar processo de apólice
    let seguradoraCanonica = 'A Cotar'
    if (card.seguradoraAnterior && card.seguradoraAnterior !== 'A Cotar') {
      const segNorm = await normalizarSeguradora(card.seguradoraAnterior, { autoCadastrar: true })
      seguradoraCanonica =
        segNorm.nomeCanonica || normalizarNomeSeguradoraSync(card.seguradoraAnterior)
    }

    // Cria novo processo de apólice (Status prospect)
    const apolPayload = {
      id_apolice: `proc_risco_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      id_empreendimento: empRecordId,
      segurado_na_apolice: card.segurado,
      cnpj_segurado: card.cnpj,
      seguradora: seguradoraCanonica,
      numero_apolice: card.numeroApoliceAnterior || 'Processo de Cotação',
      ramo: match.ramoCanonicaCartao,
      data_inicio: card.vigenciaInicio || null,
      data_fim: card.vigenciaFim || null,
      valor_em_risco_dm: vrdTotal,
      valor_em_risco_lc: card.vrd.lucrosCessantesAtualizado || card.vrd.lucrosCessantesAtual || 0,
      lmi_incendio_basica: lmiBasica,
      razao_lmi_vr_dm: vrdTotal > 0 && lmiBasica > 0 ? Number(lmiBasica) / Number(vrdTotal) : null,
      status: 'prospect',
      origem: 'Cartão de Risco',
      fonte_arquivo: card.fileName,
      imported_at: timestamp,
      imported_by: currentUserEmail,
    }

    try {
      const createdAp = await executeWithRetry(() => pb.collection('apolices').create(apolPayload))
      apoliceRecordId = createdAp.id
      summary.apoliceId = apoliceRecordId
      summary.createdCount++
    } catch (err) {
      summary.errors.push(`Erro ao criar processo de cotação: ${(err as Error).message}`)
    }
  } else {
    // REGRA DE DIVERGÊNCIA: Se apólice já existe (Renovação), NÃO sobrescrevemos dados vigentes da apólice.
    // Preservamos os dados vigentes e gravamos divergências encontradas!
    summary.apoliceId = apoliceRecordId
    summary.unchangedCount++
  }

  // 4. Gravar Divergências (se houver e para renovação)
  if (match.divergencias.length > 0 && empRecordId) {
    onProgress?.('Registrando painel de divergências técnicas...')
    for (const div of match.divergencias) {
      try {
        await executeWithRetry(() =>
          pb.collection('divergencias').create({
            id_empreendimento: empRecordId,
            campo: div.campo,
            valor_cartao_risco: String(div.valorCartaoRisco),
            valor_final_apolice: String(div.valorApoliceVigente),
            apolice_referencia:
              match.matchedApoliceNumero || match.matchedApoliceId || 'Apólice Vigente',
            observacao: div.descricao,
          }),
        )
        summary.divergenciasRecorded++
        summary.createdCount++
      } catch {
        // ignore
      }
    }
  }

  // 5. Sinistros Declarados (idempotência com buildSinistroDedupeKey)
  if (card.sinistros.length > 0 && empRecordId) {
    onProgress?.('Gravando sinistros declarados com deduplicação canônica...')
    // Pre-carrega sinistros existentes deste empreendimento
    const existingSinistros = await pb.collection('sinistros').getFullList({
      filter: `id_empreendimento="${empRecordId}"`,
    })
    const sinKeySet = new Set<string>()
    for (const s of existingSinistros) {
      const k = buildSinistroDedupeKey({
        idEmpreendimento: empRecordId,
        numeroSinistro: s.numero_sinistro,
        dataSinistro: s.data_sinistro,
        coberturaAcionada: s.cobertura_acionada,
        descricao: s.descricao,
        valorIndenizadoRs: s.valor_indenizado_rs,
      })
      sinKeySet.add(k)
    }

    for (const sin of card.sinistros) {
      const sinKey = buildSinistroDedupeKey({
        idEmpreendimento: empRecordId,
        numeroSinistro: '',
        dataSinistro: sin.ano ? `${sin.ano}-01-01` : '',
        coberturaAcionada: sin.cobertura,
        descricao: sin.descricao,
        valorIndenizadoRs: sin.valorIndenizado,
      })

      if (sinKeySet.has(sinKey)) {
        summary.sinistrosUnchanged++
        summary.unchangedCount++
        continue
      }

      try {
        await executeWithRetry(() =>
          pb.collection('sinistros').create({
            id_empreendimento: empRecordId,
            id_apolice: apoliceRecordId || null,
            origem_periodo: `Histórico Cartão de Risco (${sin.ano || '5 anos'})`,
            cobertura_acionada: sin.cobertura,
            descricao: sin.descricao,
            valor_indenizado_rs: sin.valorIndenizado,
            status: 'Liquidado',
            fonte: card.fileName,
            origem: 'Cartão de Risco',
          }),
        )
        sinKeySet.add(sinKey)
        summary.sinistrosCreated++
        summary.createdCount++
      } catch (err) {
        summary.errors.push(`Erro sinistro ${sin.ano}: ${(err as Error).message}`)
      }
    }
  }

  // ETAPA 0: Se a apólice casada já estiver emitida/renovada (status 'ativa' ou 'renovada' e não prospect),
  // NÃO sobrescrever as coberturas da apólice vigente com as do Cartão.
  // Coberturas só são gravadas/atualizadas quando a apólice for um prospect (processo novo de cotação)
  // ou quando não houver apólice vigente emitida.
  let isApoliceVigenteEmitida = false
  let apoliceRecordParaAuditoria: Record<string, unknown> | null = null
  let coberturasApoliceVigente: Array<Record<string, unknown>> = []

  if (apoliceRecordId) {
    try {
      apoliceRecordParaAuditoria = (await pb
        .collection('apolices')
        .getOne(apoliceRecordId)) as unknown as Record<string, unknown>
      const statusApol = String(apoliceRecordParaAuditoria.status || '').toLowerCase()
      // Se status for 'ativa', 'renovada', 'vencida', 'a vencer' ou tiver número de apólice oficial (não prospect)
      if (
        statusApol === 'ativa' ||
        statusApol === 'renovada' ||
        statusApol === 'a vencer' ||
        statusApol === 'vencida' ||
        (statusApol !== 'prospect' && apoliceRecordParaAuditoria.numero_apolice)
      ) {
        isApoliceVigenteEmitida = true
      }
    } catch {
      // fallback: se era renovação consideramos emitida
      if (match.outcome === 'RENOVACAO') {
        isApoliceVigenteEmitida = true
      }
    }
  }

  // 6. Coberturas Solicitadas / Declaradas
  if (card.coberturas.length > 0 && apoliceRecordId) {
    // Carrega coberturas existentes
    try {
      coberturasApoliceVigente = (await pb.collection('coberturas').getFullList({
        filter: `id_apolice="${apoliceRecordId}"`,
      })) as unknown as Array<Record<string, unknown>>
    } catch {
      coberturasApoliceVigente = []
    }

    if (isApoliceVigenteEmitida) {
      // ETAPA 0: NÃO SOBRESCREVER COBERTURAS DA APÓLICE VIGENTE
      onProgress?.(
        'Apólice vigente já emitida/renovada: preservando coberturas originais sem sobrescrita...',
      )
      summary.coberturasUnchanged += coberturasApoliceVigente.length || card.coberturas.length
      summary.unchangedCount += coberturasApoliceVigente.length || card.coberturas.length
    } else {
      // Processo de cotação novo ou prospect: grava normalmente
      onProgress?.('Gravando coberturas solicitadas pelo Cartão de Risco...')
      const existingCobMap = new Map<string, Record<string, unknown>>()
      for (const ec of coberturasApoliceVigente) {
        const k = `${ec.id_apolice}::${normalizeHeader(String(ec.nome_cobertura || ''))}`
        existingCobMap.set(k, ec)
      }

      for (const cob of card.coberturas) {
        // Prioridade de valor: IS Escolhida -> IS Atualizada -> IS Atual
        const lmiPrincipal = cob.isEscolhida ?? cob.isAtualizada ?? cob.isAtual ?? null
        const cobPayload = {
          id_apolice: apoliceRecordId,
          nome_cobertura: cob.nomeOriginal,
          categoria_normalizada: cob.categoriaNormalizada,
          lmi_rs: lmiPrincipal,
          is_atualizada: cob.isAtualizada,
          is_escolhida: cob.isEscolhida,
          observacao: cob.observacao,
          origem: 'Cartão de Risco',
        }

        const dedupeKey = `${apoliceRecordId}::${normalizeHeader(cob.nomeOriginal)}`
        const existing = existingCobMap.get(dedupeKey)

        try {
          if (existing) {
            if (isRecordIdentical(existing, cobPayload)) {
              summary.coberturasUnchanged++
              summary.unchangedCount++
              continue
            }
            await executeWithRetry(() =>
              pb.collection('coberturas').update(String(existing.id), cobPayload),
            )
            summary.coberturasUpdated++
            summary.updatedCount++
          } else {
            const created = await executeWithRetry(() =>
              pb.collection('coberturas').create(cobPayload),
            )
            existingCobMap.set(dedupeKey, created as unknown as Record<string, unknown>)
            summary.coberturasCreated++
            summary.createdCount++
          }
        } catch (err) {
          summary.errors.push(`Erro cobertura ${cob.nomeOriginal}: ${(err as Error).message}`)
        }
      }
    }
  }

  // 7. ETAPA 1: GERAR NOVA RODADA DE AUDITORIA PERSISTENTE (AUDITORIA_RODADAS)
  if (empRecordId) {
    try {
      onProgress?.('Registrando nova rodada da Auditoria Cartão × Apólice...')
      const { buildAuditoriaSnapshot, createAuditoriaRodada, resolverApoliceReferenciaReal } =
        await import('@/services/auditoriaCartaoApoliceService')

      // REGRA: o comparativo usa SEMPRE a apólice antecessora REAL (emitida, mesmo empreendimento,
      // mesmo ramo, vigência imediatamente anterior) — nunca o registro prospect criado pelo Cartão.
      let apoliceReferenciaReal = apoliceRecordParaAuditoria
      if (apoliceRecordParaAuditoria) {
        const statusApol = String(apoliceRecordParaAuditoria.status || '')
          .toLowerCase()
          .trim()
        const isProspect =
          statusApol === 'prospect' ||
          /^proc_risco_/i.test(String(apoliceRecordParaAuditoria.id_apolice || ''))
        if (isProspect) {
          const real = await resolverApoliceReferenciaReal({
            empreendimentoId: empRecordId,
            apoliceProspectId: apoliceRecordId || '',
            ramo: match.ramoCanonicaCartao || match.matchedApoliceRamo || '',
            dataInicioCartao: card.vigenciaInicio || '',
          })
          if (real) {
            apoliceReferenciaReal = real
            const coberturasReal = (await pb.collection('coberturas').getFullList({
              filter: `id_apolice="${String(real.id)}"`,
            })) as unknown as Array<Record<string, unknown>>
            coberturasApoliceVigente = coberturasReal
            onProgress?.(
              `Comparativo ancorado na apólice antecessora real (${
                String(real.numero_apolice || real.id_apolice || '—') || '—'
              }).`,
            )
          }
        }
      }

      const snapshot = buildAuditoriaSnapshot(
        card,
        apoliceReferenciaReal,
        coberturasApoliceVigente,
        {
          produtoCartao: match.produtoCartao,
          ramoCanonicaCartao: match.ramoCanonicaCartao,
        },
      )

      let usuarioId = ''
      try {
        if (currentUserEmail) {
          const userRec = await pb
            .collection('users')
            .getFirstListItem(`email="${currentUserEmail}"`)
          usuarioId = userRec?.id || ''
        }
      } catch {
        // ignore
      }

      const rodadaCriada = await createAuditoriaRodada({
        empreendimentoId: empRecordId,
        apoliceId: apoliceRecordId || undefined,
        apoliceReferenciaRealId: apoliceReferenciaReal
          ? String((apoliceReferenciaReal as Record<string, unknown>).id)
          : undefined,
        produtoRamo: match.ramoCanonicaCartao || match.produtoCartao || 'Riscos Nomeados',
        arquivoOrigem: card.fileName || originalFile.name || 'Cartao_de_Risco.xlsx',
        usuarioId: usuarioId || undefined,
        usuarioEmail: currentUserEmail,
        desfecho: match.outcome,
        snapshot,
        observacoes: `Auditoria gerada automaticamente no upload do Cartão de Risco (${card.fileName}). Total de divergências identificadas: ${snapshot.coberturas.totalDivergencias + snapshot.identificacao.divergenciasIdentificacao.length}.`,
      })
      summary.auditoriaRodadaId = rodadaCriada.id
    } catch (err) {
      console.warn('Erro ao salvar rodada de auditoria:', err)
      // Não trava o fluxo principal se a rodada falhar
    }
  }

  summary.success = summary.errors.length === 0
  onProgress?.('Gravação do Cartão de Risco concluída!')
  return summary
}
