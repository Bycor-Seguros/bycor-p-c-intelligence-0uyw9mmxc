import pb from '@/lib/pocketbase/client'
import { normalizeMatchText } from '@/services/guardiaImporter'

export interface CoberturaCanonicaRecord {
  id: string
  nome: string
  ramo?: string
  descricao?: string
  eventos_tipicos?: string[]
  ordem?: number
  created?: string
  updated?: string
}

export interface RealocacaoEventoItem {
  evento: string
  cobertura_destino: string
  motivo?: string
}

export interface CoberturaSinonimoRecord {
  id: string
  alias: string
  seguradora?: string
  seguradora_nome?: string
  cobertura_canonica?: string
  canonica_nome?: string
  eventos_excluidos?: string[]
  realocacoes_evento?: RealocacaoEventoItem[]
  observacao?: string
  created?: string
  updated?: string
}

export interface CoverageMatchResult {
  canonica: string
  canonicaId?: string
  matchType: 'sinonimo_cia' | 'sinonimo_global' | 'matriz_exata' | 'similaridade' | 'nao_mapeada'
  sinonimo?: CoberturaSinonimoRecord
  eventosEfetivos: string[]
  eventosExcluidos: string[]
  realocacoes: RealocacaoEventoItem[]
}

/**
 * Normaliza string para indexação e casamento de termos (alias, nome de cobertura)
 */
export function normalizarTermoEquivalencia(str: string): string {
  return normalizeMatchText(str || '')
}

/**
 * Calcula similaridade de Jaccard entre bi-grams (tokens de 2 caracteres) para match fuzzy tolerante
 */
export function calcularSimilaridadeTexto(a: string, b: string): number {
  const normA = normalizarTermoEquivalencia(a)
  const normB = normalizarTermoEquivalencia(b)
  if (!normA || !normB) return 0
  if (normA === normB) return 1
  if (normA.includes(normB) || normB.includes(normA)) return 0.85

  const getBigrams = (text: string): Set<string> => {
    const bigrams = new Set<string>()
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.substring(i, i + 2))
    }
    return bigrams
  }

  const bigramsA = getBigrams(normA)
  const bigramsB = getBigrams(normB)
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  let intersecao = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersecao++
  }

  const uniao = bigramsA.size + bigramsB.size - intersecao
  return uniao > 0 ? intersecao / uniao : 0
}

/**
 * Busca todas as categorias canônicas a partir da coleção `coberturas_canonicas`
 * E se estiver vazia ou com lacunas, também complementa com as categorias distintas gravadas na coleção `matriz`.
 */
export async function listarTaxonomiaCanonicas(): Promise<CoberturaCanonicaRecord[]> {
  let canonicasDb: CoberturaCanonicaRecord[] = []
  try {
    canonicasDb = await pb.collection('coberturas_canonicas').getFullList<CoberturaCanonicaRecord>({
      sort: 'ordem,nome',
    })
  } catch (err) {
    console.warn('Erro ao carregar coberturas_canonicas:', err)
  }

  // Conjunto dos nomes já existentes em `coberturas_canonicas`
  const nomesExistentes = new Set(canonicasDb.map((c) => normalizarTermoEquivalencia(c.nome)))

  // Consulta matriz existente no banco para ler as categorias normalizadas
  try {
    const matrizRows = await pb
      .collection('matriz')
      .getFullList<{ categoria_normalizada: string }>({
        fields: 'categoria_normalizada',
      })
    const categoriasMatrizDistintas = Array.from(
      new Set(matrizRows.map((r) => r.categoria_normalizada?.trim()).filter(Boolean)),
    )

    // Para cada categoria encontrada na matriz que ainda não esteja explicitamente cadastrada em `coberturas_canonicas`,
    // adiciona um item virtual (ou cadastrável no banco pelo painel)
    for (const catMatriz of categoriasMatrizDistintas) {
      const norm = normalizarTermoEquivalencia(catMatriz)
      if (!nomesExistentes.has(norm)) {
        canonicasDb.push({
          id: `matriz_${norm}`,
          nome: catMatriz,
          descricao: 'Importada da Matriz de Mercado',
          eventos_tipicos: derivarEventosTipicosPadrao(catMatriz),
          ordem: 999,
        })
        nomesExistentes.add(norm)
      }
    }
  } catch (err) {
    console.warn('Aviso: Não foi possível ler categorias da coleção matriz:', err)
  }

  return canonicasDb.sort((a, b) => a.nome.localeCompare(b.nome))
}

