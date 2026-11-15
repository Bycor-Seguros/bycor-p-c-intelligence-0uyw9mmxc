/**
 * cgIngestaoService — Ingestão de CGs na Biblioteca de CGs (Fase 2).
 *
 * Regra de ouro: NADA entra automaticamente — o leitor (cgIngestaoReader) só
 * EXTRAÍ o texto do PDF; o casamento com as canônicas usa o motor C3
 * (calcularSimilaridadeTexto + eventosSaoEquivalentes, nada de motor novo); a
 * confirmação passa pelo salvarSinonimo do motor C3. Nenhuma escrita em
 * cobertura_sinonimos sem confirmação humana.
 *
 * Guarda de re-ingestão: mesmo desenho do dedupe de cobertura do QAR
 * (calcularLinhasOrfasQar): casamento por nome normalizado + cia, tolerante a
 * sufixo — reenviar o PDF da mesma cia/produto não duplica sinônimos.
 */

import pb from '@/lib/pocketbase/client'
import type { PdfPageText } from './pdfTextExtractor'
import { lerCondicoesGerais, chaveGuardaCg, guardasIguaisCg } from './cgIngestaoReader'
import {
  calcularSimilaridadeTexto,
  eventosSaoEquivalentes,
  salvarSinonimo,
  listarTaxonomiaCanonicas,
  type CoberturaCanonicaRecord,
} from './equivalenciaCoberturasService'

// ---------------------------------------------------------------------------
// Tipos de fila de revisão
// ---------------------------------------------------------------------------

export type CgIngestaoStatus = 'pendente' | 'confirmado' | 'rejeitado'
export type CgIngestaoDestino = 'candidato_cg_nova' | 'exclusao_nao_cobre'

export interface CgIngestaoItemFila {
  id?: string
  tipoItem: 'cobertura' | 'exclusao'
  nomeExtraido: string
  secaoOrigem: string
  pagina: number
  slotY: number
  exclusoes: string[]
  // sugestão do motor C3
  sugestaoCanonicaId: string
  sugestaoCanonicaNome: string
  confianca: number
  matchType: string
  status: CgIngestaoStatus
  destinoRejeicao?: CgIngestaoDestino
  sinonimoGravadoId?: string
}

export interface CgIngestaoSessao {
  id?: string
  seguradoraId: string
  seguradoraNome: string
  produtoVersao: string
  processoSusep: string
  fonteArquivo: string
  totalItens: number
  totalExclusoes: number
  itens: CgIngestaoItemFila[]
}

export interface CgIngestaoItemRecord {
  id: string
  ingestao: string
  tipo_item: string
  chave_normalizada: string
  nome_extraido: string
  secao_origem: string
  pagina: number
  slot_y: number
  sugestao_canonica_id: string
  sugestao_canonica_nome: string
  confianca: number
  match_type: string
  exclusoes: string[] | { exclusoes?: string[] }
  status: string
  destino_rejeicao: string
  sinonimo_gravado_id: string
  revisado_por: string
  revisado_em: string
  observacao: string
  expand?: { ingestao?: CgIngestaoRecord }
}

export interface CgIngestaoRecord {
  id: string
  seguradora: string
  seguradora_nome: string
  produto_versao: string
  processo_susep: string
  total_itens: number
  total_exclusoes: number
  fonte_arquivo: string
  usuario_email: string
  created: string
  expand?: { seguradora?: { nome: string } }
}

// ---------------------------------------------------------------------------
// Casamento via motor C3 (sem motor novo)
// ---------------------------------------------------------------------------

/** Limiar de confiança para sugestão firme (abaixo disso: revisão sem sugestão). */
export const LIMIAR_CONFIANCA_CG = 0.72

export interface CasamentoC3 {
  canonicaId: string
  canonicaNome: string
  confianca: number
  matchType: 'exata' | 'similaridade' | 'sem_sugestao'
}

