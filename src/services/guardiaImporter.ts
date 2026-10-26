import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'
import {
  normalizarSeguradora,
  normalizarNomeSeguradoraSync,
  getSeguradorasCadastro,
} from './seguradoraNormalizer'

export interface CollectionChangeStats {
  created: number
  updated: number
  unchanged: number
}

export interface SheetKeyDiagnostic {
  sheetName: string
  foundHeaderRowIndex: number
  requiredKeys: string[]
  foundKeys: string[]
  missingKeys: string[]
  totalRows: number
  processedRows: number
  ignoredRows: number
  // Change breakdown
  createdRows?: number
  updatedRows?: number
  unchangedRows?: number
  // Specific details for pivoted sheets like Matriz
  isPivoted?: boolean
  categoriesCount?: number
  matchedColumnsCount?: number
  unmatchedColumnsCount?: number
  unmatchedColumns?: string[]
  unmatchedApoliceColumns?: string[]
  unmatchedNumericColumns?: string[]
}

export interface ImportSummary {
  empreendimentosCount: number
  apolicesCount: number
  coberturasCount: number
  sinistrosCount: number
  matrizCount: number
  notasCount: number
  rastreabilidadeCount: number
  divergenciasCount: number
  ignoredRowsCount: number
  // Change counters
  createdCount: number
  updatedCount: number
  unchangedCount: number
  statsByCollection: {
    empreendimentos: CollectionChangeStats
    apolices: CollectionChangeStats
    coberturas: CollectionChangeStats
    sinistros: CollectionChangeStats
    matriz: CollectionChangeStats
    notas_base: CollectionChangeStats
    rastreabilidade: CollectionChangeStats
    divergencias: CollectionChangeStats
  }
  errors: string[]
  diagnostics: SheetKeyDiagnostic[]
  retriedSuccessCount?: number
  reconciliationPasses?: number
  reconciledCount?: number
}

// Utility: sleep for a given number of milliseconds
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Compare two values for functional equality when determining whether an existing
 * PocketBase record needs updating or can be skipped (unchanged).
 * Normalizes types (strings, numbers, booleans, dates) and handles null/undefined/empty consistently.
 */
export function areValuesEqual(
  existingVal: unknown,
  incomingVal: unknown,
  isDate = false,
): boolean {
  // Normalize undefined and null
  const isExistingEmpty =
    existingVal === null ||
    existingVal === undefined ||
    (typeof existingVal === 'string' && existingVal.trim() === '')
  const isIncomingEmpty =
    incomingVal === null ||
    incomingVal === undefined ||
    (typeof incomingVal === 'string' && incomingVal.trim() === '')

  if (isExistingEmpty && isIncomingEmpty) return true
  if (isExistingEmpty !== isIncomingEmpty) return false

  // Date normalization: compare YYYY-MM-DD
  if (isDate) {
    const d1 = String(existingVal || '').slice(0, 10)
    const d2 = String(incomingVal || '').slice(0, 10)
    return d1 === d2
  }

  // Boolean normalization
  if (typeof incomingVal === 'boolean' || typeof existingVal === 'boolean') {
    return Boolean(existingVal) === Boolean(incomingVal)
  }

  // Number comparison (allow tiny float precision tolerance)
  if (typeof incomingVal === 'number' || typeof existingVal === 'number') {
    const n1 = typeof existingVal === 'number' ? existingVal : parseFloat(String(existingVal))
    const n2 = typeof incomingVal === 'number' ? incomingVal : parseFloat(String(incomingVal))
    if (isNaN(n1) && isNaN(n2)) return true
    if (isNaN(n1) || isNaN(n2)) return false
    return Math.abs(n1 - n2) < 0.0001
  }

  // String comparison: trim and collapse excess internal whitespace
  const s1 = String(existingVal).trim().replace(/\s+/g, ' ')
  const s2 = String(incomingVal).trim().replace(/\s+/g, ' ')
  return s1 === s2
}

/**
 * Checks if all fields of incoming payload already match the existing record.
 * dateFields lists field names that should be compared as dates (YYYY-MM-DD).
 */
export function isRecordIdentical(
  existingRecord: Record<string, unknown>,
  incomingPayload: Record<string, unknown>,
  dateFields: string[] = ['data_inicio', 'data_fim', 'data_sinistro', 'data'],
): boolean {
  for (const [key, incomingVal] of Object.entries(incomingPayload)) {
    // Skip internal/import-specific metadata fields from the comparison
    if (key === 'imported_at' || key === 'imported_by') {
      continue
    }

    const existingVal = existingRecord[key]
    const isDate = dateFields.includes(key)

    if (!areValuesEqual(existingVal, incomingVal, isDate)) {
      return false
    }
  }
  return true
}

/**
 * Execute a backend operation with exponential backoff on 429 (rate-limit) or transient network errors.
 * Ensures throttling delay between requests to prevent hitting PocketBase rate limits.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options?: {
    maxAttempts?: number
    baseBackoffMs?: number
    throttleMs?: number
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 6
  const baseBackoffMs = options?.baseBackoffMs ?? 1200
  const throttleMs = options?.throttleMs ?? 120

  let attempt = 1
  while (true) {
    try {
      const result = await operation()
      if (throttleMs > 0) {
        await sleep(throttleMs)
      }
      return result
    } catch (err: unknown) {
      const status =
        (err as { status?: number; response?: { status?: number } })?.status ||
        (err as { status?: number; response?: { status?: number } })?.response?.status
      const msg = (err as Error)?.message || ''
      const isRateLimit =
        status === 429 || /too many requests/i.test(msg) || /rate limit/i.test(msg)
      const isNetworkError = /network|failed to fetch|timeout|econnreset|aborterror/i.test(msg)

      const shouldRetry = (isRateLimit || isNetworkError) && attempt < maxAttempts
      if (!shouldRetry) {
        throw err
      }

      // Exponential backoff with robust jitter:
      // attempt 1: 1.2s + 200..600ms (~1.5s)
      // attempt 2: 2.4s + 200..600ms (~2.7s)
      // attempt 3: 4.8s + 200..600ms (~5.1s)
      // attempt 4: 9.6s + 200..600ms (~10s)
      // attempt 5: 19.2s + 200..600ms (~19.5s)
      const jitter = 200 + Math.floor(Math.random() * 400)
      const backoffDelay = baseBackoffMs * Math.pow(2, attempt - 1) + jitter
      options?.onRetry?.(attempt, backoffDelay, err)
      await sleep(backoffDelay)
      attempt++
    }
  }
}

// Helper to normalize column names and strings for fuzzy key matching
export function normalizeHeader(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[_\s\-/\\.:;,\t]+/g, '') // collapse spaces, underscores, dashes, etc
}

/**
 * Constrói a chave canônica de deduplicação de sinistros.
 * Combina os campos que efetivamente identificam um sinistro:
 * empreendimento + cobertura normalizada + descrição normalizada + valor normalizado,
 * e quando existirem, número do sinistro e data.
 *
 * Garante que sinistros sem número de apólice e sem número de sinistro (típicos de cartões de risco)
 * sejam perfeitamente reconhecidos entre reimportações do mesmo arquivo.
 */
export function buildSinistroDedupeKey(params: {
  idEmpreendimento: string
  numeroSinistro?: unknown
  dataSinistro?: unknown
  coberturaAcionada?: unknown
  descricao?: unknown
  valorIndenizadoRs?: unknown
}): string {
  const emp = String(params.idEmpreendimento || '').trim()
  const num = String(params.numeroSinistro || '')
    .trim()
    .toLowerCase()
  const dtNorm = String(params.dataSinistro || '')
    .trim()
    .slice(0, 10)
  const cobNorm = normalizeMatchText(params.coberturaAcionada)
  const descNorm = normalizeMatchText(params.descricao)

  // Normalização do valor para string padronizada com 2 casas decimais (ex: '11000.00' ou '0.00')
  let valNorm = '0.00'
  if (
    params.valorIndenizadoRs !== null &&
    params.valorIndenizadoRs !== undefined &&
    params.valorIndenizadoRs !== ''
  ) {
    const rawVal =
      typeof params.valorIndenizadoRs === 'number'
        ? params.valorIndenizadoRs
        : parseFloat(String(params.valorIndenizadoRs).replace(/\./g, '').replace(',', '.'))
    if (!isNaN(rawVal)) {
      valNorm = rawVal.toFixed(2)
    }
  }

  // Se houver número de sinistro e empreendimento, podemos usar como parte primária,
  // mas incluímos a descrição/cobertura para máxima estabilidade e precisão.
  // Se não houver número de sinistro, a chave canônica combina:
  // emp :: num :: dt :: cob :: desc :: val
  return `${emp}::num:${num}::dt:${dtNorm}::cob:${cobNorm}::desc:${descNorm}::val:${valNorm}`
}

/**
 * Normaliza um texto para fins de casamento flexível (tokens textuais):
 * Converte para minúsculas, remove acentos, substitui pontuação por espaço e condensa espaços múltiplos.
 */
