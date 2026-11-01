import React, { useState, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  FileText,
  Printer,
  Download,
  Building,
  Shield,
  Layers,
  Sparkles,
  CheckCircle2,
  Calendar,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { generatePresentationPptx } from '@/services/pptxExportService'

interface EmpreendimentoOpt {
  id: string
  nome_empreendimento: string
  razao_social: string
  cidade: string
  uf: string
  area_construida_m2: number
  num_unidades: number
  faturamento_12m_rs: number
}

interface PropostaOption {
  id: string
  seguradora: string
  versao?: number
  ativa?: boolean
  premio_bruto: number
  lmi_lmg: number
  coberturas: any[]
  status?: string
  data_proposta?: string
  expand?: {
    seguradora?: { id?: string; nome: string }
    rfq?: {
      conta_empreendimento?: string
      expand?: {
        conta_empreendimento?: { id: string; nome_empreendimento: string }
      }
    }
  }
}

// Helpers para extração consistente dos campos de cobertura
function getCoverageName(c: any): string {
  if (!c) return 'Cobertura'
  if (typeof c === 'string') return c.trim() || 'Cobertura'
  const nome =
    c.cobertura ||
    c.nome ||
    c.nome_cobertura ||
    c.nomeOriginal ||
    c.descricao ||
    c.categoriaNormalizada ||
    c.categoria_normalizada ||
    c.categoria ||
    ''
  return typeof nome === 'string' && nome.trim().length > 0 ? nome.trim() : 'Cobertura'
}

function getCoverageLmi(c: any): number | null {
  if (!c || typeof c !== 'object') return null
  if (c.lmi !== undefined && c.lmi !== null && c.lmi !== '') return Number(c.lmi)
  if (c.is !== undefined && c.is !== null && c.is !== '') return Number(c.is)
  if (c.limite !== undefined && c.limite !== null && c.limite !== '') return Number(c.limite)
  return null
}

function getCoverageFranquia(c: any): string {
  if (!c || typeof c !== 'object') return 'Padrão'
  const f = c.franquia || c.pos || c.franquia_pos || c.posFranquia
  if (typeof f === 'string' && f.trim().length > 0) return f.trim()
  return 'Padrão'
}

export default function ApresentacaoPage() {
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoOpt[]>([])
  const [propostas, setPropostas] = useState<PropostaOption[]>([])
  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const [selectedPropId, setSelectedPropId] = useState<string>('')
  const [recomendacao, setRecomendacao] = useState(
    'Recomendamos a contratação da proposta selecionada devido ao equilíbrio ótimo entre Limite Máximo de Indenização (LMI), franquias compatíveis com o histórico operacional do hotel e prêmio competitivo de mercado.',
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchInit = async () => {
      try {
        setLoading(true)
        const [emps, props] = await Promise.all([
          pb.collection('empreendimentos').getFullList<EmpreendimentoOpt>({
            sort: 'nome_empreendimento',
          }),
          pb.collection('propostas').getFullList<PropostaOption>({
            sort: '-created',
            expand: 'seguradora',
          }),
        ])
        setEmpreendimentos(emps)
        setPropostas(props)
        if (emps.length > 0) setSelectedEmpId(emps[0].id)
        if (props.length > 0) {
          const vencedora = props.find((p: any) => p.status === 'Selecionada')
          setSelectedPropId(vencedora ? vencedora.id : props[0].id)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchInit()
  }, [])

  const selectedEmp = empreendimentos.find((e) => e.id === selectedEmpId)

  // Todas as propostas da seguradora da proposta selecionada (para seletor de versões)
  const selectedProp = propostas.find((p) => p.id === selectedPropId)

  // Filtra as opções de propostas: exibe por padrão as propostas ativas de cada seguradora
  const propostasAtivas = propostas.filter((p) => p.ativa)
  const propostasExibicao = propostasAtivas.length > 0 ? propostasAtivas : propostas

  // Seletor de versão para a seguradora atualmente selecionada
  const versoesDaMesmaSeguradora = propostas.filter(
    (p) => selectedProp && p.seguradora === selectedProp.seguradora,
  )

  const handlePrint = () => {
    window.print()
  }

  // Generates a fully valid OpenXML PresentationML (.pptx) file
  const handleExportPptx = () => {
    const coberturas = (selectedProp?.coberturas || []).map((c: any) => ({
      nome: getCoverageName(c),
      lmi: getCoverageLmi(c),
      franquia: getCoverageFranquia(c),
    }))

    const segNomeComVersao = selectedProp?.expand?.seguradora?.nome
      ? `${selectedProp.expand.seguradora.nome} (v${selectedProp.versao || 1})`
      : 'Seguradora Selecionada'

    const pptxBytes = generatePresentationPptx({
      clienteNome: selectedEmp?.nome_empreendimento || 'Cliente Corporativo',
      razaoSocial: selectedEmp?.razao_social,
      cidade: selectedEmp?.cidade,
      uf: selectedEmp?.uf,
      areaConstruida: selectedEmp?.area_construida_m2,
      seguradoraNome: segNomeComVersao,
      premioBruto: selectedProp?.premio_bruto || 0,
      lmiLmg: selectedProp?.lmi_lmg || 0,
      recomendacao,
      coberturas,
    })

    const blob = new Blob([pptxBytes as Uint8Array<ArrayBuffer>], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Bycor_Apresentacao_${selectedEmp?.nome_empreendimento?.replace(/\s+/g, '_') || 'Proposta'}.pptx`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-6 print:space-y-0">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
              Módulo C4
            </span>
            <h2 className="text-xl font-bold text-gray-900">Apresentação Comercial ao Segurado</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Gere a minuta executiva comparativa no padrão visual Bycor pronta para impressão em A4
            ou exportação para apresentação (.pptx).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handlePrint}
            variant="outline"
            className="text-xs h-9 border-gray-300 flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir Minuta A4</span>
          </Button>

          <Button
            onClick={handleExportPptx}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-9 font-semibold flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-blue-300" />
            <span>Exportar PPTX</span>
          </Button>
        </div>
      </div>

      {/* Selectors Bar */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4 print:hidden">
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1">
            Selecione o Cliente / Empreendimento:
          </label>
          <select
            value={selectedEmpId}
            onChange={(e) => setSelectedEmpId(e.target.value)}
            className="w-full h-9 text-xs border border-gray-300 rounded px-2 bg-white"
          >
            {empreendimentos.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.nome_empreendimento} ({emp.cidade || 'SP'} - {emp.uf || 'SP'})
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-700">
              Proposta Vencedora Selecionada:
            </label>
            {selectedProp && (
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-[#16578B] border border-blue-200">
                v{selectedProp.versao || 1} {selectedProp.ativa ? '● ativa' : ''}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={selectedPropId}
              onChange={(e) => setSelectedPropId(e.target.value)}
              className="flex-1 h-9 text-xs border border-gray-300 rounded px-2 bg-white"
            >
              {propostasExibicao.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.expand?.seguradora?.nome || 'Seguradora'} (v{prop.versao || 1}) —{' '}
                  {formatCurrency(prop.premio_bruto)}
                  {prop.status === 'Selecionada' ? ' [Selecionada em C3]' : ''}
                </option>
              ))}
            </select>

            {/* Seletor específico de versão da mesma seguradora */}
            {versoesDaMesmaSeguradora.length > 1 && (
              <select
                value={selectedPropId}
                onChange={(e) => setSelectedPropId(e.target.value)}
                className="w-36 h-9 text-xs border border-blue-300 bg-blue-50/60 rounded px-2 text-[#16578B] font-bold"
                title="Trocar a versão da proposta desta mesma seguradora para a apresentação"
              >
                {versoesDaMesmaSeguradora.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versao || 1} {v.ativa ? '★ Ativa' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* A4 PRINT PREVIEW LAYOUT */}
      <div className="bg-white max-w-4xl mx-auto rounded-xl border border-[#E4E9F0] shadow-md p-8 sm:p-12 space-y-8 text-gray-900 print:m-0 print:p-0 print:border-none print:shadow-none print:max-w-none print:w-full print:space-y-6">
        {/* Document Header */}
        <div className="flex items-center justify-between border-b pb-6 print:pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#0F2B46] text-white flex items-center justify-center font-bold text-xl">
              BY
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-[#0F2B46]">
                BYCOR CONSULTORIA E CORRETORA DE SEGUROS
              </h1>
              <p className="text-xs text-gray-500">
                Relatório Técnico de Recomendação e Apresentação Comercial P&C
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-gray-400">
            <div>Data: {formatDate(new Date().toISOString())}</div>
            <div>Versão: Minuta Executiva 1.0</div>
          </div>
        </div>

        {/* 1. Perfil do Cliente */}
        <div className="space-y-3 print:break-inside-avoid">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Building className="w-4 h-4" />
            1. Perfil Operacional do Segurado
          </h2>
          <div className="p-4 rounded-lg bg-gray-50 border text-xs grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className="text-gray-400 block">Empreendimento</span>
              <strong className="text-gray-900">{selectedEmp?.nome_empreendimento || '—'}</strong>
            </div>
            <div>
              <span className="text-gray-400 block">Razão Social</span>
              <strong className="text-gray-900">{selectedEmp?.razao_social || '—'}</strong>
            </div>
            <div>
              <span className="text-gray-400 block">Localização</span>
              <strong className="text-gray-900">
                {selectedEmp?.cidade || 'São Paulo'} - {selectedEmp?.uf || 'SP'}
              </strong>
            </div>
            <div>
              <span className="text-gray-400 block">Área Construída</span>
              <strong className="text-gray-900">
                {selectedEmp?.area_construida_m2 ? `${selectedEmp.area_construida_m2} m²` : '—'}
              </strong>
            </div>
          </div>
        </div>

        {/* 2. Proposta Recomendada & Condições Financeiras */}
        <div className="space-y-3 print:break-inside-avoid">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Shield className="w-4 h-4" />
            2. Estrutura da Apólice Recomendada
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-lg bg-blue-50/60 border border-blue-200">
              <div className="flex items-center justify-between">
                <span className="text-blue-600 font-medium">Seguradora Líder</span>
                {selectedProp && (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-[#16578B] border border-blue-200">
                    Versão {selectedProp.versao || 1}
                  </span>
                )}
              </div>
              <strong className="text-base text-[#0F2B46] block mt-1">
                {selectedProp?.expand?.seguradora?.nome || 'Seguradora Selecionada'}
              </strong>
              <span className="text-[11px] text-gray-500">Avaliação técnica aprovada</span>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 border">
              <span className="text-gray-500 block font-medium">LMI / LMG Consolidado</span>
              <strong className="text-base text-gray-900 block mt-1 tabular-nums">
                {formatCurrency(selectedProp?.lmi_lmg)}
              </strong>
              <span className="text-[11px] text-gray-500">Garantia patrimonial</span>
            </div>
            <div className="p-4 rounded-lg bg-emerald-50/60 border border-emerald-200">
              <span className="text-emerald-700 block font-medium">
                Investimento (Prêmio Total)
              </span>
              <strong className="text-base text-emerald-950 block mt-1 tabular-nums">
                {formatCurrency(selectedProp?.premio_bruto)}
              </strong>
              <span className="text-[11px] text-emerald-700 font-semibold">Com IOF incluso</span>
            </div>
          </div>
        </div>

        {/* 3. Coberturas Tabuladas */}
        <div className="space-y-3 print:break-inside-auto">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Layers className="w-4 h-4" />
            3. Resumo de Coberturas Incluídas
          </h2>
          <div className="border rounded-lg overflow-hidden text-xs">
            <table className="w-full text-left">
              <thead className="bg-gray-100 text-gray-700 font-semibold border-b">
                <tr>
                  <th className="py-2.5 px-3">Garantia / Cobertura</th>
                  <th className="py-2.5 px-3 text-right">Limite (LMI)</th>
                  <th className="py-2.5 px-3">Franquia / POS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {selectedProp?.coberturas && selectedProp.coberturas.length > 0 ? (
                  selectedProp.coberturas.map((c, i) => {
                    const nome = getCoverageName(c)
                    const lmi = getCoverageLmi(c)
                    const franquia = getCoverageFranquia(c)
                    return (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-2 px-3 font-semibold text-gray-900">{nome}</td>
                        <td className="py-2 px-3 text-right font-bold text-gray-900 tabular-nums">
                          {formatCurrency(lmi)}
                        </td>
                        <td className="py-2 px-3 text-gray-600">{franquia}</td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-gray-400">
                      Coberturas padrão conforme edital de cotação.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Parecer e Recomendação do Corretor */}
        <div className="space-y-2 print:break-inside-avoid">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            4. Parecer Técnico e Recomendação da Corretora
          </h2>
          {/* Visualização de tela com textarea editável */}
          <textarea
            value={recomendacao}
            onChange={(e) => setRecomendacao(e.target.value)}
            className="w-full p-3 rounded-lg border text-xs leading-relaxed text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#16578B] print:hidden"
            rows={4}
          />
          {/* Visualização de impressão garantindo renderização completa do parecer sem scrollbar nem corte */}
          <div className="hidden print:block text-xs leading-relaxed text-gray-800 p-2 bg-gray-50/50 rounded border border-gray-200">
            {recomendacao}
          </div>
        </div>

        {/* Signatures Footer */}
        <div className="pt-8 border-t grid grid-cols-2 gap-8 text-center text-xs text-gray-600 print:break-inside-avoid print:pt-6">
          <div>
            <div className="border-b w-48 mx-auto mb-1"></div>
            <strong>BYCOR Seguros</strong>
            <p className="text-[11px] text-gray-400">Consultoria Técnica P&C</p>
          </div>
          <div>
            <div className="border-b w-48 mx-auto mb-1"></div>
            <strong>{selectedEmp?.nome_empreendimento || 'De Acordo do Segurado'}</strong>
            <p className="text-[11px] text-gray-400">Assinatura de Aceite</p>
          </div>
        </div>
      </div>
    </div>
  )
}
