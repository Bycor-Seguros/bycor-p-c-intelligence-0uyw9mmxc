import React, { useState } from 'react'
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  Check,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Search,
  BookOpen,
  Split,
  Sparkles,
  X,
  Building,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  salvarCoberturaCanonica,
  salvarSinonimo,
  excluirSinonimo,
  excluirCoberturaCanonica,
  RealocacaoEventoItem,
  derivarEventosTipicosPadrao,
} from '@/services/equivalenciaCoberturasService'

interface PainelEquivalenciasProps {
  canonicas: CoberturaCanonicaRecord[]
  sinonimos: CoberturaSinonimoRecord[]
  seguradorasNomes: string[]
  onDataChange: () => void
}

export function PainelEquivalencias({
  canonicas,
  sinonimos,
  seguradorasNomes,
  onDataChange,
}: PainelEquivalenciasProps) {
  const [tabAtiva, setTabAtiva] = useState<'sinonimos' | 'canonicas'>('sinonimos')
  const [busca, setBusca] = useState('')
  const [filtroSeg, setFiltroSeg] = useState<string>('todas')

  // Modal Sinônimo / Mapeamento
  const [modalSinonimoAberto, setModalSinonimoAberto] = useState(false)
  const [editSinonimoId, setEditSinonimoId] = useState<string | null>(null)
  const [sinAlias, setSinAlias] = useState('')
  const [sinSeguradora, setSinSeguradora] = useState('')
  const [sinCanonicaNome, setSinCanonicaNome] = useState('')
  const [sinEventosExcluidos, setSinEventosExcluidos] = useState<string[]>([])
  const [novoExcluido, setNovoExcluido] = useState('')
  const [sinRealocacoes, setSinRealocacoes] = useState<RealocacaoEventoItem[]>([])
  const [realocEvento, setRealocEvento] = useState('')
  const [realocDestino, setRealocDestino] = useState('')
  const [realocMotivo, setRealocMotivo] = useState('')
  const [sinObs, setSinObs] = useState('')
  const [salvandoSin, setSalvandoSin] = useState(false)

  // Modal Canônica
  const [modalCanonicaAberto, setModalCanonicaAberto] = useState(false)
  const [editCanonicaId, setEditCanonicaId] = useState<string | null>(null)
  const [canNome, setCanNome] = useState('')
  const [canDescricao, setCanDescricao] = useState('')
  const [canRamo, setCanRamo] = useState('Patrimonial')
  const [canEventos, setCanEventos] = useState<string[]>([])
  const [novoEventoCan, setNovoEventoCan] = useState('')
  const [salvandoCan, setSalvandoCan] = useState(false)

  // Filtragem de sinônimos
  const sinonimosFiltrados = sinonimos.filter((s) => {
    const termo = busca.toLowerCase()
    const bateBusca =
      !termo ||
      s.alias.toLowerCase().includes(termo) ||
      (s.canonica_nome || '').toLowerCase().includes(termo) ||
      (s.seguradora_nome || '').toLowerCase().includes(termo)

    const bateSeg = filtroSeg === 'todas' || s.seguradora_nome === filtroSeg
    return bateBusca && bateSeg
  })

  // Filtragem de canônicas
  const canonicasFiltradas = canonicas.filter((c) => {
    const termo = busca.toLowerCase()
    return (
      !termo ||
      c.nome.toLowerCase().includes(termo) ||
      (c.descricao || '').toLowerCase().includes(termo) ||
      (c.eventos_tipicos || []).some((ev) => ev.toLowerCase().includes(termo))
    )
  })

  // Abrir modal de criação/edição de sinônimo
  const abrirModalSinonimo = (sin?: CoberturaSinonimoRecord) => {
    if (sin) {
      setEditSinonimoId(sin.id)
      setSinAlias(sin.alias)
      setSinSeguradora(sin.seguradora_nome || '')
      setSinCanonicaNome(sin.canonica_nome || '')
      setSinEventosExcluidos(sin.eventos_excluidos || [])
      setSinRealocacoes(sin.realocacoes_evento || [])
      setSinObs(sin.observacao || '')
    } else {
      setEditSinonimoId(null)
      setSinAlias('')
      setSinSeguradora(seguradorasNomes[0] || '')
      setSinCanonicaNome(canonicas[0]?.nome || '')
      setSinEventosExcluidos([])
      setSinRealocacoes([])
      setSinObs('')
    }
    setNovoExcluido('')
    setRealocEvento('')
    setRealocDestino('')
    setRealocMotivo('')
    setModalSinonimoAberto(true)
  }

  // Abrir modal de criação/edição de canônica
  const abrirModalCanonica = (can?: CoberturaCanonicaRecord) => {
    if (can) {
      setEditCanonicaId(can.id)
      setCanNome(can.nome)
      setCanDescricao(can.descricao || '')
      setCanRamo(can.ramo || 'Patrimonial')
      setCanEventos(can.eventos_tipicos || derivarEventosTipicosPadrao(can.nome))
    } else {
      setEditCanonicaId(null)
      setCanNome('')
      setCanDescricao('')
      setCanRamo('Patrimonial')
      setCanEventos([])
    }
    setNovoEventoCan('')
    setModalCanonicaAberto(true)
  }

  const handleSalvarSinonimo = async () => {
    if (!sinAlias.trim() || !sinCanonicaNome.trim()) {
      alert('Informe o alias e a cobertura canônica de destino.')
      return
    }

    try {
      setSalvandoSin(true)
      const canRec = canonicas.find((c) => c.nome === sinCanonicaNome)
      await salvarSinonimo({
        alias: sinAlias.trim(),
        seguradoraNome: sinSeguradora.trim(),
        canonicaNome: sinCanonicaNome.trim(),
        coberturaCanonicaId: canRec?.id,
        eventosExcluidos: sinEventosExcluidos,
        realocacoesEvento: sinRealocacoes,
        observacao: sinObs.trim(),
      })
      setModalSinonimoAberto(false)
      onDataChange()
    } catch (err: unknown) {
      alert('Erro ao salvar mapeamento: ' + (err as Error).message)
    } finally {
      setSalvandoSin(false)
    }
  }

  const handleSalvarCanonica = async () => {
    if (!canNome.trim()) {
      alert('Informe o nome da cobertura canônica.')
      return
    }

    try {
      setSalvandoCan(true)
      await salvarCoberturaCanonica({
        id: editCanonicaId || undefined,
        nome: canNome.trim(),
        descricao: canDescricao.trim(),
        ramo: canRamo.trim(),
        eventosTipicos: canEventos.length > 0 ? canEventos : derivarEventosTipicosPadrao(canNome),
      })
      setModalCanonicaAberto(false)
      onDataChange()
    } catch (err: unknown) {
      alert('Erro ao salvar cobertura canônica: ' + (err as Error).message)
    } finally {
      setSalvandoCan(false)
    }
  }

  const handleExcluirSinonimo = async (id: string) => {
    if (!confirm('Deseja excluir este mapeamento de sinônimo permanentemente?')) return
    try {
      await excluirSinonimo(id)
      onDataChange()
    } catch (err: unknown) {
      alert('Erro ao excluir: ' + (err as Error).message)
    }
  }

  const handleExcluirCanonica = async (can: CoberturaCanonicaRecord) => {
    if (!confirm(`Deseja remover a cobertura canônica "${can.nome}"?`)) return
    try {
      await excluirCoberturaCanonica(can.id)
      onDataChange()
    } catch (err: unknown) {
      alert('Erro ao excluir: ' + (err as Error).message)
    }
  }

  // Pre-popular eventos típicos na seleção da canônica no modal de sinônimo
  const eventosDaCanonicaSelecionada = React.useMemo(() => {
    const found = canonicas.find((c) => c.nome === sinCanonicaNome)
    return found?.eventos_tipicos?.length
      ? found.eventos_tipicos
      : derivarEventosTipicosPadrao(sinCanonicaNome)
  }, [canonicas, sinCanonicaNome])

  return (
    <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
      {/* Top Banner do Painel */}
      <div className="p-5 border-b border-[#E4E9F0] bg-gradient-to-r from-[#0F2B46] to-[#16578B] text-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-blue-500/20 text-blue-200 border border-blue-400/30">
                <Layers className="w-4 h-4" />
              </span>
              <h3 className="text-base font-bold">
                Painel de Equivalências &amp; Taxonomia Canônica Bycor
              </h3>
            </div>
            <p className="text-xs text-blue-100/80 max-w-2xl leading-relaxed">
              Granularidade em dois níveis: alias de cada seguradora pareado com a cobertura
              canônica Bycor e gestão de pacotes de eventos (exceções de exclusão e realocações). As
              escolhas do analista são gravadas permanentemente e valem para propostas futuras.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <Button
              size="sm"
              onClick={() => abrirModalSinonimo()}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Novo Sinônimo (Alias)
            </Button>
            <Button
              size="sm"
              onClick={() => abrirModalCanonica()}
              variant="outline"
              className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <BookOpen className="w-3.5 h-3.5 mr-1" />
              Nova Canônica
            </Button>
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-2 mt-4 pt-2 border-t border-white/10 text-xs">
          <button
            onClick={() => setTabAtiva('sinonimos')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tabAtiva === 'sinonimos'
                ? 'bg-white text-[#0F2B46] shadow-sm'
                : 'text-blue-100 hover:bg-white/10'
            }`}
          >
            <Split className="w-3.5 h-3.5" />
            Sinônimos por Seguradora ({sinonimos.length})
          </button>
          <button
            onClick={() => setTabAtiva('canonicas')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tabAtiva === 'canonicas'
                ? 'bg-white text-[#0F2B46] shadow-sm'
                : 'text-blue-100 hover:bg-white/10'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Taxonomia Canônica &amp; Eventos ({canonicas.length})
          </button>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="p-3.5 bg-gray-50/80 border-b border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
          <Input
            type="text"
            placeholder={
              tabAtiva === 'sinonimos'
                ? 'Buscar por alias, canônica ou cia...'
                : 'Buscar por nome canônico ou evento...'
            }
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-8 text-xs pl-8 bg-white"
          />
        </div>

        {tabAtiva === 'sinonimos' && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-gray-500 font-medium shrink-0">Filtrar Cia:</span>
            <select
              value={filtroSeg}
              onChange={(e) => setFiltroSeg(e.target.value)}
              className="h-8 text-xs border rounded bg-white px-2 focus:outline-none"
            >
              <option value="todas">Todas as Seguradoras</option>
              {seguradorasNomes.map((seg) => (
                <option key={seg} value={seg}>
                  {seg}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Conteúdo Aba Sinônimos */}
      {tabAtiva === 'sinonimos' && (
        <div className="divide-y divide-gray-100 max-h-[460px] overflow-y-auto">
          {sinonimosFiltrados.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 space-y-1">
              <Split className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="font-semibold text-gray-600">Nenhum sinônimo encontrado</p>
              <p>Cadastre aliases das seguradoras para automatizar a tabulação.</p>
            </div>
          ) : (
            sinonimosFiltrados.map((sin) => {
              const temExclusao = sin.eventos_excluidos && sin.eventos_excluidos.length > 0
              const temRealoc = sin.realocacoes_evento && sin.realocacoes_evento.length > 0

              return (
                <div
                  key={sin.id}
                  className="p-3.5 hover:bg-gray-50/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                        {sin.alias}
                      </span>
                      <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="font-extrabold text-[#16578B]">
                        {sin.canonica_nome || '—'}
                      </span>
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
                    </div>

                    {/* Exceções e Realocações de Eventos */}
                    {(temExclusao || temRealoc) && (
                      <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                        {temExclusao && (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                            <ShieldAlert className="w-3 h-3 text-amber-600" />
                            <span>
                              <strong>Exclui evento(s):</strong> {sin.eventos_excluidos?.join(', ')}
                            </span>
                          </div>
                        )}
                        {temRealoc &&
                          sin.realocacoes_evento?.map((r, rIdx) => (
                            <div
                              key={rIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-900 border border-purple-200"
                            >
                              <Split className="w-3 h-3 text-purple-600" />
                              <span>
                                <strong>{r.evento}</strong> realocado para{' '}
                                <em>{r.cobertura_destino}</em>
                              </span>
                            </div>
                          ))}
                      </div>
                    )}

                    {sin.observacao && (
                      <div className="text-[11px] text-gray-500 italic">Nota: {sin.observacao}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0 self-end md:self-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => abrirModalSinonimo(sin)}
                      className="h-7 px-2 text-xs text-gray-600 hover:text-gray-900"
                    >
                      <Edit2 className="w-3 h-3 mr-1" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleExcluirSinonimo(sin.id)}
                      className="h-7 px-2 text-xs text-red-600 hover:text-red-800 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Conteúdo Aba Canônicas */}
      {tabAtiva === 'canonicas' && (
        <div className="divide-y divide-gray-100 max-h-[460px] overflow-y-auto">
          {canonicasFiltradas.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 space-y-1">
              <BookOpen className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="font-semibold text-gray-600">Nenhuma cobertura canônica cadastrada</p>
              <p>Cadastre os rubros canônicos Bycor e seus eventos típicos.</p>
            </div>
          ) : (
            canonicasFiltradas.map((can) => {
              const eventos = can.eventos_tipicos || derivarEventosTipicosPadrao(can.nome)
              return (
                <div
                  key={can.id}
                  className="p-3.5 hover:bg-gray-50/80 transition-colors flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 text-sm">{can.nome}</span>
                      {can.ramo && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-[#16578B] border border-blue-200">
                          {can.ramo}
                        </span>
                      )}
                      {can.id.startsWith('matriz_') && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                          Matriz P&amp;C
                        </span>
                      )}
                    </div>

                    {can.descricao && <p className="text-gray-500 text-[11px]">{can.descricao}</p>}

                    {/* Lista de Eventos Típicos */}
                    <div className="pt-1">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                        Eventos típicos do pacote ({eventos.length}):
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {eventos.map((ev, eIdx) => (
                          <span
                            key={eIdx}
                            className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                          >
                            {ev}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 self-end md:self-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => abrirModalCanonica(can)}
                      className="h-7 px-2 text-xs text-gray-600 hover:text-gray-900"
                    >
                      <Edit2 className="w-3 h-3 mr-1" />
                      Editar
                    </Button>
                    {!can.id.startsWith('matriz_') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleExcluirCanonica(can)}
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-800 hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* MODAL: SINÔNIMO / MAPEAMENTO COM EXCEÇÕES POR EVENTO */}
      <Dialog open={modalSinonimoAberto} onOpenChange={setModalSinonimoAberto}>
        <DialogContent className="max-w-xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Split className="w-4 h-4 text-[#16578B]" />
              {editSinonimoId ? 'Editar Mapeamento de Equivalência' : 'Novo Mapeamento de Sinônimo'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Associe a nomenclatura original da seguradora à cobertura canônica Bycor e configure
              exceções granulares por evento.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-700">
                  Nome na Proposta (Alias da Cia) *
                </Label>
                <Input
                  type="text"
                  placeholder="Ex: Básica Incêndio e Queda de Raio"
                  value={sinAlias}
                  onChange={(e) => setSinAlias(e.target.value)}
                  className="h-8 text-xs mt-1 bg-white"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Seguradora</Label>
                <select
                  value={sinSeguradora}
                  onChange={(e) => setSinSeguradora(e.target.value)}
                  className="w-full h-8 border rounded text-xs px-2 mt-1 bg-white"
                >
                  <option value="">Todas / Global</option>
                  {seguradorasNomes.map((seg) => (
                    <option key={seg} value={seg}>
                      {seg}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">
                Cobertura Canônica de Destino (Bycor) *
              </Label>
              <select
                value={sinCanonicaNome}
                onChange={(e) => setSinCanonicaNome(e.target.value)}
                className="w-full h-8 border rounded text-xs px-2 mt-1 bg-white font-medium"
              >
                <option value="">Selecione a canônica...</option>
                {canonicas.map((c) => (
                  <option key={c.id} value={c.nome}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* SEÇÃO 1: Eventos Excluídos pela Cia nesta cobertura */}
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-900 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                  Exceção: Cobertura da Cia NÃO inclui evento
                </span>
                <span className="text-[10px] text-amber-700">
                  Gera alerta 'Segurado descoberto' se outra cia cobrir
                </span>
              </div>

              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Ex: Queda de Aeronave"
                  value={novoExcluido}
                  onChange={(e) => setNovoExcluido(e.target.value)}
                  className="h-7 text-xs bg-white flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (!novoExcluido.trim()) return
                    setSinEventosExcluidos((prev) => [...prev, novoExcluido.trim()])
                    setNovoExcluido('')
                  }}
                  className="h-7 text-xs bg-amber-800 text-white"
                >
                  Excluir Evento
                </Button>
              </div>

              {/* Sugestões rápidas baseadas nos eventos típicos da canônica selecionada */}
              {eventosDaCanonicaSelecionada.length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] text-gray-500 block mb-1">
                    Eventos típicos desta canônica (clique para marcar como excluído):
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {eventosDaCanonicaSelecionada.map((ev, idx) => {
                      const jaExcluido = sinEventosExcluidos.includes(ev)
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (jaExcluido) {
                              setSinEventosExcluidos((p) => p.filter((x) => x !== ev))
                            } else {
                              setSinEventosExcluidos((p) => [...p, ev])
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
              )}

              {sinEventosExcluidos.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {sinEventosExcluidos.map((ex, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-300 flex items-center gap-1"
                    >
                      <span>Não coberto: {ex}</span>
                      <button
                        type="button"
                        onClick={() => setSinEventosExcluidos((p) => p.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* SEÇÃO 2: Realocação de Evento para Outra Cobertura da mesma Cia */}
            <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-900 flex items-center gap-1.5">
                  <Split className="w-3.5 h-3.5 text-purple-600" />
                  Realocação: Evento Y está na cobertura Z da mesma Cia
                </span>
              </div>
              <p className="text-[10px] text-purple-700">
                Evita falso alarme de desamparo quando o evento foi oferecido pela cia em rubrica
                específica (ex.: Tumultos cotado em cobertura autônoma).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Input
                    type="text"
                    placeholder="Evento (ex: Tumultos)"
                    value={realocEvento}
                    onChange={(e) => setRealocEvento(e.target.value)}
                    className="h-7 text-xs bg-white"
                  />
                </div>
                <div>
                  <select
                    value={realocDestino}
                    onChange={(e) => setRealocDestino(e.target.value)}
                    className="w-full h-7 border rounded text-xs px-2 bg-white"
                  >
                    <option value="">Cobertura de destino...</option>
                    {canonicas.map((c) => (
                      <option key={c.id} value={c.nome}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (!realocEvento.trim() || !realocDestino.trim()) return
                      setSinRealocacoes((prev) => [
                        ...prev,
                        {
                          evento: realocEvento.trim(),
                          cobertura_destino: realocDestino.trim(),
                          motivo: realocMotivo.trim(),
                        },
                      ])
                      setRealocEvento('')
                      setRealocDestino('')
                      setRealocMotivo('')
                    }}
                    className="w-full h-7 text-xs bg-purple-800 text-white"
                  >
                    Adicionar Realocação
                  </Button>
                </div>
              </div>

              {sinRealocacoes.length > 0 && (
                <div className="space-y-1 pt-1">
                  {sinRealocacoes.map((r, idx) => (
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
                        onClick={() => setSinRealocacoes((p) => p.filter((_, i) => i !== idx))}
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
                placeholder="Ex: Pacote especial conforme condições gerais da AXA 2026"
                value={sinObs}
                onChange={(e) => setSinObs(e.target.value)}
                className="h-8 text-xs mt-1 bg-white"
              />
            </div>
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
              disabled={salvandoSin}
              onClick={handleSalvarSinonimo}
              className="h-8 text-xs bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-semibold"
            >
              {salvandoSin ? 'Salvando...' : 'Gravar Mapeamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: COBERTURA CANÔNICA & EVENTOS TÍPICOS */}
      <Dialog open={modalCanonicaAberto} onOpenChange={setModalCanonicaAberto}>
        <DialogContent className="max-w-lg animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#16578B]" />
              {editCanonicaId ? 'Editar Cobertura Canônica' : 'Nova Cobertura Canônica Bycor'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Declare a cobertura padrão e os eventos típicos cobertos pelo pacote para servir de
              referência anti-descoberta.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3 text-xs">
            <div>
              <Label className="text-xs font-semibold text-gray-700">Nome Canônico *</Label>
              <Input
                type="text"
                placeholder="Ex: Incêndio Básica (Danos Materiais)"
                value={canNome}
                onChange={(e) => setCanNome(e.target.value)}
                className="h-8 text-xs mt-1 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold text-gray-700">Ramo</Label>
                <Input
                  type="text"
                  placeholder="Patrimonial, RC, Riscos Nomeados..."
                  value={canRamo}
                  onChange={(e) => setCanRamo(e.target.value)}
                  className="h-8 text-xs mt-1 bg-white"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-700">Descrição</Label>
                <Input
                  type="text"
                  placeholder="Descrição breve do escopo"
                  value={canDescricao}
                  onChange={(e) => setCanDescricao(e.target.value)}
                  className="h-8 text-xs mt-1 bg-white"
                />
              </div>
            </div>

            {/* Gestão de Eventos Típicos */}
            <div className="p-3 bg-gray-50 border rounded-lg space-y-2">
              <span className="font-semibold text-gray-800 block">
                Eventos Típicos Cobertos pelo Pacote:
              </span>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Ex: Queda de Raio, Explosão, Implosão..."
                  value={novoEventoCan}
                  onChange={(e) => setNovoEventoCan(e.target.value)}
                  className="h-7 text-xs bg-white flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (!novoEventoCan.trim()) return
                    setCanEventos((p) => [...p, novoEventoCan.trim()])
                    setNovoEventoCan('')
                  }}
                  className="h-7 text-xs bg-[#0F2B46] text-white"
                >
                  Adicionar
                </Button>
              </div>

              <div className="flex flex-wrap gap-1 pt-1 max-h-36 overflow-y-auto">
                {canEventos.length === 0 ? (
                  <span className="text-[11px] text-gray-400 italic">
                    Nenhum evento adicionado ainda.
                  </span>
                ) : (
                  canEventos.map((ev, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1"
                    >
                      <span>{ev}</span>
                      <button
                        type="button"
                        onClick={() => setCanEventos((p) => p.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalCanonicaAberto(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={salvandoCan}
              onClick={handleSalvarCanonica}
              className="h-8 text-xs bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-semibold"
            >
              {salvandoCan ? 'Salvando...' : 'Salvar Canônica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
