import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { enviarPerguntaAssistente } from '@/services/assistenteIaService'
import {
  atualizarConversationId,
  carregarHistoricoChat,
  salvarMensagemChat,
  type ChatMessageRecord,
  type ChatRole,
} from '@/services/chatHistoricoService'

/**
 * Store compartilhado do chat com o Assistente Bycor.
 *
 * Estado único em nível de módulo (singleton): usado simultaneamente pela tela
 * /chat (visão de tela cheia) e pelo painel lateral (drawer global no Layout),
 * que ficam montados ao mesmo tempo em /chat — por isso o estado é externo ao
 * React (useSyncExternalStore) e sincronizado entre as duas interfaces.
 *
 * Persistência: cada mensagem é gravada na coleção chat_messages vinculada ao
 * usuário logado; o conversation_id do thread do agente 'assistente-bycor' é
 * retomado ao recarregar a página (F5) ou navegar entre módulos.
 */

export interface ChatMessage extends ChatMessageRecord {}

const SUGESTOES_INICIAIS = [
  'Onde cadastro um empreendimento?',
  'Como recalculo uma rodada de auditoria?',
  'Como funciona a tabulação de equivalências?',
  'Qual o caminho para gerar o Estudo de Mercado?',
]

export function useSugestoesIniciaisChat() {
  return SUGESTOES_INICIAIS
}

interface ChatStoreState {
  messages: ChatMessage[]
  sending: boolean
  streamingText: string
  erro: string | null
  carregando: boolean
  /** true quando o thread atual ainda não tem conversa do agente. */
  threadNovo: boolean
  conversationId: string | null
  /** userId cujo histórico já foi carregado neste store. */
  loadedForUser: string | null
  /** true enquanto o carregamento do histórico está em curso. */
  carregandoHistorico: boolean
}

let state: ChatStoreState = {
  messages: [],
  sending: false,
  streamingText: '',
  erro: null,
  carregando: true,
  threadNovo: true,
  conversationId: null,
  loadedForUser: null,
  carregandoHistorico: false,
}

type Listener = () => void
const listeners = new Set<Listener>()

function setState(patch: Partial<ChatStoreState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function getState(): ChatStoreState {
  return state
}

/** Id local provisório para mensagens que ainda não têm registro no banco. */
function idLocal(prefix: string) {
  return `local-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

async function persistir(
  role: ChatRole,
  content: string,
  userId: string | null,
): Promise<ChatMessage> {
  const msg: ChatMessage = {
    id: idLocal(role === 'user' ? 'u' : 'a'),
    role,
    content,
    conversationId: state.conversationId,
    created: new Date().toISOString(),
  }
  setState({ messages: [...state.messages, msg] })
  if (!userId) return msg

  const salvo = await salvarMensagemChat({
    userId,
    role,
    content,
    conversationId: state.conversationId,
  })
  if (salvo) {
    // Substitui o item local pelo registro real (id/created do banco).
    setState({
      messages: state.messages.map((m) => (m.id === msg.id ? { ...salvo } : m)),
    })
    return { ...salvo }
  }
  return msg
}

async function carregarHistorico(userId: string) {
  // Já carregado (ou em curso) para este usuário: não recarrega.
  if (
    state.loadedForUser === userId &&
    (state.carregandoHistorico || state.messages.length > 0 || state.threadNovo === false)
  ) {
    return
  }
  if (state.carregandoHistorico && state.loadedForUser === userId) return
  setState({ carregando: true, carregandoHistorico: true, loadedForUser: userId })
  try {
    const { mensagens, conversationId } = await carregarHistoricoChat(userId)
    setState({
      messages: mensagens,
      conversationId,
      threadNovo: mensagens.length === 0,
      carregando: false,
      carregandoHistorico: false,
    })
  } catch {
    setState({ carregando: false, carregandoHistorico: false })
  }
}

async function enviar(texto: string) {
  const pergunta = texto.trim()
  if (!pergunta || state.sending) return

  const userId = state.loadedForUser
  setState({ erro: null, sending: true, streamingText: '' })

  try {
    // 1) Persiste a pergunta (com o conversation_id do thread em curso).
    const msgUsuario = await persistir('user', pergunta, userId)

    // 2) Pergunta ao agente, retomando o thread persistido.
    const resposta = await enviarPerguntaAssistente({
      mensagem: pergunta,
      conversationId: state.conversationId,
      onChunk: (_delta, acumulado) => setState({ streamingText: acumulado }),
    })

    if (resposta.conversationId) {
      // Em thread novo, a pergunta foi gravada sem conversation_id —
      // retroalimenta o registro com o id do thread criado.
      if (
        msgUsuario &&
        !msgUsuario.id.startsWith('local-') &&
        msgUsuario.conversationId !== resposta.conversationId
      ) {
        void atualizarConversationId(msgUsuario.id, resposta.conversationId)
      }
      setState({ conversationId: resposta.conversationId })
    }

    // 3) Persiste a resposta uma única vez (não-otimista, sem duplicar).
    setState({ streamingText: '' })
    await persistir('assistant', resposta.content, userId)
    setState({ threadNovo: false })
  } catch (err: unknown) {
    setState({ streamingText: '' })
    const detalhe =
      err instanceof Error && err.message
        ? err.message
        : 'Não foi possível falar com o assistente agora. Tente novamente em instantes.'
    setState({ erro: detalhe })
  } finally {
    setState({ sending: false })
  }
}

/** Inicia um thread novo (conversation_id limpo) sem apagar o histórico anterior. */
function novaConversa() {
  setState({
    conversationId: null,
    threadNovo: true,
    erro: null,
    streamingText: '',
    messages: [],
  })
}

export function useChatAssistente() {
  const { user } = useAuth()
  const snap = useSyncExternalStore(subscribe, getState, getState)
  const [inputVal, setInputVal] = useState('')

  useEffect(() => {
    if (user?.id) {
      void carregarHistorico(user.id)
    }
  }, [user?.id])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      void enviar(inputVal)
      setInputVal('')
    },
    [inputVal],
  )

  const handleSugestao = useCallback((texto: string) => {
    void enviar(texto)
  }, [])

  return {
    user,
    messages: snap.messages,
    inputVal,
    setInputVal,
    sending: snap.sending,
    streamingText: snap.streamingText,
    erro: snap.erro,
    carregando: snap.carregando,
    threadNovo: snap.threadNovo,
    enviar,
    novaConversa,
    handleSubmit,
    handleSugestao,
  }
}