/**
 * Eventos típicos padrão derivados a partir de padrões canônicos comuns
 * (ex.: Básica inclui Incêndio, Queda de Raio, Explosão, Implosão, Queda de Aeronave, Tumultos).
 * Caso não haja padrão conhecido, o próprio nome da cobertura é considerado seu evento típico.
 */
export function derivarEventosTipicosPadrao(nomeCobertura: string): string[] {
  const norm = normalizarTermoEquivalencia(nomeCobertura)
  if (norm.includes('incendio') || norm.includes('basica')) {
    return [
      'Incêndio',
      'Queda de Raio',
      'Explosão de Qualquer Natureza',
      'Implosão',
      'Queda de Aeronave / Engenhos Espaciais',
      'Tumultos',
    ]
  }
  if (norm.includes('vendaval') || norm.includes('furacao') || norm.includes('granizo')) {
    return ['Vendaval', 'Granizo', 'Furacão', 'Ciclone', 'Tornado', 'Fumaça']
  }
  if (norm.includes('alagamento') || norm.includes('inundacao')) {
    return ['Alagamento', 'Inundação', 'Ressaca', 'Transbordamento de Rios']
  }
  if (norm.includes('danos eletricos') || norm.includes('eletrico')) {
    return ['Curto-Circuito', 'Sobretensão', 'Variação de Tensão', 'Arco Voltaico']
  }
  if (norm.includes('roubo') || norm.includes('furto')) {
    return ['Roubo com Ameaça', 'Furto Qualificado', 'Destruição de Obstáculo']
  }
  if (norm.includes('danos por agua') || norm.includes('sprinklers')) {
    return [
      'Dano por Água',
      'Derrame de Sprinklers / Chuveiros Automáticos',
      'Rompimento de Encanamento Interno',
    ]
  }
  if (norm.includes('desmoronamento')) {
    return ['Desmoronamento Parcial ou Total', 'Desabamento de Paredes', 'Abalos Estruturais']
  }
  if (norm.includes('quebra de maquinas')) {
    return ['Quebra Mecânica Acidental', 'Falha Operacional Repentina', 'Desajuste Mecânico']
  }
  if (norm.includes('quebra de vidros') || norm.includes('vidros')) {
    return ['Quebra de Vidros', 'Quebra de Espelhos', 'Quebra de Mármores/Granitos']
  }
  if (norm.includes('responsabilidade civil') || norm.includes('rc ')) {
    return ['Danos Materiais a Terceiros', 'Danos Corporais a Terceiros', 'Custas de Defesa']
  }
  return [nomeCobertura.trim()]
}

/**
 * Busca todos os sinônimos gravados no banco
 */
export async function listarSinonimos(): Promise<CoberturaSinonimoRecord[]> {
  try {
    return await pb.collection('cobertura_sinonimos').getFullList<CoberturaSinonimoRecord>({
      sort: '-created',
    })
  } catch (err) {
    console.warn('Erro ao carregar cobertura_sinonimos:', err)
    return []
  }
}

/**
 * Grava ou atualiza um sinônimo de cobertura de uma seguradora (ou global)
 */
