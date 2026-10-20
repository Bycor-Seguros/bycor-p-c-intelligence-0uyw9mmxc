import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import { processGuardiaWorkbook, ImportSummary } from '@/services/guardiaImporter'
import { clearGuardiaImportedData, ClearDatabaseResult } from '@/services/guardiaCleaner'
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
} from 'lucide-react'
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

  // Importer state
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

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
  const [manualTipo, setManualTipo] = useState('Cartão de Risco')
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
        formData.append('tipo', 'Cartão de Risco')
        formData.append('versao', 'Importação Guardia')
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
              Recebimento de Documentos & Base Guardia
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Central de ingestão de cartões de risco, questionários QAR e apólices. Realize a
            importação da base unificada Guardia diretamente pelo navegador sem persistência
            arbitrária de código.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={() => {
              setImportSummary(null)
              setShowDiagnostics(false)
              setImportModalOpen(true)
            }}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Importar base Guardia (Excel)</span>
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
      <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/60 flex items-start gap-3">
        <Info className="w-5 h-5 text-[#16578B] shrink-0 mt-0.5" />
        <div className="text-xs text-gray-700 leading-relaxed">
          <strong className="text-[#0F2B46]">Importação In-App Segura:</strong> Ao arrastar a
          planilha da base Guardia, o sistema parseia automaticamente as abas{' '}
          <em>Empreendimentos, Apólices, Coberturas, Sinistros, Matriz e Notas</em> no seu
          navegador, calculando o LMI da cobertura básica de incêndio e a razão LMI / Valor em Risco
          DM. Registros existentes são atualizados de forma idempotente.
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
              Utilize o botão acima para importar a base Guardia (.xlsx) ou adicione documentos
              avulsos para iniciar a gestão técnica do ciclo P&C.
            </p>
            <Button
              onClick={() => setImportModalOpen(true)}
              className="mt-4 bg-[#0F2B46] text-xs h-9"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Carregar planilha Guardia
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
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Importador da Base Guardia */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-gray-900">
              <FileSpreadsheet className="w-5 h-5 text-[#16578B]" />
              <span>Importador da Base Guardia</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Arraste ou selecione a planilha completa (.xlsx) contendo as abas Empreendimentos,
              Apólices, Coberturas, Sinistros e Matriz.
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.empreendimentosCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Empreendimentos
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.apolicesCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Apólices
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.coberturasCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Coberturas
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.sinistrosCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Sinistros
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.matrizCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Matriz
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-base font-bold text-[#0F2B46]">
                    {importSummary.notasCount}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase font-semibold truncate">
                    Notas
                  </div>
                </div>
              </div>
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
                    <div className="p-3 bg-white space-y-2.5 max-h-60 overflow-y-auto text-xs">
                      {importSummary.diagnostics.map((diag, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded border border-gray-100 bg-gray-50/70 space-y-1"
                        >
                          <div className="flex items-center justify-between font-semibold text-gray-800">
                            <span>{diag.sheetName}</span>
                            <span className="text-[11px] text-gray-500 font-normal">
                              Linha de Cabeçalho:{' '}
                              {diag.foundHeaderRowIndex > 0
                                ? `Linha ${diag.foundHeaderRowIndex}`
                                : 'Não identificada'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 flex flex-wrap gap-x-4 gap-y-0.5">
                            <span>
                              Linhas processadas: <strong>{diag.processedRows}</strong>
                            </span>
                            <span>
                              Linhas ignoradas: <strong>{diag.ignoredRows}</strong>
                            </span>
                          </div>
                          <div className="text-[11px]">
                            <span className="text-gray-500">Chaves requeridas: </span>
                            {diag.requiredKeys.map((k) => {
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
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {importSummary.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto p-2 bg-red-50 rounded text-[11px] text-red-700 space-y-1">
                  {importSummary.errors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
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
              <span>Limpar Base Importada (Guardia)</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Esta ação apaga todos os dados importados das coleções da base técnica respeitando a
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
