import { useState, useEffect, useMemo, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  BookOpen,
  Layers,
  Search,
  Plus,
  Edit2,
  Trash2,
  X,
  Building,
  ArrowRight,
  ShieldAlert,
  Split,
  RefreshCw,
  AlertCircle,
  Upload,
  History,
  FileText,
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
import {
  CoberturaCanonicaRecord,
  CoberturaSinonimoRecord,
  RealocacaoEventoItem,
  salvarSinonimo,
  excluirSinonimo,
  derivarEventosTipicosPadrao,
} from '@/services/equivalenciaCoberturasService'
import { SeguradoraCadastroRecord, getSeguradorasCadastro } from '@/services/seguradoraNormalizer'
import { listarSessoesPendentes, type SessaoPendenteResumo } from '@/services/cgIngestaoService'
import IngestaoCgModal from '@/components/comercial/IngestaoCgModal'

/**
 * Biblioteca de CGs — fonte de verdade das Coberturas Genéricas (canônicas) Bycor.
 *
 * Lê o que já existe nas coleções `coberturas_canonicas` e `cobertura_sinonimos`
 * (migrations 0040–0042, incluindo o caso "Danos por Água": AXA com 3 coberturas
 * distintas; Allianz/Porto embutem em Vazamento/Rompimento). Sem seed de dados:
 * a tela espelha o banco. O CRUD de sinônimos usa o mesmo `salvarSinonimo` /
 * `excluirSinonimo` do motor de equivalências (C3), garantindo que o que é
 * gravado aqui vale imediatamente para tabulação, auditoria e apresentação.
 *
 * Ingestão de CGs: botão "Ingerir CG da seguradora" (IngestaoCgModal) — sobe o
 * PDF da cia, extrai coberturas/exclusões (pág/slotY, padrão QAR), casa via
 * motor C3 e mostra fila de revisão; nada é gravado sem confirmação humana.
 */

// Categorias exibidas no filtro (derivadas do campo `ramo` da canônica).
const CATEGORIAS_FILTRO = ['Todas', 'DM', 'RC', 'LC', 'Property', 'Patrimonial']

// Cor do badge por categoria de ramo.
function corBadgeRamo(ramo: string): string {
  const norm = (ramo || '').toLowerCase()
  if (norm.includes('property')) return 'bg-purple-50 text-purple-800 border-purple-200'
  if (norm === 'rc' || norm.includes('responsabilidade'))
    return 'bg-amber-50 text-amber-800 border-amber-200'
  if (norm === 'lc' || norm.includes('lucros')) return 'bg-cyan-50 text-cyan-800 border-cyan-200'
  if (norm === 'dm' || norm.includes('danos') || norm.includes('patrimonial'))
    return 'bg-blue-50 text-[#16578B] border-blue-200'
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

export default function BibliotecaCgsPage() {
  const [canonicas, setCanonicas] = useState<CoberturaCanonicaRecord[]>([])
  const [sinonimos, setSinonimos] = useState<CoberturaSinonimoRecord[]>([])
  const [seguradorasCadastro, setSeguradorasCadastro] = useState<SeguradoraCadastroRecord[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('Todas')

  // ---- Modal de sinônimo (adicionar/editar) ----
  const [modalSinonimoAberto, setModalSinonimoAberto] = useState(false)
  const [sinonimoEmEdicaoId, setSinonimoEmEdicaoId] = useState<string | null>(null)
  const [formAlias, setFormAlias] = useState('')
  const [formSeguradoraNome, setFormSeguradoraNome] = useState('')
  const [formCanonicaNome, setFormCanonicaNome] = useState('')
  const [formEventosExcluidos, setFormEventosExcluidos] = useState<string[]>([])
  const [formRealocacoes, setFormRealocacoes] = useState<RealocacaoEventoItem[]>([])
  const [formObservacao, setFormObservacao] = useState('')
  const [novoEventoExcluido, setNovoEventoExcluido] = useState('')
  const [formRealocEvento, setFormRealocEvento] = useState('')
  const [formRealocDestino, setFormRealocDestino] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState('')

  // ---- Detalhe da CG ----
  const [detalheCanonica, setDetalheCanonica] = useState<CoberturaCanonicaRecord | null>(null)

  // ---- Modal de ingestão de CG (PDF → C3 → fila de revisão) ----
  const [modalIngestaoAberto, setModalIngestaoAberto] = useState(false)

  // ---- Painel "Sessões de ingestão pendentes" (só leitura; Retomar recarrega cg_ingestao_itens) ----
  const [sessoesPendentes, setSessoesPendentes] = useState<SessaoPendenteResumo[]>([])
  const [carregandoSessoes, setCarregandoSessoes] = useState(false)
  const [sessaoRetomarId, setSessaoRetomarId] = useState<string | null>(null)

  // ---- Carregamento ----
  const carregarDados = useCallback(async () => {
    setCarregando(true)
    setErroCarregamento('')
    try {
      const [cans, sins, segs] = await Promise.all([
        pb.collection('coberturas_canonicas').getFullList<CoberturaCanonicaRecord>({
          sort: 'ordem,nome',
        }),
        pb.collection('cobertura_sinonimos').getFullList<CoberturaSinonimoRecord>({
          sort: '-updated,-created',
        }),
        getSeguradorasCadastro(),
      ])
      setCanonicas(cans)
      setSinonimos(sins)
      setSeguradorasCadastro(segs)
    } catch (err: unknown) {
      console.error(err)
      setErroCarregamento(
        'Não foi possível carregar a biblioteca de coberturas canônicas do banco.',
      )
    }
    setCarregando(false)

    // Sessões de ingestão pendentes (painel de retomada) — falha não bloqueia a página.
    setCarregandoSessoes(true)
    try {
      setSessoesPendentes(await listarSessoesPendentes())
    } catch (err: unknown) {
      console.error('Falha ao listar sessões de ingestão pendentes', err)
      setSessoesPendentes([])
    }
    setCarregandoSessoes(false)
  }, [])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  // ---- Derivados: sinônimos por canônica e seguradoras com sinônimos ----
  const sinonimosPorCanonica = useMemo(() => {
    const mapa = new Map<string, CoberturaSinonimoRecord[]>()
    for (const sin of sinonimos) {
      const chave = sin.canonica_nome || sin.cobertura_canonica || ''
      if (!chave) continue
      const lista = mapa.get(chave) || []
      lista.push(sin)
      mapa.set(chave, lista)
    }
    return mapa
  }, [sinonimos])

  const seguradorasComSinonimos = useMemo(() => {
    const set = new Set<string>()
    for (const sin of sinonimos) {
      if (sin.seguradora_nome) set.add(sin.seguradora_nome)
    }
    return Array.from(set).sort()
  }, [sinonimos])

  // ---- Filtro/busca ----
  const canonicasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return canonicas.filter((c) => {
      const bateCategoria =
        filtroCategoria === 'Todas' ||
        (c.ramo || '').toLowerCase() === filtroCategoria.toLowerCase()
      if (!bateCategoria) return false
      if (!termo) return true
      const sinonimosDaCg = sinonimosPorCanonica.get(c.nome) || []
      return (
        c.nome.toLowerCase().includes(termo) ||
        (c.descricao || '').toLowerCase().includes(termo) ||
        (c.eventos_tipicos || []).some((ev) => ev.toLowerCase().includes(termo)) ||
        sinonimosDaCg.some(
          (s) =>
            s.alias.toLowerCase().includes(termo) ||
            (s.seguradora_nome || '').toLowerCase().includes(termo),
        )
      )
    })
  }, [canonicas, busca, filtroCategoria, sinonimosPorCanonica])

  // ---- Modal de sinônimo ----
  const abrirModalNovoSinonimo = (canonicaNome?: string) => {
    setSinonimoEmEdicaoId(null)
    setFormAlias('')
    setFormSeguradoraNome('')
    setFormCanonicaNome(canonicaNome || canonicas[0]?.nome || '')
    setFormEventosExcluidos([])
    setFormRealocacoes([])
    setFormObservacao('')
    setNovoEventoExcluido('')
    setFormRealocEvento('')
    setFormRealocDestino('')
    setErroModal('')
    setModalSinonimoAberto(true)
  }

  const abrirModalEditarSinonimo = (sin: CoberturaSinonimoRecord) => {
    setSinonimoEmEdicaoId(sin.id)
    setFormAlias(sin.alias)
    setFormSeguradoraNome(sin.seguradora_nome || '')
    setFormCanonicaNome(sin.canonica_nome || '')
    setFormEventosExcluidos(sin.eventos_excluidos || [])
    setFormRealocacoes(sin.realocacoes_evento || [])
    setFormObservacao(sin.observacao || '')
    setNovoEventoExcluido('')
    setFormRealocEvento('')
    setFormRealocDestino('')
    setErroModal('')
    setModalSinonimoAberto(true)
  }

  const handleSalvarSinonimo = async () => {
    if (!formAlias.trim() || !formCanonicaNome.trim()) {
      setErroModal('Informe o nome na seguradora (alias) e a cobertura genérica de destino.')
      return
    }
    try {
      setSalvando(true)
      setErroModal('')
      const canRec = canonicas.find((c) => c.nome === formCanonicaNome)
      await salvarSinonimo({
        id: sinonimoEmEdicaoId || undefined,
        alias: formAlias.trim(),
        seguradoraNome: formSeguradoraNome.trim(),
        coberturaCanonicaId: canRec?.id,
        canonicaNome: formCanonicaNome.trim(),
        eventosExcluidos: formEventosExcluidos,
        realocacoesEvento: formRealocacoes,
        observacao: formObservacao.trim(),
      })
      setModalSinonimoAberto(false)
      await carregarDados()
    } catch (err: unknown) {
      setErroModal('Erro ao salvar sinônimo: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const handleExcluirSinonimo = async (sin: CoberturaSinonimoRecord) => {
    const destino = sin.canonica_nome || 'a cobertura genérica'
    if (
      !confirm(
        `Remover o sinônimo "${sin.alias}"${sin.seguradora_nome ? ` da ${sin.seguradora_nome}` : ''} (→ ${destino})?`,
      )
    ) {
      return
    }
    try {
      await excluirSinonimo(sin.id)
      await carregarDados()
    } catch (err: unknown) {
      alert('Erro ao excluir sinônimo: ' + (err as Error).message)
    }
  }

  // ---- Renderização ----
  return (
    <div className="space-y-6">
      {/* Banner superior */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Gestão Comercial
            </span>
            <h2 className="text-xl font-bold text-gray-900">Biblioteca de CGs</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-3xl">
            Fonte de verdade das coberturas genéricas (canônicas) Bycor e seus sinônimos por
            seguradora. Alimenta automaticamente a tabulação (C3), a auditoria e a apresentação
            comercial — o que é gravado aqui vale para as propostas futuras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={carregarDados}
            disabled={carregando}
            className="h-9 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${carregando ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button
            size="sm"
            onClick={() => setModalIngestaoAberto(true)}
            className="h-9 text-xs bg-[#16578B] hover:bg-[#0F2B46] text-white font-semibold"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Ingerir CG da seguradora
          </Button>
          <Button
            size="sm"
            onClick={() => abrirModalNovoSinonimo()}
            className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Novo Sinônimo
          </Button>
        </div>
      </div>

      {/* Barra de busca e filtro por categoria */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm flex flex-col sm:flex-row items-center gap-3">
        <div className="relative w-full sm:flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
          <Input
            type="text"
            placeholder="Buscar por nome canônico, evento ou sinônimo de seguradora..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-9 text-xs pl-9 bg-white"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-gray-500 font-medium shrink-0">Categoria:</span>
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
            className="h-9 text-xs border rounded bg-white px-2 focus:outline-none"
          >
            {CATEGORIAS_FILTRO.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Painel: Sessões de ingestão pendentes (só leitura; Retomar recarrega a fila do banco) */}
      {!carregando && (sessoesPendentes.length > 0 || carregandoSessoes) && (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm space-y-2">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#16578B]" />
            <h3 className="text-sm font-bold text-gray-900">Sessões de ingestão pendentes</h3>
            {carregandoSessoes && <RefreshCw className="w-3 h-3 animate-spin text-gray-400" />}
          </div>
          {carregandoSessoes ? (
            <p className="text-xs text-gray-400">Carregando sessões…</p>
          ) : (
            <div className="space-y-1.5">
              {sessoesPendentes.map((s) => (
                <div
                  key={s.ingestao.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100"
                >
                  <div className="flex items-center gap-2 flex-wrap text-[11px] min-w-0">
                    <Building className="w-3 h-3 text-[#16578B] shrink-0" />
                    <span className="font-bold text-gray-900">
                      {s.ingestao.seguradora_nome ||
                        s.ingestao.expand?.seguradora?.nome ||
                        'Seguradora'}
                    </span>
                    {s.ingestao.fonte_arquivo && (
                      <span className="text-gray-500 flex items-center gap-1 min-w-0">
                        <FileText className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="truncate max-w-[16rem]" title={s.ingestao.fonte_arquivo}>
                          {s.ingestao.fonte_arquivo}
                        </span>
                      </span>
                    )}
                    {s.pendentes > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                          s.pendentes === s.total
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-blue-50 text-[#16578B] border-blue-200'
                        }`}
                      >
                        {s.pendentes} pendente(s) / {s.total} item(ns)
                      </span>
                    )}
                    {s.ingestaoIncompleta && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-800 border border-red-300"
                        title="A gravação dos itens falhou no meio (rate-limit). Retome a sessão e grave de novo — os itens já gravados não são duplicados."
                      >
                        Ingestão incompleta
                      </span>
                    )}
                    {s.certificacaoIncompleta && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-800 border border-orange-300">
                        Certificação incompleta
                      </span>
                    )}
                    {s.ingestao.produto_versao && (
                      <span className="text-gray-400">{s.ingestao.produto_versao}</span>
                    )}
                    {!s.ingestao.produto_versao && (
                      <span className="text-gray-400 italic">sem produto/versão</span>
                    )}
                    {!s.ingestao.processo_susep && (
                      <span className="text-gray-400 italic">sem processo SUSEP</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSessaoRetomarId(s.ingestao.id)
                      setModalIngestaoAberto(true)
                    }}
                    className="h-7 text-xs shrink-0"
                  >
                    Retomar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Erro de carregamento */}
      {erroCarregamento && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{erroCarregamento}</span>
        </div>
      )}

      {/* Carregando */}
      {carregando && (
        <div className="py-16 text-center text-xs text-gray-400">
          Carregando biblioteca de coberturas canônicas...
        </div>
      )}

      {/* Lista de CGs */}
      {!carregando && (
        <div className="space-y-3">
          {canonicasFiltradas.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center text-xs text-gray-400 space-y-1">
              <BookOpen className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="font-semibold text-gray-600">
                {canonicas.length === 0
                  ? 'Nenhuma cobertura genérica cadastrada ainda.'
                  : 'Nenhuma cobertura casa com a busca/filtro atual.'}
              </p>
              <p>
                As CGs são criadas nas migrations e pela tabulação (C3) — aqui você gerencia os
                sinônimos por seguradora.
              </p>
            </div>
          ) : (
            canonicasFiltradas.map((can) => {
              const sins = sinonimosPorCanonica.get(can.nome) || []
              const eventos = can.eventos_tipicos?.length
                ? can.eventos_tipicos
                : derivarEventosTipicosPadrao(can.nome)
              return (
                <div
                  key={can.id}
                  className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm p-4 space-y-3"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setDetalheCanonica(can)}
                          className="font-bold text-sm text-gray-900 hover:text-[#16578B] hover:underline text-left"
                        >
                          {can.nome}
                        </button>
                        {can.ramo && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${corBadgeRamo(can.ramo)}`}
                          >
                            {can.ramo}
                          </span>
                        )}
                        {can.origem_matriz && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                            Matriz P&C
                          </span>
                        )}
                      </div>
                      {can.descricao && (
                        <p className="text-[11px] text-gray-500">{can.descricao}</p>
                      )}
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {eventos.slice(0, 6).map((ev, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                          >
                            {ev}
                          </span>
                        ))}
                        {eventos.length > 6 && (
                          <span className="text-[10px] text-gray-400 self-center">
                            +{eventos.length - 6} eventos
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 self-end md:self-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => abrirModalNovoSinonimo(can.nome)}
                        className="h-7 text-xs"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Sinônimo
                      </Button>
                    </div>
                  </div>

                  {/* Sinônimos mapeados por seguradora */}
                  <div className="border-t border-gray-100 pt-2.5">
                    {sins.length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic">
                        Sem sinônimos mapeados para esta CG ainda.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {sins.map((sin) => (
                          <div
                            key={sin.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100"
                          >
                            <div className="flex items-center gap-2 flex-wrap text-[11px] min-w-0">
                              {sin.seguradora_nome ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-[#16578B] border border-blue-200">
                                  <Building className="w-2.5 h-2.5" />
                                  {sin.seguradora_nome}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                                  Global (Todas)
                                </span>
                              )}
                              <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                              <span className="font-bold text-gray-900">{sin.alias}</span>
                              {(sin.eventos_excluidos?.length || 0) > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                                  <ShieldAlert className="w-2.5 h-2.5 text-amber-600" />
                                  Não cobre: {sin.eventos_excluidos?.join(', ')}
                                </span>
                              )}
                              {(sin.realocacoes_evento?.length || 0) > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-900 border border-purple-200">
                                  <Split className="w-2.5 h-2.5 text-purple-600" />
                                  {sin.realocacoes_evento
                                    ?.map((r) => `${r.evento} → ${r.cobertura_destino}`)
                                    .join('; ')}
                                </span>
                              )}
                              {sin.observacao && (
                                <span
                                  className="text-gray-400 italic truncate"
                                  title={sin.observacao}
                                >
                                  Nota: {sin.observacao}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => abrirModalEditarSinonimo(sin)}
                                className="h-6 px-2 text-[11px] text-gray-600 hover:text-gray-900"
                              >
                                <Edit2 className="w-3 h-3 mr-1" />
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleExcluirSinonimo(sin)}
                                className="h-6 px-2 text-[11px] text-red-600 hover:text-red-800 hover:bg-red-50"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Modal de sinônimo (novo/editar) */}
      <Dialog open={modalSinonimoAberto} onOpenChange={setModalSinonimoAberto}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#16578B]" />
              {sinonimoEmEdicaoId ? 'Editar Sinônimo' : 'Novo Sinônimo de CG'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Associe a nomenclatura usada pela seguradora à cobertura genérica Bycor. O mapeamento
              gravado aqui é usado em toda a plataforma.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-700">
                  Nome na Seguradora (Alias) *
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: Danos por Água — Cobertura Básica"
                  value={formAlias}
                  onChange={(e) => setFormAlias(e.target.value)}
                  className="h-8 text-xs mt-1 bg-white"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-700">Seguradora</Label>
                <select
                  value={formSeguradoraNome}
                  onChange={(e) => setFormSeguradoraNome(e.target.value)}
                  className="w-full h-8 border rounded text-xs px-2 mt-1 bg-white"
                >
                  <option value="">Todas / Global</option>
                  {seguradorasCadastro.map((seg) => (
                    <option key={seg.id} value={seg.nome}>
                      {seg.nome}
                    </option>
                  ))}
                  {/* Seguradoras que só aparecem em sinônimos existentes (fora do cadastro) */}
                  {seguradorasComSinonimos
                    .filter((nome) => !seguradorasCadastro.some((s) => s.nome === nome))
                    .map((nome) => (
                      <option key={nome} value={nome}>
                        {nome}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">
                Cobertura Genérica de Destino (Bycor) *
              </Label>
              <select
                value={formCanonicaNome}
                onChange={(e) => setFormCanonicaNome(e.target.value)}
                className="w-full h-8 border rounded text-xs px-2 mt-1 bg-white font-medium"
              >
                <option value="">Selecione a CG...</option>
                {canonicas.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* Exceções: eventos não cobertos pela cia nesta rubrica */}
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg space-y-2">
              <span className="font-bold text-amber-900 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                Exceção: a cobertura da cia NÃO cobre o evento
              </span>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Ex: Queda de Aeronave"
                  value={novoEventoExcluido}
                  onChange={(e) => setNovoEventoExcluido(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const texto = novoEventoExcluido.trim()
                      if (!texto) return
                      setFormEventosExcluidos((prev) => {
                        if (prev.some((x) => x.toLowerCase() === texto.toLowerCase())) return prev
                        return [...prev, texto]
                      })
                      setNovoEventoExcluido('')
                    }
                  }}
                  className="h-7 text-xs bg-white flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const texto = novoEventoExcluido.trim()
                    if (!texto) return
                    setFormEventosExcluidos((prev) => {
                      if (prev.some((x) => x.toLowerCase() === texto.toLowerCase())) return prev
                      return [...prev, texto]
                    })
                    setNovoEventoExcluido('')
                  }}
                  className="h-7 text-xs bg-amber-800 text-white"
                >
                  Excluir Evento
                </Button>
              </div>

              {/* Sugestões: eventos típicos da CG selecionada */}
              {(() => {
                const canSel = canonicas.find((c) => c.nome === formCanonicaNome)
                const eventosSugestao = canSel?.eventos_tipicos?.length
                  ? canSel.eventos_tipicos
                  : derivarEventosTipicosPadrao(formCanonicaNome || '')
                if (eventosSugestao.length === 0) return null
                return (
                  <div className="pt-1">
                    <span className="text-[10px] text-gray-500 block mb-1">
                      Eventos típicos desta CG (clique para marcar como excluído):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {eventosSugestao.map((ev, idx) => {
                        const jaExcluido = formEventosExcluidos.includes(ev)
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (jaExcluido) {
                                setFormEventosExcluidos((p) => p.filter((x) => x !== ev))
                              } else {
                                setFormEventosExcluidos((p) => [...p, ev])
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              jaExcluido
                                ? 'bg-red-100 text-red-900 border-red-300 line-through'
                                : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'
                            }`}
                          >
                            {ev}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {formEventosExcluidos.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {formEventosExcluidos.map((ex, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-300 flex items-center gap-1"
                    >
                      <span>Não coberto: {ex}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setFormEventosExcluidos((p) => p.filter((_, i) => i !== idx))
                        }
                        className="text-red-500 hover:text-red-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Realocações de evento */}
            <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-lg space-y-2">
              <span className="font-bold text-purple-900 flex items-center gap-1.5">
                <Split className="w-3.5 h-3.5 text-purple-600" />
                Realocação: evento coberto em outra cobertura da mesma cia
              </span>
              <p className="text-[10px] text-purple-700">
                Ex.: o evento foi oferecido pela cia em rubrica específica — evita falso alarme de
                desamparo na tabulação.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  type="text"
                  placeholder="Evento (ex: Tumultos)"
                  value={formRealocEvento}
                  onChange={(e) => setFormRealocEvento(e.target.value)}
                  className="h-7 text-xs bg-white"
                />
                <select
                  value={formRealocDestino}
                  onChange={(e) => setFormRealocDestino(e.target.value)}
                  className="w-full h-7 border rounded text-xs px-2 bg-white"
                >
                  <option value="">Cobertura de destino...</option>
                  {canonicas.map((c) => (
                    <option key={c.id} value={c.nome}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const ev = formRealocEvento.trim()
                    const dest = formRealocDestino.trim()
                    if (!ev || !dest) return
                    setFormRealocacoes((prev) => {
                      const chaveNova = `${ev.toLowerCase()}___${dest.toLowerCase()}`
                      const semDuplicata = prev.filter(
                        (r) =>
                          `${r.evento.toLowerCase()}___${r.cobertura_destino.toLowerCase()}` !==
                          chaveNova,
                      )
                      return [...semDuplicata, { evento: ev, cobertura_destino: dest, motivo: '' }]
                    })
                    setFormRealocEvento('')
                    setFormRealocDestino('')
                  }}
                  className="h-7 text-xs bg-purple-800 text-white"
                >
                  Adicionar
                </Button>
              </div>

              {formRealocacoes.length > 0 && (
                <div className="space-y-1 pt-1">
                  {formRealocacoes.map((r, idx) => (
                    <div
                      key={idx}
                      className="p-1.5 rounded bg-white border border-purple-200 flex items-center justify-between text-[11px]"
                    >
                      <span>
                        Evento <strong>{r.evento}</strong> realocado para{' '}
                        <strong>{r.cobertura_destino}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setFormRealocacoes((p) => p.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-800"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">Observações Técnicas</Label>
              <Input
                type="text"
                placeholder="Ex: Pacote especial conforme condições gerais da cia 2026"
                value={formObservacao}
                onChange={(e) => setFormObservacao(e.target.value)}
                className="h-8 text-xs mt-1 bg-white"
              />
            </div>

            {erroModal && (
              <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {erroModal}
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalSinonimoAberto(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={salvando}
              onClick={handleSalvarSinonimo}
              className="h-8 text-xs bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-semibold"
            >
              {salvando ? 'Gravando...' : 'Gravar Sinônimo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de detalhe da CG */}
      <Dialog
        open={Boolean(detalheCanonica)}
        onOpenChange={(aberto) => !aberto && setDetalheCanonica(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#16578B]" />
              {detalheCanonica?.nome || 'Detalhe da CG'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Onde esta cobertura genérica é casada hoje na plataforma.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3 text-xs">
            {detalheCanonica?.descricao && (
              <p className="text-gray-600">{detalheCanonica.descricao}</p>
            )}
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Eventos típicos do pacote:
              </span>
              <div className="flex flex-wrap gap-1">
                {(detalheCanonica?.eventos_tipicos?.length
                  ? detalheCanonica.eventos_tipicos
                  : derivarEventosTipicosPadrao(detalheCanonica?.nome || '')
                ).map((ev, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Sinônimos por seguradora (
                {((detalheCanonica && sinonimosPorCanonica.get(detalheCanonica.nome)) || []).length}
                ):
              </span>
              <div className="space-y-1">
                {(detalheCanonica ? sinonimosPorCanonica.get(detalheCanonica.nome) || [] : []).map(
                  (sin) => (
                    <div
                      key={sin.id}
                      className="p-2 rounded border bg-gray-50 flex items-center gap-2 flex-wrap text-[11px]"
                    >
                      <span className="font-semibold text-[#16578B]">
                        {sin.seguradora_nome || 'Global'}
                      </span>
                      <ArrowRight className="w-3 h-3 text-gray-400" />
                      <span className="font-bold text-gray-900">{sin.alias}</span>
                    </div>
                  ),
                )}
                {detalheCanonica &&
                  (sinonimosPorCanonica.get(detalheCanonica.nome) || []).length === 0 && (
                    <p className="text-[11px] text-gray-400 italic">
                      Nenhum sinônimo mapeado para esta CG.
                    </p>
                  )}
              </div>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetalheCanonica(null)}
              className="h-8 text-xs"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de ingestão de CG (PDF → C3 → fila de revisão) */}
      <IngestaoCgModal
        open={modalIngestaoAberto}
        onOpenChange={setModalIngestaoAberto}
        canonicas={canonicas}
        seguradoras={seguradorasCadastro}
        onIngestaoConcluida={carregarDados}
        sessaoRetomarId={sessaoRetomarId}
        onRetomarSessao={(id) => setSessaoRetomarId(id)}
      />
    </div>
  )
}
