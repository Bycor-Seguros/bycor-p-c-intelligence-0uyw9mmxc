import React, { useState, useEffect, useMemo } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  GitCompare,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  Plus,
  Edit,
  Trash2,
  Check,
  FileSpreadsheet,
  Building,
  Info,
  Loader2,
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
import { formatCurrency, formatDate, CATEGORIAS_48 } from '@/lib/formatters'
import { PainelControlePropostas } from '@/components/PainelControlePropostas'
import { desnormalizarBasePremioParaUi } from '@/services/rfqPropostasService'

interface PropostaCoverageItem {
  nome?: string
  cobertura?: string
  categoria_normalizada?: string
  categoriaNormalizada?: string
  lmi?: number | null
  franquia?: string
  premio?: number | null
  premioLiquido?: number | null
}

interface PropostaRecord {
  id: string
  rfq: string
  seguradora: string
  data_proposta: string
  coberturas: PropostaCoverageItem[]
  pos_franquias: string
  clausulas: string
  exclusoes: string
  lmi_lmg: number
  premio_liquido: number
  premio_bruto: number
  premio_net?: number
  comissao_trabalhada?: number
  base_premio?: string
  vrd_dm?: number
  vrd_mmu?: number
  vrd_mmp?: number
  vrd_lc?: number
  vrd_lc_base?: string
  iof: number
  status: 'Pendente' | 'Tabulada' | 'Selecionada' | 'Não selecionada'
  expand?: {
    seguradora?: { nome: string }
    rfq?: {
      conta_empreendimento?: string
      expand?: {
        conta_empreendimento?: { nome_empreendimento: string }
      }
    }
  }
}

interface RfqOption {
  id: string
  seguradoras_solicitadas?: string[]
  data_envio?: string
  prazo_limite?: string
  status?: string
  expand?: {
    conta_empreendimento?: { nome_empreendimento: string }
  }
}

