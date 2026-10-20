import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'

export interface SheetKeyDiagnostic {
  sheetName: string
  foundHeaderRowIndex: number
  requiredKeys: string[]
  foundKeys: string[]
  missingKeys: string[]
  totalRows: number
  processedRows: number
  ignoredRows: number
  // Specific details for pivoted sheets like Matriz
  isPivoted?: boolean
  categoriesCount?: number
  matchedColumnsCount?: number
  unmatchedColumnsCount?: number
  unmatchedColumns?: string[]
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
  errors: string[]
  diagnostics: SheetKeyDiagnostic[]
  retriedSuccessCount?: number
}

// Utility: sleep for a given number of milliseconds
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

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
  const maxAttempts = options?.maxAttempts ?? 4
  const baseBackoffMs = options?.baseBackoffMs ?? 1000
  const throttleMs = options?.throttleMs ?? 80

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

      // Exponential backoff with jitter: ~1s, ~2s, ~4s (+ random jitter 100-300ms)
      const backoffDelay =
        baseBackoffMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250)
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
    errors: [],
    diagnostics: [],
  }

  const timestamp = new Date().toISOString()

  // Pre-load existing IDs into maps for cross-referencing and idempotency
  const empMap = new Map<string, string>() // id_empreendimento -> PB record ID
  try {
    const existingEmps = await executeWithRetry(
      () => pb.collection('empreendimentos').getFullList({ fields: 'id,id_empreendimento' }),
      { throttleMs: 50 },
    )
    for (const e of existingEmps) {
      if (e.id_empreendimento) empMap.set(String(e.id_empreendimento).trim(), e.id)
    }
  } catch {
    // ignore
  }

  const apoliceMap = new Map<string, string>() // id_apolice -> PB record ID
  try {
    const existingApols = await executeWithRetry(
      () => pb.collection('apolices').getFullList({ fields: 'id,id_apolice' }),
      { throttleMs: 50 },
    )
    for (const a of existingApols) {
      if (a.id_apolice) apoliceMap.set(String(a.id_apolice).trim(), a.id)
    }
  } catch {
    // ignore
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
    let rowIdx = 0

    for (const r of rows) {
      rowIdx++
      const idEmp = String(r['id_empreendimento'] || '').trim()
      if (!idEmp) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      onProgress?.(`Gravando empreendimento ${rowIdx}/${rows.length}: ${idEmp}...`)

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
        const existingId = empMap.get(idEmp)
        if (existingId) {
          const updated = await executeWithRetry(() =>
            pb.collection('empreendimentos').update(existingId, payload),
          )
          empMap.set(idEmp, updated.id)
        } else {
          // Double check in PB if not in local map
          const existing = await executeWithRetry(
            () =>
              pb
                .collection('empreendimentos')
                .getFirstListItem(`id_empreendimento="${idEmp}"`)
                .catch(() => null),
            { throttleMs: 30 },
          )
          if (existing) {
            const updated = await executeWithRetry(() =>
              pb.collection('empreendimentos').update(existing.id, payload),
            )
            empMap.set(idEmp, updated.id)
          } else {
            const created = await executeWithRetry(() =>
              pb.collection('empreendimentos').create(payload),
            )
            empMap.set(idEmp, created.id)
          }
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
    let rowIdx = 0

    for (const r of rows) {
      rowIdx++
      const idApolice = String(r['id_apolice'] || '').trim()
      if (!idApolice) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      onProgress?.(`Gravando apólice ${rowIdx}/${rows.length}: ${idApolice}...`)

      const idEmp = String(r['id_empreendimento'] || '').trim()
      const empRecordId = empMap.get(idEmp) || null

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

      const payload = {
        id_apolice: idApolice,
        id_empreendimento: empRecordId,
        segurado_na_apolice: String(r['segurado_na_apolice'] || '').trim(),
        cnpj_segurado: String(r['cnpj_segurado'] || '').trim(),
        seguradora: String(r['seguradora'] || '').trim(),
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
        const existingId = apoliceMap.get(idApolice)
        if (existingId) {
          const updated = await executeWithRetry(() =>
            pb.collection('apolices').update(existingId, payload),
          )
          apoliceMap.set(idApolice, updated.id)
        } else {
          const existing = await executeWithRetry(
            () =>
              pb
                .collection('apolices')
                .getFirstListItem(`id_apolice="${idApolice}"`)
                .catch(() => null),
            { throttleMs: 30 },
          )
          if (existing) {
            const updated = await executeWithRetry(() =>
              pb.collection('apolices').update(existing.id, payload),
            )
            apoliceMap.set(idApolice, updated.id)
          } else {
            const created = await executeWithRetry(() => pb.collection('apolices').create(payload))
            apoliceMap.set(idApolice, created.id)
          }
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
    // Key: id_apolice_record + normalized_nome_cobertura
    const existingCobMap = new Map<string, string>()
    try {
      const existingCobs = await executeWithRetry(
        () => pb.collection('coberturas').getFullList({ fields: 'id,id_apolice,nome_cobertura' }),
        { throttleMs: 50 },
      )
      for (const ec of existingCobs) {
        const k = `${ec.id_apolice}::${normalizeHeader(ec.nome_cobertura)}`
        existingCobMap.set(k, ec.id)
      }
    } catch {
      // ignore
    }

    for (const c of rows) {
      rowIdx++
      const idApol = String(c['id_apolice'] || '').trim()
      const apoliceRecordId = apoliceMap.get(idApol)
      const nomeCob = String(c['nome_cobertura'] || '').trim()

      if (!idApol || !apoliceRecordId || !nomeCob) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      if (rowIdx % 25 === 0 || rowIdx === rows.length) {
        onProgress?.(`Gravando coberturas (${rowIdx}/${rows.length})...`)
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
      const existingCobId = existingCobMap.get(cobDedupeKey)

      try {
        if (existingCobId) {
          await executeWithRetry(() => pb.collection('coberturas').update(existingCobId, payload))
        } else {
          const created = await executeWithRetry(() => pb.collection('coberturas').create(payload))
          existingCobMap.set(cobDedupeKey, created.id)
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
    // Key: id_empreendimento_record + (numero_sinistro || data_sinistro + cobertura)
    const existingSinMap = new Map<string, string>()
    try {
      const existingSins = await executeWithRetry(
        () =>
          pb.collection('sinistros').getFullList({
            fields: 'id,id_empreendimento,numero_sinistro,data_sinistro,cobertura_acionada',
          }),
        { throttleMs: 50 },
      )
      for (const es of existingSins) {
        const num = String(es.numero_sinistro || '')
          .trim()
          .toLowerCase()
        const k = num
          ? `${es.id_empreendimento}::num::${num}`
          : `${es.id_empreendimento}::dt::${es.data_sinistro}::${normalizeHeader(es.cobertura_acionada)}`
        existingSinMap.set(k, es.id)
      }
    } catch {
      // ignore
    }

    for (const s of rows) {
      rowIdx++
      const idEmp = String(s['id_empreendimento'] || '').trim()
      const empRecordId = empMap.get(idEmp) || null
      if (!idEmp || !empRecordId) {
        ignoredCount++
        summary.ignoredRowsCount++
        continue
      }

      if (rowIdx % 10 === 0 || rowIdx === rows.length) {
        onProgress?.(`Gravando sinistros (${rowIdx}/${rows.length})...`)
      }

      const idApol = String(s['id_apolice'] || '').trim()
      const apoliceRecordId = apoliceMap.get(idApol) || null

      const numeroSinistro = String(s['numero_sinistro'] || '').trim()
      const dataSinistro = parseExcelDate(s['data_sinistro'])
      const cobAcionada = String(s['cobertura_acionada'] || '').trim()

      const payload = {
        id_empreendimento: empRecordId,
        id_apolice: apoliceRecordId,
        origem_periodo: String(s['origem_periodo'] || 'Histórico (cartão de risco)').trim(),
        data_sinistro: dataSinistro,
        numero_sinistro: numeroSinistro,
        cobertura_acionada: cobAcionada,
        descricao: String(s['descricao'] || '').trim(),
        valor_indenizado_rs: parseNumber(s['valor_indenizado_rs']),
        status: String(s['status'] || 'Em andamento').trim(),
        fonte: String(s['fonte'] || '').trim(),
      }

      const sinDedupeKey = numeroSinistro
        ? `${empRecordId}::num::${numeroSinistro.toLowerCase()}`
        : `${empRecordId}::dt::${dataSinistro}::${normalizeHeader(cobAcionada)}`
      const existingSinId = existingSinMap.get(sinDedupeKey)

      try {
        if (existingSinId) {
          await executeWithRetry(() => pb.collection('sinistros').update(existingSinId, payload))
        } else {
          const created = await executeWithRetry(() => pb.collection('sinistros').create(payload))
          existingSinMap.set(sinDedupeKey, created.id)
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
    })
  }

  // 5. Matriz (formato pivotado/cruzado: Categoria x Apólice)
  onProgress?.('Lendo aba Matriz (formato cruzado Categoria x Apólice)...')
  const sheetMatName = workbook.SheetNames.find((n) => normalizeHeader(n).includes('matriz'))

  if (sheetMatName) {
    const sheet = workbook.Sheets[sheetMatName]
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })

    // Build comprehensive lookup map from existing apólices in PB
    // Maps various identifiers (id_apolice, numero_apolice, seguradora, ramo, nome_empreendimento) to apolice PB record ID
    const apoliceLookup = new Map<string, string>()
    try {
      const fullApols = await executeWithRetry(
        () =>
          pb.collection('apolices').getFullList({
            fields: 'id,id_apolice,numero_apolice,seguradora,ramo,id_empreendimento',
            expand: 'id_empreendimento',
          }),
        { throttleMs: 50 },
      )
      for (const a of fullApols) {
        if (a.id_apolice) {
          apoliceLookup.set(normalizeHeader(a.id_apolice), a.id)
          apoliceLookup.set(String(a.id_apolice).trim().toLowerCase(), a.id)
        }
        if (a.numero_apolice) {
          apoliceLookup.set(normalizeHeader(a.numero_apolice), a.id)
          apoliceLookup.set(String(a.numero_apolice).trim().toLowerCase(), a.id)
        }
        // Expand empreendimento name if available
        const empName = (a.expand as { id_empreendimento?: { nome_empreendimento?: string } })
          ?.id_empreendimento?.nome_empreendimento
        if (empName) {
          apoliceLookup.set(normalizeHeader(empName), a.id)
          if (a.seguradora) {
            apoliceLookup.set(normalizeHeader(`${empName} ${a.seguradora}`), a.id)
          }
        }
      }
    } catch {
      // ignore
    }
    // Also merge from apoliceMap loaded during this run
    for (const [idAp, recId] of apoliceMap.entries()) {
      apoliceLookup.set(normalizeHeader(idAp), recId)
      apoliceLookup.set(idAp.trim().toLowerCase(), recId)
    }

    // Deduplication map for matriz records
    // Key: id_apolice_record + normalized_categoria
    const existingMatMap = new Map<string, string>()
    try {
      const existingMats = await executeWithRetry(
        () =>
          pb.collection('matriz').getFullList({
            fields: 'id,id_apolice,categoria_normalizada',
          }),
        { throttleMs: 50 },
      )
      for (const em of existingMats) {
        const k = `${em.id_apolice}::${normalizeHeader(em.categoria_normalizada)}`
        existingMatMap.set(k, em.id)
      }
    } catch {
      // ignore
    }

    // Step 5.1: Detect header row by scanning rows for the highest density of columns (and/or match with known apolice headers)
    let bestHeaderRowIndex = -1
    let bestMatchedCols = 0
    let bestColToApoliceMap = new Map<number, { apoliceRecordId: string; rawColName: string }>()
    let bestUnmatchedColNames: string[] = []

    const scanLimit = Math.min(rawGrid.length, 15)
    for (let r = 0; r < scanLimit; r++) {
      const row = rawGrid[r]
      if (!Array.isArray(row)) continue

      let matchedCount = 0
      const currentColMap = new Map<number, { apoliceRecordId: string; rawColName: string }>()
      const currentUnmatched: string[] = []

      // Column 0 is the category column. Columns 1..N are apolice columns.
      for (let c = 1; c < row.length; c++) {
        const cellVal = row[c]
        if (cellVal === null || cellVal === undefined || String(cellVal).trim() === '') continue

        const rawHeaderStr = String(cellVal).trim()
        const normHeader = normalizeHeader(rawHeaderStr)

        // Try exact / normalized match
        let matchedApId =
          apoliceLookup.get(normHeader) || apoliceLookup.get(rawHeaderStr.toLowerCase())

        // If not matched, try fuzzy match against known apolice identifiers
        if (!matchedApId && normHeader.length >= 3) {
          for (const [key, recId] of apoliceLookup.entries()) {
            if (key.length >= 4 && (normHeader.includes(key) || key.includes(normHeader))) {
              matchedApId = recId
              break
            }
          }
        }

        if (matchedApId) {
          matchedCount++
          currentColMap.set(c, { apoliceRecordId: matchedApId, rawColName: rawHeaderStr })
        } else {
          currentUnmatched.push(rawHeaderStr)
        }
      }

      if (matchedCount > bestMatchedCols) {
        bestMatchedCols = matchedCount
        bestHeaderRowIndex = r
        bestColToApoliceMap = currentColMap
        bestUnmatchedColNames = currentUnmatched
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
        let matchedApId =
          apoliceLookup.get(normHeader) || apoliceLookup.get(rawHeaderStr.toLowerCase())
        if (!matchedApId && normHeader.length >= 3) {
          for (const [key, recId] of apoliceLookup.entries()) {
            if (key.length >= 4 && (normHeader.includes(key) || key.includes(normHeader))) {
              matchedApId = recId
              break
            }
          }
        }
        if (matchedApId) {
          bestColToApoliceMap.set(c, { apoliceRecordId: matchedApId, rawColName: rawHeaderStr })
        } else {
          bestUnmatchedColNames.push(rawHeaderStr)
        }
      }
    }

    let processedCount = 0
    let ignoredCount = 0
    let categoriesCount = 0

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
        const existingMatId = existingMatMap.get(matDedupeKey)

        try {
          if (existingMatId) {
            await executeWithRetry(() => pb.collection('matriz').update(existingMatId, payload))
          } else {
            const created = await executeWithRetry(() => pb.collection('matriz').create(payload))
            existingMatMap.set(matDedupeKey, created.id)
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

    if (bestUnmatchedColNames.length > 0) {
      summary.errors.push(
        `Aba Matriz: ${bestUnmatchedColNames.length} coluna(s) sem apólice correspondente vinculada: ${bestUnmatchedColNames.slice(0, 5).join(', ')}${bestUnmatchedColNames.length > 5 ? '...' : ''}`,
      )
    }

    summary.diagnostics.push({
      sheetName: sheetMatName,
      foundHeaderRowIndex: bestHeaderRowIndex + 1,
      requiredKeys: ['Formato Pivotado (Categoria x Apólice)'],
      foundKeys: [
        `${bestColToApoliceMap.size} colunas de apólice vinculadas`,
        `${categoriesCount} categorias lidas`,
      ],
      missingKeys:
        bestColToApoliceMap.size === 0 ? ['Nenhuma apólice correspondente vinculada'] : [],
      totalRows: rawGrid.length,
      processedRows: processedCount,
      ignoredRows: ignoredCount,
      isPivoted: true,
      categoriesCount,
      matchedColumnsCount: bestColToApoliceMap.size,
      unmatchedColumnsCount: bestUnmatchedColNames.length,
      unmatchedColumns: bestUnmatchedColNames,
    })
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

    // Existing notas in PB to make import 100% idempotent
    const existingNotasMap = new Map<string, string>() // normalized_titulo -> record ID
    try {
      const existingNotas = await executeWithRetry(
        () =>
          pb.collection('notas_base').getFullList({
            fields: 'id,titulo,conteudo',
          }),
        { throttleMs: 50 },
      )
      for (const en of existingNotas) {
        const k = normalizeHeader(en.titulo)
        if (k) existingNotasMap.set(k, en.id)
      }
    } catch {
      // ignore
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
      const existingNoteId = existingNotasMap.get(noteNormKey)

      try {
        if (existingNoteId) {
          // Update existing note instead of creating duplicate
          await executeWithRetry(() =>
            pb.collection('notas_base').update(existingNoteId, {
              titulo: noteTitle,
              conteudo,
            }),
          )
        } else {
          const created = await executeWithRetry(() =>
            pb.collection('notas_base').create({
              titulo: noteTitle,
              conteudo,
            }),
          )
          existingNotasMap.set(noteNormKey, created.id)
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
    })
  }

  // 7. Rastreabilidade (if in workbook)
  const sheetRastName = workbook.SheetNames.find((n) => n.toLowerCase().includes('rastreabilidade'))
  if (sheetRastName) {
    onProgress?.('Lendo aba Rastreabilidade...')
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetRastName])
    for (const r of rows) {
      try {
        await executeWithRetry(() =>
          pb.collection('rastreabilidade').create({
            tabela: String(r['tabela'] || '').trim(),
            registro: String(r['registro'] || '').trim(),
            campos: String(r['campos'] || '').trim(),
            valor_atual: String(r['valor_atual'] || '').trim(),
            documento_fonte: String(r['documento_fonte'] || '').trim(),
            localizacao_no_documento: String(r['localizacao_no_documento'] || '').trim(),
            confianca: String(r['confianca'] || 'Direto do documento').trim(),
            imported_by: currentUserEmail,
          }),
        )
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
    for (const d of rows) {
      const idEmp = String(d['id_empreendimento'] || '').trim()
      const empRecordId = empMap.get(idEmp) || null
      try {
        await executeWithRetry(() =>
          pb.collection('divergencias').create({
            id_empreendimento: empRecordId,
            campo: String(d['campo'] || '').trim(),
            valor_cartao_risco: String(d['valor_cartao_risco'] || '').trim(),
            valor_final_apolice: String(d['valor_final_apolice'] || '').trim(),
            apolice_referencia: String(d['apolice_referencia'] || '').trim(),
            observacao: String(d['observacao'] || '').trim(),
          }),
        )
        summary.divergenciasCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro divergência: ${(err as Error).message}`)
      }
    }
  }

  onProgress?.('Importação concluída!')
  return summary
}
