/**
 * Modal de Ingestão de CGs — Biblioteca de CGs (Fase 2, piloto AXA).
 *
 * Fluxo: upload do PDF da CG + seguradora + produto/versão → extração (leitor
 * cgIngestaoReader, pág/slotY padrão QAR) → casamento por similaridade via
 * motor C3 (casarComMotorC3 do cgIngestaoService) → FILA DE REVISÃO.
 *
 * Regra de ouro: NADA é gravado em cobertura_sinonimos sem confirmação humana.
 * Confirmar grava via salvarSinonimo (motor C3); rejeitar marca como candidato
 * a CG nova ou exclusão "não cobre" — nunca cria CG automaticamente.
 */

import { useState, useRef, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { extractTextFromPdf } from '@/services/pdfTextExtractor'
import {
  lerCondicoesGerais,
  detectarProcessoSusepCg,
  detectarProcessoSusepNomeArquivo,
  detectarProdutoVersaoCg,
  detectarPdfSemTextoCg,
  mensagemPdfSemTextoCg,
  chaveGuardaCg,
  guardasIguaisCg,
  type CgIngestaoItemExtraido,
} from '@/services/cgIngestaoReader'
import {
  regravarItensFaltantes,
  salvarSessaoIngestao,
  atualizarMetadadosSessao,
  confirmarItemIngestao,
  rejeitarItemIngestao,
  casarComMotorC3,
  carregarSessaoParaRetomada,
  urlArquivoPdfSessao,
  LIMIAR_CONFIANCA_CG,
  type CgIngestaoItemRetomada,
  type CgIngestaoRecord,
} from '@/services/cgIngestaoService'
import type { CoberturaCanonicaRecord } from '@/services/equivalenciaCoberturasService'
import type { SeguradoraCadastroRecord } from '@/services/seguradoraNormalizer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { VisualizadorCgPdf } from '@/components/comercial/VisualizadorCgPdf'
import {
  Upload,
  FileText,
  Check,
  X,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Ban,
  Eye,
} from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  canonicas: CoberturaCanonicaRecord[]
  seguradoras: SeguradoraCadastroRecord[]
  onIngestaoConcluida: () => void
  /** Sessão persistida a retomar (painel "Sessões de ingestão pendentes"). */
  sessaoRetomarId?: string | null
  onRetomarSessao?: (id: string | null) => void
}

interface FilaItem {
  uid: string
  extraido: CgIngestaoItemExtraido
  confianca: number
  matchType: string
  canonicaIdSelecionada: string
  canonicaNomeSelecionada: string
  status: 'pendente' | 'confirmado' | 'rejeitado'
  sinonimoId?: string
  destinoRejeicao?: 'candidato_cg_nova' | 'exclusao_nao_cobre'
  itemRecordId?: string
}

function formatoConfianca(c: number): string {
  return `${Math.round(c * 100)}%`
}

