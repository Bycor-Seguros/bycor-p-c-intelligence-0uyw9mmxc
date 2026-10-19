import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  Send,
  Plus,
  Clock,
  Building,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
  Layers,
  Search,
  Filter,
  Loader2,
  ArrowRight,
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
import { formatDate, getDaysRemaining } from '@/lib/formatters'

interface RfqRecord {
  id: string
  conta_empreendimento: string
  seguradoras_solicitadas: string[]
  data_envio: string
  prazo_limite: string
  status: 'Aberto' | 'Enviado' | 'Respondido' | 'Fechado'
  observacoes: string
  created: string
  expand?: {
    conta_empreendimento?: {
      nome_empreendimento: string
      razao_social: string
    }
  }
}

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

  return (
    <div className="space-y-6">
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
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            rfq.status === 'Respondido'
                              ? 'bg-teal-50 text-teal-700 border border-teal-200'
                              : rfq.status === 'Enviado'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {rfq.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedRfq(rfq)
                            setDetailModalOpen(true)
                          }}
                          className="h-7 text-xs text-[#16578B] font-semibold"
                        >
                          <span>Gerenciar</span>
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

      {/* MODAL: DETALHE DO RFQ & RESPOSTA */}
      {selectedRfq && (
        <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
          <DialogContent className="max-w-xl animate-scale-in">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-gray-900">
                Gerenciar RFQ #{selectedRfq.id.slice(0, 6).toUpperCase()}
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {selectedRfq.expand?.conta_empreendimento?.nome_empreendimento} · Prazo SLA:{' '}
                {formatDate(selectedRfq.prazo_limite)}
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-4 text-xs">
              {selectedRfq.observacoes && (
                <div className="p-3 bg-gray-50 rounded-lg border text-gray-700">
                  <strong>Observações:</strong> {selectedRfq.observacoes}
                </div>
              )}

              <div>
                <h4 className="font-bold text-gray-800 mb-2">Seguradoras Consultadas:</h4>
                <div className="divide-y border rounded-lg overflow-hidden bg-white">
                  {selectedRfq.seguradoras_solicitadas?.length === 0 ? (
                    <div className="p-3 text-gray-400">Nenhuma seguradora associada</div>
                  ) : (
                    selectedRfq.seguradoras_solicitadas.map((segId) => {
                      const segName =
                        seguradoras.find((s) => s.id === segId)?.nome ||
                        `Seguradora ${segId.slice(0, 5)}`
                      return (
                        <div
                          key={segId}
                          className="p-3 flex items-center justify-between hover:bg-gray-50"
                        >
                          <div>
                            <div className="font-semibold text-gray-900">{segName}</div>
                            <div className="text-[11px] text-gray-500">
                              Enviado em {formatDate(selectedRfq.data_envio)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleRegisterResponse(selectedRfq, segId)}
                            className="bg-[#16578B] hover:bg-[#0E4268] text-white text-[11px] h-7"
                          >
                            Registrar Resposta / Proposta
                          </Button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="pt-2 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetailModalOpen(false)}
                  className="text-xs h-8"
                >
                  Fechar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
