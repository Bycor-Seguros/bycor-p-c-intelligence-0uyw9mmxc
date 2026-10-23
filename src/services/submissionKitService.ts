import * as XLSX from 'xlsx'
import pb from '@/lib/pocketbase/client'
import { formatCurrency, formatCnpj, formatDate } from '@/lib/formatters'

export interface SubmissionKitField {
  id: string
  label: string
  value: string
  categoria:
    | 'Empreendimento'
    | 'VRD e Valores'
    | 'Construção e Riscos'
    | 'Proteções'
    | 'Coberturas'
    | 'Sinistros'
    | 'SLA e Processo'
  destaque?: boolean
}

export interface SubmissionKitCobertura {
  nome: string
  categoriaNormalizada: string
  isAtual: number | null
  isAtualizada: number | null
  isEscolhida: number | null
  franquiaPos: string
  observacao: string
}

/**
 * Retorna o valor efetivo de Importância Segurada (IS) de uma cobertura
 * Prioridade: isEscolhida > isAtualizada > isAtual (apenas valores > 0)
 */
export function getEffectiveIS(cob: SubmissionKitCobertura): number | null {
  if (typeof cob.isEscolhida === 'number' && cob.isEscolhida > 0) {
    return cob.isEscolhida
  }
  if (typeof cob.isAtualizada === 'number' && cob.isAtualizada > 0) {
    return cob.isAtualizada
  }
  if (typeof cob.isAtual === 'number' && cob.isAtual > 0) {
    return cob.isAtual
  }
  return null
}

function normalizeSortText(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function hasNonBasicaIndicators(text: string): boolean {
  if (!text) return false
  // Responsabilidade Civil / Garagista / Guarda de Veículos
  if (/\b(rc|resp\.?\s*civil|responsabilidade\s+civil|garagista)\b/i.test(text)) return true
  if (/guarda\s+de\s+ve[ií]culos?/i.test(text)) return true
  if (/\bve[ií]culos?\b/i.test(text)) return true
  // Queimadas e zonas rurais
  if (/\bqueimadas?\b/i.test(text) || /zonas?\s+rurais?/i.test(text)) return true
  // Salvamento e Contenção
  if (/\bsalvamento\b/i.test(text) || /\bconten[cç][aã]o\b/i.test(text)) return true
  // Bens de condôminos / terceiros / hóspedes
  if (/bens\s+de\s+(cond[oô]minos?|terceiros?|h[oó]spedes?)/i.test(text)) return true
  if (/sub[- ]?l[ií]mite/i.test(text)) return true
  // Lucros cessantes, perda de receita, despesas fixas, aluguel
  if (/lucros?\s+cessantes?/i.test(text) || /perda\s+de\s+receita/i.test(text)) return true
  if (/lucro\s+(bruto|l[ií]quido)/i.test(text) || /despesas?\s+fixas?/i.test(text)) return true
  if (/\baluguel\b/i.test(text) || /despesas?\s+extraordin[aá]rias?/i.test(text)) return true
  // Outras coberturas específicas (RC ou danos específicos)
  if (
    /danos?\s+morais?/i.test(text) ||
    /\bempregador\b/i.test(text) ||
    /\bs[ií]ndico\b/i.test(text)
  )
    return true
  if (/danos?\s+el[eé]tricos?/i.test(text)) return true
  if (/quebra\s+de\s+(m[aá]quinas?|vidros?)/i.test(text)) return true
  if (/assist[eê]ncia\s+24h?/i.test(text)) return true
  return false
}

export function isCoberturaBasica(cob: { nome: string; categoriaNormalizada?: string }): boolean {
  const normNome = normalizeSortText(cob.nome)
  const normCat = normalizeSortText(cob.categoriaNormalizada || '')

  // Se o nome ou a categoria contiver qualquer indicador expresso de cobertura não-básica,
  // desqualifica imediatamente (ex.: RC, Guarda de Veículos, Garagista, Queimadas, Salvamento, Lucros Cessantes)
  if (hasNonBasicaIndicators(normNome) || hasNonBasicaIndicators(normCat)) {
    return false
  }

  // Categoria canônica exata de Cobertura Básica (Incêndio Básica / Danos Materiais)
  if (
    normCat === 'incendio basica (danos materiais)' ||
    normCat === 'incendio basica' ||
    normCat === 'cobertura basica'
  ) {
    return true
  }

  // Nome começando por "básica" ou "cobertura básica"
  if (
    normNome.startsWith('basica') ||
    normNome.startsWith('cobertura basica') ||
    normNome === 'basica' ||
    normNome === 'cobertura basica'
  ) {
    return true
  }

  // Nome expressando Danos Materiais (prédio/conteúdo) ou Incêndio Básica
  if (
    normNome.includes('incendio basica') ||
    (normNome.includes('danos materiais') &&
      (normNome.includes('predio') ||
        normNome.includes('conteudo') ||
        normNome.includes('incendio')))
  ) {
    return true
  }

  // Combinação padrão de riscos da Cobertura Básica:
  // Contém "incendio" e pelo menos um evento essencial da básica (raio, explosao, implosao, fumaca, queda de aeronave)
  if (
    normNome.includes('incendio') &&
    (normNome.includes('raio') ||
      normNome.includes('explosao') ||
      normNome.includes('implosao') ||
      normNome.includes('fumaca') ||
      normNome.includes('aeronave'))
  ) {
    return true
  }

  return false
}

function hasNonLucrosCessantesIndicators(text: string): boolean {
  if (!text) return false
  // Não capturar coberturas de Responsabilidade Civil que mencionem lucros cessantes de terceiros
  if (/\b(rc|resp\.?\s*civil|responsabilidade\s+civil|garagista)\b/i.test(text)) return true
  if (/guarda\s+de\s+ve[ií]culos?/i.test(text)) return true
  if (/\bve[ií]culos?\b/i.test(text)) return true
  if (/salvamento/i.test(text) || /contencao/i.test(text)) return true
  if (/honorarios?\s+(de\s+)?peritos?/i.test(text)) return true
  if (/\baluguel\b/i.test(text)) return true
  return false
}

export function isCoberturaLucrosCessantes(cob: {
  nome: string
  categoriaNormalizada?: string
}): boolean {
  if (isCoberturaBasica(cob)) return false

  const normNome = normalizeSortText(cob.nome)
  const normCat = normalizeSortText(cob.categoriaNormalizada || '')

  if (hasNonLucrosCessantesIndicators(normNome) || hasNonLucrosCessantesIndicators(normCat)) {
    return false
  }

  // Categoria normalizada canônica
  if (
    normCat === 'lucros cessantes / perda de receita' ||
    normCat === 'lucros cessantes' ||
    normCat.includes('perda de receita') ||
    normCat.includes('lucro bruto')
  ) {
    return true
  }

  // Termos no nome indicativos de Lucros Cessantes do segurado (Allianz: "Perda de Lucro Bruto", Porto: "LUCROS CESSANTES")
  return (
    normNome.includes('lucros cessantes') ||
    normNome.includes('lucro cessante') ||
    normNome.includes('perda de receita') ||
    normNome.includes('lucro bruto') ||
    normNome.includes('perda de lucro bruto') ||
    normNome.includes('lucro liquido') ||
    normNome.includes('despesas fixas')
  )
}

/**
 * Ordena coberturas conforme a regra de negócio do Kit de Submissão:
 * 1º Lugar: Cobertura Básica
 * 2º Lugar: Cobertura de Lucros Cessantes
 * Demais lugares: Ordem alfabética pelo nome da cobertura (pt-BR)
 */
export function sortKitCoberturas(coberturas: SubmissionKitCobertura[]): SubmissionKitCobertura[] {
  return [...coberturas].sort((a, b) => {
    const isBasicaA = isCoberturaBasica(a)
    const isBasicaB = isCoberturaBasica(b)
    if (isBasicaA && !isBasicaB) return -1
    if (!isBasicaA && isBasicaB) return 1
    if (isBasicaA && isBasicaB)
      return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })

    const isLcA = isCoberturaLucrosCessantes(a)
    const isLcB = isCoberturaLucrosCessantes(b)
    if (isLcA && !isLcB) return -1
    if (!isLcA && isLcB) return 1
    if (isLcA && isLcB) return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })

    return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
  })
}

