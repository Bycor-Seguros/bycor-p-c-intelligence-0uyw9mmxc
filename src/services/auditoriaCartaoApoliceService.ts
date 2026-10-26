import pb from '@/lib/pocketbase/client'
import { CATEGORIAS_48, formatCurrency } from '@/lib/formatters'
import { matchCanonicalCategory, RiskCardData } from '@/services/riskCardReader'

export interface ItemAuditoriaComparativo {
  id: string
  categoriaNormalizada: string
  nomeCartao?: string
  nomeApolice?: string
  lmiCartao: number | null
  lmiApolice: number | null
  franquiaCartao: string
  franquiaApolice: string
  diferencaLmi: number | null
  percentualDesvio: number | null
  tipo: 'casada' | 'so_cartao' | 'so_apolice'
  divergente: boolean
  candidatoRessalvaC5: boolean
  motivoDivergencia?: string
}

export interface RubricaVrdItem {
  rubrica: string
  valorCartao: number | null
  valorApolice: number | null
  diferenca: number | null
  percentualDesvio: number | null
  divergente: boolean
}

export interface SnapshotComparativoAuditoria {
  identificacao: {
    cartao: {
      segurado: string
      cnpj: string
      seguradora: string
      numeroReferencia: string
      vigenciaInicio: string
      vigenciaFim: string
      ramo: string
      premioTotal: number | null
      premioLiquido: number | null
    }
    apolice: {
      segurado: string
      cnpj: string
      seguradora: string
      numeroApolice: string
      vigenciaInicio: string
      vigenciaFim: string
      ramo: string
      premioTotal: number | null
      premioLiquido: number | null
      status: string
    }
    divergenciasIdentificacao: Array<{
      campo: string
      valorCartao: string
      valorApolice: string
      descricao: string
    }>
  }
  coberturas: {
    casadas: ItemAuditoriaComparativo[]
    soNoCartao: ItemAuditoriaComparativo[]
    soNaApolice: ItemAuditoriaComparativo[]
    totalDivergencias: number
    totalCandidatosRessalvaC5: number
  }
  vrdPorRubrica: RubricaVrdItem[]
  premios: {
    premioLiquidoCartao: number | null
    premioLiquidoApolice: number | null
    premioTotalCartao: number | null
    premioTotalApolice: number | null
    diferencaLiquido: number | null
    diferencaTotal: number | null
    divergente: boolean
  }
  sinistros: {
    totalCartao: number
    totalApolice: number
    itensCartao: Array<{
      ano: string
      cobertura: string
      descricao: string
      valor: number | null
    }>
  }
}

export interface AuditoriaRodadaRecord {
  id: string
  empreendimento: string
  apolice?: string
  numero_rodada: number
  data_rodada: string
  produto_ramo: string
  arquivo_origem: string
  usuario_upload?: string
  usuario_email?: string
  desfecho: string
  total_divergencias: number
  total_ressalvas_c5: number
  snapshot_comparativo: SnapshotComparativoAuditoria
  ressalvas_marcadas?: string[] // IDs dos itens marcados como ressalva
  observacoes?: string
  created: string
  updated: string
  expand?: {
    empreendimento?: {
      nome_empreendimento?: string
      razao_social?: string
      cnpj?: string
    }
    apolice?: {
      numero_apolice?: string
      seguradora?: string
      ramo?: string
      status?: string
    }
  }
}

function calcDesvio(
  valOrigem: number | null,
  valFinal: number | null,
): { dif: number | null; pct: number | null } {
  if (valOrigem === null || valFinal === null) return { dif: null, pct: null }
  const dif = valFinal - valOrigem
  if (valOrigem === 0) {
    return { dif, pct: valFinal > 0 ? 100 : 0 }
  }
  const pct = (dif / valOrigem) * 100
  return { dif, pct: Math.round(pct * 100) / 100 }
}

/**
 * Constrói a comparação estruturada completa entre o Cartão de Risco e a Apólice (com suas Coberturas)
 */
