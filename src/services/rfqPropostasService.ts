import pb from '@/lib/pocketbase/client'
import { canonicalizeInsurerName } from '@/services/guardiaImporter'
import { normalizarSeguradora } from './seguradoraNormalizer'

export type BasePremioUi = 'liquido' | 'net'

export const BASE_PREMIO_CANONICA = {
  LIQUIDO: 'Prêmio Líquido (já com comissão)',
  NET: 'Prêmio Net (sem comissão)',
} as const

/**
 * Normaliza o valor de base do prêmio (seja chave curta 'liquido'/'net' ou texto arbitrário)
 * para os valores canônicos aceitos no schema do PocketBase da coleção propostas.
 */
export function normalizarBasePremioParaEscrita(
  valor?: string | null,
): 'Prêmio Líquido (já com comissão)' | 'Prêmio Net (sem comissão)' | undefined {
  if (!valor) return undefined
  const v = valor.trim().toLowerCase()
  if (v === 'net' || v.includes('net') || v.includes('sem comissão')) {
    return BASE_PREMIO_CANONICA.NET
  }
  if (
    v === 'liquido' ||
    v === 'líquido' ||
    v.includes('líquido') ||
    v.includes('liquido') ||
    v.includes('com comissão')
  ) {
    return BASE_PREMIO_CANONICA.LIQUIDO
  }
  // Se já for exatamente uma das canônicas
  if (valor === BASE_PREMIO_CANONICA.NET) return BASE_PREMIO_CANONICA.NET
  if (valor === BASE_PREMIO_CANONICA.LIQUIDO) return BASE_PREMIO_CANONICA.LIQUIDO
  return undefined
}

/**
 * Mapeamento inverso para repopular os seletores da UI ('liquido' | 'net').
 */
export function desnormalizarBasePremioParaUi(valor?: string | null): BasePremioUi {
  if (!valor) return 'liquido'
  const v = valor.trim().toLowerCase()
  if (v === 'net' || v.includes('net') || v.includes('sem comissão')) {
    return 'net'
  }
  return 'liquido'
}

export type RfqSeguradoraStatus = 'Convidada' | 'Kit entregue' | 'Proposta recebida' | 'Declinou'

export interface PropostaModelo {
  id: string
  rfq: string
  seguradora: string
  opcao?: number
  versao: number
  ativa: boolean
  premio_bruto: number
  premio_liquido: number
  lmi_lmg: number
  premio_net?: number
  agravo?: number
  premio_net_pos_agravo?: number
  iof?: number
  comissao_trabalhada?: number
  base_premio?: string
  vrd_dm?: number
  vrd_mmu?: number
  vrd_mmp?: number
  vrd_lc?: number
  vrd_lc_base?: string
  data_proposta?: string
  pos_franquias?: string
  status?: string
  coberturas?: any[]
  clausulas?: string
  exclusoes?: string
  arquivo?: string
  arquivo_nome?: string
  arquivo_tipo?: string
  arquivo_extracao?: any
  numero_cotacao?: string
  vigencia_inicio?: string
  vigencia_fim?: string
  validade_cotacao?: string
  forma_pagamento?: string
  created?: string
  updated?: string
  expand?: {
    seguradora?: {
      id?: string
      nome: string
      faixa_lmi?: string
      posicionamento?: string
      contatos?: { email?: string; telefone?: string; responsavel?: string }
    }
    rfq?: {
      id?: string
      conta_empreendimento?: string
      expand?: {
        conta_empreendimento?: { nome_empreendimento: string }
      }
    }
  }
}

export interface RfqSeguradoraRecord {
  id: string
  rfq: string
  seguradora: string
  status: RfqSeguradoraStatus
  kit_entregue?: boolean
  kit_entregue_em?: string
  declinou_motivo?: string
  declinou_em?: string
  proposta?: string
  data_resposta?: string
  created: string
  updated: string
  expand?: {
    seguradora?: {
      id: string
      nome: string
      posicionamento?: string
      contatos?: { email?: string; telefone?: string; responsavel?: string }
      faixa_lmi?: string
      apetite_segmentos?: Record<string, string>
    }
    proposta?: PropostaModelo
  }
  propostas_todas?: PropostaModelo[]
}

export interface RfqPropostaSummary {
  totalConvidadas: number
  propostasRecebidas: number
  kitEntregue: number
  declinadas: number
  pendentes: number
  taxaResposta: number
  alertaMinimoRespostas: boolean
}

export interface RegistrarPropostaParams {
  rfqId: string
  seguradoraId: string
  dataProposta: string
  opcao?: number
  versao?: number
  criarNovaVersao?: boolean
  lmiLmg?: number
  premioLiquido?: number
  premioBruto?: number
  premioNet?: number
  agravo?: number
  premioNetPosAgravo?: number
  iof?: number
  comissaoTrabalhada?: number
  basePremio?: string
  vrdDm?: number
  vrdMmu?: number
  vrdMmp?: number
  vrdLc?: number
  vrdLcBase?: string
  posFranquias?: string
  clausulas?: string
  exclusoes?: string
  coberturas?: any[]
}

