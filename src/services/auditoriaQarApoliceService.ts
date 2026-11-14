// EIXO QAR × APÓLICE — PARSE (espelho do auditoriaCartaoApoliceService, parser/interface separados)
//
// Regras definidas pelo usuário (caso Anália Franco, 07/11) — NÃO inventar outras:
// 1. No QAR (formulário padrão Bycor), % dos limites de RC = % da IMPORTÂNCIA
//    SEGURADA PRETENDIDA. O campo importancia_segurada_pretendida é gravado pelo
//    leitor; resolver % → valor antes de comparar.
// 2. DIVERGÊNCIA quando o LMG emitido da cobertura não casa com NENHUMA opção
//    idêntica do QAR (LMG do QAR é EDITÁVEL — casamento exato: a correção do
//    analista prevalece e a cobertura sai da divergência). O eixo identifica o
//    LMG emitido de TODAS as coberturas discrepantes.
// 3. Coberturas do QAR SEM % e SEM valor não entram na auditoria (sugestões do
//    formulário — o leitor já as ignora, e o serviço re-garante como 2ª camada).
// 4. Danos por Água e Despesas de Salvamento/Contenção são PROPERTY — FORA do
//    eixo (o QAR é instrumento de cotação de RC). 2ª camada de guarda.
// 5. Resultado em 3 níveis: APTO / DIVERGENCIA / PONTO_DE_ATENCAO. Cruzamento
//    nos DOIS sentidos: cobertura no QAR sem correspondente na apólice, e
//    cobertura na apólice sem correspondente no QAR.
// 6. O botão "Ressalva C5" permanece exclusivo do eixo Cartão × Apólice e é
//    oferecido APENAS em divergências REAIS (nunca para coberturas sem
//    divergência) — a UI é quem o exibe; o serviço apenas sinaliza
//    `ressalvaC5Disponivel`.
//
// Referência de comparação: a apólice ATUAL do ciclo (a emitida) — nunca a do
// ano anterior (decisão do usuário, caso Anália Franco).

import {
  normalizarTermoEquivalenciaQar,
  isCoberturaPropertyQar,
  type QarCoberturaDeclarada,
} from '@/services/qarReader'
import { normalizarTermoEquivalencia } from '@/services/equivalenciaCoberturasService'

/** Níveis de resultado de uma cobertura no eixo QAR × Apólice. */
export type QarAuditoriaNivel = 'APTO' | 'DIVERGENCIA' | 'PONTO_DE_ATENCAO'

export interface QarDeclaradoLinha {
  id: string
  cobertura: string
  coberturaNormalizada: string
  tipoValor: 'percentual' | 'fixo'
  percentual: number | null
  valorPretendido: number | null
  /** IS pretendida usada na resolução de % (do registro ou do empreendimento). */
  importanciaSeguradaPretendida: number | null
  distanciaKm: number | null
  lmgMarcado: boolean
}

/** Cobertura da apólice atual emitida, no formato comparável ao QAR. */
export interface QarApoliceCoberturaLinha {
  id: string
  nomeApolice: string
  nomeNormalizado: string
  lmiApolice: number | null
  /** Categoria canônica vinda da matriz de equivalência (quando resolvida). */
  categoriaNormalizada?: string | null
}

/**
 * Resultado por cobertura — 3 níveis:
 * - APTO:             LMG emitido casa com UMA opção idêntica do QAR.
 * - DIVERGENCIA:      LMG emitido não casa com NENHUMA opção idêntica do QAR.
 * - PONTO_DE_ATENCAO: cobertura presente só no QAR (não emitida) ou só na
 *   apólice (emitida sem declaração no QAR) — cruzamento nos dois sentidos.
 */