export function buildAuditoriaSnapshot(
  card: RiskCardData,
  apoliceRecord: Record<string, unknown> | null,
  coberturasApolice: Array<Record<string, unknown>>,
  options?: {
    produtoCartao?: string
    ramoCanonicaCartao?: string
    ressalvasIniciais?: string[]
  },
): SnapshotComparativoAuditoria {
  const apolice = apoliceRecord || {}

  // 1. IDENTIFICAÇÃO
  const idCartao = {
    segurado: card.segurado || '',
    cnpj: card.cnpj || '',
    seguradora: card.seguradoraAnterior || 'A Cotar',
    numeroReferencia: card.numeroApoliceAnterior || 'Cartão de Risco',
    vigenciaInicio: card.vigenciaInicio || '',
    vigenciaFim: card.vigenciaFim || '',
    ramo:
      options?.ramoCanonicaCartao ||
      options?.produtoCartao ||
      card.tipoCobertura ||
      'Riscos Nomeados',
    premioTotal: null as number | null,
    premioLiquido: null as number | null,
  }

  const idApolice = {
    segurado: String(apolice.segurado_na_apolice || ''),
    cnpj: String(apolice.cnpj_segurado || ''),
    seguradora: String(apolice.seguradora || ''),
    numeroApolice: String(apolice.numero_apolice || apolice.id_apolice || '—'),
    vigenciaInicio: String(apolice.data_inicio || ''),
    vigenciaFim: String(apolice.data_fim || ''),
    ramo: String(apolice.ramo || ''),
    premioTotal: typeof apolice.premio_total === 'number' ? apolice.premio_total : null,
    premioLiquido: typeof apolice.premio_liquido === 'number' ? apolice.premio_liquido : null,
    status: String(apolice.status || 'ativa'),
  }

  const divergenciasIdentificacao: Array<{
    campo: string
    valorCartao: string
    valorApolice: string
    descricao: string
  }> = []

  // Valida divergências de identificação
  if (idCartao.seguradora && idApolice.seguradora && idCartao.seguradora !== 'A Cotar') {
    const s1 = idCartao.seguradora.trim().toLowerCase()
    const s2 = idApolice.seguradora.trim().toLowerCase()
    if (s1 !== s2 && !s1.includes(s2) && !s2.includes(s1)) {
      divergenciasIdentificacao.push({
        campo: 'Seguradora',
        valorCartao: idCartao.seguradora,
        valorApolice: idApolice.seguradora,
        descricao: `Seguradora no Cartão (${idCartao.seguradora}) diverge da Seguradora na Apólice (${idApolice.seguradora}).`,
      })
    }
  }

  if (
    idCartao.vigenciaInicio &&
    idApolice.vigenciaInicio &&
    idCartao.vigenciaInicio !== idApolice.vigenciaInicio
  ) {
    divergenciasIdentificacao.push({
      campo: 'Início de Vigência',
      valorCartao: idCartao.vigenciaInicio,
      valorApolice: idApolice.vigenciaInicio,
      descricao: `Início de vigência solicitado (${idCartao.vigenciaInicio}) diverge da apólice (${idApolice.vigenciaInicio}).`,
    })
  }

  if (
    idCartao.vigenciaFim &&
    idApolice.vigenciaFim &&
    idCartao.vigenciaFim !== idApolice.vigenciaFim
  ) {
    divergenciasIdentificacao.push({
      campo: 'Término de Vigência',
      valorCartao: idCartao.vigenciaFim,
      valorApolice: idApolice.vigenciaFim,
      descricao: `Término de vigência no Cartão (${idCartao.vigenciaFim}) diverge da apólice (${idApolice.vigenciaFim}).`,
    })
  }

  const cardCnpjClean = idCartao.cnpj.replace(/\D/g, '')
  const apCnpjClean = idApolice.cnpj.replace(/\D/g, '')
  if (cardCnpjClean && apCnpjClean && cardCnpjClean !== apCnpjClean) {
    divergenciasIdentificacao.push({
      campo: 'CNPJ do Segurado',
      valorCartao: idCartao.cnpj,
      valorApolice: idApolice.cnpj,
      descricao: `CNPJ informado no Cartão (${idCartao.cnpj}) difere do constante na Apólice (${idApolice.cnpj}).`,
    })
  }

  // 2. COBERTURAS LINHA A LINHA CASADAS PELA CATEGORIA NORMALIZADA
  // Normaliza coberturas do Cartão
  interface CardCobItem {
    id: string
    nomeOriginal: string
    categoriaNormalizada: string
    lmi: number | null
    franquia: string
    observacao: string
  }

  const cardCobItems: CardCobItem[] = []
  card.coberturas.forEach((c, idx) => {
    const lmi = c.isEscolhida ?? c.isAtualizada ?? c.isAtual ?? null
    const cat = c.categoriaNormalizada || matchCanonicalCategory(c.nomeOriginal)
    // Incluir se tiver LMI ou se tiver nome válido
    cardCobItems.push({
      id: `cartao_cob_${idx}_${cat.replace(/\s+/g, '_')}`,
      nomeOriginal: c.nomeOriginal,
      categoriaNormalizada: cat,
      lmi,
      franquia: '',
      observacao: c.observacao || '',
    })
  })

  // Normaliza coberturas da Apólice
  interface ApCobItem {
    id: string
    nomeOriginal: string
    categoriaNormalizada: string
    lmi: number | null
    franquia: string
    premio: number | null
  }

  const apCobItems: ApCobItem[] = []
  coberturasApolice.forEach((c, idx) => {
    const nome = String(c.nome_cobertura || '')
    const cat = String(c.categoria_normalizada || matchCanonicalCategory(nome))
    const lmi = typeof c.lmi_rs === 'number' ? c.lmi_rs : null
    const franquia = String(c.franquia_pos || '')
    const premio = typeof c.premio_cobertura === 'number' ? c.premio_cobertura : null
    apCobItems.push({
      id: String(c.id || `ap_cob_${idx}`),
      nomeOriginal: nome,
      categoriaNormalizada: cat,
      lmi,
      franquia,
      premio,
    })
  })

  // Agrupa coberturas por categoria normalizada
  const cardByCat = new Map<string, CardCobItem[]>()
  for (const item of cardCobItems) {
    const arr = cardByCat.get(item.categoriaNormalizada) || []
    arr.push(item)
    cardByCat.set(item.categoriaNormalizada, arr)
  }

  const apByCat = new Map<string, ApCobItem[]>()
  for (const item of apCobItems) {
    const arr = apByCat.get(item.categoriaNormalizada) || []
    arr.push(item)
    apByCat.set(item.categoriaNormalizada, arr)
  }

  const allCategories = new Set<string>([...cardByCat.keys(), ...apByCat.keys()])
  const casadas: ItemAuditoriaComparativo[] = []
  const soNoCartao: ItemAuditoriaComparativo[] = []
  const soNaApolice: ItemAuditoriaComparativo[] = []

  let itemCounter = 0
  const ressalvasSet = new Set(options?.ressalvasIniciais || [])

  for (const cat of allCategories) {
    const cItems = cardByCat.get(cat) || []
    const aItems = apByCat.get(cat) || []

    if (cItems.length > 0 && aItems.length > 0) {
      // Casadas (pode haver mais de uma no mesmo grupo, pareamos 1:1)
      const maxCount = Math.max(cItems.length, aItems.length)
      for (let i = 0; i < maxCount; i++) {
        itemCounter++
        const ci = cItems[i]
        const ai = aItems[i]

        if (ci && ai) {
          const lmiC = ci.lmi
          const lmiA = ai.lmi
          const { dif, pct } = calcDesvio(lmiC, lmiA)
          // Divergência se diferença absoluta de LMI > 100 reais ou franquias diferentes
          const divergenteLmi =
            lmiC !== null && lmiA !== null && Math.abs((lmiC || 0) - (lmiA || 0)) > 100
          const itemId = `item_casada_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`

          let motivo = ''
          if (divergenteLmi) {
            motivo = `LMI no Cartão é ${formatCurrency(lmiC)} vs ${formatCurrency(lmiA)} na Apólice (desvio de ${pct}%).`
          }

          const isCandidato =
            ressalvasSet.has(itemId) || (divergenteLmi && pct !== null && Math.abs(pct) >= 1)

          casadas.push({
            id: itemId,
            categoriaNormalizada: cat,
            nomeCartao: ci.nomeOriginal,
            nomeApolice: ai.nomeOriginal,
            lmiCartao: lmiC,
            lmiApolice: lmiA,
            franquiaCartao: ci.franquia,
            franquiaApolice: ai.franquia,
            diferencaLmi: dif,
            percentualDesvio: pct,
            tipo: 'casada',
            divergente: divergenteLmi,
            candidatoRessalvaC5: isCandidato,
            motivoDivergencia: motivo,
          })
        } else if (ci && !ai) {
          const itemId = `item_socartao_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`
          soNoCartao.push({
            id: itemId,
            categoriaNormalizada: cat,
            nomeCartao: ci.nomeOriginal,
            lmiCartao: ci.lmi,
            lmiApolice: null,
            franquiaCartao: ci.franquia,
            franquiaApolice: '—',
            diferencaLmi: ci.lmi ? -ci.lmi : null,
            percentualDesvio: -100,
            tipo: 'so_cartao',
            divergente: true,
            candidatoRessalvaC5: ressalvasSet.has(itemId) || Boolean(ci.lmi && ci.lmi > 0),
            motivoDivergencia:
              'Cobertura solicitada no Cartão de Risco não consta na Apólice emitida.',
          })
        } else if (!ci && ai) {
          const itemId = `item_soapolice_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`
          soNaApolice.push({
            id: itemId,
            categoriaNormalizada: cat,
            nomeApolice: ai.nomeOriginal,
            lmiCartao: null,
            lmiApolice: ai.lmi,
            franquiaCartao: '—',
            franquiaApolice: ai.franquia,
            diferencaLmi: ai.lmi,
            percentualDesvio: 100,
            tipo: 'so_apolice',
            divergente: true,
            candidatoRessalvaC5: ressalvasSet.has(itemId) || false,
            motivoDivergencia:
              'Cobertura emitida na apólice não constava no Cartão de Risco de origem.',
          })
        }
      }
    } else if (cItems.length > 0) {
      for (const ci of cItems) {
        itemCounter++
        const itemId = `item_socartao_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`
        soNoCartao.push({
          id: itemId,
          categoriaNormalizada: cat,
          nomeCartao: ci.nomeOriginal,
          lmiCartao: ci.lmi,
          lmiApolice: null,
          franquiaCartao: ci.franquia,
          franquiaApolice: '—',
          diferencaLmi: ci.lmi ? -ci.lmi : null,
          percentualDesvio: -100,
          tipo: 'so_cartao',
          divergente: true,
          candidatoRessalvaC5: ressalvasSet.has(itemId) || Boolean(ci.lmi && ci.lmi > 0),
          motivoDivergencia:
            'Cobertura solicitada no Cartão de Risco não consta na Apólice emitida.',
        })
      }
    } else if (aItems.length > 0) {
      for (const ai of aItems) {
        itemCounter++
        const itemId = `item_soapolice_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`
        soNaApolice.push({
          id: itemId,
          categoriaNormalizada: cat,
          nomeApolice: ai.nomeOriginal,
          lmiCartao: null,
          lmiApolice: ai.lmi,
          franquiaCartao: '—',
          franquiaApolice: ai.franquia,
          diferencaLmi: ai.lmi,
          percentualDesvio: 100,
          tipo: 'so_apolice',
          divergente: true,
          candidatoRessalvaC5: ressalvasSet.has(itemId) || false,
          motivoDivergencia:
            'Cobertura emitida na apólice não constava no Cartão de Risco de origem.',
        })
      }
    }
  }

  // 3. VRD POR RUBRICA
  const vrdRubricas: RubricaVrdItem[] = []

  // (a) Danos Materiais (Prédio)
  const vrdPredioCard = card.vrd.predioAtualizado || card.vrd.predioAtual || null
  // (b) Danos Materiais MMU / MMP / Conteúdo
  const vrdConteudoCard =
    (card.vrd.danoMaterialMmuAtualizado || card.vrd.danoMaterialMmuAtual || 0) +
      (card.vrd.mmpAtualizado || card.vrd.mmpAtual || 0) || null
  // (c) VRD Total Danos Materiais
  const vrdDmCard =
    card.vrd.totalAtualizado ||
    card.vrd.totalAtual ||
    (vrdPredioCard || 0) + (vrdConteudoCard || 0) ||
    null
  const vrdDmApolice =
    typeof apolice.valor_em_risco_dm === 'number' ? apolice.valor_em_risco_dm : null
  const desvioDm = calcDesvio(vrdDmCard, vrdDmApolice)
  vrdRubricas.push({
    rubrica: 'VRD Danos Materiais (DM)',
    valorCartao: vrdDmCard,
    valorApolice: vrdDmApolice,
    diferenca: desvioDm.dif,
    percentualDesvio: desvioDm.pct,
    divergente: desvioDm.dif !== null && Math.abs(desvioDm.dif) > 1000,
  })

  // (d) Lucros Cessantes
  const vrdLcCard = card.vrd.lucrosCessantesAtualizado || card.vrd.lucrosCessantesAtual || null
  const vrdLcApolice =
    typeof apolice.valor_em_risco_lc === 'number' ? apolice.valor_em_risco_lc : null
  const desvioLc = calcDesvio(vrdLcCard, vrdLcApolice)
  vrdRubricas.push({
    rubrica: 'VRD Lucros Cessantes (LC / Despesas Fixas)',
    valorCartao: vrdLcCard,
    valorApolice: vrdLcApolice,
    diferenca: desvioLc.dif,
    percentualDesvio: desvioLc.pct,
    divergente: desvioLc.dif !== null && Math.abs(desvioLc.dif) > 1000,
  })

  // (e) VRD Total Geral (DM + LC)
  const vrdTotalCard =
    card.vrd.vrdTotalAtualizado ||
    card.vrd.vrdTotalAtual ||
    (vrdDmCard || 0) + (vrdLcCard || 0) ||
    null
  const vrdTotalApolice =
    vrdDmApolice !== null || vrdLcApolice !== null
      ? (vrdDmApolice || 0) + (vrdLcApolice || 0)
      : null
  const desvioTotal = calcDesvio(vrdTotalCard, vrdTotalApolice)
  vrdRubricas.push({
    rubrica: 'VRD Total Consolidado (DM + LC)',
    valorCartao: vrdTotalCard,
    valorApolice: vrdTotalApolice,
    diferenca: desvioTotal.dif,
    percentualDesvio: desvioTotal.pct,
    divergente: desvioTotal.dif !== null && Math.abs(desvioTotal.dif) > 1000,
  })

  // (f) LMI Básica de Incêndio
  const lmiBasicaCard =
    card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isEscolhida ??
    card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isAtualizada ??
    card.coberturas.find((c) => c.categoriaNormalizada.includes('Incêndio'))?.isAtual ??
    vrdDmCard
  const lmiBasicaApolice =
    typeof apolice.lmi_incendio_basica === 'number'
      ? apolice.lmi_incendio_basica
      : coberturasApolice.find((c) => String(c.categoria_normalizada || '').includes('Incêndio'))
            ?.lmi_rs &&
          typeof coberturasApolice.find((c) =>
            String(c.categoria_normalizada || '').includes('Incêndio'),
          )?.lmi_rs === 'number'
        ? (coberturasApolice.find((c) => String(c.categoria_normalizada || '').includes('Incêndio'))
            ?.lmi_rs as number)
        : null
  const desvioBasica = calcDesvio(lmiBasicaCard, lmiBasicaApolice)
  vrdRubricas.push({
    rubrica: 'LMI Básica de Incêndio',
    valorCartao: lmiBasicaCard,
    valorApolice: lmiBasicaApolice,
    diferenca: desvioBasica.dif,
    percentualDesvio: desvioBasica.pct,
    divergente: desvioBasica.dif !== null && Math.abs(desvioBasica.dif) > 1000,
  })

  // 4. PRÊMIOS
  const premioLiqApolice =
    typeof apolice.premio_liquido === 'number' ? apolice.premio_liquido : null
  const premioTotApolice = typeof apolice.premio_total === 'number' ? apolice.premio_total : null
  const premiosComparativo = {
    premioLiquidoCartao: null as number | null,
    premioLiquidoApolice: premioLiqApolice,
    premioTotalCartao: null as number | null,
    premioTotalApolice: premioTotApolice,
    diferencaLiquido: null as number | null,
    diferencaTotal: null as number | null,
    divergente: false,
  }

  // 5. SINISTROS
  const sinistrosComparativo = {
    totalCartao: card.sinistros.length,
    totalApolice: 0,
    itensCartao: card.sinistros.map((s) => ({
      ano: s.ano,
      cobertura: s.cobertura,
      descricao: s.descricao,
      valor: s.valorIndenizado,
    })),
  }

  // Totais de divergências e ressalvas
  const totalDiv =
    divergenciasIdentificacao.length +
    casadas.filter((c) => c.divergente).length +
    soNoCartao.length +
    soNaApolice.length +
    vrdRubricas.filter((r) => r.divergente).length

  const totalRessalvas =
    casadas.filter((c) => c.candidatoRessalvaC5).length +
    soNoCartao.filter((c) => c.candidatoRessalvaC5).length +
    soNaApolice.filter((c) => c.candidatoRessalvaC5).length

  return {
    identificacao: {
      cartao: idCartao,
      apolice: idApolice,
      divergenciasIdentificacao,
    },
    coberturas: {
      casadas,
      soNoCartao,
      soNaApolice,
      totalDivergencias:
        casadas.filter((c) => c.divergente).length + soNoCartao.length + soNaApolice.length,
      totalCandidatosRessalvaC5: totalRessalvas,
    },
    vrdPorRubrica: vrdRubricas,
    premios: premiosComparativo,
    sinistros: sinistrosComparativo,
  }
}

