import pb from '@/lib/pocketbase/client'
import { CATEGORIAS_48, formatCurrency } from '@/lib/formatters'
import { matchCanonicalCategory, RiskCardData } from '@/services/riskCardReader'
import { normalizarRamoParaSucessao } from '@/services/apoliceStatusService'
import {
  compararFranquiasEstruturadas,
  parseFranquiaEstruturada,
  formatFranquiaPadrao,
} from '@/services/franquiaNormalizer'
import {
  casarCoberturaComCanonica,
  derivarEventosTipicosPadrao,
  eventosSaoEquivalentes,
  normalizarTermoEquivalencia,
  calcularSimilaridadeTexto,
  listarTaxonomiaCanonicas,
  listarSinonimos,
  CoberturaCanonicaRecord,
  CoberturaSinonimoRecord,
  CoverageMatchResult,
} from '@/services/equivalenciaCoberturasService'

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
  lmiApoliceCorrespondente?: number | null
  nomeApoliceCorrespondente?: string
  franquiaApoliceCorrespondente?: string
  correspondenciaEncontrada?: boolean
  motivoCorrespondencia?: string
}

export interface CorrespondenciaApoliceLmi {
  temCorrespondencia: boolean
  lmiApolice: number | null
  lmiTexto: string
  nomeApolice?: string
  franquiaApolice?: string
  detalhe?: string
  tipoEquivalencia?: 'sinonimo' | 'canonica' | 'evento' | 'similaridade'
}

/**
 * Encontra correspondência da cobertura do cartão com a cobertura da apólice
 * reaproveitando o leitor de equivalência existente (sinônimos, canônicas,
 * comparação estruturada por eventos típicos e similaridade semântica).
 */