export function normalizeMatchText(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\]{}|\\/\-_:;.,+~^`"'*?!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Estrutura descritiva de uma apólice para casamento estruturado em duas etapas na Matriz.
 */
export interface ApoliceMatchCandidate {
  recordId: string
  idApolice: string
  numeroApolice: string
  seguradora: string
  ramo: string
  idEmpreendimento?: string
  nomeEmpreendimento?: string
}

/**
 * Normaliza rótulos de seguradoras conhecidas para um identificador canônico.
 */
export function canonicalizeInsurerName(raw: string): string {
  const norm = normalizeMatchText(raw)
  if (!norm) return ''
  if (norm.includes('axa')) return 'axa'
  if (norm.includes('chubb')) return 'chubb'
  if (norm.includes('mitsui') || norm.includes('msig')) return 'mitsui'
  if (norm.includes('porto')) return 'porto'
  if (norm.includes('tokio')) return 'tokio'
  if (norm.includes('ezze')) return 'ezze'
  if (norm.includes('allianz')) return 'allianz'
  if (norm.includes('bradesco')) return 'bradesco'
  if (norm.includes('sompo')) return 'sompo'
  if (norm.includes('mapfre')) return 'mapfre'
  if (norm.includes('zurich')) return 'zurich'
  if (norm.includes('hdi')) return 'hdi'
  return norm
}

/**
 * Extrai os tokens de prefixo significativos de um texto de empreendimento.
 * Ex.: "btt faria lima (edificio double space)" -> ["btt faria lima", "faria lima", "btt", "double space"]
 */
export function extractEmpTokens(raw: string): string[] {
  const norm = normalizeMatchText(raw)
  if (!norm) return []
  const tokens = new Set<string>()
  tokens.add(norm)
  // Remover conteúdo entre parênteses original ou tokens divididos
  const withoutParens = raw.replace(/\(.*?\)/g, ' ')
  const normWithoutParens = normalizeMatchText(withoutParens)
  if (normWithoutParens) tokens.add(normWithoutParens)

  // Separar palavras significativas (>= 3 chars)
  const words = norm.split(' ').filter((w) => w.length >= 3)
  for (const w of words) {
    tokens.add(w)
  }
  // Bigramas ("btt faria", "faria lima", "btt verbo", "verbo divino")
  for (let i = 0; i < words.length - 1; i++) {
    tokens.add(`${words[i]} ${words[i + 1]}`)
  }
  return Array.from(tokens)
}

/**
 * Testa se o nome do empreendimento do cabeçalho da Matriz é compatível com o do candidato da base.
 * Tolerante a truncamento por largura de coluna (ex.: "Oceani", "KRBM Nor", "SUITES").
 */
export function matchesEmpreendimento(headerEmp: string, candEmp: string): boolean {
  const h = normalizeMatchText(headerEmp)
  const c = normalizeMatchText(candEmp)
  if (!h || !c) return false

  // Igualdade exata após normalização
  if (h === c) return true

  // Inclusão direta
  if (c.includes(h) || h.includes(c)) return true

  // Prefixo (truncamento de Excel: "oceani" vs "oceani beach park resort")
  if (c.startsWith(h) || h.startsWith(c)) return true

  // Tokens de empreendimento
  const hWords = h.split(' ').filter((w) => w.length >= 3)
  const cWords = c.split(' ').filter((w) => w.length >= 3)

  // Se o cabeçalho tem várias palavras ("krbm nor"), todas as palavras significativas do cabeçalho
  // devem coincidir ou ser prefixo das palavras da base
  if (hWords.length >= 2) {
    const allHMatched = hWords.every((hw) =>
      cWords.some((cw) => cw.startsWith(hw) || hw.startsWith(cw)),
    )
    if (allHMatched) return true
  }

  // Token principal de busca (ex: "suites", "arvorar", "acqua", "ohana", "wyndham", "uxua")
  const primaryH = hWords.filter(
    (w) => w !== 'btt' && w !== 'hotel' && w !== 'cdm' && w !== 'resort',
  )
  if (primaryH.length > 0) {
    const allPrimaryMatched = primaryH.every((hw) =>
      cWords.some((cw) => cw.startsWith(hw) || hw.startsWith(cw)),
    )
    if (allPrimaryMatched) return true
  }

  return false
}

/**
 * Calcula score de afinidade do ramo extraído do parêntese com o ramo/linha da apólice.
 * Retorna pontuação positiva se houver casamento ou 0 se incompatível.
 */
export function scoreRamoAffinity(headerRamoRaw: string, candRamoRaw: string): number {
  const h = normalizeMatchText(headerRamoRaw)
  const c = normalizeMatchText(candRamoRaw)
  if (!h || !c) return 0

  let score = 0

  // 1. Extrair códigos numéricos de ramo (ex.: "0118", "01.18", "0351", "0171", "0196", "01.96")
  const hNums = headerRamoRaw.match(/\d{2,4}/g) || []
  const cNums = candRamoRaw.match(/\d{2,4}/g) || []
  const normHNums = hNums.map((n) => n.replace(/^0+/, '') || '0')
  const normCNums = cNums.map((n) => n.replace(/^0+/, '') || '0')
  const numOverlap = normHNums.some((hn) => normCNums.includes(hn))
  if (numOverlap) {
    score += 40
  }

  // 2. Extrair palavras-chave semânticas canônicas
  const isHeaderRC =
    h.includes('responsabilidade') ||
    h.includes('responsabilidad') ||
    /\brc\b/.test(h) ||
    /\brcg\b/.test(h)
  const isCandRC = c.includes('responsabilidade') || /\brc\b/.test(c) || /\brcg\b/.test(c)

  const isHeaderRN =
    h.includes('riscos nomeados') ||
    h.includes('riscos nomead') ||
    h.includes('nomeados') ||
    /\brn\b/.test(h)
  const isCandRN = c.includes('riscos nomeados') || h.includes('nomeados') || /\brn\b/.test(c)

  const isHeaderRD = h.includes('riscos diversos') || h.includes('diversos') || /\brd\b/.test(h)
  const isCandRD = c.includes('riscos diversos') || c.includes('diversos') || /\brd\b/.test(c)

  const isHeaderComp =
    h.includes('compreensivo') ||
    h.includes('compreensiv') ||
    h.includes('empresarial') ||
    h.includes('empr')
  const isCandComp = c.includes('compreensivo') || c.includes('empresarial')

  const isHeaderPredio = h.includes('predio') || h.includes('predi')
  const isCandPredio = c.includes('predio')

  const isHeaderConteudo = h.includes('conteudo') || h.includes('conteud')
  const isCandConteudo = c.includes('conteudo')

  // Penalidade severa se um for puramente RC e o outro não tiver menção a RC
  if (isHeaderRC && !isCandRC) return 0
  if (isHeaderRC && isCandRC) score += 30

  // Se header fala de Riscos Diversos (0171)
  if (isHeaderRD && isCandRD) score += 35
  if (isHeaderRD && !isCandRD) return 0

  // Se header fala de Riscos Nomeados
  if (isHeaderRN && isCandRN) score += 30

  // Se header fala de Compreensivo / Empresarial
  if (isHeaderComp && isCandComp) score += 20

  // Desambiguação Prédio vs Conteúdo
  if (isHeaderPredio && isCandPredio) score += 25
  if (isHeaderConteudo && isCandConteudo) score += 25
  if (isHeaderPredio && isCandConteudo && !isCandPredio) return 0
  if (isHeaderConteudo && isCandPredio && !isCandConteudo) return 0

  // 3. Match por prefixo/inclusão de palavras significativas (>= 4 letras)
  const hWords = h.split(' ').filter((w) => w.length >= 4 && !/^\d+$/.test(w))
  const cWords = c.split(' ').filter((w) => w.length >= 4 && !/^\d+$/.test(w))

  let wordMatches = 0
  for (const hw of hWords) {
    if (cWords.some((cw) => cw.startsWith(hw) || hw.startsWith(cw) || cw.includes(hw))) {
      wordMatches++
    }
  }

  score += wordMatches * 10

  // 4. Inclusão ou prefixo direto da string inteira
  if (c.includes(h) || h.includes(c)) {
    score += 20
  }

  return score
}

// Convert various excel dates to YYYY-MM-DD
function parseExcelDate(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'number') {
    // Excel serial date to JS Date
    const utc_days = Math.floor(val - 25569)
    const utc_value = utc_days * 86400
    const date_info = new Date(utc_value * 1000)
    return date_info.toISOString().slice(0, 10)
  }
  const str = String(val).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10)
  }
  if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
    const [d, m, y] = str.split('/')
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return str
}

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return isNaN(val) ? null : val
  const str = String(val).trim().replace(/\./g, '').replace(',', '.')
  const num = parseFloat(str)
  return isNaN(num) ? null : num
}

function parseBool(val: unknown): boolean {
  if (val === true || val === 1) return true
  if (typeof val === 'string') {
    const s = val
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    return s === 'sim' || s === 'true' || s === '1' || s === 's' || s === 'yes'
  }
  return false
}

/**
 * Locate dynamically the header row in a 2D worksheet matrix and extract rows as
 * objects where keys are normalized canonical column names.
 */
function extractSheetRowsWithHeader(
  sheet: XLSX.WorkSheet,
  canonicalKeys: string[],
): {
  headerRowIndex: number
  rawHeaderNames: Record<string, string> // canonicalKey -> rawHeaderString
  rows: Record<string, unknown>[]
  totalRawRows: number
} {
  // Convert sheet to 2D array of unknown[][]
  const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  if (!rawGrid || rawGrid.length === 0) {
    return { headerRowIndex: -1, rawHeaderNames: {}, rows: [], totalRawRows: 0 }
  }

  // Build lookup map for canonical keys (normalized -> canonical)
  const normCanonicalMap = new Map<string, string>()
  for (const k of canonicalKeys) {
    normCanonicalMap.set(normalizeHeader(k), k)
  }

  // Find the row with the most matching canonical columns
  let bestRowIndex = -1
  let bestMatchCount = 0
  let bestHeaderMap = new Map<number, string>() // colIndex -> canonicalKey
  let bestRawNames: Record<string, string> = {}

  // Check top 15 rows for the header row
  const scanLimit = Math.min(rawGrid.length, 15)
  for (let r = 0; r < scanLimit; r++) {
    const row = rawGrid[r]
    if (!Array.isArray(row)) continue

    let matchCount = 0
    const currentHeaderMap = new Map<number, string>()
    const currentRawNames: Record<string, string> = {}

    for (let c = 0; c < row.length; c++) {
      const cellVal = row[c]
      if (cellVal === null || cellVal === undefined || String(cellVal).trim() === '') continue
      const normCell = normalizeHeader(cellVal)
      const matchedCanonical = normCanonicalMap.get(normCell)
      if (matchedCanonical) {
        matchCount++
        currentHeaderMap.set(c, matchedCanonical)
        currentRawNames[matchedCanonical] = String(cellVal).trim()
      }
    }

    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount
      bestRowIndex = r
      bestHeaderMap = currentHeaderMap
      bestRawNames = currentRawNames
    }
  }

  // Fallback: if no match found, row 0 is assumed
  if (bestRowIndex === -1) {
    bestRowIndex = 0
    const row = rawGrid[0] || []
    for (let c = 0; c < row.length; c++) {
      const cellVal = row[c]
      if (cellVal !== undefined && cellVal !== null) {
        const normCell = normalizeHeader(cellVal)
        const matched = normCanonicalMap.get(normCell)
        if (matched) {
          bestHeaderMap.set(c, matched)
          bestRawNames[matched] = String(cellVal).trim()
        }
      }
    }
  }

  const parsedRows: Record<string, unknown>[] = []
  for (let r = bestRowIndex + 1; r < rawGrid.length; r++) {
    const rawRow = rawGrid[r]
    if (!Array.isArray(rawRow)) continue

    // Check if entire row is empty
    const hasAnyContent = rawRow.some(
      (val) => val !== null && val !== undefined && String(val).trim() !== '',
    )
    if (!hasAnyContent) continue

    const rowObj: Record<string, unknown> = {}
    for (let c = 0; c < rawRow.length; c++) {
      const canonicalKey = bestHeaderMap.get(c)
      if (canonicalKey) {
        rowObj[canonicalKey] = rawRow[c]
      } else {
        // also store generic column index or raw header if needed
        const rawColHeader = rawGrid[bestRowIndex]?.[c]
        if (rawColHeader) {
          rowObj[String(rawColHeader).trim()] = rawRow[c]
        }
      }
    }
    parsedRows.push(rowObj)
  }

  return {
    headerRowIndex: bestRowIndex,
    rawHeaderNames: bestRawNames,
    rows: parsedRows,
    totalRawRows: rawGrid.length,
  }
}

// Canonical schema keys for each sheet
const EMPREENDIMENTO_KEYS = [
  'id_empreendimento',
  'nome_empreendimento',
  'razao_social',
  'cnpj',
  'cossegurado_nome',
  'cossegurado_cnpj',
  'endereco',
  'cidade',
  'uf',
  'atividade',
  'atividade_exercida',
  'ano_inicio_atividades',
  'ano_construcao',
  'area_construida_m2',
  'area_terreno_m2',
  'num_andares',
  'num_unidades',
  'possui_piscina',
  'possui_elevador',
  'num_elevadores',
  'vagas_estacionamento',
  'num_funcionarios',
  'faturamento_12m_rs',
  'tipo_construcao',
  'prot_extintores',
  'prot_hidrantes',
  'prot_sprinklers',
  'prot_detector_fumaca',
  'prot_alarme_incendio',
  'prot_brigada_incendio',
  'prot_pararraios',
  'reserva_agua_incendio_m3',
  'dist_bombeiros_km',
  'prot_vigilancia',
  'vigilancia_armada',
  'vigilancia_24h',
  'prot_alarme_roubo',
  'prot_cftv',
  'prot_controle_entrada',
  'prot_cofres',
  'prot_cerca_eletrica',
  'prot_grade_protecao',
  'sinistros_ultimos_5anos',
  'detalhe_sinistros',
  'fonte_cartao_risco',
]

const APOLICE_KEYS = [
  'id_apolice',
  'id_empreendimento',
  'segurado_na_apolice',
  'cnpj_segurado',
  'seguradora',
  'numero_apolice',
  'ramo',
  'corretor',
  'data_inicio',
  'data_fim',
  'premio_liquido',
  'premio_total',
  'valor_em_risco_dm',
  'valor_em_risco_lc',
  'lmga',
  'lmi_incendio_basica',
  'razao_lmi_vr_dm',
  'status',
  'fonte_arquivo',
  'comissao',
  'iof',
  'endossos',
]

const COBERTURA_KEYS = [
  'id_apolice',
  'nome_cobertura',
  'categoria_normalizada',
  'lmi_rs',
  'franquia_pos',
  'premio_cobertura',
]

const SINISTRO_KEYS = [
  'id_empreendimento',
  'id_apolice',
  'origem_periodo',
  'data_sinistro',
  'numero_sinistro',
  'cobertura_acionada',
  'descricao',
  'valor_indenizado_rs',
  'status',
  'fonte',
]

const MATRIZ_KEYS = ['categoria_normalizada', 'id_apolice', 'lmi']

export async function processGuardiaWorkbook(
  file: File,
  currentUserEmail: string,
  onProgress?: (msg: string) => void,
): Promise<ImportSummary> {
  const data = await file.arrayBuffer()
  const workbook = XLSX.read(data, { type: 'array' })

  const summary: ImportSummary = {
    empreendimentosCount: 0,
    apolicesCount: 0,
    coberturasCount: 0,
    sinistrosCount: 0,
    matrizCount: 0,
    notasCount: 0,
    rastreabilidadeCount: 0,
    divergenciasCount: 0,
    ignoredRowsCount: 0,
    createdCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    statsByCollection: {
      empreendimentos: { created: 0, updated: 0, unchanged: 0 },
      apolices: { created: 0, updated: 0, unchanged: 0 },
      coberturas: { created: 0, updated: 0, unchanged: 0 },
      sinistros: { created: 0, updated: 0, unchanged: 0 },
      matriz: { created: 0, updated: 0, unchanged: 0 },
      notas_base: { created: 0, updated: 0, unchanged: 0 },
      rastreabilidade: { created: 0, updated: 0, unchanged: 0 },
      divergencias: { created: 0, updated: 0, unchanged: 0 },
    },
    errors: [],
    diagnostics: [],
  }

  const timestamp = new Date().toISOString()

  // Pre-load existing records into maps for cross-referencing, idempotency and fast equality comparison
  // empMap: id_empreendimento -> PB record
  const empMap = new Map<string, Record<string, unknown>>()
  try {
    const existingEmps = await executeWithRetry(
      () => pb.collection('empreendimentos').getFullList({ batch: 200 }),
      { throttleMs: 50, maxAttempts: 6 },
    )
    for (const e of existingEmps) {
      if (e.id_empreendimento) {
        empMap.set(String(e.id_empreendimento).trim(), e as unknown as Record<string, unknown>)
      }
    }
  } catch (err: unknown) {
    const errMsg = `Falha crítica ao carregar empreendimentos existentes do banco: ${(err as Error).message}. Vínculos de apólices e sinistros podem ser afetados.`
    summary.errors.push(errMsg)
  }

  // apoliceMap: id_apolice -> PB record
  const apoliceMap = new Map<string, Record<string, unknown>>()
  try {
    const existingApols = await executeWithRetry(
      () => pb.collection('apolices').getFullList({ batch: 200 }),
      { throttleMs: 50, maxAttempts: 6 },
    )
    for (const a of existingApols) {
      if (a.id_apolice) {
        apoliceMap.set(String(a.id_apolice).trim(), a as unknown as Record<string, unknown>)
      }
    }
  } catch (err: unknown) {
    const errMsg = `Falha crítica ao carregar apólices existentes do banco: ${(err as Error).message}.`
    summary.errors.push(errMsg)
  }

  // 1. Empreendimentos
  onProgress?.('Lendo aba Empreendimentos...')
  const sheetEmpName = workbook.SheetNames.find((n) =>
    normalizeHeader(n).includes('empreendimento'),
  )

  if (sheetEmpName) {
    const sheet = workbook.Sheets[sheetEmpName]
    const { headerRowIndex, rawHeaderNames, rows, totalRawRows } = extractSheetRowsWithHeader(
      sheet,
      EMPREENDIMENTO_KEYS,
    )

    const reqKeys = ['id_empreendimento']
    const foundKeys = Object.keys(rawHeaderNames)
    const missingKeys = reqKeys.filter((k) => !rawHeaderNames[k])

    let processedCount = 0
    let ignoredCount = 0
    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0
    let rowIdx = 0

    for (const r of rows) {
      rowIdx++
      const idEmp = String(r['id_empreendimento'] || '').trim()
      if (!idEmp) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      const payload = {
        id_empreendimento: idEmp,
        nome_empreendimento: String(r['nome_empreendimento'] || idEmp).trim(),
        razao_social: String(r['razao_social'] || '').trim(),
        cnpj: String(r['cnpj'] || '').trim(),
        cossegurado_nome: String(r['cossegurado_nome'] || '').trim(),
        cossegurado_cnpj: String(r['cossegurado_cnpj'] || '').trim(),
        endereco: String(r['endereco'] || '').trim(),
        cidade: String(r['cidade'] || '').trim(),
        uf: String(r['uf'] || '').trim(),
        atividade: String(r['atividade'] || '').trim(),
        atividade_exercida: String(r['atividade_exercida'] || '').trim(),
        ano_inicio_atividades: parseNumber(r['ano_inicio_atividades']),
        ano_construcao: parseNumber(r['ano_construcao']),
        area_construida_m2: parseNumber(r['area_construida_m2']),
        area_terreno_m2: parseNumber(r['area_terreno_m2']),
        num_andares: parseNumber(r['num_andares']),
        num_unidades: parseNumber(r['num_unidades']),
        possui_piscina: parseBool(r['possui_piscina']),
        possui_elevador: parseBool(r['possui_elevador']),
        num_elevadores: parseNumber(r['num_elevadores']),
        vagas_estacionamento: parseNumber(r['vagas_estacionamento']),
        num_funcionarios: parseNumber(r['num_funcionarios']),
        faturamento_12m_rs: parseNumber(r['faturamento_12m_rs']),
        tipo_construcao: String(r['tipo_construcao'] || '').trim(),
        prot_extintores: parseBool(r['prot_extintores']),
        prot_hidrantes: parseBool(r['prot_hidrantes']),
        prot_sprinklers: parseBool(r['prot_sprinklers']),
        prot_detector_fumaca: parseBool(r['prot_detector_fumaca']),
        prot_alarme_incendio: parseBool(r['prot_alarme_incendio']),
        prot_brigada_incendio: parseBool(r['prot_brigada_incendio']),
        prot_pararraios: parseBool(r['prot_pararraios']),
        reserva_agua_incendio_m3: parseNumber(r['reserva_agua_incendio_m3']),
        dist_bombeiros_km: parseNumber(r['dist_bombeiros_km']),
        prot_vigilancia: parseBool(r['prot_vigilancia']),
        vigilancia_armada: parseBool(r['vigilancia_armada']),
        vigilancia_24h: parseBool(r['vigilancia_24h']),
        prot_alarme_roubo: parseBool(r['prot_alarme_roubo']),
        prot_cftv: parseBool(r['prot_cftv']),
        prot_controle_entrada: parseBool(r['prot_controle_entrada']),
        prot_cofres: parseBool(r['prot_cofres']),
        prot_cerca_eletrica: parseBool(r['prot_cerca_eletrica']),
        prot_grade_protecao: parseBool(r['prot_grade_protecao']),
        sinistros_ultimos_5anos: String(r['sinistros_ultimos_5anos'] || '').trim(),
        detalhe_sinistros: String(r['detalhe_sinistros'] || '').trim(),
        fonte_cartao_risco: String(r['fonte_cartao_risco'] || '').trim(),
        segmento: 'Hotéis & Resorts',
        imported_at: timestamp,
        imported_by: currentUserEmail,
      }

      try {
        let existingRecord = empMap.get(idEmp)
        if (!existingRecord) {
          // Double check in PB if not in local map
          const fetched = await executeWithRetry(
            () =>
              pb
                .collection('empreendimentos')
                .getFirstListItem(`id_empreendimento="${idEmp}"`)
                .catch(() => null),
            { throttleMs: 30, maxAttempts: 4 },
          )
          if (fetched) {
            existingRecord = fetched as unknown as Record<string, unknown>
            empMap.set(idEmp, existingRecord)
          }
        }

        if (existingRecord) {
          // Compare before updating: skip write if already identical
          const recordId = String(existingRecord.id)
          if (isRecordIdentical(existingRecord, payload)) {
            unchangedCount++
            summary.unchangedCount++
            summary.statsByCollection.empreendimentos.unchanged++
            summary.empreendimentosCount++
            processedCount++
            continue
          }

          onProgress?.(`Atualizando empreendimento ${rowIdx}/${rows.length}: ${idEmp}...`)
          const updated = await executeWithRetry(() =>
            pb.collection('empreendimentos').update(recordId, payload),
          )
          empMap.set(idEmp, updated as unknown as Record<string, unknown>)
          updatedCount++
          summary.updatedCount++
          summary.statsByCollection.empreendimentos.updated++
        } else {
          onProgress?.(`Criando empreendimento ${rowIdx}/${rows.length}: ${idEmp}...`)
          const created = await executeWithRetry(() =>
            pb.collection('empreendimentos').create(payload),
          )
          empMap.set(idEmp, created as unknown as Record<string, unknown>)
          createdCount++
          summary.createdCount++
          summary.statsByCollection.empreendimentos.created++
        }
        summary.empreendimentosCount++
        processedCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro empreendimento ${idEmp}: ${(err as Error).message}`)
      }
    }

    summary.diagnostics.push({
      sheetName: sheetEmpName,
      foundHeaderRowIndex: headerRowIndex + 1,
      requiredKeys: reqKeys,
      foundKeys,
      missingKeys,
      totalRows: totalRawRows,
      processedRows: processedCount,
      ignoredRows: ignoredCount,
      createdRows: createdCount,
      updatedRows: updatedCount,
      unchangedRows: unchangedCount,
    })
  } else {
    summary.diagnostics.push({
      sheetName: 'Empreendimentos (não encontrada)',
      foundHeaderRowIndex: 0,
      requiredKeys: ['id_empreendimento'],
      foundKeys: [],
      missingKeys: ['id_empreendimento'],
      totalRows: 0,
      processedRows: 0,
      ignoredRows: 0,
    })
  }

  // Pre-extract Coberturas sheet first to calculate LMI Incêndio Básica per id_apolice
  const sheetCobName = workbook.SheetNames.find((n) => normalizeHeader(n).includes('cobertura'))
  const apoliceLmiBasica = new Map<string, number>()
  let cobExtraction: ReturnType<typeof extractSheetRowsWithHeader> | null = null

  if (sheetCobName) {
    cobExtraction = extractSheetRowsWithHeader(workbook.Sheets[sheetCobName], COBERTURA_KEYS)
    for (const c of cobExtraction.rows) {
      const apId = String(c['id_apolice'] || '').trim()
      const cat = normalizeHeader(c['categoria_normalizada'])
      if (apId && (cat.includes('incendiobasica') || cat.includes('incendio'))) {
        const lmi = parseNumber(c['lmi_rs']) || 0
        apoliceLmiBasica.set(apId, (apoliceLmiBasica.get(apId) || 0) + lmi)
      }
    }
  }

  // 2. Apólices
  onProgress?.('Lendo aba Apólices...')
  const sheetApolName = workbook.SheetNames.find((n) => {
    const norm = normalizeHeader(n)
    return norm.includes('apolice') && !norm.includes('matriz')
  })

  if (sheetApolName) {
    const sheet = workbook.Sheets[sheetApolName]
    const { headerRowIndex, rawHeaderNames, rows, totalRawRows } = extractSheetRowsWithHeader(
      sheet,
      APOLICE_KEYS,
    )

    const reqKeys = ['id_apolice']
    const foundKeys = Object.keys(rawHeaderNames)
    const missingKeys = reqKeys.filter((k) => !rawHeaderNames[k])

    let processedCount = 0
    let ignoredCount = 0
    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0
    let rowIdx = 0

    // Pré-carrega cadastro de seguradoras para normalização unificada
    const seguradorasCadastradas = await getSeguradorasCadastro().catch(() => [])

    for (const r of rows) {
      rowIdx++
      const idApolice = String(r['id_apolice'] || '').trim()
      if (!idApolice) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      const idEmp = String(r['id_empreendimento'] || '').trim()
      const empRecord = empMap.get(idEmp)
      const empRecordId = empRecord ? String(empRecord.id) : null

      const valorEmRiscoDm = parseNumber(r['valor_em_risco_dm'])
      const lmiIncendioBasica =
        parseNumber(r['lmi_incendio_basica']) ?? (apoliceLmiBasica.get(idApolice) || null)

      let razao: number | null = null
      if (lmiIncendioBasica !== null && valorEmRiscoDm !== null && valorEmRiscoDm > 0) {
        razao = lmiIncendioBasica / valorEmRiscoDm
      } else if (r['razao_lmi_vr_dm']) {
        razao = parseNumber(r['razao_lmi_vr_dm'])
      }

      // Determine default status if missing
      let statusVal = String(r['status'] || '')
        .toLowerCase()
        .trim()
      if (
        !['ativa', 'a vencer', 'vencida', 'renovada', 'não renovada', 'prospect'].includes(
          statusVal,
        )
      ) {
        statusVal = 'ativa'
      }

      // Normalização canônica da seguradora
      const rawSeguradora = String(r['seguradora'] || '').trim()
      let seguradoraCanonica = rawSeguradora
      if (rawSeguradora) {
        // Tenta casar primeiro de forma síncrona/rápida com base no cache
        const matched = seguradorasCadastradas.find(
          (s) =>
            s.nome.trim().toLowerCase() === rawSeguradora.toLowerCase() ||
            normalizarNomeSeguradoraSync(s.nome) === normalizarNomeSeguradoraSync(rawSeguradora),
        )
        if (matched) {
          seguradoraCanonica = matched.nome
        } else {
          seguradoraCanonica = normalizarNomeSeguradoraSync(rawSeguradora) || rawSeguradora
        }
      }

      const payload = {
        id_apolice: idApolice,
        id_empreendimento: empRecordId,
        segurado_na_apolice: String(r['segurado_na_apolice'] || '').trim(),
        cnpj_segurado: String(r['cnpj_segurado'] || '').trim(),
        seguradora: seguradoraCanonica,
        numero_apolice: String(r['numero_apolice'] || '').trim(),
        ramo: String(r['ramo'] || '').trim(),
        corretor: String(r['corretor'] || 'Bycor Consultoria e Corretora de Seguros').trim(),
        data_inicio: parseExcelDate(r['data_inicio']),
        data_fim: parseExcelDate(r['data_fim']),
        premio_liquido: parseNumber(r['premio_liquido']),
        premio_total: parseNumber(r['premio_total']),
        valor_em_risco_dm: valorEmRiscoDm,
        valor_em_risco_lc: parseNumber(r['valor_em_risco_lc']),
        lmga: parseNumber(r['lmga']),
        lmi_incendio_basica: lmiIncendioBasica,
        razao_lmi_vr_dm: razao,
        status: statusVal,
        fonte_arquivo: String(r['fonte_arquivo'] || '').trim(),
        comissao: parseNumber(r['comissao']),
        iof: parseNumber(r['iof']),
        endossos: String(r['endossos'] || '').trim(),
        imported_at: timestamp,
        imported_by: currentUserEmail,
      }

      try {
        let existingRecord = apoliceMap.get(idApolice)
        if (!existingRecord) {
          const fetched = await executeWithRetry(
            () =>
              pb
                .collection('apolices')
                .getFirstListItem(`id_apolice="${idApolice}"`)
                .catch(() => null),
            { throttleMs: 30, maxAttempts: 4 },
          )
          if (fetched) {
            existingRecord = fetched as unknown as Record<string, unknown>
            apoliceMap.set(idApolice, existingRecord)
          }
        }

        if (existingRecord) {
          const recordId = String(existingRecord.id)
          if (isRecordIdentical(existingRecord, payload)) {
            unchangedCount++
            summary.unchangedCount++
            summary.statsByCollection.apolices.unchanged++
            summary.apolicesCount++
            processedCount++
            continue
          }

          onProgress?.(`Atualizando apólice ${rowIdx}/${rows.length}: ${idApolice}...`)
          const updated = await executeWithRetry(() =>
            pb.collection('apolices').update(recordId, payload),
          )
          apoliceMap.set(idApolice, updated as unknown as Record<string, unknown>)
          updatedCount++
          summary.updatedCount++
          summary.statsByCollection.apolices.updated++
        } else {
          onProgress?.(`Criando apólice ${rowIdx}/${rows.length}: ${idApolice}...`)
          const created = await executeWithRetry(() => pb.collection('apolices').create(payload))
          apoliceMap.set(idApolice, created as unknown as Record<string, unknown>)
          createdCount++
          summary.createdCount++
          summary.statsByCollection.apolices.created++
        }
        summary.apolicesCount++
        processedCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro apólice ${idApolice}: ${(err as Error).message}`)
      }
    }

    summary.diagnostics.push({
      sheetName: sheetApolName,
      foundHeaderRowIndex: headerRowIndex + 1,
      requiredKeys: reqKeys,
      foundKeys,
      missingKeys,
      totalRows: totalRawRows,
      processedRows: processedCount,
      ignoredRows: ignoredCount,
      createdRows: createdCount,
      updatedRows: updatedCount,
      unchangedRows: unchangedCount,
    })
  } else {
    summary.diagnostics.push({
      sheetName: 'Apólices (não encontrada)',
      foundHeaderRowIndex: 0,
      requiredKeys: ['id_apolice'],
      foundKeys: [],
      missingKeys: ['id_apolice'],
      totalRows: 0,
      processedRows: 0,
      ignoredRows: 0,
    })
  }

  // 3. Coberturas
  onProgress?.('Importando Coberturas...')
  if (sheetCobName && cobExtraction) {
    const { headerRowIndex, rawHeaderNames, rows, totalRawRows } = cobExtraction
    const reqKeys = ['id_apolice', 'nome_cobertura']
    const foundKeys = Object.keys(rawHeaderNames)
    const missingKeys = reqKeys.filter((k) => !rawHeaderNames[k])

    let processedCount = 0
    let ignoredCount = 0
    let rowIdx = 0

    // Deduplicate / idempotent tracking for this run:
    // Key: id_apolice_record + normalized_nome_cobertura -> PB record
    const existingCobMap = new Map<string, Record<string, unknown>>()
    try {
      const existingCobs = await executeWithRetry(
        () =>
          pb.collection('coberturas').getFullList({
            fields:
              'id,id_apolice,nome_cobertura,categoria_normalizada,lmi_rs,franquia_pos,premio_cobertura',
            batch: 200,
          }),
        { throttleMs: 50, maxAttempts: 6 },
      )
      for (const ec of existingCobs) {
        const k = `${ec.id_apolice}::${normalizeHeader(ec.nome_cobertura)}`
        existingCobMap.set(k, ec as unknown as Record<string, unknown>)
      }
    } catch (err: unknown) {
      summary.errors.push(
        `Aviso: Não foi possível pré-carregar coberturas existentes do banco (${(err as Error).message}).`,
      )
    }

    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0

    for (const c of rows) {
      rowIdx++
      const idApol = String(c['id_apolice'] || '').trim()
      const apoliceRecord = apoliceMap.get(idApol)
      const apoliceRecordId = apoliceRecord ? String(apoliceRecord.id) : null
      const nomeCob = String(c['nome_cobertura'] || '').trim()

      if (!idApol || !apoliceRecordId || !nomeCob) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      const payload = {
        id_apolice: apoliceRecordId,
        nome_cobertura: nomeCob,
        categoria_normalizada: String(c['categoria_normalizada'] || '').trim(),
        lmi_rs: parseNumber(c['lmi_rs']),
        franquia_pos: String(c['franquia_pos'] || '').trim(),
        premio_cobertura: parseNumber(c['premio_cobertura']),
      }

      const cobDedupeKey = `${apoliceRecordId}::${normalizeHeader(nomeCob)}`
      const existingRecord = existingCobMap.get(cobDedupeKey)

      try {
        if (existingRecord) {
          const recordId = String(existingRecord.id)
          // Compare before updating: skip write if already identical
          if (isRecordIdentical(existingRecord, payload)) {
            unchangedCount++
            summary.unchangedCount++
            summary.statsByCollection.coberturas.unchanged++
            summary.coberturasCount++
            processedCount++
            continue
          }

          if (rowIdx % 25 === 0 || rowIdx === rows.length) {
            onProgress?.(`Atualizando coberturas (${rowIdx}/${rows.length})...`)
          }
          const updated = await executeWithRetry(() =>
            pb.collection('coberturas').update(recordId, payload),
          )
          existingCobMap.set(cobDedupeKey, updated as unknown as Record<string, unknown>)
          updatedCount++
          summary.updatedCount++
          summary.statsByCollection.coberturas.updated++
        } else {
          if (rowIdx % 25 === 0 || rowIdx === rows.length) {
            onProgress?.(`Criando coberturas (${rowIdx}/${rows.length})...`)
          }
          const created = await executeWithRetry(() => pb.collection('coberturas').create(payload))
          existingCobMap.set(cobDedupeKey, created as unknown as Record<string, unknown>)
          createdCount++
          summary.createdCount++
          summary.statsByCollection.coberturas.created++
        }
        summary.coberturasCount++
        processedCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro cobertura ${payload.nome_cobertura}: ${(err as Error).message}`)
      }
    }

    summary.diagnostics.push({
      sheetName: sheetCobName,
      foundHeaderRowIndex: headerRowIndex + 1,
      requiredKeys: reqKeys,
      foundKeys,
      missingKeys,
      totalRows: totalRawRows,
      processedRows: processedCount,
      ignoredRows: ignoredCount,
      createdRows: createdCount,
      updatedRows: updatedCount,
      unchangedRows: unchangedCount,
    })
  }

  // 4. Sinistros
  onProgress?.('Lendo aba Sinistros...')
  const sheetSinName = workbook.SheetNames.find((n) => normalizeHeader(n).includes('sinistro'))

  if (sheetSinName) {
    const sheet = workbook.Sheets[sheetSinName]
    const { headerRowIndex, rawHeaderNames, rows, totalRawRows } = extractSheetRowsWithHeader(
      sheet,
      SINISTRO_KEYS,
    )

    const reqKeys = ['id_empreendimento']
    const foundKeys = Object.keys(rawHeaderNames)
    const missingKeys = reqKeys.filter((k) => !rawHeaderNames[k])

    let processedCount = 0
    let ignoredCount = 0
    let rowIdx = 0

    // Deduplication map for sinistros
    // Key: canônica buildSinistroDedupeKey -> PB record
    const existingSinMap = new Map<string, Record<string, unknown>>()
    try {
      const existingSins = await executeWithRetry(
        () =>
          pb.collection('sinistros').getFullList({
            batch: 200,
          }),
        { throttleMs: 50, maxAttempts: 6 },
      )
      for (const es of existingSins) {
        const k = buildSinistroDedupeKey({
          idEmpreendimento: String(es.id_empreendimento || ''),
          numeroSinistro: es.numero_sinistro,
          dataSinistro: es.data_sinistro,
          coberturaAcionada: es.cobertura_acionada,
          descricao: es.descricao,
          valorIndenizadoRs: es.valor_indenizado_rs,
        })
        existingSinMap.set(k, es as unknown as Record<string, unknown>)
      }
    } catch (err: unknown) {
      summary.errors.push(
        `Aviso: Não foi possível pré-carregar sinistros existentes do banco (${(err as Error).message}).`,
      )
    }

    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0

    for (const s of rows) {
      rowIdx++
      const idEmp = String(s['id_empreendimento'] || '').trim()
      const empRecord = empMap.get(idEmp)
      const empRecordId = empRecord ? String(empRecord.id) : null
      if (!idEmp || !empRecordId) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      const idApol = String(s['id_apolice'] || '').trim()
      const apoliceRecord = apoliceMap.get(idApol)
      const apoliceRecordId = apoliceRecord ? String(apoliceRecord.id) : null

      const numeroSinistro = String(s['numero_sinistro'] || '').trim()
      const dataSinistro = parseExcelDate(s['data_sinistro'])
      const cobAcionada = String(s['cobertura_acionada'] || '').trim()
      const descricaoVal = String(s['descricao'] || '').trim()
      const valorIndenizado = parseNumber(s['valor_indenizado_rs'])

      const payload = {
        id_empreendimento: empRecordId,
        id_apolice: apoliceRecordId,
        origem_periodo: String(s['origem_periodo'] || 'Histórico (cartão de risco)').trim(),
        data_sinistro: dataSinistro,
        numero_sinistro: numeroSinistro,
        cobertura_acionada: cobAcionada,
        descricao: descricaoVal,
        valor_indenizado_rs: valorIndenizado,
        status: String(s['status'] || 'Em andamento').trim(),
        fonte: String(s['fonte'] || '').trim(),
      }

      const sinDedupeKey = buildSinistroDedupeKey({
        idEmpreendimento: empRecordId,
        numeroSinistro,
        dataSinistro,
        coberturaAcionada: cobAcionada,
        descricao: descricaoVal,
        valorIndenizadoRs: valorIndenizado,
      })
      const existingRecord = existingSinMap.get(sinDedupeKey)

      try {
        if (existingRecord) {
          const recordId = String(existingRecord.id)
          // Compare before updating: skip write if already identical
          if (isRecordIdentical(existingRecord, payload)) {
            unchangedCount++
            summary.unchangedCount++
            summary.statsByCollection.sinistros.unchanged++
            summary.sinistrosCount++
            processedCount++
            continue
          }

          if (rowIdx % 10 === 0 || rowIdx === rows.length) {
            onProgress?.(`Atualizando sinistros (${rowIdx}/${rows.length})...`)
          }
          const updated = await executeWithRetry(() =>
            pb.collection('sinistros').update(recordId, payload),
          )
          existingSinMap.set(sinDedupeKey, updated as unknown as Record<string, unknown>)
          updatedCount++
          summary.updatedCount++
          summary.statsByCollection.sinistros.updated++
        } else {
          if (rowIdx % 10 === 0 || rowIdx === rows.length) {
            onProgress?.(`Criando sinistros (${rowIdx}/${rows.length})...`)
          }
          const created = await executeWithRetry(() => pb.collection('sinistros').create(payload))
          existingSinMap.set(sinDedupeKey, created as unknown as Record<string, unknown>)
          createdCount++
          summary.createdCount++
          summary.statsByCollection.sinistros.created++
        }
        summary.sinistrosCount++
        processedCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro sinistro: ${(err as Error).message}`)
      }
    }

    summary.diagnostics.push({
      sheetName: sheetSinName,
      foundHeaderRowIndex: headerRowIndex + 1,
      requiredKeys: reqKeys,
      foundKeys,
      missingKeys,
      totalRows: totalRawRows,
      processedRows: processedCount,
      ignoredRows: ignoredCount,
      createdRows: createdCount,
      updatedRows: updatedCount,
      unchangedRows: unchangedCount,
    })
  }

  // =========================================================================
  // 5. Matriz (formato pivotado/cruzado: Categoria x Apólice)
  // PAUSA DE RESPIRO DELIBERADA (3-5 segundos) antes de processar a Matriz
  // para permitir que o rate limit do backend se recupere completamente.
  // =========================================================================
  const sheetMatName = workbook.SheetNames.find((n) => normalizeHeader(n).includes('matriz'))

  // Keep track of matched matriz columns across scopes for reconciliation
  let bestHeaderRowIndex = -1
  let bestColToApoliceMap = new Map<number, { apoliceRecordId: string; rawColName: string }>()

  if (sheetMatName) {
    onProgress?.(
      'Aguardando antes de processar a Matriz (pausa de respiro para recuperação do rate limit)...',
    )
    await sleep(3500)
    onProgress?.('Lendo aba Matriz (formato cruzado Categoria x Apólice)...')

    const sheet = workbook.Sheets[sheetMatName]
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })

    // Build comprehensive candidate pool and lookup maps from existing apólices in PB and apoliceMap/empMap
    const apoliceLookup = new Map<string, string>()
    const apoliceCandidates: ApoliceMatchCandidate[] = []
    let apoliceFetchFailed = false
    let apoliceFetchErrorMsg = ''

    // Helper para registrar variantes diretas no lookup
    const registerApoliceInLookup = (
      apId: string,
      idApoliceVal?: unknown,
      numApoliceVal?: unknown,
      seguradoraVal?: unknown,
      empNameVal?: unknown,
    ) => {
      if (idApoliceVal) {
        const idStr = String(idApoliceVal).trim()
        apoliceLookup.set(normalizeHeader(idStr), apId)
        apoliceLookup.set(idStr.toLowerCase(), apId)
      }
      if (numApoliceVal) {
        const numStr = String(numApoliceVal).trim()
        apoliceLookup.set(normalizeHeader(numStr), apId)
        apoliceLookup.set(numStr.toLowerCase(), apId)
      }
      if (empNameVal) {
        const empStr = String(empNameVal).trim()
        apoliceLookup.set(normalizeHeader(empStr), apId)
        apoliceLookup.set(empStr.toLowerCase(), apId)
        if (seguradoraVal) {
          const segStr = String(seguradoraVal).trim()
          apoliceLookup.set(normalizeHeader(`${empStr} ${segStr}`), apId)
          apoliceLookup.set(`${empStr.toLowerCase()} ${segStr.toLowerCase()}`, apId)
        }
      }
    }

    // 1) Preencher candidatos a partir de apoliceMap e empMap da própria rodada.
    for (const [idAp, rec] of apoliceMap.entries()) {
      const recId = String(rec.id)
      const numApol = String(rec.numero_apolice || '')
      const seguradora = String(rec.seguradora || '')
      const ramo = String(rec.ramo || '')
      const idEmp = rec.id_empreendimento ? String(rec.id_empreendimento).trim() : ''

      let empName: string | undefined
      if (idEmp) {
        const empRec = empMap.get(idEmp)
        if (empRec) {
          empName = (empRec.nome_empreendimento as string) || (empRec.id_empreendimento as string)
        } else {
          for (const e of empMap.values()) {
            if (String(e.id) === idEmp || String(e.id_empreendimento) === idEmp) {
              empName = (e.nome_empreendimento as string) || (e.id_empreendimento as string)
              break
            }
          }
        }
      }

      registerApoliceInLookup(recId, idAp, numApol, seguradora, empName)

      apoliceCandidates.push({
        recordId: recId,
        idApolice: idAp,
        numeroApolice: numApol,
        seguradora,
        ramo,
        idEmpreendimento: idEmp,
        nomeEmpreendimento: empName || '',
      })
    }

    // 2) Tentar enriquecer com releitura de apolices do PB
    try {
      const fullApols = await executeWithRetry(
        () =>
          pb.collection('apolices').getFullList({
            fields: 'id,id_apolice,numero_apolice,seguradora,ramo,id_empreendimento',
            expand: 'id_empreendimento',
            batch: 200,
          }),
        { throttleMs: 60, maxAttempts: 6, baseBackoffMs: 1500 },
      )
      for (const a of fullApols) {
        const empName = (a.expand as { id_empreendimento?: { nome_empreendimento?: string } })
          ?.id_empreendimento?.nome_empreendimento
        registerApoliceInLookup(a.id, a.id_apolice, a.numero_apolice, a.seguradora, empName)

        // Se o registro não estava nos candidatos ou faltava nomeEmpreendimento, atualizar
        const existingCand = apoliceCandidates.find((c) => c.recordId === a.id)
        if (!existingCand) {
          apoliceCandidates.push({
            recordId: a.id,
            idApolice: String(a.id_apolice || ''),
            numeroApolice: String(a.numero_apolice || ''),
            seguradora: String(a.seguradora || ''),
            ramo: String(a.ramo || ''),
            idEmpreendimento: a.id_empreendimento ? String(a.id_empreendimento) : '',
            nomeEmpreendimento: empName || '',
          })
        } else if (empName && !existingCand.nomeEmpreendimento) {
          existingCand.nomeEmpreendimento = empName
        }
      }
    } catch (err: unknown) {
      apoliceFetchFailed = true
      apoliceFetchErrorMsg = (err as Error).message || 'Falha de conexão / rate limit'
    }

    // Função de casamento em duas etapas para cabeçalhos da Matriz:
    // Formato padrão do cabeçalho: "Empreendimento | Seguradora (Ramo)"
    const matchMatrizHeaderToApolice = (
      rawHeader: string,
    ): { apoliceRecordId: string; strategy: string } | null => {
      const trimmedHeader = rawHeader.trim()
      if (!trimmedHeader) return null

      // Se o cabeçalho tiver separador "|"
      if (trimmedHeader.includes('|')) {
        const pipeParts = trimmedHeader.split('|')
        const leftPart = pipeParts[0].trim()
        const rightPart = pipeParts.slice(1).join('|').trim()

        // Extrair texto entre parênteses do lado direito: ex.: "Mitsui (0118 Compreensivo Empr)" -> ramo="0118 Compreensivo Empr", seg="Mitsui"
        let insurerRaw = rightPart
        let ramoRaw = ''
        const parenMatch = rightPart.match(/^(.*?)\((.*)\)\s*$/)
        if (parenMatch) {
          insurerRaw = parenMatch[1].trim()
          ramoRaw = parenMatch[2].trim()
        } else {
          // Pode haver parêntese não fechado devido a truncamento no Excel: "AXA (Riscos Nomeados (Prédi"
          const openParenIdx = rightPart.indexOf('(')
          if (openParenIdx !== -1) {
            insurerRaw = rightPart.slice(0, openParenIdx).trim()
            ramoRaw = rightPart
              .slice(openParenIdx + 1)
              .replace(/\)+$/, '')
              .trim()
          }
        }

        const canonicalInsurer = canonicalizeInsurerName(insurerRaw)

        // ETAPA 1: Filtrar apólices candidatas que casem o empreendimento E a seguradora
        const candidates = apoliceCandidates.filter((cand) => {
          // Match seguradora
          const candInsurerNorm = canonicalizeInsurerName(cand.seguradora)
          const insurerMatches =
            !canonicalInsurer ||
            candInsurerNorm === canonicalInsurer ||
            candInsurerNorm.includes(canonicalInsurer) ||
            canonicalInsurer.includes(candInsurerNorm)
          if (!insurerMatches) return false

          // Match empreendimento
          // Testar contra cand.nomeEmpreendimento, cand.idEmpreendimento e cand.idApolice
          const empMatches =
            (cand.nomeEmpreendimento && matchesEmpreendimento(leftPart, cand.nomeEmpreendimento)) ||
            (cand.idEmpreendimento && matchesEmpreendimento(leftPart, cand.idEmpreendimento)) ||
            matchesEmpreendimento(leftPart, cand.idApolice)

          return empMatches
        })

        if (candidates.length === 1) {
          // Se há apenas 1 candidato e o ramo é compatível (ou vazio), casar!
          if (!ramoRaw) {
            return { apoliceRecordId: candidates[0].recordId, strategy: 'two-step-single' }
          }
          const affinity = scoreRamoAffinity(ramoRaw, candidates[0].ramo)
          // Se não há pontuação nula por conflito explícito (ex.: RC vs Compreensivo)
          if (affinity >= 0) {
            return { apoliceRecordId: candidates[0].recordId, strategy: 'two-step-single' }
          }
        }

        if (candidates.length > 1) {
          // ETAPA 2: Desambiguação por Ramo
          if (ramoRaw) {
            const scored = candidates
              .map((cand) => ({
                cand,
                score: scoreRamoAffinity(ramoRaw, cand.ramo),
              }))
              .filter((item) => item.score > 0)
              .sort((a, b) => b.score - a.score)

            if (scored.length > 0) {
              const best = scored[0]
              const secondBest = scored[1]
              // Se há um vencedor claro (melhor score sem empate no primeiro lugar)
              if (!secondBest || best.score > secondBest.score) {
                return { apoliceRecordId: best.cand.recordId, strategy: 'two-step-disambiguated' }
              }
            }
          }
          // Se ramo não resolver ou empatar, não casar às cegas!
          return null
        }
      }

      // Fallback para casamento exato / direto pelo lookup histórico
      const normH = normalizeHeader(trimmedHeader)
      const exactMatch = apoliceLookup.get(normH) || apoliceLookup.get(trimmedHeader.toLowerCase())
      if (exactMatch) {
        return { apoliceRecordId: exactMatch, strategy: 'lookup-exact' }
      }

      // Fuzzy match conservador (apenas strings longas >= 6 caracteres sem números soltos)
      if (normH.length >= 6 && !/^\d+$/.test(trimmedHeader)) {
        for (const [key, recId] of apoliceLookup.entries()) {
          if (key.length >= 6 && (normH === key || normH.includes(key))) {
            return { apoliceRecordId: recId, strategy: 'lookup-fuzzy' }
          }
        }
      }

      return null
    }

    // Se a leitura falhou E não há apólices conhecidas para casar, ABORTAR a etapa da Matriz
    if (apoliceFetchFailed && apoliceCandidates.length === 0 && apoliceLookup.size === 0) {
      const abortMsg = `Não foi possível carregar as apólices para vincular as colunas da Matriz (${apoliceFetchErrorMsg}) — nenhuma célula da Matriz foi gravada nesta rodada. Aguarde alguns instantes e reimporte.`
      summary.errors.push(abortMsg)
      summary.diagnostics.push({
        sheetName: sheetMatName,
        foundHeaderRowIndex: 0,
        requiredKeys: ['Formato Pivotado (Categoria x Apólice)'],
        foundKeys: [],
        missingKeys: [abortMsg],
        totalRows: rawGrid.length,
        processedRows: 0,
        ignoredRows: 0,
        createdRows: 0,
        updatedRows: 0,
        unchangedRows: 0,
        isPivoted: true,
        categoriesCount: 0,
        matchedColumnsCount: 0,
        unmatchedColumnsCount: 0,
        unmatchedColumns: [],
        unmatchedApoliceColumns: [],
        unmatchedNumericColumns: [],
      })
    } else {
      // Deduplication map for matriz records: key -> PB record
      const existingMatMap = new Map<string, Record<string, unknown>>()
      try {
        const existingMats = await executeWithRetry(
          () =>
            pb.collection('matriz').getFullList({
              fields: 'id,id_apolice,categoria_normalizada,lmi',
              batch: 200,
            }),
          { throttleMs: 50, maxAttempts: 6 },
        )
        for (const em of existingMats) {
          const k = `${em.id_apolice}::${normalizeHeader(em.categoria_normalizada)}`
          existingMatMap.set(k, em as unknown as Record<string, unknown>)
        }
      } catch (err: unknown) {
        summary.errors.push(
          `Aviso: Não foi possível pré-carregar registros existentes da Matriz (${(err as Error).message}).`,
        )
      }

      // Step 5.1: Detect header row by scanning rows for the highest density of columns (and/or match with known apolice headers)
      let bestMatchedCols = 0
      bestColToApoliceMap = new Map<number, { apoliceRecordId: string; rawColName: string }>()
      let bestUnmatchedColInfo: Array<{ colIndex: number; rawHeader: string; isNumeric: boolean }> =
        []

      const scanLimit = Math.min(rawGrid.length, 15)
      for (let r = 0; r < scanLimit; r++) {
        const row = rawGrid[r]
        if (!Array.isArray(row)) continue

        let matchedCount = 0
        const currentColMap = new Map<number, { apoliceRecordId: string; rawColName: string }>()
        const currentUnmatched: Array<{ colIndex: number; rawHeader: string; isNumeric: boolean }> =
          []

        // Column 0 is the category column. Columns 1..N are apolice columns.
        for (let c = 1; c < row.length; c++) {
          const cellVal = row[c]
          if (cellVal === null || cellVal === undefined || String(cellVal).trim() === '') continue

          const rawHeaderStr = String(cellVal).trim()
          const normHeader = normalizeHeader(rawHeaderStr)
          const isNum = typeof cellVal === 'number' || /^\d+(\.\d+)?$/.test(rawHeaderStr)

          // Try structured match (two-step matching + disambiguation)
          let matchedApId: string | undefined
          if (!isNum) {
            const matchRes = matchMatrizHeaderToApolice(rawHeaderStr)
            if (matchRes) {
              matchedApId = matchRes.apoliceRecordId
            }
          }

          if (matchedApId) {
            matchedCount++
            currentColMap.set(c, { apoliceRecordId: matchedApId, rawColName: rawHeaderStr })
          } else {
            currentUnmatched.push({ colIndex: c, rawHeader: rawHeaderStr, isNumeric: isNum })
          }
        }

        if (matchedCount > bestMatchedCols) {
          bestMatchedCols = matchedCount
          bestHeaderRowIndex = r
          bestColToApoliceMap = currentColMap
          bestUnmatchedColInfo = currentUnmatched
        }
      }

      // Fallback: If no apolice matched directly (e.g. apólices sheet was empty or headers use unfamiliar labels),
      // find the first row after row 0 that has multiple columns filled (row 2 typically in Guardia V5)
      if (bestHeaderRowIndex === -1 && rawGrid.length > 0) {
        for (let r = 0; r < scanLimit; r++) {
          const row = rawGrid[r]
          if (!Array.isArray(row)) continue
          const filledCols = row.filter(
            (v) => v !== null && v !== undefined && String(v).trim() !== '',
          ).length
          if (filledCols >= 5) {
            bestHeaderRowIndex = r
            break
          }
        }
        if (bestHeaderRowIndex === -1) bestHeaderRowIndex = 0

        // Re-populate bestColToApoliceMap for the fallback header row
        const fallbackRow = rawGrid[bestHeaderRowIndex] || []
        for (let c = 1; c < fallbackRow.length; c++) {
          const rawHeaderStr = String(fallbackRow[c] || '').trim()
          if (!rawHeaderStr) continue
          const normHeader = normalizeHeader(rawHeaderStr)
          const isNum = typeof fallbackRow[c] === 'number' || /^\d+(\.\d+)?$/.test(rawHeaderStr)
          let matchedApId: string | undefined
          if (!isNum) {
            const matchRes = matchMatrizHeaderToApolice(rawHeaderStr)
            if (matchRes) {
              matchedApId = matchRes.apoliceRecordId
            }
          }
          if (matchedApId) {
            bestColToApoliceMap.set(c, { apoliceRecordId: matchedApId, rawColName: rawHeaderStr })
          } else {
            bestUnmatchedColInfo.push({ colIndex: c, rawHeader: rawHeaderStr, isNumeric: isNum })
          }
        }
      }

      // DETECÇÃO DE CASAMENTO DEGENERADO:
      // Contar quantas colunas preenchidas existem na linha de cabeçalho vs quantas casaram.
      // Se a fração casada for implausivelmente baixa (< 40% das colunas preenchidas casaram,
      // sendo que há apólices conhecidas no lookup), tratar como falha de casamento:
      // NÃO gravar células nesta rodada, NÃO empurrar "N coluna(s) sem apólice" como erro residual,
      // e em vez disso empurrar uma mensagem clara e acionável.
      const headerRow = rawGrid[bestHeaderRowIndex] || []
      const filledHeaderCols = (Array.isArray(headerRow) ? headerRow : [])
        .slice(1)
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length
      const matchedColsCount = bestColToApoliceMap.size
      const matchRatio = filledHeaderCols > 0 ? matchedColsCount / filledHeaderCols : 0

      // Separar colunas não casadas em numéricas e de apólice (texto)
      const rawUnmatchedNames = bestUnmatchedColInfo.map((u) => u.rawHeader)
      const numericUnmatchedCols = bestUnmatchedColInfo
        .filter((u) => u.isNumeric)
        .map((u) => u.rawHeader)
      const apoliceUnmatchedCols = bestUnmatchedColInfo
        .filter((u) => !u.isNumeric)
        .map((u) => u.rawHeader)

      const isDegenerateMatch =
        (apoliceCandidates.length > 0 || apoliceLookup.size > 0) &&
        filledHeaderCols >= 5 &&
        (matchedColsCount === 0 || matchRatio < 0.4)

      if (isDegenerateMatch) {
        const degenerateMsg = `Não foi possível vincular as colunas da Matriz às apólices nesta rodada (casamento degenerado: apenas ${matchedColsCount} de ${filledHeaderCols} colunas casadas) — nenhuma célula gravada; aguarde alguns instantes e reimporte.`
        summary.errors.push(degenerateMsg)
        summary.diagnostics.push({
          sheetName: sheetMatName,
          foundHeaderRowIndex: bestHeaderRowIndex + 1,
          requiredKeys: ['Formato Pivotado (Categoria x Apólice)'],
          foundKeys: [`${matchedColsCount} de ${filledHeaderCols} colunas reconhecidas`],
          missingKeys: [degenerateMsg],
          totalRows: rawGrid.length,
          processedRows: 0,
          ignoredRows: 0,
          createdRows: 0,
          updatedRows: 0,
          unchangedRows: 0,
          isPivoted: true,
          categoriesCount: 0,
          matchedColumnsCount: matchedColsCount,
          unmatchedColumnsCount: apoliceUnmatchedCols.length,
          unmatchedColumns: rawUnmatchedNames,
          unmatchedApoliceColumns: apoliceUnmatchedCols,
          unmatchedNumericColumns: numericUnmatchedCols,
        })
      } else {
        let processedCount = 0
        let ignoredCount = 0
        let categoriesCount = 0
        let createdCount = 0
        let updatedCount = 0
        let unchangedCount = 0

        // Step 5.2: Iterate through rows starting after headerRowIndex
        for (let r = bestHeaderRowIndex + 1; r < rawGrid.length; r++) {
          const row = rawGrid[r]
          if (!Array.isArray(row)) continue

          const rawCat = row[0]
          if (rawCat === null || rawCat === undefined || String(rawCat).trim() === '') {
            ignoredCount++
            continue
          }

          const catStr = String(rawCat).trim()
          categoriesCount++

          // For each matched apolice column, read cell value
          for (const [colIdx, apInfo] of bestColToApoliceMap.entries()) {
            const cellVal = row[colIdx]
            const numVal = parseNumber(cellVal)

            // Non-negotiable rule: Células vazias/zeras NÃO geram registro (célula em branco = não contratada)
            if (numVal === null || numVal === undefined || numVal <= 0) {
              continue
            }

            const payload = {
              categoria_normalizada: catStr,
              id_apolice: apInfo.apoliceRecordId,
              lmi: numVal,
            }

            const matDedupeKey = `${apInfo.apoliceRecordId}::${normalizeHeader(catStr)}`
            const existingRecord = existingMatMap.get(matDedupeKey)

            try {
              if (existingRecord) {
                const recordId = String(existingRecord.id)
                // Compare before updating: skip write if already identical
                if (isRecordIdentical(existingRecord, payload)) {
                  unchangedCount++
                  summary.unchangedCount++
                  summary.statsByCollection.matriz.unchanged++
                  summary.matrizCount++
                  processedCount++
                  continue
                }

                const updated = await executeWithRetry(() =>
                  pb.collection('matriz').update(recordId, payload),
                )
                existingMatMap.set(matDedupeKey, updated as unknown as Record<string, unknown>)
                updatedCount++
                summary.updatedCount++
                summary.statsByCollection.matriz.updated++
              } else {
                const created = await executeWithRetry(() =>
                  pb.collection('matriz').create(payload),
                )
                existingMatMap.set(matDedupeKey, created as unknown as Record<string, unknown>)
                createdCount++
                summary.createdCount++
                summary.statsByCollection.matriz.created++
              }
              summary.matrizCount++
              processedCount++
              if (processedCount % 20 === 0) {
                onProgress?.(`Gravando matriz (${processedCount} células processadas)...`)
              }
            } catch (err: unknown) {
              summary.errors.push(
                `Erro matriz (${catStr} / col ${apInfo.rawColName}): ${(err as Error).message}`,
              )
            }
          }
        }

        const numericUnmatched = bestUnmatchedColInfo.filter((u) => u.isNumeric)
        const nonNumericUnmatched = bestUnmatchedColInfo.filter((u) => !u.isNumeric)
        const numericColNames = numericUnmatched.map((u) => u.rawHeader)
        const nonNumericColNames = nonNumericUnmatched.map((u) => u.rawHeader)

        // As colunas de cabeçalho puramente numérico (ex.: 500000, 50000) continuam ignoradas
        // no casamento e são reportadas de forma explicada no diagnóstico (como colunas de totais),
        // NÃO entrando na contagem de "colunas sem apólice" que gera erro residual.
        if (nonNumericUnmatched.length > 0) {
          summary.errors.push(
            `Aba Matriz: ${nonNumericUnmatched.length} coluna(s) de apólice sem correspondência vinculada.`,
          )
        }

        const diagKeys = [
          `${bestColToApoliceMap.size} colunas de apólice vinculadas`,
          `${categoriesCount} categorias lidas`,
        ]
        if (numericUnmatched.length > 0) {
          diagKeys.push(
            `${numericUnmatched.length} coluna(s) com cabeçalho numérico (totais) desconsideradas`,
          )
        }

        summary.diagnostics.push({
          sheetName: sheetMatName,
          foundHeaderRowIndex: bestHeaderRowIndex + 1,
          requiredKeys: ['Formato Pivotado (Categoria x Apólice)'],
          foundKeys: diagKeys,
          missingKeys:
            bestColToApoliceMap.size === 0
              ? ['Nenhuma apólice correspondente vinculada']
              : nonNumericUnmatched.length > 0
                ? nonNumericUnmatched.map((u) => `Coluna sem apólice: "${u.rawHeader}"`)
                : [],
          totalRows: rawGrid.length,
          processedRows: processedCount,
          ignoredRows: ignoredCount,
          createdRows: createdCount,
          updatedRows: updatedCount,
          unchangedRows: unchangedCount,
          isPivoted: true,
          categoriesCount,
          matchedColumnsCount: bestColToApoliceMap.size,
          unmatchedColumnsCount: nonNumericUnmatched.length,
          unmatchedColumns: rawUnmatchedNames,
          unmatchedApoliceColumns: nonNumericColNames,
          unmatchedNumericColumns: numericColNames,
        })
      }
    }
  } else {
    summary.diagnostics.push({
      sheetName: 'Matriz (não encontrada)',
      foundHeaderRowIndex: 0,
      requiredKeys: ['Formato Pivotado (Categoria x Apólice)'],
      foundKeys: [],
      missingKeys: ['Aba não encontrada'],
      totalRows: 0,
      processedRows: 0,
      ignoredRows: 0,
    })
  }

  // 6. Notas
  onProgress?.('Lendo aba Notas...')
  const sheetNotName = workbook.SheetNames.find((n) => normalizeHeader(n).includes('nota'))

  if (sheetNotName) {
    const sheet = workbook.Sheets[sheetNotName]
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })

    // Existing notas in PB to make import 100% idempotent: key -> PB record
    const existingNotasMap = new Map<string, Record<string, unknown>>()
    try {
      const existingNotas = await executeWithRetry(
        () =>
          pb.collection('notas_base').getFullList({
            fields: 'id,titulo,conteudo',
            batch: 200,
          }),
        { throttleMs: 50, maxAttempts: 6 },
      )
      for (const en of existingNotas) {
        const k = normalizeHeader(en.titulo)
        if (k) existingNotasMap.set(k, en as unknown as Record<string, unknown>)
      }
    } catch (err: unknown) {
      summary.errors.push(
        `Aviso: Não foi possível pré-carregar notas existentes do banco (${(err as Error).message}).`,
      )
    }

    // Determine if row 0 is header or note content
    let startRow = 0
    let noteHeaderRowIndex = 1
    if (rawGrid.length > 0) {
      const r0FirstCell = normalizeHeader(rawGrid[0]?.[0])
      if (
        r0FirstCell.includes('titulo') ||
        r0FirstCell.includes('nota') ||
        r0FirstCell.includes('achado') ||
        r0FirstCell.includes('topico') ||
        r0FirstCell.includes('item')
      ) {
        startRow = 1
        noteHeaderRowIndex = 1
      }
    }

    let processedCount = 0
    let ignoredCount = 0
    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0

    for (let r = startRow; r < rawGrid.length; r++) {
      const row = rawGrid[r]
      if (!Array.isArray(row)) continue

      const titulo = String(row[0] || '').trim()
      const conteudo = String(row[1] || '').trim()

      if (!titulo && !conteudo) {
        ignoredCount++
        continue
      }

      const noteTitle = (titulo || conteudo.slice(0, 100)).slice(0, 200)
      const noteNormKey = normalizeHeader(noteTitle)
      const payload = {
        titulo: noteTitle,
        conteudo,
      }
      const existingRecord = existingNotasMap.get(noteNormKey)

      try {
        if (existingRecord) {
          const recordId = String(existingRecord.id)
          // Compare before updating: skip write if already identical
          if (isRecordIdentical(existingRecord, payload)) {
            unchangedCount++
            summary.unchangedCount++
            summary.statsByCollection.notas_base.unchanged++
            summary.notasCount++
            processedCount++
            continue
          }

          const updated = await executeWithRetry(() =>
            pb.collection('notas_base').update(recordId, payload),
          )
          existingNotasMap.set(noteNormKey, updated as unknown as Record<string, unknown>)
          updatedCount++
          summary.updatedCount++
          summary.statsByCollection.notas_base.updated++
        } else {
          const created = await executeWithRetry(() => pb.collection('notas_base').create(payload))
          existingNotasMap.set(noteNormKey, created as unknown as Record<string, unknown>)
          createdCount++
          summary.createdCount++
          summary.statsByCollection.notas_base.created++
        }
        summary.notasCount++
        processedCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro nota: ${(err as Error).message}`)
      }
    }

    summary.diagnostics.push({
      sheetName: sheetNotName,
      foundHeaderRowIndex: noteHeaderRowIndex,
      requiredKeys: ['Coluna 1 (Título)', 'Coluna 2 (Conteúdo)'],
      foundKeys: ['Coluna 1', 'Coluna 2'],
      missingKeys: [],
      totalRows: rawGrid.length,
      processedRows: processedCount,
      ignoredRows: ignoredCount,
      createdRows: createdCount,
      updatedRows: updatedCount,
      unchangedRows: unchangedCount,
    })
  }

  // 7. Rastreabilidade (if in workbook)
  const sheetRastName = workbook.SheetNames.find((n) => n.toLowerCase().includes('rastreabilidade'))
  if (sheetRastName) {
    onProgress?.('Lendo aba Rastreabilidade...')
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetRastName])

    // Load existing rastreabilidade to avoid re-recording identical
    const existingRastMap = new Map<string, Record<string, unknown>>()
    try {
      const existingRasts = await executeWithRetry(
        () => pb.collection('rastreabilidade').getFullList({ batch: 200 }),
        { throttleMs: 50, maxAttempts: 6 },
      )
      for (const er of existingRasts) {
        const k = `${normalizeHeader(er.tabela)}::${normalizeHeader(er.registro)}::${normalizeHeader(er.campos)}`
        existingRastMap.set(k, er as unknown as Record<string, unknown>)
      }
    } catch {
      // ignore
    }

    for (const r of rows) {
      const tabela = String(r['tabela'] || '').trim()
      const registro = String(r['registro'] || '').trim()
      const campos = String(r['campos'] || '').trim()
      const valor_atual = String(r['valor_atual'] || '').trim()
      const documento_fonte = String(r['documento_fonte'] || '').trim()
      const localizacao_no_documento = String(r['localizacao_no_documento'] || '').trim()
      const confianca = String(r['confianca'] || 'Direto do documento').trim()

      const payload = {
        tabela,
        registro,
        campos,
        valor_atual,
        documento_fonte,
        localizacao_no_documento,
        confianca,
        imported_by: currentUserEmail,
      }

      const dedupeKey = `${normalizeHeader(tabela)}::${normalizeHeader(registro)}::${normalizeHeader(campos)}`
      const existingRecord = existingRastMap.get(dedupeKey)

      try {
        if (existingRecord) {
          const recordId = String(existingRecord.id)
          if (isRecordIdentical(existingRecord, payload)) {
            summary.unchangedCount++
            summary.statsByCollection.rastreabilidade.unchanged++
            summary.rastreabilidadeCount++
            continue
          }
          const updated = await executeWithRetry(() =>
            pb.collection('rastreabilidade').update(recordId, payload),
          )
          existingRastMap.set(dedupeKey, updated as unknown as Record<string, unknown>)
          summary.updatedCount++
          summary.statsByCollection.rastreabilidade.updated++
        } else {
          const created = await executeWithRetry(() =>
            pb.collection('rastreabilidade').create(payload),
          )
          existingRastMap.set(dedupeKey, created as unknown as Record<string, unknown>)
          summary.createdCount++
          summary.statsByCollection.rastreabilidade.created++
        }
        summary.rastreabilidadeCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro rastreabilidade: ${(err as Error).message}`)
      }
    }
  }

  // 8. Divergências (if in workbook)
  const sheetDivName = workbook.SheetNames.find((n) => n.toLowerCase().includes('diverg'))
  if (sheetDivName) {
    onProgress?.('Lendo aba Divergências...')
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetDivName])

    // Load existing divergencias to avoid re-recording identical
    const existingDivMap = new Map<string, Record<string, unknown>>()
    try {
      const existingDivs = await executeWithRetry(
        () => pb.collection('divergencias').getFullList({ batch: 200 }),
        { throttleMs: 50, maxAttempts: 6 },
      )
      for (const ed of existingDivs) {
        const k = `${ed.id_empreendimento}::${normalizeHeader(ed.campo)}`
        existingDivMap.set(k, ed as unknown as Record<string, unknown>)
      }
    } catch {
      // ignore
    }

    for (const d of rows) {
      const idEmp = String(d['id_empreendimento'] || '').trim()
      const empRecord = empMap.get(idEmp)
      const empRecordId = empRecord ? String(empRecord.id) : null
      const campo = String(d['campo'] || '').trim()

      const payload = {
        id_empreendimento: empRecordId,
        campo,
        valor_cartao_risco: String(d['valor_cartao_risco'] || '').trim(),
        valor_final_apolice: String(d['valor_final_apolice'] || '').trim(),
        apolice_referencia: String(d['apolice_referencia'] || '').trim(),
        observacao: String(d['observacao'] || '').trim(),
      }

      const dedupeKey = `${empRecordId}::${normalizeHeader(campo)}`
      const existingRecord = existingDivMap.get(dedupeKey)

      try {
        if (existingRecord) {
          const recordId = String(existingRecord.id)
          if (isRecordIdentical(existingRecord, payload)) {
            summary.unchangedCount++
            summary.statsByCollection.divergencias.unchanged++
            summary.divergenciasCount++
            continue
          }
          const updated = await executeWithRetry(() =>
            pb.collection('divergencias').update(recordId, payload),
          )
          existingDivMap.set(dedupeKey, updated as unknown as Record<string, unknown>)
          summary.updatedCount++
          summary.statsByCollection.divergencias.updated++
        } else {
          const created = await executeWithRetry(() =>
            pb.collection('divergencias').create(payload),
          )
          existingDivMap.set(dedupeKey, created as unknown as Record<string, unknown>)
          summary.createdCount++
          summary.statsByCollection.divergencias.created++
        }
        summary.divergenciasCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro divergência: ${(err as Error).message}`)
      }
    }
  }

  // =========================================================================
  // 9. PASSADA DE VERIFICAÇÃO / RECONCILIAÇÃO AUTOMÁTICA
  // Reler do banco as coberturas e matriz gravadas vs esperadas, regravando
  // apenas os faltantes com ritmo mais lento (backoff/throttle estendido),
  // repetindo até zerar falhas residuais transitórias (até 3 passes).
  // =========================================================================
  onProgress?.('Iniciando verificação e reconciliação da base...')

  // Build target list of expected coberturas from workbook
  const expectedCoberturas: Array<{
    apoliceRecordId: string
    nomeCob: string
    payload: {
      id_apolice: string
      nome_cobertura: string
      categoria_normalizada: string
      lmi_rs: number | null
      franquia_pos: string
      premio_cobertura: number | null
    }
    dedupeKey: string
  }> = []

  if (sheetCobName && cobExtraction) {
    for (const c of cobExtraction.rows) {
      const idApol = String(c['id_apolice'] || '').trim()
      const apoliceRecord = apoliceMap.get(idApol)
      const apoliceRecordId = apoliceRecord ? String(apoliceRecord.id) : null
      const nomeCob = String(c['nome_cobertura'] || '').trim()
      if (!idApol || !apoliceRecordId || !nomeCob) continue

      expectedCoberturas.push({
        apoliceRecordId,
        nomeCob,
        payload: {
          id_apolice: apoliceRecordId,
          nome_cobertura: nomeCob,
          categoria_normalizada: String(c['categoria_normalizada'] || '').trim(),
          lmi_rs: parseNumber(c['lmi_rs']),
          franquia_pos: String(c['franquia_pos'] || '').trim(),
          premio_cobertura: parseNumber(c['premio_cobertura']),
        },
        dedupeKey: `${apoliceRecordId}::${normalizeHeader(nomeCob)}`,
      })
    }
  }

  // Build target list of expected matriz cells from workbook
  const expectedMatriz: Array<{
    apoliceRecordId: string
    catStr: string
    rawColName: string
    payload: {
      categoria_normalizada: string
      id_apolice: string
      lmi: number
    }
    dedupeKey: string
  }> = []

  if (sheetMatName) {
    const sheet = workbook.Sheets[sheetMatName]
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    if (bestHeaderRowIndex >= 0 && rawGrid.length > bestHeaderRowIndex + 1) {
      for (let r = bestHeaderRowIndex + 1; r < rawGrid.length; r++) {
        const row = rawGrid[r]
        if (!Array.isArray(row)) continue
        const rawCat = row[0]
        if (rawCat === null || rawCat === undefined || String(rawCat).trim() === '') continue
        const catStr = String(rawCat).trim()

        for (const [colIdx, apInfo] of bestColToApoliceMap.entries()) {
          const numVal = parseNumber(row[colIdx])
          if (numVal === null || numVal === undefined || numVal <= 0) continue

          expectedMatriz.push({
            apoliceRecordId: apInfo.apoliceRecordId,
            catStr,
            rawColName: apInfo.rawColName,
            payload: {
              categoria_normalizada: catStr,
              id_apolice: apInfo.apoliceRecordId,
              lmi: numVal,
            },
            dedupeKey: `${apInfo.apoliceRecordId}::${normalizeHeader(catStr)}`,
          })
        }
      }
    }
  }

  const MAX_RECONCILIATION_PASSES = 3
  let passCount = 0
  let totalReconciled = 0

  while (passCount < MAX_RECONCILIATION_PASSES) {
    passCount++
    onProgress?.(
      `Passe de reconciliação ${passCount}/${MAX_RECONCILIATION_PASSES}: checando registros no banco...`,
    )

    // Query live records from DB to find what's missing
    const liveCobMap = new Map<string, string>() // dedupeKey -> id
    try {
      const liveCobs = await executeWithRetry(
        () => pb.collection('coberturas').getFullList({ fields: 'id,id_apolice,nome_cobertura' }),
        { throttleMs: 80, maxAttempts: 6 },
      )
      for (const lc of liveCobs) {
        liveCobMap.set(`${lc.id_apolice}::${normalizeHeader(lc.nome_cobertura)}`, lc.id)
      }
    } catch {
      // ignore
    }

    const liveMatMap = new Map<string, string>() // dedupeKey -> id
    try {
      const liveMats = await executeWithRetry(
        () =>
          pb.collection('matriz').getFullList({ fields: 'id,id_apolice,categoria_normalizada' }),
        { throttleMs: 80, maxAttempts: 6 },
      )
      for (const lm of liveMats) {
        liveMatMap.set(`${lm.id_apolice}::${normalizeHeader(lm.categoria_normalizada)}`, lm.id)
      }
    } catch {
      // ignore
    }

    const missingCob = expectedCoberturas.filter((ec) => !liveCobMap.has(ec.dedupeKey))
    const missingMat = expectedMatriz.filter((em) => !liveMatMap.has(em.dedupeKey))

    if (missingCob.length === 0 && missingMat.length === 0) {
      // Everything is reconciled!
      break
    }

    onProgress?.(
      `Reconciliação ${passCount}: gravando ${missingCob.length} cobertura(s) e ${missingMat.length} célula(s) de matriz faltantes...`,
    )

    // Re-record missing Coberturas with higher delay
    for (let i = 0; i < missingCob.length; i++) {
      const cobItem = missingCob[i]
      try {
        await executeWithRetry(() => pb.collection('coberturas').create(cobItem.payload), {
          throttleMs: 180,
          baseBackoffMs: 1500,
          maxAttempts: 6,
        })
        totalReconciled++
        summary.createdCount++
        summary.statsByCollection.coberturas.created++
        summary.coberturasCount++
        liveCobMap.set(cobItem.dedupeKey, 'created')
      } catch {
        // will retry on next pass or report if persistent
      }
    }

    // Re-record missing Matriz with higher delay
    for (let i = 0; i < missingMat.length; i++) {
      const matItem = missingMat[i]
      try {
        await executeWithRetry(() => pb.collection('matriz').create(matItem.payload), {
          throttleMs: 180,
          baseBackoffMs: 1500,
          maxAttempts: 6,
        })
        totalReconciled++
        summary.createdCount++
        summary.statsByCollection.matriz.created++
        summary.matrizCount++
        liveMatMap.set(matItem.dedupeKey, 'created')
      } catch {
        // will retry on next pass or report if persistent
      }
    }

    // Small pause between passes
    await sleep(400)
  }

  summary.reconciliationPasses = passCount
  summary.reconciledCount = totalReconciled

  // Final verification: filter out errors from summary.errors that were successfully reconciled
  try {
    const finalLiveCobs = await executeWithRetry(
      () => pb.collection('coberturas').getFullList({ fields: 'id,id_apolice,nome_cobertura' }),
      { throttleMs: 50, maxAttempts: 4 },
    )
    const finalCobSet = new Set(
      finalLiveCobs.map((c) => `${c.id_apolice}::${normalizeHeader(c.nome_cobertura)}`),
    )

    const finalLiveMats = await executeWithRetry(
      () => pb.collection('matriz').getFullList({ fields: 'id,id_apolice,categoria_normalizada' }),
      { throttleMs: 50, maxAttempts: 4 },
    )
    const finalMatSet = new Set(
      finalLiveMats.map((m) => `${m.id_apolice}::${normalizeHeader(m.categoria_normalizada)}`),
    )

    // Clean up summary.errors: remove errors for items that now exist in DB
    summary.errors = summary.errors.filter((errMsg) => {
      // Check if it's a cobertura error that got reconciled
      const cobMatch = errMsg.match(/^Erro cobertura (.*?):/)
      if (cobMatch) {
        const normCobName = normalizeHeader(cobMatch[1])
        // If any record with this name exists for any apolice, or all expected are present
        const isPresent = Array.from(finalCobSet).some((k) => k.endsWith(`::${normCobName}`))
        if (isPresent) return false // Resolved! Filter out from errors
      }

      // Check if it's a matriz error that got reconciled
      const matMatch = errMsg.match(/^Erro matriz \((.*?) \//)
      if (matMatch) {
        const normMatCat = normalizeHeader(matMatch[1])
        const isPresent = Array.from(finalMatSet).some((k) => k.endsWith(`::${normMatCat}`))
        if (isPresent) return false // Resolved! Filter out from errors
      }

      return true
    })
  } catch {
    // ignore
  }

  onProgress?.('Importação concluída!')
  return summary
}