/**
 * Salva uma nova rodada de auditoria no PocketBase, preservando o histórico de rodadas anteriores
 */
export async function createAuditoriaRodada(params: {
  empreendimentoId: string
  apoliceId?: string
  produtoRamo: string
  arquivoOrigem: string
  usuarioId?: string
  usuarioEmail?: string
  desfecho: string
  snapshot: SnapshotComparativoAuditoria
  observacoes?: string
}): Promise<AuditoriaRodadaRecord> {
  // 1. Determina próximo número de rodada para este empreendimento + apólice
  let nextRodada = 1
  try {
    const filter = params.apoliceId
      ? `empreendimento="${params.empreendimentoId}" && apolice="${params.apoliceId}"`
      : `empreendimento="${params.empreendimentoId}"`
    const prevRodadas = await pb.collection('auditoria_rodadas').getFullList({
      filter,
      sort: '-numero_rodada',
      limit: 1,
    })
    if (prevRodadas.length > 0 && typeof prevRodadas[0].numero_rodada === 'number') {
      nextRodada = prevRodadas[0].numero_rodada + 1
    }
  } catch (err) {
    console.warn('Não foi possível verificar rodada anterior, iniciando em 1:', err)
  }

  // 2. Extrai IDs marcados como candidatos a ressalva C5
  const ressalvasIniciais: string[] = []
  const { coberturas } = params.snapshot
  coberturas.casadas.forEach((c) => {
    if (c.candidatoRessalvaC5) ressalvasIniciais.push(c.id)
  })
  coberturas.soNoCartao.forEach((c) => {
    if (c.candidatoRessalvaC5) ressalvasIniciais.push(c.id)
  })
  coberturas.soNaApolice.forEach((c) => {
    if (c.candidatoRessalvaC5) ressalvasIniciais.push(c.id)
  })

  const totalDivergencias =
    params.snapshot.identificacao.divergenciasIdentificacao.length +
    params.snapshot.coberturas.totalDivergencias +
    params.snapshot.vrdPorRubrica.filter((r) => r.divergente).length

  const payload = {
    empreendimento: params.empreendimentoId,
    apolice: params.apoliceId || null,
    numero_rodada: nextRodada,
    data_rodada: new Date().toISOString().slice(0, 10),
    produto_ramo: params.produtoRamo,
    arquivo_origem: params.arquivoOrigem,
    usuario_upload: params.usuarioId || null,
    usuario_email: params.usuarioEmail || '',
    desfecho: params.desfecho,
    total_divergencias: totalDivergencias,
    total_ressalvas_c5: ressalvasIniciais.length,
    snapshot_comparativo: params.snapshot,
    ressalvas_marcadas: ressalvasIniciais,
    observacoes: params.observacoes || '',
  }

  const record = await pb.collection('auditoria_rodadas').create(payload)
  return record as unknown as AuditoriaRodadaRecord
}

