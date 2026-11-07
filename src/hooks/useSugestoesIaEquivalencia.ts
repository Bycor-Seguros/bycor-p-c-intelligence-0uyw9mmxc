import { useState, useCallback, useRef } from 'react'
import { toast } from '@/hooks/use-toast'
import {
  solicitarSugestaoEquivalenciaIa,
  registrarFeedbackEquivalenciaIa,
  AGENTE_EQUIVALENCIA_SLUG,
  SugestaoEquivalenciaIaResult,
} from '@/services/equivalenciaCoberturasService'

/** Par (alias x seguradora) candidato a equivalência, extraído da matriz C3 */
export interface ParNaoMapeado {
  alias: string
  seguradoraNome: string
  seguradoraId?: string
}

/** Sugestão enriquecida com o contexto da célula para revisão em lote */
export interface SugestaoLoteItem {
  chave: string
  par: ParNaoMapeado
  sugestao?: SugestaoEquivalenciaIaResult
  erro?: string
  status: 'pendente' | 'analisando' | 'concluida' | 'erro' | 'cancelado'
}

export const chaveParIa = (alias: string, segNome: string) => `${alias}___${segNome}`

/**
 * Hook do assistente de IA de equivalência (C3 — Tabulação):
 * - sugestão por célula (fluxo existente) com feedback de auditoria gravado em
 *   `ia_equivalencia_feedback` (confirmada/rejeitada), sem bloquear a ação principal;
 * - varredura em lote das linhas não mapeadas da rodada, em série com cancelamento.
 */
