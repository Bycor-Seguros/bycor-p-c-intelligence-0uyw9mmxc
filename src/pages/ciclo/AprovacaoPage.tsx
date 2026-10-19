import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  CheckCircle,
  XCircle,
  ShieldCheck,
  Building,
  UserCheck,
  History,
  AlertTriangle,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatDate, formatCurrency } from '@/lib/formatters'

interface PendingAuditRecord {
  id: string
  empreendimento: string
  apolice: string
  status: 'Em auditoria' | 'Apto' | 'Desvios a ajustar' | 'Aprovado'
  analista: string
  data_aprovacao: string
  itens: any[]
  created: string
  expand?: {
    empreendimento?: { nome_empreendimento: string; cnpj: string }
    apolice?: {
      id: string
      numero_apolice: string
      seguradora: string
      premio_total: number
      ramo: string
      data_fim: string
    }
    analista?: { name: string; email: string }
  }
}

interface AuditLogRecord {
  id: string
  tabela: string
  data: string
  cia: string
  texto: string
  timestamp: string
  autor: string
  expand?: {
    autor?: { name: string; email: string }
  }
}

export default function AprovacaoPage() {
  const { user } = useAuth()
  const [pendingAudits, setPendingAudits] = useState<PendingAuditRecord[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Confirmation Modal
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [selectedAudit, setSelectedAudit] = useState<PendingAuditRecord | null>(null)
  const [actionType, setActionType] = useState<'aprovar' | 'rejeitar'>('aprovar')
  const [processing, setProcessing] = useState(false)

  const fetchData = async () => {
    try {
      setLoading(true)
      const [auds, logs] = await Promise.all([
        pb.collection('auditoria').getFullList<PendingAuditRecord>({
          filter: 'status="Apto"',
          sort: '-created',
          expand: 'empreendimento,apolice,analista',
        }),
        pb.collection('historico').getFullList<AuditLogRecord>({
          filter: 'tabela="auditoria_aprovacao"',
          sort: '-created',
          expand: 'autor',
        }),
      ])
      setPendingAudits(auds)
      setAuditLogs(logs)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleOpenConfirm = (audit: PendingAuditRecord, type: 'aprovar' | 'rejeitar') => {
    setSelectedAudit(audit)
    setActionType(type)
    setConfirmModalOpen(true)
  }

  const handleExecuteAction = async () => {
    if (!selectedAudit) return
    try {
      setProcessing(true)
      const now = new Date().toISOString()
      const analistaNome = user?.name || user?.email || 'Analista Responsável'

      if (actionType === 'aprovar') {
        // 1. Update audit status to Aprovado
        await pb.collection('auditoria').update(selectedAudit.id, {
          status: 'Aprovado',
          data_aprovacao: now.slice(0, 10),
        })

        // 2. Update single source of truth in apolices
        if (selectedAudit.apolice) {
          await pb.collection('apolices').update(selectedAudit.apolice, {
            status: 'ativa',
          })
        }

        // 3. Write immutable audit trail into historico
        await pb.collection('historico').create({
          registro_id: selectedAudit.id,
          tabela: 'auditoria_aprovacao',
          data: now.slice(0, 10),
          cia: selectedAudit.expand?.apolice?.seguradora || 'Seguradora',
          texto: `APROVAÇÃO TÉCNICA REALIZADA: Apólice nº ${selectedAudit.expand?.apolice?.numero_apolice} confirmada na base oficial por ${analistaNome}.`,
          autor: user?.id,
          timestamp: now,
        })

        alert('Apólice aprovada com sucesso! Atualizada no portfólio oficial.')
      } else {
        // Rejeitar: Devolver a C5 para correção
        await pb.collection('auditoria').update(selectedAudit.id, {
          status: 'Desvios a ajustar',
        })

        await pb.collection('historico').create({
          registro_id: selectedAudit.id,
          tabela: 'auditoria_aprovacao',
          data: now.slice(0, 10),
          cia: selectedAudit.expand?.apolice?.seguradora || 'Seguradora',
          texto: `APROVAÇÃO REJEITADA: Retornada para correção no Módulo C5 por ${analistaNome}.`,
          autor: user?.id,
          timestamp: now,
        })

        alert('Auditoria retornada para o Módulo C5.')
      }

      setConfirmModalOpen(false)
      fetchData()
    } catch (err: unknown) {
      alert('Erro na operação: ' + (err as Error).message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
            Módulo C6
          </span>
          <h2 className="text-xl font-bold text-gray-900">
            Fila de Aprovação Humana & Base Oficial
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          Portão de segurança e controle de qualidade operacional. Apenas apólices auditadas como
          "Apto" e formalmente aprovadas por um analista habilitado alimentam a base final da
          carteira.
        </p>
      </div>

      {/* Pending Approvals Table */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E4E9F0] flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Auditorias Aguardando Aprovação Final</h3>
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#16578B]">
            {pendingAudits.length} pendente(s)
          </span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-gray-400">
            Carregando fila de aprovação...
          </div>
        ) : pendingAudits.length === 0 ? (
          <div className="py-16 text-center px-4">
            <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-700">Nenhuma apólice pendente</h4>
            <p className="text-xs text-gray-400 mt-1">
              Todas as auditorias foram processadas ou estão em fase de conferência em C5.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                <tr>
                  <th className="py-3 px-4">Empreendimento</th>
                  <th className="py-3 px-4">Apólice / Ramo</th>
                  <th className="py-3 px-4">Seguradora</th>
                  <th className="py-3 px-4 text-right">Prêmio Total</th>
                  <th className="py-3 px-4">Analista Auditor</th>
                  <th className="py-3 px-4 text-right">Decisão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingAudits.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-bold text-gray-900">
                      {a.expand?.empreendimento?.nome_empreendimento || 'Empreendimento'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-800">
                        {a.expand?.apolice?.numero_apolice || '—'}
                      </div>
                      <div className="text-[11px] text-gray-500">{a.expand?.apolice?.ramo}</div>
                    </td>
                    <td className="py-3 px-4 text-gray-700 font-medium">
                      {a.expand?.apolice?.seguradora || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">
                      {formatCurrency(a.expand?.apolice?.premio_total)}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {a.expand?.analista?.name || a.expand?.analista?.email || 'Analista'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Button
                        size="sm"
                        onClick={() => handleOpenConfirm(a, 'rejeitar')}
                        variant="outline"
                        className="text-xs h-7 text-red-600 border-red-200 hover:bg-red-50"
                      >
                        Rejeitar (C5)
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleOpenConfirm(a, 'aprovar')}
                        className="text-xs h-7 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      >
                        Aprovar para Base
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historical Audit Trail Panel */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#16578B]" />
          <h3 className="text-sm font-bold text-gray-900">
            Trilha Histórica de Aprovações e Rejeições
          </h3>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded-lg">
            Nenhum evento registrado na trilha de aprovação.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 text-xs hover:bg-gray-50 flex items-start justify-between gap-4"
              >
                <div>
                  <div className="font-semibold text-gray-900 leading-snug">{log.texto}</div>
                  <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2">
                    <span>
                      Responsável:{' '}
                      {log.expand?.autor?.name || log.expand?.autor?.email || 'Analista'}
                    </span>
                    <span>•</span>
                    <span>Cia: {log.cia || '—'}</span>
                  </div>
                </div>
                <div className="text-right text-[11px] text-gray-400 whitespace-nowrap">
                  {formatDate(log.data)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CONFIRMATION MODAL */}
      {selectedAudit && (
        <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
          <DialogContent className="max-w-md animate-scale-in">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#16578B]" />
                <span>
                  Confirmar {actionType === 'aprovar' ? 'Aprovação' : 'Rejeição'} de Apólice
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                Esta ação grava autoria e timestamp na trilha de governança do sistema.
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-gray-50 border space-y-1">
                <div>
                  <strong>Empreendimento:</strong>{' '}
                  {selectedAudit.expand?.empreendimento?.nome_empreendimento}
                </div>
                <div>
                  <strong>Apólice:</strong> {selectedAudit.expand?.apolice?.numero_apolice} (
                  {selectedAudit.expand?.apolice?.seguradora})
                </div>
                <div>
                  <strong>Analista conectado:</strong> {user?.name || user?.email}
                </div>
              </div>

              <p className="text-gray-600 leading-relaxed">
                {actionType === 'aprovar'
                  ? 'Ao aprovar, esta apólice passa a compor oficialmente a carteira ativa de clientes e será sincronizada em tempo real.'
                  : 'Ao rejeitar, a apólice retorna com status "Desvios a ajustar" para que os corretores solicitem o endosso à seguradora.'}
              </p>

              <div className="pt-2 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmModalOpen(false)}
                  className="text-xs h-8"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={processing}
                  onClick={handleExecuteAction}
                  className={`text-xs h-8 font-semibold text-white ${
                    actionType === 'aprovar'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Confirmar {actionType === 'aprovar' ? 'Aprovação' : 'Rejeição'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