/** Casamento por similaridade via motor C3 contra a taxonomia canônica. */
export function casarComMotorC3(
  nomeExtraido: string,
  canonicas: CoberturaCanonicaRecord[],
): CasamentoC3 {
  const norm = nomeExtraido.trim()
  if (!norm || canonicas.length === 0) {
    return { canonicaId: '', canonicaNome: '', confianca: 0, matchType: 'sem_sugestao' }
  }

  let melhor: CoberturaCanonicaRecord | null = null
  let melhorScore = 0

  for (const can of canonicas) {
    let score = calcularSimilaridadeTexto(norm, can.nome)
    // evento típico declarado equivalente ao nome extraído é sinal forte
    for (const ev of can.eventos_tipicos || []) {
      if (eventosSaoEquivalentes(ev, norm)) {
        score = Math.max(score, 0.85)
        break
      }
    }
    if (score > melhorScore) {
      melhorScore = score
      melhor = can
    }
  }

  if (melhor && melhorScore >= LIMIAR_CONFIANCA_CG) {
    return {
      canonicaId: melhor.id,
      canonicaNome: melhor.nome,
      confianca: Math.round(melhorScore * 100) / 100,
      matchType: melhorScore === 1 ? 'exata' : 'similaridade',
    }
  }
  return {
    canonicaId: '',
    canonicaNome: '',
    confianca: Math.round(melhorScore * 100) / 100,
    matchType: 'sem_sugestao',
  }
}

// ---------------------------------------------------------------------------
// Guarda de re-ingestão (espelho de calcularLinhasOrfasQar do QAR)
// ---------------------------------------------------------------------------

/**
 * Guarda de re-ingestão: entre os itens CONFIRMADOS de uma mesma cia, os que
 * casam (nome normalizado + cia, tolerante a sufixo) com a nova leitura NÃO
 * são reconfirmados nem duplicados.
 */
export function calcularItensGuardaCg(
  confirmadosExistentes: Array<{ id: string; chave_normalizada: string; nome_extraido: string }>,
  chavesNovaLeitura: string[],
): Array<{ id: string; acao: 'nao_duplicar' | 'revisar' }> {
  const resultado: Array<{ id: string; acao: 'nao_duplicar' | 'revisar' }> = []
  const novaSet = new Set(chavesNovaLeitura.map((c) => (c || '').trim()).filter(Boolean))

  for (const ex of confirmadosExistentes) {
    const chaveEx = (ex.chave_normalizada || ex.nome_extraido || '').trim()
    if (!chaveEx) continue
    if (novaSet.has(chaveEx)) {
      resultado.push({ id: ex.id, acao: 'nao_duplicar' })
      continue
    }
    // tolerância a sufixo: chave antiga que estende a nova casa
    const casaPorSufixo = Array.from(novaSet).some(
      (n) => guardasIguaisCg(chaveEx, n) && chaveEx !== n,
    )
    resultado.push({ id: ex.id, acao: casaPorSufixo ? 'nao_duplicar' : 'revisar' })
  }
  return resultado
}

// ---------------------------------------------------------------------------
// Extração (parser → fila)
// ---------------------------------------------------------------------------

/**
 * Roda o leitor de CG e monta a fila de revisão com sugestões do motor C3.
 * NÃO escreve nada no banco.
 */
