import pb from '@/lib/pocketbase/client'

/**
 * Serviço de persistência do histórico de chat (coleção chat_messages).
 *
 * Cada registro = uma mensagem (role user|assistant) vinculada ao usuário
 * logado. O conversation_id do thread do agente 'assistente-bycor' é
 * repetido em todas as mensagens do thread, permitindo retomar a conversa
 * após F5/navegação. Horários originais vêm do campo `created`.
 */

export const CHAT_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const

export type ChatRole = (typeof CHAT_ROLE)[keyof typeof CHAT_ROLE]

export interface ChatMessageRecord {
  id: string
  role: ChatRole
  content: string
  conversationId: string | null
  created: string
}

export interface CarregarHistoricoResultado {
  mensagens: ChatMessageRecord[]
  conversationId: string | null
}

const COLLECTION = 'chat_messages'
const LIMITE_HISTORICO = 200

function toRecord(model: Record<string, unknown>): ChatMessageRecord {
  return {
    id: String(model.id),
    role: (model.role as ChatRole) || CHAT_ROLE.USER,
    content: String(model.content || ''),
    conversationId: (model.conversation_id as string) || null,
    created: String(model.created || ''),
  }
}

/**
 * Carrega o histórico mais recente do usuário (ordem cronológica ascendente),
 * junto com o conversation_id do thread ativo (o da última mensagem gravada).
 */
export async function carregarHistoricoChat(userId: string): Promise<CarregarHistoricoResultado> {
  try {
    const models = await pb.collection(COLLECTION).getList(1, LIMITE_HISTORICO, {
      filter: `user = "${userId}"`,
      sort: '-created',
    })

    const mensagens = models.items.map(toRecord).reverse()

    const conversationId =
      mensagens.length > 0 ? mensagens[mensagens.length - 1].conversationId : null

    return { mensagens, conversationId }
  } catch (err) {
    console.error('Falha ao carregar histórico de chat:', err)
    return { mensagens: [], conversationId: null }
  }
}

/** Retroalimenta o conversation_id do registro de uma mensagem (thread novo). */
export async function atualizarConversationId(
  recordId: string,
  conversationId: string,
): Promise<void> {
  try {
    await pb.collection(COLLECTION).update(recordId, { conversation_id: conversationId })
  } catch (err) {
    console.error('Falha ao atualizar conversation_id da mensagem:', err)
  }
}

/** Grava uma mensagem (usuário ou assistente) vinculada ao usuário logado. */
export async function salvarMensagemChat(params: {
  userId: string
  role: ChatRole
  content: string
  conversationId: string | null
}): Promise<ChatMessageRecord | null> {
  try {
    const model = await pb.collection(COLLECTION).create({
      role: params.role,
      content: params.content,
      user: params.userId,
      conversation_id: params.conversationId,
    })
    return toRecord(model as unknown as Record<string, unknown>)
  } catch (err) {
    console.error('Falha ao salvar mensagem de chat:', err)
    return null
  }
}
