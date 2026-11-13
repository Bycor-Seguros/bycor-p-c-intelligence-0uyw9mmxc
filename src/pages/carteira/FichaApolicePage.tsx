import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Shield,
  FileText,
  Clock,
  Layers,
  AlertCircle,
  Plus,
  Trash2,
  Edit2,
  Download,
  Mail,
  Share2,
  FileCheck,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  Loader2,
  Check,
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
import {
  formatCurrency,
  formatCurrencyNumber,
  parseCurrencyValue,
  formatDate,
  formatCnpj,
  getStatusBadgeInfo,
} from '@/lib/formatters'
import {
  ApoliceMinima,
  buildMapaSucessao,
  RelacaoSucessao,
  getStatusDerivadoBadgeInfo,
  getHojeMs,
} from '@/services/apoliceStatusService'

interface ApoliceDetail {
  id: string
  id_apolice: string
  id_empreendimento: string
  segurado_na_apolice: string
  cnpj_segurado: string
  seguradora: string
  numero_apolice: string
  ramo: string
  corretor: string
  data_inicio: string
  data_fim: string
  premio_liquido: number
  premio_total: number
  valor_em_risco_dm: number
  valor_em_risco_lc: number
  lmga: number
  lmi_incendio_basica: number
  razao_lmi_vr_dm: number
  status: string
  status_manual?: 'Perdida' | 'Em Emissão' | string | null
  renovada_em?: string | null
  apolice_sucessora?: string | null
  comissao: number
  iof: number
  endossos: string
  expand?: {
    id_empreendimento?: {
      id: string
      id_empreendimento: string
      nome_empreendimento: string
      razao_social: string
      cnpj: string
      endereco: string
      cidade: string
      uf: string
      area_construida_m2: number
      num_unidades: number
      tipo_construcao: string
    }
    apolice_sucessora?: {
      id: string
      id_apolice?: string
      numero_apolice?: string
      seguradora?: string
      data_inicio?: string
      data_fim?: string
    }
  }
}

interface CoberturaItem {
  id: string
  nome_cobertura: string
  categoria_normalizada: string
  lmi_rs: number
  franquia_pos: string
  premio_cobertura: number
}

interface SinistroItem {
  id: string
  origem_periodo: string
  data_sinistro: string
  numero_sinistro: string
  cobertura_acionada: string
  descricao: string
  valor_indenizado_rs: number
  status: string
}

interface HistoricoItem {
  id: string
  data: string
  cia: string
  texto: string
  assunto?: string
  categoria?: string
  data_fato?: string
  empreendimento?: string
  apolice?: string
  registro_id?: string
  tabela?: string
  autor?: string
  created?: string
  expand?: {
    apolice?: {
      id: string
      numero_apolice?: string
      data_inicio?: string
      data_fim?: string
      seguradora?: string
    }
  }
}

// Pró-Memória do cliente: categorias e cores da linha do tempo
const CATEGORIAS_HIST = [
  'Negociação',
  'Sinistro',
  'Endosso',
  'Renovação',
  'Decisão de Cobertura',
] as const