export function useSugestoesIaEquivalencia(options?: { rfqId?: string }) {
  const [sugestoesIa, setSugestoesIa] = useState<Record<string, SugestaoEquivalenciaIaResult>>({})
  const [carregandoIa, setCarregandoIa] = useState<Record<string, boolean>>({})
  const [errosIa, setErrosIa] = useState<Record<string, string>>({})
  const [aceitandoIa, setAceitandoIa] = useState<Record<string, boolean>>({})

  // Lote
  const [loteAtivo, setLoteAtivo] = useState(false)
  const [loteItens, setLoteItens] = useState<SugestaoLoteItem[]>([])
  const [loteIndice, setLoteIndice] = useState(0)
  const cancelarRef = useRef(false)
  const rfqIdRef = useRef(options?.rfqId)
  rfqIdRef.current = options?.rfqId

  const limparSugestao = useCallback((chave: string) => {
    setSugestoesIa((prev) => {
      const copy = { ...prev }
      delete copy[chave]
      return copy
    })
    setErrosIa((prev) => {
      const copy = { ...prev }
      delete copy[chave]
      return copy
    })
  }, [])

  /** Limpa apenas o card de erro (fechar card de falha sem decisão) */
  const limparErroIa = useCallback((chave: string) => {
    setErrosIa((prev) => {
      const copy = { ...prev }
      delete copy[chave]
      return copy
    })
  }, [])

  /**
   * Registra o feedback de auditoria na coleção ia_equivalencia_feedback.
   * NUNCA bloqueia a ação principal do analista: falha vira toast leve e segue.
   */
  const registrarFeedback = useCallback(
    async (params: {
      decisao: 'confirmada' | 'rejeitada'
      alias: string
      seguradoraNome?: string
      seguradoraId?: string
      coberturaCanonicaId?: string
      sugestao: SugestaoEquivalenciaIaResult
    }) => {
      try {
        await registrarFeedbackEquivalenciaIa({
          decisao: params.decisao,
          alias: params.alias,
          seguradoraId: params.seguradoraId,
          seguradoraNome: params.seguradoraNome,
          coberturaCanonicaId: params.coberturaCanonicaId,
          canonicaSugerida: params.sugestao.canonica_sugerida,
          grauConfianca: params.sugestao.grau_confianca,
          justificativa: params.sugestao.justificativa_curta,
          eventosIdentificados: params.sugestao.eventos_identificados,
          eventosExcluidosRecomendados: params.sugestao.eventos_excluidos_recomendados,
          conversationId: params.sugestao.conversation_id,
          messageId: params.sugestao.message_id,
          agenteSlug: AGENTE_EQUIVALENCIA_SLUG,
          rfqId: rfqIdRef.current || undefined,
        })
      } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err)
        toast({
          title: 'Aviso: feedback da IA não registrado',
          description: `A decisão foi aplicada, mas o registro de auditoria falhou: ${msg}`,
          variant: 'destructive',
        })
        console.warn('Falha ao registrar feedback de equivalência IA:', msg)
      }
    },
    [],
  )

  /** Sugestão por célula (fluxo existente da C3) */
  const sugerirParaPar = useCallback(async (alias: string, segNome: string, segId?: string) => {
    const chave = chaveParIa(alias, segNome)
    try {
      setCarregandoIa((prev) => ({ ...prev, [chave]: true }))
      setErrosIa((prev) => {
        const copy = { ...prev }
        delete copy[chave]
        return copy
      })

      const sugestao = await solicitarSugestaoEquivalenciaIa({
        textoOriginal: alias,
        seguradoraNome: segNome,
        seguradoraId: segId,
      })

      setSugestoesIa((prev) => ({ ...prev, [chave]: sugestao }))
    } catch (err: unknown) {
      const msg = (err as Error)?.message || 'Erro ao consultar agente de IA'
      setErrosIa((prev) => ({ ...prev, [chave]: msg }))
    } finally {
      setCarregandoIa((prev) => ({ ...prev, [chave]: false }))
    }
  }, [])

  /**
   * Aceitar sugestão: grava o sinônimo (fluxo persistente já existente) E registra
   * o feedback 'confirmada' na coleção de auditoria. O feedback não bloqueia o salvamento.
   */
  const aceitarSugestaoIa = useCallback(
    async (params: {
      alias: string
      segNome: string
      segId?: string
      sugestao: SugestaoEquivalenciaIaResult
      /** Persiste o sinônimo; pode retornar o id da cobertura canônica para o feedback */
      persistir: (sugestao: SugestaoEquivalenciaIaResult) => Promise<string | void>
    }) => {
      const chave = chaveParIa(params.alias, params.segNome)
      try {
        setAceitandoIa((prev) => ({ ...prev, [chave]: true }))

        // Ação principal: persistência permanente (sinônimo da cia)
        const canonicaId = await params.persistir(params.sugestao)

        // Feedback de auditoria (não bloqueia a ação principal)
        await registrarFeedback({
          decisao: 'confirmada',
          alias: params.alias,
          seguradoraNome: params.segNome,
          seguradoraId: params.segId,
          coberturaCanonicaId: typeof canonicaId === 'string' ? canonicaId : undefined,
          sugestao: params.sugestao,
        })

        limparSugestao(chave)
      } finally {
        setAceitandoIa((prev) => ({ ...prev, [chave]: false }))
      }
    },
    [registrarFeedback, limparSugestao],
  )

  /**
   * Rejeitar sugestão: descarta o card da tela E registra o feedback 'rejeitada'
   * na coleção de auditoria. O feedback não bloqueia o descarte.
   */
  const rejeitarSugestaoIa = useCallback(
    async (params: {
      alias: string
      segNome: string
      segId?: string
      sugestao: SugestaoEquivalenciaIaResult
    }) => {
      const chave = chaveParIa(params.alias, params.segNome)

      // Ação principal: descartar o card
      limparSugestao(chave)

      // Feedback de auditoria (não bloqueia o descarte)
      await registrarFeedback({
        decisao: 'rejeitada',
        alias: params.alias,
        seguradoraNome: params.segNome,
        seguradoraId: params.segId,
        sugestao: params.sugestao,
      })
    },
    [registrarFeedback, limparSugestao],
  )

  /** Remove um item já decidido da lista do painel de lote */
  const removerItemLote = useCallback((chave: string) => {
    setLoteItens((prev) => prev.filter((it) => it.chave !== chave))
  }, [])

  /** Pede cancelamento da varredura em lote (efetiva entre itens) */
  const cancelarLote = useCallback(() => {
    cancelarRef.current = true
  }, [])

  /**
   * Varredura em lote: percorre em série (com intervalo) todos os pares não mapeados
   * da rodada corrente, pedindo sugestão ao agente para cada um. Permite cancelamento
   * no meio; progresso visível via loteIndice/loteItens.
   */
  const executarLote = useCallback(
    async (pares: ParNaoMapeado[]) => {
      if (loteAtivo || pares.length === 0) return
      cancelarRef.current = false

      const itensIniciais: SugestaoLoteItem[] = pares.map((par) => ({
        chave: chaveParIa(par.alias, par.seguradoraNome),
        par,
        status: 'pendente',
      }))
      setLoteItens(itensIniciais)
      setLoteIndice(0)
      setLoteAtivo(true)

      for (let i = 0; i < itensIniciais.length; i++) {
        if (cancelarRef.current) {
          setLoteItens((prev) =>
            prev.map((it) => (it.status === 'pendente' ? { ...it, status: 'cancelado' } : it)),
          )
          break
        }

        const item = itensIniciais[i]
        setLoteIndice(i)
        setLoteItens((prev) =>
          prev.map((it) => (it.chave === item.chave ? { ...it, status: 'analisando' } : it)),
        )

        try {
          const sugestao = await solicitarSugestaoEquivalenciaIa({
            textoOriginal: item.par.alias,
            seguradoraNome: item.par.seguradoraNome,
            seguradoraId: item.par.seguradoraId,
          })
          setLoteItens((prev) =>
            prev.map((it) =>
              it.chave === item.chave ? { ...it, sugestao, status: 'concluida' } : it,
            ),
          )
          // Espelha a sugestão no estado por célula, para reuso dos handlers da C3
          setSugestoesIa((prev) => ({ ...prev, [item.chave]: sugestao }))
        } catch (err: unknown) {
          const msg = (err as Error)?.message || 'Erro ao consultar agente de IA'
          setLoteItens((prev) =>
            prev.map((it) => (it.chave === item.chave ? { ...it, erro: msg, status: 'erro' } : it)),
          )
        }

        // Intervalo entre chamadas para evitar rajada no backend (exceto após o último)
        if (i < itensIniciais.length - 1 && !cancelarRef.current) {
          await new Promise((r) => setTimeout(r, 600))
        }
      }

      setLoteAtivo(false)
    },
    [loteAtivo],
  )

  /** Limpa o painel de lote da tela */
  const fecharLote = useCallback(() => {
    if (loteAtivo) cancelarRef.current = true
    setLoteItens([])
    setLoteIndice(0)
    setLoteAtivo(false)
  }, [loteAtivo])

  return {
    // Por célula
    sugestoesIa,
    carregandoIa,
    errosIa,
    aceitandoIa,
    sugerirParaPar,
    aceitarSugestaoIa,
    rejeitarSugestaoIa,
    limparErroIa,
    // Lote
    loteAtivo,
    loteItens,
    loteIndice,
    executarLote,
    cancelarLote,
    fecharLote,
    removerItemLote,
  }
}
