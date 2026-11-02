import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
  Layers,
  Sparkles,
  ShieldAlert,
  Split,
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
  DialogFooter,
} from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { PainelControlePropostas } from '@/components/PainelControlePropostas'
import { PainelEquivalencias } from '@/components/PainelEquivalencias'
import { desnormalizarBasePremioParaUi, definirVersaoAtiva } from '@/services/rfqPropostasService'
import {
  CoberturaCanonicaRecord,
  CoberturaSinonimoRecord,
  listarTaxonomiaCanonicas,
  listarSinonimos,
  salvarSinonimo,
  salvarCoberturaCanonica,
  casarCoberturaComCanonica,
  detectarEventosDescobertos,
  CoverageMatchResult,
  AlertaDescobertaEvento,
  derivarEventosTipicosPadrao,
} from '@/services/equivalenciaCoberturasService'

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
  opcao?: number
  versao?: number
  ativa?: boolean
  data_proposta: string
  coberturas: PropostaCoverageItem[]
  pos_franquias: string
  clausulas: string
  exclusoes: string
  lmi_lmg: number
  premio_liquido: number
  premio_bruto: number
  premio_net?: number
  agravo?: number
  premio_net_pos_agravo?: number
  comissao_trabalhada?: number
  base_premio?: string
  vrd_dm?: number
  vrd_mmu?: number
  vrd_mmp?: number
  vrd_lc?: number
  vrd_lc_base?: string
  iof: number
  forma_pagamento?: string
  numero_parcelas?: number
  status: 'Pendente' | 'Tabulada' | 'Selecionada' | 'Não selecionada'
  expand?: {
    seguradora?: { id?: string; nome: string }
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

  // Equivalências de Coberturas: Canônicas e Sinônimos
  const [canonicas, setCanonicas] = useState<CoberturaCanonicaRecord[]>([])
  const [sinonimos, setSinonimos] = useState<CoberturaSinonimoRecord[]>([])
  const [painelEquivalenciasAberto, setPainelEquivalenciasAberto] = useState(false)

  // Modal para mapear cobertura não mapeada
  const [modalMapeamentoAberto, setModalMapeamentoAberto] = useState(false)
  const [aliasParaMapear, setAliasParaMapear] = useState('')
  const [seguradoraDoAlias, setSeguradoraDoAlias] = useState('')
  const [seguradoraIdDoAlias, setSeguradoraIdDoAlias] = useState<string | undefined>(undefined)
  const [canonicaEscolhida, setCanonicaEscolhida] = useState('')
  const [novaCanonicaNome, setNovaCanonicaNome] = useState('')
  const [criandoNovaCanonica, setCriandoNovaCanonica] = useState(false)
  const [eventosExcluidosModal, setEventosExcluidosModal] = useState<string[]>([])
  const [novoEventoExcluidoModal, setNovoEventoExcluidoModal] = useState('')
  const [salvandoMapeamento, setSalvandoMapeamento] = useState(false)

  // Edit Coberturas modal manual
  const [editingProp, setEditingProp] = useState<PropostaRecord | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editCoverages, setEditCoverages] = useState<PropostaCoverageItem[]>([])
  const [newCovNome, setNewCovNome] = useState('')
  const [newCovCat, setNewCovCat] = useState<string>('')
  const [newCovLmi, setNewCovLmi] = useState<number | ''>('')
  const [newCovFranquia, setNewCovFranquia] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Carrega propostas, rfqs e a taxonomia de equivalências
  const fetchEquivalencias = useCallback(async () => {
    try {
      const [cans, sins] = await Promise.all([listarTaxonomiaCanonicas(), listarSinonimos()])
      setCanonicas(cans)
      setSinonimos(sins)
    } catch (e) {
      console.error('Erro ao buscar equivalências:', e)
    }
  }, [])

  const fetchPropostas = useCallback(async () => {
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
      await fetchEquivalencias()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [fetchEquivalencias])

  useEffect(() => {
    fetchPropostas()
  }, [fetchPropostas])

  // Lista única com nomes de seguradoras envolvidas nas propostas
  const seguradorasNomes = useMemo(() => {
    const set = new Set<string>()
    propostas.forEach((p) => {
      const nome = p.expand?.seguradora?.nome
      if (nome) set.add(nome)
    })
    return Array.from(set).sort()
  }, [propostas])

  // Propostas do RFQ selecionado
  const rfqProposals = useMemo(() => {
    if (selectedRfqId === 'todos') {
      return propostas
    }
    return propostas.filter((p) => p.rfq === selectedRfqId)
  }, [propostas, selectedRfqId])

  // Agrupa todas as propostas por SEGURADORA + OPÇÃO para permitir seleção de versão dentro de cada opção
  const todasPorSeguradoraEOpcao = useMemo(() => {
    const mapa = new Map<string, PropostaRecord[]>()
    rfqProposals.forEach((p) => {
      const op = Number(p.opcao || 1)
      const chave = `${p.seguradora}__op__${op}`
      const list = mapa.get(chave) || []
      list.push(p)
      mapa.set(chave, list)
    })
    return mapa
  }, [rfqProposals])

  // Propostas ativas comparadas lado a lado
  const comparedProposals = useMemo(() => {
    const ativas: PropostaRecord[] = []
    todasPorSeguradoraEOpcao.forEach((pList) => {
      const ativa = pList.find((p) => p.ativa)
      if (ativa) {
        ativas.push(ativa)
      } else if (pList.length > 0) {
        const sorted = [...pList].sort((a, b) => Number(b.versao || 1) - Number(a.versao || 1))
        ativas.push(sorted[0])
      }
    })
    ativas.sort((a, b) => {
      const nomeA = a.expand?.seguradora?.nome || ''
      const nomeB = b.expand?.seguradora?.nome || ''
      if (nomeA !== nomeB) return nomeA.localeCompare(nomeB)
      return Number(a.opcao || 1) - Number(b.opcao || 1)
    })
    return ativas
  }, [todasPorSeguradoraEOpcao])

  // Mapeia todas as coberturas das propostas comparadas contra a taxonomia canônica Bycor
  // Retorna para cada proposta a lista de coberturas com sua equivalência resolvida
  const propostasComEquivalencia = useMemo(() => {
    return comparedProposals.map((p) => {
      const segNome = p.expand?.seguradora?.nome || ''
      const coberturasCasadas = (p.coberturas || []).map((c) => {
        const rawName =
          c.nome || c.cobertura || c.categoria_normalizada || c.categoriaNormalizada || 'Cobertura'
        const match: CoverageMatchResult = casarCoberturaComCanonica(
          rawName,
          segNome,
          canonicas,
          sinonimos,
        )

        return {
          originalItem: c,
          nomeOriginal: rawName,
          lmi: c.lmi !== undefined && c.lmi !== null ? Number(c.lmi) : 0,
          franquia: c.franquia || '',
          premio: c.premio || c.premioLiquido || null,
          canonica: match.canonica,
          canonicaId: match.canonicaId,
          matchType: match.matchType,
          sinonimo: match.sinonimo,
          eventosEfetivos: match.eventosEfetivos,
          eventosExcluidos: match.eventosExcluidos,
          realocacoes: match.realocacoes,
        }
      })

      return {
        proposta: p,
        seguradoraNome: segNome,
        seguradoraId: p.seguradora,
        coberturasCasadas,
      }
    })
  }, [comparedProposals, canonicas, sinonimos])

  // Lista consolidada de coberturas canônicas presentes nas propostas comparadas
  // Garante que a tabulação SEMPRE compare pela cobertura canônica
  const categoriasCanonicasTabulacao = useMemo(() => {
    const set = new Set<string>()
    propostasComEquivalencia.forEach((p) => {
      p.coberturasCasadas.forEach((c) => {
        if (c.canonica) set.add(c.canonica)
      })
    })

    // Se nenhuma estiver nas propostas mas houver canônicas cadastradas, exibe as primeiras canônicas
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [propostasComEquivalencia])

  // Alternar versão ativa diretamente pela tela de Tabulação (C3)
  const handleTrocarVersaoC3 = async (segId: string, novaPropId: string) => {
    if (!selectedRfqId || selectedRfqId === 'todos') return
    try {
      setLoading(true)
      await definirVersaoAtiva(selectedRfqId, segId, novaPropId)
      await fetchPropostas()
    } catch (err: unknown) {
      alert('Erro ao trocar versão ativa: ' + (err as Error).message)
      setLoading(false)
    }
  }

  // Marcar proposta como Selecionada
  const handleSelectProposal = async (propId: string) => {
    try {
      const target = propostas.find((p) => p.id === propId)
      if (!target) return

      await pb.collection('propostas').update(propId, { status: 'Selecionada' })
      const siblings = propostas.filter((p) => p.rfq === target.rfq && p.id !== propId)
      for (const s of siblings) {
        await pb.collection('propostas').update(s.id, { status: 'Não selecionada' })
      }

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

  // Abrir modal de mapeamento para cobertura não mapeada ou para ajustar mapeamento
  const abrirModalMapearCobertura = (alias: string, segNome: string, segId?: string) => {
    setAliasParaMapear(alias)
    setSeguradoraDoAlias(segNome)
    setSeguradoraIdDoAlias(segId)
    setCriandoNovaCanonica(false)
    setNovaCanonicaNome('')
    setEventosExcluidosModal([])
    setNovoEventoExcluidoModal('')

    // Tenta pré-selecionar a canônica mais próxima
    const primeiraCanonica = canonicas[0]?.nome || ''
    setCanonicaEscolhida(primeiraCanonica)
    setModalMapeamentoAberto(true)
  }

  // Salvar mapeamento a partir do clique do analista na célula/badge não mapeada
  const handleGravarMapeamentoAnalista = async () => {
    let destinoCanonica = canonicaEscolhida

    try {
      setSalvandoMapeamento(true)

      let canRec = canonicas.find((c) => c.nome === destinoCanonica)

      // Se o analista escolheu criar uma nova cobertura canônica
      if (criandoNovaCanonica && novaCanonicaNome.trim()) {
        const criada = await salvarCoberturaCanonica({
          nome: novaCanonicaNome.trim(),
          descricao: `Criada pelo analista a partir do alias "${aliasParaMapear}"`,
          eventosTipicos: derivarEventosTipicosPadrao(novaCanonicaNome.trim()),
        })
        destinoCanonica = criada.nome
        canRec = criada
      }

      if (!destinoCanonica) {
        alert('Selecione ou crie uma cobertura canônica de destino.')
        return
      }

      // Grava o sinônimo permanentemente no banco para propostas futuras
      await salvarSinonimo({
        alias: aliasParaMapear.trim(),
        seguradoraId: seguradoraIdDoAlias,
        seguradoraNome: seguradoraDoAlias.trim(),
        canonicaNome: destinoCanonica.trim(),
        coberturaCanonicaId: canRec?.id,
        eventosExcluidos: eventosExcluidosModal,
        observacao: `Mapeado pelo analista na Tabulação C3`,
      })

      setModalMapeamentoAberto(false)
      await fetchEquivalencias()
    } catch (err: unknown) {
      alert('Erro ao gravar mapeamento: ' + (err as Error).message)
    } finally {
      setSalvandoMapeamento(false)
    }
  }

  // Open Edit Modal manual
  const openEditModal = (prop: PropostaRecord) => {
    setEditingProp(prop)
    setEditCoverages(prop.coberturas || [])
    setNewCovCat(canonicas[0]?.nome || 'Incêndio / Básica')
    setEditModalOpen(true)
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

  // Export Matrix CSV
  const handleExportMatrixCsv = () => {
    if (comparedProposals.length === 0) return

    const headers = [
      'Cobertura Canônica (Bycor)',
      ...comparedProposals.map((p) => {
        const seg = p.expand?.seguradora?.nome || p.id
        const op = Number(p.opcao || 1)
        const v = Number(p.versao || 1)
        return `"${seg} — Opção ${op} (v${v})"`
      }),
    ]
    const rows = categoriasCanonicasTabulacao.map((cat) => {
      const values = propostasComEquivalencia.map((pe) => {
        const found = pe.coberturasCasadas.find((c) => c.canonica === cat)
        return found && found.lmi !== null && found.lmi !== undefined ? found.lmi : 0
      })
      return [`"${cat}"`, ...values].join(';')
    })

    const csv = [headers.join(';'), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `matriz_equivalencias_c3_rfq_${selectedRfqId}.csv`
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
              Tabulação &amp; Tabela de Equivalências de Coberturas
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Granularidade em dois níveis: comparação sempre pela cobertura canônica Bycor com gestão
            de pacotes de eventos. Detecção em tempo real de lacunas e alerta{' '}
            <strong className="text-red-700">"Segurado descoberto: [evento]"</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => setPainelEquivalenciasAberto(!painelEquivalenciasAberto)}
            variant={painelEquivalenciasAberto ? 'default' : 'outline'}
            className={`text-xs h-9 ${
              painelEquivalenciasAberto
                ? 'bg-[#0F2B46] hover:bg-[#1B3C5D] text-white'
                : 'border-blue-300 text-[#16578B] bg-blue-50/50 hover:bg-blue-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5 mr-1.5" />
            Painel Equivalências ({sinonimos.length} sinônimos)
            {painelEquivalenciasAberto ? (
              <ChevronUp className="w-3.5 h-3.5 ml-1" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-1" />
            )}
          </Button>

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

      {/* PAINEL DE EQUIVALÊNCIAS RETRÁTIL */}
      {painelEquivalenciasAberto && (
        <div className="animate-fade-in">
          <PainelEquivalencias
            canonicas={canonicas}
            sinonimos={sinonimos}
            seguradorasNomes={seguradorasNomes}
            onDataChange={() => fetchEquivalencias()}
          />
        </div>
      )}

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
          Exibindo <strong>{comparedProposals.length}</strong> proposta(s) em análise |{' '}
          <strong>{categoriasCanonicasTabulacao.length}</strong> coberturas canônicas ativas
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
                  <th className="py-3.5 px-4 font-bold border-r border-[#1B3C5D] w-72 sticky left-0 bg-[#0F2B46] z-10">
                    Critério / Cobertura Canônica Bycor
                  </th>
                  {comparedProposals.map((p) => {
                    const isSelected = p.status === 'Selecionada'
                    const opNum = Number(p.opcao || 1)
                    const chaveOpcao = `${p.seguradora}__op__${opNum}`
                    const versoesDestaOpcao = todasPorSeguradoraEOpcao.get(chaveOpcao) || []

                    return (
                      <th
                        key={p.id}
                        className={`py-3.5 px-4 min-w-[280px] border-r border-[#1B3C5D] ${
                          isSelected ? 'bg-[#16578B]' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className="font-extrabold text-sm truncate">
                            {p.expand?.seguradora?.nome || 'Seguradora'} — Opção {opNum}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900 text-blue-100 border border-blue-400">
                            v{p.versao || 1}
                            <span className="ml-1 text-[9px] text-emerald-300 font-sans uppercase">
                              ● ativa
                            </span>
                          </span>
                          {isSelected && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-400 text-gray-900 shrink-0">
                              SELECIONADA
                            </span>
                          )}
                        </div>

                        {/* Seletor de Versão quando esta mesma opção tiver mais de 1 versão no RFQ */}
                        {versoesDestaOpcao.length > 1 && (
                          <div className="mt-2 flex items-center gap-1.5 bg-black/20 p-1.5 rounded-lg border border-white/10">
                            <span className="text-[10px] text-blue-200">
                              Versão ativa (Opção {opNum}):
                            </span>
                            <select
                              value={p.id}
                              onChange={(e) => handleTrocarVersaoC3(p.seguradora, e.target.value)}
                              className="text-[11px] h-6 px-1.5 rounded bg-white text-gray-900 font-semibold focus:outline-none"
                            >
                              {versoesDestaOpcao.map((v) => (
                                <option key={v.id} value={v.id}>
                                  v{v.versao || 1} (
                                  {v.premio_bruto ? formatCurrency(v.premio_bruto) : 's/ prêmio'})
                                  {v.id === p.id ? ' ★' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="text-[11px] text-blue-200 mt-1 font-normal">
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
                  {comparedProposals.map((p) => {
                    const isNetSemComissao =
                      desnormalizarBasePremioParaUi(p.base_premio) === 'net' &&
                      (p.comissao_trabalhada === undefined ||
                        p.comissao_trabalhada === null ||
                        p.comissao_trabalhada === ('' as any))
                    return (
                      <td
                        key={p.id}
                        className="py-2 px-4 border-r tabular-nums font-bold text-emerald-900"
                      >
                        {p.premio_bruto && Number(p.premio_bruto) > 0 && !isNetSemComissao ? (
                          formatCurrency(p.premio_bruto)
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                            Pendente
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Prêmio Líquido (com comissão)
                  </td>
                  {comparedProposals.map((p) => {
                    const isNetSemComissao =
                      desnormalizarBasePremioParaUi(p.base_premio) === 'net' &&
                      (p.comissao_trabalhada === undefined ||
                        p.comissao_trabalhada === null ||
                        p.comissao_trabalhada === ('' as any))
                    return (
                      <td
                        key={p.id}
                        className="py-2 px-4 border-r tabular-nums font-semibold text-blue-950"
                      >
                        {p.premio_liquido && Number(p.premio_liquido) > 0 && !isNetSemComissao ? (
                          formatCurrency(p.premio_liquido)
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                            Pendente (informe comissão)
                          </span>
                        )}
                      </td>
                    )
                  })}
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
                    Agravo (%)
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2 px-4 border-r tabular-nums text-xs">
                      {p.agravo !== undefined && p.agravo !== null && Number(p.agravo) > 0 ? (
                        <span className="font-bold text-amber-800 font-mono">{p.agravo}%</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Prêmio Net Pós Agravo
                  </td>
                  {comparedProposals.map((p) => {
                    const temAgr =
                      p.agravo !== undefined && p.agravo !== null && Number(p.agravo) > 0
                    const posAgravo =
                      p.premio_net_pos_agravo ||
                      (temAgr && p.premio_net
                        ? Number((p.premio_net * (1 + Number(p.agravo) / 100)).toFixed(2))
                        : null)

                    return (
                      <td
                        key={p.id}
                        className="py-2 px-4 border-r tabular-nums font-mono text-gray-800"
                      >
                        {temAgr && posAgravo ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-amber-950">
                              {formatCurrency(posAgravo)}
                            </span>
                            <span className="text-[9px] uppercase font-sans font-semibold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200">
                              calc
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    )
                  })}
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
                  {comparedProposals.map((p) => {
                    const isNetSemComissao =
                      desnormalizarBasePremioParaUi(p.base_premio) === 'net' &&
                      (p.comissao_trabalhada === undefined ||
                        p.comissao_trabalhada === null ||
                        p.comissao_trabalhada === ('' as any))
                    const liqVal =
                      !isNetSemComissao && p.premio_liquido ? Number(p.premio_liquido) : 0
                    const iofVal =
                      !isNetSemComissao &&
                      p.iof !== undefined &&
                      p.iof !== null &&
                      Number(p.iof) > 0
                        ? Number(p.iof)
                        : liqVal > 0
                          ? Number((liqVal * 0.0738).toFixed(2))
                          : null
                    return (
                      <td key={p.id} className="py-2 px-4 border-r tabular-nums text-gray-600">
                        {iofVal !== null && iofVal > 0 ? (
                          formatCurrency(iofVal)
                        ) : (
                          <span className="text-amber-800 text-[11px] font-medium">Pendente</span>
                        )}
                      </td>
                    )
                  })}
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
                <tr>
                  <td className="py-2 px-4 sticky left-0 bg-white border-r font-medium text-gray-600">
                    Condições de Pagamento / Parcelas
                  </td>
                  {comparedProposals.map((p) => (
                    <td key={p.id} className="py-2 px-4 border-r text-xs">
                      {p.numero_parcelas || p.forma_pagamento ? (
                        <span>
                          {p.numero_parcelas ? (
                            <strong className="text-gray-900 font-semibold">
                              {p.numero_parcelas}x s/ juros
                            </strong>
                          ) : null}
                          {p.forma_pagamento ? (
                            <span className="text-gray-500 ml-1">({p.forma_pagamento})</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
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
                    VRD - Lucros Cessantes (LC) &amp; Base
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

                {/* 2. TABELA DE EQUIVALÊNCIAS DE COBERTURAS (CANÔNICA & EVENTOS) */}
                <tr className="bg-gradient-to-r from-blue-900 to-[#16578B] font-bold text-white">
                  <td
                    colSpan={comparedProposals.length + 1}
                    className="py-2.5 px-4 tracking-wider uppercase text-[10.5px] flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-blue-300" />
                      <span>
                        Equivalências de Coberturas Bycor (Agrupadas pela Canônica + Análise de
                        Descoberta por Evento)
                      </span>
                    </div>
                    <span className="text-[10px] text-blue-200 font-normal">
                      Clique em coberturas 'não mapeadas' para registrar o sinônimo permanentemente
                    </span>
                  </td>
                </tr>

                {categoriasCanonicasTabulacao.length === 0 ? (
                  <tr>
                    <td
                      colSpan={comparedProposals.length + 1}
                      className="py-8 text-center text-gray-400"
                    >
                      Nenhuma cobertura cadastrada nas propostas comparadas. Clique em "Editar
                      coberturas" para tabular os dados ou abra o Painel de Equivalências.
                    </td>
                  </tr>
                ) : (
                  categoriasCanonicasTabulacao.map((canonicaNome) => {
                    const canInfo = canonicas.find((c) => c.nome === canonicaNome)
                    const eventosTipicos = canInfo?.eventos_tipicos?.length
                      ? canInfo.eventos_tipicos
                      : derivarEventosTipicosPadrao(canonicaNome)

                    return (
                      <tr key={canonicaNome} className="hover:bg-gray-50/60 transition-colors">
                        {/* Célula Fixa da Cobertura Canônica Bycor */}
                        <td className="py-2.5 px-4 sticky left-0 bg-white border-r font-semibold text-gray-900 align-top shadow-[1px_0_0_0_#E4E9F0]">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-gray-900 text-xs">
                                {canonicaNome}
                              </span>
                              {canInfo?.ramo && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-blue-50 text-[#16578B] border border-blue-200">
                                  {canInfo.ramo}
                                </span>
                              )}
                            </div>

                            {/* Dica de eventos típicos do pacote */}
                            <div className="text-[10px] text-gray-500 leading-tight">
                              <span className="text-gray-400 font-medium">Eventos do pacote:</span>{' '}
                              {eventosTipicos.slice(0, 4).join(', ')}
                              {eventosTipicos.length > 4 ? ` (+${eventosTipicos.length - 4})` : ''}
                            </div>
                          </div>
                        </td>

                        {/* Células das Propostas Comparadas */}
                        {propostasComEquivalencia.map((pe) => {
                          const covMatch = pe.coberturasCasadas.find(
                            (c) => c.canonica === canonicaNome,
                          )

                          // Análise de Descoberta por Evento:
                          // Compara eventos cobertos em outras propostas com a proposta atual
                          const alertasDescoberta: AlertaDescobertaEvento[] =
                            detectarEventosDescobertos({
                              propostaAtual: {
                                seguradoraNome: pe.seguradoraNome,
                                coberturasCasadas: pe.coberturasCasadas,
                              },
                              outrasPropostas: propostasComEquivalencia
                                .filter((other) => other.proposta.id !== pe.proposta.id)
                                .map((other) => ({
                                  seguradoraNome: other.seguradoraNome,
                                  coberturasCasadas: other.coberturasCasadas,
                                })),
                              canonicaAlvo: canonicaNome,
                            })

                          return (
                            <td key={pe.proposta.id} className="py-2.5 px-4 border-r align-top">
                              {covMatch ? (
                                <div className="space-y-1.5">
                                  {/* LMI & Nome Original da Cia */}
                                  <div className="flex items-center justify-between gap-1 flex-wrap">
                                    <div className="font-extrabold text-gray-900 tabular-nums text-xs">
                                      {covMatch.lmi > 0 ? (
                                        formatCurrency(covMatch.lmi)
                                      ) : (
                                        <span className="text-gray-400 italic">
                                          Sem valor (R$ 0)
                                        </span>
                                      )}
                                    </div>

                                    {/* Badge de Match com Canônica */}
                                    {covMatch.matchType === 'nao_mapeada' ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          abrirModalMapearCobertura(
                                            covMatch.nomeOriginal,
                                            pe.seguradoraNome,
                                            pe.seguradoraId,
                                          )
                                        }
                                        title="Clique para mapear esta cobertura para a taxonomia canônica Bycor"
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 transition-colors animate-pulse"
                                      >
                                        <AlertTriangle className="w-2.5 h-2.5 text-amber-700" />
                                        <span>Não mapeada (clique)</span>
                                      </button>
                                    ) : covMatch.matchType === 'sinonimo_cia' ? (
                                      <span
                                        className="inline-flex items-center gap-1 px-1 py-0.2 rounded text-[9.5px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200"
                                        title={`Mapeado por sinônimo gravado para ${pe.seguradoraNome}`}
                                      >
                                        <Check className="w-2.5 h-2.5 text-emerald-600" />
                                        Sinônimo Cia
                                      </span>
                                    ) : covMatch.matchType === 'sinonimo_global' ? (
                                      <span
                                        className="inline-flex items-center gap-1 px-1 py-0.2 rounded text-[9.5px] font-semibold bg-blue-50 text-blue-800 border border-blue-200"
                                        title="Mapeado por sinônimo global"
                                      >
                                        <Check className="w-2.5 h-2.5 text-blue-600" />
                                        Sinônimo Global
                                      </span>
                                    ) : (
                                      <span
                                        className="inline-flex items-center gap-1 px-1 py-0.2 rounded text-[9.5px] font-medium bg-gray-100 text-gray-700"
                                        title="Match automático por similaridade"
                                      >
                                        <Sparkles className="w-2.5 h-2.5 text-gray-500" />
                                        Match similaridade
                                      </span>
                                    )}
                                  </div>

                                  {/* Nome Original declarado pela seguradora */}
                                  <div className="text-[10px] text-gray-600 bg-gray-50/80 p-1 rounded border border-gray-100">
                                    <span className="text-gray-400 font-medium">
                                      Nome na proposta:
                                    </span>{' '}
                                    <strong className="text-gray-800">
                                      {covMatch.nomeOriginal}
                                    </strong>
                                  </div>

                                  {/* Franquia */}
                                  {covMatch.franquia && (
                                    <div className="text-[10px] text-gray-500">
                                      Franquia: {covMatch.franquia}
                                    </div>
                                  )}

                                  {/* Exceções de Exclusão Gravadas */}
                                  {covMatch.eventosExcluidos.length > 0 && (
                                    <div className="p-1 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-900">
                                      <span className="font-bold flex items-center gap-1">
                                        <ShieldAlert className="w-2.5 h-2.5 text-amber-700" />
                                        Exclusão Cia:
                                      </span>
                                      <span>{covMatch.eventosExcluidos.join(', ')}</span>
                                    </div>
                                  )}

                                  {/* Realocações para outras coberturas da mesma proposta */}
                                  {covMatch.realocacoes.length > 0 && (
                                    <div className="p-1 rounded bg-purple-50 border border-purple-200 text-[10px] text-purple-900">
                                      <span className="font-bold flex items-center gap-1">
                                        <Split className="w-2.5 h-2.5 text-purple-700" />
                                        Realocado nesta Cia:
                                      </span>
                                      {covMatch.realocacoes.map((r, rIdx) => (
                                        <div key={rIdx}>
                                          {r.evento} &rarr; <em>{r.cobertura_destino}</em>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* ALERTA DE DESCOBERTA POR EVENTO */}
                                  {alertasDescoberta.length > 0 && (
                                    <div className="space-y-1 pt-0.5">
                                      {alertasDescoberta.map((alerta, aIdx) => (
                                        <div
                                          key={aIdx}
                                          className="p-1.5 rounded bg-red-50 border border-red-300 text-red-900 text-[10.5px] font-bold flex items-start gap-1.5 animate-pulse"
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                                          <div className="leading-tight">
                                            <span>Segurado descoberto: {alerta.evento}</span>
                                            <div className="text-[9.5px] font-normal text-red-700 mt-0.5">
                                              (coberto por {alerta.ciaComCobertura})
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-medium border border-gray-200">
                                    <span>Não Cotada nesta proposta</span>
                                  </div>

                                  {/* Se outras propostas cobrirem eventos desta canônica, exibe o alerta de segurado descoberto */}
                                  {alertasDescoberta.length > 0 && (
                                    <div className="space-y-1 pt-0.5">
                                      {alertasDescoberta.map((alerta, aIdx) => (
                                        <div
                                          key={aIdx}
                                          className="p-1.5 rounded bg-red-50 border border-red-300 text-red-900 text-[10.5px] font-bold flex items-start gap-1.5"
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                                          <div className="leading-tight">
                                            <span>Segurado descoberto: {alerta.evento}</span>
                                            <div className="text-[9.5px] font-normal text-red-700 mt-0.5">
                                              (coberto por {alerta.ciaComCobertura})
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                )}

                {/* 3. Condições Gerais & Exclusões */}
                <tr className="bg-gray-50/80 font-bold text-gray-900">
                  <td
                    colSpan={comparedProposals.length + 1}
                    className="py-2 px-4 tracking-wider uppercase text-[10px]"
                  >
                    Condições Contratuais &amp; Exclusões
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

      {/* MODAL: MAPEAR COBERTURA NÃO MAPEADA / ESCOLHER CANÔNICA NO CLIQUE */}
      <Dialog open={modalMapeamentoAberto} onOpenChange={setModalMapeamentoAberto}>
        <DialogContent className="max-w-lg animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#16578B]" />
              Equivalência: Mapear para Cobertura Canônica Bycor
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Associe a nomenclatura da proposta{' '}
              <strong className="text-gray-800">"{aliasParaMapear}"</strong> (
              {seguradoraDoAlias || 'Cia'}) à cobertura canônica correspondente. A escolha será
              gravada permanentemente como sinônimo e se aplicará a propostas futuras.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 text-xs">
            <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center justify-between text-xs">
              <div>
                <span className="text-gray-500 block text-[11px]">Nome original na proposta:</span>
                <strong className="text-gray-900 text-sm">{aliasParaMapear}</strong>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white text-[#16578B] border border-blue-300">
                {seguradoraDoAlias || 'Seguradora'}
              </span>
            </div>

            {/* Alternar entre Canônica Existente vs Criar Nova */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-gray-700">
                  {criandoNovaCanonica
                    ? 'Criar Nova Cobertura Canônica Bycor'
                    : 'Escolher Cobertura Canônica Existente *'}
                </Label>
                <button
                  type="button"
                  onClick={() => setCriandoNovaCanonica(!criandoNovaCanonica)}
                  className="text-xs text-[#16578B] hover:underline font-semibold"
                >
                  {criandoNovaCanonica ? '← Voltar para lista existente' : '+ Criar nova canônica'}
                </button>
              </div>

              {!criandoNovaCanonica ? (
                <select
                  value={canonicaEscolhida}
                  onChange={(e) => setCanonicaEscolhida(e.target.value)}
                  className="w-full h-8 border rounded text-xs px-2 bg-white font-medium"
                >
                  <option value="">Selecione a canônica correspondente...</option>
                  {canonicas.map((c) => (
                    <option key={c.id} value={c.nome}>
                      {c.nome} {c.ramo ? `(${c.ramo})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="text"
                    placeholder="Nome da nova canônica (ex: Riscos Diversos Especiais)"
                    value={novaCanonicaNome}
                    onChange={(e) => setNovaCanonicaNome(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                  <p className="text-[10px] text-gray-500">
                    A nova canônica será adicionada à taxonomia padrão Bycor e ficará disponível
                    para todas as cotações futuras.
                  </p>
                </div>
              )}
            </div>

            {/* Exceções por evento no mapeamento */}
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg space-y-2">
              <span className="font-bold text-amber-900 block text-[11px]">
                Exceção: Esta cobertura da {seguradoraDoAlias || 'Cia'} NÃO cobre algum evento
                típico?
              </span>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Evento excluído (ex: Queda de Aeronave)"
                  value={novoEventoExcluidoModal}
                  onChange={(e) => setNovoEventoExcluidoModal(e.target.value)}
                  className="h-7 text-xs bg-white flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (!novoEventoExcluidoModal.trim()) return
                    setEventosExcluidosModal((p) => [...p, novoEventoExcluidoModal.trim()])
                    setNovoEventoExcluidoModal('')
                  }}
                  className="h-7 text-xs bg-amber-800 text-white"
                >
                  Adicionar
                </Button>
              </div>

              {eventosExcluidosModal.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {eventosExcluidosModal.map((ex, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-300"
                    >
                      Não cobre: {ex}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalMapeamentoAberto(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={salvandoMapeamento}
              onClick={handleGravarMapeamentoAnalista}
              className="h-8 text-xs bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-semibold"
            >
              {salvandoMapeamento ? 'Gravando...' : 'Gravar Equivalência Permanente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: EDITAR COBERTURAS DA PROPOSTA (MANUAL) */}
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
                    placeholder="Nome na proposta (ex: Vendaval e Granizo)"
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
                    {canonicas.map((c) => (
                      <option key={c.id} value={c.nome}>
                        {c.nome}
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
                  const nome = cov.nome || cov.cobertura || 'Cobertura'
                  const cat = cov.categoria_normalizada || cov.categoriaNormalizada || ''
                  const lmi = cov.lmi ? Number(cov.lmi) : 0
                  return (
                    <div
                      key={idx}
                      className="p-2.5 flex items-center justify-between hover:bg-gray-50"
                    >
                      <div>
                        <div className="font-bold text-gray-900">{nome}</div>
                        {cat && <div className="text-[11px] text-[#16578B]">{cat}</div>}
                        <div className="text-[11px] text-gray-500">
                          LMI: {formatCurrency(lmi)} | Franquia: {cov.franquia || '—'}
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
