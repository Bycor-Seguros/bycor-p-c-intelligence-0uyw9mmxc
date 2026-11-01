import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Shield,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  FileText,
  DollarSign,
  TrendingUp,
  PackageCheck,
  Send,
  Plus,
  Loader2,
  Check,
  RotateCcw,
  Sparkles,
  Info,
  UploadCloud,
  Layers,
  Edit2,
  Trash2,
  Paperclip,
  ExternalLink,
  X,
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
import { isCoberturaBasica, isCoberturaLucrosCessantes } from '@/services/submissionKitService'
import { matchCanonicalCategory } from '@/services/riskCardReader'
import pb from '@/lib/pocketbase/client'
import {
  RfqSeguradoraRecord,
  RfqSeguradoraStatus,
  RfqPropostaSummary,
  PropostaModelo,
  syncAndLoadRfqSeguradoras,
  computeRfqSummary,
  toggleKitEntregue,
  marcarDeclinio,
  registrarPropostaManual,
  definirVersaoAtiva,
  desnormalizarBasePremioParaUi,
} from '@/services/rfqPropostasService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import PropostaUploadModal from '@/components/PropostaUploadModal'

interface PainelControlePropostasProps {
  rfqId: string
  rfqNumero?: string
  empreendimentoNome?: string
  seguradorasSolicitadas: string[]
  dataEnvio?: string
  prazoLimite?: string
  rfqStatus?: string
  /**
   * Callback quando houver alteração de status/propostas (para que o componente pai recarregue dados se necessário)
   */
  onDataChange?: () => void
  /**
   * Modo de visualização compacto ou com cabeçalho completo
   */
  variant?: 'embedded' | 'standalone'
  /**
   * Ação para abrir o editor de RFQ (adicionar seguradoras) quando vazio
   */
  onEditarRfq?: () => void
}

