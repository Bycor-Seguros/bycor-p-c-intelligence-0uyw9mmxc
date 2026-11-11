import { useEffect, useRef } from 'react'
import { Bot, Send, User, Loader2, Compass, AlertCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useChatAssistente,
  useSugestoesIniciaisChat,
  type ChatMessage,
} from '@/hooks/useChatAssistente'

/**
 * Componente reutilizável do chat com o Assistente Bycor.
 *
 * Montado tanto na tela /chat (visão de tela cheia) quanto no painel lateral
 * (drawer do Layout). Usa o store compartilhado useChatAssistente — mesmo
 * estado, mesmo thread, mesmo histórico persistido em chat_messages.
 */

interface ChatAssistenteProps {
  /** Modo compacto (drawer lateral): cabeçalho e mensagens mais enxutos. */
  compacto?: boolean
}

export default function ChatAssistente({ compacto = false }: ChatAssistenteProps) {
  const {
    user,
    messages,
    inputVal,
    setInputVal,
    sending,
    streamingText,
    erro,
    carregando,
    enviar,
    novaConversa,
    handleSubmit,
    handleSugestao,
  } = useChatAssistente()
  const SUGESTOES_INICIAIS = useSugestoesIniciaisChat()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, sending])

  const renderMensagem = (msg: ChatMessage) => {
    const isUser = msg.role === 'user'
    return (
      <div key={msg.id} className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
            isUser ? 'bg-[#0F2B46] text-white' : 'bg-white border text-[#16578B] shadow-sm'
          }`}
        >
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>

        <div
          className={`p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
            compacto ? 'max-w-[85%]' : 'max-w-lg'
          } ${
            isUser
              ? 'bg-[#0F2B46] text-white rounded-tr-none'
              : 'bg-white border border-[#E4E9F0] text-gray-800 rounded-tl-none'
          }`}
        >
          <div className="whitespace-pre-wrap">{msg.content}</div>
          <div
            className={`text-[9px] mt-1.5 flex items-center gap-1 ${
              isUser ? 'text-blue-200 justify-end' : 'text-gray-400'
            }`}
          >
            <span>
              {msg.created
                ? new Date(msg.created).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`h-full flex flex-col bg-white overflow-hidden ${
        compacto ? '' : 'rounded-xl border border-[#E4E9F0] shadow-sm'
      }`}
    >
      {/* Cabeçalho */}
      <div
        className={`border-b border-[#E4E9F0] bg-gray-50/50 flex items-center justify-between ${
          compacto ? 'p-3' : 'p-4'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0F2B46] to-[#16578B] text-white flex items-center justify-center shadow-sm shrink-0">
            <Bot className="w-5 h-5 text-blue-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-900 truncate">Assistente Bycor</h2>
              {!compacto && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                  Ajuda ao Usuário
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 truncate">
              {compacto
                ? 'Orientação do sistema, em qualquer tela.'
                : 'Dúvidas sobre o sistema: módulos, funções e regras de negócio P&C. Somente orientação — não altera dados.'}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={novaConversa}
          disabled={sending}
          title="Inicia uma conversa nova (o histórico anterior é mantido)"
          className="h-8 text-[11px] px-2.5 border-gray-300 text-gray-700 hover:text-[#16578B] hover:border-[#16578B] shrink-0"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Nova conversa
        </Button>
      </div>

      {/* Mensagens */}
      <div
        className={`flex-1 overflow-y-auto space-y-4 bg-[#F8FAFC] ${compacto ? 'p-3' : 'p-4 sm:p-6'}`}
      >
        {carregando ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin text-[#16578B]" />
            Carregando histórico...
          </div>
        ) : (
          <>
            {messages.length === 0 && !sending && (
              <div
                className={`py-8 text-center ${compacto ? 'max-w-none px-1' : 'max-w-md mx-auto'}`}
              >
                <Compass className="w-10 h-10 mx-auto mb-3 text-[#16578B]" />
                <h4 className="text-sm font-semibold text-gray-800">
                  Olá{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! Como posso ajudar?
                </h4>
                <p className="text-xs mt-1 text-gray-500">
                  Pergunte como usar o sistema ou onde encontrar uma função — por exemplo:
                </p>
                <div className="mt-4 grid gap-2">
                  {SUGESTOES_INICIAIS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSugestao(s)}
                      className="text-xs text-left px-3 py-2 rounded-lg bg-white border border-[#E4E9F0] text-gray-700 hover:border-[#16578B] hover:text-[#16578B] transition-colors shadow-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(renderMensagem)}

            {/* Resposta em streaming */}
            {streamingText && (
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-white border flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-[#16578B]" />
                </div>
                <div
                  className={`p-3 rounded-2xl rounded-tl-none text-xs leading-relaxed shadow-sm bg-white border border-[#E4E9F0] text-gray-800 ${
                    compacto ? 'max-w-[85%]' : 'max-w-lg'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{streamingText}</div>
                </div>
              </div>
            )}

            {sending && !streamingText && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="w-7 h-7 rounded-full bg-white border flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[#16578B] animate-pulse" />
                </div>
                <div className="p-3 bg-white border rounded-2xl rounded-tl-none flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#16578B]" />
                  <span className="text-[11px]">Assistente Bycor digitando...</span>
                </div>
              </div>
            )}

            {erro && (
              <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Barra de entrada */}
      <form
        onSubmit={handleSubmit}
        className={`border-t border-[#E4E9F0] bg-white flex items-center gap-2 ${compacto ? 'p-2.5' : 'p-3'}`}
      >
        <Input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Ex.: onde cadastro um empreendimento? como recalculo uma rodada de auditoria?"
          className="flex-1 text-xs h-9 border-gray-300 focus:border-[#16578B]"
        />
        <Button
          type="submit"
          disabled={!inputVal.trim() || sending}
          className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-9 px-3 font-semibold shrink-0"
        >
          <Send className="w-4 h-4 mr-1.5" />
          <span>Enviar</span>
        </Button>
      </form>
    </div>
  )
}
