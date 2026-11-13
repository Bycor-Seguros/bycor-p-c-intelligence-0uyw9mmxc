import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import { processGuardiaWorkbook, ImportSummary } from '@/services/guardiaImporter'
import { clearGuardiaImportedData, ClearDatabaseResult } from '@/services/guardiaCleaner'
import {
  isRiskCardWorkbook,
  parseRiskCardWorkbook,
  matchRiskCardAgainstDatabase,
  saveRiskCardToDatabase,
  RiskCardData,
  RiskCardMatchResult,
  RiskCardImportSummary,
} from '@/services/riskCardReader'
import {
  FileSpreadsheet,
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  Plus,
  Loader2,
  Database,
  ArrowUpRight,
  Info,
  Trash2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  Building2,
  Layers,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatDate, formatCurrency } from '@/lib/formatters'
import { ApoliceUploadModal } from '@/components/ApoliceUploadModal'
import { ModalPortalDuploC1 } from '@/components/ModalPortalDuploC1'
import { TipoPortaEntrada } from '@/services/portalC1Service'
import { processarQarPdfVinculado } from '@/services/qarUploadFlow'
import type { QarUploadResultado } from '@/services/qarPersistencia'

interface DocumentRecord {
  id: string
  tipo: string
  arquivo: string
  versao: string
  data: string
  vinculado_empreendimento?: string
  vinculado_apolice?: string
  expand?: {
    vinculado_empreendimento?: { nome_empreendimento: string }
    vinculado_apolice?: { numero_apolice: string; seguradora: string }
  }
}

