import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'

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
    const s = val.toLowerCase().trim()
    return s === 'sim' || s === 'true' || s === '1' || s === 's'
  }
  return false
}

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
  }

  const timestamp = new Date().toISOString()

  // 1. Empreendimentos
  onProgress?.('Lendo aba Empreendimentos...')
  const sheetEmpName = workbook.SheetNames.find((n) => n.toLowerCase().includes('empreendimento'))
  const empMap = new Map<string, string>() // id_empreendimento -> PB record ID

  if (sheetEmpName) {
    const sheet = workbook.Sheets[sheetEmpName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)

    for (const r of rows) {
      const idEmp = String(r['id_empreendimento'] || r['ID_EMPREENDIMENTO'] || '').trim()
      if (!idEmp) {
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
        // Idempotent search
        const existing = await pb
          .collection('empreendimentos')
          .getFirstListItem(`id_empreendimento="${idEmp}"`)
          .catch(() => null)
        if (existing) {
          const updated = await pb.collection('empreendimentos').update(existing.id, payload)
          empMap.set(idEmp, updated.id)
        } else {
          const created = await pb.collection('empreendimentos').create(payload)
          empMap.set(idEmp, created.id)
        }
        summary.empreendimentosCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro empreendimento ${idEmp}: ${(err as Error).message}`)
      }
    }
  }

  // 2. Apólices
  onProgress?.('Lendo aba Apólices...')
  const sheetApolName = workbook.SheetNames.find(
    (n) => n.toLowerCase().includes('apólice') || n.toLowerCase().includes('apolice'),
  )
  const apoliceMap = new Map<string, string>() // id_apolice -> PB record ID
  const apoliceLmiBasica = new Map<string, number>() // pre-calculated from coberturas if available

  // Let's first pre-read Coberturas to calculate LMI Incêndio Básica per id_apolice
  const sheetCobName = workbook.SheetNames.find((n) => n.toLowerCase().includes('cobertura'))
  const cobRows = sheetCobName
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetCobName])
    : []

  for (const c of cobRows) {
    const apId = String(c['id_apolice'] || '').trim()
    const cat = String(c['categoria_normalizada'] || '').trim()
    if (apId && cat.toLowerCase().includes('incêndio básica')) {
      const lmi = parseNumber(c['lmi_rs']) || 0
      apoliceLmiBasica.set(apId, (apoliceLmiBasica.get(apId) || 0) + lmi)
    }
  }

  if (sheetApolName) {
    const sheet = workbook.Sheets[sheetApolName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)

    for (const r of rows) {
      const idApolice = String(r['id_apolice'] || '').trim()
      if (!idApolice) {
        summary.ignoredRowsCount++
        continue
      }

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
        const existing = await pb
          .collection('apolices')
          .getFirstListItem(`id_apolice="${idApolice}"`)
          .catch(() => null)
        if (existing) {
          const updated = await pb.collection('apolices').update(existing.id, payload)
          apoliceMap.set(idApolice, updated.id)
        } else {
          const created = await pb.collection('apolices').create(payload)
          apoliceMap.set(idApolice, created.id)
        }
        summary.apolicesCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro apólice ${idApolice}: ${(err as Error).message}`)
      }
    }
  }

  // 3. Coberturas
  onProgress?.('Importando Coberturas...')
  for (const c of cobRows) {
    const idApol = String(c['id_apolice'] || '').trim()
    const apoliceRecordId = apoliceMap.get(idApol)
    if (!idApol || !apoliceRecordId) {
      summary.ignoredRowsCount++
      continue
    }

    const payload = {
      id_apolice: apoliceRecordId,
      nome_cobertura: String(c['nome_cobertura'] || '').trim(),
      categoria_normalizada: String(c['categoria_normalizada'] || '').trim(),
      lmi_rs: parseNumber(c['lmi_rs']),
      franquia_pos: String(c['franquia_pos'] || '').trim(),
      premio_cobertura: parseNumber(c['premio_cobertura']),
    }

    try {
      await pb.collection('coberturas').create(payload)
      summary.coberturasCount++
    } catch (err: unknown) {
      summary.errors.push(`Erro cobertura ${payload.nome_cobertura}: ${(err as Error).message}`)
    }
  }

  // 4. Sinistros
  onProgress?.('Lendo aba Sinistros...')
  const sheetSinName = workbook.SheetNames.find((n) => n.toLowerCase().includes('sinistro'))
  if (sheetSinName) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetSinName])
    for (const s of rows) {
      const idEmp = String(s['id_empreendimento'] || '').trim()
      const empRecordId = empMap.get(idEmp) || null
      if (!empRecordId) {
        summary.ignoredRowsCount++
        continue
      }

      const idApol = String(s['id_apolice'] || '').trim()
      const apoliceRecordId = apoliceMap.get(idApol) || null

      const payload = {
        id_empreendimento: empRecordId,
        id_apolice: apoliceRecordId,
        origem_periodo: String(s['origem_periodo'] || 'Histórico (cartão de risco)').trim(),
        data_sinistro: parseExcelDate(s['data_sinistro']),
        numero_sinistro: String(s['numero_sinistro'] || '').trim(),
        cobertura_acionada: String(s['cobertura_acionada'] || '').trim(),
        descricao: String(s['descricao'] || '').trim(),
        valor_indenizado_rs: parseNumber(s['valor_indenizado_rs']),
        status: String(s['status'] || 'Em andamento').trim(),
        fonte: String(s['fonte'] || '').trim(),
      }

      try {
        await pb.collection('sinistros').create(payload)
        summary.sinistrosCount++
      } catch (err: unknown) {
        summary.errors.push(`Erro sinistro: ${(err as Error).message}`)
      }
    }
  }

  // 5. Matriz
  onProgress?.('Lendo aba Matriz...')
  const sheetMatName = workbook.SheetNames.find((n) => n.toLowerCase().includes('matriz'))
  if (sheetMatName) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetMatName])
    for (const m of rows) {
      const cat = String(m['categoria_normalizada'] || '').trim()
      const idApol = String(m['id_apolice'] || '').trim()
      const apRecordId = apoliceMap.get(idApol)

      if (cat && apRecordId) {
        try {
          await pb.collection('matriz').create({
            categoria_normalizada: cat,
            id_apolice: apRecordId,
            lmi: parseNumber(m['lmi']),
          })
          summary.matrizCount++
        } catch {
          // ignore duplicate
        }
      }
    }
  }

  // 6. Notas
  onProgress?.('Lendo aba Notas...')
  const sheetNotName = workbook.SheetNames.find((n) => n.toLowerCase().includes('nota'))
  if (sheetNotName) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetNotName])
    for (const n of rows) {
      const keys = Object.keys(n)
      const titulo = String(n[keys[0]] || '').trim()
      const conteudo = String(n[keys[1]] || '').trim()

      if (titulo || conteudo) {
        try {
          await pb.collection('notas_base').create({
            titulo: titulo.slice(0, 200),
            conteudo,
          })
          summary.notasCount++
        } catch {
          // ignore
        }
      }
    }
  }

  // 7. Rastreabilidade (if in workbook)
  const sheetRastName = workbook.SheetNames.find((n) => n.toLowerCase().includes('rastreabilidade'))
  if (sheetRastName) {
    onProgress?.('Lendo aba Rastreabilidade...')
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetRastName])
    for (const r of rows) {
      try {
        await pb.collection('rastreabilidade').create({
          tabela: String(r['tabela'] || '').trim(),
          registro: String(r['registro'] || '').trim(),
          campos: String(r['campos'] || '').trim(),
          valor_atual: String(r['valor_atual'] || '').trim(),
          documento_fonte: String(r['documento_fonte'] || '').trim(),
          localizacao_no_documento: String(r['localizacao_no_documento'] || '').trim(),
          confianca: String(r['confianca'] || 'Direto do documento').trim(),
          imported_by: currentUserEmail,
        })
        summary.rastreabilidadeCount++
      } catch {
        // ignore
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
        await pb.collection('divergencias').create({
          id_empreendimento: empRecordId,
          campo: String(d['campo'] || '').trim(),
          valor_cartao_risco: String(d['valor_cartao_risco'] || '').trim(),
          valor_final_apolice: String(d['valor_final_apolice'] || '').trim(),
          apolice_referencia: String(d['apolice_referencia'] || '').trim(),
          observacao: String(d['observacao'] || '').trim(),
        })
        summary.divergenciasCount++
      } catch {
        // ignore
      }
    }
  }

  onProgress?.('Importação concluída!')
  return summary
}