const CORES_CATEGORIA_HIST: Record<string, { badge: string; dot: string }> = {
  Negociação: { badge: 'bg-blue-50 text-[#16578B] border-blue-200', dot: 'bg-[#16578B]' },
  Sinistro: { badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  Endosso: { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  Renovação: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  'Decisão de Cobertura': {
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
    dot: 'bg-violet-500',
  },
}

// Rótulo de ciclo (vigência) + nº da apólice, ex.: "Ciclo 2026/27 · 02852.2026..."
function cicloLabelApolice(
  a?: {
    data_inicio?: string
    data_fim?: string
    numero_apolice?: string
  } | null,
): string {
  const y1 = a?.data_inicio?.slice(0, 4) || ''
  const y2 = a?.data_fim?.slice(0, 4) || ''
  const ciclo = y1 && y2 ? (y1 === y2 ? `Ciclo ${y1}` : `Ciclo ${y1}/${y2.slice(2)}`) : ''
  const num = (a?.numero_apolice || '').replace(/^Nº da apólice\s*:?\s*/i, '').trim()
  return [ciclo, num].filter(Boolean).join(' · ')
}

interface DocumentoItem {
  id: string
  tipo: string
  arquivo: string
  versao: string
  data: string
}

export default function FichaApolicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [apolice, setApolice] = useState<ApoliceDetail | null>(null)
  const [coberturas, setCoberturas] = useState<CoberturaItem[]>([])
  const [sinistros, setSinistros] = useState<SinistroItem[]>([])
  const [historicoList, setHistoricoList] = useState<HistoricoItem[]>([])
  const [documentos, setDocumentos] = useState<DocumentoItem[]>([])
  const [activeTab, setActiveTab] = useState<
    'dados' | 'documentos' | 'historico' | 'coberturas' | 'sinistros'
  >('dados')
  const [loading, setLoading] = useState(true)
  const [relacaoSucessao, setRelacaoSucessao] = useState<RelacaoSucessao | null>(null)
  const [savingStatusManual, setSavingStatusManual] = useState(false)

  // Edição inline de franquia_pos e premio_cobertura
  const [editingCobId, setEditingCobId] = useState<string | null>(null)
  const [inlineFranquia, setInlineFranquia] = useState<string>('')
  const [inlinePremio, setInlinePremio] = useState<string>('')
  const [savingCobInline, setSavingCobInline] = useState(false)

  // Exclusão de cobertura individual e remoção de duplicadas em lote
  const [cobToDelete, setCobToDelete] = useState<CoberturaItem | null>(null)
  const [deletingCob, setDeletingCob] = useState(false)
  const [dedupDialogOpen, setDedupDialogOpen] = useState(false)
  const [removingDuplicates, setRemovingDuplicates] = useState(false)

  // Renovation cycle modal
  const [renovacaoModalOpen, setRenovacaoModalOpen] = useState(false)

  // Pró-Memória do cliente (linha do tempo contínua por empreendimento)
  const [newHistAssunto, setNewHistAssunto] = useState('')
  const [newHistCategoria, setNewHistCategoria] = useState<string>('Negociação')
  const [newHistData, setNewHistData] = useState(new Date().toISOString().slice(0, 10))
  const [newHistTexto, setNewHistTexto] = useState('')
  const [addingHist, setAddingHist] = useState(false)
  const [filtroHistCategoria, setFiltroHistCategoria] = useState('')
  const [filtroHistAno, setFiltroHistAno] = useState('')

  // Document upload
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [docTipo, setDocTipo] = useState('Cartão de Risco')
  const [docVersao, setDocVersao] = useState('v1.0')
  const [docFile, setDocFile] = useState<File | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  const fetchApoliceFull = async () => {
    if (!id) return
    try {
      setLoading(true)
      const ap = await pb.collection('apolices').getOne<ApoliceDetail>(id, {
        expand: 'id_empreendimento,apolice_sucessora',
      })
      setApolice(ap)

      // Fetch all policies for this empreendimento or CNPJ to build succession tree
      const empId = ap.id_empreendimento
      const cnpj = ap.cnpj_segurado
      let filterExp = ''
      if (empId && cnpj) {
        filterExp = `id_empreendimento="${empId}" || cnpj_segurado="${cnpj}"`
      } else if (empId) {
        filterExp = `id_empreendimento="${empId}"`
      } else if (cnpj) {
        filterExp = `cnpj_segurado="${cnpj}"`
      }

      const allSisterApolices = await pb.collection('apolices').getFullList<ApoliceMinima>({
        filter: filterExp || undefined,
        expand: 'id_empreendimento',
      })

      // Include current apolice if not present
      if (!allSisterApolices.some((x) => x.id === ap.id)) {
        allSisterApolices.push(ap)
      }

      const mapa = buildMapaSucessao(allSisterApolices)
      const rel = mapa.get(ap.id)
      if (rel) {
        setRelacaoSucessao(rel)
      }

      // Fetch coberturas
      const cobs = await pb.collection('coberturas').getFullList<CoberturaItem>({
        filter: `id_apolice="${id}"`,
        sort: 'categoria_normalizada',
      })
      setCoberturas(cobs)

      // Fetch sinistros (by empreendimento or apolice)
      const sins = await pb.collection('sinistros').getFullList<SinistroItem>({
        filter: `id_apolice="${id}" || id_empreendimento="${ap.id_empreendimento}"`,
        sort: '-data_sinistro',
      })
      setSinistros(sins)

      // Pró-Memória do cliente: linha do tempo completa do EMPREENDIMENTO
      // (todas as apólices/ciclos), não apenas desta apólice.
      const histFilter = ap.id_empreendimento
        ? `empreendimento="${ap.id_empreendimento}"`
        : `registro_id="${id}" && tabela="apolices"`
      const hists = await pb.collection('historico').getFullList<HistoricoItem>({
        filter: histFilter,
        sort: '-data_fato,-created',
        expand: 'apolice',
      })
      setHistoricoList(hists)

      // Fetch linked documents
      const docs = await pb.collection('documentos').getFullList<DocumentoItem>({
        filter: `vinculado_apolice="${id}" || vinculado_empreendimento="${ap.id_empreendimento}"`,
        sort: '-data',
      })
      setDocumentos(docs)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApoliceFull()
  }, [id])

  // Save new history row (Pró-Memória: ancorado no empreendimento)
  const handleAddHistorico = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apolice || !newHistAssunto.trim() || !newHistTexto.trim()) return

    try {
      setAddingHist(true)
      const payload = {
        registro_id: apolice.id,
        tabela: 'apolices',
        empreendimento: apolice.id_empreendimento,
        apolice: apolice.id,
        assunto: newHistAssunto.trim(),
        categoria: newHistCategoria,
        data_fato: `${newHistData} 00:00:00.000Z`,
        data: newHistData,
        cia: apolice.seguradora,
        texto: newHistTexto.trim(),
        autor: user?.id,
        timestamp: new Date().toISOString(),
      }
      await pb.collection('historico').create(payload)
      setNewHistAssunto('')
      setNewHistTexto('')
      setNewHistData(new Date().toISOString().slice(0, 10))
      setNewHistCategoria('Negociação')
      fetchApoliceFull()
    } catch (err: unknown) {
      alert('Erro ao salvar histórico: ' + (err as Error).message)
    } finally {
      setAddingHist(false)
    }
  }

  // Atualizar status manual ("Perdida", "Em Emissão" ou reverter para null)
  const handleSetStatusManual = async (novoStatus: 'Perdida' | 'Em Emissão' | null) => {
    if (!apolice) return
    try {
      setSavingStatusManual(true)
      await pb.collection('apolices').update(apolice.id, {
        status_manual: novoStatus || '',
      })
      await fetchApoliceFull()
    } catch (err: unknown) {
      alert('Erro ao atualizar classificação da apólice: ' + (err as Error).message)
    } finally {
      setSavingStatusManual(false)
    }
  }

  // Estado para exclusão com diálogo de confirmação
  const [docToDelete, setDocToDelete] = useState<DocumentoItem | null>(null)
  const [deletingDoc, setDeletingDoc] = useState(false)

  // Confirmar e excluir documento e arquivo vinculado
  const handleConfirmDeleteDocumento = async () => {
    if (!docToDelete) return
    try {
      setDeletingDoc(true)
      await pb.collection('documentos').delete(docToDelete.id)
      setDocumentos((prev) => prev.filter((d) => d.id !== docToDelete.id))
      setDocToDelete(null)
    } catch (err: unknown) {
      alert('Erro ao excluir documento: ' + (err as Error).message)
    } finally {
      setDeletingDoc(false)
    }
  }

  // Delete history row
  const handleDeleteHistorico = async (histId: string) => {
    if (!confirm('Deseja excluir este registro da Pró-Memória?')) return
    try {
      await pb.collection('historico').delete(histId)
      fetchApoliceFull()
    } catch (err: unknown) {
      alert('Erro ao excluir: ' + (err as Error).message)
    }
  }

  // Identificar duplicadas em coberturas
  const getDuplicateCoverageGroups = () => {
    const groups = new Map<string, CoberturaItem[]>()
    for (const cob of coberturas) {
      const key = `${(cob.nome_cobertura || '').trim().toLowerCase()}|${Number(cob.lmi_rs || 0)}`
      const list = groups.get(key) || []
      list.push(cob)
      groups.set(key, list)
    }
    const duplicateList: Array<{ key: string; name: string; lmi: number; items: CoberturaItem[] }> =
      []
    groups.forEach((items, key) => {
      if (items.length > 1) {
        duplicateList.push({
          key,
          name: items[0].nome_cobertura,
          lmi: items[0].lmi_rs,
          items,
        })
      }
    })
    return duplicateList
  }

  // ---- Pró-Memória: filtros por categoria e por ano ----
  const anosDisponiveisHist = Array.from(
    new Set(
      historicoList
        .map((h) => (h.data_fato || h.data || '').slice(0, 4))
        .filter((y) => y.length === 4),
    ),
  ).sort((a, b) => b.localeCompare(a))

  const historicoFiltrado = historicoList.filter((h) => {
    const dFato = (h.data_fato || h.data || '').slice(0, 10)
    if (filtroHistCategoria && (h.categoria || '') !== filtroHistCategoria) return false
    if (filtroHistAno && dFato.slice(0, 4) !== filtroHistAno) return false
    return true
  })

  const duplicateGroups = getDuplicateCoverageGroups()
  const totalDuplicateRecordsToRemove = duplicateGroups.reduce(
    (acc, grp) => acc + (grp.items.length - 1),
    0,
  )

  // Confirmar exclusão de cobertura individual
  const handleConfirmDeleteCobertura = async () => {
    if (!cobToDelete) return
    try {
      setDeletingCob(true)
      await pb.collection('coberturas').delete(cobToDelete.id)
      setCoberturas((prev) => prev.filter((c) => c.id !== cobToDelete.id))
      setCobToDelete(null)
    } catch (err: unknown) {
      alert('Erro ao excluir cobertura: ' + (err as Error).message)
    } finally {
      setDeletingCob(false)
    }
  }

  // Remover todas as duplicadas da apólice mantendo a primeira ocorrência
  const handleConfirmRemoveDuplicates = async () => {
    try {
      setRemovingDuplicates(true)
      const idsToDelete: string[] = []
      duplicateGroups.forEach((grp) => {
        // Mantém grp.items[0], apaga o restante
        for (let i = 1; i < grp.items.length; i++) {
          idsToDelete.push(grp.items[i].id)
        }
      })

      for (const idToDel of idsToDelete) {
        await pb.collection('coberturas').delete(idToDel)
      }

      setCoberturas((prev) => prev.filter((c) => !idsToDelete.includes(c.id)))
      setDedupDialogOpen(false)
    } catch (err: unknown) {
      alert('Erro ao remover coberturas duplicadas: ' + (err as Error).message)
    } finally {
      setRemovingDuplicates(false)
    }
  }

  // Salvar edição inline de cobertura (franquia_pos e premio_cobertura)
  const handleStartEditCob = (cob: CoberturaItem) => {
    setEditingCobId(cob.id)
    setInlineFranquia(cob.franquia_pos || '')
    setInlinePremio(
      cob.premio_cobertura !== null && cob.premio_cobertura !== undefined
        ? formatCurrencyNumber(cob.premio_cobertura)
        : '',
    )
  }

  const handleCancelEditCob = () => {
    setEditingCobId(null)
    setInlineFranquia('')
    setInlinePremio('')
  }

  const handleSaveEditCob = async (cobId: string) => {
    try {
      setSavingCobInline(true)
      const parsedPremio = parseCurrencyValue(inlinePremio) ?? 0
      await pb.collection('coberturas').update(cobId, {
        franquia_pos: inlineFranquia.trim(),
        premio_cobertura: parsedPremio,
      })

      setCoberturas((prev) =>
        prev.map((c) =>
          c.id === cobId
            ? {
                ...c,
                franquia_pos: inlineFranquia.trim(),
                premio_cobertura: parsedPremio,
              }
            : c,
        ),
      )
      setEditingCobId(null)
    } catch (err: unknown) {
      alert('Erro ao atualizar cobertura: ' + (err as Error).message)
    } finally {
      setSavingCobInline(false)
    }
  }

  // Upload document
  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!docFile || !apolice) return

    try {
      setUploadingDoc(true)
      const formData = new FormData()
      formData.append('arquivo', docFile)
      formData.append('tipo', docTipo)
      formData.append('versao', docVersao)
      formData.append('data', new Date().toISOString().slice(0, 10))
      formData.append('vinculado_apolice', apolice.id)
      if (apolice.id_empreendimento) {
        formData.append('vinculado_empreendimento', apolice.id_empreendimento)
      }

      await pb.collection('documentos').create(formData)
      setUploadModalOpen(false)
      setDocFile(null)
      fetchApoliceFull()
    } catch (err: unknown) {
      alert('Erro ao enviar arquivo: ' + (err as Error).message)
    } finally {
      setUploadingDoc(false)
    }
  }

  if (loading) {
    return (
      <div className="py-24 text-center text-xs text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#16578B] mb-2" />
        <p>Carregando dados da apólice...</p>
      </div>
    )
  }

  if (!apolice) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-gray-200">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
        <h3 className="text-base font-bold text-gray-800">Apólice não encontrada</h3>
        <p className="text-xs text-gray-500 mt-1">
          O registro solicitado não existe ou foi removido.
        </p>
        <Link to="/carteira" className="inline-block mt-4">
          <Button variant="outline" className="text-xs">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar para a Carteira
          </Button>
        </Link>
      </div>
    )
  }

  const statusEfetivo = relacaoSucessao?.statusDerivado || apolice.status
  const badge = getStatusDerivadoBadgeInfo(statusEfetivo)
  const razao = apolice.razao_lmi_vr_dm
  const fimMs = apolice.data_fim
    ? new Date(apolice.data_fim.slice(0, 10) + 'T00:00:00').getTime()
    : null
  const hojeMs = getHojeMs()
  const isVencidaPelaData = fimMs !== null && fimMs < hojeMs
  const semSucessora = isVencidaPelaData && !relacaoSucessao?.sucessora

  // Mailto builder for Renovation cycle
  const mailSubject = encodeURIComponent(
    `Renovação de Seguro P&C — ${apolice.segurado_na_apolice} — ${apolice.ramo}`,
  )
  const mailBody = encodeURIComponent(
    `Prezados,\n\nIniciamos o ciclo de renovação da apólice ${apolice.numero_apolice || apolice.id_apolice} (${apolice.seguradora}), com vigência até ${formatDate(apolice.data_fim)}.\n\nSegurado: ${apolice.segurado_na_apolice}\nCNPJ: ${apolice.cnpj_segurado || '—'}\nPrêmio Atual: ${formatCurrency(apolice.premio_total)}\n\nHistórico operacional recente:\n` +
      historicoList.map((h) => `- ${formatDate(h.data)} [${h.cia}]: ${h.texto}`).join('\n') +
      `\n\nDocumentos vinculados no sistema Bycor:\n` +
      documentos.map((d) => `- ${d.tipo} (${d.versao}) - ${d.arquivo}`).join('\n') +
      `\n\nAtenciosamente,\nBycor Consultoria e Corretora de Seguros`,
  )

  return (
    <div className="space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          to="/carteira"
          className="inline-flex items-center text-xs font-semibold text-gray-600 hover:text-gray-900 gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Portfólio</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            to={`/auditoria-cartao-apolice?emp=${apolice.id_empreendimento}&rodada=`}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-blue-200 bg-blue-50/80 text-[#16578B] hover:bg-blue-100 text-xs font-semibold transition-colors"
          >
            <FileCheck className="w-4 h-4 text-[#16578B]" />
            <span>Auditoria Cartão × Apólice</span>
          </Link>

          <Button
            onClick={() => setRenovacaoModalOpen(true)}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 shadow-sm flex items-center gap-2"
          >
            <Share2 className="w-4 h-4 text-blue-300" />
            <span>Iniciar Ciclo de Renovação</span>
          </Button>
        </div>
      </div>

      {/* Main Header Card */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#0F2B46] to-[#16578B] text-white flex items-center justify-center font-bold text-lg shadow-md shrink-0">
              {apolice.seguradora ? apolice.seguradora.slice(0, 2).toUpperCase() : 'BY'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                  {apolice.expand?.id_empreendimento?.nome_empreendimento ||
                    apolice.segurado_na_apolice}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badge.bg}`}
                >
                  {badge.label.toUpperCase()}
                </span>
              </div>

              {/* Relação de Sucessão / Antecessão e Evento de Renovação Estruturado */}
              {(relacaoSucessao?.sucessora || apolice.apolice_sucessora || apolice.renovada_em) && (
                <div className="mt-1 text-xs text-[#16578B] flex flex-wrap items-center gap-1.5 font-medium">
                  <ArrowRight className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Sucedida pela apólice</span>
                  <Link
                    to={`/carteira/apolice/${
                      relacaoSucessao?.sucessora?.id ||
                      apolice.expand?.apolice_sucessora?.id ||
                      apolice.apolice_sucessora
                    }`}
                    className="font-bold underline hover:text-[#0F2B46]"
                  >
                    {relacaoSucessao?.sucessora?.numero_apolice ||
                      apolice.expand?.apolice_sucessora?.numero_apolice ||
                      relacaoSucessao?.sucessora?.id_apolice ||
                      apolice.expand?.apolice_sucessora?.id_apolice ||
                      'Ficha da Sucessora'}
                  </Link>
                  {(relacaoSucessao?.sucessora?.data_inicio ||
                    apolice.expand?.apolice_sucessora?.data_inicio) && (
                    <span className="text-[11px] text-gray-400">
                      (Vigência:{' '}
                      {formatDate(
                        relacaoSucessao?.sucessora?.data_inicio ||
                          apolice.expand?.apolice_sucessora?.data_inicio,
                      )}{' '}
                      até{' '}
                      {formatDate(
                        relacaoSucessao?.sucessora?.data_fim ||
                          apolice.expand?.apolice_sucessora?.data_fim,
                      )}
                      )
                    </span>
                  )}
                  {apolice.renovada_em && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-[#1E40AF]">
                      Renovada em: {formatDate(apolice.renovada_em)}
                    </span>
                  )}
                </div>
              )}

              {relacaoSucessao?.antecessora && (
                <div className="mt-1 text-xs text-gray-600 flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span>Renova a apólice</span>
                  <Link
                    to={`/carteira/apolice/${relacaoSucessao.antecessora.id}`}
                    className="font-bold underline text-[#16578B] hover:text-[#0F2B46]"
                  >
                    {relacaoSucessao.antecessora.numero_apolice ||
                      relacaoSucessao.antecessora.id_apolice ||
                      'Ficha da Anterior'}
                  </Link>
                  <span className="text-[11px] text-gray-400">
                    ({formatDate(relacaoSucessao.antecessora.data_inicio)} até{' '}
                    {formatDate(relacaoSucessao.antecessora.data_fim)})
                  </span>
                </div>
              )}

              {/* Ações de classificação manual para apólice vencida sem sucessora */}
              {semSucessora && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
                  <span className="text-[11px] text-gray-500 font-semibold">
                    Classificar apólice vencida sem sucessora:
                  </span>
                  <Button
                    size="sm"
                    variant={statusEfetivo === 'PERDIDA' ? 'default' : 'outline'}
                    disabled={savingStatusManual}
                    onClick={() =>
                      handleSetStatusManual(statusEfetivo === 'PERDIDA' ? null : 'Perdida')
                    }
                    className={`h-6 text-[11px] px-2.5 ${
                      statusEfetivo === 'PERDIDA'
                        ? 'bg-gray-700 hover:bg-gray-800 text-white'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {statusEfetivo === 'PERDIDA'
                      ? '✓ Perdida (Cliente saiu)'
                      : 'Marcar como Perdida'}
                  </Button>
                  <Button
                    size="sm"
                    variant={statusEfetivo === 'EM EMISSÃO' ? 'default' : 'outline'}
                    disabled={savingStatusManual}
                    onClick={() =>
                      handleSetStatusManual(statusEfetivo === 'EM EMISSÃO' ? null : 'Em Emissão')
                    }
                    className={`h-6 text-[11px] px-2.5 ${
                      statusEfetivo === 'EM EMISSÃO'
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'border-blue-200 text-blue-700 hover:bg-blue-50'
                    }`}
                  >
                    {statusEfetivo === 'EM EMISSÃO'
                      ? '✓ Em Emissão (Renovação em andamento)'
                      : 'Marcar como Em Emissão'}
                  </Button>
                  {(statusEfetivo === 'PERDIDA' || statusEfetivo === 'EM EMISSÃO') && (
                    <button
                      type="button"
                      disabled={savingStatusManual}
                      onClick={() => handleSetStatusManual(null)}
                      className="text-[10px] text-gray-400 hover:text-red-600 underline ml-1"
                    >
                      Reverter para Vencida
                    </button>
                  )}
                </div>
              )}

              <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <strong>CNPJ:</strong> {formatCnpj(apolice.cnpj_segurado)}
                </span>
                <span>•</span>
                <span>
                  <strong>Seguradora:</strong> {apolice.seguradora}
                </span>
                <span>•</span>
                <span>
                  <strong>Nº Apólice:</strong> {apolice.numero_apolice || apolice.id_apolice}
                </span>
                <span>•</span>
                <span>
                  <strong>Ramo:</strong> {apolice.ramo}
                </span>
              </div>
            </div>
          </div>

          <div className="text-right flex flex-col md:items-end">
            <div className="text-xs text-gray-400 font-medium">Vigência contratual</div>
            <div className="text-sm font-bold text-gray-800">
              {formatDate(apolice.data_inicio)} até {formatDate(apolice.data_fim)}
            </div>
            <div className="text-xs text-[#16578B] font-semibold mt-1">
              Prêmio Total: {formatCurrency(apolice.premio_total)}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#E4E9F0] mt-6 gap-6 text-xs font-semibold">
          {[
            { id: 'dados', label: 'Dados & Subseguro' },
            { id: 'documentos', label: `Documentos (${documentos.length})` },
            { id: 'historico', label: `Pró-Memória do Cliente (${historicoList.length})` },
            { id: 'coberturas', label: `Coberturas (${coberturas.length})` },
            { id: 'sinistros', label: `Sinistros (${sinistros.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 transition-colors relative ${
                activeTab === tab.id
                  ? 'text-[#0F2B46] border-b-2 border-[#16578B] font-bold'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}

      {/* 1. DADOS & SUBSEGURO GAUGE */}
      {activeTab === 'dados' && (
        <div className="space-y-6">
          {/* Subseguro Gauge Alert */}
          <div
            className={`p-5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
              razao !== undefined && razao !== null && razao < 0.8
                ? 'bg-red-50 border-red-200 text-red-900'
                : razao !== undefined && razao !== null && razao < 1.0
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-bold">
                  Indicador de Subseguro (Razão LMI Incêndio Básica ÷ Valor em Risco DM)
                </h3>
              </div>
              <p className="text-xs mt-1 max-w-2xl leading-relaxed">
                {razao !== undefined && razao !== null && razao < 0.8
                  ? 'ALERTA DE RATEIO CRÍTICO: Razão abaixo de 0,80. Em caso de sinistro parcial, a seguradora aplicará a cláusula de rateio proporcional (Risco Relativo), indenizando apenas fração do prejuízo.'
                  : razao !== undefined && razao !== null && razao < 1.0
                    ? 'ATENÇÃO A SUBSEGURO: Razão abaixo de 1,00. O LMI da cobertura básica de incêndio é inferior ao valor declarado em risco. Recomenda-se ajuste de limite na renovação.'
                    : 'CONFORMIDADE ADEQUADA: LMI da cobertura básica igual ou superior ao valor declarado em risco.'}
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-3 rounded-lg bg-white/80 border shadow-sm min-w-[130px]">
              <span className="text-[10px] uppercase font-bold text-gray-500">Razão LMI / VR</span>
              <span
                className={`text-2xl font-extrabold tabular-nums ${
                  razao !== undefined && razao !== null && razao < 0.8
                    ? 'text-red-600'
                    : razao !== undefined && razao !== null && razao < 1.0
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                }`}
              >
                {razao !== undefined && razao !== null ? razao.toFixed(2) : '—'}
              </span>
              <span className="text-[10px] text-gray-500 font-medium">Meta: ≥ 1,00</span>
            </div>
          </div>

          {/* Structured Fields Grid */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Building className="w-4 h-4 text-[#16578B]" />
              Dados Financeiros & Contratuais da Apólice
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-xs">
              <div className="space-y-1">
                <span className="text-gray-400 font-medium">Valor em Risco (Danos Materiais)</span>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(apolice.valor_em_risco_dm)}
                </div>
              </div>
              {apolice.valor_em_risco_lc !== null &&
                apolice.valor_em_risco_lc !== undefined &&
                apolice.valor_em_risco_lc > 0 && (
                  <div className="space-y-1">
                    <span className="text-gray-400 font-medium">
                      Valor em Risco (Lucros Cessantes)
                    </span>
                    <div className="text-sm font-semibold text-gray-900 tabular-nums">
                      {formatCurrency(apolice.valor_em_risco_lc)}
                    </div>
                  </div>
                )}
              <div className="space-y-1">
                <span className="text-gray-400 font-medium">LMGA (Garantia Máxima da Apólice)</span>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(apolice.lmga)}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-gray-400 font-medium">Prêmio Líquido</span>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(apolice.premio_liquido)}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-gray-400 font-medium">IOF</span>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(apolice.iof)}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-gray-400 font-medium">Prêmio Total (com IOF)</span>
                <div className="text-sm font-bold text-[#0F2B46] tabular-nums">
                  {formatCurrency(apolice.premio_total)}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-gray-400 font-medium">Comissão Corretora</span>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">
                  {apolice.comissao ? `${apolice.comissao}%` : '—'}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-gray-400 font-medium">Corretor Responsável</span>
                <div className="text-sm font-semibold text-gray-900">
                  {apolice.corretor || 'Bycor Consultoria e Corretora'}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-gray-400 font-medium">LMI Incêndio Básica Calculado</span>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(apolice.lmi_incendio_basica)}
                </div>
              </div>

              {(apolice.renovada_em || apolice.apolice_sucessora) && (
                <div className="space-y-1 col-span-1 sm:col-span-2 lg:col-span-3 p-3 bg-blue-50/60 rounded-lg border border-blue-100">
                  <span className="text-[#16578B] font-semibold flex items-center gap-1.5">
                    <FileCheck className="w-3.5 h-3.5" />
                    Evento de Renovação & Evolução da Carteira
                  </span>
                  <div className="text-xs text-gray-700 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {apolice.renovada_em && (
                      <span>
                        <strong>Data do Evento de Renovação:</strong>{' '}
                        {formatDate(apolice.renovada_em)}
                      </span>
                    )}
                    {apolice.apolice_sucessora && (
                      <span>
                        <strong>Vínculo com Sucessora:</strong>{' '}
                        <Link
                          to={`/carteira/apolice/${
                            apolice.expand?.apolice_sucessora?.id || apolice.apolice_sucessora
                          }`}
                          className="font-bold underline text-[#16578B] hover:text-[#0F2B46]"
                        >
                          {apolice.expand?.apolice_sucessora?.numero_apolice ||
                            apolice.expand?.apolice_sucessora?.id_apolice ||
                            apolice.apolice_sucessora}
                        </Link>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {apolice.endossos && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                <span className="text-xs font-semibold text-gray-700">Endossos Registrados:</span>
                <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{apolice.endossos}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. DOCUMENTOS */}
      {activeTab === 'documentos' && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Documentos da Apólice</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Cartões de risco, questionários, propostas e PDFs vinculados.
              </p>
            </div>
            <Button
              onClick={() => setUploadModalOpen(true)}
              className="bg-[#0F2B46] text-xs h-8 font-semibold"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Adicionar documento
            </Button>
          </div>

          {documentos.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-lg">
              Nenhum documento anexado diretamente a esta apólice.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                  <tr>
                    <th className="py-2.5 px-3">Tipo</th>
                    <th className="py-2.5 px-3">Arquivo</th>
                    <th className="py-2.5 px-3">Versão</th>
                    <th className="py-2.5 px-3">Data</th>
                    <th className="py-2.5 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {documentos.map((doc) => {
                    const fileUrl = doc.arquivo
                      ? pb.files.getURL(doc as unknown as { [key: string]: unknown }, doc.arquivo)
                      : null
                    return (
                      <tr key={doc.id} className="hover:bg-gray-50">
                        <td className="py-2.5 px-3 font-medium text-gray-900">{doc.tipo}</td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {doc.arquivo || 'Arquivo referencial'}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500">{doc.versao}</td>
                        <td className="py-2.5 px-3 text-gray-500">{formatDate(doc.data)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            {fileUrl ? (
                              <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#16578B] hover:underline font-semibold"
                              >
                                Baixar
                              </a>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDocToDelete(doc)}
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Excluir documento"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="sr-only">Excluir documento</span>
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
      )}

      {/* 3. PRÓ-MEMÓRIA DO CLIENTE (linha do tempo contínua por empreendimento) */}
      {activeTab === 'historico' && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                Pró-Memória do Cliente —{' '}
                {apolice.expand?.id_empreendimento?.nome_empreendimento ||
                  apolice.segurado_na_apolice}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
                Linha do tempo contínua do cliente: todos os fatos, negociações e decisões
                registrados ao longo dos anos, em todos os ciclos/apólices do empreendimento — o
                porquê de cada cobertura retirada, incluída ou redesenhada. A apólice desta ficha
                está destacada.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={filtroHistCategoria}
                onChange={(e) => setFiltroHistCategoria(e.target.value)}
                className="h-8 text-xs bg-white border border-gray-300 rounded-md px-2 text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
              >
                <option value="">Todas as categorias</option>
                {CATEGORIAS_HIST.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={filtroHistAno}
                onChange={(e) => setFiltroHistAno(e.target.value)}
                className="h-8 text-xs bg-white border border-gray-300 rounded-md px-2 text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
              >
                <option value="">Todos os anos</option>
                {anosDisponiveisHist.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* New row form */}
          <form
            onSubmit={handleAddHistorico}
            className="p-4 rounded-xl bg-gray-50 border space-y-3"
          >
            <span className="text-xs font-semibold text-gray-700">
              Registrar novo fato / nota na Pró-Memória:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-[11px] text-gray-500">Assunto</Label>
                <Input
                  type="text"
                  placeholder="Ex: Retirada da cobertura de Vento por custo elevado"
                  value={newHistAssunto}
                  onChange={(e) => setNewHistAssunto(e.target.value)}
                  className="h-8 text-xs bg-white"
                  required
                />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Categoria</Label>
                <select
                  value={newHistCategoria}
                  onChange={(e) => setNewHistCategoria(e.target.value)}
                  className="h-8 text-xs bg-white border border-gray-300 rounded-md px-2 w-full text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
                >
                  {CATEGORIAS_HIST.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Data do fato</Label>
                <Input
                  type="date"
                  value={newHistData}
                  onChange={(e) => setNewHistData(e.target.value)}
                  className="h-8 text-xs bg-white"
                  required
                />
              </div>
              <div className="sm:col-span-4">
                <Label className="text-[11px] text-gray-500">Relato / Observações</Label>
                <Input
                  type="text"
                  placeholder="Ex: Negociação com a cia resultou na retirada da cobertura X e inclusão de Y..."
                  value={newHistTexto}
                  onChange={(e) => setNewHistTexto(e.target.value)}
                  className="h-8 text-xs bg-white"
                  required
                />
              </div>
            </div>
            <div className="text-right">
              <Button
                type="submit"
                disabled={addingHist}
                className="bg-[#0F2B46] text-xs h-8 font-semibold"
              >
                {addingHist ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                ) : (
                  <Plus className="w-3.5 h-3.5 mr-1" />
                )}
                Adicionar à Pró-Memória
              </Button>
            </div>
          </form>

          {/* Timeline */}
          {historicoFiltrado.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-lg">
              {historicoList.length === 0
                ? 'Nenhum fato registrado ainda. Registre acima a primeira anotação da Pró-Memória deste cliente.'
                : 'Nenhum registro corresponde aos filtros selecionados.'}
            </div>
          ) : (
            <ol className="relative border-l-2 border-gray-200 space-y-5 pl-6 ml-2">
              {historicoFiltrado.map((h) => {
                const ehDaFicha = h.apolice === apolice.id || h.registro_id === apolice.id
                const cat = h.categoria || 'Negociação'
                const cor = CORES_CATEGORIA_HIST[cat] || CORES_CATEGORIA_HIST['Negociação']
                const refApolice = h.expand?.apolice
                const rotuloCiclo = refApolice
                  ? cicloLabelApolice(refApolice)
                  : ehDaFicha
                    ? cicloLabelApolice(apolice)
                    : 'Sem apólice vinculada'
                return (
                  <li key={h.id} className="relative">
                    <span
                      className={`absolute -left-[29px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow ${cor.dot}`}
                    />
                    <div
                      className={`p-4 rounded-xl border ${
                        ehDaFicha
                          ? 'border-[#16578B] bg-blue-50/40 shadow-sm'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold text-gray-900 tabular-nums">
                          {formatDate(h.data_fato || h.data)}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${cor.badge}`}
                        >
                          {cat}
                        </span>
                        {ehDaFicha && (
                          <span className="px-2 py-0.5 rounded bg-[#0F2B46] text-white text-[10px] font-bold">
                            ★ Apólice desta ficha
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-medium ${
                            ehDaFicha
                              ? 'bg-white border-[#16578B] text-[#16578B]'
                              : 'bg-gray-50 border-gray-200 text-gray-500'
                          }`}
                        >
                          {rotuloCiclo || '—'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-gray-800">
                        {h.assunto || '(sem assunto)'}
                      </div>
                      <div className="text-xs text-gray-600 leading-relaxed mt-0.5">{h.texto}</div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] text-gray-400">
                          {h.cia ? `${h.cia}` : ''}
                          {h.created ? ` · registrado em ${formatDate(h.created)}` : ''}
                        </span>
                        <button
                          onClick={() => handleDeleteHistorico(h.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}

      {/* 4. COBERTURAS AGRUPADAS */}
      {activeTab === 'coberturas' && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Itens de Cobertura Contratados</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Classificados de acordo com o vocabulário controlado de 48 categorias normalizadas (
                {coberturas.length} itens).
              </p>
            </div>
            {totalDuplicateRecordsToRemove > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDedupDialogOpen(true)}
                className="text-xs font-semibold border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 flex items-center gap-1.5 self-start sm:self-auto"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>Remover {totalDuplicateRecordsToRemove} Cobertura(s) Duplicada(s)</span>
              </Button>
            )}
          </div>

          {totalDuplicateRecordsToRemove > 0 && (
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg flex items-center justify-between gap-3 text-xs text-amber-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Foram detectadas <strong>{totalDuplicateRecordsToRemove} linhas repetidas</strong>{' '}
                  com mesmo nome e LMI nesta apólice (geralmente geradas por uploads sucessivos de
                  Cartão de Risco).
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => setDedupDialogOpen(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 shrink-0 font-semibold"
              >
                Limpar Duplicadas
              </Button>
            </div>
          )}

          {coberturas.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-lg">
              Nenhuma cobertura tabulada para esta apólice.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                  <tr>
                    <th className="py-2.5 px-3">Nome da Cobertura (Apólice)</th>
                    <th className="py-2.5 px-3">Categoria Normalizada</th>
                    <th className="py-2.5 px-3 text-right">LMI (R$)</th>
                    <th className="py-2.5 px-3">Franquia / POS</th>
                    <th className="py-2.5 px-3 text-right">Prêmio</th>
                    <th className="py-2.5 px-3 text-center w-20">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {coberturas.map((cob) => {
                    const isEditing = editingCobId === cob.id
                    return (
                      <tr key={cob.id} className={isEditing ? 'bg-blue-50/50' : 'hover:bg-gray-50'}>
                        <td className="py-2.5 px-3 font-semibold text-gray-900">
                          {cob.nome_cobertura}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-[#16578B] border border-blue-100">
                            {cob.categoria_normalizada}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-gray-800 tabular-nums">
                          {formatCurrency(cob.lmi_rs)}
                        </td>
                        <td className="py-2 px-3 text-gray-600 max-w-xs">
                          {isEditing ? (
                            <Input
                              type="text"
                              value={inlineFranquia}
                              onChange={(e) => setInlineFranquia(e.target.value)}
                              placeholder="Franquia / P.O.S."
                              className="h-7 text-xs bg-white"
                              autoFocus
                            />
                          ) : (
                            <span>{cob.franquia_pos || '—'}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600 tabular-nums">
                          {isEditing ? (
                            <Input
                              type="text"
                              value={inlinePremio}
                              onChange={(e) => setInlinePremio(e.target.value)}
                              placeholder="0,00"
                              className="h-7 text-xs font-mono text-right bg-white"
                            />
                          ) : (
                            <span>{formatCurrency(cob.premio_cobertura)}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                disabled={savingCobInline}
                                onClick={() => handleSaveEditCob(cob.id)}
                                className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded"
                                title="Salvar"
                              >
                                {savingCobInline ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={savingCobInline}
                                onClick={handleCancelEditCob}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                                title="Cancelar"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEditCob(cob)}
                                className="p-1 text-gray-400 hover:text-[#16578B] hover:bg-blue-50 rounded transition-colors"
                                title="Editar Franquia e Prêmio"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setCobToDelete(cob)}
                                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Excluir cobertura"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
      )}

      {/* 5. SINISTROS */}
      {activeTab === 'sinistros' && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Histórico de Sinistros Vinculados</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Sinistros ocorridos na vigência desta apólice ou herdados do cartão de risco do
              imóvel.
            </p>
          </div>

          {sinistros.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-lg">
              Nenhum sinistro registrado para este empreendimento/apólice.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                  <tr>
                    <th className="py-2.5 px-3">Data</th>
                    <th className="py-2.5 px-3">Nº Sinistro</th>
                    <th className="py-2.5 px-3">Origem Período</th>
                    <th className="py-2.5 px-3">Cobertura Acionada</th>
                    <th className="py-2.5 px-3">Descrição Resumida</th>
                    <th className="py-2.5 px-3 text-right">Valor Indenizado</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sinistros.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-gray-800">
                        {formatDate(s.data_sinistro)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-gray-700">
                        {s.numero_sinistro || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-500">{s.origem_periodo}</td>
                      <td className="py-2.5 px-3 font-medium text-[#16578B]">
                        {s.cobertura_acionada || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 max-w-sm">{s.descricao || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-gray-900 tabular-nums">
                        {s.valor_indenizado_rs
                          ? formatCurrency(s.valor_indenizado_rs)
                          : 'Em apuração'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-700">
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL: PACOTE DE RENOVAÇÃO */}
      <Dialog open={renovacaoModalOpen} onOpenChange={setRenovacaoModalOpen}>
        <DialogContent className="max-w-xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-[#16578B]" />
              <span>Montagem do Pacote de Renovação</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Compilação de documentos técnicos e histórico de sinistralidade para envio a
              seguradoras.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 space-y-1">
              <div className="font-bold">
                {apolice.segurado_na_apolice} — {apolice.ramo}
              </div>
              <div>
                Apólice: {apolice.numero_apolice || apolice.id_apolice} | Cia: {apolice.seguradora}
              </div>
              <div>Término de Vigência: {formatDate(apolice.data_fim)}</div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-gray-800">
                1. Documentos vinculados no pacote ({documentos.length}):
              </div>
              <ul className="divide-y divide-gray-100 border rounded-lg p-2 max-h-32 overflow-y-auto bg-gray-50">
                {documentos.length === 0 ? (
                  <li className="text-gray-400 py-1">Nenhum documento anexado</li>
                ) : (
                  documentos.map((d) => (
                    <li key={d.id} className="py-1 flex items-center justify-between">
                      <span className="font-medium text-gray-700">{d.tipo}</span>
                      <span className="text-gray-500 text-[11px]">{d.arquivo}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-gray-800">
                2. Histórico consolidado ({historicoList.length} entradas):
              </div>
              <div className="p-2 border rounded-lg max-h-32 overflow-y-auto bg-gray-50 text-[11px] space-y-1">
                {historicoList.length === 0 ? (
                  <span className="text-gray-400">Nenhum histórico registrado</span>
                ) : (
                  historicoList.map((h) => (
                    <div key={h.id} className="text-gray-700">
                      <strong>
                        {formatDate(h.data)} [{h.cia}]:
                      </strong>{' '}
                      {h.texto}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-3 border-t flex flex-wrap justify-end gap-2">
              <a
                href={`mailto:?subject=${mailSubject}&body=${mailBody}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-semibold"
              >
                <Mail className="w-4 h-4 text-[#16578B]" />
                <span>Abrir no E-mail (mailto)</span>
              </a>

              <Button
                onClick={() => {
                  setRenovacaoModalOpen(false)
                  navigate('/c2-rfq')
                }}
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-semibold"
              >
                Iniciar Novo RFQ (C2)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE DOCUMENTO */}
      <Dialog open={Boolean(docToDelete)} onOpenChange={(open) => !open && setDocToDelete(null)}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span>Confirmar Exclusão de Documento</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Esta ação removerá permanentemente o registro na coleção de documentos e o arquivo
              anexado no sistema Bycor.
            </DialogDescription>
          </DialogHeader>

          {docToDelete && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1.5 text-xs">
              <div>
                <span className="font-semibold text-gray-700">Tipo:</span>{' '}
                <span className="text-gray-900">{docToDelete.tipo}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Arquivo:</span>{' '}
                <span className="text-gray-900 font-mono text-[11px] break-all">
                  {docToDelete.arquivo || docToDelete.versao || 'Documento referencial'}
                </span>
              </div>
              {docToDelete.versao && (
                <div>
                  <span className="font-semibold text-gray-700">Versão/Identificador:</span>{' '}
                  <span className="text-gray-900">{docToDelete.versao}</span>
                </div>
              )}
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
              onClick={handleConfirmDeleteDocumento}
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

      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE COBERTURA INDIVIDUAL */}
      <Dialog open={Boolean(cobToDelete)} onOpenChange={(open) => !open && setCobToDelete(null)}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              <span>Confirmar Exclusão de Cobertura</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Deseja remover esta cobertura da apólice? Esta ação é definitiva no banco de dados.
            </DialogDescription>
          </DialogHeader>

          {cobToDelete && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1 text-xs">
              <div>
                <span className="font-semibold text-gray-700">Cobertura:</span>{' '}
                <span className="text-gray-900 font-medium">{cobToDelete.nome_cobertura}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Categoria:</span>{' '}
                <span className="text-gray-900">{cobToDelete.categoria_normalizada}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">LMI:</span>{' '}
                <span className="text-gray-900 font-bold">
                  {formatCurrency(cobToDelete.lmi_rs)}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deletingCob}
              onClick={() => setCobToDelete(null)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deletingCob}
              onClick={handleConfirmDeleteCobertura}
              className="text-xs bg-red-600 hover:bg-red-700 font-semibold flex items-center gap-1.5"
            >
              {deletingCob ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir Cobertura</span>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: CONFIRMAÇÃO DE DEDUPLICAÇÃO DE COBERTURAS */}
      <Dialog open={dedupDialogOpen} onOpenChange={setDedupDialogOpen}>
        <DialogContent className="max-w-lg animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <span>Remover Coberturas Duplicadas</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              O sistema identificou {totalDuplicateRecordsToRemove} registro(s) excedente(s) com
              mesmo nome e LMI. Uma via de cada cobertura será preservada e as cópias repetidas
              serão excluídas permanentemente.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-60 overflow-y-auto divide-y border rounded-lg p-2 bg-gray-50 text-xs">
            {duplicateGroups.map((grp) => (
              <div key={grp.key} className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{grp.name}</div>
                  <div className="text-[11px] text-gray-500">
                    LMI: {formatCurrency(grp.lmi)} • {grp.items.length} ocorrências encontradas
                  </div>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-800 font-medium">
                  -{grp.items.length - 1} duplicada(s)
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={removingDuplicates}
              onClick={() => setDedupDialogOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={removingDuplicates}
              onClick={handleConfirmRemoveDuplicates}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1.5"
            >
              {removingDuplicates ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Removendo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Confirmar Remoção de Duplicadas</span>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: UPLOAD MANUAL DOCUMENTO */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              Anexar Documento à Apólice
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUploadDocument} className="space-y-3 pt-2 text-xs">
            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Tipo</Label>
              <select
                value={docTipo}
                onChange={(e) => setDocTipo(e.target.value)}
                className="w-full h-8 border rounded px-2 bg-white mt-1"
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
            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Versão</Label>
              <Input
                type="text"
                value={docVersao}
                onChange={(e) => setDocVersao(e.target.value)}
                className="h-8 text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Arquivo</Label>
              <Input
                type="file"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setDocFile(e.target.files[0])
                  }
                }}
                className="text-xs mt-1"
                required
              />
            </div>
            <div className="pt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadModalOpen(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={uploadingDoc} className="bg-[#0F2B46] text-xs h-8">
                {uploadingDoc ? 'Enviando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