export default function TabulacaoPage() {
  const [propostas, setPropostas] = useState<PropostaRecord[]>([])
  const [rfqs, setRfqs] = useState<RfqOption[]>([])
  const [selectedRfqId, setSelectedRfqId] = useState<string>('todos')
  const [loading, setLoading] = useState(true)

  // Edit Coberturas modal
  const [editingProp, setEditingProp] = useState<PropostaRecord | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editCoverages, setEditCoverages] = useState<PropostaCoverageItem[]>([])
  const [newCovNome, setNewCovNome] = useState('')
  const [newCovCat, setNewCovCat] = useState<string>(CATEGORIAS_48[0])
  const [newCovLmi, setNewCovLmi] = useState<number | ''>('')
  const [newCovFranquia, setNewCovFranquia] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const fetchPropostas = async () => {
    try {
      setLoading(true)
      const [props, rfqList] = await Promise.all([
        pb.collection('propostas').getFullList<PropostaRecord>({
          sort: '-created',
          expand: 'seguradora,rfq,rfq.conta_empreendimento',
        }),
        pb.collection('rfq').getFullList<RfqOption>({
          expand: 'conta_empreendimento',
          sort: '-created',
        }),
      ])
      setPropostas(props)
      setRfqs(rfqList)
      if (selectedRfqId === 'todos' && rfqList.length > 0) {
        // Mantém 'todos' por padrão para a visão geral
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPropostas()
  }, [])

  // Filtered by selected RFQ for side-by-side comparison
  const comparedProposals = useMemo(() => {
    if (selectedRfqId === 'todos') {
      return propostas
    }
    return propostas.filter((p) => p.rfq === selectedRfqId)
  }, [propostas, selectedRfqId])

  // Mark Proposal as Selected
  const handleSelectProposal = async (propId: string) => {
    try {
      const target = propostas.find((p) => p.id === propId)
      if (!target) return

      // Set this one as Selecionada, and others from same RFQ as Não selecionada
      await pb.collection('propostas').update(propId, { status: 'Selecionada' })
      const siblings = propostas.filter((p) => p.rfq === target.rfq && p.id !== propId)
      for (const s of siblings) {
        await pb.collection('propostas').update(s.id, { status: 'Não selecionada' })
      }

      // Append relationship history to insurer
      if (target.seguradora) {
        try {
          const segRec = await pb.collection('seguradoras').getOne(target.seguradora)
          const currentHist = (segRec.historico_relacionamento as any[]) || []
          currentHist.push({
            data: new Date().toISOString().slice(0, 10),
            fonte: 'C3 Tabulação',
            observacao: `Proposta SELECIONADA no RFQ #${target.rfq?.slice(0, 5)} (Valor: ${formatCurrency(target.premio_bruto)})`,
          })
          await pb.collection('seguradoras').update(target.seguradora, {
            historico_relacionamento: currentHist,
          })
        } catch {
          // ignore
        }
      }

      alert('Proposta marcada como Selecionada! Histórico do analista atualizado.')
      fetchPropostas()
    } catch (err: unknown) {
      alert('Erro: ' + (err as Error).message)
    }
  }

  // Open Edit Modal
  const openEditModal = (prop: PropostaRecord) => {
    setEditingProp(prop)
    setEditCoverages(prop.coberturas || [])
    setEditModalOpen(true)
  }

  // Normalizar item de cobertura para acesso consistente
  const getCoverageFields = (c: PropostaCoverageItem) => {
    const nome = c.nome || c.cobertura || 'Cobertura'
    const cat = c.categoria_normalizada || c.categoriaNormalizada || ''
    const lmi = c.lmi !== undefined && c.lmi !== null ? Number(c.lmi) : 0
    const franquia = c.franquia || 'Conforme apólice'
    const premio =
      c.premio !== undefined && c.premio !== null
        ? Number(c.premio)
        : c.premioLiquido !== undefined && c.premioLiquido !== null
          ? Number(c.premioLiquido)
          : null
    return { nome, cat, lmi, franquia, premio }
  }

  // Add coverage row inline
  const handleAddCoverageRow = () => {
    if (!newCovNome.trim()) return
    const cat = newCovCat || ''
    setEditCoverages((prev) => [
      ...prev,
      {
        nome: newCovNome.trim(),
        cobertura: newCovNome.trim(),
        categoria_normalizada: cat,
        categoriaNormalizada: cat,
        lmi: Number(newCovLmi) || 0,
        franquia: newCovFranquia.trim() || 'Conforme apólice',
      },
    ])
    setNewCovNome('')
    setNewCovLmi('')
    setNewCovFranquia('')
  }

  const handleRemoveCoverageRow = (idx: number) => {
    setEditCoverages((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSaveCoverages = async () => {
    if (!editingProp) return
    try {
      setSavingEdit(true)
      await pb.collection('propostas').update(editingProp.id, {
        coberturas: editCoverages,
        status: 'Tabulada',
      })
      setEditModalOpen(false)
      fetchPropostas()
    } catch (err: unknown) {
      alert('Erro ao salvar coberturas: ' + (err as Error).message)
    } finally {
      setSavingEdit(false)
    }
  }

  // Collect distinct coverage categories across proposals for the side-by-side matrix
  const distinctCategories = useMemo(() => {
    const set = new Set<string>()
    comparedProposals.forEach((p) => {
      ;(p.coberturas || []).forEach((c) => {
        const cat = c.categoria_normalizada || c.categoriaNormalizada
        if (cat) set.add(cat)
      })
    })
    return Array.from(set).sort()
  }, [comparedProposals])

  // Export Matrix CSV
  const handleExportMatrixCsv = () => {
    if (comparedProposals.length === 0) return

    const headers = [
      'Categoria Normalizada',
      ...comparedProposals.map((p) => p.expand?.seguradora?.nome || p.id),
    ]
    const rows = distinctCategories.map((cat) => {
      const values = comparedProposals.map((p) => {
        const found = (p.coberturas || []).find(
          (c) => (c.categoria_normalizada || c.categoriaNormalizada) === cat,
        )
        return found && found.lmi !== null && found.lmi !== undefined ? found.lmi : 0
      })
      return [`"${cat}"`, ...values].join(';')
    })

    const csv = [headers.join(';'), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `matriz_comparativa_rfq_${selectedRfqId}.csv`
    a.click()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Módulo C3
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Tabulação & Matriz Comparativa de Propostas
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Comparação analítica lado a lado entre ofertas recebidas de seguradoras, com detecção
            automática de desvios e lacunas frente às necessidades do segurado.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleExportMatrixCsv}
            disabled={comparedProposals.length === 0}
            variant="outline"
            className="text-xs h-9 border-gray-300"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Exportar Matriz CSV
          </Button>
        </div>
      </div>

      {/* RFQ Selector Filter */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-[#16578B]" />
          <span className="text-xs font-bold text-gray-700">Selecione o RFQ para comparação:</span>
          <select
            value={selectedRfqId}
            onChange={(e) => setSelectedRfqId(e.target.value)}
            className="h-8 text-xs rounded border border-gray-300 bg-white px-2 focus:ring-1 focus:ring-[#16578B]"
          >
            <option value="todos">Todos os RFQs ({propostas.length} propostas)</option>
            {rfqs.map((rfq) => (
              <option key={rfq.id} value={rfq.id}>
                RFQ #{rfq.id.slice(0, 6).toUpperCase()} —{' '}
                {rfq.expand?.conta_empreendimento?.nome_empreendimento || 'Empreendimento'}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs text-gray-500">
          Exibindo <strong>{comparedProposals.length}</strong> proposta(s) em análise
        </span>
      </div>

      {/* PAINEL DE CONTROLE DE PROPOSTAS POR RFQ (SE RFQ ESPECÍFICO SELECIONADO) */}
      {selectedRfqId !== 'todos' &&
        (() => {
          const activeRfq = rfqs.find((r) => r.id === selectedRfqId)
          if (!activeRfq) return null
          return (
            <div className="space-y-2">
              <PainelControlePropostas
                rfqId={activeRfq.id}
                rfqNumero={`RFQ-${activeRfq.id.slice(0, 6).toUpperCase()}`}
                empreendimentoNome={activeRfq.expand?.conta_empreendimento?.nome_empreendimento}
                seguradorasSolicitadas={activeRfq.seguradoras_solicitadas || []}
                dataEnvio={activeRfq.data_envio}
                prazoLimite={activeRfq.prazo_limite}
                rfqStatus={activeRfq.status}
                onDataChange={() => fetchPropostas()}
              />
            </div>
          )
        })()}

      {/* SIDE-BY-SIDE MATRIX COMPARISON */}
      {loading ? (
        <div className="py-16 text-center text-xs text-gray-400">Carregando propostas...</div>
      ) : comparedProposals.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-12 text-center">
          <Building className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <h4 className="text-sm font-semibold text-gray-700">Nenhuma proposta para comparar</h4>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Gere pedidos no Módulo C2 (RFQ) e registre as respostas das seguradoras para alimentar
            esta matriz.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#0F2B46] text-white">
                  <th className="py-3.5 px-4 font-bold border-r border-[#1B3C5D] w-64 sticky left-0 bg-[#0F2B46] z-10">
                    Critério / Cobertura
                  </th>
                  {comparedProposals.map((p) => {
                    const isSelected = p.status === 'Selecionada'
                    return (
                      <th
                        key={p.id}
                        className={`py-3.5 px-4 min-w-[240px] border-r border-[#1B3C5D] ${
                          isSelected ? 'bg-[#16578B]' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-sm">
                            {p.expand?.seguradora?.nome || 'Seguradora'}
                          </span>
                          {isSelected && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-400 text-gray-900">
                              SELECIONADA
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-blue-200 mt-0.5 font-normal">
                          Proposta: {formatDate(p.data_proposta)}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => openEditModal(p)}
                            className="h-6 text-[10px] bg-white/10 hover:bg-white/20 text-white font-medium"
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Editar coberturas
                          </Button>
                          {!isSelected && (
                            <Button
                              size="sm"
                              onClick={() => handleSelectProposal(p.id)}
                              className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                            >
                              <Check className="w-3 h-3 mr-1" />
                              Selecionar
                            </Button>
                          )}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-800">
                {/* 1. Valores Financeiros Gerais (Tríade de Prêmios & Comissão) */}
                <tr className="bg-gray-50/80 font-bold text-gray-900">
                  <td className="py-2.5 px-4 sticky left-0 bg-gray-50 border-r">
                    Prêmio Total / Bruto
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2.5 px-4 border-r text-base text-emerald-800 font-bold tabular-nums"
                    >
                      {p.premio_bruto ? formatCurrency(p.premio_bruto) : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Prêmio Líquido (com comissão)
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-4 border-r tabular-nums font-semibold text-blue-950"
                    >
                      {formatCurrency(p.premio_liquido)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Prêmio Net (sem comissão)
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-4 border-r tabular-nums font-mono text-gray-800"
                    >
                      {p.premio_net ? formatCurrency(p.premio_net) : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Comissão Trabalhada (%)
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2 px-4 border-r tabular-nums text-xs">
                      {p.comissao_trabalhada !== undefined && p.comissao_trabalhada !== null ? (
                        <span className="font-bold text-[#16578B]">
                          {p.comissao_trabalhada}% (
                          {desnormalizarBasePremioParaUi(p.base_premio) === 'net'
                            ? 'base Net'
                            : 'base Líquido'}
                          )
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    IOF
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2 px-4 border-r tabular-nums text-gray-600">
                      {formatCurrency(p.iof)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    LMI / LMG Consolidado
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2 px-4 border-r tabular-nums font-semibold">
                      {formatCurrency(p.lmi_lmg)}
                    </td>
                  ))}
                </tr>

                {/* 1.1 Bloco VRD (Valor em Risco Declarado) */}
                <tr className="bg-blue-50/70 font-bold text-[#0F2B46]">
                  <td
                    colSpan={comparedProposals.length + 1}
                    className="py-2 px-4 tracking-wider uppercase text-[10px]"
                  >
                    Bloco VRD (Valor em Risco Declarado por Seção)
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    VRD - Danos Materiais (DM)
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-4 border-r tabular-nums font-mono text-gray-800"
                    >
                      {p.vrd_dm ? formatCurrency(p.vrd_dm) : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    VRD - MMU
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-4 border-r tabular-nums font-mono text-gray-800"
                    >
                      {p.vrd_mmu ? formatCurrency(p.vrd_mmu) : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    VRD - MMP
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-4 border-r tabular-nums font-mono text-gray-800"
                    >
                      {p.vrd_mmp ? formatCurrency(p.vrd_mmp) : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    VRD - Lucros Cessantes (LC) & Base
                  </td>
                  {comparedProposals.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-4 border-r tabular-nums font-mono text-gray-800"
                    >
                      {p.vrd_lc ? (
                        <span>
                          {formatCurrency(p.vrd_lc)}{' '}
                          <span className="text-[10px] text-gray-500 font-sans">
                            ({p.vrd_lc_base || 'Lucro Bruto'})
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  ))}
                </tr>

                {/* 2. Coberturas Item a Item (Matriz side-by-side) */}
                <tr className="bg-blue-50/60 font-bold text-[#0F2B46]">
                  <td
                    colSpan={comparedProposals.length + 1}
                    className="py-2 px-4 tracking-wider uppercase text-[10px]"
                  >
                    Coberturas Tabuladas por Categoria Normalizada
                  </td>
                </tr>

                {distinctCategories.length === 0 ? (
                  <tr>
                    <td
                      colSpan={comparedProposals.length + 1}
                      className="py-6 text-center text-gray-400"
                    >
                      Nenhuma cobertura cadastrada nas propostas. Clique em "Editar coberturas" em
                      cada proposta para tabulá-las.
                    </td>
                  </tr>
                ) : (
                  distinctCategories.map((cat) => (
                    <tr key={cat} className="hover:bg-gray-50/50">
                      <td className="py-2 px-4 sticky left-0 bg-white border-r font-semibold text-gray-800">
                        {cat}
                      </td>
                      {comparedProposals.map((p) => {
                        const cov = (p.coberturas || []).find(
                          (c) => (c.categoria_normalizada || c.categoriaNormalizada) === cat,
                        )
                        const covFields = cov ? getCoverageFields(cov) : null
                        return (
                          <td key={p.id} className="py-2 px-4 border-r">
                            {covFields ? (
                              <div>
                                <div className="font-bold text-gray-900 tabular-nums">
                                  {formatCurrency(covFields.lmi)}
                                </div>
                                {covFields.franquia && (
                                  <div className="text-[10px] text-gray-500 mt-0.5">
                                    Franquia: {covFields.franquia}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-bold border border-red-200">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Desvio: Não Cotada</span>
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}

                {/* 3. Condições Gerais & Exclusões */}
                <tr className="bg-gray-50/80 font-bold text-gray-900">
                  <td
                    colSpan={comparedProposals.length + 1}
                    className="py-2 px-4 tracking-wider uppercase text-[10px]"
                  >
                    Condições Contratuais & Exclusões
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Cláusulas Particulares
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2.5 px-4 border-r text-gray-700">
                      {p.clausulas || 'Cláusula padrão de mercado'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2.5 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Exclusões Relevantes
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2.5 px-4 border-r text-red-700 text-[11px]">
                      {p.exclusoes || 'Nenhuma exclusão atípica reportada'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR COBERTURAS DA PROPOSTA */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-2xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              Tabular Coberturas — {editingProp?.expand?.seguradora?.nome || 'Proposta'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Adicione os itens de cobertura cotados com seu respectivo LMI e franquia.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-4 text-xs">
            {/* Inline add form */}
            <div className="p-3 bg-gray-50 border rounded-lg space-y-2">
              <span className="font-semibold text-gray-700">Adicionar cobertura:</span>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <div className="sm:col-span-2">
                  <Input
                    type="text"
                    placeholder="Nome na proposta (ex: Vendaval)"
                    value={newCovNome}
                    onChange={(e) => setNewCovNome(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <select
                    value={newCovCat}
                    onChange={(e) => setNewCovCat(e.target.value)}
                    className="w-full h-8 border rounded text-xs px-2 bg-white"
                  >
                    {CATEGORIAS_48.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Input
                    type="number"
                    placeholder="LMI (R$)"
                    value={newCovLmi}
                    onChange={(e) =>
                      setNewCovLmi(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="text"
                    placeholder="Franquia (ex: 10% min R$ 5.000)"
                    value={newCovFranquia}
                    onChange={(e) => setNewCovFranquia(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    onClick={handleAddCoverageRow}
                    className="w-full h-8 text-xs bg-[#0F2B46] text-white"
                  >
                    Adicionar
                  </Button>
                </div>
              </div>
            </div>

            {/* Coverage items list */}
            <div className="max-h-60 overflow-y-auto border rounded-lg divide-y">
              {editCoverages.length === 0 ? (
                <div className="p-4 text-center text-gray-400">Nenhuma cobertura inserida</div>
              ) : (
                editCoverages.map((cov, idx) => {
                  const f = getCoverageFields(cov)
                  return (
                    <div
                      key={idx}
                      className="p-2.5 flex items-center justify-between hover:bg-gray-50"
                    >
                      <div>
                        <div className="font-bold text-gray-900">{f.nome}</div>
                        <div className="text-[11px] text-[#16578B]">{f.cat}</div>
                        <div className="text-[11px] text-gray-500">
                          LMI: {formatCurrency(f.lmi)} | Franquia: {f.franquia || '—'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveCoverageRow(idx)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditModalOpen(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={savingEdit}
                onClick={handleSaveCoverages}
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 font-semibold"
              >
                {savingEdit ? 'Salvando...' : 'Salvar Proposta Tabulada'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
