/**
 * portalC1Service.ts
 *
 * Serviço de apoio ao Portal Duplo de Entrada da C1 (Recebimento):
 * - Conta Nova (recebimento do Cartão de Risco do cliente)
 * - Renovação (parte do Cartão de Risco do ano anterior já extraído no sistema)
 *
 * Regras do usuário:
 * 1. Escolha explícita registrada no processo (tipo_porta: 'conta_nova' | 'renovacao').
 * 2. Na porta 'Renovação', identificar automaticamente a apólice antecessora da conta:
 *    mesmo empreendimento, mesmo ramo, vigência imediatamente anterior.
 * 3. Badge clicável 'Oportunidades Registradas' com as oportunidades daquela conta
 *    vindas de `notas_base` com marca `[Oportunidade Detectada]` e estado registrada.
 *    Cada item mostra tipo, justificativa e data.
 * 4. Indicar claramente quando NÃO for encontrada apólice antecessora, oferecendo
 *    o caminho de 'Conta Nova' como fallback.
 * 5. Apenas leitura em `notas_base`: nada grava automaticamente sem decisão do analista.
 */

import pb from '@/lib/pocketbase/client'
import { normalizarRamoParaSucessao } from '@/services/apoliceStatusService'

export type TipoPortaEntrada = 'conta_nova' | 'renovacao'

export interface OportunidadeRegistradaNota {
  id: string
  titulo: string
  tipo: string
  tipoRotulo: string
  item: string
  seguradora: string
  impacto: string
  justificativa: string
  acaoRecomendada: string
  registradoEm: string
  conteudoOriginal: string
}

export interface EmpreendimentoItem {
  id: string
  nome: string
  razaoSocial?: string
  cnpj?: string
}

export interface ApoliceAntecessoraInfo {
  id: string
  numeroApolice: string
  seguradora: string
  ramo: string
  ramoNormalizado: string
  dataInicio: string
  dataFim: string
  lmiBasica?: number
  vrdDm?: number
  lmga?: number
  status?: string
}

export interface CartaoRiscoAntecessorInfo {
  id: string
  nomeArquivo: string
  versao: string
  data: string
  arquivoUrl?: string
}

export interface ContextoRenovacaoConta {
  empreendimento: EmpreendimentoItem
  apoliceAntecessora: ApoliceAntecessoraInfo | null
  cartaoRiscoAntecessor: CartaoRiscoAntecessorInfo | null
  todasApolicesConta: ApoliceAntecessoraInfo[]
  ramosDisponiveis: string[]
  oportunidadesRegistradas: OportunidadeRegistradaNota[]
  temAntecessoraValida: boolean
}

/**
 * Converte data (YYYY-MM-DD ou ISO) em timestamp numérico para ordenação.
 */
function parseDataTimestamp(d?: string | null): number {
  if (!d) return 0
  const clean = d.slice(0, 10)
  const dt = new Date(clean)
  const t = dt.getTime()
  return isNaN(t) ? 0 : t
}

/**
 * Parser do conteúdo de notas_base com marca [Oportunidade Detectada].
 */
export function parseNotaOportunidade(
  id: string,
  titulo: string,
  conteudo: string,
  created: string,
): OportunidadeRegistradaNota {
  // Exemplo de título: "[Oportunidade Detectada] VRD sem Atualização: BTT Faria Lima"
  // ou "[Oportunidade Detectada] Cobertura Abaixo do Padrão: Hotel ABC"
  let tipoRotulo = 'Oportunidade'
  let item = ''

  const cleanTitulo = titulo.replace(/^\[Oportunidade Detectada\]\s*/i, '').trim()
  const sepIdx = cleanTitulo.indexOf(':')
  if (sepIdx > -1) {
    tipoRotulo = cleanTitulo.substring(0, sepIdx).trim()
    item = cleanTitulo.substring(sepIdx + 1).trim()
  } else {
    tipoRotulo = cleanTitulo
  }

  let tipo = 'geral'
  let impacto = 'Médio'
  let seguradora = 'Geral'
  let justificativa = ''
  let acaoRecomendada = ''
  let registradoEm = created ? new Date(created).toLocaleDateString('pt-BR') : ''

  const linhas = (conteudo || '').split('\n')
  for (const linha of linhas) {
    const l = linha.trim()
    if (l.startsWith('Tipo:')) {
      const matchTipo = l.match(/Tipo:\s*([^|]+)/i)
      if (matchTipo) tipo = matchTipo[1].trim()
      const matchImp = l.match(/Impacto:\s*([^|]+)/i)
      if (matchImp) impacto = matchImp[1].trim()
    } else if (l.startsWith('Item:')) {
      if (!item) item = l.replace(/^Item:\s*/i, '').trim()
    } else if (l.startsWith('Seguradora:')) {
      seguradora = l.replace(/^Seguradora:\s*/i, '').trim()
    } else if (l.startsWith('Justificativa:')) {
      justificativa = l.replace(/^Justificativa:\s*/i, '').trim()
    } else if (l.startsWith('Ação Recomendada:') || l.startsWith('Acao Recomendada:')) {
      acaoRecomendada = l.replace(/^A[cç][aã]o Recomendada:\s*/i, '').trim()
    } else if (l.startsWith('Registrado por analista Bycor em:')) {
      registradoEm = l.replace(/^Registrado por analista Bycor em:\s*/i, '').trim()
    }
  }

  // Fallback caso justificativa não venha com tag explícita
  if (!justificativa && conteudo) {
    justificativa = conteudo.split('\n')[0].slice(0, 160)
  }

  return {
    id,
    titulo,
    tipo,
    tipoRotulo,
    item: item || tipoRotulo,
    seguradora,
    impacto,
    justificativa: justificativa || 'Oportunidade identificada na auditoria da carteira.',
    acaoRecomendada,
    registradoEm: registradoEm || (created ? new Date(created).toLocaleDateString('pt-BR') : '—'),
    conteudoOriginal: conteudo,
  }
}

