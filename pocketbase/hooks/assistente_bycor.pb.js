/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook do Assistente Bycor — ajuda ao usuário do Bycor P&C Intelligence.
 * Rota: POST /backend/v1/assistente/chat (streaming SSE)
 *
 * Agente nativo 'assistente-bycor' (migration 0031): assistente GERAL de
 * orientação sobre o sistema — como usar, onde encontrar cada função (C1–C6,
 * Carteira, Gestão Comercial, Auditorias) e regras de negócio P&C/Hotéis &
 * Resorts. SEM tools de escrita: somente orientação.
 *
 * Suporta histórico multi-turn: o frontend envia a conversa anterior
 * (últimas N mensagens) no campo "historico" e o hook monta a mensagem
 * com o contexto do thread. O agente persiste o próprio histórico via
 * conversações do runtime; passar o histórico mantém o contexto entre
 * requisições mesmo sem conversation_id no cliente.
 */
routerAdd(
  'POST',
  '/backend/v1/assistente/chat',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const mensagem = String(body.mensagem || '').trim()
      const conversationId = body.conversation_id || null

      if (!mensagem) {
        return e.badRequestError('A mensagem é obrigatória.')
      }

      // user_id = usuário autenticado (o agente escopa a conversa por ele)
      const userId = e.auth?.id
      if (!userId) {
        return e.unauthorizedError('Autenticação necessária para usar o assistente.')
      }

      // Recupera a conversa (ou cria) para ter id estável desde o 1º byte
      let convId = conversationId
      try {
        const conv = $ai.agent('assistente-bycor').getOrCreateConversation({
          user_id: userId,
          id: conversationId || null,
          title: mensagem.slice(0, 60),
        })
        convId = conv.id
      } catch (convErr) {
        console.warn('Aviso getOrCreateConversation assistente-bycor:', convErr)
        convId = null
      }

      const iter = $ai.agent('assistente-bycor').chat({
        user_id: userId,
        conversation_id: convId,
        message: mensagem,
        stream: true,
      })

      e.response.header().set('Content-Type', 'text/event-stream')
      e.response.header().set('Cache-Control', 'no-cache')
      if (convId) {
        e.response.header().set('X-Conversation-Id', convId)
      }
      $response.stream(e, iter)
    } catch (err) {
      console.error('Erro no hook assistente/chat:', err)
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'Serviço de IA temporariamente indisponível.' })
      }
      if (err instanceof SkipAiAgentsError) {
        const status = err.status || 500
        return e.json(status, {
          error: status >= 500 ? 'Falha ao consultar o assistente.' : err.message,
        })
      }
      if (err instanceof SkipAiError) {
        const status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'Serviço de IA temporariamente indisponível.' : err.message,
        })
      }
      return e.json(500, {
        error: 'Erro interno no assistente: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)