export function encontrarLmiApoliceCorrespondente(
  itemCartao: {
    nomeCartao?: string
    categoriaNormalizada?: string
    lmiCartao?: number | null
  },
  candidatosApolice: Array<{
    nomeApolice?: string
    nome_cobertura?: string
    categoriaNormalizada?: string
    categoria_normalizada?: string
    lmiApolice?: number | null
    lmi_rs?: number | null
    franquiaApolice?: string
    franquia_pos?: string
  }>,
  options?: {
    seguradora?: string
    canonicas?: CoberturaCanonicaRecord[]
    sinonimos?: CoberturaSinonimoRecord[]
  },
): CorrespondenciaApoliceLmi {
  const nomeCartao = itemCartao.nomeCartao?.trim() || itemCartao.categoriaNormalizada?.trim() || ''
  if (!nomeCartao || candidatosApolice.length === 0) {
    return { temCorrespondencia: false, lmiApolice: null, lmiTexto: 'sem correspondência' }
  }

  const canonicas = options?.canonicas || []
  const sinonimos = options?.sinonimos || []
  const seguradora = options?.seguradora || ''

  // 1. Match Canônico / Sinônimo usando o leitor de equivalência
  let matchCartao: CoverageMatchResult | null = null
  if (canonicas.length > 0 || sinonimos.length > 0) {
    matchCartao = casarCoberturaComCanonica(nomeCartao, seguradora, canonicas, sinonimos)
  }

  // Eventos derivados da cobertura do cartão (preservando comparação por evento)
  const eventosCartao = matchCartao?.eventosEfetivos?.length
    ? matchCartao.eventosEfetivos
    : derivarEventosTipicosPadrao(nomeCartao)

  // 0. PRIORIDADE: CATEGORIA NORMALIZADA EXATA (regra de produto permanente)
  //    Quando o Cartão traz uma categoria normalizada válida e existe cobertura na
  //    apólice com a MESMA categoria, o casamento é essa cobertura — nunca uma
  //    cobertura de outra categoria (ex.: nunca casar "Bens de Hóspedes" com
  //    "Valores em Trânsito" só porque os eventos de roubo se sobrepõem).
  //    Similaridade de texto e eventos são apenas FALLBACK para quando não há
  //    candidata na categoria exata.
  const catCartao = itemCartao.categoriaNormalizada?.trim() || ''
  const catNorm = (v: string | undefined | null) => (v || '').trim().toLowerCase()
  if (catCartao) {
    const mesmaCategoria = candidatosApolice.filter((cand) => {
      const catAp = catNorm(cand.categoriaNormalizada || cand.categoria_normalizada)
      return catAp !== '' && catAp === catNorm(catCartao)
    })
    if (mesmaCategoria.length > 0) {
      // Desempate dentro da categoria exata: maior similaridade textual; LMI mais
      // próxima como critério secundário. Sem nome no cartão, fica a primeira.
      let escolhida = mesmaCategoria[0]
      let melhorTie = -1
      for (const cand of mesmaCategoria) {
        const nomeAp = (
          cand.nomeApolice ||
          cand.nome_cobertura ||
          cand.categoriaNormalizada ||
          cand.categoria_normalizada ||
          ''
        ).trim()
        const tieTexto = nomeCartao && nomeAp ? calcularSimilaridadeTexto(nomeCartao, nomeAp) : 0
        const lmiAp =
          typeof cand.lmiApolice === 'number'
            ? cand.lmiApolice
            : typeof cand.lmi_rs === 'number'
              ? cand.lmi_rs
              : null
        const tieLmi =
          tieTexto > 0 && lmiAp !== null && typeof itemCartao.lmiCartao === 'number'
            ? 1 - Math.min(Math.abs((lmiAp - (itemCartao.lmiCartao || 0)) / 100000), 1)
            : 0
        const score = tieTexto + tieLmi
        if (score > melhorTie) {
          melhorTie = score
          escolhida = cand
        }
      }
      const lmi =
        typeof escolhida.lmiApolice === 'number'
          ? escolhida.lmiApolice
          : typeof escolhida.lmi_rs === 'number'
            ? escolhida.lmi_rs
            : null
      const nome =
        escolhida.nomeApolice || escolhida.nome_cobertura || escolhida.categoriaNormalizada
      const franquiaCrua = escolhida.franquiaApolice || escolhida.franquia_pos || ''
      const franquiaFormatada = franquiaCrua
        ? formatFranquiaPadrao(parseFranquiaEstruturada(franquiaCrua))
        : ''
      return {
        temCorrespondencia: true,
        lmiApolice: lmi,
        lmiTexto: lmi !== null ? formatCurrency(lmi) : 'R$ 0,00',
        nomeApolice: nome,
        franquiaApolice: franquiaFormatada || franquiaCrua,
        detalhe: `Correspondência por categoria normalizada exata: ${catCartao}`,
        tipoEquivalencia: 'canonica',
      }
    }
  }

  let melhorCandidato: (typeof candidatosApolice)[0] | null = null
  let melhorScore = 0
  let tipoEquiv: 'sinonimo' | 'canonica' | 'evento' | 'similaridade' = 'similaridade'
  let detalhe = ''

  for (const cand of candidatosApolice) {
    const nomeAp = (
      cand.nomeApolice ||
      cand.nome_cobertura ||
      cand.categoriaNormalizada ||
      cand.categoria_normalizada ||
      ''
    ).trim()
    if (!nomeAp) continue

    // (A) Match por Sinônimo / Canônica
    if (canonicas.length > 0 || sinonimos.length > 0) {
      const matchAp = casarCoberturaComCanonica(nomeAp, seguradora, canonicas, sinonimos)
      if (
        matchCartao &&
        matchCartao.matchType !== 'nao_mapeada' &&
        matchAp.matchType !== 'nao_mapeada'
      ) {
        if (
          (matchCartao.canonicaId && matchCartao.canonicaId === matchAp.canonicaId) ||
          normalizarTermoEquivalencia(matchCartao.canonica) ===
            normalizarTermoEquivalencia(matchAp.canonica)
        ) {
          melhorCandidato = cand
          tipoEquiv = matchCartao.matchType.startsWith('sinonimo') ? 'sinonimo' : 'canonica'
          detalhe = `Equivalência por taxonomia canônica: ${matchCartao.canonica}`
          break
        }
      }
    }

    // (B) Comparação por EVENTOS estruturados (comparar por evento, pacotes de eventos)
    const eventosAp = derivarEventosTipicosPadrao(nomeAp)
    if (eventosCartao.length > 0 && eventosAp.length > 0) {
      let eventosCasados = 0
      for (const evC of eventosCartao) {
        if (eventosAp.some((evA) => eventosSaoEquivalentes(evC, evA))) {
          eventosCasados++
        }
      }
      const scoreEventos = eventosCasados / Math.max(eventosCartao.length, eventosAp.length)
      if (scoreEventos >= 0.4 && scoreEventos > melhorScore) {
        melhorScore = scoreEventos
        melhorCandidato = cand
        tipoEquiv = 'evento'
        detalhe = `Correspondência por eventos estruturados (${Math.round(scoreEventos * 100)}% de eventos comuns)`
      }
    }

    // (C) Match por similaridade textual semântica
    const scoreTexto = calcularSimilaridadeTexto(nomeCartao, nomeAp)
    if (scoreTexto >= 0.65 && scoreTexto > melhorScore) {
      melhorScore = scoreTexto
      melhorCandidato = cand
      tipoEquiv = 'similaridade'
      detalhe = `Correspondência por similaridade de nomenclatura (${Math.round(scoreTexto * 100)}%)`
    }
  }

  if (melhorCandidato) {
    const lmi =
      typeof melhorCandidato.lmiApolice === 'number'
        ? melhorCandidato.lmiApolice
        : typeof melhorCandidato.lmi_rs === 'number'
          ? melhorCandidato.lmi_rs
          : null

    const nome =
      melhorCandidato.nomeApolice ||
      melhorCandidato.nome_cobertura ||
      melhorCandidato.categoriaNormalizada
    const franquiaCrua = melhorCandidato.franquiaApolice || melhorCandidato.franquia_pos || ''
    const franquiaFormatada = franquiaCrua
      ? formatFranquiaPadrao(parseFranquiaEstruturada(franquiaCrua))
      : ''

    return {
      temCorrespondencia: true,
      lmiApolice: lmi,
      lmiTexto: lmi !== null ? formatCurrency(lmi) : 'R$ 0,00',
      nomeApolice: nome,
      franquiaApolice: franquiaFormatada || franquiaCrua,
      detalhe,
      tipoEquivalencia: tipoEquiv,
    }
  }

  return {
    temCorrespondencia: false,
    lmiApolice: null,
    lmiTexto: 'sem correspondência',
  }
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
  apolice_referencia_real?: string
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
      data_inicio?: string
      data_fim?: string
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
    canonicas?: CoberturaCanonicaRecord[]
    sinonimos?: CoberturaSinonimoRecord[]
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

  // Candidatas a "correspondência de fallback" para itens só-no-cartão (REGRA DE
  // PRODUTO): só coberturas da apólice cuja categoria NÃO tenha representante do
  // cartão naquele grupo. Se a categoria da cobertura da apólice tem item do cartão
  // (casado em outro grupo), não pode servir de correspondência — casar
  // "Bens de Hóspedes" com "Valores em Trânsito" é o falso positivo do Anália.
  const categoriasComRepresentanteCartao = new Set<string>()
  for (const item of cardCobItems)
    categoriasComRepresentanteCartao.add((item.categoriaNormalizada || '').trim().toLowerCase())
  const candidatosFallbackApolice = apCobItems
    .filter(
      (a) =>
        !categoriasComRepresentanteCartao.has((a.categoriaNormalizada || '').trim().toLowerCase()),
    )
    .map((a) => ({
      nomeApolice: a.nomeOriginal,
      categoriaNormalizada: a.categoriaNormalizada,
      lmiApolice: a.lmi,
      franquiaApolice: a.franquia,
    }))

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
      // Pareamento DENTRO da categoria: cada item do cartão casa com a cobertura da
      // apólice mais parecida ainda não usada (similaridade de texto, desempate por
      // LMI mais próxima) — nunca 1:1 cega por índice.
      const aItemsDisponiveis = [...aItems]
      for (let i = 0; i < cItems.length; i++) {
        itemCounter++
        let ci = cItems[i]
        let ai: ApCobItem | undefined
        if (aItemsDisponiveis.length > 0) {
          let melhorIdx = 0
          let melhorScore = -1
          for (let j = 0; j < aItemsDisponiveis.length; j++) {
            const cand = aItemsDisponiveis[j]
            const sim = calcularSimilaridadeTexto(ci.nomeOriginal, cand.nomeOriginal)
            const lmiAp = cand.lmi
            const lmiC = ci.lmi
            const proxLmi =
              lmiAp !== null && lmiC !== null && lmiAp > 0
                ? 1 - Math.min(Math.abs((lmiAp - lmiC) / 100000), 1)
                : 0
            const score = sim * 2 + proxLmi
            if (score > melhorScore) {
              melhorScore = score
              melhorIdx = j
            }
          }
          ai = aItemsDisponiveis.splice(melhorIdx, 1)[0]
        }

        if (ci && ai) {
          const lmiC = ci.lmi
          const lmiA = ai.lmi
          const { dif, pct } = calcDesvio(lmiC, lmiA)
          // Divergência se diferença absoluta de LMI > 100 reais ou franquias divergentes via comparador estruturado
          const divergenteLmi =
            lmiC !== null && lmiA !== null && Math.abs((lmiC || 0) - (lmiA || 0)) > 100

          // Regra de produto: o Cartão de Risco NUNCA tem franquia — é um documento
          // preenchido pelo segurado, preocupado apenas com cobertura e LMI. Quando a
          // franquia do lado do cartão está vazia/ausente, a franquia da apólice é
          // apenas INFORMATIVA: não gera divergência nem pré-marca Ressalva C5.
          // O comparador estruturado continua valendo quando o cartão traz franquia preenchida.
          const franquiaCartaoPreenchida =
            Boolean(ci.franquia && ci.franquia.trim()) &&
            parseFranquiaEstruturada(ci.franquia).tipo !== 'nao_ha'
          const compFranquia = compararFranquiasEstruturadas(ci.franquia, ai.franquia)
          const divergenteFranquia = franquiaCartaoPreenchida && !compFranquia.equivalentes

          const isDivergenteGeral = divergenteLmi || divergenteFranquia

          const itemId = `item_casada_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`

          const motivos: string[] = []
          if (divergenteLmi) {
            motivos.push(
              `LMI no Cartão é ${formatCurrency(lmiC)} vs ${formatCurrency(lmiA)} na Apólice (desvio de ${pct}%).`,
            )
          }
          if (divergenteFranquia && compFranquia.motivo) {
            motivos.push(compFranquia.motivo)
          }
          const motivo = motivos.join(' ')

          const isCandidato =
            ressalvasSet.has(itemId) ||
            (divergenteLmi && pct !== null && Math.abs(pct) >= 1) ||
            (divergenteFranquia && compFranquia.divergenciaGravidade === 'critica')

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
            divergente: isDivergenteGeral,
            candidatoRessalvaC5: isCandidato,
            motivoDivergencia: motivo,
          })
        } else if (ci && !ai) {
          const itemId = `item_socartao_${itemCounter}_${cat.replace(/[^a-zA-Z0-9]/g, '_')}`
          const correspondencia = encontrarLmiApoliceCorrespondente(
            {
              nomeCartao: ci.nomeOriginal,
              categoriaNormalizada: cat,
              lmiCartao: ci.lmi,
            },
            candidatosFallbackApolice.map((a) => ({ ...a })),
            {
              seguradora: String(apolice.seguradora || ''),
              canonicas: options?.canonicas,
              sinonimos: options?.sinonimos,
            },
          )
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
            lmiApoliceCorrespondente: correspondencia.temCorrespondencia
              ? correspondencia.lmiApolice
              : null,
            nomeApoliceCorrespondente: correspondencia.nomeApolice,
            franquiaApoliceCorrespondente: correspondencia.franquiaApolice,
            correspondenciaEncontrada: correspondencia.temCorrespondencia,
            motivoCorrespondencia: correspondencia.detalhe,
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
        const correspondencia = encontrarLmiApoliceCorrespondente(
          {
            nomeCartao: ci.nomeOriginal,
            categoriaNormalizada: cat,
            lmiCartao: ci.lmi,
          },
          candidatosFallbackApolice.map((a) => ({ ...a })),
          {
            seguradora: String(apolice.seguradora || ''),
            canonicas: options?.canonicas,
            sinonimos: options?.sinonimos,
          },
        )
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
          lmiApoliceCorrespondente: correspondencia.temCorrespondencia
            ? correspondencia.lmiApolice
            : null,
          nomeApoliceCorrespondente: correspondencia.nomeApolice,
          franquiaApoliceCorrespondente: correspondencia.franquiaApolice,
          correspondenciaEncontrada: correspondencia.temCorrespondencia,
          motivoCorrespondencia: correspondencia.detalhe,
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
 * Determina a apólice de referência REAL do comparativo (apólice do ciclo atual EMITIDA,
 * nunca o registro prospect criado pelo próprio Cartão de Risco e nunca a apólice do
 * ciclo anterior).
 *
 * Critério (regra de produto permanente): mesmo empreendimento + mesmo ramo normalizado
 * (sucessão), status emitido (ativa/renovada/vencida/a vencer) ou número de apólice
 * oficial não-prospect. Preferência pela vigência CORRENTE do ciclo do Cartão (início do
 * Cartão dentro do intervalo [data_inicio, data_fim]); sem datas no Cartão, a mais
 * recente emitida. Comparar com a apólice antecessora não faz sentido para o usuário.
 */
export async function resolverApoliceReferenciaReal(params: {
  empreendimentoId: string
  apoliceProspectId?: string
  ramo?: string
  dataInicioCartao?: string
}): Promise<Record<string, unknown> | null> {
  const { empreendimentoId, apoliceProspectId, ramo, dataInicioCartao } = params
  if (!empreendimentoId) return null

  try {
    const apolicesList = (await pb.collection('apolices').getFullList({
      filter: `id_empreendimento="${empreendimentoId}"`,
      sort: '-data_fim,-created',
    })) as unknown as Array<Record<string, unknown>>

    const isEmitida = (ap: Record<string, unknown>): boolean => {
      const status = String(ap.status || '')
        .toLowerCase()
        .trim()
      if (status === 'prospect') return false
      const statusOk = ['ativa', 'renovada', 'vencida', 'a vencer'].includes(status)
      const temNumeroOficial =
        Boolean(String(ap.numero_apolice || '').trim()) &&
        !/proc_risco_/i.test(String(ap.id_apolice || ''))
      return statusOk || (temNumeroOficial && Boolean(String(ap.numero_apolice || '').trim()))
    }

    const emitidas = apolicesList.filter(
      (ap) => isEmitida(ap) && String(ap.id) !== String(apoliceProspectId || ''),
    )

    if (emitidas.length === 0) return null

    // Filtro de ramo (mesmo produto)
    let candidatas = emitidas
    if (ramo && ramo.trim()) {
      const ramoNormAlvo = normalizarRamoParaSucessao(ramo)
      const porRamo = emitidas.filter(
        (ap) => normalizarRamoParaSucessao(String(ap.ramo || '')) === ramoNormAlvo,
      )
      if (porRamo.length > 0) candidatas = porRamo
    }

    // Vigência CORRENTE do ciclo do Cartão: início do Cartão dentro do intervalo da apólice
    // (regra de produto: comparar com a apólice do ciclo atual emitida, nunca a antecessora)
    const refMs = dataInicioCartao ? new Date(dataInicioCartao.slice(0, 10)).getTime() : NaN
    if (!isNaN(refMs)) {
      const vigente = candidatas.find((ap) => {
        const ini = String(ap.data_inicio || '')
        const fim = String(ap.data_fim || '')
        if (!ini || !fim) return false
        const iniMs = new Date(ini.slice(0, 10)).getTime()
        const fimMs = new Date(fim.slice(0, 10)).getTime()
        return !isNaN(iniMs) && !isNaN(fimMs) && refMs >= iniMs && refMs <= fimMs
      })
      if (vigente) return vigente
    }

    return candidatas[0] || null
  } catch (err) {
    console.warn('Erro ao resolver apólice de referência real:', err)
    return null
  }
}

/**
 * Recalcula o snapshot comparativo de uma rodada de auditoria a partir dos dados VIGENTES do banco
 * (coberturas da apólice do ciclo atual emitida + Cartão de Risco persistido). Ressalvas de
 * rodadas anteriores NÃO migram — a rodada recalculada nasce com 0 ressalvas para reavaliação.
 */
export async function recalcularRodadaAuditoria(
  rodadaId: string,
  options?: { canonicas?: CoberturaCanonicaRecord[]; sinonimos?: CoberturaSinonimoRecord[] },
): Promise<AuditoriaRodadaRecord> {
  // 1. Carrega a rodada original
  const rodada = (await pb
    .collection('auditoria_rodadas')
    .getOne(rodadaId)) as unknown as AuditoriaRodadaRecord

  const empreendimentoId = rodada.empreendimento
  if (!empreendimentoId) throw new Error('Rodada sem empreendimento vinculado')

  const idCartaoSnap = rodada.snapshot_comparativo?.identificacao?.cartao
  const ramoReferencia = rodada.produto_ramo || idCartaoSnap?.ramo || ''
  const vigenciaInicioCartao = idCartaoSnap?.vigenciaInicio || ''

  // 2. Resolve a apólice de referência REAL (nunca o prospect criado pelo Cartão)
  const apoliceReal = await resolverApoliceReferenciaReal({
    empreendimentoId,
    apoliceProspectId: rodada.apolice || rodada.apolice_referencia_real || '',
    ramo: ramoReferencia,
    dataInicioCartao: vigenciaInicioCartao,
  })

  if (!apoliceReal) {
    throw new Error(
      'Nenhuma apólice do ciclo atual emitida encontrada para este empreendimento/ramo. O comparativo não pode ser recalculado.',
    )
  }

  // 3. Carrega dados vigentes
  const [coberturasApoliceReal, canonicas, sinonimos] = await Promise.all([
    pb.collection('coberturas').getFullList({
      filter: `id_apolice="${apoliceReal.id}"`,
    }) as unknown as Promise<Array<Record<string, unknown>>>,
    options?.canonicas
      ? Promise.resolve(options.canonicas)
      : listarTaxonomiaCanonicas().catch(() => []),
    options?.sinonimos ? Promise.resolve(options.sinonimos) : listarSinonimos().catch(() => []),
  ])

  // 4. Reconstrói o Cartão de Risco a partir do snapshot de identificação + coberturas
  //    gravadas no processo (coleção coberturas, origem 'Cartão de Risco') do prospect
  const idProspect = rodada.apolice || rodada.apolice_referencia_real || ''
  const coberturasCartao = idProspect
    ? ((await pb.collection('coberturas').getFullList({
        filter: `id_apolice="${idProspect}" && origem="Cartão de Risco"`,
      })) as unknown as Array<Record<string, unknown>>)
    : []

  // Fallback: se não houver coberturas marcadas com origem, usa todas as do prospect
  const coberturasCartaoFinal =
    coberturasCartao.length > 0
      ? coberturasCartao
      : idProspect
        ? ((await pb.collection('coberturas').getFullList({
            filter: `id_apolice="${idProspect}"`,
          })) as unknown as Array<Record<string, unknown>>)
        : []

  const cardReconstruido: RiskCardData = {
    segurado: idCartaoSnap?.segurado || '',
    cnpj: idCartaoSnap?.cnpj || '',
    endereco: '',
    atividade: '',
    atividadeExercida: '',
    inicioAtividades: '',
    contato: { nome: '', telefone: '', email: '' },
    localRisco: '',
    vigenciaInicio: idCartaoSnap?.vigenciaInicio || '',
    vigenciaFim: idCartaoSnap?.vigenciaFim || '',
    tipoCobertura: idCartaoSnap?.ramo || 'Prédio + Conteúdo',
    clausulaBeneficiaria: '',
    cossegurados: [],
    seguroNovo: false,
    seguroRenovacao: true,
    seguradoraAnterior: idCartaoSnap?.seguradora || 'A Cotar',
    numeroApoliceAnterior: idCartaoSnap?.numeroReferencia || '',
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
    coberturas: coberturasCartaoFinal.map((c, idx) => ({
      numero: idx + 1,
      nomeOriginal: String(c.nome_cobertura || ''),
      categoriaNormalizada:
        String(c.categoria_normalizada || '') ||
        matchCanonicalCategory(String(c.nome_cobertura || '')),
      isAtual: null,
      isAtualizada: null,
      isEscolhida:
        typeof c.lmi_rs === 'number' && c.lmi_rs > 0
          ? c.lmi_rs
          : typeof c.is_escolhida === 'number' && c.is_escolhida > 0
            ? c.is_escolhida
            : typeof c.is_atualizada === 'number' && c.is_atualizada > 0
              ? c.is_atualizada
              : typeof c.is_atual === 'number' && c.is_atual > 0
                ? c.is_atual
                : null,
      observacao: String(c.observacao || ''),
    })),
    sheetName: '',
    fileName: rodada.arquivo_origem || '',
  }

  // 5. Recalcula o snapshot com dados vigentes
  const novoSnapshot = buildAuditoriaSnapshot(
    cardReconstruido,
    apoliceReal,
    coberturasApoliceReal,
    {
      produtoCartao: idCartaoSnap?.ramo || '',
      ramoCanonicaCartao: ramoReferencia || undefined,
      // Regra de produto: ressalvas de rodadas anteriores NÃO migram — a rodada recalculada
      // começa com 0 ressalvas para o analista reavaliar contra a apólice do ciclo atual.
      ressalvasIniciais: [],
      canonicas: (canonicas || []) as CoberturaCanonicaRecord[],
      sinonimos: (sinonimos || []) as CoberturaSinonimoRecord[],
    },
  )

  // 6. Recalcula totais — ressalvas NÃO migram: a rodada recalculada nasce com 0 ressalvas
  //    (regra de produto: o analista reavalia do zero contra a apólice do ciclo atual)
  const ressalvasPreservadas: string[] = []

  const totalDivergencias =
    novoSnapshot.identificacao.divergenciasIdentificacao.length +
    novoSnapshot.coberturas.totalDivergencias +
    novoSnapshot.vrdPorRubrica.filter((r) => r.divergente).length

  // 7. Grava a nova rodada (nova versão no histórico, preservando a anterior)
  const record = await pb.collection('auditoria_rodadas').create({
    empreendimento: empreendimentoId,
    apolice: idProspect || null,
    apolice_referencia_real: String(apoliceReal.id),
    numero_rodada: (rodada.numero_rodada || 1) + 1,
    data_rodada: new Date().toISOString().slice(0, 10),
    produto_ramo: rodada.produto_ramo,
    arquivo_origem: rodada.arquivo_origem,
    usuario_upload: rodada.usuario_upload || null,
    usuario_email: rodada.usuario_email || '',
    desfecho: rodada.desfecho,
    total_divergencias: totalDivergencias,
    total_ressalvas_c5: ressalvasPreservadas.length,
    snapshot_comparativo: novoSnapshot,
    ressalvas_marcadas: ressalvasPreservadas,
    observacoes: `Recalculada a partir dos dados vigentes do banco contra a apólice do ciclo atual emitida (ref.: ${String(
      apoliceReal.numero_apolice || apoliceReal.id_apolice || '—',
    )}). Ressalvas da rodada anterior não migradas — reavaliar. Histórico da rodada #${rodada.numero_rodada} preservado.`,
  })

  return record as unknown as AuditoriaRodadaRecord
}

/**
 * Salva uma nova rodada de auditoria no PocketBase, preservando o histórico de rodadas anteriores
 */
export async function createAuditoriaRodada(params: {
  empreendimentoId: string
  apoliceId?: string
  apoliceReferenciaRealId?: string
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
    apolice_referencia_real: params.apoliceReferenciaRealId || params.apoliceId || null,
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