export function PainelControlePropostas({
  rfqId,
  rfqNumero,
  empreendimentoNome,
  seguradorasSolicitadas,
  dataEnvio,
  prazoLimite,
  rfqStatus,
  onDataChange,
  variant = 'standalone',
  onEditarRfq,
}: PainelControlePropostasProps) {
  const [records, setRecords] = useState<RfqSeguradoraRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Modal Registrar / Editar Proposta Manual e Coberturas
  const [propModalOpen, setPropModalOpen] = useState(false)
  const [selectedSeg, setSelectedSeg] = useState<{ id: string; nome: string } | null>(null)
  const [dataProposta, setDataProposta] = useState(new Date().toISOString().slice(0, 10))
  const [lmiLmg, setLmiLmg] = useState<number | ''>('')
  const [premioLiquido, setPremioLiquido] = useState<number | ''>('')
  const [premioBruto, setPremioBruto] = useState<number | ''>('')
  const [premioNet, setPremioNet] = useState<number | ''>('')
  const [agravo, setAgravo] = useState<number | ''>('')
  const [iof, setIof] = useState<number | ''>('')
  const [comissaoTrabalhada, setComissaoTrabalhada] = useState<number | ''>('')
  const [basePremio, setBasePremio] = useState<'liquido' | 'net'>('liquido')
  const [vrdDm, setVrdDm] = useState<number | ''>('')
  const [vrdMmu, setVrdMmu] = useState<number | ''>('')
  const [vrdMmp, setVrdMmp] = useState<number | ''>('')
  const [vrdLc, setVrdLc] = useState<number | ''>('')
  const [vrdLcBase, setVrdLcBase] = useState('Lucro Bruto')
  const [posFranquias, setPosFranquias] = useState('')
  const [clausulas, setClausulas] = useState('')
  const [exclusoes, setExclusoes] = useState('')
  const [arquivoVinculado, setArquivoVinculado] = useState<{
    arquivo?: string
    arquivoNome?: string
    propostaId?: string
  } | null>(null)
  const [coberturasModal, setCoberturasModal] = useState<any[]>([])

  // Edição inline de coberturas no modal
  const [editingCobIndex, setEditingCobIndex] = useState<number | null>(null)
  const [editCobNome, setEditCobNome] = useState('')
  const [editCobCategoria, setEditCobCategoria] = useState('')
  const [editCobLmi, setEditCobLmi] = useState<string>('')
  const [editCobPremio, setEditCobPremio] = useState<string>('')
  const [editCobFranquia, setEditCobFranquia] = useState('')
  const [deletingCobIndex, setDeletingCobIndex] = useState<number | null>(null)

  // Adição de nova cobertura no modal
  const [showAddCobForm, setShowAddCobForm] = useState(false)
  const [newCobNome, setNewCobNome] = useState('')
  const [newCobCategoria, setNewCobCategoria] = useState<string>(CATEGORIAS_48[0])
  const [newCobLmi, setNewCobLmi] = useState<string>('')
  const [newCobPremio, setNewCobPremio] = useState<string>('')
  const [newCobFranquia, setNewCobFranquia] = useState('')

  const [savingProp, setSavingProp] = useState(false)

  // Modal Marcar Declínio
  const [declinioModalOpen, setDeclinioModalOpen] = useState(false)
  const [declinioSeg, setDeclinioSeg] = useState<{ id: string; nome: string } | null>(null)
  const [motivoDeclinio, setMotivoDeclinio] = useState('Sem apetite para o segmento')
  const [motivoCustom, setMotivoCustom] = useState('')
  const [savingDeclinio, setSavingDeclinio] = useState(false)

  // Modal Upload de Proposta (Extração PDF)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadTargetSeg, setUploadTargetSeg] = useState<{ id: string; nome: string } | null>(null)

  const loadData = useCallback(async () => {
    if (!rfqId) return
    try {
      setLoading(true)
      const list = await syncAndLoadRfqSeguradoras(rfqId, seguradorasSolicitadas)
      setRecords(list)
    } catch (err) {
      console.error('Erro ao carregar dados do painel:', err)
    } finally {
      setLoading(false)
    }
  }, [rfqId, seguradorasSolicitadas])

  useEffect(() => {
    loadData()
  }, [loadData])

  const summary: RfqPropostaSummary = useMemo(() => {
    return computeRfqSummary(records)
  }, [records])

  // Alternar Versão Ativa da Proposta (opera dentro da opção do registro escolhido)
  const handleTrocarVersaoAtiva = async (rec: RfqSeguradoraRecord, novaPropostaId: string) => {
    try {
      setUpdatingId(rec.id)
      await definirVersaoAtiva(rfqId, rec.seguradora, novaPropostaId)
      await loadData()
      setFeedback(
        `Versão ativa de ${rec.expand?.seguradora?.nome || 'Seguradora'} alterada com sucesso dentro da opção selecionada.`,
      )
      setTimeout(() => setFeedback(null), 4000)
      onDataChange?.()
    } catch (err: unknown) {
      console.error(err)
      alert('Falha ao trocar versão ativa: ' + (err as Error).message)
    } finally {
      setUpdatingId(null)
    }
  }

  // Ações de Toggle Kit Entregue
  const handleToggleKit = async (rec: RfqSeguradoraRecord) => {
    try {
      setUpdatingId(rec.id)
      const novoEstado = !rec.kit_entregue
      const updated = await toggleKitEntregue(rec.id, novoEstado)
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? updated : r)))
      setFeedback(
        novoEstado
          ? `Kit de Submissão marcado como entregue para ${updated.expand?.seguradora?.nome || 'a seguradora'}.`
          : `Entrega do Kit desfeita para ${updated.expand?.seguradora?.nome || 'a seguradora'}.`,
      )
      setTimeout(() => setFeedback(null), 4000)
      onDataChange?.()
    } catch (err) {
      console.error(err)
      alert('Falha ao atualizar kit entregue: ' + (err as Error).message)
    } finally {
      setUpdatingId(null)
    }
  }

  // Abertura do Modal de Upload de Proposta
  const handleOpenUploadProposta = (rec?: RfqSeguradoraRecord) => {
    if (rec) {
      setUploadTargetSeg({
        id: rec.seguradora,
        nome: rec.expand?.seguradora?.nome || 'Seguradora',
      })
    } else {
      setUploadTargetSeg(null)
    }
    setUploadModalOpen(true)
  }

  // Lista de seguradoras disponíveis para seleção no modal
  const seguradorasDisponiveis = useMemo(() => {
    return records.map((r) => ({
      id: r.seguradora,
      nome: r.expand?.seguradora?.nome || 'Seguradora',
    }))
  }, [records])

  // Abertura do Modal de Proposta Manual / Edição Completa com Coberturas
  const handleOpenRegistrarProposta = (rec: RfqSeguradoraRecord) => {
    setSelectedSeg({
      id: rec.seguradora,
      nome: rec.expand?.seguradora?.nome || 'Seguradora',
    })
    setDataProposta(
      rec.proposta
        ? rec.data_resposta || new Date().toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    )
    const p = rec.expand?.proposta
    setLmiLmg(p?.lmi_lmg !== undefined && p?.lmi_lmg !== null ? p.lmi_lmg : '')
    const rawNet = p?.premio_net !== undefined && p?.premio_net !== null ? p.premio_net : ''
    const rawLiq =
      p?.premio_liquido !== undefined && p?.premio_liquido !== null ? p.premio_liquido : ''
    const rawBruto = p?.premio_bruto !== undefined && p?.premio_bruto !== null ? p.premio_bruto : ''
    const rawIof = p?.iof !== undefined && p?.iof !== null ? p.iof : ''
    const rawComissao =
      p?.comissao_trabalhada !== undefined && p?.comissao_trabalhada !== null
        ? p.comissao_trabalhada
        : ''

    // Se é proposta com Prêmio Net e sem comissão trabalhada, Líquido, Bruto e IOF devem ficar vazios (pendentes)
    const baseUi = desnormalizarBasePremioParaUi(p?.base_premio)
    const semComissao = rawComissao === '' || rawComissao === null || rawComissao === undefined
    const isNetSemComissao = baseUi === 'net' && rawNet !== '' && semComissao

    setPremioLiquido(isNetSemComissao ? '' : Number(rawLiq) > 0 ? Number(rawLiq) : '')
    setPremioBruto(isNetSemComissao ? '' : Number(rawBruto) > 0 ? Number(rawBruto) : '')
    setPremioNet(rawNet !== '' ? rawNet : '')
    setAgravo(p?.agravo !== undefined && p?.agravo !== null ? p.agravo : '')
    setIof(isNetSemComissao ? '' : Number(rawIof) > 0 ? Number(rawIof) : '')
    setComissaoTrabalhada(rawComissao)
    setBasePremio(baseUi)
    setVrdDm(p?.vrd_dm !== undefined && p?.vrd_dm !== null ? p.vrd_dm : '')
    setVrdMmu(p?.vrd_mmu !== undefined && p?.vrd_mmu !== null ? p.vrd_mmu : '')
    setVrdMmp(p?.vrd_mmp !== undefined && p?.vrd_mmp !== null ? p.vrd_mmp : '')
    setVrdLc(p?.vrd_lc !== undefined && p?.vrd_lc !== null ? p.vrd_lc : '')
    setVrdLcBase(p?.vrd_lc_base || 'Lucro Bruto')
    setPosFranquias(p?.pos_franquias || '')
    setClausulas(p?.clausulas || '')
    setExclusoes(p?.exclusoes || '')

    // Preservar referência do PDF vinculado
    if (p?.arquivo) {
      setArquivoVinculado({
        arquivo: p.arquivo,
        arquivoNome: p.arquivo_nome || 'proposta.pdf',
        propostaId: p.id,
      })
    } else {
      setArquivoVinculado(null)
    }

    // Carregar coberturas já persistidas ou array vazio
    const rawCobs = Array.isArray(p?.coberturas) ? p.coberturas : []
    // Normalizar formato de coberturas (pode ter sido salvo como ExtractedCoberturaItem ou SubmissionKitCobertura)
    const normalizedCobs = rawCobs.map((c) => ({
      cobertura: c.cobertura || c.nome || '',
      categoriaNormalizada:
        c.categoriaNormalizada || matchCanonicalCategory(c.cobertura || c.nome || ''),
      lmi: c.lmi !== undefined && c.lmi !== null ? c.lmi : c.is !== undefined ? c.is : null,
      premioLiquido:
        c.premioLiquido !== undefined && c.premioLiquido !== null
          ? c.premioLiquido
          : c.premio !== undefined
            ? c.premio
            : null,
      franquia: c.franquia || 'Conforme apólice',
    }))
    setCoberturasModal(normalizedCobs)

    setEditingCobIndex(null)
    setDeletingCobIndex(null)
    setShowAddCobForm(false)
    setPropModalOpen(true)
  }

  // Manipulação de coberturas no modal
  const startEditingCob = (idx: number) => {
    const item = coberturasModal[idx]
    if (!item) return
    setEditingCobIndex(idx)
    setEditCobNome(item.cobertura)
    setEditCobCategoria(item.categoriaNormalizada || matchCanonicalCategory(item.cobertura))
    setEditCobLmi(item.lmi !== null && item.lmi !== undefined ? String(item.lmi) : '')
    setEditCobPremio(
      item.premioLiquido !== null && item.premioLiquido !== undefined
        ? String(item.premioLiquido)
        : '',
    )
    setEditCobFranquia(item.franquia || '')
    setDeletingCobIndex(null)
  }

  const cancelEditingCob = () => {
    setEditingCobIndex(null)
  }

  const saveEditingCob = () => {
    if (editingCobIndex === null) return
    if (!editCobNome.trim()) {
      alert('Informe o nome da cobertura.')
      return
    }
    const cat = editCobCategoria.trim() || matchCanonicalCategory(editCobNome.trim())
    const updated = [...coberturasModal]
    updated[editingCobIndex] = {
      cobertura: editCobNome.trim(),
      categoriaNormalizada: cat,
      lmi: editCobLmi === '' ? null : Number(editCobLmi),
      premioLiquido: editCobPremio === '' ? null : Number(editCobPremio),
      franquia: editCobFranquia.trim() || 'Conforme apólice',
    }
    setCoberturasModal(updated)
    setEditingCobIndex(null)
  }

  const confirmDeleteCob = (idx: number) => {
    setCoberturasModal((prev) => prev.filter((_, i) => i !== idx))
    setDeletingCobIndex(null)
    if (editingCobIndex === idx) {
      setEditingCobIndex(null)
    }
  }

  const handleAddNewCob = () => {
    if (!newCobNome.trim()) {
      alert('Informe o nome da cobertura.')
      return
    }
    const cat = newCobCategoria.trim() || matchCanonicalCategory(newCobNome.trim())
    const newItem = {
      cobertura: newCobNome.trim(),
      categoriaNormalizada: cat,
      lmi: newCobLmi === '' ? null : Number(newCobLmi),
      premioLiquido: newCobPremio === '' ? null : Number(newCobPremio),
      franquia: newCobFranquia.trim() || 'Conforme apólice',
    }
    setCoberturasModal((prev) => [...prev, newItem])
    setNewCobNome('')
    setNewCobLmi('')
    setNewCobPremio('')
    setNewCobFranquia('')
    setShowAddCobForm(false)
  }

  const handleSalvarProposta = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSeg) return
    try {
      setSavingProp(true)
      await registrarPropostaManual({
        rfqId,
        seguradoraId: selectedSeg.id,
        dataProposta,
        lmiLmg: lmiLmg === '' ? undefined : Number(lmiLmg),
        premioLiquido: premioLiquido === '' ? undefined : Number(premioLiquido),
        premioBruto: premioBruto === '' ? undefined : Number(premioBruto),
        premioNet: premioNet === '' ? undefined : Number(premioNet),
        agravo: agravo === '' ? undefined : Number(agravo),
        premioNetPosAgravo:
          agravo !== '' && Number(agravo) > 0 && premioNet !== ''
            ? Number((Number(premioNet) * (1 + Number(agravo) / 100)).toFixed(2))
            : undefined,
        iof: iof === '' ? undefined : Number(iof),
        comissaoTrabalhada: comissaoTrabalhada === '' ? undefined : Number(comissaoTrabalhada),
        basePremio,
        vrdDm: vrdDm === '' ? undefined : Number(vrdDm),
        vrdMmu: vrdMmu === '' ? undefined : Number(vrdMmu),
        vrdMmp: vrdMmp === '' ? undefined : Number(vrdMmp),
        vrdLc: vrdLc === '' ? undefined : Number(vrdLc),
        vrdLcBase,
        posFranquias: posFranquias || undefined,
        clausulas,
        exclusoes,
        coberturas: coberturasModal,
      })
      setPropModalOpen(false)
      setFeedback(
        `Proposta da ${selectedSeg.nome} atualizada com sucesso! Quadro de ${coberturasModal.length} coberturas persistido.`,
      )
      setTimeout(() => setFeedback(null), 4500)
      await loadData()
      onDataChange?.()
    } catch (err) {
      console.error(err)
      const msg = getErrorMessage(err)
      alert('Erro ao registrar proposta: ' + msg)
    } finally {
      setSavingProp(false)
    }
  }

  // Abertura do Modal de Declínio
  const handleOpenMarcarDeclinio = (rec: RfqSeguradoraRecord) => {
    setDeclinioSeg({
      id: rec.seguradora,
      nome: rec.expand?.seguradora?.nome || 'Seguradora',
    })
    setMotivoDeclinio(rec.declinou_motivo || 'Sem apetite para o segmento')
    setMotivoCustom('')
    setDeclinioModalOpen(true)
  }

  const handleSalvarDeclinio = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!declinioSeg) return
    try {
      setSavingDeclinio(true)
      const motivoFinal =
        motivoDeclinio === 'Outro'
          ? motivoCustom.trim() || 'Outro motivo informado'
          : motivoDeclinio

      await marcarDeclinio({
        rfqId,
        seguradoraId: declinioSeg.id,
        motivo: motivoFinal,
      })
      setDeclinioModalOpen(false)
      setFeedback(
        `Declínio registrado para ${declinioSeg.nome}. Histórico registrado no Mapa de Mercado.`,
      )
      setTimeout(() => setFeedback(null), 4500)
      await loadData()
      onDataChange?.()
    } catch (err) {
      console.error(err)
      alert('Erro ao marcar declínio: ' + (err as Error).message)
    } finally {
      setSavingDeclinio(false)
    }
  }

  // Cores e labels dos badges de status
  const getBadgeStyle = (status: RfqSeguradoraStatus) => {
    switch (status) {
      case 'Proposta recebida':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-300',
          dot: 'bg-emerald-500',
          icon: CheckCircle2,
          label: 'Proposta recebida',
        }
      case 'Kit entregue':
        return {
          bg: 'bg-blue-50 text-[#16578B] border-blue-300',
          dot: 'bg-blue-600',
          icon: PackageCheck,
          label: 'Kit entregue',
        }
      case 'Declinou':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-300',
          dot: 'bg-rose-500',
          icon: XCircle,
          label: 'Declinou',
        }
      case 'Convidada':
      default:
        return {
          bg: 'bg-gray-100 text-gray-700 border-gray-300',
          dot: 'bg-gray-400',
          icon: Clock,
          label: 'Convidada',
        }
    }
  }

  return (
    <div className="space-y-4">
      {/* Toast inline de feedback */}
      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-2.5 rounded-lg text-xs flex items-center justify-between gap-2 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{feedback}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-emerald-700 hover:text-emerald-950 text-xs font-semibold"
          >
            Fechar
          </button>
        </div>
      )}

      {/* 2. RESUMO NO TOPO DO PAINEL */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#0F2B46] text-white flex items-center justify-center font-bold text-xs">
              <TrendingUp className="w-4 h-4 text-blue-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">
                  Painel de Controle de Propostas das Seguradoras
                </h3>
                {rfqNumero && (
                  <span className="font-mono text-[11px] font-bold text-[#16578B] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {rfqNumero}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                Acompanhamento em tempo real da submissão do edital aos portais e retorno das
                companhias
              </p>
            </div>
          </div>

          {prazoLimite && (
            <div className="text-right text-[11px] text-gray-500">
              Prazo limite (SLA):{' '}
              <strong className="text-gray-900 font-semibold">{formatDate(prazoLimite)}</strong>
            </div>
          )}
        </div>

        {/* 4 Cards de Métricas do Resumo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {/* Total Convidadas */}
          <div className="p-3 rounded-lg bg-gray-50 border border-gray-200/80">
            <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
              Total Convidadas
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-gray-900 tabular-nums">
                {summary.totalConvidadas}
              </span>
              <span className="text-[11px] text-gray-500">cias</span>
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">Ideal: 5 a 6 cias (até 10)</div>
          </div>

          {/* Propostas Recebidas */}
          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200/80">
            <div className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">
              Propostas Recebidas
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-emerald-800 tabular-nums">
                {summary.propostasRecebidas}
              </span>
              <span className="text-[11px] text-emerald-600">ofertas</span>
            </div>
            <div className="text-[10px] text-emerald-700 mt-0.5">Alimentam a C3 Tabulação</div>
          </div>

          {/* Pendentes */}
          <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200/80">
            <div className="text-[10px] uppercase font-bold text-[#16578B] tracking-wider">
              Pendentes / Em Análise
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-[#16578B] tabular-nums">
                {summary.pendentes}
              </span>
              <span className="text-[11px] text-blue-600">aguardando</span>
            </div>
            <div className="text-[10px] text-blue-700 mt-0.5">
              {summary.kitEntregue} com kit entregue
            </div>
          </div>

          {/* Taxa de Resposta (%) */}
          <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200/80">
            <div className="text-[10px] uppercase font-bold text-indigo-900 tracking-wider">
              Taxa de Resposta
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-indigo-950 tabular-nums">
                {summary.taxaResposta}%
              </span>
              <span className="text-[11px] text-indigo-700">conversão</span>
            </div>
            <div className="text-[10px] text-indigo-600 mt-0.5">
              {summary.declinadas > 0 ? `${summary.declinadas} declínio(s)` : 'Sem declínios'}
            </div>
          </div>
        </div>

        {/* ALERTA: Menos de 5 respostas para negociação */}
        {summary.alertaMinimoRespostas && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start sm:items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-800" />
              </div>
              <div>
                <span className="font-bold">Atenção ao poder de negociação do bid:</span>{' '}
                <span>
                  O processo conta com apenas{' '}
                  <strong>{summary.propostasRecebidas} resposta(s)</strong> de seguradoras (mínimo
                  recomendado: <strong>5 respostas</strong> para garantir concorrência técnica e
                  tarifária efetiva na carteira de Hotéis & Resorts).
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-200 text-amber-900 shrink-0 border border-amber-300">
              Bid em Formação ({summary.propostasRecebidas}/5)
            </span>
          </div>
        )}
      </div>

      {/* 1. GRADE DE ACOMPANHAMENTO POR RFQ */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        <div className="p-3.5 sm:p-4 border-b border-[#E4E9F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#16578B]" />
            <span className="text-xs font-bold text-gray-900">
              Seguradoras Convidadas ({records.length})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleOpenUploadProposta()}
              className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 px-3 font-semibold shadow-sm flex items-center gap-1.5"
              title="Fazer upload de proposta/cotação em PDF com extração automática de prêmio, LMI e coberturas"
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-300" />
              <span>Subir proposta (PDF)</span>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#16578B]" />
            <span>Carregando situação das seguradoras...</span>
          </div>
        ) : records.length === 0 ? (
          /* Estado Vazio Claro com Orientação */
          <div className="py-12 px-4 text-center">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-800">Nenhuma seguradora convidada</h4>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Edite o pedido de cotação para convidar companhias (mínimo recomendado de 5 a 6
              seguradoras para obter taxa de resposta sólida).
            </p>
            {onEditarRfq && (
              <Button
                onClick={onEditarRfq}
                className="mt-3 bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 px-3 font-semibold"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Convidar seguradoras para este RFQ
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-gray-50/80 text-gray-600 font-semibold border-b border-[#E4E9F0]">
                <tr>
                  <th className="py-3 px-4 min-w-[200px]">Seguradora</th>
                  <th className="py-3 px-3">Situação</th>
                  <th className="py-3 px-3">Kit Submissão</th>
                  <th className="py-3 px-3">Dados da Oferta / Motivo</th>
                  <th className="py-3 px-3">Data Resposta</th>
                  <th className="py-3 px-4 text-right min-w-[240px]">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((rec) => {
                  const segNome =
                    rec.expand?.seguradora?.nome || `Seguradora ${rec.seguradora.slice(0, 5)}`
                  const segPos = rec.expand?.seguradora?.posicionamento || ''
                  const badge = getBadgeStyle(rec.status)
                  const Icon = badge.icon
                  const isUpdating = updatingId === rec.id

                  const todasPropostas = rec.propostas_todas || []

                  // Agrupa todas as propostas da seguradora por OPÇÃO
                  // Se não houver propostas (ex: convidada/declinou), cria uma linha padrão com opcao = 1
                  const mapaOpcoes = new Map<number, PropostaModelo[]>()
                  if (todasPropostas.length > 0) {
                    todasPropostas.forEach((p) => {
                      const op = Number(p.opcao || 1)
                      const list = mapaOpcoes.get(op) || []
                      list.push(p)
                      mapaOpcoes.set(op, list)
                    })
                  } else {
                    mapaOpcoes.set(1, [])
                  }

                  const opcoesList = Array.from(mapaOpcoes.entries()).sort(([a], [b]) => a - b)

                  return opcoesList.map(([opcaoNum, propsDestaOpcao], idxOpcao) => {
                    // Identifica a versão ativa desta opção específica
                    const propostaAtivaDestaOpcao =
                      propsDestaOpcao.find((p) => p.ativa) ||
                      (propsDestaOpcao.length > 0
                        ? [...propsDestaOpcao].sort(
                            (a, b) => Number(b.versao || 1) - Number(a.versao || 1),
                          )[0]
                        : rec.expand?.proposta)

                    const propostaData = propostaAtivaDestaOpcao

                    return (
                      <tr
                        key={`${rec.id}-op-${opcaoNum}`}
                        className={`hover:bg-blue-50/30 transition-colors ${
                          rec.status === 'Proposta recebida'
                            ? 'bg-emerald-50/15'
                            : rec.status === 'Declinou'
                              ? 'bg-rose-50/15 opacity-80'
                              : ''
                        } ${idxOpcao > 0 ? 'border-t border-dashed border-blue-200' : ''}`}
                      >
                        {/* Nome da Seguradora com Opção, Versão e Seletor de Versão Ativa dentro da Opção */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900 text-xs flex items-center gap-2 flex-wrap">
                            <span>{segNome}</span>
                            {propostaData ? (
                              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">
                                Opção {opcaoNum} · v{propostaData.versao || 1}
                                <span className="ml-1 text-[9px] text-emerald-700 font-sans uppercase">
                                  ● ativa
                                </span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400 font-normal">
                                Opção {opcaoNum}
                              </span>
                            )}
                          </div>

                          {/* Seletor quando houver múltiplas versões DESTA MESMA OPÇÃO */}
                          {propsDestaOpcao.length > 1 && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-500">
                                Versão ativa (Opção {opcaoNum}):
                              </span>
                              <select
                                value={propostaData?.id || ''}
                                onChange={(e) => handleTrocarVersaoAtiva(rec, e.target.value)}
                                disabled={isUpdating}
                                className="text-[11px] h-6 px-1.5 py-0 rounded border border-blue-300 bg-blue-50/50 text-[#16578B] font-semibold focus:outline-none focus:ring-1 focus:ring-[#16578B]"
                              >
                                {propsDestaOpcao.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    v{p.versao || 1} (
                                    {p.premio_bruto ? formatCurrency(p.premio_bruto) : 's/ prêmio'})
                                    {p.id === propostaData?.id ? ' ★ Ativa' : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {segPos && idxOpcao === 0 && (
                            <div className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                              {segPos}
                            </div>
                          )}
                          {rec.expand?.seguradora?.faixa_lmi && idxOpcao === 0 && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              Capacidade: {rec.expand?.seguradora?.faixa_lmi}
                            </div>
                          )}
                        </td>

                        {/* Situação (Badge com cor por estado) */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${badge.bg}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{badge.label}</span>
                          </span>
                        </td>

                        {/* Kit Submissão (Toggle Entregue / Desfazer) */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleToggleKit(rec)}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                                rec.kit_entregue
                                  ? 'bg-blue-100 text-[#16578B] border-blue-300 hover:bg-blue-200'
                                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                              }`}
                              title={
                                rec.kit_entregue
                                  ? 'Kit marcado como entregue no portal da cia. Clique para desfazer.'
                                  : 'Clique para marcar que o Kit foi entregue no portal da cia.'
                              }
                            >
                              {isUpdating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : rec.kit_entregue ? (
                                <Check className="w-3 h-3 text-[#16578B]" />
                              ) : (
                                <RotateCcw className="w-3 h-3 text-gray-400" />
                              )}
                              <span>{rec.kit_entregue ? 'Entregue' : 'Marcar entrega'}</span>
                            </button>

                            {rec.kit_entregue_em && (
                              <span
                                className="text-[10px] text-gray-400"
                                title={rec.kit_entregue_em}
                              >
                                {formatDate(rec.kit_entregue_em)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Dados da Oferta / Motivo do Declínio */}
                        <td className="py-3 px-3">
                          {rec.status === 'Proposta recebida' ? (
                            <div className="space-y-1">
                              <div className="font-semibold text-gray-900 text-xs flex items-center gap-2">
                                <span className="text-emerald-800">
                                  Bruto:{' '}
                                  {propostaData?.premio_bruto &&
                                  Number(propostaData.premio_bruto) > 0 ? (
                                    formatCurrency(propostaData.premio_bruto)
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                                      Pendente
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div className="text-[10px] text-gray-600 flex flex-wrap items-center gap-1.5 font-mono">
                                <span>
                                  Net:{' '}
                                  {propostaData?.premio_net &&
                                  Number(propostaData.premio_net) > 0 ? (
                                    <strong className="text-blue-900">
                                      {formatCurrency(propostaData.premio_net)}
                                    </strong>
                                  ) : (
                                    '—'
                                  )}
                                </span>
                                <span>•</span>
                                <span>
                                  Líq:{' '}
                                  {propostaData?.premio_liquido &&
                                  Number(propostaData.premio_liquido) > 0 ? (
                                    formatCurrency(propostaData.premio_liquido)
                                  ) : (
                                    <span className="text-amber-800 font-sans font-medium">
                                      Pendente
                                    </span>
                                  )}
                                </span>
                                <span>•</span>
                                <span>
                                  IOF:{' '}
                                  {propostaData?.premio_liquido &&
                                  Number(propostaData.premio_liquido) > 0 ? (
                                    formatCurrency(
                                      propostaData?.iof && Number(propostaData.iof) > 0
                                        ? Number(propostaData.iof)
                                        : Number((propostaData.premio_liquido * 0.0738).toFixed(2)),
                                    )
                                  ) : (
                                    <span className="text-amber-800 font-sans font-medium">
                                      Pendente
                                    </span>
                                  )}
                                </span>
                              </div>
                              {propostaData?.agravo !== undefined &&
                                propostaData?.agravo !== null &&
                                Number(propostaData.agravo) > 0 && (
                                  <div className="text-[10px] text-amber-800 font-mono">
                                    Net Pós Agravo ({propostaData.agravo}%):{' '}
                                    <strong>
                                      {propostaData.premio_net_pos_agravo
                                        ? formatCurrency(propostaData.premio_net_pos_agravo)
                                        : propostaData.premio_net
                                          ? formatCurrency(
                                              Number(
                                                (
                                                  propostaData.premio_net *
                                                  (1 + Number(propostaData.agravo) / 100)
                                                ).toFixed(2),
                                              ),
                                            )
                                          : '—'}
                                    </strong>{' '}
                                    <span className="text-[9px] uppercase font-sans text-amber-700">
                                      [calc]
                                    </span>
                                  </div>
                                )}
                              {propostaData?.comissao_trabalhada !== undefined &&
                                propostaData?.comissao_trabalhada !== null && (
                                  <div className="text-[10px] text-blue-700">
                                    Comis: {propostaData.comissao_trabalhada}% ({' '}
                                    {desnormalizarBasePremioParaUi(propostaData.base_premio) ===
                                    'net'
                                      ? 'base Net'
                                      : 'base Líquido'}
                                    )
                                  </div>
                                )}
                              {/* Bloco VRD compacto */}
                              {(propostaData?.vrd_dm || propostaData?.vrd_lc) && (
                                <div className="text-[10px] text-gray-500 pt-0.5 border-t border-gray-100 flex flex-wrap gap-1">
                                  {propostaData.vrd_dm ? (
                                    <span>VRD DM: {formatCurrency(propostaData.vrd_dm)}</span>
                                  ) : null}
                                  {propostaData.vrd_lc ? (
                                    <span>
                                      • LC: {formatCurrency(propostaData.vrd_lc)} (
                                      {propostaData.vrd_lc_base || 'LB'})
                                    </span>
                                  ) : null}
                                </div>
                              )}
                              {propostaData?.lmi_lmg ? (
                                <div className="text-[10px] text-gray-500">
                                  LMI Total: {formatCurrency(propostaData.lmi_lmg)}
                                </div>
                              ) : null}
                            </div>
                          ) : rec.status === 'Declinou' ? (
                            <div className="text-xs">
                              <span className="text-rose-700 font-medium">Motivo:</span>{' '}
                              <span className="text-gray-700">
                                {rec.declinou_motivo || 'Sem apetite no momento'}
                              </span>
                            </div>
                          ) : rec.kit_entregue ? (
                            <span className="text-[11px] text-blue-700">
                              Aguardando resposta no portal da cia
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">
                              Kit ainda não inserido no portal
                            </span>
                          )}
                        </td>

                        {/* Data Resposta */}
                        <td className="py-3 px-3 whitespace-nowrap text-gray-600 text-xs">
                          {rec.data_resposta ? (
                            <span>{formatDate(rec.data_resposta)}</span>
                          ) : rec.status === 'Declinou' && rec.declinou_em ? (
                            <span>{formatDate(rec.declinou_em)}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        {/* Ações por Linha */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Botão de Upload com Extração (Ação Principal) */}
                            <Button
                              size="sm"
                              onClick={() => handleOpenUploadProposta(rec)}
                              className="h-7 px-2.5 text-[11px] font-semibold flex items-center gap-1 shadow-sm bg-[#0F2B46] hover:bg-[#1B3C5D] text-white"
                              title="Subir PDF da proposta desta seguradora com extração automática"
                            >
                              <UploadCloud className="w-3.5 h-3.5 text-blue-300" />
                              <span>Subir PDF</span>
                            </Button>

                            {/* Registrar / Editar Proposta Manual (Fallback) */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenRegistrarProposta(rec)}
                              className={`h-7 px-2 text-[11px] font-semibold flex items-center gap-1 border ${
                                rec.status === 'Proposta recebida'
                                  ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                              title={
                                rec.status === 'Proposta recebida'
                                  ? 'Editar proposta manualmente'
                                  : 'Digitar proposta manualmente sem arquivo PDF'
                              }
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>
                                {rec.status === 'Proposta recebida'
                                  ? 'Editar manual'
                                  : 'Digitar manual'}
                              </span>
                            </Button>

                            {/* Marcar Declínio */}
                            {rec.status !== 'Declinou' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenMarcarDeclinio(rec)}
                                className="h-7 px-2 text-[11px] text-rose-700 border-rose-200 hover:bg-rose-50 hover:border-rose-300 font-semibold"
                                title="Marcar que a seguradora declinou a cotação"
                              >
                                <XCircle className="w-3.5 h-3.5 mr-0.5 text-rose-600" />
                                <span>Declinou</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenMarcarDeclinio(rec)}
                                className="h-7 px-2 text-[11px] text-gray-500 hover:text-gray-800"
                                title="Alterar motivo do declínio"
                              >
                                <span>Editar motivo</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: REGISTRAR / EDITAR PROPOSTA (INCLUINDO QUADRO DE COBERTURAS) */}
      <Dialog open={propModalOpen} onOpenChange={setPropModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#16578B]" />
              <span>Editar / Registrar Proposta — {selectedSeg?.nome}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Ajuste parâmetros comerciais e o quadro de coberturas extraídas ou cadastradas. O PDF
              vinculado original permanece intacto.
            </DialogDescription>
          </DialogHeader>

          {/* Banner do PDF vinculado (se houver) */}
          {arquivoVinculado?.arquivo && (
            <div className="p-2.5 rounded-lg bg-blue-50/80 border border-blue-200 flex items-center justify-between text-xs text-blue-950">
              <div className="flex items-center gap-2 truncate">
                <Paperclip className="w-4 h-4 text-[#16578B] shrink-0" />
                <span className="font-semibold text-gray-700">PDF Vinculado:</span>
                <span
                  className="font-mono text-[11px] truncate text-[#16578B]"
                  title={arquivoVinculado.arquivoNome}
                >
                  {arquivoVinculado.arquivoNome}
                </span>
              </div>
              {arquivoVinculado.propostaId && (
                <a
                  href={pb.files.getURL(
                    { id: arquivoVinculado.propostaId, collectionName: 'propostas' } as any,
                    arquivoVinculado.arquivo,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[#16578B] hover:underline font-semibold shrink-0 ml-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Ver PDF original</span>
                </a>
              )}
            </div>
          )}

          <form onSubmit={handleSalvarProposta} className="space-y-4 pt-1 text-xs">
            {/* Bloco 1: Dados Comerciais */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-gray-50/60 rounded-xl border border-gray-200">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-700">Data de Recebimento</Label>
                <Input
                  type="date"
                  value={dataProposta}
                  onChange={(e) => setDataProposta(e.target.value)}
                  className="h-8 text-xs bg-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">
                    LMI / LMG Máximo (R$)
                  </Label>
                  {lmiLmg !== '' && (
                    <span className="text-[10px] font-mono text-gray-600">
                      {formatCurrency(lmiLmg)}
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  placeholder="Ex: 95000000.00"
                  value={lmiLmg}
                  onChange={(e) => setLmiLmg(e.target.value === '' ? '' : Number(e.target.value))}
                  className="h-8 text-xs font-semibold bg-white"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">Prêmio Líquido (R$)</Label>
                  {premioLiquido !== '' && (
                    <span className="text-[10px] font-mono text-gray-600">
                      {formatCurrency(premioLiquido)}
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 69215.24"
                  value={premioLiquido}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : Number(e.target.value)
                    setPremioLiquido(val)
                    if (typeof val === 'number' && val > 0) {
                      const iofVal =
                        typeof iof === 'number' && iof > 0 ? iof : Number((val * 0.0738).toFixed(2))
                      if (typeof iof !== 'number' || iof === 0) {
                        setIof(iofVal)
                      }
                      setPremioBruto(Number((val + iofVal).toFixed(2)))
                    }
                  }}
                  className="h-8 text-xs font-semibold bg-white"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">
                    Prêmio Total / Bruto (R$)
                  </Label>
                  {premioBruto !== '' && (
                    <span className="text-[10px] font-mono text-emerald-700">
                      {formatCurrency(premioBruto)}
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 74323.32"
                  value={premioBruto}
                  onChange={(e) =>
                    setPremioBruto(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="h-8 text-xs font-semibold text-emerald-800 bg-white"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">IOF (R$)</Label>
                  {iof !== '' && (
                    <span className="text-[10px] font-mono text-gray-600">
                      {formatCurrency(iof)}
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 5108.08"
                  value={iof}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : Number(e.target.value)
                    setIof(val)
                    const iofVal = typeof val === 'number' ? val : 0
                    const liqVal = typeof premioLiquido === 'number' ? premioLiquido : 0
                    if (liqVal > 0) {
                      setPremioBruto(Number((liqVal + iofVal).toFixed(2)))
                    }
                  }}
                  className="h-8 text-xs font-semibold bg-white"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">
                    Prêmio Net (sem comissão)
                  </Label>
                  {premioNet !== '' && (
                    <span className="text-[10px] font-mono text-gray-600">
                      {formatCurrency(premioNet)}
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 58000.00"
                  value={premioNet}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : Number(e.target.value)
                    setPremioNet(val)
                    if (basePremio === 'net') {
                      if (val !== '' && typeof comissaoTrabalhada === 'number') {
                        const c = comissaoTrabalhada
                        const agr = typeof agravo === 'number' ? agravo : 0
                        if (c >= 0 && c < 100) {
                          const netPos = agr > 0 ? Number(val) * (1 + agr / 100) : Number(val)
                          const liq = netPos / (1 - c / 100)
                          setPremioLiquido(Number(liq.toFixed(2)))
                          const iofVal =
                            typeof iof === 'number' && iof > 0
                              ? iof
                              : Number((liq * 0.0738).toFixed(2))
                          if (typeof iof !== 'number' || iof === 0) {
                            setIof(iofVal)
                          }
                          setPremioBruto(Number((liq + iofVal).toFixed(2)))
                        }
                      } else if (comissaoTrabalhada === '') {
                        setPremioLiquido('')
                        setIof('')
                        setPremioBruto('')
                      }
                    }
                  }}
                  className="h-8 text-xs font-semibold bg-white"
                />
              </div>

              {/* Campo Agravo (%) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">Agravo (%)</Label>
                  <span className="text-[10px] text-gray-400">opcional</span>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ex: 10"
                  value={agravo}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : Number(e.target.value)
                    setAgravo(val)
                    const agr = typeof val === 'number' ? val : 0
                    const temComissao = typeof comissaoTrabalhada === 'number'
                    const c = temComissao ? comissaoTrabalhada : 0

                    if (basePremio === 'liquido') {
                      const pLiq = typeof premioLiquido === 'number' ? premioLiquido : 0
                      const netOriginal =
                        typeof premioNet === 'number' && premioNet > 0
                          ? premioNet
                          : pLiq > 0 && c < 100
                            ? pLiq * (1 - c / 100)
                            : 0
                      if (netOriginal > 0) {
                        setPremioNet(Number(netOriginal.toFixed(2)))
                        const netPos = agr > 0 ? netOriginal * (1 + agr / 100) : netOriginal
                        if (c < 100) {
                          const liqNovo = netPos / (1 - c / 100)
                          setPremioLiquido(Number(liqNovo.toFixed(2)))
                          const iofVal =
                            typeof iof === 'number' && iof > 0
                              ? iof
                              : Number((liqNovo * 0.0738).toFixed(2))
                          if (typeof iof !== 'number' || iof === 0) {
                            setIof(iofVal)
                          }
                          setPremioBruto(Number((liqNovo + iofVal).toFixed(2)))
                        }
                      }
                    } else {
                      if (
                        typeof premioNet === 'number' &&
                        premioNet > 0 &&
                        temComissao &&
                        c < 100
                      ) {
                        const netPos = agr > 0 ? premioNet * (1 + agr / 100) : premioNet
                        const liq = netPos / (1 - c / 100)
                        setPremioLiquido(Number(liq.toFixed(2)))
                        const iofVal =
                          typeof iof === 'number' && iof > 0
                            ? iof
                            : Number((liq * 0.0738).toFixed(2))
                        if (typeof iof !== 'number' || iof === 0) {
                          setIof(iofVal)
                        }
                        setPremioBruto(Number((liq + iofVal).toFixed(2)))
                      } else if (!temComissao) {
                        setPremioLiquido('')
                        setIof('')
                        setPremioBruto('')
                      }
                    }
                  }}
                  className="h-8 text-xs font-mono font-bold text-amber-900 bg-amber-50/40"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">
                    Comissão Trabalhada (%)
                  </Label>
                  <span className="text-[10px] text-gray-400">
                    {basePremio === 'net' ? 'Base Net' : 'Base Líquido'}
                  </span>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="99.9"
                  placeholder="Ex: 15"
                  value={comissaoTrabalhada}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : Number(e.target.value)
                    setComissaoTrabalhada(val)
                    const temComissao = typeof val === 'number'
                    const c = temComissao ? val : 0
                    const agr = typeof agravo === 'number' ? agravo : 0
                    if (basePremio === 'liquido') {
                      if (typeof premioLiquido === 'number' && premioLiquido > 0 && c < 100) {
                        const net = premioLiquido * (1 - c / 100)
                        setPremioNet(Number(net.toFixed(2)))
                        if (agr > 0) {
                          const netPos = net * (1 + agr / 100)
                          const liqRecalc = netPos / (1 - c / 100)
                          setPremioLiquido(Number(liqRecalc.toFixed(2)))
                          const iofVal =
                            typeof iof === 'number' && iof > 0
                              ? iof
                              : Number((liqRecalc * 0.0738).toFixed(2))
                          if (typeof iof !== 'number' || iof === 0) {
                            setIof(iofVal)
                          }
                          setPremioBruto(Number((liqRecalc + iofVal).toFixed(2)))
                        } else {
                          const iofVal =
                            typeof iof === 'number' && iof > 0
                              ? iof
                              : Number((premioLiquido * 0.0738).toFixed(2))
                          if (typeof iof !== 'number' || iof === 0) {
                            setIof(iofVal)
                          }
                          setPremioBruto(Number((premioLiquido + iofVal).toFixed(2)))
                        }
                      }
                    } else {
                      // Base Net: reatividade imediata em cadeia
                      // Líquido = Net Pós Agravo / (1 - comissão)
                      // IOF = Líquido * 7,38%
                      // Bruto = Líquido + IOF
                      if (typeof premioNet === 'number' && premioNet > 0) {
                        if (temComissao && c >= 0 && c < 100) {
                          const netParaLiq = agr > 0 ? premioNet * (1 + agr / 100) : premioNet
                          const liq = Number((netParaLiq / (1 - c / 100)).toFixed(2))
                          setPremioLiquido(liq)
                          const iofVal = Number((liq * 0.0738).toFixed(2))
                          setIof(iofVal)
                          setPremioBruto(Number((liq + iofVal).toFixed(2)))
                        } else {
                          // Sem comissão informada: Líquido, IOF e Bruto voltam a ficar pendentes
                          setPremioLiquido('')
                          setIof('')
                          setPremioBruto('')
                        }
                      }
                    }
                  }}
                  className="h-8 text-xs font-mono font-bold text-blue-900 bg-white"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-700">
                  Apresentação da Proposta
                </Label>
                <select
                  value={basePremio}
                  onChange={(e) => setBasePremio(e.target.value as 'liquido' | 'net')}
                  className="w-full h-8 rounded border border-gray-300 bg-white px-2 text-xs"
                >
                  <option value="liquido">Prêmio Líquido (com comissão)</option>
                  <option value="net">Prêmio Net (sem comissão)</option>
                </select>
              </div>
            </div>

            {/* Pill resumo derivado no modal */}
            {(() => {
              const agr = typeof agravo === 'number' ? agravo : 0
              const pNet = typeof premioNet === 'number' ? premioNet : 0
              const temAgravoVal = agr > 0 && pNet > 0
              const netPosCalc = temAgravoVal ? Number((pNet * (1 + agr / 100)).toFixed(2)) : null

              return (
                <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="text-gray-600 flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{temAgravoVal ? 'Quarteto de Prêmios:' : 'Tríade de Prêmios:'}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 font-mono">
                    <span>
                      Net:{' '}
                      <strong className="text-gray-800">
                        {typeof premioNet === 'number' ? formatCurrency(premioNet) : 'R$ 0,00'}
                      </strong>
                    </span>
                    {temAgravoVal && netPosCalc !== null && (
                      <>
                        <span className="text-gray-300">•</span>
                        <span className="bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-amber-900">
                          Net Pós Agravo ({agr}%):{' '}
                          <strong className="text-amber-950 font-bold">
                            {formatCurrency(netPosCalc)}
                          </strong>{' '}
                          <span className="text-[9px] uppercase font-sans font-semibold text-amber-700">
                            [calculado]
                          </span>
                        </span>
                      </>
                    )}
                    <span className="text-gray-300">•</span>
                    <span>
                      Líquido:{' '}
                      {typeof premioLiquido === 'number' && premioLiquido > 0 ? (
                        <strong className="text-blue-900">{formatCurrency(premioLiquido)}</strong>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                          Pendente (informe comissão)
                        </span>
                      )}
                    </span>
                    <span className="text-gray-300">•</span>
                    <span>
                      Bruto:{' '}
                      {typeof premioBruto === 'number' && premioBruto > 0 ? (
                        <strong className="text-emerald-700">{formatCurrency(premioBruto)}</strong>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                          Pendente
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )
            })()}

            {/* Bloco VRD (Substitui Franquias Gerais / P.O.S.) */}
            <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Bloco VRD (Valor em Risco Declarado)</span>
                </span>
                <span className="text-[10px] text-gray-500">
                  Campos numéricos por seção • Editável pelo analista
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">VRD DM (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={vrdDm}
                    onChange={(e) => setVrdDm(e.target.value === '' ? '' : Number(e.target.value))}
                    className="h-8 text-xs bg-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">VRD MMU (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={vrdMmu}
                    onChange={(e) => setVrdMmu(e.target.value === '' ? '' : Number(e.target.value))}
                    className="h-8 text-xs bg-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">VRD MMP (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={vrdMmp}
                    onChange={(e) => setVrdMmp(e.target.value === '' ? '' : Number(e.target.value))}
                    className="h-8 text-xs bg-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">VRD LC (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={vrdLc}
                    onChange={(e) => setVrdLc(e.target.value === '' ? '' : Number(e.target.value))}
                    className="h-8 text-xs bg-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Base da LC</Label>
                  <select
                    value={vrdLcBase}
                    onChange={(e) => setVrdLcBase(e.target.value)}
                    className="w-full h-8 rounded border border-gray-300 bg-white px-2 text-xs"
                  >
                    <option value="Lucro Bruto">Lucro Bruto</option>
                    <option value="Despesas Fixas">Despesas Fixas</option>
                    <option value="Lucro Líquido (LL)">Lucro Líquido (LL)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Bloco 2: Cláusulas e Exclusões */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-700">
                  Cláusulas e Condições Comerciais
                </Label>
                <textarea
                  placeholder="Cláusula de rateio mitigada em 80%, prazo de pagamento em 4x sem juros..."
                  value={clausulas}
                  onChange={(e) => setClausulas(e.target.value)}
                  className="w-full h-14 p-2 rounded-md border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-[#16578B] bg-white"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-700">
                  Exclusões / Ressalvas da Cia
                </Label>
                <textarea
                  placeholder="Ex: Exclusão de alagamento por transbordamento de lago artificial..."
                  value={exclusoes}
                  onChange={(e) => setExclusoes(e.target.value)}
                  className="w-full h-14 p-2 rounded-md border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-[#16578B] bg-white"
                />
              </div>
            </div>

            {/* Bloco 3: Quadro de Coberturas Gravadas / Editáveis */}
            <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Quadro de Coberturas da Proposta ({coberturasModal.length} itens)</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 hidden sm:inline">
                    Alimenta a Tabulação C3 e Ficha Técnica
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAddCobForm(!showAddCobForm)
                      setDeletingCobIndex(null)
                      setEditingCobIndex(null)
                    }}
                    className="h-6 text-[10px] px-2 text-[#16578B] border-blue-200 hover:bg-blue-50"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    <span>Adicionar cobertura</span>
                  </Button>
                </div>
              </div>

              {/* Form de Inclusão de Cobertura */}
              {showAddCobForm && (
                <div className="p-3 bg-white border border-blue-200 rounded-lg space-y-2 shadow-sm animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-[#0F2B46] flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5 text-[#16578B]" />
                      <span>Nova Cobertura Manual</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddCobForm(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="sm:col-span-2 space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Nome da Cobertura</Label>
                      <Input
                        type="text"
                        placeholder="Ex: Alagamento e Inundação"
                        value={newCobNome}
                        onChange={(e) => {
                          const val = e.target.value
                          setNewCobNome(val)
                          const autoCat = matchCanonicalCategory(val)
                          if (autoCat && CATEGORIAS_48.includes(autoCat as any)) {
                            setNewCobCategoria(autoCat)
                          }
                        }}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Categoria Canônica</Label>
                      <select
                        value={newCobCategoria}
                        onChange={(e) => setNewCobCategoria(e.target.value)}
                        className="w-full h-7 rounded border border-gray-300 bg-white px-2 text-xs"
                      >
                        {CATEGORIAS_48.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-gray-600">LMI / IS (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={newCobLmi}
                        onChange={(e) => setNewCobLmi(e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Prêmio (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={newCobPremio}
                        onChange={(e) => setNewCobPremio(e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Franquia / P.O.S.</Label>
                      <Input
                        type="text"
                        placeholder="Ex: 10% min R$ 5.000"
                        value={newCobFranquia}
                        onChange={(e) => setNewCobFranquia(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-1.5 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddCobForm(false)}
                      className="h-6 text-[10px] px-2 text-gray-600"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddNewCob}
                      className="h-6 text-[10px] px-2.5 bg-[#0F2B46] text-white hover:bg-[#1B3C5D]"
                    >
                      Incluir no Quadro
                    </Button>
                  </div>
                </div>
              )}

              {coberturasModal.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400 bg-white border border-gray-200 rounded-lg">
                  Nenhuma cobertura cadastrada nesta proposta. Clique em "Adicionar cobertura" para
                  inserir.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-gray-50 border-b text-gray-600 font-semibold sticky top-0 z-10">
                      <tr>
                        <th className="py-1.5 px-3">Cobertura</th>
                        <th className="py-1.5 px-2">Classificação</th>
                        <th className="py-1.5 px-2 text-right">LMI / IS</th>
                        <th className="py-1.5 px-2 text-right">Prêmio</th>
                        <th className="py-1.5 px-3">Franquia / P.O.S.</th>
                        <th className="py-1.5 px-2 text-right w-20">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const firstBasicaIndex = coberturasModal.findIndex((c) =>
                          isCoberturaBasica({
                            nome: c.cobertura,
                            categoriaNormalizada: c.categoriaNormalizada,
                          }),
                        )

                        return coberturasModal.map((c, i) => {
                          const isBasica = i === firstBasicaIndex
                          const isLc =
                            !isBasica &&
                            isCoberturaLucrosCessantes({
                              nome: c.cobertura,
                              categoriaNormalizada: c.categoriaNormalizada,
                            })
                          const isEditing = editingCobIndex === i
                          const isDeleting = deletingCobIndex === i

                          if (isEditing) {
                            return (
                              <tr key={i} className="bg-blue-50/60">
                                <td colSpan={6} className="p-2.5 space-y-2">
                                  <div className="flex items-center justify-between pb-1 border-b border-blue-200 text-xs font-semibold text-[#0F2B46]">
                                    <span>Editar Linha de Cobertura #{i + 1}</span>
                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={saveEditingCob}
                                        className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1"
                                      >
                                        <Check className="w-3 h-3" />
                                        <span>Salvar Linha</span>
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={cancelEditingCob}
                                        className="h-6 text-[10px] px-2 text-gray-600"
                                      >
                                        Cancelar
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                    <div className="sm:col-span-2 space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">Nome</Label>
                                      <Input
                                        type="text"
                                        value={editCobNome}
                                        onChange={(e) => setEditCobNome(e.target.value)}
                                        className="h-7 text-xs bg-white"
                                      />
                                    </div>
                                    <div className="sm:col-span-2 space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        Categoria Canônica
                                      </Label>
                                      <select
                                        value={editCobCategoria}
                                        onChange={(e) => setEditCobCategoria(e.target.value)}
                                        className="w-full h-7 rounded border border-gray-300 bg-white px-2 text-xs"
                                      >
                                        {CATEGORIAS_48.map((cat) => (
                                          <option key={cat} value={cat}>
                                            {cat}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        LMI / IS (R$)
                                      </Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={editCobLmi}
                                        onChange={(e) => setEditCobLmi(e.target.value)}
                                        className="h-7 text-xs font-mono bg-white"
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        Prêmio (R$)
                                      </Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={editCobPremio}
                                        onChange={(e) => setEditCobPremio(e.target.value)}
                                        className="h-7 text-xs font-mono bg-white"
                                      />
                                    </div>
                                    <div className="sm:col-span-2 space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        Franquia / P.O.S.
                                      </Label>
                                      <Input
                                        type="text"
                                        value={editCobFranquia}
                                        onChange={(e) => setEditCobFranquia(e.target.value)}
                                        className="h-7 text-xs bg-white"
                                      />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                          }

                          return (
                            <tr
                              key={i}
                              className={`hover:bg-gray-50/70 transition-colors ${
                                isDeleting
                                  ? 'bg-rose-50/60'
                                  : isBasica
                                    ? 'bg-blue-50/40 font-semibold'
                                    : isLc
                                      ? 'bg-amber-50/30'
                                      : ''
                              }`}
                            >
                              <td className="py-1.5 px-3 font-medium text-gray-900">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span>{c.cobertura}</span>
                                  {isBasica && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wide bg-blue-100 text-[#16578B] border border-blue-300">
                                      ★ Básica
                                    </span>
                                  )}
                                  {isLc && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-100 text-amber-900 border border-amber-300">
                                      Lucros Cessantes
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-gray-500 text-[10px]">
                                {c.categoriaNormalizada}
                              </td>
                              <td className="py-1.5 px-2 text-right text-gray-800 font-mono">
                                {c.lmi !== null && c.lmi !== undefined
                                  ? formatCurrency(c.lmi)
                                  : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right text-emerald-800 font-mono">
                                {c.premioLiquido !== null && c.premioLiquido !== undefined
                                  ? formatCurrency(c.premioLiquido)
                                  : '—'}
                              </td>
                              <td
                                className="py-1.5 px-3 text-gray-600 text-[10px] truncate max-w-[150px]"
                                title={c.franquia}
                              >
                                {c.franquia || 'Conforme apólice'}
                              </td>
                              <td className="py-1.5 px-2 text-right whitespace-nowrap">
                                {isDeleting ? (
                                  <div className="inline-flex items-center gap-1 bg-white border border-rose-300 rounded px-1.5 py-0.5 shadow-sm">
                                    <span className="text-[10px] text-rose-700 font-semibold">
                                      Excluir?
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => confirmDeleteCob(i)}
                                      className="text-rose-700 hover:text-rose-900 font-bold px-1 text-[10px] underline"
                                      title="Confirmar exclusão desta cobertura"
                                    >
                                      Sim
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeletingCobIndex(null)}
                                      className="text-gray-500 hover:text-gray-700 px-1 text-[10px]"
                                      title="Cancelar exclusão"
                                    >
                                      Não
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => startEditingCob(i)}
                                      className="p-1 text-gray-500 hover:text-[#16578B] hover:bg-blue-50 rounded transition-colors"
                                      title="Editar nome, LMI, prêmio e franquia desta linha"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeletingCobIndex(i)
                                        setEditingCobIndex(null)
                                      }}
                                      className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                      title="Excluir esta cobertura do quadro"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-2.5 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                As alterações realizadas nas coberturas e valores serão salvas na proposta no banco
                e refletidas diretamente na <strong>Tabulação C3</strong> e comparativos de taxas.
              </span>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPropModalOpen(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={savingProp}
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 font-semibold"
              >
                {savingProp ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <span>Salvar Proposta e Coberturas</span>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: UPLOAD DE PROPOSTA COM EXTRAÇÃO */}
      <PropostaUploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        rfqId={rfqId}
        rfqNumero={rfqNumero}
        seguradorasDisponiveis={seguradorasDisponiveis}
        initialSeguradoraId={uploadTargetSeg?.id}
        initialSeguradoraNome={uploadTargetSeg?.nome}
        onSuccess={({ propostaId, rfqSeguradora, seguradoraNome, autoCadastrada }) => {
          setFeedback(
            `Proposta de ${seguradoraNome} registrada com sucesso! ${
              autoCadastrada ? '✨ Nova seguradora auto-cadastrada no Mapa de Mercado.' : ''
            }`,
          )
          setTimeout(() => setFeedback(null), 5000)
          loadData()
          onDataChange?.()
        }}
      />

      {/* MODAL: MARCAR DECLÍNIO */}
      <Dialog open={declinioModalOpen} onOpenChange={setDeclinioModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2 text-rose-700">
              <XCircle className="w-5 h-5 text-rose-600" />
              <span>Marcar Declínio — {declinioSeg?.nome}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Registre a recusa da seguradora em cotar o edital. O motivo fica gravado no RFQ e
              alimenta o Mapa de Mercado para histórico de subscrição e apetite.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSalvarDeclinio} className="space-y-3.5 pt-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-gray-700">Motivo do Declínio</Label>
              <select
                value={motivoDeclinio}
                onChange={(e) => setMotivoDeclinio(e.target.value)}
                className="w-full h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs"
              >
                <option value="Sem apetite para o segmento">
                  Sem apetite para o segmento (Hotéis / Resorts)
                </option>
                <option value="Capacidade / LMI insuficiente">
                  Capacidade / LMI insuficiente para o risco
                </option>
                <option value="Histórico de sinistralidade desfavorável">
                  Histórico de sinistralidade desfavorável
                </option>
                <option value="Falta de proteções exigidas">
                  Falta de proteções exigidas (sprinklers / hidrantes)
                </option>
                <option value="Localização em zona de risco agravado">
                  Localização em zona de risco agravado (alagamento / vendaval)
                </option>
                <option value="Prazo de SLA exaurido sem resposta">
                  Prazo de SLA exaurido sem resposta da mesa de subscrição
                </option>
                <option value="Outro">Outro motivo...</option>
              </select>
            </div>

            {motivoDeclinio === 'Outro' && (
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-700">Descreva o motivo</Label>
                <Input
                  type="text"
                  placeholder="Ex: Exigência de vistoria prévia não viável no prazo do cliente"
                  value={motivoCustom}
                  onChange={(e) => setMotivoCustom(e.target.value)}
                  className="h-8 text-xs"
                  required
                />
              </div>
            )}

            <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              <strong>Impacto no Mapa de Mercado:</strong> O declínio será persistido com timestamp
              e motivo no histórico de relacionamento da seguradora, permitindo refinar futuras
              rodadas de cotação da corretora BYCOR.
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeclinioModalOpen(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={savingDeclinio}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs h-8 font-semibold"
              >
                {savingDeclinio ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    <span>Registrando...</span>
                  </>
                ) : (
                  <span>Confirmar Declínio</span>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
