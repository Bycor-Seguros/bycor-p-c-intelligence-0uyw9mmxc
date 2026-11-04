import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import {
  FileCheck2,
  Calendar,
  Building2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Shield,
  Layers,
  TrendingDown,
  TrendingUp,
  Tag,
  ArrowRight,
  Filter,
  RefreshCw,
  Eye,
  History,
  FileSpreadsheet,
  Download,
  Share2,
  ExternalLink,
  Loader2,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, formatCnpj } from '@/lib/formatters'
import {
  AuditoriaRodadaRecord,
  ItemAuditoriaComparativo,
  toggleItemRessalvaC5,
  encontrarLmiApoliceCorrespondente,
  CorrespondenciaApoliceLmi,
} from '@/services/auditoriaCartaoApoliceService'
import {
  listarTaxonomiaCanonicas,
  listarSinonimos,
  CoberturaCanonicaRecord,
  CoberturaSinonimoRecord,
} from '@/services/equivalenciaCoberturasService'

export default function AuditoriaCartaoApolicePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [rodadas, setRodadas] = useState<AuditoriaRodadaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeRodada, setActiveRodada] = useState<AuditoriaRodadaRecord | null>(null)
  const [togglingRessalva, setTogglingRessalva] = useState<string | null>(null)

  // Filtros
  const [filterEmp, setFilterEmp] = useState<string>(searchParams.get('emp') || 'todos')
  const [filterStatus, setFilterStatus] = useState<'todos' | 'com_desvios' | 'sem_desvios'>('todos')
  const [tabAtiva, setTabAtiva] = useState<
    'coberturas' | 'vrd' | 'identificacao' | 'premios' | 'sinistros'
  >('coberturas')
  const [canonicas, setCanonicas] = useState<CoberturaCanonicaRecord[]>([])
  const [sinonimos, setSinonimos] = useState<CoberturaSinonimoRecord[]>([])

  const fetchRodadas = async () => {
    try {
      setLoading(true)
      const records = await pb.collection('auditoria_rodadas').getFullList<AuditoriaRodadaRecord>({
        sort: '-created',
        expand: 'empreendimento,apolice,usuario_upload',
      })
      setRodadas(records)

      // Se houver parâmetro de ID da rodada na URL, foca nela
      const urlRodadaId = searchParams.get('rodada')
      const urlEmpId = searchParams.get('emp')

      if (urlRodadaId) {
        const found = records.find((r) => r.id === urlRodadaId)
        if (found) {
          setActiveRodada(found)
          return
        }
      }

      if (urlEmpId && urlEmpId !== 'todos') {
        const matching = records.filter((r) => r.empreendimento === urlEmpId)
        if (matching.length > 0) {
          setActiveRodada(matching[0])
          return
        }
      }

      if (records.length > 0 && !activeRodada) {
        setActiveRodada(records[0])
      }
    } catch (err) {
      console.error('Erro ao carregar rodadas de auditoria:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRodadas()
    // Carrega taxonomia canônica e sinônimos para suporte em tempo real ao leitor de equivalência
    Promise.all([
      listarTaxonomiaCanonicas().catch(() => []),
      listarSinonimos().catch(() => []),
    ]).then(([canList, sinList]) => {
      setCanonicas(canList)
      setSinonimos(sinList)
    })
  }, [])

  // Lista única de empreendimentos para o filtro
  const empreendimentosList = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rodadas) {
      const nome =
        r.expand?.empreendimento?.nome_empreendimento ||
        r.expand?.empreendimento?.razao_social ||
        r.snapshot_comparativo?.identificacao?.cartao?.segurado ||
        'Empreendimento'
      map.set(r.empreendimento, nome)
    }
    return Array.from(map.entries()).map(([id, nome]) => ({ id, nome }))
  }, [rodadas])

  // Filtragem das rodadas no painel lateral
  const rodadasFiltradas = useMemo(() => {
    return rodadas.filter((r) => {
      if (filterEmp !== 'todos' && r.empreendimento !== filterEmp) return false
      if (filterStatus === 'com_desvios' && (r.total_divergencias || 0) === 0) return false
      if (filterStatus === 'sem_desvios' && (r.total_divergencias || 0) > 0) return false
      return true
    })
  }, [rodadas, filterEmp, filterStatus])

  const handleSelectRodada = (r: AuditoriaRodadaRecord) => {
    setActiveRodada(r)
    setSearchParams((prev) => {
      prev.set('rodada', r.id)
      return prev
    })
  }

  const handleToggleRessalva = async (itemId: string, currentState: boolean) => {
    if (!activeRodada) return
    try {
      setTogglingRessalva(itemId)
      const updated = await toggleItemRessalvaC5(activeRodada.id, itemId, !currentState)
      setActiveRodada(updated)
      // Atualiza lista principal
      setRodadas((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch (err) {
      alert('Erro ao atualizar marcação de ressalva: ' + (err as Error).message)
    } finally {
      setTogglingRessalva(null)
    }
  }

  const snap = activeRodada?.snapshot_comparativo

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Auditoria de Conformidade
            </span>
            <h2 className="text-xl font-bold text-gray-900">Auditoria Cartão × Apólice</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-3xl">
            Relatório comparativo persistente entre o <strong>Cartão de Risco</strong> (fonte de
            origem) e a <strong>Apólice Emitida</strong> (documento final). Cada upload gera uma
            rodada datada com desvio de LMI, franquias, VRD por rubrica e seleção de ressalvas para
            o módulo C5.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={() => navigate('/c1-recebimento')}
            variant="outline"
            className="text-xs font-semibold h-9 border-gray-300 hover:bg-gray-50 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-[#16578B]" />
            <span>Novo Upload no C1</span>
          </Button>

          {activeRodada?.apolice && (
            <Button
              onClick={() => navigate(`/carteira/${activeRodada.apolice}`)}
              className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 px-3.5 shadow-sm flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5 text-blue-300" />
              <span>Ver Ficha da Apólice</span>
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#16578B] mb-2" />
          <p className="text-xs text-gray-500">Carregando histórico de auditorias...</p>
        </div>
      ) : rodadas.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-12 text-center max-w-xl mx-auto space-y-4 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-[#16578B] flex items-center justify-center mx-auto">
            <FileCheck2 className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">
              Nenhuma rodada de auditoria gravada ainda
            </h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Ao enviar um arquivo Excel do Cartão de Risco na aba{' '}
              <strong>Módulo C1 (Recebimento)</strong>, o sistema cruza automaticamente o documento
              com a apólice existente e gera a primeira rodada de auditoria com histórico
              permanente.
            </p>
          </div>
          <Button
            onClick={() => navigate('/c1-recebimento')}
            className="bg-[#16578B] hover:bg-[#12456e] text-white text-xs font-semibold h-9 px-4"
          >
            Ir para Recebimento de Documentos (C1)
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* PAINEL LATERAL ESQUERDO: HISTÓRICO DE RODADAS (4 colunas) */}
          <div className="lg:col-span-4 bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#16578B]" />
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                  Histórico de Rodadas ({rodadasFiltradas.length})
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchRodadas}
                className="h-7 w-7 p-0 text-gray-400 hover:text-gray-700"
                title="Recarregar"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Filtros rápidos */}
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Filtrar por Empreendimento:
                </label>
                <select
                  value={filterEmp}
                  onChange={(e) => setFilterEmp(e.target.value)}
                  className="w-full text-xs h-8 border border-gray-200 rounded-lg px-2 bg-gray-50 mt-1 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
                >
                  <option value="todos">Todos os empreendimentos</option>
                  {empreendimentosList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-1.5 pt-1">
                {(['todos', 'com_desvios', 'sem_desvios'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setFilterStatus(st)}
                    className={`flex-1 text-[10px] py-1 rounded font-medium transition-colors ${
                      filterStatus === st
                        ? 'bg-[#0F2B46] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {st === 'todos'
                      ? 'Todos'
                      : st === 'com_desvios'
                        ? 'Com Desvios'
                        : 'Sem Desvios'}
                  </button>
                ))}
              </div>
            </div>

            {/* Lista das Rodadas */}
            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {rodadasFiltradas.map((r) => {
                const isSelected = activeRodada?.id === r.id
                const empNome =
                  r.expand?.empreendimento?.nome_empreendimento ||
                  r.expand?.empreendimento?.razao_social ||
                  r.snapshot_comparativo?.identificacao?.cartao?.segurado ||
                  'Empreendimento'
                const apolNumero =
                  r.expand?.apolice?.numero_apolice ||
                  r.snapshot_comparativo?.identificacao?.apolice?.numeroApolice ||
                  'Apólice Vigente'
                const totalDesvios = r.total_divergencias || 0
                const totalRessalvas = r.total_ressalvas_c5 || 0

                return (
                  <button
                    key={r.id}
                    onClick={() => handleSelectRodada(r)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-[#16578B] bg-blue-50/70 shadow-xs ring-1 ring-[#16578B]/20'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0F2B46] text-white">
                        Rodada #{r.numero_rodada}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {formatDate(r.data_rodada || r.created)}
                      </span>
                    </div>

                    <div className="font-semibold text-xs text-gray-900 line-clamp-1">
                      {empNome}
                    </div>
                    <div className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                      {apolNumero} • {r.produto_ramo}
                    </div>

                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 text-[10px]">
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold ${
                          totalDesvios > 0
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {totalDesvios} divergência(s)
                      </span>

                      {totalRessalvas > 0 && (
                        <span className="px-1.5 py-0.5 rounded font-semibold bg-red-100 text-red-800">
                          {totalRessalvas} ressalva(s) C5
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* PAINEL CENTRAL / DETALHE DA RODADA SELECIONADA (8 colunas) */}
          <div className="lg:col-span-8 space-y-6">
            {activeRodada && snap ? (
              <>
                {/* Header da Rodada Ativa */}
                <div className="bg-white rounded-xl border border-[#E4E9F0] p-5 shadow-sm space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#0F2B46] text-white">
                          Rodada #{activeRodada.numero_rodada}
                        </span>
                        <h3 className="text-base font-bold text-gray-900">
                          {activeRodada.expand?.empreendimento?.nome_empreendimento ||
                            snap.identificacao.cartao.segurado}
                        </h3>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          <strong>Arquivo de Origem:</strong> {activeRodada.arquivo_origem}
                        </span>
                        <span>•</span>
                        <span>
                          <strong>Data da Rodada:</strong>{' '}
                          {formatDate(activeRodada.data_rodada || activeRodada.created)}
                        </span>
                        {activeRodada.usuario_email && (
                          <>
                            <span>•</span>
                            <span>
                              <strong>Operador:</strong> {activeRodada.usuario_email}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                          activeRodada.desfecho === 'RENOVACAO'
                            ? 'bg-blue-100 text-[#16578B]'
                            : activeRodada.desfecho === 'NOVO_PRODUTO'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {activeRodada.desfecho === 'RENOVACAO'
                          ? 'Renovação'
                          : activeRodada.desfecho === 'NOVO_PRODUTO'
                            ? 'Novo Produto'
                            : 'Cliente Novo'}
                      </span>
                    </div>
                  </div>

                  {/* Badges de Resumo Técnico */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-center">
                      <div className="text-base font-bold text-gray-800">
                        {snap.coberturas.casadas.length}
                      </div>
                      <div className="text-[10px] font-semibold text-gray-500 uppercase">
                        Coberturas Casadas
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 text-center">
                      <div className="text-base font-bold text-amber-800">
                        {snap.coberturas.soNoCartao.length}
                      </div>
                      <div className="text-[10px] font-semibold text-amber-700 uppercase">
                        Só no Cartão
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-center">
                      <div className="text-base font-bold text-[#16578B]">
                        {snap.coberturas.soNaApolice.length}
                      </div>
                      <div className="text-[10px] font-semibold text-[#0F2B46] uppercase">
                        Só na Apólice
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-red-50/70 border border-red-200 text-center">
                      <div className="text-base font-bold text-red-700">
                        {activeRodada.total_ressalvas_c5 || 0}
                      </div>
                      <div className="text-[10px] font-semibold text-red-700 uppercase">
                        Ressalvas C5
                      </div>
                    </div>
                  </div>

                  {/* Informação de salvaguarda */}
                  <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-200 text-[11px] text-blue-900 flex items-center justify-between">
                    <div>
                      🛡️ <strong>Regra de Integridade Técnica:</strong> Os dados da apólice vigente
                      não foram sobrescritos. O Cartão de Risco é mantido como fonte de origem
                      auditável.
                    </div>
                    <div className="font-semibold text-blue-700">Etapa 0 + Etapa 1 Ativas</div>
                  </div>
                </div>

                {/* Abas de Navegação Detalhada */}
                <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
                  <div className="border-b border-[#E4E9F0] px-4 flex flex-wrap gap-2">
                    {[
                      {
                        id: 'coberturas',
                        label: `Coberturas (${snap.coberturas.casadas.length + snap.coberturas.soNoCartao.length + snap.coberturas.soNaApolice.length})`,
                      },
                      { id: 'vrd', label: `VRD por Rubrica (${snap.vrdPorRubrica.length})` },
                      { id: 'identificacao', label: 'Identificação & Apólice' },
                      { id: 'premios', label: 'Prêmio & Valores' },
                      {
                        id: 'sinistros',
                        label: `Sinistros Declarados (${snap.sinistros.totalCartao})`,
                      },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setTabAtiva(tab.id as any)}
                        className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                          tabAtiva === tab.id
                            ? 'border-[#16578B] text-[#16578B] bg-blue-50/40'
                            : 'border-transparent text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* CONTEÚDO DAS ABAS */}
                  <div className="p-4">
                    {/* TAB 1: COBERTURAS LINHA A LINHA CASADAS PELA CATEGORIA NORMALIZADA */}
                    {tabAtiva === 'coberturas' && (
                      <div className="space-y-6">
                        {/* Seção 1: Casadas */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>
                                Coberturas Casadas pela Matriz ({snap.coberturas.casadas.length})
                              </span>
                            </h4>
                            <span className="text-[11px] text-gray-500">
                              Pareamento por categoria normalizada da Matriz P&C
                            </span>
                          </div>

                          <div className="overflow-x-auto border border-gray-200 rounded-lg">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                                <tr>
                                  <th className="py-2.5 px-3">Categoria Normalizada</th>
                                  <th className="py-2.5 px-3 text-right">LMI no Cartão (Origem)</th>
                                  <th className="py-2.5 px-3 text-right">LMI na Apólice (Final)</th>
                                  <th className="py-2.5 px-3 text-right">Diferença</th>
                                  <th className="py-2.5 px-3 text-right">% Desvio</th>
                                  <th className="py-2.5 px-3">Franquia / POS</th>
                                  <th className="py-2.5 px-3 text-center w-28">Candidato C5</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {snap.coberturas.casadas.length === 0 ? (
                                  <tr>
                                    <td colSpan={7} className="py-4 text-center text-gray-400">
                                      Nenhuma cobertura casada diretamente por categoria
                                      normalizada.
                                    </td>
                                  </tr>
                                ) : (
                                  snap.coberturas.casadas.map((item) => {
                                    const isDiv = item.divergente
                                    const isCandidato = item.candidatoRessalvaC5
                                    return (
                                      <tr
                                        key={item.id}
                                        className={`transition-colors ${
                                          isDiv
                                            ? 'bg-amber-50/40 hover:bg-amber-50/70'
                                            : 'hover:bg-gray-50'
                                        }`}
                                      >
                                        <td className="py-2.5 px-3">
                                          <div className="font-semibold text-gray-900">
                                            {item.categoriaNormalizada}
                                          </div>
                                          {item.nomeCartao &&
                                            item.nomeCartao !== item.categoriaNormalizada && (
                                              <div className="text-[10px] text-gray-500">
                                                Cartão: {item.nomeCartao}
                                              </div>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono text-gray-700">
                                          {item.lmiCartao !== null
                                            ? formatCurrency(item.lmiCartao)
                                            : '—'}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                                          {item.lmiApolice !== null
                                            ? formatCurrency(item.lmiApolice)
                                            : '—'}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono">
                                          {item.diferencaLmi !== null ? (
                                            <span
                                              className={
                                                item.diferencaLmi === 0
                                                  ? 'text-gray-500'
                                                  : item.diferencaLmi > 0
                                                    ? 'text-emerald-700 font-semibold'
                                                    : 'text-red-700 font-semibold'
                                              }
                                            >
                                              {item.diferencaLmi > 0 ? '+' : ''}
                                              {formatCurrency(item.diferencaLmi)}
                                            </span>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono">
                                          {item.percentualDesvio !== null ? (
                                            <span
                                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                item.percentualDesvio === 0
                                                  ? 'bg-gray-100 text-gray-600'
                                                  : Math.abs(item.percentualDesvio) > 10
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-amber-100 text-amber-800'
                                              }`}
                                            >
                                              {item.percentualDesvio > 0 ? '+' : ''}
                                              {item.percentualDesvio}%
                                            </span>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-gray-600 text-[11px] max-w-[160px] truncate">
                                          {item.franquiaApolice || item.franquiaCartao || '—'}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                          <button
                                            type="button"
                                            disabled={togglingRessalva === item.id}
                                            onClick={() =>
                                              handleToggleRessalva(item.id, isCandidato)
                                            }
                                            className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1 mx-auto ${
                                              isCandidato
                                                ? 'bg-red-600 text-white hover:bg-red-700 shadow-xs'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                          >
                                            {togglingRessalva === item.id ? (
                                              <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <Tag className="w-3 h-3" />
                                            )}
                                            <span>{isCandidato ? 'Ressalva C5' : 'Marcar'}</span>
                                          </button>
                                        </td>
                                      </tr>
                                    )
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Seção 2: Só no Cartão */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                              <span>
                                Só no Cartão de Risco ({snap.coberturas.soNoCartao.length})
                              </span>
                            </h4>
                            <span className="text-[11px] text-amber-700">
                              Solicitadas pelo cliente/cartão porém AUSENTES na apólice emitida
                            </span>
                          </div>

                          <div className="overflow-x-auto border border-amber-200 bg-amber-50/20 rounded-lg">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-amber-100/50 text-amber-900 font-semibold border-b border-amber-200">
                                <tr>
                                  <th className="py-2.5 px-3">Categoria Solicitada</th>
                                  <th className="py-2.5 px-3">Nome Original no Cartão</th>
                                  <th className="py-2.5 px-3 text-right">LMI Solicitada</th>
                                  <th className="py-2.5 px-3 text-right">LMI na Apólice</th>
                                  <th className="py-2.5 px-3">Status na Apólice</th>
                                  <th className="py-2.5 px-3 text-center w-28">Candidato C5</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100">
                                {snap.coberturas.soNoCartao.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="py-3 text-center text-gray-400">
                                      Nenhuma cobertura exclusiva do Cartão de Risco.
                                    </td>
                                  </tr>
                                ) : (
                                  snap.coberturas.soNoCartao.map((item) => {
                                    // Resolve a correspondência: se gravada no snapshot, utiliza;
                                    // caso contrário, calcula dinamicamente contra as coberturas da apólice presentes no snapshot
                                    let correspondencia: CorrespondenciaApoliceLmi | null = null

                                    if (
                                      item.correspondenciaEncontrada !== undefined ||
                                      item.lmiApoliceCorrespondente !== undefined
                                    ) {
                                      const temCorr = Boolean(
                                        item.correspondenciaEncontrada ||
                                        item.lmiApoliceCorrespondente !== null,
                                      )
                                      correspondencia = {
                                        temCorrespondencia: temCorr,
                                        lmiApolice: item.lmiApoliceCorrespondente ?? null,
                                        lmiTexto:
                                          item.lmiApoliceCorrespondente !== null &&
                                          item.lmiApoliceCorrespondente !== undefined
                                            ? formatCurrency(item.lmiApoliceCorrespondente)
                                            : temCorr
                                              ? 'R$ 0,00'
                                              : 'sem correspondência',
                                        nomeApolice: item.nomeApoliceCorrespondente,
                                        franquiaApolice: item.franquiaApoliceCorrespondente,
                                        detalhe: item.motivoCorrespondencia,
                                      }
                                    } else {
                                      // Fallback dinâmico para rodadas geradas antes
                                      const candidatos = [
                                        ...snap.coberturas.casadas.map((c) => ({
                                          nomeApolice: c.nomeApolice,
                                          categoriaNormalizada: c.categoriaNormalizada,
                                          lmiApolice: c.lmiApolice,
                                          franquiaApolice: c.franquiaApolice,
                                        })),
                                        ...snap.coberturas.soNaApolice.map((c) => ({
                                          nomeApolice: c.nomeApolice,
                                          categoriaNormalizada: c.categoriaNormalizada,
                                          lmiApolice: c.lmiApolice,
                                          franquiaApolice: c.franquiaApolice,
                                        })),
                                      ]

                                      correspondencia = encontrarLmiApoliceCorrespondente(
                                        {
                                          nomeCartao: item.nomeCartao,
                                          categoriaNormalizada: item.categoriaNormalizada,
                                          lmiCartao: item.lmiCartao,
                                        },
                                        candidatos,
                                        {
                                          seguradora: snap.identificacao?.apolice?.seguradora,
                                          canonicas,
                                          sinonimos,
                                        },
                                      )
                                    }

                                    return (
                                      <tr key={item.id} className="hover:bg-amber-50/60">
                                        <td className="py-2.5 px-3 font-semibold text-gray-900">
                                          {item.categoriaNormalizada}
                                        </td>
                                        <td className="py-2.5 px-3 text-gray-700">
                                          {item.nomeCartao}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-900">
                                          {item.lmiCartao !== null
                                            ? formatCurrency(item.lmiCartao)
                                            : '—'}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono">
                                          {correspondencia.temCorrespondencia ? (
                                            <div className="flex flex-col items-end">
                                              <span className="font-bold text-[#16578B]">
                                                {correspondencia.lmiApolice !== null
                                                  ? formatCurrency(correspondencia.lmiApolice)
                                                  : 'R$ 0,00'}
                                              </span>
                                              {correspondencia.nomeApolice && (
                                                <span
                                                  className="text-[10px] text-gray-500 max-w-[140px] truncate"
                                                  title={`Equivalente na Apólice: ${correspondencia.nomeApolice}${correspondencia.detalhe ? ` (${correspondencia.detalhe})` : ''}`}
                                                >
                                                  ({correspondencia.nomeApolice})
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <span
                                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500 italic"
                                              title="Nenhuma cobertura equivalente identificada na apólice pelo leitor de equivalência"
                                            >
                                              sem correspondência
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-red-600 font-semibold text-[11px]">
                                          <div className="flex flex-col">
                                            <span>Não contratada na Apólice</span>
                                            {correspondencia.temCorrespondencia && (
                                              <span className="text-[10px] text-emerald-700 font-normal mt-0.5">
                                                Possível falso positivo de nomenclatura
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                          <button
                                            type="button"
                                            disabled={togglingRessalva === item.id}
                                            onClick={() =>
                                              handleToggleRessalva(
                                                item.id,
                                                item.candidatoRessalvaC5,
                                              )
                                            }
                                            className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1 mx-auto ${
                                              item.candidatoRessalvaC5
                                                ? 'bg-red-600 text-white hover:bg-red-700 shadow-xs'
                                                : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                                            }`}
                                          >
                                            {togglingRessalva === item.id ? (
                                              <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <Tag className="w-3 h-3" />
                                            )}
                                            <span>
                                              {item.candidatoRessalvaC5 ? 'Ressalva C5' : 'Marcar'}
                                            </span>
                                          </button>
                                        </td>
                                      </tr>
                                    )
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Seção 3: Só na Apólice */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                              <Shield className="w-4 h-4 text-[#16578B]" />
                              <span>
                                Só na Apólice Emitida ({snap.coberturas.soNaApolice.length})
                              </span>
                            </h4>
                            <span className="text-[11px] text-blue-700">
                              Emitidas pela seguradora sem solicitação explícita no Cartão de Risco
                            </span>
                          </div>

                          <div className="overflow-x-auto border border-blue-200 bg-blue-50/20 rounded-lg">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-blue-100/50 text-[#0F2B46] font-semibold border-b border-blue-200">
                                <tr>
                                  <th className="py-2.5 px-3">Categoria Normalizada</th>
                                  <th className="py-2.5 px-3">Nome na Apólice</th>
                                  <th className="py-2.5 px-3 text-right">LMI Emitida</th>
                                  <th className="py-2.5 px-3">Franquia Emitida</th>
                                  <th className="py-2.5 px-3 text-center w-28">Candidato C5</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-blue-100">
                                {snap.coberturas.soNaApolice.length === 0 ? (
                                  <tr>
                                    <td colSpan={5} className="py-3 text-center text-gray-400">
                                      Nenhuma cobertura exclusiva da Apólice.
                                    </td>
                                  </tr>
                                ) : (
                                  snap.coberturas.soNaApolice.map((item) => (
                                    <tr key={item.id} className="hover:bg-blue-50/60">
                                      <td className="py-2.5 px-3 font-semibold text-gray-900">
                                        {item.categoriaNormalizada}
                                      </td>
                                      <td className="py-2.5 px-3 text-gray-700">
                                        {item.nomeApolice}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[#16578B]">
                                        {item.lmiApolice !== null
                                          ? formatCurrency(item.lmiApolice)
                                          : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-gray-600 text-[11px]">
                                        {item.franquiaApolice || '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        <button
                                          type="button"
                                          disabled={togglingRessalva === item.id}
                                          onClick={() =>
                                            handleToggleRessalva(item.id, item.candidatoRessalvaC5)
                                          }
                                          className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1 mx-auto ${
                                            item.candidatoRessalvaC5
                                              ? 'bg-red-600 text-white hover:bg-red-700 shadow-xs'
                                              : 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                                          }`}
                                        >
                                          {togglingRessalva === item.id ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Tag className="w-3 h-3" />
                                          )}
                                          <span>
                                            {item.candidatoRessalvaC5 ? 'Ressalva C5' : 'Marcar'}
                                          </span>
                                        </button>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 2: VRD POR RUBRICA */}
                    {tabAtiva === 'vrd' && (
                      <div className="space-y-4">
                        <div className="text-xs text-gray-600">
                          Comparativo detalhado de Valor em Risco Declarado (VRD) e Limite Máximo de
                          Indenização (LMI) Básica entre a origem e o documento emitido.
                        </div>

                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                              <tr>
                                <th className="py-2.5 px-3">Rubrica de Avaliação</th>
                                <th className="py-2.5 px-3 text-right">Valor no Cartão (XLSX)</th>
                                <th className="py-2.5 px-3 text-right">
                                  Valor na Apólice (PDF/Base)
                                </th>
                                <th className="py-2.5 px-3 text-right">Diferença Absoluta</th>
                                <th className="py-2.5 px-3 text-right">% Desvio</th>
                                <th className="py-2.5 px-3 text-center">Diagnóstico</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {snap.vrdPorRubrica.map((r, idx) => (
                                <tr
                                  key={idx}
                                  className={
                                    r.divergente
                                      ? 'bg-amber-50/50 hover:bg-amber-50/80'
                                      : 'hover:bg-gray-50'
                                  }
                                >
                                  <td className="py-2.5 px-3 font-semibold text-gray-900">
                                    {r.rubrica}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-gray-700">
                                    {r.valorCartao !== null ? formatCurrency(r.valorCartao) : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                                    {r.valorApolice !== null ? formatCurrency(r.valorApolice) : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono">
                                    {r.diferenca !== null ? (
                                      <span
                                        className={
                                          r.diferenca === 0
                                            ? 'text-gray-500'
                                            : r.diferenca > 0
                                              ? 'text-emerald-700 font-semibold'
                                              : 'text-red-700 font-semibold'
                                        }
                                      >
                                        {r.diferenca > 0 ? '+' : ''}
                                        {formatCurrency(r.diferenca)}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono">
                                    {r.percentualDesvio !== null ? (
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                          r.percentualDesvio === 0
                                            ? 'bg-gray-100 text-gray-600'
                                            : Math.abs(r.percentualDesvio) > 10
                                              ? 'bg-red-100 text-red-800'
                                              : 'bg-amber-100 text-amber-800'
                                        }`}
                                      >
                                        {r.percentualDesvio > 0 ? '+' : ''}
                                        {r.percentualDesvio}%
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    {r.divergente ? (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                        Divergente
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                        Conforme
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* TAB 3: IDENTIFICAÇÃO LADO A LADO */}
                    {tabAtiva === 'identificacao' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Cartão de Risco */}
                          <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/30 space-y-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-blue-200">
                              <FileSpreadsheet className="w-4 h-4 text-[#16578B]" />
                              <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                                Cartão de Risco (Origem)
                              </h4>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              <div>
                                <span className="text-gray-500">Segurado:</span>{' '}
                                <strong className="text-gray-900">
                                  {snap.identificacao.cartao.segurado}
                                </strong>
                              </div>
                              <div>
                                <span className="text-gray-500">CNPJ:</span>{' '}
                                <span className="font-mono text-gray-800">
                                  {formatCnpj(snap.identificacao.cartao.cnpj) || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Seguradora Indicada:</span>{' '}
                                <span className="text-gray-800">
                                  {snap.identificacao.cartao.seguradora}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Nº Apólice Anterior/Ref:</span>{' '}
                                <span className="font-mono text-gray-800">
                                  {snap.identificacao.cartao.numeroReferencia}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Período Vigência:</span>{' '}
                                <span className="text-gray-800">
                                  {formatDate(snap.identificacao.cartao.vigenciaInicio)} a{' '}
                                  {formatDate(snap.identificacao.cartao.vigenciaFim)}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Ramo / Produto:</span>{' '}
                                <span className="text-gray-800">
                                  {snap.identificacao.cartao.ramo}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Apólice Emitida */}
                          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                              <FileText className="w-4 h-4 text-[#0F2B46]" />
                              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                                Apólice Emitida (Documento Final)
                              </h4>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              <div>
                                <span className="text-gray-500">Segurado na Apólice:</span>{' '}
                                <strong className="text-gray-900">
                                  {snap.identificacao.apolice.segurado || '—'}
                                </strong>
                              </div>
                              <div>
                                <span className="text-gray-500">CNPJ:</span>{' '}
                                <span className="font-mono text-gray-800">
                                  {formatCnpj(snap.identificacao.apolice.cnpj) || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Seguradora Emitente:</span>{' '}
                                <span className="text-gray-800">
                                  {snap.identificacao.apolice.seguradora || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Nº da Apólice:</span>{' '}
                                <span className="font-mono text-gray-800 font-bold">
                                  {snap.identificacao.apolice.numeroApolice || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Vigência Apólice:</span>{' '}
                                <span className="text-gray-800">
                                  {formatDate(snap.identificacao.apolice.vigenciaInicio)} a{' '}
                                  {formatDate(snap.identificacao.apolice.vigenciaFim)}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Ramo Emitido:</span>{' '}
                                <span className="text-gray-800">
                                  {snap.identificacao.apolice.ramo || '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Divergências de identificação */}
                        {snap.identificacao.divergenciasIdentificacao.length > 0 && (
                          <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50/60 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                              <span>Divergências Cadastrais Identificadas:</span>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              {snap.identificacao.divergenciasIdentificacao.map((d, idx) => (
                                <div
                                  key={idx}
                                  className="p-2 bg-white rounded border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                                >
                                  <div>
                                    <strong className="text-gray-900">{d.campo}:</strong>{' '}
                                    <span className="text-gray-600">{d.descricao}</span>
                                  </div>
                                  <div className="shrink-0 flex items-center gap-1.5 font-mono text-[11px]">
                                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                      {d.valorCartao || '—'}
                                    </span>
                                    <span className="text-gray-400">vs</span>
                                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-[#16578B] font-bold">
                                      {d.valorApolice || '—'}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 4: PRÊMIOS */}
                    {tabAtiva === 'premios' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
                            <div className="text-xs font-bold text-gray-700 uppercase">
                              Prêmio Líquido (Apólice)
                            </div>
                            <div className="text-2xl font-bold font-mono text-gray-900">
                              {snap.premios.premioLiquidoApolice !== null
                                ? formatCurrency(snap.premios.premioLiquidoApolice)
                                : 'Não informado'}
                            </div>
                            <p className="text-[11px] text-gray-500">
                              Valor do prêmio emitido sem incidência de IOF e taxas.
                            </p>
                          </div>

                          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
                            <div className="text-xs font-bold text-gray-700 uppercase">
                              Prêmio Total (Apólice)
                            </div>
                            <div className="text-2xl font-bold font-mono text-[#16578B]">
                              {snap.premios.premioTotalApolice !== null
                                ? formatCurrency(snap.premios.premioTotalApolice)
                                : 'Não informado'}
                            </div>
                            <p className="text-[11px] text-gray-500">
                              Valor total da fatura da apólice incluindo IOF e custos.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 5: SINISTROS DECLARADOS */}
                    {tabAtiva === 'sinistros' && (
                      <div className="space-y-4">
                        <div className="text-xs text-gray-600">
                          Histórico de sinistralidade capturado no Cartão de Risco dos últimos 5
                          anos.
                        </div>

                        {snap.sinistros.itensCartao.length === 0 ? (
                          <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-lg">
                            Nenhum sinistro declarado no Cartão de Risco para este risco.
                          </div>
                        ) : (
                          <div className="overflow-x-auto border border-gray-200 rounded-lg">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                                <tr>
                                  <th className="py-2.5 px-3 w-20">Ano</th>
                                  <th className="py-2.5 px-3">Cobertura Acionada</th>
                                  <th className="py-2.5 px-3">Descrição Declarada</th>
                                  <th className="py-2.5 px-3 text-right">Valor Indenizado</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {snap.sinistros.itensCartao.map((s, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50">
                                    <td className="py-2.5 px-3 font-bold text-gray-900">{s.ano}</td>
                                    <td className="py-2.5 px-3 font-semibold text-[#16578B]">
                                      {s.cobertura}
                                    </td>
                                    <td className="py-2.5 px-3 text-gray-700">{s.descricao}</td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">
                                      {s.valor !== null ? formatCurrency(s.valor) : 'Em apuração'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-[#E4E9F0] p-12 text-center text-gray-400 text-xs">
                Selecione uma rodada de auditoria no menu lateral.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
