import pb from '@/lib/pocketbase/client'
import { streamAgentChat, type StreamAgentChatResult } from '@/lib/skipAi'

/**
 * Serviço do Assistente Bycor (Chat IA).
 * Conversa com o agente nativo 'assistente-bycor' (migration 0031) via rota
 * de backend /backend/v1/assistente/chat. Somente orientação — o agente não
 * tem tools de escrita em coleções.
 */

const ROTA_ASSISTENTE = `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/assistente/chat`

export interface EnviarPerguntaParams {
  mensagem: string
  /** Id da conversa retornado em chamadas anteriores (thread persistente). */
  conversationId?: string | null
  signal?: AbortSignal
  onChunk?: (deltaText: string, accumulatedText: string) => void
}

export interface RespostaAssistente {
  content: string
  conversationId: string
  messageId: string
}

export async function enviarPerguntaAssistente(
  params: EnviarPerguntaParams,
): Promise<RespostaAssistente> {
  const res = await fetch(ROTA_ASSISTENTE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: pb.authStore.token,
    },
    body: JSON.stringify({
      mensagem: params.mensagem,
      conversation_id: params.conversationId ?? null,
    }),
    signal: params.signal,
  })

  // Sem guard manual de !res.ok: streamAgentChat analisa não-2xx e lança com
  // a mensagem real do servidor.
  const result: StreamAgentChatResult = await streamAgentChat(res, {
    onChunk: params.onChunk,
    signal: params.signal,
  })

  return {
    content: result.content,
    conversationId: result.conversation_id,
    messageId: result.message_id,
  }
}