export interface RegistrarPropostaUploadParams {
  rfqId: string
  seguradoraId?: string // Opcional se for auto-cadastrada a partir dos dados do leitor
  seguradoraNome?: string
  seguradoraCnpj?: string
  seguradoraSusep?: string
  dataProposta: string
  numeroCotacao?: string
  opcao?: number
  versao?: string | number
  modoRegistro?: 'nova_versao' | 'nova_opcao' | 'sobrescrever'
  criarNovaVersao?: boolean
  propostaSubstituirId?: string
  validadeCotacao?: string
  vigenciaInicio?: string
  vigenciaFim?: string
  premioLiquido?: number | null
  premioBruto?: number | null
  premioNet?: number | null
  agravo?: number | null
  premioNetPosAgravo?: number | null
  iof?: number | null
  comissaoTrabalhada?: number | null
  basePremio?: string
  lmiLmg?: number | null
  vrdDm?: number | null
  vrdMmu?: number | null
  vrdMmp?: number | null
  vrdLc?: number | null
  vrdLcBase?: string
  posFranquias?: string
  formaPagamento?: string
  clausulas?: string
  exclusoes?: string
  coberturas?: any[]
  arquivo?: File | null
  arquivoExtracaoJson?: any
}

/**
 * Utilitário central de cálculo de prêmios com suporte a Agravo (%) e Comissão Trabalhada (%)
 * Regra:
 *  - Caso Base Net: Net Pós Agravo = Net * (1 + agravo%), Líquido = Net Pós Agravo / (1 - comissao%), Bruto = Líquido + IOF.
 *  - Caso Base Líquido: Net = Líquido * (1 - comissao%), Net Pós Agravo = Net * (1 + agravo%), Líquido Recalculado = Net Pós Agravo / (1 - comissao%), Bruto = Líquido + IOF.
 *  - Se agravo não preenchido ou 0: Net Pós Agravo = Net (ou undefined se sem agravo).
 */
export const ALIQUOTA_IOF_PADRAO = 0.0738 // 7,38% conforme regra C2 (confirmada contra AXA International Square)

export function calcularFluxoPremios(params: {
  base: BasePremioUi
  premioNet?: number | null
  premioLiquido?: number | null
  comissaoPerc?: number | null
  agravoPerc?: number | null
  iof?: number | null
}): {
  net: number | null
  agravoPerc: number
  netPosAgravo: number | null
  temAgravo: boolean
  liquido: number | null
  iof: number
  bruto: number | null
  iofDerivado: boolean
} {
  const { base, iof } = params
  const comissao = params.comissaoPerc ?? 0
  const agravo = params.agravoPerc ?? 0
  const temAgravo = typeof agravo === 'number' && agravo > 0

  let netBase: number | null = null
  let liqCalculado: number | null = null
  let netPosAgravo: number | null = null

  if (base === 'liquido') {
    const liqInput = params.premioLiquido ?? 0
    if (liqInput > 0) {
      if (comissao >= 0 && comissao < 100) {
        netBase = liqInput * (1 - comissao / 100)
      } else {
        netBase = liqInput
      }

      if (temAgravo && netBase !== null) {
        netPosAgravo = netBase * (1 + agravo / 100)
        if (comissao >= 0 && comissao < 100) {
          liqCalculado = netPosAgravo / (1 - comissao / 100)
        } else {
          liqCalculado = netPosAgravo
        }
      } else {
        netPosAgravo = netBase
        liqCalculado = liqInput
      }
    }
  } else {
    // Base Net
    const netInput = params.premioNet ?? 0
    if (netInput > 0) {
      netBase = netInput
      if (temAgravo) {
        netPosAgravo = netBase * (1 + agravo / 100)
      } else {
        netPosAgravo = netBase
      }

      const netParaLiq = temAgravo && netPosAgravo !== null ? netPosAgravo : netBase
      if (comissao >= 0 && comissao < 100) {
        liqCalculado = netParaLiq / (1 - comissao / 100)
      } else {
        liqCalculado = netParaLiq
      }
    }
  }

  // Regra de IOF no fluxo de prêmios:
  // (1) Se IOF informado explicitamente (> 0), usa o valor informado e Bruto = Líquido + IOF.
  // (2) Se IOF NÃO informado (ou vier 0), deriva: IOF = Líquido * 7,38% e Bruto = Líquido + IOF
  //     inclusive quando o Líquido é derivado da cadeia Net/Agravo (Net Pós Agravo / (1 - comissão)).
  const temIofExplicito = typeof iof === 'number' && iof > 0
  const iofDerivado = !temIofExplicito
  const iofCalculado = temIofExplicito
    ? iof
    : liqCalculado !== null && liqCalculado > 0
      ? Number((liqCalculado * ALIQUOTA_IOF_PADRAO).toFixed(2))
      : 0

  const brutoCalculado =
    liqCalculado !== null ? Number((liqCalculado + iofCalculado).toFixed(2)) : null

  return {
    net: netBase !== null ? Number(netBase.toFixed(2)) : null,
    agravoPerc: agravo,
    netPosAgravo:
      temAgravo && netPosAgravo !== null
        ? Number(netPosAgravo.toFixed(2))
        : netBase !== null
          ? Number(netBase.toFixed(2))
          : null,
    temAgravo,
    liquido: liqCalculado !== null ? Number(liqCalculado.toFixed(2)) : null,
    iof: Number(iofCalculado.toFixed(2)),
    bruto: brutoCalculado,
    iofDerivado,
  }
}

export interface MarcarDeclinioParams {
  rfqId: string
  seguradoraId: string
  motivo?: string
}

/**
 * Garante que cada seguradora convidada no RFQ possua um registro em rfq_seguradoras.
 * Se ainda não existir, cria com status "Convidada".
 * Também checa se já existe proposta registrada para sincronizar status.
 */
