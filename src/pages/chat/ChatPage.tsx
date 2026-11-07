import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Bot, Send, User, Loader2, Compass, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { enviarPerguntaAssistente } from '@/services/assistenteIaService'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created: string
}

const SUGESTOES_INICIAIS = [
  'Onde cadastro um empreendimento?',
  'Como recalculo uma rodada de auditoria?',
  'Como funciona a tabulação de equivalências?',
  'Qual o caminho para gerar o Estudo de Mercado?',
]

export default function ChatPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputVal, setInputVal] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, sending])

  const enviar = async (texto: string) => {
    const pergunta = texto.trim()
    if (!pergunta || sending) return

    setErro(null)
    setInputVal('')
    setSending(true)
    setStreamingText('')

    const agora = new Date().toISOString()
    const msgUsuario: ChatMessage = {
      id: `local-u-${Date.now()}`,
      role: 'user',
      content: pergunta,
      created: agora,
    }
    setMessages((prev) => [...prev, msgUsuario])

    try {
      const resposta = await enviarPerguntaAssistente({
        mensagem: pergunta,
        conversationId: conversationIdRef.current,
        onChunk: (_delta, acumulado) => setStreamingText(acumulado),
      })

      conversationIdRef.current = resposta.conversationId || conversationIdRef.current

      setMessages((prev) => [
        ...prev,
        {
          id: resposta.messageId || `local-a-${Date.now()}`,
          role: 'assistant',
          content: resposta.content,
          created: new Date().toISOString(),
        },
      ])
      setStreamingText('')
    } catch (err: unknown) {
      setStreamingText('')
      const detalhe =
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível falar com o assistente agora. Tente novamente em instantes.'
      setErro(detalhe)
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void enviar(inputVal)
  }

  const handleSugestao = (texto: string) => {
    void enviar(texto)
  }

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
      {/* Cabeçalho */}
      <div className="p-4 border-b border-[#E4E9F0] bg-gray-50/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0F2B46] to-[#16578B] text-white flex items-center justify-center shadow-sm">
            <Bot className="w-5 h-5 text-blue-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-900">Assistente Bycor</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                Ajuda ao Usuário
              </span>
            </div>
            <p className="text-[11px] text-gray-500">
              Dúvidas sobre o sistema: módulos, funções e regras de negócio P&amp;C. Somente
              orientação — não altera dados.
            </p>
          </div>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-[#F8FAFC]">
        {messages.length === 0 && !sending && (
          <div className="py-10 text-center max-w-md mx-auto">
            <Compass className="w-12 h-12 mx-auto mb-3 text-[#16578B]" />
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

        {messages.map((msg) => {
          const isUser = msg.role === 'user'
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isUser ? 'bg-[#0F2B46] text-white' : 'bg-white border text-[#16578B] shadow-sm'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-lg p-3.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
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
        })}

        {/* Resposta em streaming */}
        {streamingText && (
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-[#16578B]" />
            </div>
            <div className="max-w-lg p-3.5 rounded-2xl rounded-tl-none text-xs leading-relaxed shadow-sm bg-white border border-[#E4E9F0] text-gray-800">
              <div className="whitespace-pre-wrap">{streamingText}</div>
            </div>
          </div>
        )}

        {sending && !streamingText && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-8 h-8 rounded-full bg-white border flex items-center justify-center">
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

        <div ref={messagesEndRef} />
      </div>

      {/* Barra de entrada */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-[#E4E9F0] bg-white flex items-center gap-2"
      >
        <Input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Ex.: onde cadastro um empreendimento? como recalculo uma rodada de auditoria?"
          className="flex-1 text-xs h-10 border-gray-300 focus:border-[#16578B]"
        />
        <Button
          type="submit"
          disabled={!inputVal.trim() || sending}
          className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-10 px-4 font-semibold shrink-0"
        >
          <Send className="w-4 h-4 mr-1.5" />
          <span>Enviar</span>
        </Button>
      </form>
    </div>
  )
}
