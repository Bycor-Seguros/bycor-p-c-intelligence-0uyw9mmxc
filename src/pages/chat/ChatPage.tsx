import React, { useState, useEffect, useRef } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import { Bot, Send, User, Sparkles, Info, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created: string
  user?: string
}

export default function ChatPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputVal, setInputVal] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchMessages = async () => {
    try {
      const res = await pb.collection('chat_messages').getFullList<ChatMessage>({
        sort: 'created',
      })
      setMessages(res)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchMessages()

    const unsub = pb.collection('chat_messages').subscribe('*', () => {
      fetchMessages()
    })

    return () => {
      unsub.then((fn) => fn()).catch(() => {})
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputVal.trim() || sending) return

    const userText = inputVal.trim()
    setInputVal('')
    setSending(true)

    try {
      // 1. Persist user message in chat_messages
      await pb.collection('chat_messages').create({
        role: 'user',
        content: userText,
        user: user?.id,
      })

      // Simulate typing microinteraction (Fase 0)
      setTimeout(async () => {
        try {
          await pb.collection('chat_messages').create({
            role: 'assistant',
            content:
              'Assistente IA — em implantação (Fase 0). Na próxima etapa, você poderá consultar apólices, sinistros e desvios de rateio diretamente em linguagem natural.',
            user: user?.id,
          })
        } catch {
          // ignore
        } finally {
          setSending(false)
        }
      }, 700)
    } catch (err: unknown) {
      alert('Erro ao enviar mensagem: ' + (err as Error).message)
      setSending(false)
    }
  }

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
      {/* Top Header */}
      <div className="p-4 border-b border-[#E4E9F0] bg-gray-50/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0F2B46] to-[#16578B] text-white flex items-center justify-center shadow-sm">
            <Bot className="w-5 h-5 text-blue-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-900">Assistente P&C Bycor</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                Fase 0 · Em Implantação
              </span>
            </div>
            <p className="text-[11px] text-gray-500">
              Interface conversacional para inteligência de sinistralidade e subseguro.
            </p>
          </div>
        </div>
      </div>

      {/* Info Callout */}
      <div className="p-3 bg-blue-50/60 border-b border-blue-100 flex items-center gap-2.5 text-xs text-blue-900">
        <Info className="w-4 h-4 text-[#16578B] shrink-0" />
        <span>
          <strong>Ambiente Preparado:</strong> As mensagens enviadas são gravadas de forma
          estruturada no banco de dados para treinamento e conexão nativa do modelo LLM na Fase 1.
        </span>
      </div>

      {/* Messages List Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-[#F8FAFC]">
        {messages.length === 0 && (
          <div className="py-20 text-center max-w-sm mx-auto text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <h4 className="text-sm font-semibold text-gray-700">Canal de Chat Pronto</h4>
            <p className="text-xs mt-1">
              Envie uma mensagem de teste abaixo. A infraestrutura de mensagens já está persistida
              no banco.
            </p>
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
                  <Clock className="w-2.5 h-2.5" />
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

        {sending && (
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

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 border-t border-[#E4E9F0] bg-white flex items-center gap-2"
      >
        <Input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Digite sua dúvida sobre apólices, sinistros ou coberturas..."
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
