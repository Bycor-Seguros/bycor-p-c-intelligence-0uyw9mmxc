import pb from '@/lib/pocketbase/client'
import { normalizeMatchText } from '@/services/guardiaImporter'

export interface CoberturaCanonicaRecord {
  id: string
  nome: string
  ramo?: string
  descricao?: string
  origem_matriz?: string
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

  // Conjuntos para deduplicação robusta:
  // 1. Nomes atuais das canônicas
  // 2. Nomes de origem da matriz persistidos no campo `origem_matriz`
  // 3. Casos históricos conhecidos (ex: "Danos por Água" que substituiu "Danos por Água / Sprinklers")
  const nomesExistentes = new Set<string>()
  for (const c of canonicasDb) {
    if (c.nome) nomesExistentes.add(normalizarTermoEquivalencia(c.nome))
    if (c.origem_matriz) nomesExistentes.add(normalizarTermoEquivalencia(c.origem_matriz))

    // Heurística de segurança para transição: se existe "Danos por Água", nunca ressuscitar "Danos por Água / Sprinklers"
    const normNome = normalizarTermoEquivalencia(c.nome)
    if (normNome === normalizarTermoEquivalencia('Danos por Água')) {
      nomesExistentes.add(normalizarTermoEquivalencia('Danos por Água / Sprinklers'))
      nomesExistentes.add(normalizarTermoEquivalencia('Danos por Agua / Sprinklers'))
    }
  }

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
    // adiciona um item virtual
    for (const catMatriz of categoriasMatrizDistintas) {
      const norm = normalizarTermoEquivalencia(catMatriz)
      if (!nomesExistentes.has(norm)) {
        canonicasDb.push({
          id: `matriz_${norm}`,
          nome: catMatriz,
          origem_matriz: catMatriz,
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
    const todos = await pb.collection('cobertura_sinonimos').getFullList<CoberturaSinonimoRecord>({
      sort: '-updated,-created',
    })

    // Deduplica em memória pelo critério de unicidade (alias normalizado + seguradora normalizada),
    // mantendo sempre o mais recentemente atualizado em caso de duplicatas residuais no banco.
    // Também consolida e deduplica em memória eventos_excluidos e realocacoes_evento de cada registro.
    const mapaUnico = new Map<string, CoberturaSinonimoRecord>()
    for (const sin of todos) {
      const normAlias = normalizarTermoEquivalencia(sin.alias)
      const normSeg = normalizarTermoEquivalencia(sin.seguradora_nome || '')
      const chave = `${normAlias}___${normSeg}`
      if (!mapaUnico.has(chave)) {
        const excluidosConsolidados = Array.from(
          new Map(
            (sin.eventos_excluidos || [])
              .map((e) => e?.trim())
              .filter(Boolean)
              .map((e) => [normalizarTermoEquivalencia(e), e]),
          ).values(),
        )

        const realocacoesConsolidadas = Array.from(
          new Map(
            (sin.realocacoes_evento || [])
              .filter((r) => r && r.evento?.trim() && r.cobertura_destino?.trim())
              .map((r) => {
                const ev = r.evento.trim()
                const dest = r.cobertura_destino.trim()
                const rKey = `${normalizarTermoEquivalencia(ev)}___${normalizarTermoEquivalencia(dest)}`
                return [
                  rKey,
                  { evento: ev, cobertura_destino: dest, motivo: r.motivo?.trim() || '' },
                ]
              }),
          ).values(),
        )

        mapaUnico.set(chave, {
          ...sin,
          eventos_excluidos: excluidosConsolidados,
          realocacoes_evento: realocacoesConsolidadas,
        })
      }
    }

    return Array.from(mapaUnico.values())
  } catch (err) {
    console.warn('Erro ao carregar cobertura_sinonimos:', err)
    return []
  }
}

/**
 * Grava ou atualiza um sinônimo de cobertura de uma seguradora (ou global).
 * Critério de unicidade: alias normalizado + seguradora normalizada (vazio = Global).
 * Se o parâmetro `id` for fornecido (edição no painel), atualiza o registro diretamente
 * mesmo que o usuário troque entre Global e uma seguradora específica.
 */
export async function salvarSinonimo(params: {
  id?: string
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

  // Procura se já existe um sinônimo para este alias + seguradora ou pelo ID direto
  let existenteId = params.id || null

  if (!existenteId) {
    try {
      const allSins = await pb
        .collection('cobertura_sinonimos')
        .getFullList<CoberturaSinonimoRecord>()
      const match = allSins.find((s) => {
        const sAlias = normalizarTermoEquivalencia(s.alias)
        const sSeg = normalizarTermoEquivalencia(s.seguradora_nome || '')
        return sAlias === normAlias && (sSeg === normSeg || (!sSeg && !normSeg))
      })
      if (match) {
        existenteId = match.id
      }
    } catch {
      // ignore
    }
  }

  // Deduplicação de eventos excluídos
  const eventosExcluidosLimpos = Array.from(
    new Map(
      (params.eventosExcluidos || [])
        .map((e) => e?.trim())
        .filter(Boolean)
        .map((e) => [normalizarTermoEquivalencia(e), e]),
    ).values(),
  )

  // Deduplicação de realocações: substitui a lista inteira e elimina duplicatas de mesmo evento e destino
  const realocacoesLimpas = Array.from(
    new Map(
      (params.realocacoesEvento || [])
        .filter((r) => r && r.evento?.trim() && r.cobertura_destino?.trim())
        .map((r) => {
          const ev = r.evento.trim()
          const dest = r.cobertura_destino.trim()
          const chave = `${normalizarTermoEquivalencia(ev)}___${normalizarTermoEquivalencia(dest)}`
          return [chave, { evento: ev, cobertura_destino: dest, motivo: r.motivo?.trim() || '' }]
        }),
    ).values(),
  )

  const payload = {
    alias: params.alias.trim(),
    seguradora: params.seguradoraId || null,
    seguradora_nome: params.seguradoraNome?.trim() || '',
    cobertura_canonica: params.coberturaCanonicaId?.startsWith('matriz_')
      ? null
      : params.coberturaCanonicaId || null,
    canonica_nome: params.canonicaNome.trim(),
    eventos_excluidos: eventosExcluidosLimpos,
    realocacoes_evento: realocacoesLimpas,
    observacao: params.observacao?.trim() || '',
  }

  if (existenteId) {
    return await pb
      .collection('cobertura_sinonimos')
      .update<CoberturaSinonimoRecord>(existenteId, payload)
  }
  return await pb.collection('cobertura_sinonimos').create<CoberturaSinonimoRecord>(payload)
}

/**
 * Cria ou atualiza uma cobertura canônica na taxonomia
 */
export async function salvarCoberturaCanonica(params: {
  id?: string
  nome: string
  origemMatriz?: string
  ramo?: string
  descricao?: string
  eventosTipicos: string[]
  ordem?: number
}): Promise<CoberturaCanonicaRecord> {
  const novoNome = params.nome.trim()
  const payload: Record<string, any> = {
    nome: novoNome,
    ramo: params.ramo?.trim() || 'Patrimonial',
    descricao: params.descricao?.trim() || '',
    eventos_tipicos: params.eventosTipicos.map((e) => e.trim()).filter(Boolean),
    ordem: params.ordem ?? 100,
  }
  if (params.origemMatriz) {
    payload.origem_matriz = params.origemMatriz.trim()
  }

  let canonicaSalva: CoberturaCanonicaRecord

  // Se for edição de registro real já existente
  if (params.id && !params.id.startsWith('matriz_')) {
    const anterior = await pb
      .collection('coberturas_canonicas')
      .getOne<CoberturaCanonicaRecord>(params.id)
    canonicaSalva = await pb
      .collection('coberturas_canonicas')
      .update<CoberturaCanonicaRecord>(params.id, payload)

    // Se o nome foi alterado, atualiza em cascata os sinônimos que apontavam para este ID ou para o nome anterior
    if (anterior.nome !== novoNome) {
      await sincronizarNomeCanonicaNosSinonimos(canonicaSalva.id, novoNome, anterior.nome)
    }
  } else {
    // Se o ID vinha como virtual da matriz (ex: 'matriz_danos_por_agua_sprinklers')
    // ou se foi informada origemMatriz, garantimos gravar origem_matriz para nunca ressuscitar
    if (params.id?.startsWith('matriz_') && !payload.origem_matriz) {
      // Extrai ou usa o próprio nome como origem_matriz
      payload.origem_matriz = params.origemMatriz || novoNome
    }
    canonicaSalva = await pb
      .collection('coberturas_canonicas')
      .create<CoberturaCanonicaRecord>(payload)
  }

  return canonicaSalva
}

/**
 * Atualiza o campo `canonica_nome` em todos os sinônimos que apontam para esta canônica (por ID ou pelo nome anterior)
 */
async function sincronizarNomeCanonicaNosSinonimos(
  canonicaId: string,
  novoNome: string,
  nomeAnterior?: string,
): Promise<void> {
  try {
    const sinonimos = await pb
      .collection('cobertura_sinonimos')
      .getFullList<CoberturaSinonimoRecord>()
    const normAnterior = nomeAnterior ? normalizarTermoEquivalencia(nomeAnterior) : ''

    for (const sin of sinonimos) {
      const casaPorId = sin.cobertura_canonica === canonicaId
      const casaPorNome =
        normAnterior && normalizarTermoEquivalencia(sin.canonica_nome || '') === normAnterior
      if (casaPorId || casaPorNome) {
        await pb.collection('cobertura_sinonimos').update(sin.id, {
          cobertura_canonica: canonicaId,
          canonica_nome: novoNome,
        })
      }
    }
  } catch (err) {
    console.warn('Aviso: falha ao sincronizar sinônimos ao renomear canônica:', err)
  }
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
    // Casamento prioritário por ID da canônica; fallback para o nome se não houver ID gravado
    const canRec = canonicas.find((c) => {
      if (sinCia.cobertura_canonica && c.id === sinCia.cobertura_canonica) return true
      return (
        normalizarTermoEquivalencia(c.nome) ===
        normalizarTermoEquivalencia(sinCia.canonica_nome || '')
      )
    })
    const nomeDestino = canRec?.nome || sinCia.canonica_nome || raw
    const baseEventos = canRec?.eventos_tipicos?.length
      ? canRec.eventos_tipicos
      : derivarEventosTipicosPadrao(nomeDestino)
    const excluidos = sinCia.eventos_excluidos || []
    const efetivos = baseEventos.filter(
      (ev) =>
        !excluidos.some(
          (ex) => normalizarTermoEquivalencia(ex) === normalizarTermoEquivalencia(ev),
        ),
    )

    return {
      canonica: nomeDestino,
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
    // Casamento prioritário por ID da canônica; fallback para o nome se não houver ID gravado
    const canRec = canonicas.find((c) => {
      if (sinGlobal.cobertura_canonica && c.id === sinGlobal.cobertura_canonica) return true
      return (
        normalizarTermoEquivalencia(c.nome) ===
        normalizarTermoEquivalencia(sinGlobal.canonica_nome || '')
      )
    })
    const nomeDestino = canRec?.nome || sinGlobal.canonica_nome || raw
    const baseEventos = canRec?.eventos_tipicos?.length
      ? canRec.eventos_tipicos
      : derivarEventosTipicosPadrao(nomeDestino)
    const excluidos = sinGlobal.eventos_excluidos || []
    const efetivos = baseEventos.filter(
      (ev) =>
        !excluidos.some(
          (ex) => normalizarTermoEquivalencia(ex) === normalizarTermoEquivalencia(ev),
        ),
    )

    return {
      canonica: nomeDestino,
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

/**
 * Normaliza um evento para casamento semântico tolerante a variantes:
 * minúsculas, remoção de acentos, pontuações (/ , - .) e espaços colapsados.
 * Exemplos: "Anúncios Luminosos" -> "anuncios luminosos"
 * "Anúncios/Letreiros Luminosos" -> "anuncios letreiros luminosos"
 */
export function normalizarEventoSemantico(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[/\\.,;:_()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Verifica se dois eventos são equivalentes ou variantes um do outro
 * (ex: "Anúncios Luminosos" e "Anúncios/Letreiros Luminosos").
 */
export function eventosSaoEquivalentes(evA: string, evB: string): boolean {
  const normA = normalizarEventoSemantico(evA)
  const normB = normalizarEventoSemantico(evB)
  if (!normA || !normB) return false
  if (normA === normB) return true

  // Substring mútua tolerante (ex: "anuncios luminosos" contido em "anuncios letreiros luminosos")
  if (normA.includes(normB) || normB.includes(normA)) {
    return true
  }

  // Similaridade de tokens (palavras significativas comuns)
  const tokensA = normA
    .split(' ')
    .filter(
      (t) =>
        t.length > 2 && t !== 'para' && t !== 'com' && t !== 'sem' && t !== 'dos' && t !== 'das',
    )
  const tokensB = normB
    .split(' ')
    .filter(
      (t) =>
        t.length > 2 && t !== 'para' && t !== 'com' && t !== 'sem' && t !== 'dos' && t !== 'das',
    )
  if (tokensA.length > 0 && tokensB.length > 0) {
    const inter = tokensA.filter((t) => tokensB.includes(t))
    // Se compartilham pelo menos 2 tokens significativos ou se mais da metade dos tokens são comuns
    if (
      inter.length >= 2 ||
      (inter.length >= 1 && (inter.length === tokensA.length || inter.length === tokensB.length))
    ) {
      return true
    }
  }

  return false
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
  // Pode estar coberto na própria cobertura canônica ALVO ou ter sido REALOCADO a partir de outra cobertura cotada da mesma cia!
  const cobAtualNaCanonica = propostaAtual.coberturasCasadas.find(
    (c) => normalizarTermoEquivalencia(c.canonica) === normCanonicaAlvo,
  )

  // Eventos cobertos nesta mesma canônica na proposta atual (apenas se LMI > 0)
  const eventosCobertosAquiLista: string[] =
    cobAtualNaCanonica && Number(cobAtualNaCanonica.lmi || 0) > 0
      ? cobAtualNaCanonica.eventosEfetivos
      : []

  // Lista de realocações vindas de coberturas que estão cotadas (LMI > 0) na proposta atual
  // e que têm como destino esta canônica ALVO (ou qualquer cobertura de mesmo nome)
  const realocacoesParaEstaCanonica: RealocacaoEventoItem[] = []
  // E também lista geral de eventos realocados para qualquer cobertura cotada (LMI > 0)
  const eventosRealocadosComCobertura: string[] = []

  for (const cob of propostaAtual.coberturasCasadas) {
    const temLmiOrigem = Number(cob.lmi || 0) > 0
    if (!temLmiOrigem) continue

    for (const realoc of cob.realocacoes) {
      if (!realoc || !realoc.evento) continue

      const normDestino = normalizarTermoEquivalencia(realoc.cobertura_destino || '')
      // Destino casa com a canônica alvo?
      const destinoCasaComCanonicaAlvo =
        normDestino === normCanonicaAlvo ||
        eventosSaoEquivalentes(realoc.cobertura_destino, canonicaAlvo)

      if (destinoCasaComCanonicaAlvo) {
        // A cobertura de origem tem LMI > 0, então este evento está ATIVAMENTE coberto pela cia e alocado aqui!
        realocacoesParaEstaCanonica.push(realoc)
      }

      // Além disso, se o destino existe como cobertura cotada nesta proposta:
      const cobDestino = propostaAtual.coberturasCasadas.find(
        (c) =>
          normalizarTermoEquivalencia(c.canonica) === normDestino ||
          normalizarTermoEquivalencia(c.nomeOriginal) === normDestino,
      )
      if (cobDestino && Number(cobDestino.lmi || 0) > 0) {
        eventosRealocadosComCobertura.push(realoc.evento)
      }
    }
  }

  // Se a própria canônica alvo está sendo suprida por realocação com cobertura de origem ativa,
  // ou seja, a cia realocou evento para esta canônica (ex: Allianz realocou "Anúncios Luminosos" para "Anúncios/Letreiros Luminosos"):
  const temRealocacaoValidaParaCanonica = realocacoesParaEstaCanonica.length > 0

  // 3. Compara se algum evento coberto pelas outras ficou descoberto na proposta atual
  const descobertos: AlertaDescobertaEvento[] = []
  const vistosSemanticos = new Set<string>()

  for (const item of eventosCobertosNasOutras) {
    const evOutro = item.evento
    const semKey = normalizarEventoSemantico(evOutro)

    // Deduplicação de variantes na mesma célula
    let jaVisto = false
    for (const visto of vistosSemanticos) {
      if (eventosSaoEquivalentes(semKey, visto)) {
        jaVisto = true
        break
      }
    }
    if (jaVisto) continue

    // Verifica se está coberto diretamente na canônica atual
    const cobertoAquiDireto = eventosCobertosAquiLista.some((ev) =>
      eventosSaoEquivalentes(ev, evOutro),
    )

    // Verifica se está coberto por evento realocado geral
    const cobertoAquiRealocadoGeral = eventosRealocadosComCobertura.some((ev) =>
      eventosSaoEquivalentes(ev, evOutro),
    )

    // Verifica se a própria canônica alvo tem evento realocado para ela da mesma cia
    // (ex: a canônica de destino é "Anúncios/Letreiros Luminosos" e o evento realocado foi "Anúncios Luminosos"
    // ou se qualquer realocação para esta canônica casa por variantes com o evento testado)
    const cobertoPorRealocacaoCanonica = realocacoesParaEstaCanonica.some(
      (r) =>
        eventosSaoEquivalentes(r.evento, evOutro) ||
        // Regra do pacto: evento realocado nunca gera 'Segurado descoberto' na cia que o realocou;
        // qualquer evento coberto pelas outras nesta canônica alvo é satisfeito se a realocação para cá cobre a canônica
        eventosSaoEquivalentes(r.cobertura_destino, canonicaAlvo) ||
        eventosSaoEquivalentes(r.evento, canonicaAlvo),
    )

    const estaCoberto =
      cobertoAquiDireto ||
      cobertoAquiRealocadoGeral ||
      cobertoPorRealocacaoCanonica ||
      temRealocacaoValidaParaCanonica

    if (!estaCoberto) {
      vistosSemanticos.add(semKey)
      descobertos.push({
        evento: item.evento,
        ciaComCobertura: item.ciaComCobertura,
        coberturaOrigem: item.coberturaOrigem,
      })
    }
  }

  return descobertos
}