/**
 * Busca todas as oportunidades registradas em notas_base para uma conta (empreendimento / nome / CNPJ).
 * Apenas leitura — não grava nada.
 */
export async function carregarOportunidadesRegistradasConta(
  empreendimentoNome: string,
  cnpj?: string,
  empreendimentoId?: string,
): Promise<OportunidadeRegistradaNota[]> {
  try {
    // Busca todas as notas_base marcadas com [Oportunidade Detectada]
    const records = await pb.collection('notas_base').getFullList({
      filter: `titulo ~ '[Oportunidade Detectada]'`,
      sort: '-created',
    })

    const nomeNorm = (empreendimentoNome || '').trim().toLowerCase()
    const cnpjClean = (cnpj || '').replace(/\D/g, '')

    const matches: OportunidadeRegistradaNota[] = []

    for (const rec of records) {
      const parsed = parseNotaOportunidade(
        rec.id,
        String(rec.titulo || ''),
        String(rec.conteudo || ''),
        String(rec.created || ''),
      )

      const recTextoCompleto = `${rec.titulo} ${rec.conteudo}`.toLowerCase()

      // Casamento por nome da conta ou CNPJ ou ID
      const casouPorNome =
        nomeNorm.length >= 3 &&
        (recTextoCompleto.includes(nomeNorm) ||
          nomeNorm
            .split(/\s+/)
            .some((token) => token.length >= 4 && recTextoCompleto.includes(token)))

      const casouPorCnpj =
        cnpjClean.length >= 8 && recTextoCompleto.replace(/\D/g, '').includes(cnpjClean)

      const casouPorId =
        empreendimentoId && recTextoCompleto.includes(empreendimentoId.toLowerCase())

      if (casouPorNome || casouPorCnpj || casouPorId) {
        matches.push(parsed)
      }
    }

    return matches
  } catch (err) {
    console.warn('Erro ao carregar oportunidades registradas de notas_base:', err)
    return []
  }
}

/**
 * Identifica a apólice antecessora de uma conta:
 * Critério: mesmo empreendimento, mesmo ramo (normalizado), vigência imediatamente anterior à referência.
 * Se nenhum ramo for especificado, busca a apólice mais recente e deriva o ramo.
 */
export function selecionarApoliceAntecessora(
  todasApolices: ApoliceAntecessoraInfo[],
  ramoFiltro?: string | null,
  dataReferenciaVigencia?: string | null,
): ApoliceAntecessoraInfo | null {
  if (!todasApolices || todasApolices.length === 0) return null

  // Filtra pelo ramo normalizado se fornecido
  let candidatas = todasApolices
  if (ramoFiltro && ramoFiltro.trim() && ramoFiltro !== 'todos') {
    const ramoNormAlvo = normalizarRamoParaSucessao(ramoFiltro)
    const porRamo = todasApolices.filter((a) => a.ramoNormalizado === ramoNormAlvo)
    if (porRamo.length > 0) {
      candidatas = porRamo
    }
  }

  // Se houver data de referência (ex: vigência da nova proposta/processo),
  // a antecessora é a apólice com data_fim <= dataReferencia ou com data_fim imediatamente anterior.
  const refMs = dataReferenciaVigencia ? parseDataTimestamp(dataReferenciaVigencia) : Infinity

  // Ordena por dataFim decrescente (mais recente primeiro)
  const ordenadas = [...candidatas].sort((a, b) => {
    const tA = parseDataTimestamp(a.dataFim || a.dataInicio)
    const tB = parseDataTimestamp(b.dataFim || b.dataInicio)
    return tB - tA
  })

  // 1. Tenta a apólice com fim anterior ou igual à referência
  if (refMs !== Infinity) {
    const antesRef = ordenadas.find((a) => {
      const fimMs = parseDataTimestamp(a.dataFim)
      return fimMs <= refMs
    })
    if (antesRef) return antesRef
  }

  // 2. Fallback: apólice mais recente registrada no sistema para este ramo
  return ordenadas[0] || null
}

