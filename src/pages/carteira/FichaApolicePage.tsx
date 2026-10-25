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
import { formatCurrency, formatDate, formatCnpj, getStatusBadgeInfo } from '@/lib/formatters'
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
  autor?: string
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

  // Renovation cycle modal
  const [renovacaoModalOpen, setRenovacaoModalOpen] = useState(false)

  // Histórico editing
  const [newHistData, setNewHistData] = useState(new Date().toISOString().slice(0, 10))
  const [newHistCia, setNewHistCia] = useState('')
  const [newHistTexto, setNewHistTexto] = useState('')
  const [addingHist, setAddingHist] = useState(false)

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
        expand: 'id_empreendimento',
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

      // Fetch historico
      const hists = await pb.collection('historico').getFullList<HistoricoItem>({
        filter: `registro_id="${id}" && tabela="apolices"`,
        sort: '-data',
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

  // Save new history row
  const handleAddHistorico = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apolice || !newHistTexto.trim()) return

    try {
      setAddingHist(true)
      const payload = {
        registro_id: apolice.id,
        tabela: 'apolices',
        data: newHistData,
        cia: newHistCia.trim() || apolice.seguradora,
        texto: newHistTexto.trim(),
        autor: user?.id,
        timestamp: new Date().toISOString(),
      }
      await pb.collection('historico').create(payload)
      setNewHistTexto('')
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

  // Delete history row
  const handleDeleteHistorico = async (histId: string) => {
    if (!confirm('Deseja excluir este registro de histórico?')) return
    try {
      await pb.collection('historico').delete(histId)
      fetchApoliceFull()
    } catch (err: unknown) {
      alert('Erro ao excluir: ' + (err as Error).message)
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

        <Button
          onClick={() => setRenovacaoModalOpen(true)}
          className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 shadow-sm flex items-center gap-2"
        >
          <Share2 className="w-4 h-4 text-blue-300" />
          <span>Iniciar Ciclo de Renovação</span>
        </Button>
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

              {/* Relação de Sucessão / Antecessão */}
              {relacaoSucessao?.sucessora && (
                <div className="mt-1 text-xs text-[#16578B] flex items-center gap-1.5 font-medium">
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Sucedida pela apólice</span>
                  <Link
                    to={`/carteira/apolice/${relacaoSucessao.sucessora.id}`}
                    className="font-bold underline hover:text-[#0F2B46]"
                  >
                    {relacaoSucessao.sucessora.numero_apolice ||
                      relacaoSucessao.sucessora.id_apolice ||
                      'Ficha da Sucessora'}
                  </Link>
                  <span className="text-[11px] text-gray-400">
                    ({formatDate(relacaoSucessao.sucessora.data_inicio)} até{' '}
                    {formatDate(relacaoSucessao.sucessora.data_fim)})
                  </span>
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
            { id: 'historico', label: `Histórico Operacional (${historicoList.length})` },
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

      {/* 3. HISTÓRICO EDITÁVEL COM AUDITORIA */}
      {activeTab === 'historico' && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              Histórico de Sinistralidade & Negociações
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Tabela editável com autoria e data, utilizada na composição do pacote de renovação
              para as seguradoras.
            </p>
          </div>

          {/* New row form */}
          <form
            onSubmit={handleAddHistorico}
            className="p-4 rounded-xl bg-gray-50 border space-y-3"
          >
            <span className="text-xs font-semibold text-gray-700">
              Registrar nova ocorrência / nota:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-[11px] text-gray-500">Data</Label>
                <Input
                  type="date"
                  value={newHistData}
                  onChange={(e) => setNewHistData(e.target.value)}
                  className="h-8 text-xs bg-white"
                  required
                />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Cia Seguradora</Label>
                <Input
                  type="text"
                  placeholder={apolice.seguradora}
                  value={newHistCia}
                  onChange={(e) => setNewHistCia(e.target.value)}
                  className="h-8 text-xs bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[11px] text-gray-500">Histórico / Observações</Label>
                <Input
                  type="text"
                  placeholder="Ex: Sinistro de tubulação liquidado sem pendências..."
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
                Adicionar ao histórico
              </Button>
            </div>
          </form>

          {/* History table */}
          {historicoList.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-lg">
              Nenhuma entrada no histórico ainda. Registre acima as anotações do analista.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                  <tr>
                    <th className="py-2.5 px-3 w-32">Data</th>
                    <th className="py-2.5 px-3 w-48">Cia</th>
                    <th className="py-2.5 px-3">Histórico / Nota</th>
                    <th className="py-2.5 px-3 text-right w-20">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historicoList.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium text-gray-700 whitespace-nowrap">
                        {formatDate(h.data)}
                      </td>
                      <td className="py-2.5 px-3 text-gray-800 font-medium">{h.cia || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-600 leading-relaxed">{h.texto}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleDeleteHistorico(h.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. COBERTURAS AGRUPADAS */}
      {activeTab === 'coberturas' && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Itens de Cobertura Contratados</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Classificados de acordo com o vocabulário controlado de 48 categorias normalizadas.
            </p>
          </div>

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
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {coberturas.map((cob) => (
                    <tr key={cob.id} className="hover:bg-gray-50">
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
                      <td className="py-2.5 px-3 text-gray-600 max-w-xs">
                        {cob.franquia_pos || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-600 tabular-nums">
                        {formatCurrency(cob.premio_cobertura)}
                      </td>
                    </tr>
                  ))}
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