export default function RecebimentoPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filterTipo, setFilterTipo] = useState<string>('todos')

  // Importer state (Base Hotéis e Resorts)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  // Risk Card Reader state (Cartão de Risco XLSX)
  const [riskCardModalOpen, setRiskCardModalOpen] = useState(false)
  const [riskCardDragOver, setRiskCardDragOver] = useState(false)
  const [parsingRiskCard, setParsingRiskCard] = useState(false)
  const [riskCardFile, setRiskCardFile] = useState<File | null>(null)
  const [parsedRiskCard, setParsedRiskCard] = useState<RiskCardData | null>(null)
  const [riskCardMatch, setRiskCardMatch] = useState<RiskCardMatchResult | null>(null)
  const [savingRiskCard, setSavingRiskCard] = useState(false)
  const [riskCardSaveProgress, setRiskCardSaveProgress] = useState('')
  const [riskCardSummary, setRiskCardSummary] = useState<RiskCardImportSummary | null>(null)
  const [showRiskCardDetails, setShowRiskCardDetails] = useState(false)

  // Clear database state (Admin only)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [confirmClearInput, setConfirmClearInput] = useState('')
  const [clearing, setClearing] = useState(false)
  const [clearResult, setClearResult] = useState<ClearDatabaseResult | null>(null)

  // Portal Duplo C1: Diálogo explícito Conta Nova × Renovação
  const [portalDuploOpen, setPortalDuploOpen] = useState(false)
  const [ultimoTipoPorta, setUltimoTipoPorta] = useState<TipoPortaEntrada | null>(null)

  const isAdmin =
    user?.role === 'admin' ||
    user?.email === 'admin@bycor.com.br' ||
    user?.email === 'marcos@bycor.com.br'

  // Apolice PDF Upload Modal state
  const [apoliceModalOpen, setApoliceModalOpen] = useState(false)

  // Delete document
  const [docToDelete, setDocToDelete] = useState<DocumentRecord | null>(null)
  const [deletingDoc, setDeletingDoc] = useState(false)

  // Diagnóstico C1: duplicadas de Cartão de Risco + coberturas de Cartão de Risco sem LMI em nenhum campo
  const [c1DedupOpen, setC1DedupOpen] = useState(false)
  const [c1DedupLoading, setC1DedupLoading] = useState(false)
  const [c1DedupApolices, setC1DedupApolices] = useState<
    Array<{
      apolice: {
        id: string
        numero_apolice: string
        vigencia_inicio?: string
        vigencia_fim?: string
      }
      totalDuplicadas: number
      grupos: Array<{ nome: string; lmi: number; count: number; idsParaRemover: string[] }>
      totalSemLmi: number
      semLmi: Array<{ id: string; nome: string; origem: string }>
    }>
  >([])
  const [c1CheckingDuplicates, setC1CheckingDuplicates] = useState(false)

  // Regra de higienização: cobertura de Cartão de Risco SEM LMI em nenhum campo
  // (lmi_rs vazio/zero E is_escolhida zerado E is_atualizada zerado E is_atual zerado) é candidata à remoção.
  // Qualquer cobertura com LMI preenchida em QUALQUER desses campos é preservada
  // (ex.: "Custo de Defesa - RC" com lmi_rs=100000 e is_* zerados permanece).
  const isCoberturaSemLmiCartaoRisco = (c: Record<string, unknown>) => {
    const origem = String(c.origem || '').toLowerCase()
    if (!origem.includes('cart')) return false
    const lmiRs = Number(c.lmi_rs || 0)
    const isEscolhida = Number(c.is_escolhida || 0)
    const isAtualizada = Number(c.is_atualizada || 0)
    const isAtual = Number((c as Record<string, unknown>).is_atual || 0)
    return lmiRs <= 0 && isEscolhida <= 0 && isAtualizada <= 0 && isAtual <= 0
  }

  // Manual upload state
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [manualTipo, setManualTipo] = useState('Base de Apólices')
  const [manualVersao, setManualVersao] = useState('v1.0')
  const [manualData, setManualData] = useState(new Date().toISOString().slice(0, 10))
  const [manualFile, setManualFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  // Vínculo do documento ao cliente/empreendimento (e ciclo, quando houver) no upload
  const [manualEmpreendimentoId, setManualEmpreendimentoId] = useState('')
  const [manualRfqId, setManualRfqId] = useState('')
  const [empreendimentoOptions, setEmpreendimentoOptions] = useState<
    Array<{ id: string; nome_empreendimento: string; cnpj?: string }>
  >([])
  const [rfqOptions, setRfqOptions] = useState<
    Array<{ id: string; status: string; created: string; empreendimentoId?: string }>
  >([])
  const [qarResultado, setQarResultado] = useState<QarUploadResultado | null>(null)
  const [qarWarning, setQarWarning] = useState('')

  const fetchDocuments = async () => {
    try {
      setLoading(true)
      const res = await pb.collection('documentos').getFullList<DocumentRecord>({
        sort: '-data',
        expand: 'vinculado_empreendimento,vinculado_apolice',
      })
      setDocuments(res)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDocuments()
  }, [])

  // Carrega empreendimentos e ciclos (RFQs) quando o modal de upload abre —
  // o documento nasce vinculado ao cliente/empreendimento (e ciclo) escolhidos.
  useEffect(() => {
    if (!uploadModalOpen) return
    const load = async () => {
      try {
        const [emps, rfqs] = await Promise.all([
          pb.collection('empreendimentos').getFullList<{
            id: string
            nome_empreendimento: string
            cnpj?: string
          }>({ fields: 'id,nome_empreendimento,cnpj', sort: 'nome_empreendimento' }),
          pb.collection('rfq').getFullList<{
            id: string
            status: string
            created: string
            conta_empreendimento: string
          }>({ fields: 'id,status,created,conta_empreendimento', sort: '-created' }),
        ])
        setEmpreendimentoOptions(emps)
        setRfqOptions(
          rfqs.map((r) => ({
            id: r.id,
            status: String(r.status || ''),
            created: String(r.created || ''),
            empreendimentoId: r.conta_empreendimento || undefined,
          })),
        )
      } catch (err) {
        console.warn('Erro ao carregar empreendimentos/ciclos:', err)
      }
    }
    load()
  }, [uploadModalOpen])

  // Reabertura do modal: estado limpo (vínculo, resultado do QAR, avisos)
  useEffect(() => {
    if (!uploadModalOpen) return
    setManualEmpreendimentoId('')
    setManualRfqId('')
    setQarResultado(null)
    setQarWarning('')
    setManualFile(null)
  }, [uploadModalOpen])

  // Risk Card Processing Handlers
  const handleRiskCardFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setRiskCardDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectRiskCardFile(e.dataTransfer.files[0])
    }
  }

  const handleSelectRiskCardFile = async (file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      alert('Por favor, selecione um arquivo Excel (.xlsx) do Cartão de Risco.')
      return
    }

    try {
      setParsingRiskCard(true)
      setRiskCardFile(file)
      setParsedRiskCard(null)
      setRiskCardMatch(null)
      setRiskCardSummary(null)

      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })

      if (!isRiskCardWorkbook(wb)) {
        alert(
          'O arquivo selecionado não foi reconhecido como um Cartão de Risco padrão (estrutura de grade rótulo→valor com seções DADOS, VRD, Coberturas). Verifique o layout ou utilize a importação da Base Hotéis e Resorts.',
        )
        setParsingRiskCard(false)
        setRiskCardFile(null)
        return
      }

      const card = parseRiskCardWorkbook(wb, file.name)
      setParsedRiskCard(card)

      const matchRes = await matchRiskCardAgainstDatabase(card)
      setRiskCardMatch(matchRes)
    } catch (err: unknown) {
      alert('Erro ao analisar Cartão de Risco: ' + (err as Error).message)
      setRiskCardFile(null)
    } finally {
      setParsingRiskCard(false)
    }
  }

  const handleConfirmSaveRiskCard = async () => {
    if (!parsedRiskCard || !riskCardMatch || !riskCardFile) return

    try {
      setSavingRiskCard(true)
      setRiskCardSaveProgress('Iniciando gravação...')

      // REGRA GLOBAL DE INGESTÃO (C1):
      // Importar SOMENTE as coberturas com LMI preenchida (> 0).
      // Linhas puramente informativas ou sem LMI definida ficam de fora do processo.
      // O filtro ocorre aqui na confirmação/ingestão, preservando os parsers intocados.
      const coberturasComLmi = parsedRiskCard.coberturas.filter((c) => {
        const lmi = c.isEscolhida ?? c.isAtualizada ?? c.isAtual ?? null
        return typeof lmi === 'number' && lmi > 0
      })

      const cardParaIngestao: RiskCardData = {
        ...parsedRiskCard,
        coberturas: coberturasComLmi,
      }

      const res = await saveRiskCardToDatabase(
        cardParaIngestao,
        riskCardMatch,
        riskCardFile,
        user?.email || 'admin@bycor.com.br',
        (msg) => setRiskCardSaveProgress(msg),
      )
      setRiskCardSummary(res)
      fetchDocuments()
    } catch (err: unknown) {
      alert('Erro ao gravar Cartão de Risco: ' + (err as Error).message)
    } finally {
      setSavingRiskCard(false)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImportFile(e.dataTransfer.files[0])
    }
  }

  const handleImportFile = async (file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      alert('Por favor, selecione um arquivo Excel (.xlsx)')
      return
    }

    try {
      setImporting(true)
      setImportProgress('Lendo arquivo Excel...')
      setImportSummary(null)
      const summary = await processGuardiaWorkbook(
        file,
        user?.email || 'admin@bycor.com.br',
        (msg) => setImportProgress(msg),
      )
      setImportSummary(summary)

      // Also register this document in 'documentos'
      try {
        const formData = new FormData()
        formData.append('arquivo', file)
        formData.append('tipo', 'Base de Apólices')
        formData.append('versao', 'Importação Base Hotéis e Resorts')
        formData.append('data', new Date().toISOString().slice(0, 10))
        await pb.collection('documentos').create(formData)
        fetchDocuments()
      } catch {
        // ignore
      }
    } catch (err: unknown) {
      alert('Erro ao processar planilha: ' + (err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const handleConfirmDeleteDoc = async () => {
    if (!docToDelete) return
    try {
      setDeletingDoc(true)
      // O PocketBase apaga o arquivo físico vinculado automaticamente ao deletar o registro da collection
      await pb.collection('documentos').delete(docToDelete.id)
      setDocuments((prev) => prev.filter((d) => d.id !== docToDelete.id))
      setDocToDelete(null)
    } catch (err: unknown) {
      alert('Erro ao excluir documento: ' + (err as Error).message)
    } finally {
      setDeletingDoc(false)
    }
  }

  // Carregar diagnóstico de duplicadas e coberturas de Cartão de Risco sem LMI (qualquer apólice/processo)
  const handleCheckC1Duplicates = async () => {
    try {
      setC1CheckingDuplicates(true)

      // VARREDURA GLOBAL: qualquer apólice/processo com coberturas de origem Cartão de Risco
      const apols = await pb.collection('apolices').getFullList({
        sort: '-created',
      })

      const resultados: Array<{
        apolice: {
          id: string
          numero_apolice: string
          vigencia_inicio?: string
          vigencia_fim?: string
        }
        totalDuplicadas: number
        grupos: Array<{ nome: string; lmi: number; count: number; idsParaRemover: string[] }>
        totalSemLmi: number
        semLmi: Array<{ id: string; nome: string; origem: string }>
      }> = []

      for (const ap of apols) {
        const cobs = await pb.collection('coberturas').getFullList({
          filter: `id_apolice = '${ap.id}'`,
        })
        if (cobs.length === 0) continue

        // 1) Duplicadas: mesmo nome + mesmo LMI, mantendo a 1ª ocorrência
        const map = new Map<string, Array<{ id: string; nome: string; lmi: number }>>()
        for (const c of cobs) {
          const key = `${(c.nome_cobertura || '').trim().toLowerCase()}|${Number(c.lmi_rs || 0)}`
          const arr = map.get(key) || []
          arr.push({ id: c.id, nome: c.nome_cobertura, lmi: Number(c.lmi_rs || 0) })
          map.set(key, arr)
        }

        const grupos: Array<{
          nome: string
          lmi: number
          count: number
          idsParaRemover: string[]
        }> = []
        let total = 0

        map.forEach((items) => {
          if (items.length > 1) {
            const idsParaRemover = items.slice(1).map((x) => x.id)
            total += idsParaRemover.length
            grupos.push({
              nome: items[0].nome,
              lmi: items[0].lmi,
              count: items.length,
              idsParaRemover,
            })
          }
        })

        // 2) Sem LMI em nenhum campo (somente origem Cartão de Risco):
        // lmi_rs vazio/zero E is_escolhida zerado E is_atualizada zerado E is_atual zerado.
        const semLmi = cobs
          .filter((c) => isCoberturaSemLmiCartaoRisco(c as unknown as Record<string, unknown>))
          .map((c) => ({
            id: c.id as string,
            nome: String(c.nome_cobertura || '(sem nome)'),
            origem: String(c.origem || ''),
          }))

        if (total > 0 || semLmi.length > 0) {
          resultados.push({
            apolice: {
              id: ap.id,
              numero_apolice: ap.numero_apolice,
              vigencia_inicio: ap.vigencia_inicio,
              vigencia_fim: ap.vigencia_fim,
            },
            totalDuplicadas: total,
            grupos,
            totalSemLmi: semLmi.length,
            semLmi,
          })
        }
      }

      setC1DedupApolices(resultados)
      setC1DedupOpen(true)
    } catch (err: unknown) {
      alert('Erro ao verificar coberturas: ' + (err as Error).message)
    } finally {
      setC1CheckingDuplicates(false)
    }
  }

  // Confirmar remoção (duplicadas + sem LMI de Cartão de Risco) pelo modal da C1
  const handleConfirmRemoveC1Duplicates = async () => {
    try {
      setC1DedupLoading(true)
      let removidosDuplicadas = 0
      let removidosSemLmi = 0
      for (const item of c1DedupApolices) {
        for (const grp of item.grupos) {
          for (const idToDel of grp.idsParaRemover) {
            await pb.collection('coberturas').delete(idToDel)
            removidosDuplicadas++
          }
        }
        for (const semLmiItem of item.semLmi) {
          await pb.collection('coberturas').delete(semLmiItem.id)
          removidosSemLmi++
        }
      }
      alert(
        `Sucesso! ${removidosDuplicadas} cobertura(s) duplicada(s) e ${removidosSemLmi} cobertura(s) de Cartão de Risco sem LMI foram removidas com segurança.`,
      )
      setC1DedupOpen(false)
      setC1DedupApolices([])
    } catch (err: unknown) {
      alert('Erro ao remover coberturas: ' + (err as Error).message)
    } finally {
      setC1DedupLoading(false)
    }
  }

  const handleClearDatabase = async () => {
    if (confirmClearInput.trim().toUpperCase() !== 'LIMPAR') {
      alert('Digite LIMPAR para confirmar a exclusão.')
      return
    }

    try {
      setClearing(true)
      const res = await clearGuardiaImportedData()
      setClearResult(res)
      setConfirmClearInput('')
      fetchDocuments()
    } catch (err: unknown) {
      alert('Erro ao limpar base: ' + (err as Error).message)
    } finally {
      setClearing(false)
    }
  }

  const handleManualUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualFile) return
    const isQar = manualTipo === 'QAR'
    if (isQar && !manualEmpreendimentoId) {
      alert('Para um QAR, selecione o cliente/empreendimento ao qual o documento será vinculado.')
      return
    }

    try {
      setUploading(true)
      setQarResultado(null)
      setQarWarning('')

      if (isQar) {
        // QAR: fluxo dedicado — grava o documento E extrai o item 21 para
        // qar_declarados, vinculado ao empreendimento/ciclo escolhidos.
        setUploadProgress('Processando o Leitor de QAR...')
        const formData = new FormData()
        formData.append('arquivo', manualFile)
        formData.append('tipo', manualTipo)
        formData.append('versao', manualVersao)
        formData.append('data', manualData)
        formData.append('vinculado_empreendimento', manualEmpreendimentoId)
        if (manualRfqId) formData.append('rfq', manualRfqId)
        await pb.collection('documentos').create(formData)

        setUploadProgress('Extraindo dados declarados do QAR (item 21)...')
        const res = await processarQarPdfVinculado(
          {
            file: manualFile,
            empreendimentoId: manualEmpreendimentoId,
            ...(manualRfqId ? { rfqId: manualRfqId } : {}),
            usuarioEmail: user?.email || 'admin@bycor.com.br',
          },
          (msg) => setUploadProgress(msg),
        )
        setQarResultado(res)
        if (res.errors.length > 0) {
          setQarWarning(res.errors.join(' '))
        } else if (!res.isPretendidaGravada) {
          setQarWarning(
            'Nenhuma Importância Segurada pretendida foi identificada no item 21 do QAR.',
          )
        }
        if (res.success) {
          setManualFile(null)
        }
        fetchDocuments()
        return
      }

      const formData = new FormData()
      formData.append('arquivo', manualFile)
      formData.append('tipo', manualTipo)
      formData.append('versao', manualVersao)
      formData.append('data', manualData)
      if (manualEmpreendimentoId) {
        formData.append('vinculado_empreendimento', manualEmpreendimentoId)
      }
      if (manualRfqId) {
        formData.append('rfq', manualRfqId)
      }

      await pb.collection('documentos').create(formData)
      setUploadModalOpen(false)
      setManualFile(null)
      fetchDocuments()
    } catch (err: unknown) {
      alert('Erro no envio do documento: ' + (err as Error).message)
    } finally {
      setUploading(false)
      setUploadProgress('')
    }
  }

  const filteredDocs = documents.filter((doc) => {
    if (filterTipo === 'todos') return true
    return doc.tipo.toLowerCase() === filterTipo.toLowerCase()
  })

  const isQarTipo = manualTipo === 'QAR'

  return (
    <div className="space-y-6">
      {/* Top action banner */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Módulo C1
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Recebimento de Documentos & Base Hotéis e Resorts
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Central de ingestão de cartões de risco, questionários QAR e apólices. Realize a
            importação da Base Hotéis e Resorts diretamente pelo navegador sem persistência
            arbitrária de código.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* BOTÃO NOVO PROCESSO: PORTAL DUPLO C1 (CONTA NOVA × RENOVAÇÃO) */}
          <Button
            onClick={() => setPortalDuploOpen(true)}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-bold h-10 px-4 shadow-sm flex items-center gap-2 border border-[#0F2B46]"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Iniciar Novo Processo (Portal Duplo)</span>
          </Button>

          {/* BOTÃO LEITOR DE CARTÃO DE RISCO */}
          <Button
            onClick={() => {
              setRiskCardFile(null)
              setParsedRiskCard(null)
              setRiskCardMatch(null)
              setRiskCardSummary(null)
              setRiskCardModalOpen(true)
            }}
            variant="outline"
            className="border-[#16578B] text-[#16578B] hover:bg-blue-50/60 text-xs font-semibold h-10 px-3.5 shadow-sm flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-[#16578B]" />
            <span>Cartão de Risco (XLSX)</span>
          </Button>

          <Button
            onClick={() => {
              setImportSummary(null)
              setShowDiagnostics(false)
              setImportModalOpen(true)
            }}
            variant="outline"
            className="border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-medium h-10 px-3.5 shadow-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Base Hotéis (XLSX)</span>
          </Button>

          {/* BOTÃO DIAGNÓSTICO C1: DUPLICADAS + COBERTURAS SEM LMI (CARTÃO DE RISCO) */}
          <Button
            onClick={handleCheckC1Duplicates}
            disabled={c1CheckingDuplicates}
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 text-xs font-semibold h-10 px-3.5 shadow-sm flex items-center gap-2"
            title="Verificar coberturas duplicadas e coberturas de Cartão de Risco sem LMI (qualquer apólice/processo)"
          >
            {c1CheckingDuplicates ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            )}
            <span>Verificar Duplicadas e Sem LMI</span>
          </Button>

          {/* BOTÃO LEITOR DE APÓLICE EMITIDA (PDF) */}
          <Button
            onClick={() => setApoliceModalOpen(true)}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
          >
            <FileText className="w-4 h-4 text-blue-300" />
            <span>Subir Apólice (PDF)</span>
          </Button>

          {/* BOTÃO AUDITORIA CARTÃO × APÓLICE */}
          <Button
            onClick={() => navigate('/auditoria-cartao-apolice')}
            variant="outline"
            className="border-blue-200 text-[#16578B] bg-blue-50/70 hover:bg-blue-100 text-xs font-semibold h-10 px-3.5 shadow-sm flex items-center gap-2"
          >
            <FileCheck2 className="w-4 h-4 text-[#16578B]" />
            <span>Auditoria Cartão × Apólice</span>
          </Button>

          <Button
            onClick={() => setUploadModalOpen(true)}
            variant="outline"
            className="text-xs font-medium h-10 border-gray-300 hover:bg-gray-50 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Upload manual</span>
          </Button>

          {isAdmin && (
            <Button
              onClick={() => {
                setClearResult(null)
                setConfirmClearInput('')
                setClearModalOpen(true)
              }}
              variant="outline"
              className="text-xs font-medium h-10 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Limpar base importada</span>
            </Button>
          )}
        </div>
      </div>

      {/* Information Callout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/60 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#16578B] shrink-0 mt-0.5" />
          <div className="text-xs text-gray-700 leading-relaxed">
            <strong className="text-[#0F2B46]">Novo Leitor de Cartão de Risco:</strong> Envie o XLSX
            preenchido do Cartão de Risco para captura automática de dados cadastrais, construção,
            proteções, VRD com correção INCC, histórico de sinistros dos últimos 5 anos e coberturas
            solicitadas. Desempate inteligente de renovação vs. novo produto por ramo.
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs text-gray-700 leading-relaxed">
            <strong className="text-slate-900">Base Hotéis e Resorts:</strong> Importação
            consolidada de carteira com reconciliação multi-abas (Empreendimentos, Apólices,
            Coberturas, Sinistros, Matriz). Dados vigentes prevalecem para o mesmo produto.
          </div>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E4E9F0] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <Filter className="w-4 h-4 text-gray-400" />
            <span>Filtrar por tipo:</span>
            <div className="flex flex-wrap gap-1">
              {[
                'todos',
                'Base de Apólices',
                'Cartão de Risco',
                'QAR',
                'Questionário',
                'Proposta',
                'Apólice PDF',
                'Apresentação',
              ].map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterTipo(t)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    filterTipo === t
                      ? 'bg-[#0F2B46] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'todos' ? 'Todos' : t}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-gray-500 font-medium">
            {filteredDocs.length} documento(s) listado(s)
          </span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#16578B] mb-2" />
            <p className="text-xs">Carregando documentos...</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-3">
              <Database className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800">
              Nenhum documento ou dado importado
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Utilize o botão acima para importar a Base Hotéis e Resorts (.xlsx) ou adicione
              documentos avulsos para iniciar a gestão técnica do ciclo P&C.
            </p>
            <Button
              onClick={() => setImportModalOpen(true)}
              className="mt-4 bg-[#0F2B46] text-xs h-9"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Carregar planilha Base Hotéis e Resorts
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/75 text-gray-600 font-semibold border-b border-[#E4E9F0]">
                <tr>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Nome do Arquivo / Ref</th>
                  <th className="py-3 px-4">Vínculo</th>
                  <th className="py-3 px-4">Versão</th>
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDocs.map((doc) => {
                  const fileUrl = doc.arquivo
                    ? pb.files.getURL(doc as unknown as { [key: string]: unknown }, doc.arquivo)
                    : null
                  return (
                    <tr key={doc.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-800">
                          {doc.tipo}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-gray-900">
                        {doc.arquivo || 'Documento referencial'}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {doc.expand?.vinculado_empreendimento?.nome_empreendimento ||
                          doc.expand?.vinculado_apolice?.numero_apolice ||
                          'Geral da Carteira'}
                      </td>
                      <td className="py-3 px-4 text-gray-500">{doc.versao || 'v1.0'}</td>
                      <td className="py-3 px-4 text-gray-500">{formatDate(doc.data)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          {doc.tipo === 'Cartão de Risco' && fileUrl && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  setParsingRiskCard(true)
                                  setRiskCardModalOpen(true)
                                  const resp = await fetch(fileUrl)
                                  const blob = await resp.blob()
                                  const file = new File(
                                    [blob],
                                    doc.versao || 'Cartao_de_Risco.xlsx',
                                    {
                                      type: blob.type,
                                    },
                                  )
                                  await handleSelectRiskCardFile(file)
                                } catch (e) {
                                  alert('Erro ao carregar Cartão de Risco: ' + (e as Error).message)
                                  setParsingRiskCard(false)
                                }
                              }}
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-semibold bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded border border-blue-200 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Reprocessar</span>
                            </button>
                          )}
                          {fileUrl ? (
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[#16578B] hover:underline font-medium"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Baixar</span>
                            </a>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setDocToDelete(doc)}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 hover:bg-red-50 p-1.5 rounded transition-colors"
                            title="Excluir documento"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: LEITOR DE CARTÃO DE RISCO (XLSX) */}
      <Dialog open={riskCardModalOpen} onOpenChange={setRiskCardModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-gray-900">
              <ShieldCheck className="w-5 h-5 text-[#16578B]" />
              <span>Leitor de Cartão de Risco (XLSX)</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Captura e estrutura dados do Cartão de Risco operacional, distinguindo renovações de
              novos produtos para clientes já cadastrados.
            </DialogDescription>
          </DialogHeader>

          {/* 1. SELEÇÃO / DROPZONE DO ARQUIVO */}
          {!parsedRiskCard && (
            <div className="py-3 space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setRiskCardDragOver(true)
                }}
                onDragLeave={() => setRiskCardDragOver(false)}
                onDrop={handleRiskCardFileDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  riskCardDragOver
                    ? 'border-[#16578B] bg-blue-50/50'
                    : 'border-gray-300 hover:border-gray-400 bg-gray-50/50'
                }`}
              >
                {parsingRiskCard ? (
                  <div className="flex flex-col items-center justify-center py-4">
                    <Loader2 className="w-10 h-10 animate-spin text-[#16578B] mb-3" />
                    <p className="text-sm font-semibold text-gray-800">Lendo Cartão de Risco...</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Mapeando seções DADOS, VRD, Construção, Sinistros e Coberturas...
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-[#16578B] flex items-center justify-center mb-3">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">
                      Arraste o arquivo do Cartão de Risco (.xlsx)
                    </p>
                    <p className="text-xs text-gray-500 mt-1 mb-4">
                      Layout oficial de rótulos e valores em grade do programa P&C
                    </p>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleSelectRiskCardFile(e.target.files[0])
                          }
                        }}
                      />
                      <span className="px-4 py-2 rounded-lg bg-[#16578B] text-white text-xs font-semibold hover:bg-[#12456e] transition-colors shadow-sm">
                        Selecionar Cartão de Risco
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-gray-600 bg-blue-50/60 p-3 rounded-lg border border-blue-200/60 space-y-1">
                <div className="font-semibold text-[#0F2B46] flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Critérios inteligentes de recepção:</span>
                </div>
                <p>
                  • <strong>Deduplicação por Ramo:</strong> Clientes já existentes com produtos
                  distintos são tratados como <em>Novo Produto</em> sem gerar duplicatas no
                  cadastro.
                </p>
                <p>
                  • <strong>Preservação de Apólice Vigente:</strong> Para o mesmo produto em
                  renovação, dados de apólice não são sobrescritos — divergências são apontadas lado
                  a lado.
                </p>
                <p>
                  • <strong>Sinistros & Coberturas:</strong> Deduplicação canônica por chave natural
                  idempotente.
                </p>
              </div>
            </div>
          )}

          {/* 2. PAINEL DE CONFIRMAÇÃO / PRÉ-VISUALIZAÇÃO (3 DESFECHOS) */}
          {parsedRiskCard && riskCardMatch && !riskCardSummary && (
            <div className="py-2 space-y-4">
              {/* Badge visual do desfecho */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  riskCardMatch.outcome === 'RENOVACAO'
                    ? 'bg-blue-50 border-blue-300 text-blue-900'
                    : riskCardMatch.outcome === 'NOVO_PRODUTO'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                }`}
              >
                {riskCardMatch.outcome === 'RENOVACAO' ? (
                  <Building2 className="w-6 h-6 text-[#16578B] shrink-0 mt-0.5" />
                ) : riskCardMatch.outcome === 'NOVO_PRODUTO' ? (
                  <Layers className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <Sparkles className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/80 shadow-xs">
                      {riskCardMatch.outcome === 'RENOVACAO'
                        ? 'Cenário: Renovação Técnica'
                        : riskCardMatch.outcome === 'NOVO_PRODUTO'
                          ? 'Cenário: Novo Produto para Cliente Existente'
                          : 'Cenário: Cliente Novo'}
                    </span>
                    <span className="text-[11px] font-medium opacity-80">
                      Ramo: {riskCardMatch.ramoCanonicaCartao}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed mt-1 font-medium">{riskCardMatch.motivo}</p>
                </div>
              </div>
              {/* Resumo dos dados extraídos do Cartão */}
              <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-200 text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                  <span className="font-bold text-gray-800">
                    Dados Identificados no Cartão de Risco
                  </span>
                  <span className="text-[11px] text-gray-500 font-mono">
                    {parsedRiskCard.fileName}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div>
                    <span className="text-gray-500">Segurado:</span>{' '}
                    <strong className="text-gray-900">{parsedRiskCard.segurado || '—'}</strong>
                  </div>
                  <div>
                    <span className="text-gray-500">CNPJ:</span>{' '}
                    <strong className="text-gray-900">
                      {parsedRiskCard.cnpj || 'Não informado'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-gray-500">Local de Risco:</span>{' '}
                    <span className="text-gray-800 truncate inline-block max-w-[200px]">
                      {parsedRiskCard.localRisco || parsedRiskCard.endereco || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Vigência Desejada:</span>{' '}
                    <span className="text-gray-800">
                      {parsedRiskCard.vigenciaInicio || '—'}{' '}
                      {parsedRiskCard.vigenciaFim ? `a ${parsedRiskCard.vigenciaFim}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Tipo de Cobertura:</span>{' '}
                    <strong className="text-[#16578B]">{parsedRiskCard.tipoCobertura}</strong>
                  </div>
                  <div>
                    <span className="text-gray-500">Tipo de Operação:</span>{' '}
                    <span className="text-gray-800">
                      {parsedRiskCard.seguroRenovacao ? 'Renovação' : 'Novo'}
                      {parsedRiskCard.seguradoraAnterior
                        ? ` (Anterior: ${parsedRiskCard.seguradoraAnterior})`
                        : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">VRD Declarado Total:</span>{' '}
                    <strong className="text-gray-900">
                      {parsedRiskCard.vrd.totalAtualizado || parsedRiskCard.vrd.totalAtual
                        ? formatCurrency(
                            parsedRiskCard.vrd.totalAtualizado || parsedRiskCard.vrd.totalAtual,
                          )
                        : '—'}
                    </strong>
                    {parsedRiskCard.vrd.percentualIncc && (
                      <span className="ml-1 text-[10px] text-emerald-700 font-semibold">
                        (+{parsedRiskCard.vrd.percentualIncc}% INCC)
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">Sinistros Declarados:</span>{' '}
                    <strong className="text-gray-900">
                      {parsedRiskCard.sinistros.length > 0
                        ? `${parsedRiskCard.sinistros.length} evento(s)`
                        : 'Nenhum'}
                    </strong>
                  </div>
                </div>

                {/* Cossegurados se houver */}
                {parsedRiskCard.cossegurados.length > 0 && (
                  <div className="pt-1.5 border-t border-gray-200">
                    <span className="text-[11px] text-gray-500">
                      Cossegurados ({parsedRiskCard.cossegurados.length}):{' '}
                    </span>
                    <span className="text-[11px] text-gray-800 font-medium">
                      {parsedRiskCard.cossegurados
                        .map((c) => `${c.razaoSocial} (${c.cnpj})`)
                        .join(', ')}
                    </span>
                  </div>
                )}
              </div>
              {/* DIVERGÊNCIAS LADO A LADO (QUANDO HOUVER) */}
              {riskCardMatch.divergencias.length > 0 && (
                <div className="border border-amber-300 bg-amber-50/70 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Divergências Identificadas com a Apólice Vigente:</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Atenção: Os dados vigentes da apólice no sistema <strong>NÃO</strong> serão
                    sobrescritos. As diferenças serão mantidas no processo de cotação e registradas
                    no painel de divergências.
                  </p>
                  <div className="space-y-1.5 pt-1">
                    {riskCardMatch.divergencias.map((div, idx) => (
                      <div
                        key={idx}
                        className="bg-white/90 p-2 rounded-lg border border-amber-200 text-[11px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1"
                      >
                        <div>
                          <strong className="text-gray-900">{div.campo}:</strong>{' '}
                          <span className="text-gray-600">{div.descricao}</span>
                        </div>
                        <div className="shrink-0 flex items-center gap-2 font-mono text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                            Apólice: {formatCurrency(div.valorApoliceVigente)}
                          </span>
                          <span className="text-gray-400">vs</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-[#16578B] font-bold">
                            Cartão: {formatCurrency(div.valorCartaoRisco)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Ações / Botão Ver detalhes expansíveis */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRiskCardDetails(!showRiskCardDetails)}
                  className="w-full bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <span>
                    Detalhamento Completo das Coberturas e Sinistros (
                    {
                      parsedRiskCard.coberturas.filter((c) => {
                        const v = c.isEscolhida ?? c.isAtualizada ?? c.isAtual ?? null
                        return typeof v === 'number' && v > 0
                      }).length
                    }{' '}
                    com LMI de {parsedRiskCard.coberturas.length} no arquivo)
                  </span>
                  {showRiskCardDetails ? (
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </button>

                {showRiskCardDetails && (
                  <div className="p-3 bg-white space-y-3 max-h-64 overflow-y-auto text-xs">
                    {parsedRiskCard.sinistros.length > 0 && (
                      <div className="space-y-1">
                        <div className="font-semibold text-gray-800">Sinistros Declarados:</div>
                        {parsedRiskCard.sinistros.map((s, idx) => (
                          <div
                            key={idx}
                            className="p-1.5 bg-gray-50 rounded border text-[11px] text-gray-700 flex justify-between"
                          >
                            <span>
                              <strong>{s.ano}:</strong> {s.descricao}
                            </span>
                            {s.valorIndenizado && (
                              <span className="font-semibold text-red-700">
                                {formatCurrency(s.valorIndenizado)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-800">
                          Coberturas com LMI Preenchida (serão importadas no processo):
                        </span>
                        <span className="text-[10px] text-gray-500">
                          Linhas sem LMI são ignoradas
                        </span>
                      </div>
                      <div className="divide-y divide-gray-100 border rounded">
                        {parsedRiskCard.coberturas
                          .filter((c) => {
                            const v = c.isEscolhida ?? c.isAtualizada ?? c.isAtual ?? null
                            return typeof v === 'number' && v > 0
                          })
                          .map((c, idx) => (
                            <div
                              key={idx}
                              className="p-1.5 text-[11px] flex items-center justify-between gap-2 hover:bg-gray-50"
                            >
                              <div>
                                <span className="font-medium text-gray-800">{c.nomeOriginal}</span>
                                {c.categoriaNormalizada !== c.nomeOriginal && (
                                  <span className="text-[10px] text-gray-400 ml-1">
                                    → {c.categoriaNormalizada}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-right shrink-0">
                                {c.isEscolhida ? (
                                  <span className="text-[#16578B] font-bold">
                                    {formatCurrency(c.isEscolhida)}
                                  </span>
                                ) : c.isAtualizada ? (
                                  <span className="text-gray-900 font-semibold">
                                    {formatCurrency(c.isAtualizada)}
                                  </span>
                                ) : c.isAtual ? (
                                  <span className="text-gray-600">{formatCurrency(c.isAtual)}</span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Botões de Ação */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setParsedRiskCard(null)
                      setRiskCardMatch(null)
                      setRiskCardFile(null)
                    }}
                    disabled={savingRiskCard}
                    className="text-xs h-9"
                  >
                    Trocar Arquivo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/auditoria-cartao-apolice')}
                    disabled={savingRiskCard}
                    className="border-blue-200 text-[#16578B] hover:bg-blue-50 text-xs h-9 flex items-center gap-1.5"
                  >
                    <FileCheck2 className="w-3.5 h-3.5 text-[#16578B]" />
                    <span>Abrir Auditorias Salvas</span>
                  </Button>{' '}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRiskCardModalOpen(false)}
                    disabled={savingRiskCard}
                    className="text-xs h-9"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirmSaveRiskCard}
                    disabled={savingRiskCard}
                    className="bg-[#16578B] hover:bg-[#12456e] text-white text-xs font-semibold h-9 px-4 shadow-sm"
                  >
                    {savingRiskCard ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        <span>{riskCardSaveProgress || 'Gravando dados...'}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        <span>Confirmar e Iniciar Processo</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>{' '}
            </div>
          )}

          {/* 3. PAINEL DE DIAGNÓSTICO FINAL PÓS-GRAVAÇÃO */}
          {riskCardSummary && (
            <div className="py-3 space-y-4">
              <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold">Cartão de Risco Processado com Sucesso!</h4>
                  <p className="text-xs mt-1 text-green-700 leading-relaxed">
                    O documento de origem foi arquivado no módulo C1 e o processo de cotação foi
                    estruturado de forma idempotente e segura.
                  </p>
                </div>
              </div>
              {/* Badges de Mutações */}
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200">
                  <div className="text-lg font-bold text-emerald-700">
                    {riskCardSummary.createdCount}
                  </div>
                  <div className="text-[10px] text-emerald-800 font-semibold uppercase tracking-wider">
                    Criados Novos
                  </div>
                  <div className="text-[9px] text-emerald-600">Inserções no banco</div>
                </div>
                <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200">
                  <div className="text-lg font-bold text-[#16578B]">
                    {riskCardSummary.updatedCount}
                  </div>
                  <div className="text-[10px] text-[#0F2B46] font-semibold uppercase tracking-wider">
                    Atualizados
                  </div>
                  <div className="text-[9px] text-blue-600">Modificações gravadas</div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-lg font-bold text-gray-700">
                    {riskCardSummary.unchangedCount}
                  </div>
                  <div className="text-[10px] text-gray-700 font-semibold uppercase tracking-wider">
                    Inalterados
                  </div>
                  <div className="text-[9px] text-gray-500">Escritas evitadas</div>
                </div>
              </div>
              {/* Detalhes por entidade */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1.5">
                <div className="font-semibold text-gray-800 mb-1">Resumo Técnico da Operação:</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-700">
                  <div>
                    • Desfecho de Negócio:{' '}
                    <strong className="text-[#16578B]">
                      {riskCardSummary.outcome === 'RENOVACAO'
                        ? 'Renovação'
                        : riskCardSummary.outcome === 'NOVO_PRODUTO'
                          ? 'Novo Produto'
                          : 'Cliente Novo'}
                    </strong>
                  </div>
                  <div>
                    • Coberturas Gravadas:{' '}
                    <strong>
                      {riskCardSummary.coberturasCreated} novas /{' '}
                      {riskCardSummary.coberturasUpdated} atualiz.
                    </strong>
                  </div>
                  <div>
                    • Sinistros Gravados:{' '}
                    <strong>
                      {riskCardSummary.sinistrosCreated} novos /{' '}
                      {riskCardSummary.sinistrosUnchanged} inalterados
                    </strong>
                  </div>
                  <div>
                    • Divergências Registradas:{' '}
                    <strong>{riskCardSummary.divergenciasRecorded}</strong>
                  </div>
                </div>
              </div>
              {/* Erros residuais se houver */}
              {riskCardSummary.errors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-1">
                  <div className="font-semibold text-red-800 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                    <span>Observações residuais:</span>
                  </div>
                  {riskCardSummary.errors.map((e, idx) => (
                    <div key={idx}>• {e}</div>
                  ))}
                </div>
              )}
              <div className="pt-2 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const rodadaId = riskCardSummary?.auditoriaRodadaId || ''
                    setRiskCardModalOpen(false)
                    navigate(
                      rodadaId
                        ? `/auditoria-cartao-apolice?rodada=${rodadaId}`
                        : '/auditoria-cartao-apolice',
                    )
                  }}
                  className="border-blue-200 text-[#16578B] hover:bg-blue-50 text-xs h-9 px-3.5 flex items-center gap-1.5"
                >
                  <FileCheck2 className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Ver Relatório de Auditoria Persistente</span>
                </Button>
                <Button
                  onClick={() => {
                    setRiskCardModalOpen(false)
                    setParsedRiskCard(null)
                    setRiskCardMatch(null)
                    setRiskCardFile(null)
                    setRiskCardSummary(null)
                  }}
                  className="bg-[#0F2B46] text-xs h-9 px-4"
                >
                  Concluir e Fechar
                </Button>
              </div>{' '}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL: Importador da Base Hotéis e Resorts */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-gray-900">
              <FileSpreadsheet className="w-5 h-5 text-[#16578B]" />
              <span>Importador da Base Hotéis e Resorts</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Arraste ou selecione a planilha completa (.xlsx) da Base Hotéis e Resorts contendo as
              abas Empreendimentos, Apólices, Coberturas, Sinistros e Matriz.
            </DialogDescription>
          </DialogHeader>

          {!importSummary ? (
            <div className="py-4 space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  dragOver
                    ? 'border-[#16578B] bg-blue-50/50'
                    : 'border-gray-300 hover:border-gray-400 bg-gray-50/50'
                }`}
              >
                {importing ? (
                  <div className="flex flex-col items-center justify-center py-4">
                    <Loader2 className="w-10 h-10 animate-spin text-[#16578B] mb-3" />
                    <p className="text-sm font-semibold text-gray-800">{importProgress}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Processando abas e calculando indicadores técnicos...
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-[#16578B] flex items-center justify-center mb-3">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">
                      Arraste o arquivo .xlsx aqui
                    </p>
                    <p className="text-xs text-gray-500 mt-1 mb-4">
                      Ou clique abaixo para selecionar no seu computador
                    </p>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleImportFile(e.target.files[0])
                          }
                        }}
                      />
                      <span className="px-4 py-2 rounded-lg bg-[#0F2B46] text-white text-xs font-semibold hover:bg-[#1B3C5D] transition-colors shadow-sm">
                        Selecionar arquivo Excel
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
                <div className="font-semibold text-gray-700">Regras de processamento:</div>
                <p>• Mapeia automaticamente colunas padronizadas para as coleções do banco.</p>
                <p>
                  • Calcula <em>lmi_incendio_basica</em> e <em>razao_lmi_vr_dm</em> (alerta de
                  subseguro).
                </p>
                <p>
                  • Operação idempotente por chave natural (não duplica apólices nem
                  empreendimentos).
                </p>
              </div>
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold">Importação concluída com sucesso!</h4>
                  <p className="text-xs mt-1 text-green-700">
                    A base de dados foi estruturada e está pronta para consultas no portfólio e
                    renovações.
                  </p>
                </div>
              </div>
              {/* Resumo de mutações: Criados / Atualizados / Inalterados (escritas evitadas) */}
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200">
                  <div className="text-lg font-bold text-emerald-700">
                    {importSummary.createdCount ?? 0}
                  </div>
                  <div className="text-[10px] text-emerald-800 font-semibold uppercase tracking-wider">
                    Criados Novos
                  </div>
                  <div className="text-[9px] text-emerald-600">Inserções no banco</div>
                </div>
                <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200">
                  <div className="text-lg font-bold text-[#16578B]">
                    {importSummary.updatedCount ?? 0}
                  </div>
                  <div className="text-[10px] text-[#0F2B46] font-semibold uppercase tracking-wider">
                    Atualizados
                  </div>
                  <div className="text-[9px] text-blue-600">Alterações gravadas</div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-lg font-bold text-gray-700">
                    {importSummary.unchangedCount ?? 0}
                  </div>
                  <div className="text-[10px] text-gray-700 font-semibold uppercase tracking-wider">
                    Inalterados (Pulados)
                  </div>
                  <div className="text-[9px] text-gray-500">Escritas evitadas</div>
                </div>
              </div>
              {/* Totalizadores por coleção */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.empreendimentosCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Empreendimentos
                  </div>
                  {importSummary.statsByCollection?.empreendimentos && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {importSummary.statsByCollection.empreendimentos.unchanged} inalt.
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.apolicesCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Apólices
                  </div>
                  {importSummary.statsByCollection?.apolices && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {importSummary.statsByCollection.apolices.unchanged} inalt.
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.coberturasCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Coberturas
                  </div>
                  {importSummary.statsByCollection?.coberturas && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {importSummary.statsByCollection.coberturas.unchanged} inalt.
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.sinistrosCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Sinistros
                  </div>
                  {importSummary.statsByCollection?.sinistros && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {importSummary.statsByCollection.sinistros.unchanged} inalt.
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.matrizCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Matriz
                  </div>
                  {importSummary.statsByCollection?.matriz && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {importSummary.statsByCollection.matriz.unchanged} inalt.
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.notasCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Notas
                  </div>
                  {importSummary.statsByCollection?.notas_base && (
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {importSummary.statsByCollection.notas_base.unchanged} inalt.
                    </div>
                  )}
                </div>
              </div>
              {importSummary.reconciliationPasses !== undefined &&
                importSummary.reconciliationPasses > 0 && (
                  <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200/80 text-[#16578B] text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#16578B] shrink-0" />
                      <span>
                        Passada de reconciliação automática concluída (
                        {importSummary.reconciliationPasses} ciclo(s)):{' '}
                        <strong>{importSummary.reconciledCount ?? 0}</strong> registro(s)
                        verificado(s)/recuperado(s) com sucesso.
                      </span>
                    </div>
                  </div>
                )}
              {importSummary.ignoredRowsCount > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    {importSummary.ignoredRowsCount} linha(s) ignorada(s) por ausência de chave
                    identificadora ou vínculo não encontrado.
                  </span>
                </div>
              )}
              {/* Diagnostic per Sheet */}
              {importSummary.diagnostics && importSummary.diagnostics.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowDiagnostics(!showDiagnostics)}
                    className="w-full bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 flex items-center justify-between hover:bg-gray-100 transition-colors"
                  >
                    <span>
                      Diagnóstico de Colunas-Chave por Aba ({importSummary.diagnostics.length})
                    </span>
                    {showDiagnostics ? (
                      <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                  </button>

                  {showDiagnostics && (
                    <div className="p-3 bg-white space-y-2.5 max-h-72 overflow-y-auto text-xs">
                      {importSummary.diagnostics.map((diag, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded border border-gray-100 bg-gray-50/70 space-y-1.5"
                        >
                          <div className="flex items-center justify-between font-semibold text-gray-800">
                            <div className="flex items-center gap-1.5">
                              <span>{diag.sheetName}</span>
                              {diag.isPivoted && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700">
                                  Matriz Pivotada
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-gray-500 font-normal">
                              Linha de Cabeçalho:{' '}
                              {diag.foundHeaderRowIndex > 0
                                ? `Linha ${diag.foundHeaderRowIndex}`
                                : 'Não identificada'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 flex flex-wrap gap-x-4 gap-y-0.5">
                            {diag.isPivoted ? (
                              <>
                                <span>
                                  Categorias lidas: <strong>{diag.categoriesCount ?? 0}</strong>
                                </span>
                                <span>
                                  Colunas vinculadas:{' '}
                                  <strong className="text-emerald-700">
                                    {diag.matchedColumnsCount ?? 0}
                                  </strong>
                                </span>
                                <span>
                                  Registros gravados: <strong>{diag.processedRows}</strong>
                                </span>
                                {(diag.unmatchedColumnsCount ?? 0) > 0 && (
                                  <span className="text-amber-700 font-medium">
                                    Colunas não casadas: {diag.unmatchedColumnsCount}
                                  </span>
                                )}
                                {diag.unmatchedNumericColumns &&
                                  diag.unmatchedNumericColumns.length > 0 && (
                                    <span className="text-gray-500 font-normal">
                                      Colunas numéricas (totais):{' '}
                                      {diag.unmatchedNumericColumns.length}
                                    </span>
                                  )}
                              </>
                            ) : (
                              <>
                                <span>
                                  Linhas processadas: <strong>{diag.processedRows}</strong>
                                </span>
                                {diag.unchangedRows !== undefined && diag.unchangedRows > 0 && (
                                  <span className="text-gray-600 font-medium">
                                    Inalterados:{' '}
                                    <strong className="text-gray-800">{diag.unchangedRows}</strong>
                                  </span>
                                )}
                                {diag.updatedRows !== undefined && diag.updatedRows > 0 && (
                                  <span className="text-blue-700 font-medium">
                                    Atualizados: <strong>{diag.updatedRows}</strong>
                                  </span>
                                )}
                                {diag.createdRows !== undefined && diag.createdRows > 0 && (
                                  <span className="text-emerald-700 font-medium">
                                    Novos: <strong>{diag.createdRows}</strong>
                                  </span>
                                )}
                                <span>
                                  Linhas ignoradas: <strong>{diag.ignoredRows}</strong>
                                </span>
                              </>
                            )}
                            {diag.isPivoted &&
                              diag.unchangedRows !== undefined &&
                              diag.unchangedRows > 0 && (
                                <span className="text-gray-600 font-medium">
                                  Células inalteradas:{' '}
                                  <strong className="text-gray-800">{diag.unchangedRows}</strong>
                                </span>
                              )}
                          </div>
                          <div className="text-[11px]">
                            <span className="text-gray-500">
                              {diag.isPivoted ? 'Validação estrutural: ' : 'Chaves requeridas: '}
                            </span>
                            {diag.isPivoted ? (
                              <>
                                <span className="inline-block mr-1 px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-medium">
                                  Formato Pivotado (Categoria x Apólice) ✓
                                </span>
                                <span
                                  className={`inline-block mr-1 px-1.5 py-0.2 rounded text-[10px] font-mono ${
                                    (diag.matchedColumnsCount ?? 0) > 0
                                      ? 'bg-emerald-100 text-emerald-800 font-medium'
                                      : 'bg-red-100 text-red-800 font-bold'
                                  }`}
                                >
                                  {diag.matchedColumnsCount ?? 0} apólices casadas{' '}
                                  {(diag.matchedColumnsCount ?? 0) > 0 ? '✓' : '✗ nenhuma'}
                                </span>
                                {((diag.unmatchedApoliceColumns &&
                                  diag.unmatchedApoliceColumns.length > 0) ||
                                  (!diag.unmatchedApoliceColumns &&
                                    diag.unmatchedColumns &&
                                    diag.unmatchedColumns.length > 0)) && (
                                  <div className="mt-1.5 p-2 rounded bg-red-50/80 border border-red-200 text-[11px] text-red-900 space-y-1">
                                    <div className="font-semibold text-red-800 flex items-center gap-1">
                                      <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                      <span>
                                        {
                                          (
                                            diag.unmatchedApoliceColumns ||
                                            diag.unmatchedColumns ||
                                            []
                                          ).length
                                        }{' '}
                                        coluna(s) de apólice não vinculadas:
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-red-700 leading-relaxed">
                                      Colunas de apólices reais que não tiveram paridade conclusiva
                                      com a base de apólices (par empreendimento + seguradora ou
                                      desambiguação por ramo inconclusiva).
                                    </p>
                                    <div className="font-mono text-[10px] bg-white/90 p-1.5 rounded border border-red-200 max-h-24 overflow-y-auto space-y-0.5">
                                      {(
                                        diag.unmatchedApoliceColumns ||
                                        diag.unmatchedColumns ||
                                        []
                                      ).map((col, idx) => (
                                        <div
                                          key={idx}
                                          className="truncate text-red-900 font-medium"
                                        >
                                          • {col}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {diag.unmatchedNumericColumns &&
                                  diag.unmatchedNumericColumns.length > 0 && (
                                    <div className="mt-1.5 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-700 space-y-1">
                                      <div className="font-semibold text-slate-800 flex items-center gap-1">
                                        <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                        <span>
                                          {diag.unmatchedNumericColumns.length} coluna(s) numéricas
                                          identificadas (totais / valores de LMI):
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-600 leading-relaxed">
                                        Cabeçalhos numéricos (ex.: totais ou valores) ignorados para
                                        vínculo de apólice conforme especificação do modelo de
                                        dados.
                                      </p>
                                      <div className="font-mono text-[10px] bg-white/90 p-1 rounded border border-slate-200 max-h-16 overflow-y-auto">
                                        {diag.unmatchedNumericColumns.join(' | ')}
                                      </div>
                                    </div>
                                  )}
                              </>
                            ) : (
                              diag.requiredKeys.map((k) => {
                                const isFound = !diag.missingKeys.includes(k)
                                return (
                                  <span
                                    key={k}
                                    className={`inline-block mr-1 px-1.5 py-0.2 rounded text-[10px] font-mono ${
                                      isFound
                                        ? 'bg-emerald-100 text-emerald-800 font-medium'
                                        : 'bg-red-100 text-red-800 font-bold'
                                    }`}
                                  >
                                    {k} {isFound ? '✓' : '✗ ausente'}
                                  </span>
                                )
                              })
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {importSummary.errors.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>Falhas residuais ({importSummary.errors.length}):</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto p-2.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700 space-y-1">
                    {importSummary.errors.map((err, i) => (
                      <div key={i} className="flex items-start gap-1">
                        <span className="text-red-500 font-bold">•</span>
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-2.5 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Todas as abas e registros foram gravados com sucesso, sem erros residuais de
                    rede ou taxa de requisições.
                  </span>
                </div>
              )}
              <div className="pt-2 flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setImportModalOpen(false)
                    setImportSummary(null)
                  }}
                  className="bg-[#0F2B46] text-xs h-9"
                >
                  Fechar e Visualizar
                </Button>
              </div>{' '}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL: Limpar Base Importada (Admin Only) */}
      <Dialog open={clearModalOpen} onOpenChange={setClearModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-red-600">
              <ShieldAlert className="w-5 h-5" />
              <span>Limpar Base Importada (Base Hotéis e Resorts)</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Esta ação apaga todos os dados importados da Base Hotéis e Resorts respeitando a
              integridade referencial.
            </DialogDescription>
          </DialogHeader>

          {!clearResult ? (
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>Atenção: Ação irreversível!</span>
                </div>
                <p>
                  Serão excluídos os registros de{' '}
                  <strong>
                    Matriz, Coberturas, Sinistros, Notas, Divergências, Rastreabilidade, Apólices e
                    Empreendimentos
                  </strong>
                  .
                </p>
                <p className="text-[11px] text-red-700">
                  Usuários, contas, documentos avulsos, RFQ, propostas e histórico{' '}
                  <strong>NÃO</strong> serão afetados.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">
                  Para confirmar, digite{' '}
                  <span className="font-mono text-red-600 font-bold">LIMPAR</span> abaixo:
                </Label>
                <Input
                  type="text"
                  placeholder="LIMPAR"
                  value={confirmClearInput}
                  onChange={(e) => setConfirmClearInput(e.target.value)}
                  className="h-9 text-xs font-mono"
                  disabled={clearing}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setClearModalOpen(false)}
                  disabled={clearing}
                  className="text-xs h-9"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleClearDatabase}
                  disabled={confirmClearInput.trim().toUpperCase() !== 'LIMPAR' || clearing}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs h-9"
                >
                  {clearing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Confirmar Exclusão
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div
                className={`p-3 rounded-lg border text-xs ${clearResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  {clearResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  )}
                  <span>
                    {clearResult.success
                      ? 'Base importada limpa com sucesso!'
                      : 'Limpeza concluída com observações'}
                  </span>
                </div>
              </div>

              <div className="text-xs space-y-1.5 bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div className="font-semibold text-gray-700 mb-2">
                  Registros apagados por coleção:
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600">
                  <div>
                    Matriz: <strong>{clearResult.counts.matriz}</strong>
                  </div>
                  <div>
                    Coberturas: <strong>{clearResult.counts.coberturas}</strong>
                  </div>
                  <div>
                    Sinistros: <strong>{clearResult.counts.sinistros}</strong>
                  </div>
                  <div>
                    Notas da Base: <strong>{clearResult.counts.notas_base}</strong>
                  </div>
                  <div>
                    Divergências: <strong>{clearResult.counts.divergencias}</strong>
                  </div>
                  <div>
                    Rastreabilidade: <strong>{clearResult.counts.rastreabilidade}</strong>
                  </div>
                  <div>
                    Apólices: <strong>{clearResult.counts.apolices}</strong>
                  </div>
                  <div>
                    Empreendimentos: <strong>{clearResult.counts.empreendimentos}</strong>
                  </div>
                </div>
              </div>

              {clearResult.errors.length > 0 && (
                <div className="max-h-24 overflow-y-auto p-2 bg-red-50 rounded text-[11px] text-red-700 space-y-1">
                  {clearResult.errors.map((err, idx) => (
                    <div key={idx}>{err}</div>
                  ))}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  onClick={() => {
                    setClearModalOpen(false)
                    setClearResult(null)
                  }}
                  className="bg-[#0F2B46] text-xs h-9"
                >
                  Concluir
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL: Upload Manual */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              Upload Manual de Documento
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Adicione arquivos avulsos (PDF, XLSX, DOCX) com classificação de tipo.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleManualUpload} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">Tipo de Documento</Label>
              <select
                value={manualTipo}
                onChange={(e) => setManualTipo(e.target.value)}
                className="w-full text-xs h-9 rounded-md border border-gray-300 bg-white px-3 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
              >
                <option value="Base de Apólices">Base de Apólices</option>
                <option value="Cartão de Risco">Cartão de Risco</option>
                <option value="QAR">QAR</option>
                <option value="Questionário">Questionário</option>
                <option value="Proposta">Proposta</option>
                <option value="Apólice PDF">Apólice PDF</option>
                <option value="Apresentação">Apresentação</option>
                <option value="Outro">Outro</option>
              </select>
            </div>

            {/* VÍNCULO AO CLIENTE/EMPREENDIMENTO (E CICLO, QUANDO HOUVER) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">
                Cliente / Empreendimento
                {isQarTipo && <span className="text-red-500 ml-0.5">*</span>}
              </Label>
              <select
                value={manualEmpreendimentoId}
                onChange={(e) => {
                  setManualEmpreendimentoId(e.target.value)
                  // Ciclo: auto-seleciona o RFQ mais recente daquele empreendimento
                  const rfq = rfqOptions.find((r) => r.empreendimentoId === e.target.value)
                  setManualRfqId(rfq ? rfq.id : '')
                }}
                className="w-full text-xs h-9 rounded-md border border-gray-300 bg-white px-3 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
              >
                <option value="">— Sem vínculo (documento avulso) —</option>
                {empreendimentoOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome_empreendimento}
                    {emp.cnpj ? ` (${emp.cnpj})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">Ciclo / RFQ (opcional)</Label>
              <select
                value={manualRfqId}
                onChange={(e) => setManualRfqId(e.target.value)}
                className="w-full text-xs h-9 rounded-md border border-gray-300 bg-white px-3 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
              >
                <option value="">— Sem ciclo —</option>
                {rfqOptions
                  .filter(
                    (r) =>
                      !manualEmpreendimentoId ||
                      !r.empreendimentoId ||
                      r.empreendimentoId === manualEmpreendimentoId,
                  )
                  .map((r) => {
                    const empNome = empreendimentoOptions.find(
                      (x) => x.id === r.empreendimentoId,
                    )?.nome_empreendimento
                    return (
                      <option key={r.id} value={r.id}>
                        RFQ {r.created ? formatDate(r.created) : r.id}
                        {r.status ? ` — ${r.status}` : ''}
                        {empNome ? ` — ${empNome}` : ''}
                      </option>
                    )
                  })}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">Versão</Label>
                <Input
                  type="text"
                  value={manualVersao}
                  onChange={(e) => setManualVersao(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">Data de Referência</Label>
                <Input
                  type="date"
                  value={manualData}
                  onChange={(e) => setManualData(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">
                Arquivo (até 20MB)
                {isQarTipo && <span className="text-gray-500 font-normal"> — PDF do QAR</span>}
              </Label>
              <Input
                type="file"
                accept={isQarTipo ? 'application/pdf' : undefined}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setManualFile(e.target.files[0])
                  }
                }}
                className="text-xs file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 hover:file:bg-gray-200"
                required
              />
            </div>

            {uploading && uploadProgress && (
              <div className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#16578B]" />
                <span>{uploadProgress}</span>
              </div>
            )}

            {qarWarning && !uploading && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                <span>{qarWarning}</span>
              </div>
            )}

            {qarResultado && !uploading && (
              <div
                className={`rounded-md border px-3 py-2.5 space-y-1.5 text-xs ${
                  qarResultado.success
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {qarResultado.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  )}
                  <span className={qarResultado.success ? 'text-emerald-800' : 'text-red-800'}>
                    Leitor de QAR —{' '}
                    {qarResultado.success ? 'dados declarados gravados' : 'gravação com erros'}
                  </span>
                </div>
                <div className="text-gray-700">
                  {qarResultado.coberturasGravadas} coberturas declaradas lidas (
                  {qarResultado.created} gravadas, {qarResultado.updated} atualizadas,{' '}
                  {qarResultado.unchanged} já iguais)
                  {qarResultado.sugestoesIgnoradas > 0
                    ? `; ${qarResultado.sugestoesIgnoradas} sugestões do formulário ignoradas`
                    : ''}
                  .
                </div>
                {qarResultado.isPretendidaGravada && (
                  <div className="text-gray-700">
                    Importância Segurada pretendida e LMGs marcados vinculados ao empreendimento.
                  </div>
                )}
                {qarResultado.lmgsMarcados.length > 0 && (
                  <div className="text-gray-600">
                    LMGs marcados: {qarResultado.lmgsMarcados.join(', ')}
                  </div>
                )}
                {qarResultado.errors.length > 0 && (
                  <div className="text-red-700">
                    {qarResultado.errors.map((e, i) => (
                      <div key={i}>• {e}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadModalOpen(false)}
                className="text-xs h-9"
              >
                {qarResultado ? 'Fechar' : 'Cancelar'}
              </Button>
              {!qarResultado && (
                <Button
                  type="submit"
                  disabled={uploading}
                  className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-xs h-9"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  Salvar documento
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Leitor de Apólice Emitida em PDF */}
      <ApoliceUploadModal
        open={apoliceModalOpen}
        onOpenChange={setApoliceModalOpen}
        onSuccess={() => {
          fetchDocuments()
        }}
      />

      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE DOCUMENTO */}
      <Dialog open={Boolean(docToDelete)} onOpenChange={(open) => !open && setDocToDelete(null)}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              <span>Confirmar Exclusão de Documento</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Tem certeza que deseja excluir permanentemente este documento? O registro e o arquivo
              físico serão apagados da base de dados.
            </DialogDescription>
          </DialogHeader>

          {docToDelete && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1 text-xs">
              <div>
                <span className="font-semibold text-gray-700">Arquivo / Ref:</span>{' '}
                <span className="text-gray-900 font-mono break-all">{docToDelete.arquivo}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Tipo:</span>{' '}
                <span className="text-gray-900">{docToDelete.tipo}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Data:</span>{' '}
                <span className="text-gray-900">{formatDate(docToDelete.data)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deletingDoc}
              onClick={() => setDocToDelete(null)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deletingDoc}
              onClick={handleConfirmDeleteDoc}
              className="text-xs bg-red-600 hover:bg-red-700 font-semibold flex items-center gap-1.5"
            >
              {deletingDoc ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir Documento</span>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: DIAGNÓSTICO C1 — DUPLICADAS + COBERTURAS DE CARTÃO DE RISCO SEM LMI */}
      <Dialog open={c1DedupOpen} onOpenChange={setC1DedupOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <span>Coberturas Duplicadas e Sem LMI</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Diagnóstico de coberturas com mesmo nome e LMI (uploads repetidos de Cartão de Risco)
              e de coberturas de origem Cartão de Risco sem LMI em nenhum campo (lmi_rs,
              is_escolhida, is_atualizada e is_atual zerados). Aplicável a qualquer
              apólice/processo.
            </DialogDescription>
          </DialogHeader>

          {c1DedupApolices.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-600 bg-emerald-50 border border-emerald-200 rounded-lg">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <p className="font-semibold text-emerald-800">
                Nenhuma cobertura duplicada ou sem LMI encontrada!
              </p>
              <p className="text-emerald-700 text-[11px] mt-1">
                Todas as apólices estão com suas listas de coberturas limpas e sem duplicidade.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                <p className="font-semibold">
                  Foram encontradas apólices com coberturas duplicadas e/ou sem LMI:
                </p>
                <p className="text-[11px] text-amber-700">
                  Ao confirmar, o sistema preservará 1 ocorrência de cada cobertura duplicada,
                  removerá as coberturas de Cartão de Risco sem LMI em nenhum campo (lmi_rs,
                  is_escolhida, is_atualizada e is_atual zerados) e preservará toda cobertura com
                  LMI preenchida em qualquer um desses campos.
                </p>
              </div>

              <div className="space-y-3">
                {c1DedupApolices.map((item) => (
                  <div
                    key={item.apolice.id}
                    className="border border-gray-200 rounded-lg p-3 bg-white space-y-2"
                  >
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="font-semibold text-xs text-gray-900">
                        Apólice: {item.apolice.numero_apolice}
                        {item.apolice.vigencia_inicio && (
                          <span className="font-normal text-gray-500 ml-2">
                            ({formatDate(item.apolice.vigencia_inicio)} a{' '}
                            {formatDate(item.apolice.vigencia_fim)})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.totalDuplicadas > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold">
                            {item.totalDuplicadas} duplicada(s)
                          </span>
                        )}
                        {item.totalSemLmi > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">
                            {item.totalSemLmi} sem LMI
                          </span>
                        )}
                      </div>
                    </div>

                    {item.grupos.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">
                          Duplicadas (mesmo nome + mesmo LMI)
                        </p>
                        <div className="max-h-40 overflow-y-auto divide-y text-[11px]">
                          {item.grupos.map((grp, gIdx) => (
                            <div key={gIdx} className="py-1.5 flex items-center justify-between">
                              <span className="text-gray-800">{grp.nome}</span>
                              <span className="text-gray-500 font-mono">
                                {formatCurrency(grp.lmi)} ({grp.count}x → manter 1)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.semLmi.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1">
                          Sem LMI em nenhum campo (origem Cartão de Risco) — serão removidas
                        </p>
                        <div className="max-h-52 overflow-y-auto divide-y text-[11px]">
                          {item.semLmi.map((sl) => (
                            <div key={sl.id} className="py-1.5 flex items-center justify-between">
                              <span className="text-gray-800">{sl.nome}</span>
                              <span className="text-gray-400 text-[10px] italic">{sl.origem}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={c1DedupLoading}
                  onClick={() => setC1DedupOpen(false)}
                  className="text-xs"
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={c1DedupLoading}
                  onClick={handleConfirmRemoveC1Duplicates}
                  className="text-xs bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center gap-1.5"
                >
                  {c1DedupLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Removendo...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remover Duplicadas e Sem LMI</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL: Portal Duplo de Entrada C1 (Conta Nova × Renovação) */}
      <ModalPortalDuploC1
        open={portalDuploOpen}
        onOpenChange={setPortalDuploOpen}
        onSelectContaNova={() => {
          // Conta Nova: abre o leitor de Cartão de Risco ou direciona para prospecção
          setRiskCardFile(null)
          setParsedRiskCard(null)
          setRiskCardMatch(null)
          setRiskCardSummary(null)
          setRiskCardModalOpen(true)
        }}
        onSelectRenovacaoComCartao={async (file, _contaId) => {
          // Renovação com upload de Cartão de Risco do ano anterior: passa arquivo para o leitor existente
          setRiskCardModalOpen(true)
          await handleSelectRiskCardFile(file)
        }}
        onProcessoIniciado={(tipoPorta, _contaId) => {
          setUltimoTipoPorta(tipoPorta)
          fetchDocuments()
        }}
      />
    </div>
  )
}