export interface QarAuditoriaItem {
  cobertura: string
  coberturaNormalizada: string
  nivel: QarAuditoriaNivel
  /** Obrigatório por regra: existe % OU valor declarado (sugestões não entram). */
  valorDeclaradoQar: number | null
  /** Como o valor declarado foi resolvido para comparação. */
  resolucaoValor: 'fixo' | 'percentual_is_pretendida' | 'sem_valor'
  /** % declarado no QAR (contexto de exibição). */
  percentualDeclarado: number | null
  /** IS pretendida usada na resolução do %. */
  importanciaSeguradaUsada: number | null
  distanciaKm: number | null
  /** LMG emitido da apólice atual (por cobertura correspondente). */
  lmgEmitido: number | null
  nomeApoliceCorrespondente: string | null
  /** LMG declarado no QAR — EDITÁVEL na tela (a correção prevalece). */
  lmgDeclaradoEditavel: number | null
  /** LMG do QAR casa exatamente com o LMG emitido? */
  casaExata: boolean
  /** Texto do critério, para exibição. */
  motivo: string
  /** Ressalva C5 é exclusiva de divergências REAIS (regra 6). */
  ressalvaC5Disponivel: boolean
}

export interface QarAuditoriaResultado {
  /** 3 níveis, por cobertura (cruzamento já resolvido dentro dela). */
  itens: QarAuditoriaItem[]
  /** Só no QAR (não emitida na apólice) — PONTO_DE_ATENCAO, sentido 1. */
  soNoQar: QarAuditoriaItem[]
  /** Só na apólice (não declarada no QAR) — PONTO_DE_ATENCAO, sentido 2. */
  soNaApolice: QarAuditoriaItem[]
  totalApto: number
  totalDivergencia: number
  totalPontoAtencao: number
  /** IS pretendida efetivamente usada na resolução de %. */
  importanciaSeguradaUsada: number | null
}

/** Casamento EXATO de valor com tolerância monetária (1 centavo). */
export function valoresIguaisQarApolice(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false
  return Math.abs(a - b) < 0.01
}

/**
 * Resolve o valor comparável de uma cobertura do QAR:
 * - fixo:       valor declarado em R$ é o LMG pretendido.
 * - percentual: % da IS pretendida (regra 1).
 * Sem % e sem valor => null (sugestão do formulário, fora da auditoria).
 */
export function resolverValorQar(
  cob: Pick<QarCoberturaDeclarada, 'tipoValor' | 'percentual' | 'valorPretendido'>,
  importanciaSeguradaPretendida: number | null,
): { valor: number | null; modo: 'fixo' | 'percentual_is_pretendida' | 'sem_valor' } {
  if (cob.tipoValor === 'fixo' && cob.valorPretendido !== null && cob.valorPretendido > 0) {
    return { valor: cob.valorPretendido, modo: 'fixo' }
  }
  if (cob.tipoValor === 'percentual' && cob.percentual !== null && cob.percentual > 0) {
    if (
      importanciaSeguradaPretendida === null ||
      !Number.isFinite(importanciaSeguradaPretendida) ||
      importanciaSeguradaPretendida <= 0
    ) {
      // Sem IS pretendida não há como resolver % — tratado como sem valor comparável
      return { valor: null, modo: 'sem_valor' }
    }
    return {
      valor: (cob.percentual / 100) * importanciaSeguradaPretendida,
      modo: 'percentual_is_pretendida',
    }
  }
  return { valor: null, modo: 'sem_valor' }
}

/**
 * Encontra o LMG emitido na apólice para a cobertura do QAR.
 * Casamento por nome normalizado EXATO (ou categoria canônica idêntica) —
 * nunca por similaridade: QAR × Apólice casa idêntico ou não casa.
 */
export function encontrarLmgEmitido(
  coberturaQarNormalizada: string,
  coberturasApolice: QarApoliceCoberturaLinha[],
): QarApoliceCoberturaLinha | null {
  const alvo = normalizarTermoEquivalenciaQar(coberturaQarNormalizada)
  if (!alvo) return null
  return (
    coberturasApolice.find((c) => {
      if (normalizarTermoEquivalenciaQar(c.nomeNormalizado) === alvo) return true
      if (c.categoriaNormalizada && normalizarTermoEquivalencia(c.categoriaNormalizada) === alvo)
        return true
      return false
    }) || null
  )
}

