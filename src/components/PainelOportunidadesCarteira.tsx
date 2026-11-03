import React, { useState, useEffect } from 'react'
import {
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  ShieldAlert,
  Scale,
  Percent,
  CalendarClock,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  BookmarkCheck,
  EyeOff,
  Filter,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  TipoOportunidade,
  VigenciaStatus,
  ApoliceItemOportunidade,
  OportunidadeComercial,
  LimiaresCalibracao,
  LIMIARES_DEFAULT,
  METADADOS_TIPOS,
  executarVarreduraCarteira,
  descartarOportunidade,
  registrarOportunidadeManualmente,
} from '@/services/analiticoCarteiraService'
import { Cpu, Bot, Building2, FileText, AlertTriangle, Clock } from 'lucide-react'

export function PainelOportunidadesCarteira() {
  const [loading, setLoading] = useState(false)
  const [oportunidades, setOportunidades] = useState<OportunidadeComercial[]>([])
  const [origemVarredura, setOrigemVarredura] = useState<string>('')
  const [filtroTipo, setFiltroTipo] = useState<TipoOportunidade | 'todos'>('todos')
  const [filtroVigencia, setFiltroVigencia] = useState<VigenciaStatus | 'todas'>('todas')
  const [exibirDescartadas, setExibirDescartadas] = useState(false)
  const [mostrarCalibracao, setMostrarCalibracao] = useState(false)
  const [limiares, setLimiares] = useState<LimiaresCalibracao>(LIMIARES_DEFAULT)
  const [mensagemAcao, setMensagemAcao] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(
    null,
  )

  const carregarVarredura = async (foco: TipoOportunidade | 'todos' = filtroTipo) => {
    setLoading(true)
    setMensagemAcao(null)
    try {
      const res = await executarVarreduraCarteira(foco, limiares)
      setOportunidades(res.oportunidades || [])
      setOrigemVarredura(res.origem || 'agente_nativo_analitico')
    } catch (err: any) {
      console.error('Erro na varredura:', err)
      setMensagemAcao({
        tipo: 'erro',
        texto: 'Não foi possível completar a varredura assistida: ' + (err.message || String(err)),
      })
    } finally {
      setLoading(false)
    }
  }

  // Auto-carrega no primeiro render
  useEffect(() => {
    carregarVarredura('todos')
  }, [])

  const handleDescartar = (idTemp: string) => {
    descartarOportunidade(idTemp)
    setOportunidades((prev) =>
      prev.map((op) => (op.id_temp === idTemp ? { ...op, descartada: true } : op)),
    )
    setMensagemAcao({
      tipo: 'ok',
      texto: 'Oportunidade descartada da sua visão operacional.',
    })
  }

  const handleRegistrar = async (op: OportunidadeComercial) => {
    setLoading(true)
    const res = await registrarOportunidadeManualmente(op)
    setLoading(false)
    if (res.ok) {
      setOportunidades((prev) =>
        prev.map((item) => (item.id_temp === op.id_temp ? { ...item, registrada: true } : item)),
      )
      setMensagemAcao({
        tipo: 'ok',
        texto: res.mensagem,
      })
    } else {
      setMensagemAcao({
        tipo: 'erro',
        texto: res.mensagem,
      })
    }
  }

  // Ícones dinâmicos por tipo
  const renderIcone = (tipo: TipoOportunidade) => {
    switch (tipo) {
      case 'cobertura_abaixo_padrao':
        return <ShieldAlert className="w-4 h-4 text-rose-600" />
      case 'lmg_lei_15040':
        return <Scale className="w-4 h-4 text-indigo-600" />
      case 'franquias_fora_usual':
        return <Percent className="w-4 h-4 text-amber-600" />
      case 'vencimento_sem_movimentacao':
        return <CalendarClock className="w-4 h-4 text-orange-600" />
      case 'sem_estudo_mercado':
        return <FileSpreadsheet className="w-4 h-4 text-teal-600" />
      default:
        return <Sparkles className="w-4 h-4 text-blue-600" />
    }
  }

  // Render do badge colorido de vigência (Requisito 5)
  // verde: vigente | âmbar/vermelho: vencida até 30 dias | azul: renovação em andamento
  const renderBadgeVigencia = (
    status: VigenciaStatus,
    diasRestantes: number | null,
    detalhe?: string,
  ) => {
    switch (status) {
      case 'em_renovacao':
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200"
            title="Procedimento de renovação em andamento com RFQ aberto no ciclo"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
            <span>Renovação em Andamento</span>
          </span>
        )
      case 'vencida_recente': {
        const dias = diasRestantes !== null ? Math.abs(diasRestantes) : 0
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
            title={detalhe || `Vencida há ${dias} dias (tolerância máx 30 dias)`}
          >
            <AlertTriangle className="w-3 h-3 text-amber-700" />
            <span>Vencida há {dias}d (≤30d)</span>
          </span>
        )
      }
      case 'vigente':
      default:
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
            title={detalhe || 'Apólice vigente com cobertura ativa'}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            <span>
              {diasRestantes !== null && diasRestantes >= 0
                ? `Vigente (${diasRestantes}d)`
                : 'Vigente'}
            </span>
          </span>
        )
    }
  }

  // Filtragem da lista
  const oportunidadesFiltradas = oportunidades.filter((op) => {
    if (!exibirDescartadas && op.descartada) return false
    if (filtroTipo !== 'todos' && op.tipo !== filtroTipo) return false

    // Filtro por vigência (Requisito 5)
    if (filtroVigencia !== 'todas') {
      const apolices = op.apolices_afetadas || []
      if (apolices.length === 0) {
        if (filtroVigencia === 'em_renovacao' && !op.em_renovacao) return false
        if (filtroVigencia !== 'em_renovacao') return false
      } else {
        const temComStatus = apolices.some((a) => a.vigenciaStatus === filtroVigencia)
        if (!temComStatus) return false
      }
    }

    return true
  })

  // Contadores por tipo
  const contadores = {
    todos: oportunidades.filter((o) => (exibirDescartadas ? true : !o.descartada)).length,
    cobertura_abaixo_padrao: oportunidades.filter(
      (o) => o.tipo === 'cobertura_abaixo_padrao' && (exibirDescartadas ? true : !o.descartada),
    ).length,
    lmg_lei_15040: oportunidades.filter(
      (o) => o.tipo === 'lmg_lei_15040' && (exibirDescartadas ? true : !o.descartada),
    ).length,
    franquias_fora_usual: oportunidades.filter(
      (o) => o.tipo === 'franquias_fora_usual' && (exibirDescartadas ? true : !o.descartada),
    ).length,
    vencimento_sem_movimentacao: oportunidades.filter(
      (o) => o.tipo === 'vencimento_sem_movimentacao' && (exibirDescartadas ? true : !o.descartada),
    ).length,
    sem_estudo_mercado: oportunidades.filter(
      (o) => o.tipo === 'sem_estudo_mercado' && (exibirDescartadas ? true : !o.descartada),
    ).length,
  }

  return (
    <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden space-y-0">
      {/* Cabeçalho do Agente Analítico */}
      <div className="p-5 border-b border-[#E4E9F0] bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0F2B46] to-[#16578B] text-white flex items-center justify-center shadow-sm shrink-0 mt-0.5">
            <Sparkles className="w-5 h-5 text-blue-200" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-900 tracking-tight">
                Detecção de Oportunidades na Carteira
              </h2>
              {/* Indicador Visível da Origem da Varredura (Requisito 3) */}
              {origemVarredura === 'agente_nativo_analitico' ? (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-300 shadow-sm"
                  title="Varredura processada pelo Agente Analítico Nativo (Skip Cloud)"
                >
                  <Bot className="w-3 h-3 text-purple-700" />
                  <span>Origem: Agente IA (Skip Cloud)</span>
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300 shadow-sm"
                  title="Varredura processada pelo Motor de Regras Determinístico Bycor"
                >
                  <Cpu className="w-3 h-3 text-blue-700" />
                  <span>Origem: Regra Determinística (Bycor Engine)</span>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-0.5 max-w-2xl">
              Varredura que cruza apólices, propostas, coberturas e prazos de Hotéis & Resorts para
              apontar oportunidades comerciais estruturadas por conta.
            </p>
          </div>
        </div>

        {/* Botões de Ação do Cabeçalho */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMostrarCalibracao(!mostrarCalibracao)}
            className="text-xs h-9 border-gray-300 text-gray-700 hover:bg-gray-50"
            title="Calibração de Limiares do Analista"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-gray-600" />
            <span>Calibrar Limiares</span>
            {mostrarCalibracao ? (
              <ChevronUp className="w-3.5 h-3.5 ml-1" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-1" />
            )}
          </Button>

          <Button
            size="sm"
            onClick={() => carregarVarredura(filtroTipo)}
            disabled={loading}
            className="bg-[#0F2B46] hover:bg-[#16578B] text-white font-semibold text-xs h-9 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Varrendo Carteira...' : 'Executar Nova Varredura'}</span>
          </Button>
        </div>
      </div>

      {/* Painel de Calibração dos Limiares (Evolução com o Analista) */}
      {mostrarCalibracao && (
        <div className="p-4 bg-slate-50 border-b border-[#E4E9F0] text-xs text-gray-700 animate-in fade-in">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-gray-900 flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-[#16578B]" />
              Parâmetros e Limiares de Sensibilidade do Analista
            </span>
            <span className="text-[11px] text-gray-500">
              Ajuste para calibrar a sensibilidade da IA aos padrões da sua mesa de subscrição
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Horizonte de Vencimento
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={15}
                  max={120}
                  step={15}
                  value={limiares.diasVencimento}
                  onChange={(e) =>
                    setLimiares({ ...limiares, diasVencimento: Number(e.target.value) || 60 })
                  }
                  className="w-20 px-2 py-1 border rounded text-xs text-gray-900 font-bold"
                />
                <span className="text-[11px] text-gray-500">dias</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Apólices sem RFQ até esse prazo</p>
            </div>

            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Teto Aceitável de P.O.S.
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={30}
                  step={5}
                  value={limiares.posMaxPercent}
                  onChange={(e) =>
                    setLimiares({ ...limiares, posMaxPercent: Number(e.target.value) || 15 })
                  }
                  className="w-20 px-2 py-1 border rounded text-xs text-gray-900 font-bold"
                />
                <span className="text-[11px] text-gray-500">%</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Acima disso acusa franquia fora do usual
              </p>
            </div>

            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Razão LMI/VRD Mínima
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0.5}
                  max={1.0}
                  step={0.1}
                  value={limiares.minimoRazaoLmiVr}
                  onChange={(e) =>
                    setLimiares({ ...limiares, minimoRazaoLmiVr: Number(e.target.value) || 1.0 })
                  }
                  className="w-20 px-2 py-1 border rounded text-xs text-gray-900 font-bold"
                />
                <span className="text-[11px] text-gray-500">fator (1.0 = 100%)</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Abaixo disso alerta subseguro/rateio</p>
            </div>

            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Recência do Estudo (C4)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={3}
                  max={24}
                  step={3}
                  value={limiares.mesesSemEstudo}
                  onChange={(e) =>
                    setLimiares({ ...limiares, mesesSemEstudo: Number(e.target.value) || 12 })
                  }
                  className="w-20 px-2 py-1 border rounded text-xs text-gray-900 font-bold"
                />
                <span className="text-[11px] text-gray-500">meses</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Contas sem apresentação formal</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLimiares(LIMIARES_DEFAULT)}
              className="text-xs h-7 text-gray-500"
            >
              Restaurar Padrões Bycor
            </Button>
            <Button
              size="sm"
              onClick={() => carregarVarredura(filtroTipo)}
              className="text-xs h-7 bg-[#16578B] text-white"
            >
              Aplicar e Recalcular
            </Button>
          </div>
        </div>
      )}

      {/* Alerta de Mensagem de Feedback */}
      {mensagemAcao && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-between ${
            mensagemAcao.tipo === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-100'
              : 'bg-rose-50 text-rose-800 border-b border-rose-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {mensagemAcao.tipo === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600" />
            )}
            <span>{mensagemAcao.texto}</span>
          </div>
          <button
            onClick={() => setMensagemAcao(null)}
            className="text-gray-400 hover:text-gray-600 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Barra de Filtros dos 5 Tipos Pedidos */}
      <div className="p-4 border-b border-[#E4E9F0] flex flex-wrap items-center justify-between gap-3 bg-gray-50/50">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFiltroTipo('todos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filtroTipo === 'todos'
                ? 'bg-[#0F2B46] text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            Todas as Oportunidades ({contadores.todos})
          </button>

          <button
            onClick={() => setFiltroTipo('cobertura_abaixo_padrao')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              filtroTipo === 'cobertura_abaixo_padrao'
                ? 'bg-rose-700 text-white shadow-sm font-bold'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-rose-50'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
            <span>(1) Cobertura Abaixo Padrão ({contadores.cobertura_abaixo_padrao})</span>
          </button>

          <button
            onClick={() => setFiltroTipo('lmg_lei_15040')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              filtroTipo === 'lmg_lei_15040'
                ? 'bg-indigo-700 text-white shadow-sm font-bold'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-indigo-50'
            }`}
          >
            <Scale className="w-3.5 h-3.5 text-indigo-600" />
            <span>(2) LMG x Lei 15.040/2024 ({contadores.lmg_lei_15040})</span>
          </button>

          <button
            onClick={() => setFiltroTipo('franquias_fora_usual')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              filtroTipo === 'franquias_fora_usual'
                ? 'bg-amber-700 text-white shadow-sm font-bold'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-amber-50'
            }`}
          >
            <Percent className="w-3.5 h-3.5 text-amber-600" />
            <span>(3) Franquias Fora do Usual ({contadores.franquias_fora_usual})</span>
          </button>

          <button
            onClick={() => setFiltroTipo('vencimento_sem_movimentacao')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              filtroTipo === 'vencimento_sem_movimentacao'
                ? 'bg-orange-700 text-white shadow-sm font-bold'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-orange-50'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5 text-orange-600" />
            <span>(4) Vencimento Estagnado ({contadores.vencimento_sem_movimentacao})</span>
          </button>

          <button
            onClick={() => setFiltroTipo('sem_estudo_mercado')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              filtroTipo === 'sem_estudo_mercado'
                ? 'bg-teal-700 text-white shadow-sm font-bold'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-teal-50'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />
            <span>(5) Sem Estudo Recente ({contadores.sem_estudo_mercado})</span>
          </button>
        </div>

        {/* Toggle para exibir descartadas e filtro visual de vigência (Requisito 5) */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5 text-xs">
            <span className="px-2 text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-gray-400" />
              Vigência:
            </span>
            <button
              onClick={() => setFiltroVigencia('todas')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                filtroVigencia === 'todas'
                  ? 'bg-gray-800 text-white font-bold'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setFiltroVigencia('vigente')}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                filtroVigencia === 'vigente'
                  ? 'bg-emerald-700 text-white font-bold'
                  : 'text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Vigentes
            </button>
            <button
              onClick={() => setFiltroVigencia('em_renovacao')}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                filtroVigencia === 'em_renovacao'
                  ? 'bg-blue-700 text-white font-bold'
                  : 'text-blue-700 hover:bg-blue-50'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Em Renovação
            </button>
            <button
              onClick={() => setFiltroVigencia('vencida_recente')}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                filtroVigencia === 'vencida_recente'
                  ? 'bg-amber-700 text-white font-bold'
                  : 'text-amber-800 hover:bg-amber-50'
              }`}
            >
              <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
              Vencidas (≤30d)
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={exibirDescartadas}
              onChange={(e) => setExibirDescartadas(e.target.checked)}
              className="rounded border-gray-300 text-[#16578B] focus:ring-[#16578B]"
            />
            <span>Exibir Descartadas</span>
          </label>
        </div>
      </div>

      {/* Aviso importante de pacto do usuário: Nada grava automaticamente */}
      <div className="px-5 py-2.5 bg-blue-50/40 border-b border-blue-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-blue-900">
        <div className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>
            <strong>Sugestões Voláteis:</strong> Nenhuma oportunidade é gravada automaticamente no
            banco. Decida se deseja <strong>Descartar</strong> ou{' '}
            <strong>Registrar Manualmente</strong> cada item para acompanhamento com a equipe.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">Origem da Varredura:</span>
          {origemVarredura === 'agente_nativo_analitico' ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
              <Bot className="w-3 h-3 text-purple-600" /> Agente IA (Skip Cloud)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              <Cpu className="w-3 h-3 text-blue-600" /> Regra Determinística
            </span>
          )}
        </div>
      </div>

      {/* Lista de Oportunidades */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-xs flex flex-col items-center justify-center">
          <Sparkles className="w-8 h-8 text-blue-500 animate-pulse mb-3" />
          <p className="font-semibold text-gray-700">
            O Agente Analítico está inspecionando apólices e coberturas...
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            Avaliando padrões hoteleiros, limites da Lei 15.040 e prazos de renovação
          </p>
        </div>
      ) : oportunidadesFiltradas.length === 0 ? (
        <div className="py-16 text-center px-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
          <h4 className="text-sm font-semibold text-gray-800">
            Nenhuma oportunidade pendente nesta categoria
          </h4>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            {filtroTipo === 'todos'
              ? 'Todas as oportunidades identificadas já foram descartadas ou registradas por você.'
              : 'Nenhum desvio detectado para este critério nos parâmetros atuais de sensibilidade.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setFiltroTipo('todos')
              setExibirDescartadas(true)
            }}
            className="mt-4 text-xs h-8 text-gray-600"
          >
            Ver Histórico Completo
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {oportunidadesFiltradas.map((op) => {
            const meta = METADADOS_TIPOS[op.tipo] || {
              rotulo: op.tipo_rotulo,
              corBadge: 'bg-gray-100 text-gray-700 border-gray-200',
            }

            return (
              <div
                key={op.id_temp}
                className={`p-4 sm:p-5 transition-colors flex flex-col sm:flex-row items-start justify-between gap-4 ${
                  op.descartada
                    ? 'bg-gray-50/70 opacity-60'
                    : op.registrada
                      ? 'bg-emerald-50/40 border-l-4 border-emerald-500'
                      : 'hover:bg-blue-50/20'
                }`}
              >
                {/* Dados da Oportunidade Agrupada por Conta (Requisitos 2, 4 e 5) */}
                <div className="space-y-2.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.corBadge}`}
                    >
                      {renderIcone(op.tipo)}
                      <span>{meta.rotulo}</span>
                    </span>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        op.impacto_estimado === 'Alto'
                          ? 'bg-red-100 text-red-800'
                          : op.impacto_estimado === 'Médio'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      Impacto {op.impacto_estimado}
                    </span>

                    {/* Etiqueta Visível: Renovação em Andamento (Requisito 4) */}
                    {op.em_renovacao && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                        <span>Renovação em Andamento (RFQ Aberto)</span>
                      </span>
                    )}

                    {op.registrada && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <BookmarkCheck className="w-3 h-3" />
                        Registrada pelo Analista
                      </span>
                    )}

                    {op.descartada && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                        <EyeOff className="w-3 h-3" />
                        Descartada
                      </span>
                    )}
                  </div>

                  {/* Título do Cartão: Conta / Empreendimento */}
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-500 shrink-0" />
                    <div className="text-sm font-bold text-gray-900 tracking-tight">
                      {op.conta_nome || op.item_detectado}
                    </div>
                    {op.seguradora && op.seguradora !== 'Múltiplas' && (
                      <span className="text-xs text-gray-500 font-normal">• {op.seguradora}</span>
                    )}
                  </div>

                  {/* Justificativa de Negócio */}
                  <p className="text-xs text-gray-700 leading-relaxed max-w-3xl">
                    {op.justificativa_curta}
                  </p>

                  {/* Lista de Apólices Afetadas no Cartão Único da Conta (Requisitos 2 e 5) */}
                  {op.apolices_afetadas && op.apolices_afetadas.length > 0 && (
                    <div className="mt-2 p-2.5 bg-slate-50/90 rounded-lg border border-slate-200/80 space-y-1.5">
                      <div className="text-[11px] font-semibold text-gray-600 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-gray-500" />
                          Apólices Afetadas nesta Conta ({op.apolices_afetadas.length}):
                        </span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          Situação de Vigência
                        </span>
                      </div>

                      <div className="space-y-1">
                        {op.apolices_afetadas.map((apItem) => (
                          <div
                            key={apItem.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 bg-white rounded border border-gray-100 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-gray-900">{apItem.ramo}</span>
                              <span className="text-gray-500 font-mono text-[11px]">
                                Nº {apItem.numero}
                              </span>
                              <span className="text-gray-400 text-[11px]">
                                • {apItem.seguradora}
                              </span>
                            </div>

                            <div className="shrink-0">
                              {renderBadgeVigencia(
                                apItem.vigenciaStatus,
                                apItem.diasRestantes,
                                apItem.detalheStatus,
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-[11px] text-[#16578B] font-medium flex items-center gap-1 pt-0.5">
                    <strong>Ação sugerida:</strong> {op.acao_sugerida}
                  </div>
                </div>

                {/* Botões de Ação Humana (Manual) */}
                <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                  {!op.registrada && !op.descartada && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleRegistrar(op)}
                        className="text-xs h-8 bg-[#0F2B46] hover:bg-[#16578B] text-white shadow-sm flex items-center gap-1.5"
                      >
                        <BookmarkCheck className="w-3.5 h-3.5 text-blue-200" />
                        <span>Registrar</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDescartar(op.id_temp)}
                        className="text-xs h-8 text-gray-500 hover:text-rose-600 hover:bg-rose-50 flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Descartar</span>
                      </Button>
                    </>
                  )}

                  {op.registrada && (
                    <div className="text-right">
                      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Salva em Notas
                      </span>
                    </div>
                  )}

                  {op.descartada && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        // Reativa
                        const ids = localStorage.getItem('bycor_oportunidades_descartadas_v1')
                        if (ids) {
                          const parsed = new Set(JSON.parse(ids))
                          parsed.delete(op.id_temp)
                          localStorage.setItem(
                            'bycor_oportunidades_descartadas_v1',
                            JSON.stringify(Array.from(parsed)),
                          )
                        }
                        setOportunidades((prev) =>
                          prev.map((item) =>
                            item.id_temp === op.id_temp ? { ...item, descartada: false } : item,
                          ),
                        )
                      }}
                      className="text-xs h-7 border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      Reativar
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