/**
 * Carrega o contexto completo da porta de Renovação para uma conta/empreendimento selecionado:
 * - Empreendimento
 * - Apólices do empreendimento
 * - Apólice antecessora identificada
 * - Cartão de Risco do ano anterior arquivado em documentos
 * - Oportunidades registradas em notas_base
 */
export async function carregarContextoRenovacaoConta(
  empreendimentoId: string,
  ramoSelecionado?: string | null,
): Promise<ContextoRenovacaoConta | null> {
  try {
    // 1. Carrega dados do empreendimento
    const empRec = await pb.collection('empreendimentos').getOne(empreendimentoId)
    const empNome = empRec.nome_empreendimento || empRec.razao_social || 'Conta'
    const empreendimento: EmpreendimentoItem = {
      id: empRec.id,
      nome: empNome,
      razaoSocial: empRec.razao_social,
      cnpj: empRec.cnpj,
    }

    // 2. Carrega todas as apólices vinculadas a este empreendimento
    let apolicesList: any[] = []
    try {
      apolicesList = await pb.collection('apolices').getFullList({
        filter: `id_empreendimento="${empreendimentoId}"`,
        sort: '-data_fim,-created',
      })
    } catch (e) {
      console.warn('Erro ao buscar apólices do empreendimento:', e)
    }

    const todasApolicesConta: ApoliceAntecessoraInfo[] = apolicesList.map((a) => ({
      id: a.id,
      numeroApolice: a.numero_apolice || a.id_apolice || 'Sem número',
      seguradora: a.seguradora || '—',
      ramo: a.ramo || 'Geral',
      ramoNormalizado: normalizarRamoParaSucessao(a.ramo),
      dataInicio: a.data_inicio || '',
      dataFim: a.data_fim || '',
      lmiBasica: a.lmi_incendio_basica,
      vrdDm: a.valor_em_risco_dm,
      lmga: a.lmga,
      status: a.status,
    }))

    // Ramos distintos disponíveis nesta conta
    const ramosSet = new Set<string>()
    todasApolicesConta.forEach((a) => {
      if (a.ramo && a.ramo !== '—') ramosSet.add(a.ramo)
    })
    const ramosDisponiveis = Array.from(ramosSet)

    // 3. Identifica apólice antecessora
    const apoliceAntecessora = selecionarApoliceAntecessora(
      todasApolicesConta,
      ramoSelecionado || (ramosDisponiveis[0] ?? null),
    )

    // 4. Carrega Cartão de Risco do ano anterior em documentos
    let cartaoRiscoAntecessor: CartaoRiscoAntecessorInfo | null = null
    try {
      const docs = await pb.collection('documentos').getFullList({
        filter: `vinculado_empreendimento="${empreendimentoId}" && tipo="Cartão de Risco"`,
        sort: '-data,-created',
      })
      if (docs.length > 0) {
        const d = docs[0]
        let arquivoUrl = ''
        if (d.arquivo) {
          arquivoUrl = pb.files.getURL(d, d.arquivo)
        }
        cartaoRiscoAntecessor = {
          id: d.id,
          nomeArquivo: d.arquivo || 'cartao_risco_anterior.xlsx',
          versao: d.versao || 'Cartão de Risco Anterior',
          data: d.data ? String(d.data).slice(0, 10) : '',
          arquivoUrl,
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar documentos do cartão de risco anterior:', e)
    }

    // 5. Carrega oportunidades registradas em notas_base (somente leitura)
    const oportunidadesRegistradas = await carregarOportunidadesRegistradasConta(
      empNome,
      empRec.cnpj,
      empreendimentoId,
    )

    const temAntecessoraValida = Boolean(apoliceAntecessora)

    return {
      empreendimento,
      apoliceAntecessora,
      cartaoRiscoAntecessor,
      todasApolicesConta,
      ramosDisponiveis,
      oportunidadesRegistradas,
      temAntecessoraValida,
    }
  } catch (err) {
    console.error('Erro ao montar contexto de renovação:', err)
    return null
  }
}