/**
 * Atualiza os itens candidatos a ressalva C5 de uma rodada existente
 */
export async function toggleItemRessalvaC5(
  rodadaId: string,
  itemId: string,
  marcado: boolean,
): Promise<AuditoriaRodadaRecord> {
  const current = (await pb
    .collection('auditoria_rodadas')
    .getOne(rodadaId)) as unknown as AuditoriaRodadaRecord
  const snap = current.snapshot_comparativo
  const ressalvasAtuais = new Set(current.ressalvas_marcadas || [])

  if (marcado) {
    ressalvasAtuais.add(itemId)
  } else {
    ressalvasAtuais.delete(itemId)
  }

  // Atualiza também flag no snapshot para consistência de visualização
  const updateList = (list: ItemAuditoriaComparativo[]) => {
    for (const item of list) {
      if (item.id === itemId) {
        item.candidatoRessalvaC5 = marcado
      }
    }
  }
  updateList(snap.coberturas.casadas)
  updateList(snap.coberturas.soNoCartao)
  updateList(snap.coberturas.soNaApolice)

  snap.coberturas.totalCandidatosRessalvaC5 = ressalvasAtuais.size

  const updated = await pb.collection('auditoria_rodadas').update(rodadaId, {
    ressalvas_marcadas: Array.from(ressalvasAtuais),
    total_ressalvas_c5: ressalvasAtuais.size,
    snapshot_comparativo: snap,
  })

  return updated as unknown as AuditoriaRodadaRecord
}
