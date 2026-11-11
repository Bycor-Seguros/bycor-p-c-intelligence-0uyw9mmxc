import ChatAssistente from '@/components/ChatAssistente'

/**
 * Visão de tela cheia do chat com o Assistente Bycor.
 *
 * Mesmo componente do painel lateral (drawer global no Layout) — a conversa
 * continua de uma interface para a outra, pois ambas usam o mesmo store
 * (useChatAssistente) e a mesma persistência (coleção chat_messages).
 */
export default function ChatPage() {
  return (
    <div className="h-[calc(100vh-140px)]">
      <ChatAssistente />
    </div>
  )
}
