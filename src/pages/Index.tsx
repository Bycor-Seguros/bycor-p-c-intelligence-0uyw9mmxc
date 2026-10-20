import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import {
  Clock,
  CalendarClock,
  AlertTriangle,
  CalendarX,
  FileSpreadsheet,
  ArrowRight,
  TrendingUp,
  Building,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Layers,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, getDaysRemaining, getStatusBadgeInfo } from '@/lib/formatters'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from 'recharts'

interface ApoliceItem {
  id: string
  id_apolice: string
  segurado_na_apolice: string
  cnpj_segurado: string
  seguradora: string
  numero_apolice: string
  ramo: string
  data_inicio: string
  data_fim: string
  premio_liquido: number
  premio_total: number
  lmga: number
  status: string
  prospect_retorno?: string
  razao_lmi_vr_dm?: number
  expand?: {
    id_empreendimento?: {
      nome_empreendimento: string
      uf: string
      segmento: string
    }
  }
}

const CHART_COLORS = ['#16578B', '#0D9488', '#D97706', '#7C3AED', '#16A34A', '#E11D48', '#64748B']

export default function DashboardHome() {
  const navigate = useNavigate()
  const [apolices, setApolices] = useState<ApoliceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBucket, setFilterBucket] = useState<
    'todos' | '60' | '30' | '15' | 'vencidas' | 'nao_renovadas'
  >('todos')
  const [rfqCount, setRfqCount] = useState(0)
  const [propostasCount, setPropostasCount] = useState(0)
  const [auditoriasCount, setAuditoriasCount] = useState(0)
  const [aprovadosCount, setAprovadosCount] = useState(0)

  const listSectionRef = useRef<HTMLDivElement>(null)

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const res = await pb.collection('apolices').getFullList<ApoliceItem>({
        sort: 'data_fim',
        expand: 'id_empreendimento',
      })
      setApolices(res)

      // Fetch funnel counts
      const [rfqs, props, auds] = await Promise.all([
        pb
          .collection('rfq')
          .getFullList({ fields: 'id,status' })
          .catch(() => []),
        pb
          .collection('propostas')
          .getFullList({ fields: 'id,status' })
          .catch(() => []),
        pb
          .collection('auditoria')
          .getFullList({ fields: 'id,status' })
          .catch(() => []),
      ])
      setRfqCount(rfqs.length)
      setPropostasCount(props.length)
      setAuditoriasCount(auds.length)
      setAprovadosCount(auds.filter((a: { status?: string }) => a.status === 'Aprovado').length)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()

    // Realtime subscription
    const unsub = pb.collection('apolices').subscribe('*', () => {
      fetchDashboardData()
    })

    return () => {
      unsub.then((fn) => fn()).catch(() => {})
    }
  }, [])

  // Calculate Buckets
  const { bucket60, bucket30, bucket15, bucketVencidas, bucketNaoRenovadas } = useMemo(() => {
    const b60: ApoliceItem[] = []
    const b30: ApoliceItem[] = []
    const b15: ApoliceItem[] = []
    const bVenc: ApoliceItem[] = []
    const bNaoRen: ApoliceItem[] = []

    apolices.forEach((ap) => {
      const statusNorm = (ap.status || '').toLowerCase()
      if (statusNorm === 'não renovada' || statusNorm === 'nao renovada') {
        bNaoRen.push(ap)
        return
      }

      const days = getDaysRemaining(ap.data_fim)
      if (days === null) return

      if (days < 0 || statusNorm === 'vencida') {
        bVenc.push(ap)
      } else if (days <= 7) {
        // 15 days bucket: 7 a 1 dias (alta urgência)
        b15.push(ap)
      } else if (days <= 15) {
        // 30 days bucket: 15 a 8 dias
        b30.push(ap)
      } else if (days <= 60) {
        // 60 days bucket: 60 a 16 dias
        b60.push(ap)
      }
    })

    return {
      bucket60: b60,
      bucket30: b30,
      bucket15: b15,
      bucketVencidas: bVenc,
      bucketNaoRenovadas: bNaoRen,
    }
  }, [apolices])

  // Filtered renewal list
  const filteredList = useMemo(() => {
    switch (filterBucket) {
      case '60':
        return bucket60
      case '30':
        return bucket30
      case '15':
        return bucket15
      case 'vencidas':
        return bucketVencidas
      case 'nao_renovadas':
        return bucketNaoRenovadas
      default:
        // All active/upcoming renewals sorted by data_fim asc
        return [...apolices].sort((a, b) => {
          const dA = a.data_fim || ''
          const dB = b.data_fim || ''
          return dA.localeCompare(dB)
        })
    }
  }, [filterBucket, apolices, bucket60, bucket30, bucket15, bucketVencidas, bucketNaoRenovadas])

  // Chart data: Premiums by Insurer
  const seguradoraChartData = useMemo(() => {
    const map = new Map<string, number>()
    apolices.forEach((ap) => {
      const seg = (ap.seguradora || 'Outras').trim()
      // Normalize common variants
      let cleanSeg = seg
      if (cleanSeg.includes('AXA')) cleanSeg = 'AXA Seguros'
      else if (cleanSeg.includes('Porto')) cleanSeg = 'Porto Seguro'
      else if (cleanSeg.includes('Mitsui') || cleanSeg.includes('MSIG'))
        cleanSeg = 'Mitsui Sumitomo'
      else if (cleanSeg.includes('Chubb')) cleanSeg = 'Chubb'
      else if (cleanSeg.includes('Ezze')) cleanSeg = 'Ezze Seguros'
      else if (cleanSeg.includes('Tokio')) cleanSeg = 'Tokio Marine'

      const curr = map.get(cleanSeg) || 0
      map.set(cleanSeg, curr + (ap.premio_total || ap.premio_liquido || 0))
    })

    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total)
  }, [apolices])

  // Mark policy as Prospect
  const handleMarkAsProspect = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const nextYear = new Date()
      nextYear.setFullYear(nextYear.getFullYear() + 1)
      await pb.collection('apolices').update(id, {
        status: 'prospect',
        prospect_retorno: nextYear.toISOString().slice(0, 10),
      })
      fetchDashboardData()
    } catch (err: unknown) {
      alert('Erro ao atualizar status: ' + (err as Error).message)
    }
  }

  const scrollToList = (bucket: typeof filterBucket) => {
    setFilterBucket(bucket)
    listSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-[#0F2B46] to-[#16578B] rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-blue-200 border border-white/15 mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            Operação de Riscos Nomeados & Operacionais (RN / RO)
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Dashboard de Renovações e Carteira
          </h1>
          <p className="text-xs text-blue-100/90 mt-1 max-w-xl">
            Acompanhe prazos críticos, zoneamento de rateio por subseguro e conversão de propostas
            em hotéis, resorts e condo-hotéis de São Paulo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => navigate('/c1-recebimento')}
            className="bg-white hover:bg-gray-100 text-[#0F2B46] font-semibold text-xs h-10 px-4 shadow"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2 text-[#16578B]" />
            Importar Base Hotéis e Resorts
          </Button>
          <Button
            onClick={() => fetchDashboardData()}
            variant="outline"
            className="border-white/20 hover:bg-white/10 text-white text-xs h-10"
            title="Recarregar dados"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* RENEWAL COUNTDOWN CARDS (4 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 60 dias (Azul) */}
        <div
          onClick={() => scrollToList('60')}
          className={`bg-white rounded-xl p-5 border cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
            filterBucket === '60'
              ? 'border-blue-500 ring-2 ring-blue-100 shadow-md'
              : 'border-[#E4E9F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Vencem em 60 dias
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#16578B] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#16578B] tabular-nums">
              {bucket60.length}
            </span>
            <span className="text-xs text-gray-400">apólices</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Horizonte de 16 a 60 dias para abertura de RFQ
          </p>
        </div>

        {/* 30 dias (Âmbar) */}
        <div
          onClick={() => scrollToList('30')}
          className={`bg-white rounded-xl p-5 border cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
            filterBucket === '30'
              ? 'border-amber-500 ring-2 ring-amber-100 shadow-md'
              : 'border-[#E4E9F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Vencem em 30 dias
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-[#D97706] flex items-center justify-center">
              <CalendarClock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#D97706] tabular-nums">
              {bucket30.length}
            </span>
            <span className="text-xs text-gray-400">apólices</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Horizonte de 8 a 15 dias · Tabulação prioritária
          </p>
        </div>

        {/* 15 dias (Vermelho com pulso suave) */}
        <div
          onClick={() => scrollToList('15')}
          className={`bg-white rounded-xl p-5 border cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md relative overflow-hidden ${
            bucket15.length > 0 ? 'animate-pulse-soft border-red-300' : 'border-[#E4E9F0]'
          } ${filterBucket === '15' ? 'ring-2 ring-red-100 shadow-md' : ''}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Vencem em 15 dias
            </span>
            <div className="w-8 h-8 rounded-lg bg-red-50 text-[#DC2626] flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#DC2626] tabular-nums">
              {bucket15.length}
            </span>
            <span className="text-xs text-gray-400">apólices</span>
          </div>
          <p className="text-[11px] text-red-600 font-medium mt-2">
            Urgência crítica · Fechamento imediato
          </p>
        </div>

        {/* Vencidas (Vermelho escuro) */}
        <div
          onClick={() => scrollToList('vencidas')}
          className={`bg-white rounded-xl p-5 border cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
            filterBucket === 'vencidas'
              ? 'border-red-800 ring-2 ring-red-100 shadow-md'
              : 'border-[#E4E9F0]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Vencidas
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-[#991B1B] flex items-center justify-center">
              <CalendarX className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#991B1B] tabular-nums">
              {bucketVencidas.length}
            </span>
            <span className="text-xs text-gray-400">apólices</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Necessitam regularização ou conversão</p>
        </div>
      </div>

      {/* FUNIL DE COTAÇÃO & VOLUME DE PRÊMIOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funil de Cotação */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-[#E4E9F0] p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#16578B]" />
                Funil Operacional de Cotações
              </h3>
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Ciclo C2 → C6
              </span>
            </div>

            <p className="text-xs text-gray-500 mb-5">
              Acompanhamento de conversão entre pedidos emitidos e aprovações técnicas finais.
            </p>

            <div className="space-y-3">
              {/* Etapa 1: RFQs */}
              <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-blue-900">
                    1. RFQs Emitidos (C2)
                  </div>
                  <div className="text-[10px] text-blue-600">Cotações abertas com seguradoras</div>
                </div>
                <span className="text-lg font-bold text-blue-950 tabular-nums">{rfqCount}</span>
              </div>

              {/* Etapa 2: Propostas */}
              <div className="p-3 rounded-lg bg-teal-50/70 border border-teal-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-teal-900">
                    2. Propostas Recebidas (C3)
                  </div>
                  <div className="text-[10px] text-teal-600">
                    Tabulações comparativas lado a lado
                  </div>
                </div>
                <span className="text-lg font-bold text-teal-950 tabular-nums">
                  {propostasCount}
                </span>
              </div>

              {/* Etapa 3: Auditoria */}
              <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-amber-900">
                    3. Auditorias Técnicas (C5)
                  </div>
                  <div className="text-[10px] text-amber-600">Conformidade com cartão de risco</div>
                </div>
                <span className="text-lg font-bold text-amber-950 tabular-nums">
                  {auditoriasCount}
                </span>
              </div>

              {/* Etapa 4: Aprovadas */}
              <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-emerald-900">
                    4. Fechamentos Aprovados (C6)
                  </div>
                  <div className="text-[10px] text-emerald-600">
                    Apólices ativas na base oficial
                  </div>
                </div>
                <span className="text-lg font-bold text-emerald-950 tabular-nums">
                  {aprovadosCount}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">Taxa de aprovação técnica</span>
            <span className="text-xs font-bold text-emerald-600">
              {auditoriasCount > 0
                ? `${Math.round((aprovadosCount / auditoriasCount) * 100)}%`
                : '0%'}
            </span>
          </div>
        </div>

        {/* Volume de Prêmios por Seguradora */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E4E9F0] p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#16578B]" />
                Volume de Prêmios por Seguradora
              </h3>
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Total em Carteira
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Distribuição da concentração de prêmio total (R$) entre companhias seguradoras.
            </p>

            {seguradoraChartData.length === 0 ? (
              <div className="h-60 flex flex-col items-center justify-center text-gray-400 border border-dashed rounded-lg bg-gray-50/50">
                <FileSpreadsheet className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-xs font-medium">Nenhuma apólice registrada para exibição</p>
                <Link to="/c1-recebimento" className="text-xs text-[#16578B] underline mt-1">
                  Importar Base Hotéis e Resorts
                </Link>
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={seguradoraChartData}
                    margin={{ top: 10, right: 10, left: 10, bottom: 25 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#4B5563' }}
                      angle={-15}
                      textAnchor="end"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#6B7280' }}
                      tickFormatter={(val) => `R$ ${(val / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(val: any) => [formatCurrency(Number(val) || 0), 'Volume Total']}
                      labelStyle={{ fontWeight: 'bold', color: '#0F2B46' }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {seguradoraChartData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="mt-2 text-right">
            <Link
              to="/carteira"
              className="text-xs text-[#16578B] hover:text-[#0E4268] font-semibold inline-flex items-center gap-1"
            >
              <span>Ver todas as apólices na carteira</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* RENEWAL LIST SECTION (Filterable Table) */}
      <div
        ref={listSectionRef}
        className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden"
      >
        {/* Filter Chips Bar */}
        <div className="p-4 border-b border-[#E4E9F0] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Lista de Apólices por Vencimento</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Ordenadas pela data de término de vigência para acompanhamento preventivo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'todos', label: 'Todas as Apólices' },
              { id: '60', label: `60 dias (${bucket60.length})` },
              { id: '30', label: `30 dias (${bucket30.length})` },
              { id: '15', label: `15 dias (${bucket15.length})` },
              { id: 'vencidas', label: `Vencidas (${bucketVencidas.length})` },
              { id: 'nao_renovadas', label: `Não Renovadas (${bucketNaoRenovadas.length})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterBucket(f.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  filterBucket === f.id
                    ? 'bg-[#0F2B46] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-xs">Carregando apólices...</div>
        ) : filteredList.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Building className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-700">Nenhuma apólice nesta categoria</h4>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              {apolices.length === 0
                ? 'Nenhum dado importado — use o importador in-app no Módulo C1 para carregar a Base Hotéis e Resorts.'
                : 'Não há apólices com vigência correspondente ao filtro selecionado.'}
            </p>
            {apolices.length === 0 && (
              <Link to="/c1-recebimento">
                <Button className="mt-4 bg-[#0F2B46] text-xs h-9">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Ir para Importador
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/75 text-gray-600 font-semibold border-b border-[#E4E9F0]">
                <tr>
                  <th className="py-3 px-4">Empreendimento / Segurado</th>
                  <th className="py-3 px-4">Seguradora</th>
                  <th className="py-3 px-4">Ramo</th>
                  <th className="py-3 px-4">Nº Apólice</th>
                  <th className="py-3 px-4">Vigência</th>
                  <th className="py-3 px-4">Dias Restantes</th>
                  <th className="py-3 px-4 text-right">Prêmio Total</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredList.map((ap) => {
                  const days = getDaysRemaining(ap.data_fim)
                  const badge = getStatusBadgeInfo(ap.status)
                  const nomeEmp =
                    ap.expand?.id_empreendimento?.nome_empreendimento || ap.segurado_na_apolice

                  // Subseguro warning check (< 1.00 or < 0.80)
                  const subseguro =
                    ap.razao_lmi_vr_dm !== undefined &&
                    ap.razao_lmi_vr_dm !== null &&
                    ap.razao_lmi_vr_dm < 1.0

                  return (
                    <tr
                      key={ap.id}
                      onClick={() => navigate(`/carteira/apolice/${ap.id}`)}
                      className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-gray-900">
                        <div>{nomeEmp}</div>
                        {ap.cnpj_segurado && (
                          <div className="text-[10px] text-gray-400 font-normal">
                            CNPJ: {ap.cnpj_segurado}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-700 font-medium">
                        {ap.seguradora || '—'}
                      </td>
                      <td className="py-3 px-4 text-gray-600">{ap.ramo || '—'}</td>
                      <td className="py-3 px-4 text-gray-600 font-mono text-[11px]">
                        {ap.numero_apolice || ap.id_apolice}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {formatDate(ap.data_inicio)} → {formatDate(ap.data_fim)}
                      </td>
                      <td className="py-3 px-4">
                        {days !== null ? (
                          <span
                            className={`font-semibold tabular-nums ${
                              days < 0
                                ? 'text-red-700'
                                : days <= 15
                                  ? 'text-red-600 font-bold'
                                  : days <= 30
                                    ? 'text-amber-600'
                                    : 'text-blue-700'
                            }`}
                          >
                            {days < 0 ? `${Math.abs(days)}d em atraso` : `${days} dias`}
                          </span>
                        ) : (
                          '—'
                        )}
                        {subseguro && (
                          <span
                            title="Razão LMI/VR abaixo de 1.00 (possível subseguro/zona de rateio)"
                            className="ml-1.5 inline-block text-[10px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-bold"
                          >
                            {ap.razao_lmi_vr_dm && ap.razao_lmi_vr_dm < 0.8
                              ? 'RATEIO'
                              : 'SUBSEGURO'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-gray-900 tabular-nums">
                        {formatCurrency(ap.premio_total || ap.premio_liquido)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badge.bg}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/carteira/apolice/${ap.id}`)
                          }}
                          className="h-7 text-xs text-[#16578B] hover:text-[#0E4268]"
                        >
                          <span>Abrir</span>
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

      {/* SEÇÃO PERMANENTE: Vencidas e Não Renovadas com "Marcar como Prospect" */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <CalendarX className="w-4 h-4 text-red-600" />
              <span>Contas Vencidas e Não Renovadas</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Políticas com perda de vigência. Contas não renovadas podem ser convertidas em
              prospects para reaparecer no radar em 1 ano.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
            {bucketVencidas.length + bucketNaoRenovadas.length} pendência(s)
          </span>
        </div>

        {bucketVencidas.length === 0 && bucketNaoRenovadas.length === 0 ? (
          <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded-lg">
            Nenhuma apólice vencida ou não renovada pendente de ação.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 border rounded-lg overflow-hidden">
            {[...bucketVencidas, ...bucketNaoRenovadas].map((item) => {
              const daysOverdue = getDaysRemaining(item.data_fim)
              return (
                <div
                  key={item.id}
                  className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <div className="text-xs font-bold text-gray-900">
                      {item.expand?.id_empreendimento?.nome_empreendimento ||
                        item.segurado_na_apolice}
                    </div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                      <span>{item.seguradora}</span>
                      <span>•</span>
                      <span>Vencimento: {formatDate(item.data_fim)}</span>
                      {daysOverdue !== null && daysOverdue < 0 && (
                        <span className="text-red-600 font-semibold">
                          ({Math.abs(daysOverdue)} dias em atraso)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={(e) => handleMarkAsProspect(item.id, e)}
                      variant="outline"
                      className="text-xs h-8 border-purple-200 text-purple-700 hover:bg-purple-50"
                    >
                      Marcar como Prospect (+1 ano)
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => navigate(`/carteira/apolice/${item.id}`)}
                      className="text-xs h-8 bg-[#0F2B46] hover:bg-[#1B3C5D] text-white"
                    >
                      Ver detalhes
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