export async function salvarSinonimo(params: {
  alias: string
  seguradoraId?: string
  seguradoraNome?: string
  coberturaCanonicaId?: string
  canonicaNome: string
  eventosExcluidos?: string[]
  realocacoesEvento?: RealocacaoEventoItem[]
  observacao?: string
}): Promise<CoberturaSinonimoRecord> {
  const normAlias = normalizarTermoEquivalencia(params.alias)
  const normSeg = normalizarTermoEquivalencia(params.seguradoraNome || '')

  // Procura se já existe um sinônimo para este alias + seguradora
  let existente: CoberturaSinonimoRecord | null = null
  try {
    const list = await pb.collection('cobertura_sinonimos').getFullList<CoberturaSinonimoRecord>({
      filter: `alias = "${params.alias.replace(/"/g, '\\"')}"`,
    })
    existente =
      list.find((s) => {
        const sSeg = normalizarTermoEquivalencia(s.seguradora_nome || '')
        return sSeg === normSeg || (!sSeg && !normSeg)
      }) || null
  } catch {
    // ignore
  }

  const payload = {
    alias: params.alias.trim(),
    seguradora: params.seguradoraId || null,
    seguradora_nome: params.seguradoraNome?.trim() || '',
    cobertura_canonica: params.coberturaCanonicaId?.startsWith('matriz_')
      ? null
      : params.coberturaCanonicaId || null,
    canonica_nome: params.canonicaNome.trim(),
    eventos_excluidos: params.eventosExcluidos || [],
    realocacoes_evento: params.realocacoesEvento || [],
    observacao: params.observacao?.trim() || '',
  }

  if (existente) {
    return await pb
      .collection('cobertura_sinonimos')
      .update<CoberturaSinonimoRecord>(existente.id, payload)
  }
  return await pb.collection('cobertura_sinonimos').create<CoberturaSinonimoRecord>(payload)
}

/**
 * Cria ou atualiza uma cobertura canônica na taxonomia
 */
export async function salvarCoberturaCanonica(params: {
  id?: string
  nome: string
  ramo?: string
  descricao?: string
  eventosTipicos: string[]
  ordem?: number
}): Promise<CoberturaCanonicaRecord> {
  const payload = {
    nome: params.nome.trim(),
    ramo: params.ramo?.trim() || 'Patrimonial',
    descricao: params.descricao?.trim() || '',
    eventos_tipicos: params.eventosTipicos.map((e) => e.trim()).filter(Boolean),
    ordem: params.ordem ?? 100,
  }

  if (params.id && !params.id.startsWith('matriz_')) {
    return await pb
      .collection('coberturas_canonicas')
      .update<CoberturaCanonicaRecord>(params.id, payload)
  }
  return await pb.collection('coberturas_canonicas').create<CoberturaCanonicaRecord>(payload)
}

/**
 * Deleta um sinônimo
 */
export async function excluirSinonimo(id: string): Promise<boolean> {
  await pb.collection('cobertura_sinonimos').delete(id)
  return true
}

/**
 * Deleta uma cobertura canônica
 */
export async function excluirCoberturaCanonica(id: string): Promise<boolean> {
  if (id.startsWith('matriz_')) return true
  await pb.collection('coberturas_canonicas').delete(id)
  return true
}

/**
 * Resolve o casamento da cobertura da proposta com a taxonomia canônica.
 * Ordem de prioridade:
 * 1. Sinônimo exato gravado para a mesma seguradora
 * 2. Sinônimo gravado global (sem seguradora específica)
 * 3. Match de nome idêntico ou muito próximo na lista de canônicas/Matriz
 * 4. Match de similaridade fuzzy tolerante (>= 0.72)
 * 5. Se não bater, retorna 'nao_mapeada'
 */
