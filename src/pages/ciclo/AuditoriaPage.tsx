import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  ClipboardCheck,
  Plus,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  ArrowRight,
  Upload,
  RefreshCw,
  FileText,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatDate } from '@/lib/formatters'

interface AuditItem {
  campo: string
  valor_apoio: string
  valor_apolice: string
  status: 'adequado' | 'desvio'
  observacoes: string
}

interface AuditoriaRecord {
  id: string
  empreendimento: string
  apolice: string
  pdf_apolice: string
  status: 'Em auditoria' | 'Apto' | 'Desvios a ajustar' | 'Aprovado'
  analista: string
  data_aprovacao: string
  itens: AuditItem[]
  created: string
  expand?: {
    empreendimento?: { nome_empreendimento: string }
    apolice?: { numero_apolice: string; seguradora: string }
    analista?: { name: string; email: string }
  }
}

interface EmpreendimentoOpt {
  id: string
  nome_empreendimento: string
}

interface ApoliceOpt {
  id: string
  numero_apolice: string
  seguradora: string
  id_empreendimento: string
}

export default function AuditoriaPage() {
  const { user } = useAuth()
  const [auditorias, setAuditorias] = useState<AuditoriaRecord[]>([])
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoOpt[]>([])
  const [apolices, setApolices] = useState<ApoliceOpt[]>([])
  const [loading, setLoading] = useState(true)

  // New Audit Modal
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState('')
  const [selectedAp, setSelectedAp] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [creating, setCreating] = useState(false)

  // Checklist execution modal
  const [activeAudit, setActiveAudit] = useState<AuditoriaRecord | null>(null)
  const [checklistModalOpen, setChecklistModalOpen] = useState(false)
  const [savingChecklist, setSavingChecklist] = useState(false)

  // Endorsement draft modal
  const [endossoModalOpen, setEndossoModalOpen] = useState(false)
  const [endossoDraftText, setEndossoDraftText] = useState('')

  const fetchAuditorias = async () => {
    try {
      setLoading(true)
      const [auds, emps, aps] = await Promise.all([
        pb.collection('auditoria').getFullList<AuditoriaRecord>({
          sort: '-created',
          expand: 'empreendimento,apolice,analista',
        }),
        pb.collection('empreendimentos').getFullList<EmpreendimentoOpt>({
          sort: 'nome_empreendimento',
        }),
        pb.collection('apolices').getFullList<ApoliceOpt>({
          sort: 'numero_apolice',
        }),
      ])
      setAuditorias(auds)
      setEmpreendimentos(emps)
      setApolices(aps)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAuditorias()
  }, [])

  // Auto-generate checklist items based on risk card standard fields
  const handleCreateAudit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmp || !selectedAp) {
      alert('Selecione empreendimento e apólice.')
      return
    }

    try {
      setCreating(true)

      // Checklist template
      const defaultChecklist: AuditItem[] = [
        {
          campo: 'Razão Social e CNPJ do Segurado',
          valor_apoio: 'Conforme Cartão de Risco',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Endereço e Local de Risco',
          valor_apoio: 'Endereço cadastrado',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Vigência (Início e Fim)',
          valor_apoio: 'Período acordado no RFQ',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Cobertura Básica (Incêndio/Queda de Raio/Explosão)',
          valor_apoio: 'LMI total declarado em risco',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Cobertura: Alagamento e Inundação',
          valor_apoio: 'Exigência do QAR',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Cobertura: Danos Elétricos',
          valor_apoio: 'Sublimite solicitado',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Cobertura: Vendaval / Granizo',
          valor_apoio: 'Conforme QAR',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Cobertura: Lucros Cessantes / Despesas Fixas',
          valor_apoio: 'Período indenitário estipulado',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Cláusula de Rateio / Margem de Variação',
          valor_apoio: 'Cláusula de 80% / 100%',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
        {
          campo: 'Franquias e POS',
          valor_apoio: 'Conforme proposta selecionada',
          valor_apolice: '',
          status: 'adequado',
          observacoes: '',
        },
      ]

      const formData = new FormData()
      formData.append('empreendimento', selectedEmp)
      formData.append('apolice', selectedAp)
      formData.append('status', 'Em auditoria')
      formData.append('analista', user?.id || '')
      formData.append('itens', JSON.stringify(defaultChecklist))
      if (pdfFile) {
        formData.append('pdf_apolice', pdfFile)
      }

      await pb.collection('auditoria').create(formData)
      setNewModalOpen(false)
      setSelectedEmp('')
      setSelectedAp('')
      setPdfFile(null)
      fetchAuditorias()
    } catch (err: unknown) {
      alert('Erro ao criar auditoria: ' + (err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // Update Item status in checklist
  const handleItemToggle = (index: number, newStatus: 'adequado' | 'desvio') => {
    if (!activeAudit) return
    const updated = [...activeAudit.itens]
    updated[index].status = newStatus
    setActiveAudit({ ...activeAudit, itens: updated })
  }

  const handleItemValChange = (
    index: number,
    field: 'valor_apolice' | 'observacoes',
    val: string,
  ) => {
    if (!activeAudit) return
    const updated = [...activeAudit.itens]
    updated[index][field] = val
    setActiveAudit({ ...activeAudit, itens: updated })
  }

  // Save audit evaluation
  const handleSaveChecklist = async () => {
    if (!activeAudit) return
    try {
      setSavingChecklist(true)
      const hasDesvio = activeAudit.itens.some((item) => item.status === 'desvio')
      const finalStatus = hasDesvio ? 'Desvios a ajustar' : 'Apto'

      await pb.collection('auditoria').update(activeAudit.id, {
        itens: activeAudit.itens,
        status: finalStatus,
        data_aprovacao: finalStatus === 'Apto' ? new Date().toISOString().slice(0, 10) : '',
      })

      // Log into historico
      await pb.collection('historico').create({
        registro_id: activeAudit.id,
        tabela: 'auditoria',
        empreendimento: activeAudit.empreendimento,
        apolice: activeAudit.apolice || null,
        assunto: `Auditoria técnica — ${finalStatus}`,
        categoria: 'Decisão de Cobertura',
        data_fato: `${new Date().toISOString().slice(0, 10)} 00:00:00.000Z`,
        data: new Date().toISOString().slice(0, 10),
        cia: activeAudit.expand?.apolice?.seguradora || 'Seguradora',
        texto: `Auditoria técnica finalizada com status: ${finalStatus} (${activeAudit.itens.filter((i) => i.status === 'desvio').length} desvios).`,
        autor: user?.id,
        timestamp: new Date().toISOString(),
      })

      setChecklistModalOpen(false)
      fetchAuditorias()
    } catch (err: unknown) {
      alert('Erro ao salvar auditoria: ' + (err as Error).message)
    } finally {
      setSavingChecklist(false)
    }
  }

  // Build Endorsement Draft for insurer
  const handleOpenEndossoDraft = () => {
    if (!activeAudit) return
    const desvios = activeAudit.itens.filter((i) => i.status === 'desvio')
    const draft = `SOLICITAÇÃO DE ENDOSSO DE RETIFICAÇÃO DE APÓLICE
À Seguradora: ${activeAudit.expand?.apolice?.seguradora || 'Companhia Seguradora'}
Ref: Apólice nº ${activeAudit.expand?.apolice?.numero_apolice || '—'}
Segurado: ${activeAudit.expand?.empreendimento?.nome_empreendimento || '—'}

Prezados,
Durante a auditoria técnica de conformidade realizada pela corretora BYCOR Seguros, identificamos as seguintes divergências entre a proposta contratada / Cartão de Risco e o documento emitido:

${desvios
  .map(
    (d, idx) =>
      `${idx + 1}. Item: ${d.campo}\n   - Valor contratado / apoio: ${d.valor_apoio}\n   - Valor emitido na apólice: ${d.valor_apolice || 'Não consta'}\n   - Observações: ${d.observacoes || 'Ajuste requerido conforme cotação aprovada.'}`,
  )
  .join('\n\n')}

Solicitamos a emissão urgente de endosso de retificação regularizando as condições acima apontadas.

Atenciosamente,
BYCOR Consultoria e Corretora de Seguros`

    setEndossoDraftText(draft)
    setEndossoModalOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Módulo C5
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Emissão & Auditoria Técnica de Apólices
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Confronto detalhado campo a campo entre a apólice emitida pela seguradora e os
            documentos de apoio (Cartão de Risco / QAR), garantindo zero desvios técnicos antes da
            liberação.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={() => (window.location.href = '/auditoria-cartao-apolice')}
            variant="outline"
            className="border-blue-200 text-[#16578B] bg-blue-50/80 hover:bg-blue-100 text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
          >
            <FileCheck className="w-4 h-4 text-[#16578B]" />
            <span>Auditoria Cartão × Apólice (Persistente)</span>
          </Button>

          <Button
            onClick={() => setNewModalOpen(true)}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4 text-blue-300" />
            <span>Nova Auditoria Técnica</span>
          </Button>
        </div>
      </div>

      {/* Auditorias Table */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E4E9F0] flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Auditorias em Andamento e Histórico</h3>
          <span className="text-xs text-gray-500">{auditorias.length} registro(s)</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-gray-400">Carregando auditorias...</div>
        ) : auditorias.length === 0 ? (
          <div className="py-16 text-center px-4">
            <ClipboardCheck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-700">Nenhuma auditoria cadastrada</h4>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Inicie a auditoria técnica de uma apólice emitida selecionando o empreendimento e
              confrontando os limites com o cartão de risco.
            </p>
            <Button onClick={() => setNewModalOpen(true)} className="mt-4 bg-[#0F2B46] text-xs h-9">
              Iniciar primeira auditoria
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                <tr>
                  <th className="py-3 px-4">Empreendimento</th>
                  <th className="py-3 px-4">Apólice / Seguradora</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Analista</th>
                  <th className="py-3 px-4">Data Registro</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditorias.map((a) => {
                  return (
                    <tr
                      key={a.id}
                      onClick={() => {
                        setActiveAudit(a)
                        setChecklistModalOpen(true)
                      }}
                      className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-gray-900">
                        {a.expand?.empreendimento?.nome_empreendimento || 'Empreendimento'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-gray-800">
                          {a.expand?.apolice?.numero_apolice || 'Nº Apólice'}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {a.expand?.apolice?.seguradora || 'Seguradora'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            a.status === 'Aprovado'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : a.status === 'Apto'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : a.status === 'Desvios a ajustar'
                                  ? 'bg-red-50 text-red-700 border border-red-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {a.expand?.analista?.name || a.expand?.analista?.email || 'Analista Bycor'}
                      </td>
                      <td className="py-3 px-4 text-gray-500">{formatDate(a.created)}</td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveAudit(a)
                            setChecklistModalOpen(true)
                          }}
                          className="h-7 text-xs text-[#16578B] font-semibold"
                        >
                          <span>Auditar</span>
                          <ArrowRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: NOVA AUDITORIA */}
      <Dialog open={newModalOpen} onOpenChange={setNewModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-[#16578B]" />
              <span>Iniciar Auditoria Técnica</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Vincule o empreendimento e a apólice para gerar o checklist de conferência.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateAudit} className="space-y-4 pt-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">Empreendimento</Label>
              <select
                value={selectedEmp}
                onChange={(e) => setSelectedEmp(e.target.value)}
                className="w-full h-9 rounded border border-gray-300 bg-white px-2 text-xs"
                required
              >
                <option value="">Selecione o empreendimento...</option>
                {empreendimentos.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome_empreendimento}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">Apólice Emitida</Label>
              <select
                value={selectedAp}
                onChange={(e) => setSelectedAp(e.target.value)}
                className="w-full h-9 rounded border border-gray-300 bg-white px-2 text-xs"
                required
              >
                <option value="">Selecione a apólice...</option>
                {apolices.map((ap) => (
                  <option key={ap.id} value={ap.id}>
                    {ap.numero_apolice} — {ap.seguradora}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">
                PDF da Apólice (Opcional)
              </Label>
              <Input
                type="file"
                accept=".pdf"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setPdfFile(e.target.files[0])
                  }
                }}
                className="text-xs"
              />
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewModalOpen(false)}
                className="text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-9 font-semibold"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Criar Checklist de Auditoria
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: CHECKLIST ITEM-BY-ITEM */}
      {activeAudit && (
        <Dialog open={checklistModalOpen} onOpenChange={setChecklistModalOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto animate-scale-in">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-gray-900">
                Checklist de Auditoria Técnica
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {activeAudit.expand?.empreendimento?.nome_empreendimento} — Apólice:{' '}
                {activeAudit.expand?.apolice?.numero_apolice} (
                {activeAudit.expand?.apolice?.seguradora})
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-4 text-xs">
              {/* Status summary banner */}
              <div className="p-3 rounded-lg bg-gray-50 border flex items-center justify-between">
                <div>
                  <span className="font-bold text-gray-800">Resultado Atual da Auditoria:</span>
                  <div className="text-gray-500 text-[11px] mt-0.5">
                    {activeAudit.itens.filter((i) => i.status === 'desvio').length} desvio(s)
                    apontado(s).
                  </div>
                </div>

                {activeAudit.itens.some((i) => i.status === 'desvio') ? (
                  <Button
                    onClick={handleOpenEndossoDraft}
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Criar endosso para envio à seguradora
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5 text-emerald-600 font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Conformidade Plena (Apto)</span>
                  </div>
                )}
              </div>

              {/* Checklist Items Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs divide-y divide-gray-200">
                  <thead className="bg-gray-100 font-semibold text-gray-700">
                    <tr>
                      <th className="py-2.5 px-3 w-1/4">Campo Auditado</th>
                      <th className="py-2.5 px-3 w-1/4">Valor no Documento de Apoio</th>
                      <th className="py-2.5 px-3 w-1/4">Valor na Apólice Emitida</th>
                      <th className="py-2.5 px-3 text-center w-28">Avaliação</th>
                      <th className="py-2.5 px-3">Observações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeAudit.itens.map((item, idx) => (
                      <tr
                        key={idx}
                        className={
                          item.status === 'desvio' ? 'bg-red-50/50' : 'hover:bg-gray-50/60'
                        }
                      >
                        <td className="py-2.5 px-3 font-semibold text-gray-900">{item.campo}</td>
                        <td className="py-2.5 px-3 text-gray-600">{item.valor_apoio}</td>
                        <td className="py-2.5 px-3">
                          <Input
                            type="text"
                            value={item.valor_apolice}
                            onChange={(e) =>
                              handleItemValChange(idx, 'valor_apolice', e.target.value)
                            }
                            placeholder="Valor lido..."
                            className="h-7 text-xs bg-white"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="inline-flex rounded-md shadow-sm border overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleItemToggle(idx, 'adequado')}
                              className={`px-2 py-1 text-[10px] font-bold ${
                                item.status === 'adequado'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              Adequado
                            </button>
                            <button
                              type="button"
                              onClick={() => handleItemToggle(idx, 'desvio')}
                              className={`px-2 py-1 text-[10px] font-bold ${
                                item.status === 'desvio'
                                  ? 'bg-red-600 text-white'
                                  : 'bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              Desvio
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <Input
                            type="text"
                            value={item.observacoes}
                            onChange={(e) =>
                              handleItemValChange(idx, 'observacoes', e.target.value)
                            }
                            placeholder="Nota técnica..."
                            className="h-7 text-xs bg-white"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Actions */}
              <div className="pt-2 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChecklistModalOpen(false)}
                  className="text-xs h-9"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={savingChecklist}
                  onClick={handleSaveChecklist}
                  className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-9 font-semibold"
                >
                  {savingChecklist ? 'Salvando...' : 'Salvar e Concluir Avaliação'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* MODAL: ENDOSSO DRAFT */}
      <Dialog open={endossoModalOpen} onOpenChange={setEndossoModalOpen}>
        <DialogContent className="max-w-xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              Minuta de Endosso de Retificação
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Copie o texto abaixo e envie à seguradora solicitando a correção dos desvios
              apontados.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <textarea
              value={endossoDraftText}
              onChange={(e) => setEndossoDraftText(e.target.value)}
              className="w-full h-72 p-3 font-mono text-xs border rounded-lg bg-gray-50 text-gray-800 leading-relaxed focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(endossoDraftText)
                  alert('Texto do endosso copiado para a área de transferência!')
                }}
                className="text-xs h-8"
              >
                Copiar Texto
              </Button>
              <Button
                size="sm"
                onClick={() => setEndossoModalOpen(false)}
                className="bg-[#0F2B46] text-white text-xs h-8"
              >
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