export interface SubmissionKitSinistro {
  origemPeriodo: string
  dataSinistro: string
  numeroSinistro: string
  coberturaAcionada: string
  descricao: string
  valorIndenizadoRs: number | null
  status: string
}

export interface SubmissionKitData {
  rfqId: string
  rfqCode: string
  dataEnvio: string
  prazoLimite: string
  statusRfq: string
  observacoesRfq: string
  seguradorasConsultadas: Array<{ id: string; nome: string }>
  kitGerado?: boolean
  kitGeradoEm?: string

  // Empreendimento
  empreendimentoId: string
  nomeEmpreendimento: string
  razaoSocial: string
  cnpj: string
  cosseguradosNome: string
  cosseguradosCnpj: string
  endereco: string
  cidade: string
  uf: string
  atividade: string
  atividadeExercida: string
  anoInicioAtividades: number | null
  anoConstrucao: number | null
  areaConstruidaM2: number | null
  areaTerrenoM2: number | null
  numAndares: number | null
  numUnidades: number | null
  numFuncionarios: number | null
  faturamento12m: number | null
  tipoConstrucao: string
  distBombeirosKm: number | null
  reservaAguaIncendioM3: number | null

  // Proteções
  protecoes: Record<string, boolean>

  // VRD
  vrdPredio: number | null
  vrdConteudo: number | null
  vrdLucrosCessantes: number | null
  vrdTotal: number | null
  percentualIncc: number | null
  inccLabel: string
  tipoCobertura: string // 'Prédio' | 'Conteúdo' | 'Prédio + Conteúdo'

  // Apólice anterior / Cotação
  apoliceAnteriorSeguradora: string
  apoliceAnteriorNumero: string
  ramo: string
  vigenciaInicio: string
  vigenciaFim: string

  // Coberturas
  coberturas: SubmissionKitCobertura[]

  // Sinistros
  sinistros: SubmissionKitSinistro[]

  // Lista linear de campos para cópia rápida
  fields: SubmissionKitField[]
}

/**
 * Carrega e sintetiza todos os dados do banco para o Kit de Submissão de um determinado RFQ
 */