export function casarCoberturaComCanonica(
  nomeOriginal: string,
  seguradoraNome: string,
  canonicas: CoberturaCanonicaRecord[],
  sinonimos: CoberturaSinonimoRecord[],
): CoverageMatchResult {
  const raw = nomeOriginal?.trim() || ''
  const normOriginal = normalizarTermoEquivalencia(raw)
  const normSeg = normalizarTermoEquivalencia(seguradoraNome || '')

  // 1. Sinônimo para a mesma seguradora
  const sinCia = sinonimos.find((s) => {
    const sAlias = normalizarTermoEquivalencia(s.alias)
    const sSeg = normalizarTermoEquivalencia(s.seguradora_nome || '')
    return (
      sAlias === normOriginal &&
      sSeg &&
      normSeg &&
      (sSeg === normSeg || normSeg.includes(sSeg) || sSeg.includes(normSeg))
    )
  })
  if (sinCia) {
    const canRec = canonicas.find(
      (c) =>
        normalizarTermoEquivalencia(c.nome) ===
        normalizarTermoEquivalencia(sinCia.canonica_nome || ''),
    )
    const baseEventos = canRec?.eventos_tipicos?.length
      ? canRec.eventos_tipicos
      : derivarEventosTipicosPadrao(sinCia.canonica_nome || '')
    const excluidos = sinCia.eventos_excluidos || []
    const efetivos = baseEventos.filter(
      (ev) =>
        !excluidos.some(
          (ex) => normalizarTermoEquivalencia(ex) === normalizarTermoEquivalencia(ev),
        ),
    )

    return {
      canonica: sinCia.canonica_nome || raw,
      canonicaId: canRec?.id,
      matchType: 'sinonimo_cia',
      sinonimo: sinCia,
      eventosEfetivos: efetivos,
      eventosExcluidos: excluidos,
      realocacoes: sinCia.realocacoes_evento || [],
    }
  }

  // 2. Sinônimo global
  const sinGlobal = sinonimos.find((s) => {
    const sAlias = normalizarTermoEquivalencia(s.alias)
    return sAlias === normOriginal && !s.seguradora_nome
  })
  if (sinGlobal) {
    const canRec = canonicas.find(
      (c) =>
        normalizarTermoEquivalencia(c.nome) ===
        normalizarTermoEquivalencia(sinGlobal.canonica_nome || ''),
    )
    const baseEventos = canRec?.eventos_tipicos?.length
      ? canRec.eventos_tipicos
      : derivarEventosTipicosPadrao(sinGlobal.canonica_nome || '')
    const excluidos = sinGlobal.eventos_excluidos || []
    const efetivos = baseEventos.filter(
      (ev) =>
        !excluidos.some(
          (ex) => normalizarTermoEquivalencia(ex) === normalizarTermoEquivalencia(ev),
        ),
    )

    return {
      canonica: sinGlobal.canonica_nome || raw,
      canonicaId: canRec?.id,
      matchType: 'sinonimo_global',
      sinonimo: sinGlobal,
      eventosEfetivos: efetivos,
      eventosExcluidos: excluidos,
      realocacoes: sinGlobal.realocacoes_evento || [],
    }
  }

  // 3. Match de nome exato com Canônica / Matriz
  const canExata = canonicas.find((c) => normalizarTermoEquivalencia(c.nome) === normOriginal)
  if (canExata) {
    const eventos = canExata.eventos_tipicos?.length
      ? canExata.eventos_tipicos
      : derivarEventosTipicosPadrao(canExata.nome)
    return {
      canonica: canExata.nome,
      canonicaId: canExata.id,
      matchType: 'matriz_exata',
      eventosEfetivos: eventos,
      eventosExcluidos: [],
      realocacoes: [],
    }
  }

  // 4. Match de similaridade de texto com Canônicas (fuzzy)
  let melhorCanonica: CoberturaCanonicaRecord | null = null
  let melhorScore = 0

  for (const can of canonicas) {
    const score = calcularSimilaridadeTexto(raw, can.nome)
    if (score > melhorScore) {
      melhorScore = score
      melhorCanonica = can
    }
  }

  if (melhorCanonica && melhorScore >= 0.72) {
    const eventos = melhorCanonica.eventos_tipicos?.length
      ? melhorCanonica.eventos_tipicos
      : derivarEventosTipicosPadrao(melhorCanonica.nome)
    return {
      canonica: melhorCanonica.nome,
      canonicaId: melhorCanonica.id,
      matchType: 'similaridade',
      eventosEfetivos: eventos,
      eventosExcluidos: [],
      realocacoes: [],
    }
  }

  // 5. Sem match: Não mapeada
  return {
    canonica: raw,
    matchType: 'nao_mapeada',
    eventosEfetivos: derivarEventosTipicosPadrao(raw),
    eventosExcluidos: [],
    realocacoes: [],
  }
}

/**
 * Estrutura de análise de descoberta (gap de eventos entre propostas do mesmo RFQ).
 * Quando um evento coberto em uma proposta não tiver cobertura equivalente em outra cia da mesma RFQ,
 * marca "Segurado descoberto: [evento]".
 */
export interface AlertaDescobertaEvento {
  evento: string
  ciaComCobertura: string
  coberturaOrigem: string
  motivo?: string
}