export async function syncAndLoadRfqSeguradoras(
  rfqId: string,
  seguradorasSolicitadas: string[] = [],
): Promise<RfqSeguradoraRecord[]> {
  try {
    // 1. Busca registros já existentes nesta coleção
    const existing = await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
      filter: `rfq = "${rfqId}"`,
      expand: 'seguradora,proposta',
      sort: 'created',
    })

    const existingBySeg = new Map<string, RfqSeguradoraRecord>()
    existing.forEach((rec) => {
      existingBySeg.set(rec.seguradora, rec)
    })

    // 2. Busca todas as propostas existentes para este RFQ
    const allPropostas = await pb.collection('propostas').getFullList<PropostaModelo>({
      filter: `rfq = "${rfqId}"`,
      sort: '-versao',
    })

    // Agrupa todas por seguradora e identifica a proposta ativa principal (opção 1 ou primeira ativa encontrada)
    const allPropostasBySeg = new Map<string, PropostaModelo[]>()
    const activePropostaBySeg = new Map<string, PropostaModelo>()

    allPropostas.forEach((p) => {
      const list = allPropostasBySeg.get(p.seguradora) || []
      list.push(p)
      allPropostasBySeg.set(p.seguradora, list)
    })

    // Para o ponteiro singular de rfq_seguradoras (compatibilidade), escolhe a proposta ativa
    // dando preferência à menor opção (Opção 1 ativa) ou à de maior versão
    for (const [segId, pList] of allPropostasBySeg.entries()) {
      const ativas = pList.filter((p) => p.ativa)
      if (ativas.length > 0) {
        // Ordena por opcao asc, depois versao desc
        ativas.sort(
          (a, b) =>
            Number(a.opcao || 1) - Number(b.opcao || 1) ||
            Number(b.versao || 1) - Number(a.versao || 1),
        )
        activePropostaBySeg.set(segId, ativas[0])
      } else if (pList.length > 0) {
        activePropostaBySeg.set(segId, pList[0])
      }
    }

    // 3. Para cada seguradora solicitada, se não existir registro, cria
    const toCreate = seguradorasSolicitadas.filter((segId) => !existingBySeg.has(segId))

    for (const segId of toCreate) {
      const prop = activePropostaBySeg.get(segId)
      const hasProp = Boolean(prop)
      const newRec = await pb.collection('rfq_seguradoras').create<RfqSeguradoraRecord>({
        rfq: rfqId,
        seguradora: segId,
        status: hasProp ? 'Proposta recebida' : 'Convidada',
        proposta: prop?.id || null,
        data_resposta: prop?.data_proposta || '',
        kit_entregue: false,
      })
      existingBySeg.set(segId, newRec)
    }

    // 4. Sincroniza ponteiro da proposta ativa se desatualizado
    for (const [segId, rec] of existingBySeg.entries()) {
      const activeProp = activePropostaBySeg.get(segId)
      if (activeProp) {
        if (rec.proposta !== activeProp.id || rec.status !== 'Proposta recebida') {
          const updated = await pb
            .collection('rfq_seguradoras')
            .update<RfqSeguradoraRecord>(rec.id, {
              status: 'Proposta recebida',
              proposta: activeProp.id,
              data_resposta: activeProp.data_proposta || new Date().toISOString().slice(0, 10),
            })
          existingBySeg.set(segId, updated)
        }
      }
    }

    // 5. Retorna a lista atualizada completa com expand e inclui propostas_todas
    const finalRecords = await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
      filter: `rfq = "${rfqId}"`,
      expand: 'seguradora,proposta',
      sort: 'created',
    })

    return finalRecords.map((r) => ({
      ...r,
      propostas_todas: allPropostasBySeg.get(r.seguradora) || [],
    }))
  } catch (err) {
    console.error('Erro em syncAndLoadRfqSeguradoras:', err)
    return []
  }
}

/**
 * Calcula o resumo consolidado por RFQ
 */
export function computeRfqSummary(records: RfqSeguradoraRecord[]): RfqPropostaSummary {
  const totalConvidadas = records.length
  let propostasRecebidas = 0
  let kitEntregue = 0
  let declinadas = 0
  let pendentes = 0

  records.forEach((r) => {
    if (r.status === 'Proposta recebida') {
      propostasRecebidas++
    } else if (r.status === 'Declinou') {
      declinadas++
    } else if (r.status === 'Kit entregue') {
      kitEntregue++
      pendentes++
    } else {
      pendentes++
    }
  })

  const taxaResposta =
    totalConvidadas > 0 ? Math.round((propostasRecebidas / totalConvidadas) * 100) : 0
  // Alerta quando o bid tiver menos de 5 respostas (o corretor trabalha com 5-6 cias, podendo chegar a 8-10)
  const alertaMinimoRespostas = totalConvidadas > 0 && propostasRecebidas < 5

  return {
    totalConvidadas,
    propostasRecebidas,
    kitEntregue,
    declinadas,
    pendentes,
    taxaResposta,
    alertaMinimoRespostas,
  }
}

/**
 * Alterna a marcação de Kit Entregue no portal da seguradora
 */
export async function toggleKitEntregue(
  recordId: string,
  novoEstado: boolean,
): Promise<RfqSeguradoraRecord> {
  const payload: Partial<RfqSeguradoraRecord> = {
    kit_entregue: novoEstado,
    kit_entregue_em: novoEstado ? new Date().toISOString() : '',
  }

  // Se o status atual for 'Convidada' e marcou entregue, vira 'Kit entregue'
  // Se desmarcou e estava 'Kit entregue', volta para 'Convidada'
  const current = await pb.collection('rfq_seguradoras').getOne<RfqSeguradoraRecord>(recordId)
  if (novoEstado && current.status === 'Convidada') {
    payload.status = 'Kit entregue'
  } else if (!novoEstado && current.status === 'Kit entregue') {
    payload.status = 'Convidada'
  }

  return await pb.collection('rfq_seguradoras').update<RfqSeguradoraRecord>(recordId, payload, {
    expand: 'seguradora,proposta',
  })
}