export async function processarCgParaRevisao(params: {
  pages: PdfPageText[]
  seguradoraId: string
  seguradoraNome: string
}): Promise<CgIngestaoSessao> {
  const leitura = lerCondicoesGerais(params.pages)
  const canonicas = await listarTaxonomiaCanonicas()

  const itens: CgIngestaoItemFila[] = leitura.itens.map((it) => {
    const casamento =
      it.tipoItem === 'cobertura'
        ? casarComMotorC3(it.nomeExtraido, canonicas)
        : { canonicaId: '', canonicaNome: '', confianca: 0, matchType: 'sem_sugestao' }
    return {
      tipoItem: it.tipoItem,
      nomeExtraido: it.nomeExtraido,
      secaoOrigem: it.secaoOrigem,
      pagina: it.pagina,
      slotY: it.slotY,
      exclusoes: it.exclusoes.map((e) => e.texto),
      sugestaoCanonicaId: casamento.canonicaId,
      sugestaoCanonicaNome: casamento.canonicaNome,
      confianca: casamento.confianca,
      matchType: casamento.matchType,
      status: 'pendente',
    }
  })

  return {
    seguradoraId: params.seguradoraId,
    seguradoraNome: params.seguradoraNome,
    produtoVersao: leitura.produtoVersaoDetectado,
    processoSusep: leitura.processoSusepDetectado,
    fonteArquivo: '',
    totalItens: itens.filter((i) => i.tipoItem === 'cobertura').length,
    totalExclusoes: itens.reduce((acc, i) => acc + i.exclusoes.length, 0),
    itens,
  }
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

function mapItemToRecord(it: CgIngestaoItemFila, ingestaoId: string): Record<string, unknown> {
  return {
    ingestao: ingestaoId,
    tipo_item: it.tipoItem,
    chave_normalizada: chaveGuardaCg(it.nomeExtraido),
    nome_extraido: it.nomeExtraido,
    secao_origem: it.secaoOrigem,
    pagina: it.pagina,
    slot_y: it.slotY,
    sugestao_canonica_id: it.sugestaoCanonicaId || '',
    sugestao_canonica_nome: it.sugestaoCanonicaNome || '',
    confianca: it.confianca,
    match_type: it.matchType,
    exclusoes: it.exclusoes,
    status: it.status,
    destino_rejeicao: it.destinoRejeicao || null,
    sinonimo_gravado_id: it.sinonimoGravadoId || '',
    observacao: '',
  }
}

/** Cria a sessão de ingestão (cg_ingestoes) e grava os itens como pendentes. */
export async function salvarSessaoIngestao(sessao: CgIngestaoSessao): Promise<string> {
  const ingestao = await pb.collection('cg_ingestoes').create({
    seguradora: sessao.seguradoraId,
    seguradora_nome: sessao.seguradoraNome,
    produto_versao: sessao.produtoVersao,
    processo_susep: sessao.processoSusep,
    total_itens: sessao.totalItens,
    total_exclusoes: sessao.totalExclusoes,
    fonte_arquivo: sessao.fonteArquivo,
  })
  for (const it of sessao.itens) {
    await pb.collection('cg_ingestao_itens').create(mapItemToRecord(it, ingestao.id))
  }
  return ingestao.id
}

/**
 * CONFIRMA um item da fila: grava o sinônimo via salvarSinonimo do motor C3
 * (única escrita em cobertura_sinonimos, sempre com confirmação humana) e
 * marca o item como confirmado.
 */
export async function confirmarItemIngestao(params: {
  itemRecordId: string
  item: CgIngestaoItemFila
  seguradoraId: string
  seguradoraNome: string
  canonicaId?: string
  canonicaNome: string
  usuarioId?: string
  observacao?: string
}): Promise<{ sinonimoId: string }> {
  const canonicaId = params.canonicaId || params.item.sugestaoCanonicaId
  const canonicaNome = params.canonicaNome || params.item.sugestaoCanonicaNome

  const sinonimo = await salvarSinonimo({
    alias: params.item.nomeExtraido,
    seguradoraId: params.seguradoraId,
    seguradoraNome: params.seguradoraNome,
    coberturaCanonicaId: canonicaId,
    canonicaNome,
    eventosExcluidos: params.item.exclusoes,
    observacao: params.observacao || 'Ingestão de CG (Biblioteca de CGs)',
  })

  await pb.collection('cg_ingestao_itens').update(params.itemRecordId, {
    status: 'confirmado',
    destino_rejeicao: null,
    sinonimo_gravado_id: sinonimo.id,
    revisado_por: params.usuarioId || null,
    revisado_em: new Date().toISOString(),
    observacao: params.observacao || '',
  })

  return { sinonimoId: sinonimo.id }
}

/** REJEITA um item: candidato a CG nova ou exclusão "não cobre" — nunca cria CG. */
export async function rejeitarItemIngestao(params: {
  itemRecordId: string
  destino: CgIngestaoDestino
  usuarioId?: string
  observacao?: string
}): Promise<void> {
  await pb.collection('cg_ingestao_itens').update(params.itemRecordId, {
    status: 'rejeitado',
    destino_rejeicao: params.destino,
    revisado_por: params.usuarioId || null,
    revisado_em: new Date().toISOString(),
    observacao: params.observacao || '',
  })
}

/** Lista as sessões de ingestão (histórico na tela). */
export async function listarIngestoes(): Promise<CgIngestaoRecord[]> {
  return await pb.collection('cg_ingestoes').getFullList<CgIngestaoRecord>({
    sort: '-created',
  })
}

/** Lista os itens de uma sessão (fila persistida). */
export async function listarItensIngestao(ingestaoId: string): Promise<CgIngestaoItemRecord[]> {
  return await pb.collection('cg_ingestao_itens').getFullList<CgIngestaoItemRecord>({
    filter: `ingestao="${ingestaoId}"`,
    sort: 'pagina,slot_y',
  })
}

// ---------------------------------------------------------------------------
// Retomada de sessão (só leitura — motor C3, guarda e salvarSinonimo intactos)
// ---------------------------------------------------------------------------

export interface SessaoPendenteResumo {
  ingestao: CgIngestaoRecord
  pendentes: number
  total: number
}

/**
 * Painel "Sessões de ingestão pendentes": sessões com pelo menos 1 item
 * pendente, com contagem pendentes/total. Só leitura.
 */
export async function listarSessoesPendentes(): Promise<SessaoPendenteResumo[]> {
  const [sessoes, itens] = await Promise.all([
    pb.collection('cg_ingestoes').getFullList<CgIngestaoRecord>({ sort: '-created' }),
    pb.collection('cg_ingestao_itens').getFullList<{ ingestao: string; status: string }>({
      filter: '',
      sort: 'created',
    }),
  ])
  const contagem = new Map<string, { pendentes: number; total: number }>()
  for (const it of itens) {
    const c = contagem.get(it.ingestao) || { pendentes: 0, total: 0 }
    c.total++
    if (it.status === 'pendente') c.pendentes++
    contagem.set(it.ingestao, c)
  }
  return sessoes
    .map((s) => ({ ingestao: s, ...(contagem.get(s.id) || { pendentes: 0, total: 0 }) }))
    .filter((s) => s.pendentes > 0)
}

/** Item retomado: fila da sessão com o id do registro persistido (para atualizar sem re-buscar). */
export interface CgIngestaoItemRetomada extends CgIngestaoItemFila {
  itemRecordId: string
}

/** Campo JSON `exclusoes` pode virar array puro ou objeto com a chave `exclusoes`. */
function normalizarExclusoesRecord(ex: CgIngestaoItemRecord['exclusoes']): string[] {
  if (Array.isArray(ex)) return ex
  if (ex && typeof ex === 'object' && Array.isArray(ex.exclusoes)) return ex.exclusoes
  return []
}

/**
 * Recarrega a fila de revisão de uma sessão persistida SEM re-extrair o PDF:
 * sessão + itens (nome, página, exclusões, status) direto do banco. Itens já
 * confirmados/rejeitados voltam com o status gravado — nunca reaparecem como
 * pendentes nem são duplicados.
 */
export async function carregarSessaoParaRetomada(ingestaoId: string): Promise<{
  sessao: CgIngestaoRecord
  itens: CgIngestaoItemRetomada[]
}> {
  const [sessao, registros] = await Promise.all([
    pb.collection('cg_ingestoes').getOne<CgIngestaoRecord>(ingestaoId),
    listarItensIngestao(ingestaoId),
  ])
  const itens: CgIngestaoItemRetomada[] = registros.map((r) => ({
    itemRecordId: r.id,
    tipoItem: r.tipo_item === 'exclusao' ? 'exclusao' : 'cobertura',
    nomeExtraido: r.nome_extraido,
    secaoOrigem: r.secao_origem || r.nome_extraido,
    pagina: r.pagina ?? 0,
    slotY: r.slot_y ?? 0,
    exclusoes: normalizarExclusoesRecord(r.exclusoes),
    sugestaoCanonicaId: r.sugestao_canonica_id || '',
    sugestaoCanonicaNome: r.sugestao_canonica_nome || '',
    confianca: r.confianca ?? 0,
    matchType: r.match_type || 'sem_sugestao',
    status: (['confirmado', 'rejeitado'].includes(r.status)
      ? r.status
      : 'pendente') as CgIngestaoStatus,
    destinoRejeicao: (r.destino_rejeicao || undefined) as CgIngestaoItemFila['destinoRejeicao'],
    sinonimoGravadoId: r.sinonimo_gravado_id || undefined,
  }))
  return { sessao, itens }
}
