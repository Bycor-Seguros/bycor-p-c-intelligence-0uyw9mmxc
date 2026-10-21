import React, { useState, useEffect } from 'react'
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
import { formatDate } from '@/lib/formatters'

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

  const isAdmin =
    user?.role === 'admin' ||
    user?.email === 'admin@bycor.com.br' ||
    user?.email === 'marcos@bycor.com.br'

  // Manual upload state
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [manualTipo, setManualTipo] = useState('Base de Apólices')
  const [manualVersao, setManualVersao] = useState('v1.0')
  const [manualData, setManualData] = useState(new Date().toISOString().slice(0, 10))
  const [manualFile, setManualFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

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
      const res = await saveRiskCardToDatabase(
        parsedRiskCard,
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

    try {
      setUploading(true)
      const formData = new FormData()
      formData.append('arquivo', manualFile)
      formData.append('tipo', manualTipo)
      formData.append('versao', manualVersao)
      formData.append('data', manualData)

      await pb.collection('documentos').create(formData)
      setUploadModalOpen(false)
      setManualFile(null)
      fetchDocuments()
    } catch (err: unknown) {
      alert('Erro no envio do documento: ' + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const filteredDocs = documents.filter((doc) => {
    if (filterTipo === 'todos') return true
    return doc.tipo.toLowerCase() === filterTipo.toLowerCase()
  })

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
          {/* BOTÃO LEITOR DE CARTÃO DE RISCO */}
          <Button
            onClick={() => {
              setRiskCardFile(null)
              setParsedRiskCard(null)
              setRiskCardMatch(null)
              setRiskCardSummary(null)
              setRiskCardModalOpen(true)
            }}
            className="bg-[#16578B] hover:bg-[#12456e] text-white text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-blue-200" />
            <span>Enviar Cartão de Risco (XLSX)</span>
          </Button>

          <Button
            onClick={() => {
              setImportSummary(null)
              setShowDiagnostics(false)
              setImportModalOpen(true)
            }}
            variant="outline"
            className="border-[#0F2B46] text-[#0F2B46] hover:bg-blue-50/50 text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Importar Base Hotéis e Resorts (XLSX)</span>
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
                        ? `R$ ${(parsedRiskCard.vrd.totalAtualizado || parsedRiskCard.vrd.totalAtual)?.toLocaleString('pt-BR')}`
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
                            Apólice: R$ {Number(div.valorApoliceVigente).toLocaleString('pt-BR')}
                          </span>
                          <span className="text-gray-400">vs</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-[#16578B] font-bold">
                            Cartão: R$ {Number(div.valorCartaoRisco).toLocaleString('pt-BR')}
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
                    {parsedRiskCard.coberturas.length} coberturas mapeadas)
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
                                R$ {s.valorIndenizado.toLocaleString('pt-BR')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1">
                      <div className="font-semibold text-gray-800">
                        Coberturas e Valores Solicitados:
                      </div>
                      <div className="divide-y divide-gray-100 border rounded">
                        {parsedRiskCard.coberturas
                          .filter((c) => c.isAtual || c.isAtualizada || c.isEscolhida)
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
                                    R$ {c.isEscolhida.toLocaleString('pt-BR')}
                                  </span>
                                ) : c.isAtualizada ? (
                                  <span className="text-gray-900 font-semibold">
                                    R$ {c.isAtualizada.toLocaleString('pt-BR')}
                                  </span>
                                ) : c.isAtual ? (
                                  <span className="text-gray-600">
                                    R$ {c.isAtual.toLocaleString('pt-BR')}
                                  </span>
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
              <div className="pt-2 flex items-center justify-between">
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
              </div>
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

              <div className="pt-2 flex justify-end">
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
              </div>
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
              <Label className="text-xs font-semibold text-gray-700">Arquivo (até 20MB)</Label>
              <Input
                type="file"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setManualFile(e.target.files[0])
                  }
                }}
                className="text-xs file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 hover:file:bg-gray-200"
                required
              />
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadModalOpen(false)}
                className="text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={uploading}
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-xs h-9"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Salvar documento
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