/**
 * Marca declínio da seguradora com motivo opcional e persiste no histórico do Mapa de Mercado
 */
export async function marcarDeclinio(params: MarcarDeclinioParams): Promise<RfqSeguradoraRecord> {
  const { rfqId, seguradoraId, motivo } = params
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  // 1. Encontra o registro em rfq_seguradoras
  const list = await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
    filter: `rfq = "${rfqId}" && seguradora = "${seguradoraId}"`,
  })

  let targetId = list[0]?.id
  if (!targetId) {
    const created = await pb.collection('rfq_seguradoras').create<RfqSeguradoraRecord>({
      rfq: rfqId,
      seguradora: seguradoraId,
      status: 'Declinou',
      declinou_motivo: motivo?.trim() || 'Sem apetite no momento',
      declinou_em: now,
      data_resposta: today,
    })
    targetId = created.id
  } else {
    await pb.collection('rfq_seguradoras').update(targetId, {
      status: 'Declinou',
      declinou_motivo: motivo?.trim() || 'Sem apetite no momento',
      declinou_em: now,
      data_resposta: today,
    })
  }

  // 2. Alimenta o Mapa de Mercado (historico_relacionamento da seguradora)
  try {
    const segRec = await pb.collection('seguradoras').getOne(seguradoraId)
    const currentHist = (segRec.historico_relacionamento as any[]) || []
    currentHist.push({
      data: today,
      fonte: 'RFQ Declinado',
      observacao: `Declinou cotação no RFQ #${rfqId.slice(0, 6).toUpperCase()}${
        motivo ? ` — Motivo: ${motivo.trim()}` : ''
      }`,
    })
    await pb.collection('seguradoras').update(seguradoraId, {
      historico_relacionamento: currentHist,
    })
  } catch (e) {
    console.warn('Não foi possível registrar histórico na seguradora:', e)
  }

  return await pb.collection('rfq_seguradoras').getOne<RfqSeguradoraRecord>(targetId, {
    expand: 'seguradora,proposta',
  })
}

/**
 * Registra proposta manual da seguradora (cria em propostas e atualiza rfq_seguradoras)
 */
