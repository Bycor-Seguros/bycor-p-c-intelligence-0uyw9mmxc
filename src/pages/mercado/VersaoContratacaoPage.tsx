import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  FileCheck,
  Plus,
  GitCompare,
  History,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ArrowRight,
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

interface VersaoRecord {
  id: string
  produto_cobertura: string
  wording: string
  principais_clausulas: string
  pos_franquias_padrao: string
  exclusoes_usuais: string
  versao: number
  status: 'rascunho' | 'publicada'
  autor: string
  created: string
  log_alteracoes: { data: string; autor: string; nota: string }[]
}

export default function VersaoContratacaoPage() {
  const { user } = useAuth()
  const [versoes, setVersoes] = useState<VersaoRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Modals
  const [modalOpen, setModalOpen] = useState(false)
  const [editingVersao, setEditingVersao] = useState<VersaoRecord | null>(null)
  const [produto, setProduto] = useState('Incêndio Básica (Danos Materiais)')
  const [wording, setWording] = useState('')
  const [clausulas, setClausulas] = useState('')
  const [posFranquias, setPosFranquias] = useState('')
  const [exclusoes, setExclusoes] = useState('')
  const [statusVal, setStatusVal] = useState<'rascunho' | 'publicada'>('rascunho')
  const [saving, setSaving] = useState(false)

  // Diff comparison modal
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [compV1, setCompV1] = useState<VersaoRecord | null>(null)
  const [compV2, setCompV2] = useState<VersaoRecord | null>(null)

  const fetchVersoes = async () => {
    try {
      setLoading(true)
      const res = await pb.collection('contratacao_versoes').getFullList<VersaoRecord>({
        sort: '-versao',
      })
      setVersoes(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchVersoes()
  }, [])

  const handleOpenCreate = () => {
    setEditingVersao(null)
    setProduto('Incêndio Básica (Danos Materiais)')
    setWording(
      'Garante perdas e danos materiais causados diretamente aos bens segurados por incêndio, queda de raio e explosão de qualquer natureza.',
    )
    setClausulas(
      'Cláusula de Risco Relativo com margem de tolerância de 80%; Cláusula de reposição a novo para conteúdo e equipamentos.',
    )
    setPosFranquias('10% dos prejuízos indenizáveis, mínimo de R$ 10.000,00 por evento.')
    setExclusoes(
      'Danos elétricos decorrentes de variação de tensão sem que haja chamas aparentes; lucros cessantes sem contratação específica.',
    )
    setStatusVal('publicada')
    setModalOpen(true)
  }

  // Create new version based on existing
  const handleDuplicateVersion = (v: VersaoRecord) => {
    setEditingVersao(null)
    setProduto(v.produto_cobertura)
    setWording(v.wording)
    setClausulas(v.principais_clausulas)
    setPosFranquias(v.pos_franquias_padrao)
    setExclusoes(v.exclusoes_usuais)
    setStatusVal('rascunho')
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSaving(true)
      const maxVer = versoes.reduce((acc, curr) => Math.max(acc, curr.versao || 1), 0)
      const nextVer = editingVersao ? editingVersao.versao : maxVer + 1

      const payload = {
        produto_cobertura: produto,
        wording,
        principais_clausulas: clausulas,
        pos_franquias_padrao: posFranquias,
        exclusoes_usuais: exclusoes,
        versao: nextVer,
        status: statusVal,
        autor: user?.id,
        log_alteracoes: [
          {
            data: new Date().toISOString().slice(0, 10),
            autor: user?.name || user?.email || 'Admin',
            nota: editingVersao ? 'Versão editada' : `Nova versão v${nextVer} criada`,
          },
        ],
      }

      if (editingVersao) {
        await pb.collection('contratacao_versoes').update(editingVersao.id, payload)
      } else {
        await pb.collection('contratacao_versoes').create(payload)
      }

      setModalOpen(false)
      fetchVersoes()
    } catch (err: unknown) {
      alert('Erro: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Open diff
  const handleOpenDiff = (v1: VersaoRecord) => {
    setCompV1(v1)
    const other = versoes.find((v) => v.id !== v1.id) || v1
    setCompV2(other)
    setDiffModalOpen(true)
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
            <h2 className="text-xl font-bold text-gray-900">
              Versões Padrão de Contratação & Wordings
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Repositório de cláusulas, franquias POS padrão e condições contratuais ideais para o
            segmento de Hotéis & Resorts, com versionamento rigoroso e comparação de diferenças
            (diff).
          </p>
        </div>

        <Button
          onClick={handleOpenCreate}
          className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-blue-300" />
          <span>Nova Versão Contratual</span>
        </Button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E4E9F0] flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Versões Cadastradas</h3>
          <span className="text-xs text-gray-500">{versoes.length} versão(ões)</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-gray-400">Carregando versões...</div>
        ) : versoes.length === 0 ? (
          <div className="py-16 text-center px-4">
            <FileCheck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-700">
              Nenhuma condição padrão registrada
            </h4>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Crie a primeira versão de wording e cláusulas recomendadas para uso nas cotações e
              propostas.
            </p>
            <Button onClick={handleOpenCreate} className="mt-4 bg-[#0F2B46] text-xs h-9">
              Criar primeira versão
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {versoes.map((v) => (
              <div key={v.id} className="p-5 hover:bg-gray-50/50 transition-colors space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[#0F2B46] text-sm">
                      v{v.versao}.0 — {v.produto_cobertura}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        v.status === 'publicada'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {v.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenDiff(v)}
                      className="text-xs h-7 text-[#16578B] border-gray-300"
                    >
                      <GitCompare className="w-3 h-3 mr-1" />
                      Comparar Versões
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleDuplicateVersion(v)}
                      className="bg-[#0F2B46] text-white text-xs h-7"
                    >
                      Duplicar como Rascunho
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-gray-50/70 p-3 rounded-lg border">
                  <div>
                    <span className="font-semibold text-gray-700 block mb-0.5">
                      Wording / Escopo:
                    </span>
                    <p className="text-gray-600 leading-relaxed">{v.wording}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 block mb-0.5">
                      Cláusulas Particulares:
                    </span>
                    <p className="text-gray-600 leading-relaxed">{v.principais_clausulas}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 block mb-0.5">
                      Franquias e POS Padrão:
                    </span>
                    <p className="text-gray-600 leading-relaxed">{v.pos_franquias_padrao}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 block mb-0.5">
                      Exclusões Usuais:
                    </span>
                    <p className="text-red-700 leading-relaxed">{v.exclusoes_usuais}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL: NOVA VERSÃO / EDIÇÃO */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-xl animate-scale-in">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              {editingVersao ? 'Editar Versão Contratual' : 'Criar Nova Versão Contratual'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-3 pt-2 text-xs">
            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Produto / Cobertura</Label>
              <Input
                type="text"
                value={produto}
                onChange={(e) => setProduto(e.target.value)}
                className="h-8 text-xs mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Wording Recomendado</Label>
              <textarea
                value={wording}
                onChange={(e) => setWording(e.target.value)}
                className="w-full h-16 border rounded p-2 text-xs mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-[11px] font-semibold text-gray-700">
                Principais Cláusulas
              </Label>
              <textarea
                value={clausulas}
                onChange={(e) => setClausulas(e.target.value)}
                className="w-full h-16 border rounded p-2 text-xs mt-1"
              />
            </div>

            <div>
              <Label className="text-[11px] font-semibold text-gray-700">
                POS / Franquias Padrão
              </Label>
              <Input
                type="text"
                value={posFranquias}
                onChange={(e) => setPosFranquias(e.target.value)}
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <Label className="text-[11px] font-semibold text-gray-700">Exclusões Usuais</Label>
              <textarea
                value={exclusoes}
                onChange={(e) => setExclusoes(e.target.value)}
                className="w-full h-14 border rounded p-2 text-xs mt-1"
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
                className="bg-[#0F2B46] text-white text-xs h-8"
              >
                {saving ? 'Gravando...' : 'Salvar Versão'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: COMPARADOR DE VERSÕES (DIFF) */}
      {compV1 && compV2 && (
        <Dialog open={diffModalOpen} onOpenChange={setDiffModalOpen}>
          <DialogContent className="max-w-3xl animate-scale-in">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-[#16578B]" />
                <span>Comparação Lado a Lado de Versões</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                Identificação de alterações no wording e cláusulas entre edições.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4 border-b pb-2 font-bold text-gray-900">
                <div>
                  Versão A: v{compV1.versao}.0 ({compV1.status})
                </div>
                <div>
                  Versão B:
                  <select
                    value={compV2.id}
                    onChange={(e) => {
                      const found = versoes.find((v) => v.id === e.target.value)
                      if (found) setCompV2(found)
                    }}
                    className="ml-2 text-xs font-normal border rounded px-1"
                  >
                    {versoes.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.versao}.0 ({v.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded border space-y-2">
                  <div className="font-semibold text-gray-700">Wording (Versão A):</div>
                  <p className="text-gray-600 leading-relaxed">{compV1.wording}</p>
                  <div className="font-semibold text-gray-700 pt-2 border-t">Franquias:</div>
                  <p className="text-gray-600">{compV1.pos_franquias_padrao}</p>
                </div>

                <div className="p-3 bg-blue-50/50 rounded border border-blue-200 space-y-2">
                  <div className="font-semibold text-[#16578B]">Wording (Versão B):</div>
                  <p className="text-gray-800 leading-relaxed">{compV2.wording}</p>
                  <div className="font-semibold text-[#16578B] pt-2 border-t border-blue-200">
                    Franquias:
                  </div>
                  <p className="text-gray-800">{compV2.pos_franquias_padrao}</p>
                </div>
              </div>

              <div className="pt-2 text-right">
                <Button
                  size="sm"
                  onClick={() => setDiffModalOpen(false)}
                  className="bg-[#0F2B46] text-white text-xs h-8"
                >
                  Fechar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
