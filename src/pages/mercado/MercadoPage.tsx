import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  Layers,
  History,
  Phone,
  Mail,
  Shield,
  Sparkles,
  CheckCircle2,
  AlertCircle,
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
import { formatDate } from '@/lib/formatters'

interface SeguradoraRecord {
  id: string
  nome: string
  contatos: { email?: string; telefone?: string; responsavel?: string }
  posicionamento: string
  apetite_segmentos: Record<string, string>
  faixa_lmi: string
  condicoes_tipicas: string
  observacoes: string
  historico_relacionamento: { data: string; fonte: string; observacao: string }[]
}

export default function MercadoPage() {
  const { user } = useAuth()
  const [seguradoras, setSeguradoras] = useState<SeguradoraRecord[]>([])
  const [loading, setLoading] = useState(true)

  // New/Edit Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [posicionamento, setPosicionamento] = useState('')
  const [apetite, setApetite] = useState('Alto')
  const [faixaLmi, setFaixaLmi] = useState('Até R$ 100M')
  const [condicoesTipicas, setCondicoesTipicas] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [saving, setSaving] = useState(false)

  // Relationship history modal
  const [histModalOpen, setHistModalOpen] = useState(false)
  const [activeSeg, setActiveSeg] = useState<SeguradoraRecord | null>(null)
  const [newHistFonte, setNewHistFonte] = useState('Negociação')
  const [newHistObs, setNewHistObs] = useState('')
  const [addingHist, setAddingHist] = useState(false)

  // Consolidate spellings modal
  const [consolidateModalOpen, setConsolidateModalOpen] = useState(false)
  const [consolidating, setConsolidating] = useState(false)

  const fetchSeguradoras = async () => {
    try {
      setLoading(true)
      const res = await pb.collection('seguradoras').getFullList<SeguradoraRecord>({
        sort: 'nome',
      })
      setSeguradoras(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSeguradoras()
  }, [])

  const handleOpenCreate = () => {
    setEditingId(null)
    setNome('')
    setPosicionamento('Líder em P&C corporativo')
    setApetite('Alto')
    setFaixaLmi('Até R$ 100M')
    setCondicoesTipicas('Cláusulas amplas de danos por água e vendaval')
    setObservacoes('')
    setEmail('comercial@seguradora.com.br')
    setTelefone('(11) 3000-0000')
    setModalOpen(true)
  }

  const handleOpenEdit = (s: SeguradoraRecord) => {
    setEditingId(s.id)
    setNome(s.nome)
    setPosicionamento(s.posicionamento || '')
    setApetite(s.apetite_segmentos?.['Hotéis & Resorts'] || 'Alto')
    setFaixaLmi(s.faixa_lmi || '')
    setCondicoesTipicas(s.condicoes_tipicas || '')
    setObservacoes(s.observacoes || '')
    setEmail(s.contatos?.email || '')
    setTelefone(s.contatos?.telefone || '')
    setModalOpen(true)
  }

  const handleSaveSeguradora = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

    try {
      setSaving(true)
      const payload = {
        nome: nome.trim(),
        posicionamento: posicionamento.trim(),
        apetite_segmentos: { 'Hotéis & Resorts': apetite },
        faixa_lmi: faixaLmi.trim(),
        condicoes_tipicas: condicoesTipicas.trim(),
        observacoes: observacoes.trim(),
        contatos: { email: email.trim(), telefone: telefone.trim() },
      }

      if (editingId) {
        await pb.collection('seguradoras').update(editingId, payload)
      } else {
        await pb.collection('seguradoras').create({
          ...payload,
          historico_relacionamento: [
            {
              data: new Date().toISOString().slice(0, 10),
              fonte: 'Cadastro Inicial',
              observacao: 'Seguradora cadastrada no Mapa de Mercado Bycor.',
            },
          ],
        })
      }

      setModalOpen(false)
      fetchSeguradoras()
    } catch (err: unknown) {
      alert('Erro ao salvar seguradora: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Add relationship history
  const handleAddHistEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeSeg || !newHistObs.trim()) return

    try {
      setAddingHist(true)
      const currentList = activeSeg.historico_relacionamento || []
      const updatedList = [
        ...currentList,
        {
          data: new Date().toISOString().slice(0, 10),
          fonte: newHistFonte,
          observacao: newHistObs.trim(),
        },
      ]

      await pb.collection('seguradoras').update(activeSeg.id, {
        historico_relacionamento: updatedList,
      })

      setActiveSeg({ ...activeSeg, historico_relacionamento: updatedList })
      setNewHistObs('')
      fetchSeguradoras()
    } catch (err: unknown) {
      alert('Erro: ' + (err as Error).message)
    } finally {
      setAddingHist(false)
    }
  }

  // Consolidate spelling variants in apolices
  const handleConsolidateSpellings = async () => {
    try {
      setConsolidating(true)
      const apolices = await pb
        .collection('apolices')
        .getFullList<{ id: string; seguradora: string }>()
      let updatedCount = 0

      for (const ap of apolices) {
        let normalized = ap.seguradora
        if (ap.seguradora === 'AXA Seguros S/A') {
          normalized = 'AXA Seguros S.A.'
        } else if (ap.seguradora === 'Mitsui Sumitomo Seguros S.A. (MSIG)') {
          normalized = 'Mitsui Sumitomo Seguros S.A.'
        }

        if (normalized !== ap.seguradora) {
          await pb.collection('apolices').update(ap.id, { seguradora: normalized })
          updatedCount++
        }
      }

      alert(`Consolidação concluída! ${updatedCount} apólice(s) normalizadas.`)
      setConsolidateModalOpen(false)
    } catch (err: unknown) {
      alert('Erro ao consolidar: ' + (err as Error).message)
    } finally {
      setConsolidating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Gestão Comercial
            </span>
            <h2 className="text-xl font-bold text-gray-900">Mapa de Mercado & Seguradoras</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Catálogo de inteligência das seguradoras parceiras: apetite setorial para Hotéis &
            Resorts, capacidade de subscrição LMI, contatos comerciais e histórico de win/loss.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setConsolidateModalOpen(true)}
            variant="outline"
            className="text-xs h-9 border-gray-300 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#16578B]" />
            <span>Consolidar Grafias</span>
          </Button>

          <Button
            onClick={handleOpenCreate}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-blue-300" />
            <span>Adicionar Seguradora</span>
          </Button>
        </div>
      </div>

      {/* Cards Grid */}
      {loading ? (
        <div className="py-16 text-center text-xs text-gray-400">Carregando seguradoras...</div>
      ) : seguradoras.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E4E9F0] p-12 text-center">
          <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <h4 className="text-sm font-semibold text-gray-700">Nenhuma seguradora cadastrada</h4>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Cadastre as principais seguradoras parceiras (Porto, AXA, Chubb, Tokio Marine, MSIG,
            Ezze) para parametrizar o apetite comercial.
          </p>
          <Button onClick={handleOpenCreate} className="mt-4 bg-[#0F2B46] text-xs h-9">
            Cadastrar primeira seguradora
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {seguradoras.map((s) => {
            const apetiteVal = s.apetite_segmentos?.['Hotéis & Resorts'] || 'Alto'
            const histCount = s.historico_relacionamento?.length || 0

            return (
              <div
                key={s.id}
                className="bg-white rounded-xl border border-[#E4E9F0] p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-[#0F2B46] text-white flex items-center justify-center font-bold text-sm">
                      {s.nome.slice(0, 2).toUpperCase()}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        apetiteVal === 'Alto'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : apetiteVal === 'Médio'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      Apetite: {apetiteVal}
                    </span>
                  </div>

                  <h3 className="font-bold text-gray-900 text-sm mt-2">{s.nome}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {s.posicionamento || 'Seguradora de Ramos Elementares e P&C'}
                  </p>

                  <div className="mt-4 pt-3 border-t border-gray-100 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Faixa de LMI Aceita:</span>
                      <strong className="text-gray-800">{s.faixa_lmi || 'Sob consulta'}</strong>
                    </div>

                    {s.condicoes_tipicas && (
                      <div className="text-[11px] text-gray-600 bg-gray-50 p-2 rounded">
                        <strong>Condições:</strong> {s.condicoes_tipicas}
                      </div>
                    )}

                    {s.contatos?.email && (
                      <div className="flex items-center gap-1.5 text-gray-500 text-[11px]">
                        <Mail className="w-3 h-3 text-[#16578B]" />
                        <span>{s.contatos.email}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                  <button
                    onClick={() => {
                      setActiveSeg(s)
                      setHistModalOpen(true)
                    }}
                    className="text-[#16578B] hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Histórico ({histCount})</span>
                  </button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenEdit(s)}
                    className="h-7 text-xs text-gray-600 hover:text-gray-900"
                  >
                    <Edit2 className="w-3.5 h-3.5 mr-1" />
                    Editar
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL: CADASTRO / EDIÇÃO */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              {editingId ? 'Editar Seguradora' : 'Cadastrar Seguradora'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveSeguradora} className="space-y-3 pt-2 text-xs">
            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Razão Social / Nome</Label>
              <Input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Porto Seguro Cia. de Seguros Gerais"
                className="h-8 text-xs mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-[11px] font-semibold text-gray-700">
                Posicionamento Técnico
              </Label>
              <Input
                type="text"
                value={posicionamento}
                onChange={(e) => setPosicionamento(e.target.value)}
                placeholder="Ex: Apetite agressivo em Hotéis & Resorts"
                className="h-8 text-xs mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] font-semibold text-gray-700">Apetite Hotéis</Label>
                <select
                  value={apetite}
                  onChange={(e) => setApetite(e.target.value)}
                  className="w-full h-8 border rounded text-xs px-2 bg-white mt-1"
                >
                  <option value="Alto">Alto</option>
                  <option value="Médio">Médio</option>
                  <option value="Baixo">Baixo</option>
                </select>
              </div>

              <div>
                <Label className="text-[11px] font-semibold text-gray-700">Faixa de LMI</Label>
                <Input
                  type="text"
                  value={faixaLmi}
                  onChange={(e) => setFaixaLmi(e.target.value)}
                  placeholder="Ex: Até R$ 150M"
                  className="h-8 text-xs mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] font-semibold text-gray-700">E-mail Comercial</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-8 text-xs mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px] font-semibold text-gray-700">Telefone</Label>
                <Input
                  type="text"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  className="h-8 text-xs mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-[11px] font-semibold text-gray-700">
                Condições Típicas & Observações
              </Label>
              <textarea
                value={condicoesTipicas}
                onChange={(e) => setCondicoesTipicas(e.target.value)}
                placeholder="Sublimites comuns, franquias praticadas..."
                className="w-full h-16 border rounded p-2 text-xs mt-1 focus:outline-none"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalOpen(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving}
                size="sm"
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8"
              >
                {saving ? 'Salvando...' : 'Salvar Seguradora'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: HISTÓRICO DE RELACIONAMENTO */}
      {activeSeg && (
        <Dialog open={histModalOpen} onOpenChange={setHistModalOpen}>
          <DialogContent className="max-w-lg animate-scale-in">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                <History className="w-4 h-4 text-[#16578B]" />
                <span>Histórico de Relacionamento — {activeSeg.nome}</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                Registro de negociações, reuniões, cotações ganhas/perdidas e notas de analistas.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 space-y-4 text-xs">
              {/* Form add note */}
              <form
                onSubmit={handleAddHistEntry}
                className="p-3 bg-gray-50 rounded-lg border space-y-2"
              >
                <span className="font-semibold text-gray-700">Adicionar ocorrência:</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <select
                      value={newHistFonte}
                      onChange={(e) => setNewHistFonte(e.target.value)}
                      className="w-full h-8 border rounded text-xs px-2 bg-white"
                    >
                      <option value="Negociação">Negociação</option>
                      <option value="Reunião">Reunião</option>
                      <option value="Alinhamento">Alinhamento</option>
                      <option value="Sinistro">Sinistro</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="text"
                      placeholder="Descrição da ocorrência..."
                      value={newHistObs}
                      onChange={(e) => setNewHistObs(e.target.value)}
                      className="h-8 text-xs bg-white"
                      required
                    />
                  </div>
                </div>
                <div className="text-right">
                  <Button
                    type="submit"
                    disabled={addingHist}
                    size="sm"
                    className="bg-[#0F2B46] text-white text-xs h-7"
                  >
                    {addingHist ? 'Salvando...' : 'Registrar'}
                  </Button>
                </div>
              </form>

              {/* List */}
              <div className="max-h-60 overflow-y-auto divide-y border rounded-lg bg-white">
                {activeSeg.historico_relacionamento?.length === 0 ? (
                  <div className="p-4 text-center text-gray-400">Nenhum evento registrado</div>
                ) : (
                  activeSeg.historico_relacionamento?.map((h, i) => (
                    <div key={i} className="p-2.5 hover:bg-gray-50">
                      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-0.5">
                        <span className="font-semibold text-[#16578B]">{h.fonte}</span>
                        <span>{formatDate(h.data)}</span>
                      </div>
                      <p className="text-gray-800 leading-snug">{h.observacao}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* MODAL: CONSOLIDAR GRAFIAS */}
      <Dialog open={consolidateModalOpen} onOpenChange={setConsolidateModalOpen}>
        <DialogContent className="max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#16578B]" />
              <span>Consolidar Grafias Inconsistentes</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Normaliza variações de nomes de seguradoras na coleção oficial de apólices para
              garantir relatórios fiéis.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 text-xs space-y-3">
            <p className="text-gray-600 leading-relaxed">
              Esta ação varre a base de dados e unifica variações conhecidas:
            </p>
            <div className="p-3 bg-gray-50 border rounded space-y-1 text-gray-700">
              <div>
                • <em>AXA Seguros S/A</em> → <strong>AXA Seguros S.A.</strong>
              </div>
              <div>
                • <em>Mitsui Sumitomo Seguros S.A. (MSIG)</em> →{' '}
                <strong>Mitsui Sumitomo Seguros S.A.</strong>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConsolidateModalOpen(false)}
                className="text-xs h-8"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={consolidating}
                onClick={handleConsolidateSpellings}
                className="bg-[#0F2B46] text-white text-xs h-8 font-semibold"
              >
                {consolidating ? 'Normalizando...' : 'Executar Consolidação'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
