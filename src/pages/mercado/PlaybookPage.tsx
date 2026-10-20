import React, { useState, useEffect, useMemo } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  BookOpen,
  Plus,
  Edit2,
  CheckCircle2,
  Layers,
  AlertTriangle,
  Mail,
  Share2,
  TrendingUp,
  FileSpreadsheet,
  Building,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link } from 'react-router-dom'

interface PlaybookData {
  id?: string
  segmento: string
  mapa_riscos: { risco: string; descricao: string }[]
  checklist_coberturas: string[]
  objecoes: { objecao: string; contra_argumento: string }[]
  crosssell: { produto: string; oportunidade: string }[]
  etapas_prospeccao: string[]
  modelos_email: { titulo: string; corpo: string }[]
}

export default function PlaybookPage() {
  const { user } = useAuth()
  const [segmentos, setSegmentos] = useState<string[]>(['Hotéis & Resorts'])
  const [activeSegmento, setActiveSegmento] = useState('Hotéis & Resorts')
  const [playbook, setPlaybook] = useState<PlaybookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // Real categories in database
  const [realCategories, setRealCategories] = useState<string[]>([])

  const fetchPlaybook = async () => {
    try {
      setLoading(true)
      // Check if playbook exists for this segment
      const records = await pb.collection('playbook').getFullList<PlaybookData>({
        filter: `segmento="${activeSegmento}"`,
      })

      // Fetch distinct real categories from coberturas
      const cobs = await pb
        .collection('coberturas')
        .getFullList<{ categoria_normalizada: string }>({
          fields: 'categoria_normalizada',
        })
      const uniqueCats = Array.from(
        new Set(cobs.map((c) => c.categoria_normalizada).filter(Boolean)),
      ).sort()
      setRealCategories(uniqueCats)

      if (records.length > 0) {
        setPlaybook(records[0])
      } else {
        // Default structured template (no fake customer rows, only operational guidance)
        setPlaybook({
          segmento: activeSegmento,
          mapa_riscos: [
            {
              risco: 'Incêndio & Queda de Raio',
              descricao:
                'Exposição crítica em cozinhas industriais, caldeiras, SPDA e subestações de energia.',
            },
            {
              risco: 'Responsabilidade Civil Operações & Hospedagem',
              descricao:
                'Prejuízos a hóspedes, acidentes em piscinas, restaurantes e guarda de veículos.',
            },
            {
              risco: 'Lucros Cessantes / Perda de Receita',
              descricao: 'Interrupção de atividades após sinistro material durante alta temporada.',
            },
            {
              risco: 'Alagamento e Vendaval',
              descricao:
                'Risco climático em resorts litorâneos e hotéis em zonas de relevo acidentado.',
            },
          ],
          checklist_coberturas: uniqueCats,
          objecoes: [
            {
              objecao: '"Já temos apólice renovada automaticamente com nosso banco."',
              contra_argumento:
                'Bancos praticam apólices genéricas com cláusula de rateio severa e sem sublimites adequados para danos elétricos e alagamento.',
            },
            {
              objecao: '"O seguro empresarial para hotel é muito oneroso."',
              contra_argumento:
                'A auditoria técnica da Bycor costuma identificar coberturas redundantes e recalcular o valor em risco real, otimizando o prêmio em até 22%.',
            },
          ],
          crosssell: [
            {
              produto: 'Seguro de Vida em Grupo',
              oportunidade:
                'Proteção mandatória em convenção coletiva para funcionários de hotelaria.',
            },
            {
              produto: 'D&O (Responsabilidade de Administradores)',
              oportunidade:
                'Blindagem patrimonial para diretores e conselheiros do condomínio hoteleiro.',
            },
            {
              produto: 'Cyber Insurance',
              oportunidade:
                'Proteção contra vazamento de dados de cartões de crédito e cadastros de hóspedes (LGPD).',
            },
          ],
          etapas_prospeccao: [
            '1. Mapeamento da titularidade: Identificar Condomínio do Prédio vs. Operadora Hoteleira.',
            '2. Obtenção do Cartão de Risco e Apólice Vigente para auditoria preliminar gratuita.',
            '3. Análise da Razão LMI / VR DM para apontar risco iminente de rateio (subseguro).',
            '4. Abertura de RFQ competitivo entre 4+ seguradoras com apetite comprovado no segmento.',
            '5. Apresentação da Minuta Comparativa estruturada ao síndico e conselho gestor.',
          ],
          modelos_email: [
            {
              titulo: 'Primeiro Contato — Auditoria de Subseguro',
              corpo:
                'Prezado(a) [Nome],\n\nIdentificamos que grande parte das apólices do segmento de Hotéis & Resorts possui cláusulas de rateio desfavoráveis que podem reduzir em até 40% a indenização em caso de sinistro parcial.\n\nA BYCOR Seguros é especializada na operação de riscos nomeados para hotelaria e realiza a auditoria preventiva da sua apólice sem custo.\n\nPodemos agendar uma breve conversa de 15 minutos nesta semana?',
            },
          ],
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlaybook()
  }, [activeSegmento])

  const handleSavePlaybook = async () => {
    if (!playbook) return
    try {
      setSaving(true)
      const payload = {
        segmento: activeSegmento,
        mapa_riscos: playbook.mapa_riscos,
        checklist_coberturas: playbook.checklist_coberturas,
        objecoes: playbook.objecoes,
        crosssell: playbook.crosssell,
        etapas_prospeccao: playbook.etapas_prospeccao,
        modelos_email: playbook.modelos_email,
        autor: user?.name || user?.email || 'Analista Bycor',
        versao: 1,
      }

      if (playbook.id) {
        await pb.collection('playbook').update(playbook.id, payload)
      } else {
        const created = await pb.collection('playbook').create(payload)
        setPlaybook({ ...playbook, id: created.id })
      }

      setIsEditing(false)
      alert('Playbook salvo com sucesso!')
    } catch (err: unknown) {
      alert('Erro ao salvar: ' + (err as Error).message)
    } finally {
      setSaving(false)
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
            <h2 className="text-xl font-bold text-gray-900">Playbook de Prospecção & Vendas P&C</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Guia operacional de prospecção consultiva: mapa de riscos típicos, quebra de objeções,
            etapas do funil e oportunidades de cross-sell para produtores e corretores Bycor.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isEditing ? (
            <Button
              onClick={handleSavePlaybook}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 font-semibold"
            >
              {saving ? 'Gravando...' : 'Salvar Alterações'}
            </Button>
          ) : (
            <Button
              onClick={() => setIsEditing(true)}
              className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-9 font-semibold flex items-center gap-1.5"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Editar Playbook</span>
            </Button>
          )}
        </div>
      </div>

      {/* Segment Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E4E9F0] pb-2 text-xs font-semibold">
        {segmentos.map((s) => (
          <button
            key={s}
            onClick={() => setActiveSegmento(s)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeSegmento === s
                ? 'bg-[#0F2B46] text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Playbook Body */}
      {loading || !playbook ? (
        <div className="py-16 text-center text-xs text-gray-400">Carregando playbook...</div>
      ) : (
        <div className="space-y-6">
          {/* 1. Mapa de Riscos & Exposições Típicas */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>1. Mapa de Riscos e Exposições Típicas ({activeSegmento})</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {playbook.mapa_riscos.map((r, i) => (
                <div key={i} className="p-3.5 rounded-lg bg-gray-50 border text-xs space-y-1">
                  <div className="font-bold text-gray-900">{r.risco}</div>
                  <p className="text-gray-600 leading-relaxed">{r.descricao}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Checklist de Coberturas Usuais */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>2. Checklist de Coberturas Essenciais na Carteira</span>
              </h3>
              <span className="text-xs text-gray-500">
                {realCategories.length} categorias ativas no banco
              </span>
            </div>

            {realCategories.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400 border border-dashed rounded-lg bg-gray-50">
                <FileSpreadsheet className="w-6 h-6 mx-auto mb-1.5 opacity-50" />
                <p>Nenhuma cobertura cadastrada na carteira ainda.</p>
                <Link
                  to="/c1-recebimento"
                  className="text-[#16578B] font-semibold underline mt-1 block"
                >
                  Importar Base Hotéis e Resorts no Módulo C1
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {realCategories.map((cat, i) => (
                  <div
                    key={i}
                    className="p-2 rounded border bg-blue-50/50 text-[11px] font-medium text-gray-800 flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#16578B] shrink-0" />
                    <span className="truncate" title={cat}>
                      {cat}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Objeções & Contra-Argumentos */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#16578B]" />
              <span>3. Matriz de Objeções & Contra-Argumentos de Vendas</span>
            </h3>

            <div className="space-y-3">
              {playbook.objecoes.map((item, i) => (
                <div key={i} className="p-4 rounded-lg bg-gray-50 border text-xs space-y-2">
                  <div className="font-bold text-red-900">Objeção: {item.objecao}</div>
                  <div className="text-emerald-950 bg-emerald-50/80 p-2.5 rounded border border-emerald-200 leading-relaxed">
                    <strong>Contra-argumento Bycor:</strong> {item.contra_argumento}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Cross-sell & Upsell */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              <span>4. Oportunidades de Cross-sell & Expansão de Conta</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              {playbook.crosssell.map((cs, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-lg border bg-purple-50/30 border-purple-100 space-y-1"
                >
                  <div className="font-bold text-purple-950">{cs.produto}</div>
                  <p className="text-gray-600 leading-relaxed text-[11px]">{cs.oportunidade}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Etapas de Prospecção */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#16578B]" />
              <span>5. Roteiro Passo a Passo de Prospecção Consultiva</span>
            </h3>

            <div className="divide-y divide-gray-100 border rounded-lg bg-gray-50/50">
              {playbook.etapas_prospeccao.map((etapa, i) => (
                <div
                  key={i}
                  className="p-3 text-xs text-gray-800 font-medium flex items-start gap-2"
                >
                  <span className="w-5 h-5 rounded-full bg-[#0F2B46] text-white flex items-center justify-center text-[10px] shrink-0 font-bold">
                    {i + 1}
                  </span>
                  <span>{etapa}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 6. Modelos de E-mail */}
          <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#16578B]" />
              <span>6. Modelos de E-mail e Mensagem de Abordagem</span>
            </h3>

            <div className="space-y-4">
              {playbook.modelos_email.map((m, i) => (
                <div key={i} className="border rounded-lg p-4 bg-gray-50 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <strong className="text-gray-900 font-bold">{m.titulo}</strong>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(m.corpo)
                        alert('Modelo copiado!')
                      }}
                      className="text-[11px] h-7"
                    >
                      Copiar Mensagem
                    </Button>
                  </div>
                  <pre className="p-3 bg-white border rounded text-[11px] font-sans whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {m.corpo}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