export async function loadSubmissionKitData(rfqId: string): Promise<SubmissionKitData> {
  const rfqRecord = await pb.collection('rfq').getOne(rfqId, {
    expand: 'conta_empreendimento,seguradoras_solicitadas',
  })

  const empId = rfqRecord.conta_empreendimento || ''

  let emp: Record<string, unknown> = {}
  if (empId) {
    try {
      emp = (await pb.collection('empreendimentos').getOne(empId)) as unknown as Record<
        string,
        unknown
      >
    } catch (err) {
      console.warn('Empreendimento não localizado:', err)
    }
  }

  // Busca seguradoras solicitadas
  const seguradorasList: Array<{ id: string; nome: string }> = []
  if (
    Array.isArray(rfqRecord.seguradoras_solicitadas) &&
    rfqRecord.seguradoras_solicitadas.length > 0
  ) {
    try {
      const allSegs = await pb.collection('seguradoras').getFullList<{ id: string; nome: string }>()
      const map = new Map(allSegs.map((s) => [s.id, s.nome]))
      for (const sId of rfqRecord.seguradoras_solicitadas) {
        seguradorasList.push({
          id: sId,
          nome: map.get(sId) || `Seguradora ${sId.slice(0, 5)}`,
        })
      }
    } catch (err) {
      console.warn('Erro ao carregar nomes de seguradoras:', err)
    }
  }

  // Busca apólices associadas ao empreendimento (ordenadas pela mais recente)
  let apolices: Array<Record<string, unknown>> = []
  if (empId) {
    try {
      apolices = (await pb.collection('apolices').getFullList({
        filter: `id_empreendimento="${empId}"`,
        sort: '-created',
      })) as unknown as Array<Record<string, unknown>>
    } catch (err) {
      console.warn('Erro ao carregar apólices do empreendimento:', err)
    }
  }

  const apolicePrincipal = apolices[0] || {}

  // Busca coberturas
  const coberturasList: SubmissionKitCobertura[] = []
  if (apolices.length > 0) {
    const apoliceIds = apolices.map((a) => a.id)
    try {
      // PocketBase filter com múltiplos IDs
      const filterExpr = apoliceIds.map((id) => `id_apolice="${id}"`).join(' || ')
      const cobs = await pb.collection('coberturas').getFullList<Record<string, unknown>>({
        filter: filterExpr,
        sort: 'categoria_normalizada',
      })
      // Indexa coberturas por nome único para preservar variações de uma mesma categoria se houverem
      const seenCobName = new Set<string>()
      for (const c of cobs) {
        const nomeCob = String(c.nome_cobertura || c.categoria_normalizada || '').trim()
        const catKey = String(c.categoria_normalizada || c.nome_cobertura || '').trim()
        const dedupeKey = `${nomeCob.toLowerCase()}::${catKey.toLowerCase()}`
        if (nomeCob && !seenCobName.has(dedupeKey)) {
          seenCobName.add(dedupeKey)
          coberturasList.push({
            nome: nomeCob,
            categoriaNormalizada: catKey,
            isAtual: typeof c.lmi_rs === 'number' ? c.lmi_rs : null,
            isAtualizada: typeof c.is_atualizada === 'number' ? c.is_atualizada : null,
            isEscolhida: typeof c.is_escolhida === 'number' ? c.is_escolhida : null,
            franquiaPos: String(c.franquia_pos || '').trim(),
            observacao: String(c.observacao || '').trim(),
          })
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar coberturas:', err)
    }
  }

  // Busca sinistros
  const sinistrosList: SubmissionKitSinistro[] = []
  if (empId) {
    try {
      const sins = await pb.collection('sinistros').getFullList<Record<string, unknown>>({
        filter: `id_empreendimento="${empId}"`,
        sort: '-data_sinistro',
      })
      for (const s of sins) {
        sinistrosList.push({
          origemPeriodo: String(s.origem_periodo || ''),
          dataSinistro: String(s.data_sinistro || ''),
          numeroSinistro: String(s.numero_sinistro || ''),
          coberturaAcionada: String(s.cobertura_acionada || 'Sinistro Declarado'),
          descricao: String(s.descricao || ''),
          valorIndenizadoRs:
            typeof s.valor_indenizado_rs === 'number' ? s.valor_indenizado_rs : null,
          status: String(s.status || 'Liquidado'),
        })
      }
    } catch (err) {
      console.warn('Erro ao carregar sinistros:', err)
    }
  }

  // Carrega e normaliza proteções e qualificadores (de campos do banco ou de protecoes_raw_json)
  const rawJson = (emp.protecoes_raw_json || {}) as {
    incendio?: Record<string, boolean | string>
    roubo?: Record<string, boolean | string>
  }
  const incRaw = rawJson.incendio || {}
  const roubRaw = rawJson.roubo || {}

  // Helper para verificar texto e detalhe em rawJson
  const findRaw = (dict: Record<string, boolean | string>, ...terms: string[]) => {
    const keys = Object.keys(dict)
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
    for (const term of terms) {
      const normTerm = norm(term)
      const k = keys.find((key) => norm(key).includes(normTerm))
      if (k)
        return { key: k, checked: Boolean(dict[k]), detalhe: String(dict[`${k}_detalhe`] || '') }
    }
    return null
  }

  const rawExt = findRaw(incRaw, 'extintor')
  const rawHid = findRaw(incRaw, 'hidrante')
  const rawSpk = findRaw(incRaw, 'sprinkler')
  const rawDet = findRaw(incRaw, 'detector de fumaca', 'detector')
  const rawAlmInc = findRaw(incRaw, 'alame contra', 'alarme contra incendio', 'alarme')
  const rawBrig = findRaw(incRaw, 'brigada de incendio', 'brigada')
  const rawFuncTr = findRaw(incRaw, 'funcionarios treinados')
  const rawParaR = findRaw(incRaw, 'para-raios', 'para raios', 'spda')
  const rawAgua = findRaw(incRaw, 'agua exclusivo', 'agua para combate')
  const rawCo2 = findRaw(incRaw, 'co2 fm200', 'co2')
  const rawExp24 = findRaw(incRaw, 'expediente 24')
  const rawInstEl = findRaw(incRaw, 'instalacoes eletricas protegidas', 'instalacoes eletricas')
  const rawLumProt = findRaw(incRaw, 'luminarias protegidas')
  const rawOutrosInc = findRaw(incRaw, 'outros')

  const rawVig = findRaw(roubRaw, 'vigilancia')
  const rawAlmRoub = findRaw(roubRaw, 'alarme')
  const rawCam = findRaw(roubRaw, 'cameras de seguranca', 'cameras')
  const rawCftv = findRaw(roubRaw, 'cftv')
  const rawCtrlEnt = findRaw(roubRaw, 'controle de entrada', 'controle de acesso')
  const rawGrade = findRaw(roubRaw, 'grade de protecao')
  const rawCerca = findRaw(roubRaw, 'cerca eletrica')
  const rawCofres = findRaw(roubRaw, 'cofre')
  const rawOutrosRoub = findRaw(roubRaw, 'outros')

  // Checagens booleanas consolidadas (banco ou rawJson)
  const hasExt = Boolean(emp.prot_extintores || rawExt?.checked)
  const hasHid = Boolean(emp.prot_hidrantes || rawHid?.checked)
  const hasSpk = Boolean(emp.prot_sprinklers || rawSpk?.checked)
  const hasDetFum = Boolean(emp.prot_detector_fumaca || rawDet?.checked)
  const hasAlmInc = Boolean(emp.prot_alarme_incendio || rawAlmInc?.checked)
  const hasBrig = Boolean(emp.prot_brigada_incendio || rawBrig?.checked || rawFuncTr?.checked)
  const hasParaR = Boolean(emp.prot_pararraios || rawParaR?.checked)
  const hasAgua = Boolean(emp.prot_agua_exclusiva_incendio || rawAgua?.checked)
  const hasCo2 = Boolean(emp.prot_co2_fm200 || rawCo2?.checked)
  const hasExp24 = Boolean(emp.prot_expediente_24h || rawExp24?.checked)
  const hasInstElet = Boolean(emp.prot_instalacoes_eletricas_protegidas || rawInstEl?.checked)
  const hasLumProt = Boolean(emp.prot_luminarias_protegidas || rawLumProt?.checked)
  const hasOutrosInc = Boolean(emp.prot_outros_incendio || rawOutrosInc?.checked)

  const hasVig = Boolean(emp.prot_vigilancia || rawVig?.checked)
  const hasAlmRoub = Boolean(emp.prot_alarme_roubo || rawAlmRoub?.checked)
  const hasCam = Boolean(emp.prot_cameras_seguranca || rawCam?.checked)
  const hasCftv = Boolean(emp.prot_cftv || rawCftv?.checked)
  const hasCtrlEnt = Boolean(emp.prot_controle_entrada || rawCtrlEnt?.checked)
  const hasGrade = Boolean(emp.prot_grade_protecao || rawGrade?.checked)
  const hasCerca = Boolean(emp.prot_cerca_eletrica || rawCerca?.checked)
  const hasCofres = Boolean(emp.prot_cofres || rawCofres?.checked)
  const hasOutrosRoub = Boolean(emp.prot_outros_roubo || rawOutrosRoub?.checked)

  // Qualificadores formatados
  const almIncDetalheRaw = String(emp.prot_alarme_incendio_detalhe || rawAlmInc?.detalhe || '')
  let almIncQualificador = ''
  if (/\(\s*[xX✓✔ ]\s*\)\s*não monitorada/i.test(almIncDetalheRaw)) {
    almIncQualificador = ' (Não Monitorada)'
  } else if (
    /\(\s*[xX✓✔ ]\s*\)\s*monitorada/i.test(almIncDetalheRaw) ||
    (/monitorada/i.test(almIncDetalheRaw) && !/não monitorada/i.test(almIncDetalheRaw))
  ) {
    almIncQualificador = ' (Monitorada)'
  } else if (/manual/i.test(almIncDetalheRaw)) {
    almIncQualificador = ' (Manual)'
  }

  const vigDetalheRaw = String(emp.prot_vigilancia_detalhe || rawVig?.detalhe || '')
  const vigQuals: string[] = []
  if (/\(\s*[xX✓✔ ]\s*\)\s*não monitorada/i.test(vigDetalheRaw)) {
    vigQuals.push('Não Monitorada')
  } else if (
    /\(\s*[xX✓✔ ]\s*\)\s*monitorada/i.test(vigDetalheRaw) ||
    (/monitorada/i.test(vigDetalheRaw) && !/não monitorada/i.test(vigDetalheRaw))
  ) {
    vigQuals.push('Monitorada')
  }

  if (
    /\(\s*[xX✓✔ ]\s*\)\s*desarmada/i.test(vigDetalheRaw) ||
    (/desarmada/i.test(vigDetalheRaw) && !/não desarmada/i.test(vigDetalheRaw))
  ) {
    vigQuals.push('Desarmada')
  } else if (
    /\(\s*[xX✓✔ ]\s*\)\s*armada/i.test(vigDetalheRaw) &&
    !/desarmada/i.test(vigDetalheRaw)
  ) {
    vigQuals.push('Armada')
  }

  if (
    /\(\s*[xX✓✔ ]\s*\)\s*24\s*hrs?/i.test(vigDetalheRaw) ||
    emp.vigilancia_24h ||
    (/24\s*hrs?/i.test(vigDetalheRaw) && !/diurno|noturno/i.test(vigDetalheRaw))
  ) {
    vigQuals.push('24hrs')
  } else if (/\(\s*[xX✓✔ ]\s*\)\s*diurno/i.test(vigDetalheRaw)) {
    vigQuals.push('Diurno')
  } else if (/\(\s*[xX✓✔ ]\s*\)\s*noturno/i.test(vigDetalheRaw)) {
    vigQuals.push('Noturno')
  }
  const vigQualificador = vigQuals.length > 0 ? ` (${vigQuals.join(', ')})` : ''

  const almRoubDetalheRaw = String(emp.prot_alarme_roubo_detalhe || rawAlmRoub?.detalhe || '')
  let almRoubQualificador = ''
  if (/\(\s*[xX✓✔ ]\s*\)\s*não monitorado/i.test(almRoubDetalheRaw)) {
    almRoubQualificador = ' (Não Monitorado)'
  } else if (
    /\(\s*[xX✓✔ ]\s*\)\s*monitorado/i.test(almRoubDetalheRaw) ||
    (/monitorado/i.test(almRoubDetalheRaw) && !/não monitorado/i.test(almRoubDetalheRaw))
  ) {
    almRoubQualificador = ' (Monitorado)'
  }

  const camDetalheRaw = String(emp.prot_cameras_seguranca_detalhe || rawCam?.detalhe || '')
  let camQualificador = ''
  if (/\(\s*[xX✓✔ ]\s*\)\s*não monitorado/i.test(camDetalheRaw)) {
    camQualificador = ' (Não Monitorado)'
  } else if (
    /\(\s*[xX✓✔ ]\s*\)\s*monitorado/i.test(camDetalheRaw) ||
    (/monitorado/i.test(camDetalheRaw) && !/não monitorado/i.test(camDetalheRaw))
  ) {
    camQualificador = ' (Monitorado)'
  }

  const ctrlEntDetalheRaw = String(emp.prot_controle_entrada_detalhe || rawCtrlEnt?.detalhe || '')
  let ctrlEntQualificador = ''
  if (ctrlEntDetalheRaw) {
    const obsClean = ctrlEntDetalheRaw.replace(/^obs\s*[:\s-]*/i, '').trim()
    if (obsClean) ctrlEntQualificador = ` (Obs: ${obsClean})`
  }

  const outrosIncTexto = String(emp.prot_outros_incendio_texto || rawOutrosInc?.detalhe || '')
  const outrosRoubTexto = String(emp.prot_outros_roubo_texto || rawOutrosRoub?.detalhe || '')

  // Dicionário canônico de proteções (somente proteções reais de incêndio e roubo — sem piscina nem elevadores)
  const protecoes: Record<string, boolean> = {
    Extintores: hasExt,
    Hidrantes: hasHid,
    Sprinklers: hasSpk,
    'Detector de Fumaça': hasDetFum,
    [`Alarme contra Incêndio${almIncQualificador}`]: hasAlmInc,
    'Brigada de Incêndio ou Funcionários Treinados': hasBrig,
    'Pára-raios': hasParaR,
    'Água exclusiva para combate ao incêndio': hasAgua,
    'CO2 FM200': hasCo2,
    'Expediente 24 hrs': hasExp24,
    'Instalações Elétricas Protegidas': hasInstElet,
    'Luminárias Protegidas': hasLumProt,
    ...(hasOutrosInc
      ? { [`Outros (Incêndio)${outrosIncTexto ? `: ${outrosIncTexto}` : ''}`]: true }
      : {}),

    [`Vigilância${vigQualificador}`]: hasVig,
    [`Alarme de Roubo${almRoubQualificador}`]: hasAlmRoub,
    [`Câmeras de Segurança${camQualificador}`]: hasCam,
    CFTV: hasCftv,
    [`Controle de entrada${ctrlEntQualificador}`]: hasCtrlEnt,
    'Grade de Proteção': hasGrade,
    'Cerca Elétrica': hasCerca,
    Cofres: hasCofres,
    ...(hasOutrosRoub
      ? { [`Outros (Roubo)${outrosRoubTexto ? `: ${outrosRoubTexto}` : ''}`]: true }
      : {}),
  }

  // VRD
  const vrdDm =
    typeof apolicePrincipal.valor_em_risco_dm === 'number'
      ? apolicePrincipal.valor_em_risco_dm
      : null
  const vrdLc =
    typeof apolicePrincipal.valor_em_risco_lc === 'number'
      ? apolicePrincipal.valor_em_risco_lc
      : null
  const vrdTotal = vrdDm !== null || vrdLc !== null ? (vrdDm || 0) + (vrdLc || 0) : null

  const ramo = String(apolicePrincipal.ramo || 'Riscos Nomeados')
  let tipoCob = 'Prédio + Conteúdo'
  if (ramo.toLowerCase().includes('prédio') && !ramo.toLowerCase().includes('conteúdo')) {
    tipoCob = 'Prédio'
  } else if (ramo.toLowerCase().includes('conteúdo') && !ramo.toLowerCase().includes('prédio')) {
    tipoCob = 'Conteúdo'
  }

  const fields: SubmissionKitField[] = []
  const addField = (
    label: string,
    val: string | number | null | undefined,
    categoria: SubmissionKitField['categoria'],
    destaque = false,
  ) => {
    if (val === null || val === undefined) return
    const strVal = String(val).trim()
    if (!strVal || strVal === '—' || strVal === '0') return
    fields.push({
      id: `${categoria}_${label}`.replace(/\s+/g, '_').toLowerCase(),
      label,
      value: strVal,
      categoria,
      destaque,
    })
  }

  // Empreendimento
  addField(
    'Razão Social',
    (emp.razao_social as string) || (emp.nome_empreendimento as string),
    'Empreendimento',
    true,
  )
  addField(
    'Nome Fantasia / Empreendimento',
    emp.nome_empreendimento as string,
    'Empreendimento',
    true,
  )
  addField('CNPJ', formatCnpj(emp.cnpj as string), 'Empreendimento', true)
  addField('Cossegurado (Razão Social)', emp.cossegurado_nome as string, 'Empreendimento')
  addField('Cossegurado (CNPJ)', formatCnpj(emp.cossegurado_cnpj as string), 'Empreendimento')
  addField('Endereço do Risco', emp.endereco as string, 'Empreendimento', true)
  addField(
    'Cidade / UF',
    emp.cidade && emp.uf ? `${emp.cidade}/${emp.uf}` : (emp.cidade as string) || (emp.uf as string),
    'Empreendimento',
  )
  addField('Atividade Principal (CNAE)', emp.atividade as string, 'Empreendimento')
  addField('Atividade Exercida no Local', emp.atividade_exercida as string, 'Empreendimento', true)
  addField('Segmento', (emp.segmento as string) || 'Hotéis & Resorts', 'Empreendimento')
  addField('Ano Início Atividades', emp.ano_inicio_atividades as number, 'Empreendimento')
  addField('Número de Funcionários', emp.num_funcionarios as number, 'Empreendimento')
  if (typeof emp.faturamento_12m_rs === 'number' && emp.faturamento_12m_rs > 0) {
    addField('Faturamento 12 Meses', formatCurrency(emp.faturamento_12m_rs), 'Empreendimento')
  }

  // VRD e Valores
  addField('Tipo de Cobertura Solicitada', tipoCob, 'VRD e Valores', true)
  addField('VRD Danos Materiais (Prédio/Conteúdo)', formatCurrency(vrdDm), 'VRD e Valores', true)
  if (vrdLc) {
    addField('VRD Lucros Cessantes', formatCurrency(vrdLc), 'VRD e Valores', true)
  }
  addField('VRD Total Declarado', formatCurrency(vrdTotal), 'VRD e Valores', true)
  if (apolicePrincipal.lmi_incendio_basica) {
    addField(
      'LMI Básica Solicitada',
      formatCurrency(apolicePrincipal.lmi_incendio_basica as number),
      'VRD e Valores',
      true,
    )
  }

  // Construção e Riscos (dados construtivos e operacionais)
  addField('Tipo de Construção', emp.tipo_construcao as string, 'Construção e Riscos', true)
  addField('Ano de Construção', emp.ano_construcao as number, 'Construção e Riscos')
  addField(
    'Área Construída (m²)',
    emp.area_construida_m2 ? `${emp.area_construida_m2} m²` : null,
    'Construção e Riscos',
  )
  addField(
    'Área do Terreno (m²)',
    emp.area_terreno_m2 ? `${emp.area_terreno_m2} m²` : null,
    'Construção e Riscos',
  )
  addField('Número de Andares / Pavimentos', emp.num_andares as number, 'Construção e Riscos')
  addField('Número de Unidades / UH / Quartos', emp.num_unidades as number, 'Construção e Riscos')
  addField('Piscina', emp.possui_piscina ? 'Sim / Instalado' : 'Não', 'Construção e Riscos')
  addField(
    'Elevadores',
    emp.possui_elevador
      ? emp.num_elevadores
        ? `Sim (${emp.num_elevadores} elevadores)`
        : 'Sim / Instalado'
      : 'Não',
    'Construção e Riscos',
  )
  if (typeof emp.num_elevadores === 'number' && emp.num_elevadores > 0) {
    addField('Número de Elevadores', emp.num_elevadores, 'Construção e Riscos')
  }
  addField('Vagas de Estacionamento', emp.vagas_estacionamento as number, 'Construção e Riscos')

  // Detalhes que os portais pedem e que constam no Cartão em aberto (quando preenchidos)
  const distBombeirosVal =
    emp.dist_bombeiros_texto || (emp.dist_bombeiros_km ? `${emp.dist_bombeiros_km} km` : null)
  if (distBombeirosVal) {
    addField('Distância Corpo de Bombeiros', String(distBombeirosVal), 'Proteções')
    addField('Distância Corpo de Bombeiros', String(distBombeirosVal), 'Construção e Riscos')
  }

  const volAguaVal =
    emp.volume_agua_exclusivo_texto ||
    (emp.reserva_agua_incendio_m3 ? `${emp.reserva_agua_incendio_m3} m³` : null)
  if (volAguaVal) {
    addField('Volume de Água Exclusivo para Combate', String(volAguaVal), 'Proteções')
    addField('Reserva Técnica de Incêndio (m³)', String(volAguaVal), 'Construção e Riscos')
  }

  // Proteções ativas (apenas as que têm valor true/presentes)
  const ativas = Object.entries(protecoes)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k)

  if (ativas.length > 0) {
    addField('Proteções e Prevenções Presentes', ativas.join('; '), 'Proteções', true)
    for (const [protNome, ativa] of Object.entries(protecoes)) {
      if (ativa) {
        addField(protNome, 'Sim / Instalado', 'Proteções')
      }
    }
  }

  // SLA e Processo
  addField('RFQ ID', `RFQ-${rfqRecord.id.slice(0, 6).toUpperCase()}`, 'SLA e Processo')
  addField('Data de Envio do RFQ', formatDate(rfqRecord.data_envio), 'SLA e Processo')
  addField(
    'Prazo Limite para Cotação (SLA)',
    formatDate(rfqRecord.prazo_limite),
    'SLA e Processo',
    true,
  )
  if (seguradorasList.length > 0) {
    addField(
      'Seguradoras Consultadas',
      seguradorasList.map((s) => s.nome).join(', '),
      'SLA e Processo',
    )
  }
  if (rfqRecord.observacoes) {
    addField('Observações Técnicas do RFQ', rfqRecord.observacoes, 'SLA e Processo')
  }
  if (apolicePrincipal.numero_apolice) {
    addField('Apólice Atual / Anterior', String(apolicePrincipal.numero_apolice), 'SLA e Processo')
  }
  if (apolicePrincipal.seguradora) {
    addField('Seguradora Atual / Anterior', String(apolicePrincipal.seguradora), 'SLA e Processo')
  }

  // Coberturas a serem contratadas (somente IS > 0, ordenadas: Básica -> Lucros Cessantes -> alfabética)
  const coberturasContratadas = sortKitCoberturas(
    coberturasList.filter((cob) => {
      const val = getEffectiveIS(cob)
      return typeof val === 'number' && val > 0
    }),
  )

  for (const cob of coberturasContratadas) {
    const isVal = getEffectiveIS(cob)
    if (isVal && isVal > 0) {
      const extraFranquia = cob.franquiaPos ? ` (POS: ${cob.franquiaPos})` : ''
      addField(
        cob.nome,
        `${formatCurrency(isVal)}${extraFranquia}`,
        'Coberturas',
        isCoberturaBasica(cob) || isCoberturaLucrosCessantes(cob),
      )
    }
  }

  // Sinistros resumidos
  if (sinistrosList.length === 0) {
    addField('Histórico de Sinistros (5 anos)', 'Sem sinistros informados no período', 'Sinistros')
  } else {
    addField(
      'Histórico de Sinistros (Qtd)',
      `${sinistrosList.length} sinistro(s) registrado(s)`,
      'Sinistros',
      true,
    )
    sinistrosList.forEach((s, idx) => {
      const valorStr = s.valorIndenizadoRs
        ? ` - Indenizado: ${formatCurrency(s.valorIndenizadoRs)}`
        : ''
      addField(
        `Sinistro #${idx + 1} (${s.coberturaAcionada})`,
        `${formatDate(s.dataSinistro)} - ${s.descricao || s.coberturaAcionada}${valorStr} [${s.status}]`,
        'Sinistros',
      )
    })
  }

  // Registra que o Kit de Submissão foi gerado no RFQ (sem alterar dados de negócio)
  try {
    await pb.collection('rfq').update(rfqRecord.id, {
      kit_gerado: true,
      kit_gerado_em: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('Aviso: Não foi possível marcar kit_gerado no RFQ:', err)
  }

  return {
    rfqId: rfqRecord.id,
    rfqCode: `RFQ-${rfqRecord.id.slice(0, 6).toUpperCase()}`,
    dataEnvio: rfqRecord.data_envio || '',
    prazoLimite: rfqRecord.prazo_limite || '',
    statusRfq: rfqRecord.status || 'Aberto',
    observacoesRfq: rfqRecord.observacoes || '',
    seguradorasConsultadas: seguradorasList,
    kitGerado: true,
    kitGeradoEm: new Date().toISOString(),

    empreendimentoId: empId,
    nomeEmpreendimento: (emp.nome_empreendimento as string) || 'Empreendimento não informado',
    razaoSocial: (emp.razao_social as string) || (emp.nome_empreendimento as string) || '',
    cnpj: (emp.cnpj as string) || '',
    cosseguradosNome: (emp.cossegurado_nome as string) || '',
    cosseguradosCnpj: (emp.cossegurado_cnpj as string) || '',
    endereco: (emp.endereco as string) || '',
    cidade: (emp.cidade as string) || '',
    uf: (emp.uf as string) || '',
    atividade: (emp.atividade as string) || '',
    atividadeExercida: (emp.atividade_exercida as string) || '',
    anoInicioAtividades:
      typeof emp.ano_inicio_atividades === 'number' ? emp.ano_inicio_atividades : null,
    anoConstrucao: typeof emp.ano_construcao === 'number' ? emp.ano_construcao : null,
    areaConstruidaM2: typeof emp.area_construida_m2 === 'number' ? emp.area_construida_m2 : null,
    areaTerrenoM2: typeof emp.area_terreno_m2 === 'number' ? emp.area_terreno_m2 : null,
    numAndares: typeof emp.num_andares === 'number' ? emp.num_andares : null,
    numUnidades: typeof emp.num_unidades === 'number' ? emp.num_unidades : null,
    numFuncionarios: typeof emp.num_funcionarios === 'number' ? emp.num_funcionarios : null,
    faturamento12m: typeof emp.faturamento_12m_rs === 'number' ? emp.faturamento_12m_rs : null,
    tipoConstrucao: (emp.tipo_construcao as string) || '',
    distBombeirosKm: typeof emp.dist_bombeiros_km === 'number' ? emp.dist_bombeiros_km : null,
    reservaAguaIncendioM3:
      typeof emp.reserva_agua_incendio_m3 === 'number' ? emp.reserva_agua_incendio_m3 : null,

    protecoes,
    vrdPredio: vrdDm,
    vrdConteudo: null,
    vrdLucrosCessantes: vrdLc,
    vrdTotal,
    percentualIncc: null,
    inccLabel: '',
    tipoCobertura: tipoCob,

    apoliceAnteriorSeguradora: (apolicePrincipal.seguradora as string) || '',
    apoliceAnteriorNumero: (apolicePrincipal.numero_apolice as string) || '',
    ramo,
    vigenciaInicio: (apolicePrincipal.data_inicio as string) || '',
    vigenciaFim: (apolicePrincipal.data_fim as string) || '',

    coberturas: coberturasContratadas,
    sinistros: sinistrosList,
    fields,
  }
}

/**
 * Gera e dispara download da planilha XLSX padronizada para upload em portais de seguradoras
 */
export function generateSubmissionKitXlsx(data: SubmissionKitData): void {
  const wb = XLSX.utils.book_new()

  // ABA 1: RESUMO DO PEDIDO DE COTAÇÃO
  const resumoRows: (string | number)[][] = [
    ['BYCOR P&C INTELLIGENCE — KIT DE SUBMISSÃO DE RFQ PARA PORTAIS'],
    ['Código RFQ', data.rfqCode],
    ['Data de Envio', formatDate(data.dataEnvio)],
    ['Prazo Limite SLA', formatDate(data.prazoLimite)],
    ['Status', data.statusRfq],
    [
      'Seguradoras Consultadas',
      data.seguradorasConsultadas.map((s) => s.nome).join(', ') || 'Todas as parceiras',
    ],
    ['Observações Técnicas', data.observacoesRfq || 'Nenhuma observação informada.'],
    [],
    ['DADOS CADASTRAIS DO SEGURADO'],
    ['Razão Social', data.razaoSocial],
    ['Nome Fantasia / Empreendimento', data.nomeEmpreendimento],
    ['CNPJ', formatCnpj(data.cnpj)],
    ['Cossegurado (Razão Social)', data.cosseguradosNome || 'Não há'],
    ['Cossegurado (CNPJ)', formatCnpj(data.cosseguradosCnpj) || 'Não há'],
    ['Endereço do Risco', data.endereco],
    ['Cidade / UF', data.cidade ? `${data.cidade}/${data.uf}` : data.uf || '—'],
    ['Atividade (CNAE)', data.atividade],
    ['Atividade Exercida no Local', data.atividadeExercida],
    ['Ano Início das Atividades', data.anoInicioAtividades || '—'],
    ['Número de Funcionários', data.numFuncionarios || '—'],
    ['Faturamento 12 Meses', data.faturamento12m ? formatCurrency(data.faturamento12m) : '—'],
    [],
    ['VALORES EM RISCO DECLARADOS (VRD)'],
    ['Tipo de Cobertura Solicitada', data.tipoCobertura],
    [
      'VRD Danos Materiais (Prédio/Conteúdo)',
      data.vrdPredio ? formatCurrency(data.vrdPredio) : '—',
    ],
    [
      'VRD Lucros Cessantes',
      data.vrdLucrosCessantes ? formatCurrency(data.vrdLucrosCessantes) : '—',
    ],
    ['VRD Total Declarado', data.vrdTotal ? formatCurrency(data.vrdTotal) : '—'],
    ['Apólice Vigente / Anterior', data.apoliceAnteriorNumero || '—'],
    ['Seguradora Vigente', data.apoliceAnteriorSeguradora || '—'],
  ]
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows)
  wsResumo['!cols'] = [{ wch: 35 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo do Pedido')

  // ABA 2: DADOS TÉCNICOS E CONSTRUÇÃO
  const dadosTecnicosRows: (string | number)[][] = [
    ['PARÂMETRO CONSTRUTIVO / CARACTERÍSTICA', 'VALOR / SITUAÇÃO'],
    ['Tipo de Construção', data.tipoConstrucao || '—'],
    ['Ano de Construção', data.anoConstrucao || '—'],
    ['Área Construída (m²)', data.areaConstruidaM2 || '—'],
    ['Área do Terreno (m²)', data.areaTerrenoM2 || '—'],
    ['Número de Andares / Pavimentos', data.numAndares || '—'],
    ['Número de Unidades / UH / Quartos', data.numUnidades || '—'],
    ['Distância do Corpo de Bombeiros', data.distBombeirosKm ? `${data.distBombeirosKm} km` : '—'],
    [
      'Reserva Técnica de Água para Incêndio',
      data.reservaAguaIncendioM3 ? `${data.reservaAguaIncendioM3} m³` : '—',
    ],
    [],
    ['PROTEÇÕES E SISTEMAS DE SEGURANÇA (INCÊNDIO E ROUBO)', 'INSTALADO / ATIVO'],
  ]
  for (const [prot, ativa] of Object.entries(data.protecoes)) {
    dadosTecnicosRows.push([prot, ativa ? 'SIM' : 'NÃO'])
  }
  const wsTecnico = XLSX.utils.aoa_to_sheet(dadosTecnicosRows)
  wsTecnico['!cols'] = [{ wch: 55 }, { wch: 25 }]
  XLSX.utils.book_append_sheet(wb, wsTecnico, 'Construção e Proteções')

  // ABA 3: TABELA DE COBERTURAS E LMI (QAR PADRONIZADO)
  // Somente coberturas a serem contratadas (IS > 0) na ordem: Básica -> Lucros Cessantes -> alfabética
  const coberturasRows: (string | number)[][] = [
    [
      'Item',
      'Cobertura',
      'Categoria Canônica',
      'Importância Segurada (R$)',
      'LMI Atualizada (R$)',
      'LMI Vigente (R$)',
      'Franquia / POS',
      'Observações',
    ],
  ]

  const coberturasParaExportar = sortKitCoberturas(
    data.coberturas.filter((cob) => {
      const isVal = getEffectiveIS(cob)
      return typeof isVal === 'number' && isVal > 0
    }),
  )

  coberturasParaExportar.forEach((cob, i) => {
    const isEfetiva = getEffectiveIS(cob)
    coberturasRows.push([
      i + 1,
      cob.nome,
      cob.categoriaNormalizada,
      isEfetiva ?? '',
      cob.isAtualizada ?? '',
      cob.isAtual ?? '',
      cob.franquiaPos || 'Conforme condições padrão',
      cob.observacao || '',
    ])
  })

  if (coberturasParaExportar.length === 0) {
    coberturasRows.push([
      1,
      'Incêndio Básica (Danos Materiais)',
      'Incêndio Básica (Danos Materiais)',
      data.vrdTotal || '',
      '',
      '',
      'Franquia padrão',
      'Solicitar condições de mercado',
    ])
  }
  const wsCoberturas = XLSX.utils.aoa_to_sheet(coberturasRows)
  wsCoberturas['!cols'] = [
    { wch: 6 },
    { wch: 45 },
    { wch: 40 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 25 },
    { wch: 30 },
  ]
  XLSX.utils.book_append_sheet(wb, wsCoberturas, 'Coberturas Solicitadas')

  // ABA 4: HISTÓRICO DE SINISTROS DECLARADOS
  const sinistrosRows: (string | number)[][] = [
    [
      '#',
      'Data do Sinistro',
      'Cobertura Acionada',
      'Descrição do Evento',
      'Valor Indenizado (R$)',
      'Status',
      'Origem',
    ],
  ]
  if (data.sinistros.length === 0) {
    sinistrosRows.push([
      '—',
      '—',
      'Sem sinistros informados',
      'Nenhum sinistro registrado nos últimos 5 anos.',
      0,
      'Liquidado',
      'Declaração do segurado',
    ])
  } else {
    data.sinistros.forEach((sin, idx) => {
      sinistrosRows.push([
        idx + 1,
        formatDate(sin.dataSinistro),
        sin.coberturaAcionada,
        sin.descricao,
        sin.valorIndenizadoRs ?? 0,
        sin.status,
        sin.origemPeriodo || 'Cartão de Risco',
      ])
    })
  }
  const wsSinistros = XLSX.utils.aoa_to_sheet(sinistrosRows)
  wsSinistros['!cols'] = [
    { wch: 5 },
    { wch: 16 },
    { wch: 30 },
    { wch: 50 },
    { wch: 20 },
    { wch: 16 },
    { wch: 25 },
  ]
  XLSX.utils.book_append_sheet(wb, wsSinistros, 'Histórico de Sinistros')

  // Nome do arquivo seguro
  const cleanName = (data.nomeEmpreendimento || 'Empresa')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30)
  const filename = `Kit_Submissao_${data.rfqCode}_${cleanName}.xlsx`
  XLSX.writeFile(wb, filename)
}

/**
 * Dispara impressão nativa estilizada em janela dedicada para gerar PDF do Pedido de Cotação
 */
export function printSubmissionKitPdf(data: SubmissionKitData): void {
  const printWindow = window.open('', '_blank', 'width=950,height=900')
  if (!printWindow) {
    alert('A janela de impressão foi bloqueada pelo navegador. Permita pop-ups para gerar o PDF.')
    return
  }

  const ativas = Object.entries(data.protecoes)
    .filter(([, v]) => v)
    .map(([k]) => k)

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Kit de Submissão - ${data.rfqCode} - ${data.nomeEmpreendimento}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 12mm 14mm 12mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a202c;
      background: #fff;
      margin: 0;
      padding: 20px;
      font-size: 11px;
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid #0F2B46;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .logo-box h1 {
      font-size: 16px;
      font-weight: 800;
      color: #0F2B46;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .logo-box p {
      font-size: 10px;
      color: #4a5568;
      margin: 2px 0 0;
    }
    .rfq-badge {
      background: #EBF8FF;
      border: 1px solid #BEE3F8;
      color: #2B6CB0;
      padding: 6px 10px;
      border-radius: 6px;
      text-align: right;
    }
    .rfq-badge .code {
      font-size: 13px;
      font-weight: 700;
      font-family: monospace;
    }
    .rfq-badge .sla {
      font-size: 9px;
      color: #4A5568;
      margin-top: 2px;
    }
    h2 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #0F2B46;
      border-left: 3px solid #16578B;
      padding-left: 6px;
      margin: 14px 0 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px 14px;
      margin-bottom: 10px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px 14px;
      margin-bottom: 10px;
    }
    .item {
      padding: 3px 0;
      border-bottom: 1px dotted #e2e8f0;
    }
    .item .label {
      font-size: 9.5px;
      color: #718096;
      text-transform: uppercase;
      font-weight: 600;
      display: block;
    }
    .item .value {
      font-size: 11px;
      color: #1a202c;
      font-weight: 600;
      word-break: break-word;
    }
    .highlight-card {
      background: #F7FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 10px;
    }
    th {
      background: #EDF2F7;
      color: #2D3748;
      font-weight: 700;
      text-align: left;
      padding: 5px 6px;
      border: 1px solid #CBD5E0;
      font-size: 9.5px;
    }
    td {
      padding: 5px 6px;
      border: 1px solid #E2E8F0;
      color: #2D3748;
    }
    tr:nth-child(even) td {
      background: #F7FAFC;
    }
    .text-right { text-align: right; }
    .badge-tag {
      display: inline-block;
      background: #EDF2F7;
      color: #2D3748;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9.5px;
      margin: 2px;
    }
    .footer {
      margin-top: 20px;
      border-top: 1px solid #CBD5E0;
      padding-top: 8px;
      font-size: 9px;
      color: #718096;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">
      <h1>BYCOR P&C INTELLIGENCE</h1>
      <p>Kit de Submissão de Edital de Cotação (RFQ) · Mercado Segurador</p>
    </div>
    <div class="rfq-badge">
      <div class="code">${data.rfqCode}</div>
      <div class="sla">Prazo Limite SLA: <strong>${formatDate(data.prazoLimite)}</strong></div>
      <div class="sla">Data de Envio: ${formatDate(data.dataEnvio)}</div>
    </div>
  </div>

  ${
    data.observacoesRfq
      ? `
    <div class="highlight-card" style="border-left: 3px solid #D69E2E;">
      <span class="label">Observações e Requisitos Técnicos do Corretor:</span>
      <div class="value" style="font-weight: normal; margin-top: 2px;">${data.observacoesRfq}</div>
    </div>
  `
      : ''
  }

  <h2>1. Identificação do Segurado & Local do Risco</h2>
  <div class="grid">
    <div class="item">
      <span class="label">Razão Social</span>
      <span class="value">${data.razaoSocial || '—'}</span>
    </div>
    <div class="item">
      <span class="label">CNPJ do Segurado</span>
      <span class="value">${formatCnpj(data.cnpj) || '—'}</span>
    </div>
    <div class="item">
      <span class="label">Nome Fantasia / Empreendimento</span>
      <span class="value">${data.nomeEmpreendimento || '—'}</span>
    </div>
    <div class="item">
      <span class="label">Segmento de Negócio</span>
      <span class="value">Hotéis, Resorts & Hospitalidade</span>
    </div>
    <div class="item" style="grid-column: span 2;">
      <span class="label">Endereço do Local do Risco</span>
      <span class="value">${data.endereco || '—'} ${data.cidade ? `— ${data.cidade}/${data.uf}` : ''}</span>
    </div>
    <div class="item">
      <span class="label">Atividade Principal (CNAE)</span>
      <span class="value">${data.atividade || '—'}</span>
    </div>
    <div class="item">
      <span class="label">Atividade Exercida no Local</span>
      <span class="value">${data.atividadeExercida || '—'}</span>
    </div>
    ${
      data.cosseguradosNome
        ? `
      <div class="item" style="grid-column: span 2;">
        <span class="label">Cossegurado</span>
        <span class="value">${data.cosseguradosNome} ${data.cosseguradosCnpj ? `(${formatCnpj(data.cosseguradosCnpj)})` : ''}</span>
      </div>
    `
        : ''
    }
  </div>

  <h2>2. Valores em Risco Declarados (VRD)</h2>
  <div class="grid-3 highlight-card">
    <div>
      <span class="label">Tipo de Cobertura</span>
      <div class="value" style="color: #2B6CB0; font-size: 13px;">${data.tipoCobertura}</div>
    </div>
    <div>
      <span class="label">VRD Danos Materiais</span>
      <div class="value" style="font-size: 13px;">${formatCurrency(data.vrdPredio)}</div>
    </div>
    <div>
      <span class="label">VRD Lucros Cessantes</span>
      <div class="value" style="font-size: 13px;">${data.vrdLucrosCessantes ? formatCurrency(data.vrdLucrosCessantes) : 'Não contratado'}</div>
    </div>
  </div>
  <div class="grid">
    <div class="item">
      <span class="label">VRD Total do Risco</span>
      <span class="value" style="color: #2D3748; font-size: 12px;">${formatCurrency(data.vrdTotal)}</span>
    </div>
    <div class="item">
      <span class="label">Seguradora / Apólice Anterior</span>
      <span class="value">${data.apoliceAnteriorSeguradora ? `${data.apoliceAnteriorSeguradora} (Nº ${data.apoliceAnteriorNumero || 'Vigente'})` : 'Cotação / Novo Risco'}</span>
    </div>
  </div>

  <h2>3. Características Construtivas & Proteções</h2>
  <div class="grid-3">
    <div class="item">
      <span class="label">Padrão Construtivo</span>
      <span class="value">${data.tipoConstrucao || 'Alvenaria / Superior'}</span>
    </div>
    <div class="item">
      <span class="label">Ano de Construção</span>
      <span class="value">${data.anoConstrucao || '—'}</span>
    </div>
    <div class="item">
      <span class="label">Área Construída</span>
      <span class="value">${data.areaConstruidaM2 ? `${data.areaConstruidaM2} m²` : '—'}</span>
    </div>
    <div class="item">
      <span class="label">Pavimentos / Andares</span>
      <span class="value">${data.numAndares || '—'}</span>
    </div>
    <div class="item">
      <span class="label">Unidades Habitacionais (UH)</span>
      <span class="value">${data.numUnidades || '—'}</span>
    </div>
    <div class="item">
      <span class="label">Distância Bombeiros</span>
      <span class="value">${data.distBombeirosKm ? `${data.distBombeirosKm} km` : '—'}</span>
    </div>
  </div>

  <div style="margin-top: 10px;">
    <span class="label" style="display: block; margin-bottom: 6px; font-weight: 600; font-size: 11px;">Sistemas de Prevenção e Proteção Existentes (${ativas.length} ativas):</span>
    <div>
      ${ativas.length > 0 ? ativas.map((p) => `<span class="badge-tag">✔ ${p}</span>`).join('') : '<span style="color: #718096;">Nenhuma proteção específica cadastrada.</span>'}
    </div>
  </div>

  <h2>4. Tabela de Coberturas Solicitadas (Importância Segurada - IS)</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 25px;">#</th>
        <th>Cobertura a Contratar</th>
        <th style="width: 150px;" class="text-right">Importância Segurada (IS)</th>
        <th style="width: 150px;">Franquia / POS Sugerida</th>
      </tr>
    </thead>
    <tbody>
      ${(() => {
        // Filtra apenas coberturas com Importância Segurada preenchida (> 0) e ordena:
        // 1º Básica, 2º Lucros Cessantes, 3º Demais em ordem alfabética
        const cobsContratadas = sortKitCoberturas(
          data.coberturas.filter((c) => {
            const val = getEffectiveIS(c)
            return typeof val === 'number' && val > 0
          }),
        )

        if (cobsContratadas.length === 0) {
          return `
            <tr>
              <td>1</td>
              <td><strong>Incêndio Básica (Danos Materiais)</strong></td>
              <td class="text-right font-mono"><strong>${data.vrdTotal ? formatCurrency(data.vrdTotal) : 'A definir'}</strong></td>
              <td>Condições gerais de mercado</td>
            </tr>
          `
        }

        return cobsContratadas
          .map((c, i) => {
            const val = getEffectiveIS(c)
            const isBasica = isCoberturaBasica(c)
            const isLc = isCoberturaLucrosCessantes(c)
            const badge = isBasica
              ? '<span class="badge-tag" style="background: #EBF8FF; color: #2B6CB0; font-weight: 700;">Cobertura Básica</span>'
              : isLc
                ? '<span class="badge-tag" style="background: #FEFCBF; color: #744210; font-weight: 700;">Lucros Cessantes</span>'
                : ''

            return `
          <tr>
            <td>${i + 1}</td>
            <td>
              <strong>${c.nome}</strong>
              ${badge ? ` ${badge}` : ''}
              ${c.observacao ? `<div style="font-size: 8.5px; color: #718096; margin-top: 1px;">${c.observacao}</div>` : ''}
            </td>
            <td class="text-right font-mono" style="font-size: 11px;">
              <strong>${formatCurrency(val)}</strong>
            </td>
            <td>${c.franquiaPos || 'Conforme condições padrão'}</td>
          </tr>
        `
          })
          .join('')
      })()}
    </tbody>
  </table>

  <h2>5. Histórico de Sinistros Declarados</h2>
  ${
    data.sinistros.length === 0
      ? `
    <div class="highlight-card" style="color: #2F855A; font-weight: 600;">
      ✔ Segurado sem registro de sinistros nos últimos 5 anos de apólice.
    </div>
  `
      : `
    <table>
      <thead>
        <tr>
          <th style="width: 25px;">#</th>
          <th style="width: 80px;">Data</th>
          <th style="width: 140px;">Cobertura</th>
          <th>Descrição do Evento</th>
          <th style="width: 100px;" class="text-right">Indenização</th>
          <th style="width: 80px;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${data.sinistros
          .map(
            (s, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${formatDate(s.dataSinistro)}</td>
            <td><strong>${s.coberturaAcionada}</strong></td>
            <td>${s.descricao || '—'}</td>
            <td class="text-right">${s.valorIndenizadoRs ? formatCurrency(s.valorIndenizadoRs) : 'R$ 0,00'}</td>
            <td>${s.status}</td>
          </tr>
        `,
          )
          .join('')}
      </tbody>
    </table>
  `
  }

  <div class="footer">
    <div>Bycor Consultoria e Corretora de Seguros · Plataforma P&C Intelligence</div>
    <div>Documento gerado automaticamente para submissão aos portais das seguradoras</div>
  </div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  </script>
</body>
</html>
  `

  printWindow.document.open()
  printWindow.document.write(htmlContent)
  printWindow.document.close()
}

/**
 * Remove o registro do Kit de Submissão gerado para um RFQ e documentos anexos do kit,
 * mantendo o RFQ, empreendimento, apólices e propostas completamente intactos.
 */
export async function deleteSubmissionKit(rfqId: string): Promise<void> {
  // 1. Atualiza o RFQ limpando o status e timestamp de geração do Kit
  await pb.collection('rfq').update(rfqId, {
    kit_gerado: false,
    kit_gerado_em: '',
  })

  // 2. Se houver documentos avulsos do tipo QAR / Questionário vinculados a este RFQ, exclui de forma segura
  try {
    const docs = await pb.collection('documentos').getFullList({
      filter: `rfq = "${rfqId}"`,
    })
    for (const doc of docs) {
      try {
        await pb.collection('documentos').delete(doc.id)
      } catch (err) {
        console.warn(`Aviso: falha ao remover documento ${doc.id} vinculado ao RFQ:`, err)
      }
    }
  } catch (err) {
    console.warn('Aviso ao consultar documentos vinculados ao RFQ:', err)
  }
}