export async function registrarPropostaManual(
  params: RegistrarPropostaParams,
): Promise<{ propostaId: string; rfqSeguradora: RfqSeguradoraRecord }> {
  const {
    rfqId,
    seguradoraId,
    dataProposta,
    lmiLmg,
    premioLiquido,
    premioBruto,
    premioNet,
    agravo,
    premioNetPosAgravo,
    comissaoTrabalhada,
    basePremio,
    vrdDm,
    vrdMmu,
    vrdMmp,
    vrdLc,
    vrdLcBase,
    posFranquias,
    clausulas,
    exclusoes,
  } = params

  const { iof, coberturas } = params

  // 1. Cria ou atualiza o registro na coleção propostas com controle de versão
  const existingProps = await pb.collection('propostas').getFullList<PropostaModelo>({
    filter: `rfq = "${rfqId}" && seguradora = "${seguradoraId}"`,
    sort: '-versao',
  })

  let propostaId: string
  const propPayload: Record<string, any> = {
    rfq: rfqId,
    seguradora: seguradoraId,
    data_proposta: dataProposta || new Date().toISOString().slice(0, 10),
    lmi_lmg: lmiLmg !== undefined && lmiLmg !== null ? Number(lmiLmg) : 0,
    pos_franquias: posFranquias?.trim() || '',
    clausulas: clausulas?.trim() || '',
    exclusoes: exclusoes?.trim() || '',
    status: 'Pendente',
  }

  const liqNum = premioLiquido !== undefined && premioLiquido !== null ? Number(premioLiquido) : 0
  let iofNum = iof !== undefined && iof !== null ? Number(iof) : 0
  if ((!iofNum || iofNum === 0) && liqNum > 0) {
    iofNum = Number((liqNum * ALIQUOTA_IOF_PADRAO).toFixed(2))
  }
  let brutoNum = premioBruto !== undefined && premioBruto !== null ? Number(premioBruto) : 0
  if ((!brutoNum || brutoNum === 0) && liqNum > 0) {
    brutoNum = Number((liqNum + iofNum).toFixed(2))
  }

  propPayload.premio_liquido = liqNum
  propPayload.premio_bruto = brutoNum
  propPayload.iof = iofNum

  if (premioNet !== undefined && premioNet !== null) propPayload.premio_net = Number(premioNet)
  if (agravo !== undefined && agravo !== null) propPayload.agravo = Number(agravo)
  if (premioNetPosAgravo !== undefined && premioNetPosAgravo !== null)
    propPayload.premio_net_pos_agravo = Number(premioNetPosAgravo)
  if (comissaoTrabalhada !== undefined && comissaoTrabalhada !== null)
    propPayload.comissao_trabalhada = Number(comissaoTrabalhada)
  if (basePremio !== undefined) {
    const baseNorm = normalizarBasePremioParaEscrita(basePremio)
    if (baseNorm) propPayload.base_premio = baseNorm
  }
  if (vrdDm !== undefined && vrdDm !== null) propPayload.vrd_dm = Number(vrdDm)
  if (vrdMmu !== undefined && vrdMmu !== null) propPayload.vrd_mmu = Number(vrdMmu)
  if (vrdMmp !== undefined && vrdMmp !== null) propPayload.vrd_mmp = Number(vrdMmp)
  if (vrdLc !== undefined && vrdLc !== null) propPayload.vrd_lc = Number(vrdLc)
  if (vrdLcBase !== undefined) propPayload.vrd_lc_base = vrdLcBase

  if (coberturas !== undefined) {
    propPayload.coberturas = coberturas
  }

  const targetOpcao = params.opcao || 1
  const propsDestaOpcao = existingProps.filter((p) => Number(p.opcao || 1) === targetOpcao)

  const isNovaVersao = Boolean(params.criarNovaVersao)
  if (propsDestaOpcao.length > 0 && !isNovaVersao) {
    propostaId = propsDestaOpcao[0].id
    // Se coberturas não foi passado na edição, mantém as que já existiam
    if (coberturas === undefined && propsDestaOpcao[0].coberturas) {
      propPayload.coberturas = propsDestaOpcao[0].coberturas
    }
    propPayload.opcao = targetOpcao
    await pb.collection('propostas').update(propostaId, propPayload)
  } else {
    // Nova versão de uma opção ou primeira versão de nova opção
    const maiorVersao =
      propsDestaOpcao.length > 0
        ? Math.max(...propsDestaOpcao.map((p) => Number(p.versao || 1)))
        : 0
    const proxVersao = params.versao ? Number(params.versao) : maiorVersao + 1

    // Desativa apenas as outras versões DESTA MESMA OPÇÃO (cada opção mantém sua versão ativa independente!)
    for (const exp of propsDestaOpcao) {
      if (exp.ativa) {
        try {
          await pb.collection('propostas').update(exp.id, { ativa: false })
        } catch {
          /* intentionally ignored */
        }
      }
    }

    if (propPayload.coberturas === undefined) {
      propPayload.coberturas = []
    }
    propPayload.opcao = targetOpcao
    propPayload.versao = proxVersao
    propPayload.ativa = true

    const createdProp = await pb.collection('propostas').create(propPayload)
    propostaId = createdProp.id
  }

  // 2. Atualiza o status do RFQ para "Respondido"
  try {
    await pb.collection('rfq').update(rfqId, {
      status: 'Respondido',
    })
  } catch (err) {
    console.warn('Falha ao atualizar status do RFQ para Respondido:', err)
  }

  // 3. Atualiza ou cria rfq_seguradoras
  const list = await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
    filter: `rfq = "${rfqId}" && seguradora = "${seguradoraId}"`,
  })

  let rfqSegId = list[0]?.id
  const rfqSegPayload = {
    rfq: rfqId,
    seguradora: seguradoraId,
    status: 'Proposta recebida' as RfqSeguradoraStatus,
    proposta: propostaId,
    data_resposta: dataProposta || new Date().toISOString().slice(0, 10),
  }

  if (!rfqSegId) {
    const createdRfqSeg = await pb
      .collection('rfq_seguradoras')
      .create<RfqSeguradoraRecord>(rfqSegPayload)
    rfqSegId = createdRfqSeg.id
  } else {
    await pb.collection('rfq_seguradoras').update(rfqSegId, rfqSegPayload)
  }

  // 4. Registra histórico na seguradora (Mapa de Mercado)
  try {
    const segRec = await pb.collection('seguradoras').getOne(seguradoraId)
    const currentHist = (segRec.historico_relacionamento as any[]) || []
    currentHist.push({
      data: dataProposta || new Date().toISOString().slice(0, 10),
      fonte: 'Proposta Recebida',
      observacao: `Proposta entregue para RFQ #${rfqId.slice(0, 6).toUpperCase()}${
        premioBruto ? ` — Prêmio: R$ ${premioBruto}` : ''
      }${lmiLmg ? ` — LMI: R$ ${lmiLmg}` : ''}`,
    })
    await pb.collection('seguradoras').update(seguradoraId, {
      historico_relacionamento: currentHist,
    })
  } catch (e) {
    console.warn('Não foi possível registrar histórico na seguradora:', e)
  }

  const finalRecord = await pb.collection('rfq_seguradoras').getOne<RfqSeguradoraRecord>(rfqSegId, {
    expand: 'seguradora,proposta',
  })

  return {
    propostaId,
    rfqSeguradora: finalRecord,
  }
}

/**
 * Normaliza e consolida ou auto-cadastra a seguradora no Mapa de Mercado.
 * Se já existir por nome normalizado/canônico, atualiza CNPJ/SUSEP apenas se vazios.
 * Se não existir, cadastra automaticamente com marcação para completar dados.
 */
export async function autoCadastrarOuLocalizarSeguradora(dados: {
  nome: string
  cnpj?: string
  susep?: string
  razaoSocial?: string
}): Promise<{ id: string; nome: string; autoCadastrada: boolean }> {
  const res = await normalizarSeguradora(dados.nome, {
    cnpj: dados.cnpj,
    susep: dados.susep,
    razaoSocial: dados.razaoSocial,
    autoCadastrar: true,
  })

  return {
    id: res.id || '',
    nome: res.nomeCanonica,
    autoCadastrada: res.autoCadastrada,
  }
}

/**
 * Registra proposta a partir do fluxo de upload/extração do PDF
 * - Cria/atualiza em `propostas` com campos de extração e arquivo anexado
 * - Vincula ou auto-cadastra a seguradora no Mapa de Mercado
 * - Vincula em `rfq_seguradoras` com status "Proposta recebida"
 * - Atualiza o RFQ para "Respondido"
 * - Salva registro em `documentos` (tipo Proposta) para rastreabilidade
 */
