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
import { criarItensEmLotes } from './pocketbaseWriteHelper' // ondas de creates individuais (sem /api/batch)
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
  /** Arquivo PDF da CG (cg_ingestoes.arquivo, field file do PocketBase). */
  arquivoPdf?: File | null
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
  /** Nome do arquivo PDF anexado (vazio = sessão antiga sem PDF). */
  arquivo: string
  usuario_email: string
  created: string
  /** Chave de idempotência da sessão (v0.0.207, migration 0050). */
  chave_ingestao?: string
  /** Itens já gravados quando a gravação falhou no meio (v0.0.207). */
  itens_gravados?: number
  /** Gravação interrompida no meio — regravar os itens faltantes pela sessão. */
  ingestao_incompleta?: boolean
  expand?: { seguradora?: { nome: string } }
}

/**
 * URL do PDF anexado à sessão (para o visualizador pdf.js). O PocketBase
 * expõe o arquivo em /api/files/{collectionIdOrName}/{recordId}/{filename};
 * como o campo não é `protected`, nenhuma URL assinada é necessária.
 */
export function urlArquivoPdfSessao(sessao: Pick<CgIngestaoRecord, 'id' | 'arquivo'>): string {
  if (!sessao?.id || !sessao?.arquivo) return ''
  const recordStub = { id: sessao.id, collectionName: 'cg_ingestoes' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pb.files.getURL(recordStub as any, sessao.arquivo)
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

/**
 * Cria a sessão de ingestão (cg_ingestoes) e grava os itens como pendentes em
 * ONDAS de requisições INDIVIDUAIS (pocketbaseWriteHelper.criarItensEmLotes:
 * POST /api/collections/cg_ingestao_itens/records, 20 por onda, com pausa/retry
 * progressivo no 429). SEM /api/batch — o Skip Cloud responde 403 "Batch
 * requests are not allowed.".
 *
 * Idempotência (regra: retentar NUNCA cria sessão duplicada nem itens
 * duplicados):
 * 1. Sessão — se `idempotenciaKey` casar com uma sessão existente
 *    (chave_ingestao), ela é REAPROVEITADA (update dos metadados), nunca
 *    recriada. A UNICIDADE é garantida por índice único parcial no banco
 *    (migration 0050) — mesmo com a fila perdida na memória ao fechar o modal,
 *    retomar e Confirmar de novo reaproveita a MESMA sessão.
 * 2. Itens — o 1º lote bem-sucedido avança `itens_gravados`; falha no meio
 *    devolve { sucesso: false, sessao, itensGravados } SEM lançar: a fila
 *    continua na memória do modal e `regravarItensFaltantes` completa o resto
 *    pela MESMA sessão, sem duplicar. A sessão fica marcada com
 *    ingestao_incompleta=true, e o total cheio só é gravado quando TUDO entra.
 *
 * Helpers definidos após listarSessoesPendentes (fim do arquivo):
 * idempotenciaSessoes, chaveIdempotenciaParaFiltro, listarChavesGravadas,
 * fecharTotaisSessao, contarItens.
 */
export async function salvarSessaoIngestao(
  sessao: CgIngestaoSessao,
  idempotenciaKey?: string,
): Promise<{
  sucesso: boolean
  sessao: CgIngestaoRecord
  itensGravados: number
  erro?: string
}> {
  if (!sessao.itens.length) {
    throw new Error('Nenhum item para gravar — a fila de revisão está vazia.')
  }

  // ---- Sessão única por ingestão (chave de idempotência) ----
  let ingestao: CgIngestaoRecord | null = null
  if (idempotenciaKey) {
    // (1) in-memory (2ª tentativa na mesma aba), (2) banco (aba recarregada,
    // fila perdida, retomada pelo painel de sessões pendentes).
    const local = idempotenciaSessoes.get(idempotenciaKey)
    if (local) {
      ingestao = local
    } else {
      const chave = chaveIdempotenciaParaFiltro(idempotenciaKey)
      try {
        ingestao = (await pb
          .collection('cg_ingestoes')
          .getFirstListItem(`chave_ingestao="${chave}"`)) as unknown as CgIngestaoRecord
        idempotenciaSessoes.set(idempotenciaKey, ingestao)
      } catch (_) {
        ingestao = null // nenhuma sessão com essa chave — cria abaixo
      }
    }
  }

  if (!ingestao) {
    ingestao = (await pb.collection('cg_ingestoes').create({
      seguradora: sessao.seguradoraId,
      seguradora_nome: sessao.seguradoraNome,
      produto_versao: sessao.produtoVersao,
      processo_susep: sessao.processoSusep,
      chave_ingestao: idempotenciaKey ? chaveIdempotenciaParaFiltro(idempotenciaKey) : '',
      // total cheio só quando TUDO está gravado (evita "totais cheios,
      // itens faltando" — o painel usa itens_gravados para o badge).
      total_itens: 0,
      total_exclusoes: 0,
      itens_gravados: 0,
      ingestao_incompleta: true,
      fonte_arquivo: sessao.fonteArquivo,
      // PDF da CG anexado à sessão (quando o upload veio com arquivo).
      ...(sessao.arquivoPdf ? { arquivo: sessao.arquivoPdf } : {}),
    })) as unknown as CgIngestaoRecord
    if (idempotenciaKey) idempotenciaSessoes.set(idempotenciaKey, ingestao)
  } else {
    // Sessão reaproveitada: atualiza metadados (produto/processo podem ter sido
    // detectados/corrigidos entre uma tentativa e outra) sem recriar nada.
    await pb.collection('cg_ingestoes').update(ingestao.id, {
      seguradora: sessao.seguradoraId,
      seguradora_nome: sessao.seguradoraNome,
      produto_versao: sessao.produtoVersao,
      processo_susep: sessao.processoSusep,
      ...(sessao.arquivoPdf ? { arquivo: sessao.arquivoPdf } : {}),
    })

    ingestao = {
      ...ingestao,
      produto_versao: sessao.produtoVersao,
      processo_susep: sessao.processoSusep,
    }
  }

  // ---- Itens em ondas de creates individuais com retry no 429 ----
  // Itens já gravados NÃO são recriados (sessão reaproveitada no retry): cada
  // item tem a chave_normalizada (chaveGuardaCg) — os que já estão no banco são
  // pulados, só os faltantes vão para criarItensEmLotes.
  const gravados = await listarChavesGravadas(ingestao.id)
  const faltantes = sessao.itens.filter((it) => !gravados.has(chaveGuardaCg(it.nomeExtraido)))

  if (!faltantes.length) {
    // Tudo já está no banco (sessão criada e completa) — fecha os totais.
    const fechada = await fecharTotaisSessao(ingestao, {
      totalItens: sessao.itens.length,
      totalExclusoes: sessao.itens.reduce((soma, it) => soma + (it.exclusoes?.length ?? 0), 0),
    })
    return { sucesso: true, sessao: fechada, itensGravados: sessao.itens.length }
  }

  const resultado = await criarItensEmLotes(
    faltantes.map((it) => mapItemToRecord(it, ingestao.id)),
    'cg_ingestao_itens',
  )
  if (!resultado.sucesso) {
    // Meio do caminho: DEVOLVE (não lança) com o progresso — a fila segue no
    // modal e o painel mostra a sessão como "ingestão incompleta" para
    // regravar os faltantes pela MESMA sessão. Nada de "totais cheios".
    return {
      sucesso: false,
      sessao: ingestao,
      itensGravados: gravados.size + resultado.gravados,
      erro: resultado.erro,
    }
  }

  const fechada = await fecharTotaisSessao(ingestao, {
    totalItens: sessao.itens.length,
    totalExclusoes: sessao.itens.reduce((soma, it) => soma + (it.exclusoes?.length ?? 0), 0),
  })
  return { sucesso: true, sessao: fechada, itensGravados: sessao.itens.length }
}

/** regravarItensFaltantes está no final do arquivo (após listarSessoesPendentes). */
/**
 * ATUALIZA os metadados editáveis da sessão (produto/versão e processo SUSEP)
 * no próprio registro cg_ingestoes — usado na retomada, onde o analista pode
 * corrigir/completar os dois campos sem re-extrair o PDF. Escopo restrito à
 * sessão: NUNCA propaga para cobertura_sinonimos nem valida divergência.
 */
export async function atualizarMetadadosSessao(
  ingestaoId: string,
  metadados: { produtoVersao: string; processoSusep: string },
): Promise<CgIngestaoRecord> {
  return (await pb.collection('cg_ingestoes').update(ingestaoId, {
    produto_versao: metadados.produtoVersao,
    processo_susep: metadados.processoSusep,
  })) as unknown as CgIngestaoRecord
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
  /**
   * Sessão 100% revisada (0 pendentes) que entrou no painel só porque está
   * sem produto_versao OU processo_susep — badge "Certificação incompleta".
   */
  certificacaoIncompleta: boolean
  /**
   * Gravação dos itens falhou no meio (429) e a sessão ficou com itens
   * faltando — badge "Ingestão incompleta"; retomar e regravar os faltantes.
   */
  ingestaoIncompleta: boolean
}

/**
 * Painel "Sessões de ingestão pendentes": sessões com pelo menos 1 item
 * pendente (contagem pendentes/total), sessões com gravação interrompida no
 * meio (ingestao_incompleta=true, badge "Ingestão incompleta" — regravar os
 * itens faltantes pela MESMA sessão) OU sessões 100% revisadas que ainda estão
 * sem produto_versao / processo_susep ("Certificação incompleta") — para o
 * analista retomá-las. Só leitura.
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
    .map((s) => ({
      ...s,
      certificacaoIncompleta:
        s.pendentes === 0 &&
        (!(s.ingestao.produto_versao || '').trim() || !(s.ingestao.processo_susep || '').trim()),
      ingestaoIncompleta: s.ingestao.ingestao_incompleta === true,
    }))
    .filter((s) => s.pendentes > 0 || s.certificacaoIncompleta || s.ingestaoIncompleta)
}

/**
 * REGRAVA os itens faltantes de uma sessão JÁ EXISTENTE (ingestao_incompleta) —
 * os que falharam no meio da gravação na 1ª tentativa. Usa o MESMO
 * criarItensEmLotes (ondas de creates individuais — SEM /api/batch — de 20 por
 * onda + retry progressivo no 429); itens já gravados são pulados pela
 * chave_normalizada — nada é duplicado. Ao completar, fecha os totais da
 * sessão e desmarca ingestao_incompleta.
 *
 * O modal passa o mínimo ({ id, itens } da fila em memória OU da retomada);
 * os metadados vêm do próprio registro da sessão — nada é recriado.
 */
export interface RegravacaoSessaoInput {
  id: string
  itens: Array<Pick<CgIngestaoItemFila, 'nomeExtraido' | 'exclusoes'>>
}

export async function regravarItensFaltantes(sessao: RegravacaoSessaoInput): Promise<{
  sucesso: boolean
  sessao: CgIngestaoRecord
  itensGravados: number
  erro?: string
}> {
  if (!sessao.id) {
    throw new Error('Sessão sem id — retome a sessão pelo painel de pendentes antes de regravar.')
  }
  if (!sessao.itens.length) {
    throw new Error('Nenhum item para regravar — a fila de revisão está vazia.')
  }

  const [ingestao, gravados] = await Promise.all([
    pb.collection('cg_ingestoes').getOne<CgIngestaoRecord>(sessao.id),
    listarChavesGravadas(sessao.id),
  ])
  const faltantes = sessao.itens.filter((it) => !gravados.has(chaveGuardaCg(it.nomeExtraido)))

  if (!faltantes.length) {
    // A fila do modal é a COMPLETA: totais cheios saem dela, não do subconjunto faltante.
    const fechada = await fecharTotaisSessao(ingestao, totaisFilaCompleta(sessao.itens))
    return { sucesso: true, sessao: fechada, itensGravados: sessao.itens.length }
  }

  const resultado = await criarItensEmLotes(
    faltantes.map((it) => ({
      ingestao: sessao.id,
      tipo_item: 'cobertura',
      nome_extraido: it.nomeExtraido,
      chave_normalizada: chaveGuardaCg(it.nomeExtraido),
      status: 'pendente',
      exclusoes: it.exclusoes,
    })),
    'cg_ingestao_itens',
  )
  if (!resultado.sucesso) {
    return {
      sucesso: false,
      sessao: ingestao,
      itensGravados: gravados.size + resultado.gravados,
      erro: resultado.erro,
    }
  }

  const fechada = await fecharTotaisSessao(ingestao, totaisFilaCompleta(sessao.itens))
  return { sucesso: true, sessao: fechada, itensGravados: sessao.itens.length }
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

// ---------------------------------------------------------------------------
// Helpers de idempotência e fechamento de sessão (v0.0.207)
// ---------------------------------------------------------------------------

/** Sessões criadas nesta aba por chave de idempotência — evita a 2ª busca. */
const idempotenciaSessoes = new Map<string, CgIngestaoRecord>()

/** chaves de filtro do PocketBase não escapam aspas — usa o hash hex puro. */
function chaveIdempotenciaParaFiltro(idempotenciaKey: string): string {
  return /[^A-Za-z0-9_-]/.test(idempotenciaKey)
    ? idempotenciaKey
        .split('')
        .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
        .toString(16)
    : idempotenciaKey
}

/**
 * Chaves (chaveGuardaCg) dos itens JÁ gravados na sessão — usado para pular os
 * existentes ao retentar (nunca duplica item) e para saber os faltantes.
 */
async function listarChavesGravadas(ingestaoId: string): Promise<Set<string>> {
  const registros = await pb.collection('cg_ingestao_itens').getFullList({
    filter: `ingestao="${ingestaoId}"`,
    fields: 'chave_normalizada',
    batch: 20,
  })
  return new Set(
    registros.map((r) => (r as unknown as { chave_normalizada: string }).chave_normalizada),
  )
}

/** Totais cheios da fila COMPLETA (itens + exclusões) — nunca do subconjunto faltante. */
function totaisFilaCompleta(itens: Array<Pick<CgIngestaoItemFila, 'exclusoes'>>): {
  totalItens: number
  totalExclusoes: number
} {
  return {
    totalItens: itens.length,
    totalExclusoes: itens.reduce((soma, it) => soma + (it.exclusoes?.length ?? 0), 0),
  }
}

/**
 * Fecha a sessão: grava os totais CHEIOS (total_itens, total_exclusoes,
 * itens_gravados = total da fila) e ingestao_incompleta=false. Só chamada
 * quando TUDO está gravado — a sessão nunca fica com totais cheios e itens
 * faltando. Recebe os totais EXPLÍCITOS da fila completa: os call sites de
 * regravarItensFaltantes passam os totais da fila inteira (não do subconjunto
 * faltante).
 */
async function fecharTotaisSessao(
  ingestao: CgIngestaoRecord,
  totais: { totalItens: number; totalExclusoes: number },
): Promise<CgIngestaoRecord> {
  const atualizada = (await pb.collection('cg_ingestoes').update(ingestao.id, {
    total_itens: totais.totalItens,
    total_exclusoes: totais.totalExclusoes,
    itens_gravados: totais.totalItens,
    ingestao_incompleta: false,
  })) as unknown as CgIngestaoRecord
  if (ingestao.chave_ingestao) {
    const chaveMap = [...idempotenciaSessoes.entries()].find(([, v]) => v.id === ingestao.id)
    if (chaveMap) idempotenciaSessoes.set(chaveMap[0], atualizada)
  }
  return atualizada
}

/** Conta itens gravados na sessão (fallback de contagem, sem campos editados). */
export async function contarItens(ingestaoId: string): Promise<number> {
  return (
    await pb.collection('cg_ingestao_itens').getList(1, 1, {
      filter: `ingestao="${ingestaoId}"`,
    })
  ).totalItems
}
