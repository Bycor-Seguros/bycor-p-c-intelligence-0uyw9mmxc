import pb from '@/lib/pocketbase/client'

export type RfqSeguradoraStatus = 'Convidada' | 'Kit entregue' | 'Proposta recebida' | 'Declinou'

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
    proposta?: {
      id: string
      lmi_lmg?: number
      premio_liquido?: number
      premio_bruto?: number
      data_proposta?: string
      pos_franquias?: string
      status?: string
    }
  }
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
  lmiLmg?: number
  premioLiquido?: number
  premioBruto?: number
  posFranquias?: string
  clausulas?: string
  exclusoes?: string
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

    // 2. Busca propostas existentes para este RFQ para linkar se ainda não estiverem linkadas
    const existingPropostas = await pb.collection('propostas').getFullList<{
      id: string
      rfq: string
      seguradora: string
      data_proposta: string
      lmi_lmg: number
      premio_liquido: number
      premio_bruto: number
    }>({
      filter: `rfq = "${rfqId}"`,
    })

    const propostasBySeg = new Map<string, (typeof existingPropostas)[0]>()
    existingPropostas.forEach((p) => {
      propostasBySeg.set(p.seguradora, p)
    })

    // 3. Para cada seguradora solicitada, se não existir registro, cria
    const toCreate = seguradorasSolicitadas.filter((segId) => !existingBySeg.has(segId))

    for (const segId of toCreate) {
      const prop = propostasBySeg.get(segId)
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

    // 4. Se havia registro existente com status 'Convidada'/'Kit entregue' mas agora tem proposta, sincroniza
    for (const [segId, rec] of existingBySeg.entries()) {
      const prop = propostasBySeg.get(segId)
      if (prop && rec.status !== 'Proposta recebida') {
        const updated = await pb.collection('rfq_seguradoras').update<RfqSeguradoraRecord>(rec.id, {
          status: 'Proposta recebida',
          proposta: prop.id,
          data_resposta: prop.data_proposta || new Date().toISOString().slice(0, 10),
        })
        existingBySeg.set(segId, updated)
      }
    }

    // 5. Retorna a lista atualizada completa com expand
    return await pb.collection('rfq_seguradoras').getFullList<RfqSeguradoraRecord>({
      filter: `rfq = "${rfqId}"`,
      expand: 'seguradora,proposta',
      sort: 'created',
    })
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
    posFranquias,
    clausulas,
    exclusoes,
  } = params

  // 1. Cria ou atualiza o registro na coleção propostas
  // Verifica se já existe proposta para esse RFQ + seguradora
  const existingProps = await pb.collection('propostas').getFullList<{ id: string }>({
    filter: `rfq = "${rfqId}" && seguradora = "${seguradoraId}"`,
  })

  let propostaId: string
  const propPayload = {
    rfq: rfqId,
    seguradora: seguradoraId,
    data_proposta: dataProposta || new Date().toISOString().slice(0, 10),
    lmi_lmg: lmiLmg ? Number(lmiLmg) : 0,
    premio_liquido: premioLiquido ? Number(premioLiquido) : 0,
    premio_bruto: premioBruto ? Number(premioBruto) : 0,
    pos_franquias: posFranquias?.trim() || '',
    clausulas: clausulas?.trim() || '',
    exclusoes: exclusoes?.trim() || '',
    status: 'Pendente',
    coberturas: [],
  }

  if (existingProps.length > 0) {
    propostaId = existingProps[0].id
    await pb.collection('propostas').update(propostaId, propPayload)
  } else {
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