/** Guarda de regra 3: coberturas sem % e sem valor não entram na auditoria. */
function temValorOuPercentualDeclarado(
  cob: Pick<QarCoberturaDeclarada, 'tipoValor' | 'percentual' | 'valorPretendido'>,
): boolean {
  const res = resolverValorQar(cob, null)
  if (res.modo === 'fixo') return true
  // percentual declarado (>0) entra — mesmo que a IS ainda precise ser resolvida
  return cob.tipoValor === 'percentual' && cob.percentual !== null && cob.percentual > 0
}

/**
 * PARSE puro do eixo QAR × Apólice (sem I/O).
 * Entradas: linhas declaradas do QAR (qar_declarados) + coberturas da apólice
 * ATUAL emitida + IS pretendida do empreendimento (fallback).
 */
export function montarAuditoriaQarApolice(
  qarLinhas: QarDeclaradoLinha[],
  apoliceCoberturas: QarApoliceCoberturaLinha[],
  isPretendidaFallback: number | null,
): QarAuditoriaResultado {
  const isGlobal =
    isPretendidaFallback !== null && Number.isFinite(isPretendidaFallback)
      ? isPretendidaFallback
      : null

  const coberturasQar = qarLinhas
    // Regra 4 (2ª camada): property FORA do eixo RC
    .filter((l) => !isCoberturaPropertyQar(l.cobertura))
    // Regra 3 (2ª camada): sugestões do formulário (sem % ou valor) não entram
    .filter((l) => temValorOuPercentualDeclarado(l))

  const itens: QarAuditoriaItem[] = []
  const soNoQar: QarAuditoriaItem[] = []
  const soNaApolice: QarAuditoriaItem[] = []
  const nomesQarNormalizados = new Set<string>()
  let isUsada: number | null = null

  for (const linhaQar of coberturasQar) {
    const norm = normalizarTermoEquivalenciaQar(linhaQar.coberturaNormalizada || linhaQar.cobertura)
    if (!norm || nomesQarNormalizados.has(norm)) continue
    nomesQarNormalizados.add(norm)

    const isDaLinha =
      linhaQar.importanciaSeguradaPretendida !== null &&
      Number.isFinite(linhaQar.importanciaSeguradaPretendida) &&
      linhaQar.importanciaSeguradaPretendida > 0
        ? linhaQar.importanciaSeguradaPretendida
        : isGlobal
    if (isDaLinha !== null && isUsada === null) isUsada = isDaLinha

    const resolvido = resolverValorQar(linhaQar, isDaLinha)
    if (resolvido.modo === 'sem_valor') continue // regra 3

    const correspondente = encontrarLmgEmitido(norm, apoliceCoberturas)
    const lmgEmitido = correspondente ? correspondente.lmiApolice : null
    const lmgDeclaradoEditavel = linhaQar.valorPretendido
    const casaExata = valoresIguaisQarApolice(lmgDeclaradoEditavel, lmgEmitido)

    const isPct = linhaQar.tipoValor === 'percentual' && linhaQar.percentual !== null
    const motivo = isPct
      ? `${linhaQar.percentual}% da IS pretendida (${formatResumo(isDaLinha)}) = ${formatResumo(resolvido.valor)}`
      : `LMG declarado no QAR: ${formatResumo(resolvido.valor)}`

    let nivel: QarAuditoriaNivel
    if (!correspondente) {
      // Sentido 1: cobertura no QAR sem correspondente na apólice
      nivel = 'PONTO_DE_ATENCAO'
      soNoQar.push({
        cobertura: linhaQar.cobertura,
        coberturaNormalizada: norm,
        nivel,
        valorDeclaradoQar: resolvido.valor,
        resolucaoValor: resolvido.modo,
        percentualDeclarado: isPct ? linhaQar.percentual : null,
        importanciaSeguradaUsada: isDaLinha,
        distanciaKm: linhaQar.distanciaKm ?? null,
        lmgEmitido: null,
        nomeApoliceCorrespondente: null,
        lmgDeclaradoEditavel,
        casaExata: false,
        motivo: `${motivo} — sem cobertura correspondente na apólice atual`,
        ressalvaC5Disponivel: false,
      })
    } else if (casaExata) {
      nivel = 'APTO'
    } else {
      // Regra 2: LMG emitido não casa com a opção idêntica do QAR
      nivel = 'DIVERGENCIA'
    }

    itens.push({
      cobertura: linhaQar.cobertura,
      coberturaNormalizada: norm,
      nivel,
      valorDeclaradoQar: resolvido.valor,
      resolucaoValor: resolvido.modo,
      percentualDeclarado: isPct ? linhaQar.percentual : null,
      importanciaSeguradaUsada: isDaLinha,
      distanciaKm: linhaQar.distanciaKm ?? null,
      lmgEmitido,
      nomeApoliceCorrespondente: correspondente ? correspondente.nomeApolice : null,
      lmgDeclaradoEditavel,
      casaExata,
      motivo: casaExata
        ? `${motivo} — casa exatamente com o LMG emitido`
        : !correspondente
          ? motivo
          : `${motivo} — LMG emitido ${formatResumo(lmgEmitido)} não casa com nenhuma opção idêntica do QAR`,
      // Regra 6: Ressalva C5 exclusiva de divergências REAIS
      ressalvaC5Disponivel: nivel === 'DIVERGENCIA',
    })
  }

  // Sentido 2: cobertura na apólice sem correspondente no QAR
  const isCoberturaPropertyApolice = (nome: string) => isCoberturaPropertyQar(nome)
  for (const cob of apoliceCoberturas) {
    const nomeNorm = normalizarTermoEquivalenciaQar(cob.nomeNormalizado || cob.nomeApolice)
    const catNorm = cob.categoriaNormalizada
      ? normalizarTermoEquivalencia(cob.categoriaNormalizada)
      : ''
    const casou =
      (nomeNorm && nomesQarNormalizados.has(nomeNorm)) ||
      (catNorm && nomesQarNormalizados.has(catNorm))
    if (casou) continue
    if (isCoberturaPropertyApolice(cob.nomeApolice)) continue // property fora do eixo
    const item: QarAuditoriaItem = {
      cobertura: cob.nomeApolice,
      coberturaNormalizada: nomeNorm || catNorm,
      nivel: 'PONTO_DE_ATENCAO',
      valorDeclaradoQar: null,
      resolucaoValor: 'sem_valor',
      percentualDeclarado: null,
      importanciaSeguradaUsada: isUsada,
      distanciaKm: null,
      lmgEmitido: cob.lmiApolice,
      nomeApoliceCorrespondente: cob.nomeApolice,
      lmgDeclaradoEditavel: null,
      casaExata: false,
      motivo: 'Cobertura emitida na apólice atual sem declaração correspondente no QAR',
      ressalvaC5Disponivel: false,
    }
    itens.push(item)
    soNaApolice.push(item)
  }

  return {
    itens,
    soNoQar,
    soNaApolice,
    totalApto: itens.filter((i) => i.nivel === 'APTO').length,
    totalDivergencia: itens.filter((i) => i.nivel === 'DIVERGENCIA').length,
    totalPontoAtencao: itens.filter((i) => i.nivel === 'PONTO_DE_ATENCAO').length,
    importanciaSeguradaUsada: isUsada,
  }
}

function formatResumo(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Reclassifica um item após a EDIÇÃO do LMG declarado no QAR pelo analista
 * (parse/interface separados: a UI chama com o valor digitado — nunca grava).
 * Casamento exato: se o novo valor casa com o LMG emitido, sai da divergência
 * (a correção do analista prevalece).
 */
export function reclassificarComLmgEditado(
  item: QarAuditoriaItem,
  novoLmgDeclarado: number | null,
): QarAuditoriaItem {
  if (item.nivel === 'PONTO_DE_ATENCAO') return item // dois sentidos não mudam por edição
  const casaExata = valoresIguaisQarApolice(novoLmgDeclarado, item.lmgEmitido)
  return {
    ...item,
    lmgDeclaradoEditavel: novoLmgDeclarado,
    casaExata,
    nivel: casaExata ? 'APTO' : 'DIVERGENCIA',
    motivo: casaExata
      ? `LMG corrigido pelo analista (${formatResumo(novoLmgDeclarado)}) — casa exatamente com o LMG emitido`
      : `LMG corrigido pelo analista (${formatResumo(novoLmgDeclarado)}) — ainda não casa com o LMG emitido ${formatResumo(item.lmgEmitido)}`,
  }
}