function corConfianca(c: number): string {
  if (c >= LIMIAR_CONFIANCA_CG) return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (c >= 0.5) return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

/**
 * Resolve o id do registro persistido do item (cg_ingestao_itens) SEM interpolar
 * a chave_normalizada no filtro: chaves com aspas duplas (ex.: 'Tumulto, Greve,
 * "Lock - Out" e Atos Dolosos') quebravam o filtro do PocketBase (400) e a
 * confirmação falhava ANTES de gravar — o card ficava pendente para sempre
 * (v0.0.242, só nesta cobertura, a única da fila com aspas no nome). Prefere o
 * itemRecordId já conhecido (retomada); senão lista os itens da sessão e casa a
 * chave EM MEMÓRIA — igualdade exata, com fallback tolerante a sufixo
 * (guardasIguaisCg, mesma semântica da guarda de re-ingestão).
 */
async function resolverItemRecordId(f: FilaItem, sessaoId: string): Promise<string> {
  if (f.itemRecordId) return f.itemRecordId
  const registros = await pb
    .collection('cg_ingestao_itens')
    .getFullList<{ id: string; chave_normalizada: string }>({
      filter: `ingestao="${sessaoId}"`,
      fields: 'id,chave_normalizada',
      batch: 20,
    })
  const chave = chaveGuardaCg(f.extraido.nomeExtraido)
  const alvo =
    registros.find((r) => (r.chave_normalizada || '') === chave) ||
    registros.find((r) => guardasIguaisCg(r.chave_normalizada || '', chave))
  if (!alvo) {
    throw new Error(
      'Registro do item não encontrado na sessão. Recarregue a página e confirme novamente.',
    )
  }
  return alvo.id
}

export default function IngestaoCgModal({
  open,
  onOpenChange,
  canonicas,
  seguradoras,
  onIngestaoConcluida,
  sessaoRetomarId,
  onRetomarSessao,
}: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [seguradoraId, setSeguradoraId] = useState('')
  const [seguradoraNome, setSeguradoraNome] = useState('')
  const [produtoVersao, setProdutoVersao] = useState('')
  const [processoSusep, setProcessoSusep] = useState('')
  const [extraindo, setExtraindo] = useState(false)
  const [salvandoSessao, setSalvandoSessao] = useState(false)
  const [fila, setFila] = useState<FilaItem[]>([])
  const [ingestaoId, setIngestaoId] = useState('')
  /** Gravação falhou no meio (429) — retentar regrava SÓ os itens faltantes. */
  const [gravacaoIncompleta, setGravacaoIncompleta] = useState(false)
  const [resumo, setResumo] = useState<{ confirmados: number; rejeitados: number } | null>(null)
  const [erro, setErro] = useState('')
  const [processandoUid, setProcessandoUid] = useState<string | null>(null)
  // ---- Retomada: sessão persistida carregada do banco (sem re-extrair PDF) ----
  const [retomando, setRetomando] = useState(false)
  const [sessaoRetomada, setSessaoRetomada] = useState<CgIngestaoRecord | null>(null)
  const [modoRetomada, setModoRetomada] = useState(false)
  // ---- Visualizador do PDF de origem ----
  // Enquanto a sessão não existe (nenhum item decidido), o visualizador usa o
  // PRÓPRIO arquivo local selecionado no upload (URL de blob) — o botão "Ver
  // no PDF" funciona desde o primeiro item da fila. Gravado o PDF em
  // cg_ingestoes.arquivo (1º Confirmar/Rejeitar), passa a valer urlPdfSessao.
  // Sessões antigas sem PDF ficam com os dois vazios (botão desabilitado).
  const [urlPdfSessao, setUrlPdfSessao] = useState('')
  const [urlBlobArquivo, setUrlBlobArquivo] = useState('')
  const urlBlobRef = useRef('')
  const [itemVisualizando, setItemVisualizando] = useState<FilaItem | null>(null)
  const [salvandoMetadados, setSalvandoMetadados] = useState(false)
  // Snapshot dos metadados carregados na retomada — detecta alteração do analista.
  const [metadadosIniciais, setMetadadosIniciais] = useState({ produto: '', processo: '' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  // PDF exibido pelo visualizador: gravado na sessão tem precedência; antes
  // disso (ou em upload novo sem decisão), o blob do arquivo local.
  const urlPdfAtivo = urlPdfSessao || urlBlobArquivo

  const reset = () => {
    setArquivo(null)
    setSeguradoraId('')
    setSeguradoraNome('')
    setProdutoVersao('')
    setProcessoSusep('')
    setExtraindo(false)
    setSalvandoSessao(false)
    setFila([])
    setIngestaoId('')
    setResumo(null)
    setErro('')
    setProcessandoUid(null)
    setRetomando(false)
    setSessaoRetomada(null)
    setModoRetomada(false)
    setUrlPdfSessao('')
    if (urlBlobRef.current) {
      URL.revokeObjectURL(urlBlobRef.current)
      urlBlobRef.current = ''
    }
    setUrlBlobArquivo('')
    setItemVisualizando(null)
    setSalvandoMetadados(false)
    setMetadadosIniciais({ produto: '', processo: '' })
  }

  useEffect(() => {
    if (!open) {
      reset()
      onRetomarSessao?.(null)
    }
  }, [open])

  // Painel "Sessões de ingestão pendentes" pediu a retomada de uma sessão.
  useEffect(() => {
    if (open && sessaoRetomarId && !modoRetomada && !retomando) {
      retomarSessao(sessaoRetomarId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessaoRetomarId])

  const handleSelecionarArquivo = async (f: File | null) => {
    if (!f) return
    setArquivo(f)
    // Blob do PDF local para o visualizador funcionar antes da 1ª decisão.
    if (urlBlobRef.current) URL.revokeObjectURL(urlBlobRef.current)
    const blobUrl = URL.createObjectURL(f)
    urlBlobRef.current = blobUrl
    setUrlBlobArquivo(blobUrl)
    setErro('')
    setFila([])
    setIngestaoId('')
    setResumo(null)
    setExtraindo(true)
    try {
      const pages = await extractTextFromPdf(f, 350)
      if (!pages.length) throw new Error('Nenhum texto extraído do PDF.')

      // Guarda v0.0.223: PDF escaneado (só imagem, sem camada de texto) falha
      // AQUI — mensagem clara ao analista, ANTES de qualquer leitura ou gravação.
      // Como o erro acontece em handleSelecionarArquivo, nenhuma sessão de
      // ingestão (cg_ingestoes) é criada: a fila fica vazia e o fluxo para.
      const deteccao = detectarPdfSemTextoCg(pages)
      if (deteccao.semTexto) {
        throw new Error(mensagemPdfSemTextoCg(deteccao.paginas))
      }

      const textoCompleto = pages.map((p) => p.text).join('\n')
      // Processo SUSEP: detecta do TEXTO (autoridade) e só cai para o NOME do
      // arquivo quando o texto não casa — uma fonte nunca sobrescreve a outra
      // quando só uma acerta. Ambos os caminhos devolvem a forma canônica com
      // barra (ex.: 15414.902020/2014-36), tolerando a fragmentação do pdf.js
      // no cabeçalho e o espaço no lugar da barra no nome do arquivo.
      const p = detectarProcessoSusepCg(textoCompleto)
      if (p) setProcessoSusep(p)
      else {
        const pNome = detectarProcessoSusepNomeArquivo(f.name)
        if (pNome) setProcessoSusep(pNome)
      }
      const v = detectarProdutoVersaoCg(textoCompleto)
      if (v && !produtoVersao.trim()) setProdutoVersao(v)

      const leitura = lerCondicoesGerais(pages)
      const itensCobertura = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      if (!itensCobertura.length) {
        throw new Error(
          'Nenhuma seção candidata a cobertura encontrada. Verifique se o PDF é uma CG válida.',
        )
      }

      const filaMontada: FilaItem[] = itensCobertura.map((it, idx) => ({
        uid: `cg_${idx}_${it.pagina}_${Math.round(it.slotY)}`,
        extraido: it,
        confianca: 0,
        matchType: 'sem_sugestao',
        canonicaIdSelecionada: '',
        canonicaNomeSelecionada: '',
        status: 'pendente',
      }))
      setFila(filaMontada)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e))
      setFila([])
    } finally {
      setExtraindo(false)
    }
  }

  /** Monta a fila de revisão: motor C3 sugere a CG canônica de cada item extraído. */
  const montarSugestoes = () => {
    setFila((prev) =>
      prev.map((f) => {
        const casamento = casarComMotorC3(f.extraido.nomeExtraido, canonicas)
        return {
          ...f,
          confianca: casamento.confianca,
          matchType: casamento.matchType,
          canonicaIdSelecionada: casamento.canonicaId,
          canonicaNomeSelecionada: casamento.canonicaNome,
        }
      }),
    )
  }

  /**
   * Grava a sessão (cg_ingestoes) e os itens como pendentes — em lotes com
   * retry no 429 (v0.0.207: fila RN da AXA ~1.300 itens estourava o
   * rate-limit). Idempotente: retentar NUNCA cria sessão duplicada (chave de
   * idempotência seguradora+produto+arquivo, migration 0050) nem itens
   * duplicados (chave_normalizada já gravada é pulada).
   * Falha no meio: lança com `sessaoIdIncompleta` — a fila segue na memória e
   * `regravarItensFaltantes` completa pela MESMA sessão.
   */
  const iniciarSessao = async (): Promise<string> => {
    if (ingestaoId && !gravacaoIncompleta) return ingestaoId
    // Sessão JÁ existia e a gravação falhou no meio (429) — seja no upload de
    // agora, seja numa sessão retomada do painel de pendentes: regrava SOMENTE
    // os itens faltantes pela MESMA sessão — nunca duplica sessão nem itens.
    if (ingestaoId && gravacaoIncompleta) {
      if (!fila.length) throw new Error('Nenhum item na fila para regravar.')
      setSalvandoSessao(true)
      try {
        const itens = fila.map((f) => ({
          tipoItem: 'cobertura' as const,
          nomeExtraido: f.extraido.nomeExtraido,
          secaoOrigem: f.extraido.secaoOrigem,
          pagina: f.extraido.pagina,
          slotY: f.extraido.slotY,
          exclusoes: f.extraido.exclusoes.map((e) => e.texto),
          sugestaoCanonicaId: f.canonicaIdSelecionada,
          sugestaoCanonicaNome: f.canonicaNomeSelecionada,
          confianca: f.confianca,
          matchType: f.matchType,
          status: 'pendente' as const,
        }))
        const resultado = await regravarItensFaltantes({
          id: ingestaoId,
          itens,
        })
        if (!resultado.sucesso) {
          const err = new Error(
            resultado.erro || 'Falha ao regravar os itens faltantes da sessão.',
          ) as Error & { sessaoIdIncompleta?: string }
          err.sessaoIdIncompleta = ingestaoId
          throw err
        }
        setGravacaoIncompleta(false)
        return ingestaoId
      } finally {
        setSalvandoSessao(false)
      }
    }
    if (!arquivo || !seguradoraId) throw new Error('Seguradora e PDF são obrigatórios.')
    setSalvandoSessao(true)
    try {
      const itens = fila.map((f) => ({
        tipoItem: 'cobertura' as const,
        nomeExtraido: f.extraido.nomeExtraido,
        secaoOrigem: f.extraido.secaoOrigem,
        pagina: f.extraido.pagina,
        slotY: f.extraido.slotY,
        exclusoes: f.extraido.exclusoes.map((e) => e.texto),
        sugestaoCanonicaId: f.canonicaIdSelecionada,
        sugestaoCanonicaNome: f.canonicaNomeSelecionada,
        confianca: f.confianca,
        matchType: f.matchType,
        status: 'pendente' as const,
      }))
      const chaveIngestao = `${seguradoraId}-${produtoVersao.trim()}-${arquivo.name}`
      const resultado = await salvarSessaoIngestao(
        {
          seguradoraId,
          seguradoraNome: seguradoraNome.trim(),
          produtoVersao: produtoVersao.trim(),
          processoSusep: processoSusep.trim(),
          fonteArquivo: arquivo.name,
          arquivoPdf: arquivo,
          totalItens: itens.length,
          totalExclusoes: itens.reduce((acc, i) => acc + i.exclusoes.length, 0),
          itens,
        },
        chaveIngestao,
      )
      if (!resultado.sucesso) {
        setIngestaoId(resultado.sessao.id)
        setGravacaoIncompleta(true)
        const err = new Error(resultado.erro || 'Falha ao gravar os itens da sessão.') as Error & {
          sessaoIdIncompleta?: string
        }
        err.sessaoIdIncompleta = resultado.sessao.id
        throw err
      }
      setIngestaoId(resultado.sessao.id)
      setGravacaoIncompleta(false)
      // Sessão nova: o PDF acaba de ser gravado em cg_ingestoes.arquivo.
      setUrlPdfSessao(urlArquivoPdfSessao(resultado.sessao))
      return resultado.sessao.id
    } finally {
      setSalvandoSessao(false)
    }
  }

  const handleConfirmar = async (f: FilaItem) => {
    if (!f.canonicaIdSelecionada) {
      setErro('Selecione a CG canônica de destino antes de confirmar.')
      return
    }
    try {
      setProcessandoUid(f.uid)
      setErro('')
      const id = await iniciarSessao()
      const usuarioId = pb.authStore.record?.id as string | undefined
      // Encontra o registro persistido do item para atualizar seu status
      // (sem filtro por chave — chaves com aspas duplas quebravam o PocketBase).
      const itemRecordId = await resolverItemRecordId(f, id)
      const resultado = await confirmarItemIngestao({
        itemRecordId,
        item: {
          tipoItem: 'cobertura',
          nomeExtraido: f.extraido.nomeExtraido,
          secaoOrigem: f.extraido.secaoOrigem,
          pagina: f.extraido.pagina,
          slotY: f.extraido.slotY,
          exclusoes: f.extraido.exclusoes.map((e) => e.texto),
          sugestaoCanonicaId: f.canonicaIdSelecionada,
          sugestaoCanonicaNome: f.canonicaNomeSelecionada,
          confianca: f.confianca,
          matchType: f.matchType,
          status: 'pendente',
        },
        seguradoraId,
        seguradoraNome: seguradoraNome.trim(),
        canonicaId: f.canonicaIdSelecionada,
        canonicaNome: f.canonicaNomeSelecionada,
        usuarioId,
      })
      setFila((prev) =>
        prev.map((x) =>
          x.uid === f.uid ? { ...x, status: 'confirmado', sinonimoId: resultado.sinonimoId } : x,
        ),
      )
      setResumo((prev) => ({
        confirmados: (prev?.confirmados ?? 0) + 1,
        rejeitados: prev?.rejeitados ?? 0,
      }))
      onIngestaoConcluida()
    } catch (e: unknown) {
      setErro(
        e instanceof Error && (e as Error & { sessaoIdIncompleta?: string }).sessaoIdIncompleta
          ? `${e.message} — a sessão ficou "Ingestão incompleta"; revise a conexão e confirme/rejeite de novo (os itens já gravados não são duplicados).`
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setProcessandoUid(null)
    }
  }

  const handleRejeitar = async (
    f: FilaItem,
    destino: 'candidato_cg_nova' | 'exclusao_nao_cobre',
  ) => {
    try {
      setProcessandoUid(f.uid)
      setErro('')
      const id = await iniciarSessao()
      const usuarioId = pb.authStore.record?.id as string | undefined
      const itemRecordId = await resolverItemRecordId(f, id)
      await rejeitarItemIngestao({ itemRecordId, destino, usuarioId })
      setFila((prev) =>
        prev.map((x) =>
          x.uid === f.uid ? { ...x, status: 'rejeitado', destinoRejeicao: destino } : x,
        ),
      )
      setResumo((prev) => ({
        confirmados: prev?.confirmados ?? 0,
        rejeitados: (prev?.rejeitados ?? 0) + 1,
      }))
      onIngestaoConcluida()
    } catch (e: unknown) {
      setErro(
        e instanceof Error && (e as Error & { sessaoIdIncompleta?: string }).sessaoIdIncompleta
          ? `${e.message} — a sessão ficou "Ingestão incompleta"; revise a conexão e confirme/rejeite de novo (os itens já gravados não são duplicados).`
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setProcessandoUid(null)
    }
  }

  /**
   * RETOMADA de sessão persistida: carrega a fila de cg_ingestao_itens SEM
   * re-extrair o PDF e sem recriar a sessão. Itens confirmados/rejeitados
   * voltam com o status gravado — nunca reaparecem como pendentes nem são
   * duplicados. Confirmar/rejeitar daqui usa o MESMO confirmarItemIngestao /
   * rejeitarItemIngestao do fluxo de upload, atualizando o próprio registro.
   */
  const retomarSessao = async (recordId: string) => {
    setRetomando(true)
    setErro('')
    try {
      const { sessao, itens } = await carregarSessaoParaRetomada(recordId)
      setSessaoRetomada(sessao)
      setSeguradoraId(sessao.seguradora)
      setSeguradoraNome(sessao.seguradora_nome || '')
      setProdutoVersao(sessao.produto_versao || '')
      setProcessoSusep(sessao.processo_susep || '')
      setMetadadosIniciais({
        produto: sessao.produto_versao || '',
        processo: sessao.processo_susep || '',
      })
      setIngestaoId(sessao.id)
      setUrlPdfSessao(urlArquivoPdfSessao(sessao))
      setModoRetomada(true)
      // Sessão com gravação interrompida (badge "Ingestão incompleta" no painel):
      // a 1ª ação do analista regrava SÓ os itens faltantes pela MESMA sessão.
      if (sessao.ingestao_incompleta) setGravacaoIncompleta(true)
      const filaRetomada: FilaItem[] = itens.map((it: CgIngestaoItemRetomada) => ({
        uid: `cg_ret_${it.itemRecordId}`,
        extraido: {
          tipoItem: it.tipoItem,
          nomeExtraido: it.nomeExtraido,
          secaoOrigem: it.secaoOrigem,
          pagina: it.pagina,
          slotY: it.slotY,
          exclusoes: it.exclusoes.map((t) => ({ texto: t, pagina: it.pagina, slotY: it.slotY })),
        },
        confianca: it.confianca,
        matchType: it.matchType,
        canonicaIdSelecionada: it.sugestaoCanonicaId,
        canonicaNomeSelecionada: it.sugestaoCanonicaNome,
        status: it.status,
        sinonimoId: it.sinonimoGravadoId,
        destinoRejeicao: it.destinoRejeicao,
        itemRecordId: it.itemRecordId,
      }))
      setFila(filaRetomada)
      const jaConfirmados = itens.filter((i) => i.status === 'confirmado').length
      const jaRejeitados = itens.filter((i) => i.status === 'rejeitado').length
      if (jaConfirmados || jaRejeitados) {
        setResumo({ confirmados: jaConfirmados, rejeitados: jaRejeitados })
      } else {
        setResumo(null)
      }
      onRetomarSessao?.(sessao.id)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setRetomando(false)
    }
  }

  const pendentes = fila.filter((f) => f.status === 'pendente')
  const processados = fila.length - pendentes.length

  /**
   * GRAVA no registro cg_ingestoes os metadados editados na retomada
   * (produto/versão e processo SUSEP). Escopo restrito à sessão: nunca
   * propaga para sinônimos nem valida divergência detectado×digitado.
   */
  const persistirMetadadosSessao = async () => {
    if (!modoRetomada || !ingestaoId || salvandoMetadados) return
    if (
      produtoVersao.trim() === metadadosIniciais.produto &&
      processoSusep.trim() === metadadosIniciais.processo
    )
      return
    try {
      setSalvandoMetadados(true)
      const sessaoAtualizada = await atualizarMetadadosSessao(ingestaoId, {
        produtoVersao: produtoVersao.trim(),
        processoSusep: processoSusep.trim(),
      })
      setSessaoRetomada(sessaoAtualizada)
      setMetadadosIniciais({
        produto: sessaoAtualizada.produto_versao || '',
        processo: sessaoAtualizada.processo_susep || '',
      })
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setSalvandoMetadados(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#16578B]" />
            Ingerir CG da seguradora
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Sistema sugere, analista confirma. Nada é gravado sem sua revisão.
          </DialogDescription>
        </DialogHeader>

        {modoRetomada && sessaoRetomada && (
          <div className="flex items-center gap-2 text-[11px] text-[#16578B] bg-blue-50 border border-blue-200 rounded px-3 py-2">
            <FileText className="w-4 h-4 shrink-0" />
            <span>
              Sessão retomada — <strong>{sessaoRetomada.seguradora_nome || 'seguradora'}</strong>
              {sessaoRetomada.fonte_arquivo ? ` · ${sessaoRetomada.fonte_arquivo}` : ''} · itens
              recarregados do banco, sem re-extrair o PDF.
            </span>
          </div>
        )}

        <div className="space-y-4">
          {/* Etapa 1: upload e metadados */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">PDF da Condição Geral</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => handleSelecionarArquivo(e.target.files?.[0] ?? null)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                disabled={extraindo || !!fila.length}
              />
              {arquivo && (
                <p className="text-[11px] text-gray-500 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> {arquivo.name}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Seguradora</Label>
              <select
                value={seguradoraId}
                onChange={(e) => {
                  setSeguradoraId(e.target.value)
                  const s = seguradoras.find((x) => x.id === e.target.value)
                  setSeguradoraNome(s?.nome || '')
                }}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                disabled={extraindo || !!fila.length}
              >
                <option value="">Selecione…</option>
                {seguradoras.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Produto / versão da CG</Label>
              <Input
                value={produtoVersao}
                onChange={(e) => setProdutoVersao(e.target.value)}
                placeholder="ex.: AXA Empresarial 2024"
                className="text-xs"
                disabled={extraindo}
                onBlur={modoRetomada ? persistirMetadadosSessao : undefined}
              />
              {modoRetomada &&
                produtoVersao !== metadadosIniciais.produto &&
                !salvandoMetadados && (
                  <p className="text-[10px] text-amber-700">
                    Alterado — será gravado na sessão ao sair do campo.
                  </p>
                )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Processo SUSEP (detectado)</Label>
              <Input
                value={processoSusep}
                onChange={(e) => setProcessoSusep(e.target.value)}
                placeholder="—"
                className="text-xs"
                disabled={extraindo}
                onBlur={modoRetomada ? persistirMetadadosSessao : undefined}
              />
              {modoRetomada &&
                processoSusep !== metadadosIniciais.processo &&
                !salvandoMetadados && (
                  <p className="text-[10px] text-amber-700">
                    Alterado — será gravado na sessão ao sair do campo.
                  </p>
                )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={montarSugestoes}
              disabled={!fila.length || extraindo || !seguradoraId || salvandoSessao}
              className="text-xs"
            >
              Gerar sugestões (motor C3)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFila([])}
              disabled={extraindo || !fila.length}
              className="text-xs"
            >
              Descartar leitura
            </Button>
          </div>

          {erro && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {/* mensagens longas (ex.: PDF escaneado) quebram em várias linhas */}
              <span className="min-w-0 flex-1 whitespace-pre-line">{erro}</span>
            </div>
          )}

          {extraindo && (
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Extraindo texto do PDF…
            </p>
          )}

          {/* Etapa 2: fila de revisão */}
          {fila.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">
                  Fila de revisão — {pendentes.length} pendente(s) / {fila.length} item(ns)
                </p>
                {resumo && (
                  <p className="text-[11px] text-gray-500">
                    {resumo.confirmados} confirmado(s), {resumo.rejeitados} rejeitado(s)
                  </p>
                )}
              </div>

              {fila.map((f) => (
                <div key={f.uid} className="border rounded p-3 space-y-2 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">
                        {f.extraido.nomeExtraido}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        Página {f.extraido.pagina} · {f.extraido.secaoOrigem}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {urlPdfAtivo ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setItemVisualizando(f)}
                          className="h-6 px-2 text-[10px]"
                          title={`Ver no PDF — página ${f.extraido.pagina}`}
                        >
                          <Eye className="w-3 h-3 mr-1" /> Ver no PDF
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          className="h-6 px-2 text-[10px]"
                          title="Sessão sem PDF anexado"
                        >
                          <Eye className="w-3 h-3 mr-1" /> Ver no PDF
                        </Button>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${corConfianca(f.confianca)}`}
                      >
                        {formatoConfianca(f.confianca)}
                      </span>
                    </div>
                  </div>

                  {f.extraido.exclusoes.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase">
                        Exclusões extraídas ({f.extraido.exclusoes.length})
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {f.extraido.exclusoes.slice(0, 3).map((e, i) => (
                          <li key={i} className="text-[11px] text-gray-600 leading-snug">
                            • {e.texto}
                          </li>
                        ))}
                        {f.extraido.exclusoes.length > 3 && (
                          <li className="text-[10px] text-gray-400">
                            + {f.extraido.exclusoes.length - 3} exclusão(ões)…
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {f.status === 'pendente' && (
                    <div className="space-y-2">
                      <Label className="text-[11px]">CG canônica de destino</Label>
                      <select
                        value={f.canonicaIdSelecionada}
                        onChange={(e) => {
                          const v = e.target.value
                          setFila((prev) =>
                            prev.map((x) =>
                              x.uid === f.uid
                                ? {
                                    ...x,
                                    canonicaIdSelecionada: v,
                                    canonicaNomeSelecionada:
                                      canonicas.find((c) => c.id === v)?.nome || '',
                                  }
                                : x,
                            ),
                          )
                        }}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                      >
                        <option value="">
                          {f.canonicaIdSelecionada
                            ? '— Remover seleção'
                            : f.confianca >= LIMIAR_CONFIANCA_CG
                              ? f.canonicaNomeSelecionada
                              : 'Sem sugestão firme — escolha manual'}
                        </option>
                        {canonicas.map((c) => {
                          const selecionada = c.id === f.canonicaIdSelecionada
                          return (
                            <option key={c.id} value={c.id}>
                              {selecionada ? `✓ Selecionada — ${c.nome}` : c.nome}
                            </option>
                          )
                        })}
                      </select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleConfirmar(f)}
                          disabled={!f.canonicaIdSelecionada || processandoUid === f.uid}
                          className="text-xs"
                        >
                          {processandoUid === f.uid ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejeitar(f, 'candidato_cg_nova')}
                          disabled={processandoUid === f.uid}
                          className="text-xs"
                        >
                          <Ban className="w-3 h-3" /> Candidato a CG nova
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejeitar(f, 'exclusao_nao_cobre')}
                          disabled={processandoUid === f.uid}
                          className="text-xs"
                        >
                          <X className="w-3 h-3" /> Exclusão "não cobre"
                        </Button>
                      </div>
                    </div>
                  )}

                  {f.status === 'confirmado' && (
                    <p className="text-[11px] text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Confirmado — sinônimo gravado
                      {f.sinonimoId ? ` (${f.sinonimoId})` : ''}
                    </p>
                  )}
                  {f.status === 'rejeitado' && (
                    <p className="text-[11px] text-gray-500 flex items-center gap-1">
                      <Ban className="w-3 h-3" /> Rejeitado —{' '}
                      {f.destinoRejeicao === 'candidato_cg_nova'
                        ? 'candidato a CG nova'
                        : 'exclusão "não cobre"'}
                    </p>
                  )}
                </div>
              ))}

              {processados === fila.length && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                  Todos os itens desta leitura foram revisados.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Fechar
          </Button>
        </DialogFooter>

        {/* Visualizador do PDF de origem — página exata do item (pdf.js) */}
        <Dialog open={!!itemVisualizando} onOpenChange={(o) => !o && setItemVisualizando(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#16578B]" />
                Origem no PDF — Página {itemVisualizando?.extraido.pagina}
                {!!itemVisualizando?.extraido.slotY &&
                  ` · posição ${Math.round(itemVisualizando.extraido.slotY)}`}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-gray-500">
                {itemVisualizando?.extraido.secaoOrigem}
              </DialogDescription>
            </DialogHeader>
            {itemVisualizando && (
              <VisualizadorCgPdf
                urlPdf={urlPdfAtivo}
                pagina={itemVisualizando.extraido.pagina}
                slotY={itemVisualizando.extraido.slotY}
                nomeItem={itemVisualizando.extraido.nomeExtraido}
              />
            )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