export async function registrarPropostaComArquivo(params: RegistrarPropostaUploadParams): Promise<{
  propostaId: string
  rfqSeguradora: RfqSeguradoraRecord
  seguradoraId: string
  seguradoraNome: string
  autoCadastrada: boolean
}> {
  const {
    rfqId,
    seguradoraId: passedSegId,
    seguradoraNome,
    seguradoraCnpj,
    seguradoraSusep,
    dataProposta,
    numeroCotacao,
    versao,
    validadeCotacao,
    vigenciaInicio,
    vigenciaFim,
    premioLiquido,
    premioBruto,
    premioNet,
    agravo,
    premioNetPosAgravo,
    iof,
    comissaoTrabalhada,
    basePremio,
    lmiLmg,
    vrdDm,
    vrdMmu,
    vrdMmp,
    vrdLc,
    vrdLcBase,
    posFranquias,
    formaPagamento,
    clausulas,
    exclusoes,
    coberturas = [],
    arquivo,
    arquivoExtracaoJson,
  } = params

  // 1. Resolve seguradora (existente ou auto-cadastro)
  let targetSegId = passedSegId
  let targetSegNome = seguradoraNome || ''
  let autoCadastrada = false

  if (!targetSegId) {
    if (!seguradoraNome) {
      throw new Error('Nome da seguradora não fornecido para auto-cadastro')
    }
    const resolved = await autoCadastrarOuLocalizarSeguradora({
      nome: seguradoraNome,
      cnpj: seguradoraCnpj,
      susep: seguradoraSusep,
    })
    targetSegId = resolved.id
    targetSegNome = resolved.nome
    autoCadastrada = resolved.autoCadastrada
  } else {
    // Já tinha ID; garante nome
    try {
      const segRec = await pb.collection('seguradoras').getOne(targetSegId)
      targetSegNome = segRec.nome
    } catch {
      /* intentionally ignored */
    }
  }

  // 2. Cria ou atualiza proposta usando FormData para upload do PDF com controle de versão
  const existingProps = await pb.collection('propostas').getFullList<PropostaModelo>({
    filter: `rfq = "${rfqId}" && seguradora = "${targetSegId}"`,
    sort: '-versao',
  })

  const formData = new FormData()
  formData.append('rfq', rfqId)
  formData.append('seguradora', targetSegId)
  formData.append('data_proposta', dataProposta || new Date().toISOString().slice(0, 10))
  formData.append('status', 'Pendente')

  const uploadLiq =
    premioLiquido !== undefined && premioLiquido !== null ? Number(premioLiquido) : 0
  let uploadIof = iof !== undefined && iof !== null ? Number(iof) : 0
  if ((!uploadIof || uploadIof === 0) && uploadLiq > 0) {
    uploadIof = Number((uploadLiq * ALIQUOTA_IOF_PADRAO).toFixed(2))
  }
  let uploadBruto = premioBruto !== undefined && premioBruto !== null ? Number(premioBruto) : 0
  if ((!uploadBruto || uploadBruto === 0) && uploadLiq > 0) {
    uploadBruto = Number((uploadLiq + uploadIof).toFixed(2))
  }

  if (lmiLmg !== undefined && lmiLmg !== null) formData.append('lmi_lmg', String(lmiLmg))
  if (uploadLiq > 0) formData.append('premio_liquido', String(uploadLiq))
  if (uploadBruto > 0) formData.append('premio_bruto', String(uploadBruto))
  if (uploadIof > 0) formData.append('iof', String(uploadIof))
  if (premioNet !== undefined && premioNet !== null)
    formData.append('premio_net', String(premioNet))
  if (agravo !== undefined && agravo !== null) formData.append('agravo', String(agravo))
  if (premioNetPosAgravo !== undefined && premioNetPosAgravo !== null)
    formData.append('premio_net_pos_agravo', String(premioNetPosAgravo))
  if (comissaoTrabalhada !== undefined && comissaoTrabalhada !== null)
    formData.append('comissao_trabalhada', String(comissaoTrabalhada))
  if (basePremio !== undefined && basePremio !== null) {
    const baseNorm = normalizarBasePremioParaEscrita(basePremio)
    if (baseNorm) formData.append('base_premio', baseNorm)
  }

  if (vrdDm !== undefined && vrdDm !== null) formData.append('vrd_dm', String(vrdDm))
  if (vrdMmu !== undefined && vrdMmu !== null) formData.append('vrd_mmu', String(vrdMmu))
  if (vrdMmp !== undefined && vrdMmp !== null) formData.append('vrd_mmp', String(vrdMmp))
  if (vrdLc !== undefined && vrdLc !== null) formData.append('vrd_lc', String(vrdLc))
  if (vrdLcBase !== undefined && vrdLcBase !== null)
    formData.append('vrd_lc_base', String(vrdLcBase))

  if (posFranquias) formData.append('pos_franquias', posFranquias)
  if (clausulas) formData.append('clausulas', clausulas)
  if (exclusoes) formData.append('exclusoes', exclusoes)
  if (numeroCotacao) formData.append('numero_cotacao', numeroCotacao)
  if (formaPagamento) formData.append('forma_pagamento', formaPagamento)
  if (validadeCotacao) formData.append('validade_cotacao', validadeCotacao)
  if (vigenciaInicio) formData.append('vigencia_inicio', vigenciaInicio)
  if (vigenciaFim) formData.append('vigencia_fim', vigenciaFim)

  // Coberturas extraídas serializadas em JSON
  formData.append('coberturas', JSON.stringify(coberturas))

  // Metadados de extração
  if (arquivoExtracaoJson) {
    formData.append('arquivo_extracao', JSON.stringify(arquivoExtracaoJson))
  }

  if (arquivo) {
    formData.append('arquivo', arquivo)
    formData.append('arquivo_nome', arquivo.name)
    formData.append('arquivo_tipo', arquivo.type || 'application/pdf')
  }

  // Determina modo de registro: nova_versao (default) | nova_opcao | sobrescrever
  let modo: 'nova_versao' | 'nova_opcao' | 'sobrescrever' = params.modoRegistro || 'nova_versao'
  if (!params.modoRegistro) {
    if (params.criarNovaVersao === false) {
      modo = 'sobrescrever'
    } else {
      modo = 'nova_versao'
    }
  }

  // Descobre opções já existentes para esta seguradora neste RFQ
  const opcoesExistentes = Array.from(new Set(existingProps.map((p) => Number(p.opcao || 1)))).sort(
    (a, b) => a - b,
  )
  const maiorOpcao = opcoesExistentes.length > 0 ? Math.max(...opcoesExistentes) : 1

  let targetOpcao: number
  let targetVersao: number
  let propostaId: string

  if (existingProps.length === 0) {
    // Primeira proposta da seguradora: Opção 1, Versão 1, ativa
    targetOpcao = params.opcao || 1
    targetVersao = 1
    if (params.versao) {
      const parsed = parseInt(String(params.versao).replace(/\D/g, ''), 10)
      if (!isNaN(parsed) && parsed > 0) targetVersao = parsed
    }
    formData.append('opcao', String(targetOpcao))
    formData.append('versao', String(targetVersao))
    formData.append('ativa', 'true')
    const createdProp = await pb.collection('propostas').create(formData)
    propostaId = createdProp.id
  } else if (modo === 'sobrescrever') {
    // (c) Sobrescrever: atualiza registro existente preservando opcao e versao originais
    const targetRec = params.propostaSubstituirId
      ? existingProps.find((p) => p.id === params.propostaSubstituirId) || existingProps[0]
      : existingProps[0]
    propostaId = targetRec.id
    targetOpcao = Number(targetRec.opcao || 1)
    targetVersao = Number(targetRec.versao || 1)
    formData.append('opcao', String(targetOpcao))
    formData.append('versao', String(targetVersao))
    formData.append('ativa', 'true')
    await pb.collection('propostas').update(propostaId, formData)
  } else if (modo === 'nova_opcao') {
    // (b) "Nova Opção da mesma cia" — cria registro novo com opcao = M+1, versao = 1, ativa.
    // A versão ativa da opção anterior permanece como está (a versão ativa é por opção, cada opção mantém a sua).
    targetOpcao = params.opcao || maiorOpcao + 1
    targetVersao = 1
    if (params.versao) {
      const parsed = parseInt(String(params.versao).replace(/\D/g, ''), 10)
      if (!isNaN(parsed) && parsed > 0) targetVersao = parsed
    }
    formData.append('opcao', String(targetOpcao))
    formData.append('versao', String(targetVersao))
    formData.append('ativa', 'true')
    const createdProp = await pb.collection('propostas').create(formData)
    propostaId = createdProp.id
  } else {
    // (a) "Mesma Opção — nova versão (vN)" (recomendado) — cria novo registro com mesma opcao, versao = N+1, ativa.
    // Desativa apenas as outras versões DESTA MESMA OPÇÃO. As outras opções mantêm suas versões ativas intactas.
    targetOpcao = params.opcao || 1
    const propsDestaOpcao = existingProps.filter((p) => Number(p.opcao || 1) === targetOpcao)
    const maiorVersaoOpcao =
      propsDestaOpcao.length > 0
        ? Math.max(...propsDestaOpcao.map((p) => Number(p.versao || 1)))
        : 0
    targetVersao = maiorVersaoOpcao + 1
    if (params.versao) {
      const parsed = parseInt(String(params.versao).replace(/\D/g, ''), 10)
      if (!isNaN(parsed) && parsed > 0) targetVersao = parsed
    }

    // Desativa apenas as versões anteriores da MESMA OPÇÃO
    for (const exp of propsDestaOpcao) {
      if (exp.ativa) {
        try {
          await pb.collection('propostas').update(exp.id, { ativa: false })
        } catch {
          /* intentionally ignored */
        }
      }
    }

    formData.append('opcao', String(targetOpcao))
    formData.append('versao', String(targetVersao))
    formData.append('ativa', 'true')
    const createdProp = await pb.collection('propostas').create(formData)
    propostaId = createdProp.id
  }

  // 3. Atualiza status do RFQ para "Respondido"
  try {
    await pb.collection('rfq').update(rfqId, {
      status: 'Respondido',
    })
  } catch (err) {
    console.warn('Falha ao atualizar RFQ para Respondido:', err)
  }

  // 4. Cria ou atualiza em rfq_seguradoras
  const list = await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
    filter: `rfq = "${rfqId}" && seguradora = "${targetSegId}"`,
  })

  let rfqSegId = list[0]?.id
  const rfqSegPayload = {
    rfq: rfqId,
    seguradora: targetSegId,
    status: 'Proposta recebida' as RfqSeguradoraStatus,
    proposta: propostaId,
    data_resposta: dataProposta || new Date().toISOString().slice(0, 10),
  }

  if (!rfqSegId) {
    const created = await pb
      .collection('rfq_seguradoras')
      .create<RfqSeguradoraRecord>(rfqSegPayload)
    rfqSegId = created.id
  } else {
    await pb.collection('rfq_seguradoras').update(rfqSegId, rfqSegPayload)
  }

  // 5. Salva documento na coleção `documentos` para rastreabilidade
  if (arquivo) {
    try {
      const docForm = new FormData()
      docForm.append('tipo', 'Proposta')
      docForm.append('arquivo', arquivo)
      docForm.append('rfq', rfqId)
      docForm.append('versao', String(versao || numeroCotacao || '1'))
      docForm.append('data', dataProposta || new Date().toISOString().slice(0, 10))
      docForm.append('extraido_por_ia', 'true')

      // Busca empreendimento do RFQ para vincular
      const rfqRecord = await pb.collection('rfq').getOne(rfqId)
      if (rfqRecord.conta_empreendimento) {
        docForm.append('vinculado_empreendimento', rfqRecord.conta_empreendimento)
      }

      await pb.collection('documentos').create(docForm)
    } catch (docErr) {
      console.warn('Não foi possível gravar o arquivo na coleção documentos:', docErr)
    }
  }

  // 6. Registra histórico e complementa CNPJ/SUSEP na seguradora (Mapa de Mercado)
  // Regra do usuário: cria se não existe (marcada como "Cadastrada a partir de proposta — completar dados");
  // se já existe, apenas complementa CNPJ/SUSEP se estiverem vazios; NUNCA sobrescreve dados existentes.
  try {
    const segRec = await pb.collection('seguradoras').getOne(targetSegId)
    const currentHist = (segRec.historico_relacionamento as any[]) || []
    currentHist.push({
      data: dataProposta || new Date().toISOString().slice(0, 10),
      fonte: 'Upload Proposta PDF',
      observacao: `Proposta enviada para RFQ #${rfqId.slice(0, 6).toUpperCase()}${
        numeroCotacao ? ` — Cot. ${numeroCotacao}` : ''
      }${premioBruto ? ` — Prêmio R$ ${premioBruto}` : ''}${
        lmiLmg ? ` — LMI R$ ${lmiLmg}` : ''
      }${autoCadastrada ? ' (Seguradora auto-cadastrada)' : ''}`,
    })

    const updatePayload: Record<string, any> = {
      historico_relacionamento: currentHist,
    }

    let obsAtual = segRec.observacoes || ''
    let needsObsUpdate = false

    if (
      seguradoraCnpj &&
      !obsAtual.includes(seguradoraCnpj) &&
      !obsAtual.toLowerCase().includes('cnpj:')
    ) {
      obsAtual += `${obsAtual ? ' | ' : ''}CNPJ: ${seguradoraCnpj}`
      needsObsUpdate = true
    }
    if (
      seguradoraSusep &&
      !obsAtual.includes(seguradoraSusep) &&
      !obsAtual.toLowerCase().includes('susep:')
    ) {
      obsAtual += `${obsAtual ? ' | ' : ''}SUSEP: ${seguradoraSusep}`
      needsObsUpdate = true
    }
    if (needsObsUpdate) {
      updatePayload.observacoes = obsAtual
    }

    await pb.collection('seguradoras').update(targetSegId, updatePayload)
  } catch (e) {
    console.warn('Não foi possível registrar histórico na seguradora:', e)
  }

  const finalRecord = await pb.collection('rfq_seguradoras').getOne<RfqSeguradoraRecord>(rfqSegId, {
    expand: 'seguradora,proposta',
  })

  return {
    propostaId,
    rfqSeguradora: finalRecord,
    seguradoraId: targetSegId,
    seguradoraNome: targetSegNome,
    autoCadastrada,
  }
}