export function detectarEventosDescobertos(params: {
  propostaAtual: {
    seguradoraNome: string
    coberturasCasadas: Array<{
      canonica: string
      nomeOriginal: string
      lmi: number | null
      eventosEfetivos: string[]
      realocacoes: RealocacaoEventoItem[]
    }>
  }
  outrasPropostas: Array<{
    seguradoraNome: string
    coberturasCasadas: Array<{
      canonica: string
      nomeOriginal: string
      lmi: number | null
      eventosEfetivos: string[]
      realocacoes: RealocacaoEventoItem[]
    }>
  }>
  canonicaAlvo: string
}): AlertaDescobertaEvento[] {
  const { propostaAtual, outrasPropostas, canonicaAlvo } = params
  const normCanonicaAlvo = normalizarTermoEquivalencia(canonicaAlvo)

  // 1. Identifica quais eventos desta canônica estão cobertos nas OUTRAS propostas
  // (onde LMI > 0 e a cobertura está cotada)
  const eventosCobertosNasOutras: Array<{
    evento: string
    ciaComCobertura: string
    coberturaOrigem: string
  }> = []

  for (const outra of outrasPropostas) {
    const cobOutra = outra.coberturasCasadas.find(
      (c) => normalizarTermoEquivalencia(c.canonica) === normCanonicaAlvo && Number(c.lmi || 0) > 0,
    )
    if (cobOutra) {
      for (const ev of cobOutra.eventosEfetivos) {
        eventosCobertosNasOutras.push({
          evento: ev,
          ciaComCobertura: outra.seguradoraNome,
          coberturaOrigem: cobOutra.nomeOriginal,
        })
      }
    }
  }

  if (eventosCobertosNasOutras.length === 0) return []

  // 2. Verifica se a proposta ATUAL cobre esse evento
  // Pode estar coberto na própria cobertura canônica ALVO ou ter sido REALOCADO para outra cobertura da mesma proposta atual!
  const cobAtualNaCanonica = propostaAtual.coberturasCasadas.find(
    (c) => normalizarTermoEquivalencia(c.canonica) === normCanonicaAlvo,
  )

  // Eventos cobertos nesta mesma canônica na proposta atual
  const eventosCobertosAqui = new Set<string>(
    (cobAtualNaCanonica && Number(cobAtualNaCanonica.lmi || 0) > 0
      ? cobAtualNaCanonica.eventosEfetivos
      : []
    ).map(normalizarTermoEquivalencia),
  )

  // Eventos que foram REALOCADOS para outra cobertura cotada da mesma cia na proposta atual
  const eventosRealocadosComCobertura = new Set<string>()
  for (const cob of propostaAtual.coberturasCasadas) {
    for (const realoc of cob.realocacoes) {
      // Se a cobertura de destino existe e tem LMI > 0 nesta proposta atual
      const cobDestino = propostaAtual.coberturasCasadas.find(
        (c) =>
          normalizarTermoEquivalencia(c.canonica) ===
            normalizarTermoEquivalencia(realoc.cobertura_destino) ||
          normalizarTermoEquivalencia(c.nomeOriginal) ===
            normalizarTermoEquivalencia(realoc.cobertura_destino),
      )
      if (cobDestino && Number(cobDestino.lmi || 0) > 0) {
        eventosRealocadosComCobertura.add(normalizarTermoEquivalencia(realoc.evento))
      }
    }
  }

  // 3. Compara se algum evento coberto pelas outras ficou descoberto na proposta atual
  const descobertos: AlertaDescobertaEvento[] = []
  const vistos = new Set<string>()

  for (const item of eventosCobertosNasOutras) {
    const normEv = normalizarTermoEquivalencia(item.evento)
    if (vistos.has(normEv)) continue

    const cobertoAqui = eventosCobertosAqui.has(normEv)
    const realocadoAqui = eventosRealocadosComCobertura.has(normEv)

    if (!cobertoAqui && !realocadoAqui) {
      vistos.add(normEv)
      descobertos.push({
        evento: item.evento,
        ciaComCobertura: item.ciaComCobertura,
        coberturaOrigem: item.coberturaOrigem,
      })
    }
  }

  return descobertos
}
