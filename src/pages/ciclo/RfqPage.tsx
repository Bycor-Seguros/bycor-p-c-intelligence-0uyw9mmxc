import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  Send,
  Plus,
  Clock,
  Building,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Calendar,
  Layers,
  Search,
  Filter,
  Loader2,
  ArrowRight,
  PackageCheck,
  FileSpreadsheet,
  Printer,
  Copy,
  Trash2,
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
import { formatDate, getDaysRemaining, getRfqStatusBadgeInfo } from '@/lib/formatters'
import {
  RfqRecord,
  marcarRfqComoEnviado,
  encerrarRfq,
  deletarRfqCompleto,
} from '@/services/rfqService'
import {
  SubmissionKitData,
  loadSubmissionKitData,
  generateSubmissionKitXlsx,
  printSubmissionKitPdf,
  deleteSubmissionKit,
} from '@/services/submissionKitService'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SubmissionKitModal } from '@/components/SubmissionKitModal'
import { PainelControlePropostas } from '@/components/PainelControlePropostas'

interface EmpreendimentoOption {
  id: string
  nome_empreendimento: string
  razao_social: string
}

interface SeguradoraOption {
  id: string
  nome: string
}

export default function RfqPage() {
  const [rfqs, setRfqs] = useState<RfqRecord[]>([])
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoOption[]>([])
  const [seguradoras, setSeguradoras] = useState<SeguradoraOption[]>([])
  const [loading, setLoading] = useState(true)

  // Modal new RFQ
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState('')
  const [selectedSegs, setSelectedSegs] = useState<string[]>([])
  const [dataEnvio, setDataEnvio] = useState(new Date().toISOString().slice(0, 10))
  const [prazoLimite, setPrazoLimite] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 10)
    return d.toISOString().slice(0, 10)
  })
  const [observacoes, setObservacoes] = useState('')
  const [saving, setSaving] = useState(false)

  // Detail Modal
  const [selectedRfq, setSelectedRfq] = useState<RfqRecord | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [deleteRfqConfirmOpen, setDeleteRfqConfirmOpen] = useState(false)
  const [deletingRfq, setDeletingRfq] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [encerrarConfirmOpen, setEncerrarConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingKit, setDeletingKit] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  // Submission Kit Modal state
  const [kitModalOpen, setKitModalOpen] = useState(false)
  const [kitData, setKitData] = useState<SubmissionKitData | null>(null)
  const [loadingKit, setLoadingKit] = useState(false)

  // Edit RFQ Modal (para convidar cias em RFQ existente)
  const [editRfqModalOpen, setEditRfqModalOpen] = useState(false)
  const [editingRfq, setEditingRfq] = useState<RfqRecord | null>(null)
  const [editSegs, setEditSegs] = useState<string[]>([])
  const [savingEditRfq, setSavingEditRfq] = useState(false)

  const fetchData = async () => {
    try {
      setLoading(true)
      const [rfqList, empList, segList] = await Promise.all([
        pb.collection('rfq').getFullList<RfqRecord>({
          sort: '-created',
          expand: 'conta_empreendimento',
        }),
        pb.collection('empreendimentos').getFullList<EmpreendimentoOption>({
          sort: 'nome_empreendimento',
        }),
        pb.collection('seguradoras').getFullList<SeguradoraOption>({
          sort: 'nome',
        }),
      ])
      setRfqs(rfqList)
      setEmpreendimentos(empList)
      setSeguradoras(segList)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateRfq = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmp) {
      alert('Selecione o empreendimento para cotação.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        conta_empreendimento: selectedEmp,
        seguradoras_solicitadas: selectedSegs,
        data_envio: dataEnvio,
        prazo_limite: prazoLimite,
        status: 'Aberto',
        observacoes: observacoes.trim(),
      }
      await pb.collection('rfq').create(payload)
      setModalOpen(false)
      setSelectedEmp('')
      setSelectedSegs([])
      setObservacoes('')
      fetchData()
    } catch (err: unknown) {
      alert('Erro ao criar RFQ: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Register Response action (creates pending proposal in C3)
  const handleRegisterResponse = async (rfq: RfqRecord, segId: string) => {
    try {
      await pb.collection('propostas').create({
        rfq: rfq.id,
        seguradora: segId,
        data_proposta: new Date().toISOString().slice(0, 10),
        status: 'Pendente',
        coberturas: [],
      })

      // Update RFQ status to Respondido
      await pb.collection('rfq').update(rfq.id, {
        status: 'Respondido',
      })

      alert('Resposta registrada com sucesso! Proposta criada no Módulo C3 Tabulação.')
      setDetailModalOpen(false)
      fetchData()
    } catch (err: unknown) {
      alert('Erro ao registrar resposta: ' + (err as Error).message)
    }
  }

  const toggleSeguradora = (segId: string) => {
    setSelectedSegs((prev) =>
      prev.includes(segId) ? prev.filter((id) => id !== segId) : [...prev, segId],
    )
  }

  const toggleEditSeguradora = (segId: string) => {
    setEditSegs((prev) =>
      prev.includes(segId) ? prev.filter((id) => id !== segId) : [...prev, segId],
    )
  }

  const handleOpenEditRfq = (rfq: RfqRecord) => {
    setEditingRfq(rfq)
    setEditSegs(rfq.seguradoras_solicitadas || [])
    setEditRfqModalOpen(true)
  }

  const handleSaveEditRfq = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRfq) return
    try {
      setSavingEditRfq(true)
      await pb.collection('rfq').update(editingRfq.id, {
        seguradoras_solicitadas: editSegs,
      })
      setEditRfqModalOpen(false)
      const updated = { ...editingRfq, seguradoras_solicitadas: editSegs }
      setRfqs((prev) => prev.map((r) => (r.id === editingRfq.id ? updated : r)))
      if (selectedRfq && selectedRfq.id === editingRfq.id) {
        setSelectedRfq(updated)
      }
      setFeedbackMessage('Lista de seguradoras convidadas atualizada com sucesso.')
      setTimeout(() => setFeedbackMessage(null), 4000)
    } catch (err) {
      alert('Erro ao atualizar seguradoras: ' + (err as Error).message)
    } finally {
      setSavingEditRfq(false)
    }
  }

  const handleOpenSubmissionKit = async (rfq: RfqRecord) => {
    try {
      setSelectedRfq(rfq)
      setKitModalOpen(true)
      setLoadingKit(true)
      const kit = await loadSubmissionKitData(rfq.id)
      setKitData(kit)
      // Atualiza o estado local do RFQ para marcar kit como gerado
      setRfqs((prev) =>
        prev.map((r) =>
          r.id === rfq.id ? { ...r, kit_gerado: true, kit_gerado_em: new Date().toISOString() } : r,
        ),
      )
      setSelectedRfq((prev) =>
        prev && prev.id === rfq.id
          ? { ...prev, kit_gerado: true, kit_gerado_em: new Date().toISOString() }
          : prev,
      )

      // Sugestão prática: se o RFQ estiver Aberto, lembra o usuário da transição para Enviado
      if (rfq.status === 'Aberto') {
        setFeedbackMessage(
          `Kit de Submissão carregado com sucesso. Ao disparar aos portais das seguradoras, use "Marcar como Enviado" no Gerenciar.`,
        )
        setTimeout(() => setFeedbackMessage(null), 6000)
      }
    } catch (err) {
      console.error('Erro ao abrir Kit de Submissão:', err)
      alert('Falha ao compilar dados do Kit de Submissão: ' + (err as Error).message)
    } finally {
      setLoadingKit(false)
    }
  }

  const handleDeleteKit = async () => {
    if (!selectedRfq) return
    try {
      setDeletingKit(true)
      await deleteSubmissionKit(selectedRfq.id)

      // Atualiza o estado do RFQ selecionado e da lista
      const updatedRfq: RfqRecord = {
        ...selectedRfq,
        kit_gerado: false,
        kit_gerado_em: '',
      }
      setSelectedRfq(updatedRfq)
      setRfqs((prev) => prev.map((r) => (r.id === selectedRfq.id ? updatedRfq : r)))
      setKitData(null)
      setDeleteConfirmOpen(false)

      setFeedbackMessage(
        'Kit de Submissão excluído com sucesso. Os dados do RFQ permanecem intactos.',
      )
      setTimeout(() => setFeedbackMessage(null), 4500)
    } catch (err) {
      console.error('Erro ao excluir Kit de Submissão:', err)
      alert('Falha ao excluir o Kit de Submissão: ' + (err as Error).message)
    } finally {
      setDeletingKit(false)
    }
  }

  // Marcar RFQ como Enviado
  const handleMarcarEnviado = async () => {
    if (!selectedRfq) return
    try {
      setUpdatingStatus(true)
      const now = new Date().toISOString().slice(0, 10)
      const updated = await marcarRfqComoEnviado(selectedRfq.id, now)

      setSelectedRfq((prev) =>
        prev ? { ...prev, ...updated, status: 'Enviado', data_envio: now } : prev,
      )
      setRfqs((prev) =>
        prev.map((r) =>
          r.id === selectedRfq.id ? { ...r, ...updated, status: 'Enviado', data_envio: now } : r,
        ),
      )

      setFeedbackMessage(
        `RFQ #${selectedRfq.id.slice(0, 6).toUpperCase()} marcado como "Enviado" com sucesso.`,
      )
      setTimeout(() => setFeedbackMessage(null), 4500)
    } catch (err) {
      console.error('Erro ao marcar RFQ como enviado:', err)
      alert('Erro ao marcar como Enviado: ' + (err as Error).message)
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Encerrar RFQ (status Fechado)
  const handleEncerrarRfq = async () => {
    if (!selectedRfq) return
    try {
      setUpdatingStatus(true)
      const updated = await encerrarRfq(selectedRfq.id)

      setSelectedRfq((prev) => (prev ? { ...prev, ...updated, status: 'Fechado' } : prev))
      setRfqs((prev) =>
        prev.map((r) => (r.id === selectedRfq.id ? { ...r, ...updated, status: 'Fechado' } : r)),
      )
      setEncerrarConfirmOpen(false)

      setFeedbackMessage(
        `RFQ #${selectedRfq.id.slice(0, 6).toUpperCase()} encerrado e marcado como "Fechado". Histórico preservado para rastreabilidade.`,
      )
      setTimeout(() => setFeedbackMessage(null), 5000)
    } catch (err) {
      console.error('Erro ao encerrar RFQ:', err)
      alert('Erro ao encerrar RFQ: ' + (err as Error).message)
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Deletar RFQ Completo
  const handleDeleteRfqCompleto = async () => {
    if (!selectedRfq) return
    const rfqCodigo = `RFQ-${selectedRfq.id.slice(0, 6).toUpperCase()}`
    const empNome =
      selectedRfq.expand?.conta_empreendimento?.nome_empreendimento || 'Empreendimento'

    try {
      setDeletingRfq(true)
      await deletarRfqCompleto(selectedRfq.id)

      // Atualiza lista removendo o RFQ
      setRfqs((prev) => prev.filter((r) => r.id !== selectedRfq.id))
      setDeleteRfqConfirmOpen(false)
      setDetailModalOpen(false)
      setSelectedRfq(null)

      setFeedbackMessage(
        `O processo ${rfqCodigo} (${empNome}) e todos os registros vinculados foram excluídos com sucesso.`,
      )
      setTimeout(() => setFeedbackMessage(null), 5000)
    } catch (err) {
      console.error('Erro ao excluir RFQ:', err)
      alert('Falha ao excluir o RFQ: ' + (err as Error).message)
    } finally {
      setDeletingRfq(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Feedback banner */}
      {feedbackMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-xs flex items-center justify-between gap-2 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Módulo C2
            </span>
            <h2 className="text-xl font-bold text-gray-900">Pedidos de Cotação (RFQ)</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Controle de envio de editais de cotação para seguradoras parceiras, monitoramento de
            prazos (SLA) e abertura de propostas para tabulação.
          </p>
        </div>

        <Button
          onClick={() => setModalOpen(true)}
          className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-10 px-4 shadow-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4 text-blue-300" />
          <span>Novo Pedido de RFQ</span>
        </Button>
      </div>

      {/* RFQ List Table */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E4E9F0] flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Processos de RFQ Ativos</h3>
          <span className="text-xs text-gray-500">{rfqs.length} processo(s)</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-gray-400">Carregando RFQs...</div>
        ) : rfqs.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Send className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-700">Nenhum RFQ em andamento</h4>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Inicie um novo ciclo de cotação selecionando uma propriedade da base e as seguradoras
              a serem consultadas.
            </p>
            <Button onClick={() => setModalOpen(true)} className="mt-4 bg-[#0F2B46] text-xs h-9">
              <Plus className="w-4 h-4 mr-1" />
              Criar primeiro RFQ
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-[#E4E9F0]">
                <tr>
                  <th className="py-3 px-4">RFQ #</th>
                  <th className="py-3 px-4">Conta / Empreendimento</th>
                  <th className="py-3 px-4">Seguradoras Solicitadas</th>
                  <th className="py-3 px-4">Data Envio</th>
                  <th className="py-3 px-4">Prazo Limite (SLA)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rfqs.map((rfq) => {
                  const daysSla = getDaysRemaining(rfq.prazo_limite)
                  return (
                    <tr
                      key={rfq.id}
                      onClick={() => {
                        setSelectedRfq(rfq)
                        setDetailModalOpen(true)
                      }}
                      className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-gray-800 text-[11px]">
                        RFQ-{rfq.id.slice(0, 6).toUpperCase()}
                      </td>
                      <td className="py-3 px-4 font-semibold text-gray-900">
                        {rfq.expand?.conta_empreendimento?.nome_empreendimento || 'Empreendimento'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-700">
                          {rfq.seguradoras_solicitadas?.length || 0} seguradora(s)
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600">{formatDate(rfq.data_envio)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold tabular-nums ${
                            daysSla !== null && daysSla < 0
                              ? 'text-red-600 font-bold'
                              : daysSla !== null && daysSla <= 3
                                ? 'text-amber-600'
                                : 'text-gray-700'
                          }`}
                        >
                          {formatDate(rfq.prazo_limite)}
                          {daysSla !== null && (
                            <span className="text-[10px] ml-1 font-normal">
                              (
                              {daysSla < 0
                                ? `${Math.abs(daysSla)}d atraso`
                                : `${daysSla}d restantes`}
                              )
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const statusInfo = getRfqStatusBadgeInfo(rfq.status)
                          return (
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-xs ${statusInfo.bg}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                              <span>{statusInfo.label}</span>
                            </span>
                          )
                        })()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            onClick={() => handleOpenSubmissionKit(rfq)}
                            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-[11px] h-7 px-2.5 font-semibold flex items-center gap-1 shadow-sm"
                            title="Abrir Kit de Submissão para portais (XLSX, Cópia rápida e PDF)"
                          >
                            <PackageCheck className="w-3.5 h-3.5 text-blue-300" />
                            <span>Kit Submissão</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedRfq(rfq)
                              setDetailModalOpen(true)
                            }}
                            className="h-7 text-xs text-[#16578B] font-semibold px-2"
                          >
                            <span>Gerenciar</span>
                            <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                          </Button>
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

      {/* MODAL: NOVO RFQ */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Send className="w-5 h-5 text-[#16578B]" />
              <span>Novo Pedido de Cotação (RFQ)</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Selecione o imóvel da carteira e as seguradoras a serem convidadas.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRfq} className="space-y-4 pt-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">Conta / Empreendimento</Label>
              <select
                value={selectedEmp}
                onChange={(e) => setSelectedEmp(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-xs"
                required
              >
                <option value="">Selecione o empreendimento...</option>
                {empreendimentos.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome_empreendimento} ({emp.razao_social || 'Hotel'})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">Data de Envio</Label>
                <Input
                  type="date"
                  value={dataEnvio}
                  onChange={(e) => setDataEnvio(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">Prazo Limite (SLA)</Label>
                <Input
                  type="date"
                  value={prazoLimite}
                  onChange={(e) => setPrazoLimite(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-gray-700">
                Seguradoras a Solicitar:
              </Label>
              {seguradoras.length === 0 ? (
                <div className="p-3 bg-gray-50 border rounded text-[11px] text-gray-500">
                  Nenhuma seguradora cadastrada no Mapa de Mercado. Adicione seguradoras no menu
                  Gestão Comercial.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 border rounded-lg bg-gray-50/50">
                  {seguradoras.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSegs.includes(s.id)}
                        onChange={() => toggleSeguradora(s.id)}
                        className="rounded border-gray-300 text-[#16578B] focus:ring-[#16578B]"
                      />
                      <span className="text-xs text-gray-800 font-medium truncate">{s.nome}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">Observações Técnicas</Label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Ex: Cotação de Riscos Nomeados com inclusão de Alagamento e Vendaval..."
                className="w-full h-16 p-2 rounded-md border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-[#16578B]"
              />
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-xs h-9 font-semibold"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Emitir RFQ
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: DETALHE DO RFQ & GERENCIAMENTO COMPLETO (COM PAINEL DE CONTROLE DE PROPOSTAS) */}
      {selectedRfq && (
        <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto animate-scale-in p-6">
            <DialogHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pr-6">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                      <Send className="w-5 h-5 text-[#16578B]" />
                      <span>Gerenciar RFQ #{selectedRfq.id.slice(0, 6).toUpperCase()}</span>
                    </DialogTitle>
                    {(() => {
                      const statusInfo = getRfqStatusBadgeInfo(selectedRfq.status)
                      return (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border shadow-xs ${statusInfo.bg}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                          <span>{statusInfo.label}</span>
                        </span>
                      )
                    })()}
                  </div>
                  <DialogDescription className="text-xs text-gray-500 mt-1">
                    {selectedRfq.expand?.conta_empreendimento?.nome_empreendimento ||
                      'Empreendimento'}{' '}
                    · Enviado em {formatDate(selectedRfq.data_envio)} · Prazo SLA:{' '}
                    <strong className="text-gray-800">
                      {formatDate(selectedRfq.prazo_limite)}
                    </strong>
                  </DialogDescription>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Botão de Marcar como Enviado (quando status for Aberto) */}
                  {selectedRfq.status === 'Aberto' && (
                    <Button
                      size="sm"
                      onClick={handleMarcarEnviado}
                      disabled={updatingStatus}
                      className="text-xs h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5 shadow-sm"
                      title="Registrar envio formal do edital de cotação para as seguradoras parceiras"
                    >
                      {updatingStatus ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-blue-100" />
                      )}
                      <span>Marcar como Enviado</span>
                    </Button>
                  )}

                  {/* Botão de Encerrar RFQ (quando ainda não estiver Fechado) */}
                  {selectedRfq.status !== 'Fechado' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEncerrarConfirmOpen(true)}
                      disabled={updatingStatus}
                      className="text-xs h-8 px-3 border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold flex items-center gap-1"
                      title="Encerrar este RFQ (processo encerrado sem contratação ou descontinuado, mantendo rastreabilidade)"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>Encerrar RFQ</span>
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenEditRfq(selectedRfq)}
                    className="text-xs h-8 border-gray-300"
                  >
                    <span>Editar Convidadas</span>
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="py-2 space-y-5 text-xs">
              {selectedRfq.observacoes && (
                <div className="p-3 bg-gray-50 rounded-lg border text-gray-700">
                  <strong>Observações Técnicas:</strong> {selectedRfq.observacoes}
                </div>
              )}

              {/* Kit de Submissão dentro do Gerenciar (Mantém Deletar Kit funcional) */}
              <div className="border rounded-lg p-3.5 space-y-3 bg-gradient-to-r from-blue-50/70 to-indigo-50/70 border-blue-200">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#0F2B46] text-white flex items-center justify-center shrink-0">
                      <PackageCheck className="w-4 h-4 text-blue-300" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-xs">
                          Kit de Submissão para Portais de Seguradoras
                        </span>
                        {selectedRfq.kit_gerado ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Kit Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                            Não gerado
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-600 mt-0.5">
                        Exportar XLSX estruturado, painel com botões de cópia rápida e impressão PDF
                        do edital.
                        {selectedRfq.kit_gerado_em && (
                          <span className="text-[10px] text-gray-500 block">
                            Gerado em: {formatDate(selectedRfq.kit_gerado_em)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => {
                      handleOpenSubmissionKit(selectedRfq)
                    }}
                    className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 px-3 font-semibold shrink-0"
                  >
                    {selectedRfq.kit_gerado ? 'Abrir Kit' : 'Gerar Kit'}
                  </Button>
                </div>

                {/* Zona de exclusão: Deletar Kit mantendo RFQ intacto */}
                <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between">
                  <div className="text-[11px] text-gray-500">
                    {selectedRfq.kit_gerado ? (
                      <span>
                        Kit compilado para este RFQ. Você pode excluí-lo e regenerá-lo a qualquer
                        momento.
                      </span>
                    ) : (
                      <span>Nenhum kit registrado para este RFQ no momento.</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!selectedRfq.kit_gerado || deletingKit}
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="text-xs h-7 px-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 flex items-center gap-1.5 shrink-0"
                    title={
                      selectedRfq.kit_gerado
                        ? 'Excluir o registro do Kit de Submissão deste RFQ mantendo o RFQ intacto'
                        : 'Não há Kit de Submissão gerado para excluir'
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Deletar Kit</span>
                  </Button>
                </div>
              </div>

              {/* NOVO: PAINEL DE CONTROLE DE PROPOSTAS DAS SEGURADORAS */}
              <PainelControlePropostas
                rfqId={selectedRfq.id}
                rfqNumero={`RFQ-${selectedRfq.id.slice(0, 6).toUpperCase()}`}
                empreendimentoNome={selectedRfq.expand?.conta_empreendimento?.nome_empreendimento}
                seguradorasSolicitadas={selectedRfq.seguradoras_solicitadas || []}
                dataEnvio={selectedRfq.data_envio}
                prazoLimite={selectedRfq.prazo_limite}
                rfqStatus={selectedRfq.status}
                onDataChange={() => fetchData()}
                onEditarRfq={() => handleOpenEditRfq(selectedRfq)}
              />

              {/* Zona Destrutiva / Rodapé de Ações do RFQ */}
              <div className="pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteRfqConfirmOpen(true)}
                  disabled={deletingRfq}
                  className="text-xs h-8 px-3 bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center gap-1.5 shadow-sm"
                  title="Excluir este RFQ e todos os seus registros vinculados"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Deletar RFQ</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetailModalOpen(false)}
                  className="text-xs h-8 px-4"
                >
                  Fechar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* MODAL: EDITAR SEGURADORAS CONVIDADAS DO RFQ */}
      {editingRfq && (
        <Dialog open={editRfqModalOpen} onOpenChange={setEditRfqModalOpen}>
          <DialogContent className="max-w-md animate-scale-in">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Building className="w-5 h-5 text-[#16578B]" />
                <span>Convidar Seguradoras — RFQ #{editingRfq.id.slice(0, 6).toUpperCase()}</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                Selecione as seguradoras parceiras a serem consultadas neste bid.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveEditRfq} className="space-y-4 pt-2 text-xs">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">
                  Companhias a Solicitar Cotação (mínimo recomendado: 5–6 cias):
                </Label>
                {seguradoras.length === 0 ? (
                  <div className="p-3 bg-gray-50 border rounded text-[11px] text-gray-500">
                    Nenhuma seguradora cadastrada no Mapa de Mercado.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto p-2 border rounded-lg bg-gray-50/50">
                    {seguradoras.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={editSegs.includes(s.id)}
                          onChange={() => toggleEditSeguradora(s.id)}
                          className="rounded border-gray-300 text-[#16578B] focus:ring-[#16578B]"
                        />
                        <span className="text-xs text-gray-800 font-medium">{s.nome}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-gray-500">
                  Selecionadas: <strong>{editSegs.length}</strong> seguradora(s)
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditRfqModalOpen(false)}
                  className="text-xs h-8"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={savingEditRfq}
                  className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 font-semibold"
                >
                  {savingEditRfq ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Atualizar Convidadas
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* MODAL DE CONFIRMAÇÃO: ENCERRAR RFQ */}
      <AlertDialog open={encerrarConfirmOpen} onOpenChange={setEncerrarConfirmOpen}>
        <AlertDialogContent className="max-w-md animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-slate-600 shrink-0" />
              <span>Encerrar Processo de RFQ</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-600 space-y-2 pt-1">
              <p>
                Deseja marcar como <strong className="text-gray-900">Fechado</strong> o processo{' '}
                <strong className="text-gray-900 font-mono">
                  RFQ-{selectedRfq?.id.slice(0, 6).toUpperCase()}
                </strong>{' '}
                (
                {selectedRfq?.expand?.conta_empreendimento?.nome_empreendimento || 'Empreendimento'}
                )?
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-[11px] text-slate-700">
                <strong>Rastreabilidade preservada:</strong> O status passará para "Fechado" para
                sinalizar que o edital foi concluído ou não terá continuidade. Todas as propostas,
                documentos e registros do painel continuarão salvos para consulta histórica.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 pt-2">
            <AlertDialogCancel disabled={updatingStatus} className="text-xs h-9 px-3">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleEncerrarRfq()
              }}
              disabled={updatingStatus}
              className="bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
            >
              {updatingStatus ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Encerrando...</span>
                </>
              ) : (
                <span>Confirmar Encerramento</span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL DE CONFIRMAÇÃO: DELETAR RFQ COMPLETO */}
      <AlertDialog open={deleteRfqConfirmOpen} onOpenChange={setDeleteRfqConfirmOpen}>
        <AlertDialogContent className="max-w-md animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
              <span>Confirmar Exclusão Definitiva do RFQ</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-600 space-y-2.5 pt-1">
              <p>
                Atenção: Você está prestes a excluir permanentemente o pedido de cotação{' '}
                <strong className="text-gray-900 font-mono">
                  RFQ-{selectedRfq?.id.slice(0, 6).toUpperCase()}
                </strong>{' '}
                do empreendimento{' '}
                <strong className="text-gray-900">
                  {selectedRfq?.expand?.conta_empreendimento?.nome_empreendimento ||
                    'Empreendimento'}
                </strong>
                .
              </p>
              <div className="bg-red-50 border border-red-200 rounded p-2.5 text-[11px] text-red-800 space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>O que será removido em cascata:</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[10.5px]">
                  <li>O registro deste RFQ;</li>
                  <li>Todos os registros de acompanhamento das seguradoras (status e SLA);</li>
                  <li>Todas as propostas registradas para este RFQ e arquivos de cotação;</li>
                  <li>Registros do Kit de Submissão e documentos associados ao RFQ.</li>
                </ul>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-[11px] text-emerald-800">
                <strong>O que NÃO é afetado:</strong> O cadastro do empreendimento, o cliente, as
                seguradoras parceiras e suas apólices vigentes permanecem 100% intactos na carteira.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 pt-2">
            <AlertDialogCancel disabled={deletingRfq} className="text-xs h-9 px-3">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDeleteRfqCompleto()
              }}
              disabled={deletingRfq}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
            >
              {deletingRfq ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Excluindo tudo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Sim, Deletar RFQ e Vinculados</span>
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL DE CONFIRMAÇÃO DE DELEÇÃO DO KIT */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="max-w-md animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
              <span>Confirmar Exclusão do Kit de Submissão</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-600 space-y-2 pt-1">
              <p>
                Tem certeza que deseja deletar o Kit de Submissão do RFQ{' '}
                <strong className="text-gray-900 font-mono">
                  RFQ-{selectedRfq?.id.slice(0, 6).toUpperCase()}
                </strong>{' '}
                (
                {selectedRfq?.expand?.conta_empreendimento?.nome_empreendimento || 'Empreendimento'}
                )?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-[11px] text-amber-800">
                <strong>Atenção:</strong> Apenas o registro do Kit será removido. O RFQ, as
                seguradoras convidadas, prazos e eventuais propostas vinculadas permanecerão
                totalmente intactos, e um novo Kit poderá ser gerado a qualquer momento.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 pt-2">
            <AlertDialogCancel disabled={deletingKit} className="text-xs h-9 px-3">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDeleteKit()
              }}
              disabled={deletingKit}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs h-9 px-4 flex items-center gap-1.5"
            >
              {deletingKit ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Sim, Deletar Kit</span>
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL / DRAWER: KIT DE SUBMISSÃO (3 FORMATOS) */}
      <Dialog open={kitModalOpen} onOpenChange={setKitModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto animate-scale-in p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-[#16578B]" />
              <span>Kit de Submissão para Portais de Seguradoras</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Disponibilize as informações deste RFQ nos portais das seguradoras sem digitação
              manual.
            </DialogDescription>
          </DialogHeader>

          <SubmissionKitModal
            data={kitData}
            loading={loadingKit}
            onClose={() => setKitModalOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