/**
 * Define qual versão da proposta está ativa para uma OPÇÃO específica da seguradora no RFQ.
 * CONCEITO DO USUÁRIO: A versão ativa passa a existir POR OPÇÃO (não por seguradora).
 * Trocar a versão ativa de uma opção não afeta as outras opções da mesma cia.
 */
export async function definirVersaoAtiva(
  rfqId: string,
  seguradoraId: string,
  propostaId: string,
): Promise<void> {
  // 1. Busca todas as propostas da seguradora neste RFQ
  const props = await pb.collection('propostas').getFullList<PropostaModelo>({
    filter: `rfq = "${rfqId}" && seguradora = "${seguradoraId}"`,
  })

  const targetProp = props.find((p) => p.id === propostaId)
  if (!targetProp) return

  const targetOpcao = Number(targetProp.opcao || 1)

  // 2. Atualiza ativa = true na escolhida, ativa = false APENAS nas outras da MESMA OPÇÃO
  for (const p of props) {
    const pOpcao = Number(p.opcao || 1)
    if (pOpcao === targetOpcao) {
      const deveSerAtiva = p.id === propostaId
      if (Boolean(p.ativa) !== deveSerAtiva) {
        await pb.collection('propostas').update(p.id, { ativa: deveSerAtiva })
      }
    }
  }

  // 3. Atualiza o ponteiro em rfq_seguradoras para refletir a proposta ativa relevante
  const rfqSegs = await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
    filter: `rfq = "${rfqId}" && seguradora = "${seguradoraId}"`,
  })

  if (rfqSegs.length > 0) {
    await pb.collection('rfq_seguradoras').update(rfqSegs[0].id, {
      proposta: propostaId,
      data_resposta: targetProp?.data_proposta || new Date().toISOString().slice(0, 10),
      status: 'Proposta recebida',
    })
  }
}

/**
 * Busca todas as propostas de um RFQ com informações expandidas da seguradora
 */
export async function carregarTodasPropostasRfq(rfqId: string): Promise<PropostaModelo[]> {
  try {
    return await pb.collection('propostas').getFullList<PropostaModelo>({
      filter: `rfq = "${rfqId}"`,
      expand: 'seguradora,rfq.conta_empreendimento',
      sort: '-versao',
    })
  } catch (err) {
    console.error('Erro ao carregar todas as propostas do RFQ:', err)
    return []
  }
}
