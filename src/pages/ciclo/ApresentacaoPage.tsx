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
  premio_bruto: number
  lmi_lmg: number
  coberturas: any[]
  expand?: {
    seguradora?: { nome: string }
  }
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
        if (props.length > 0) setSelectedPropId(props[0].id)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchInit()
  }, [])

  const selectedEmp = empreendimentos.find((e) => e.id === selectedEmpId)
  const selectedProp = propostas.find((p) => p.id === selectedPropId)

  const handlePrint = () => {
    window.print()
  }

  // Generates a mock PPTX download file (XML presentation container)
  const handleExportPptx = () => {
    const pptxContent = `BYCOR Seguros - Apresentação Comercial P&C
Cliente: ${selectedEmp?.nome_empreendimento || 'Cliente Corporativo'}
Seguradora Recomendada: ${selectedProp?.expand?.seguradora?.nome || 'Seguradora'}
Prêmio Total: ${formatCurrency(selectedProp?.premio_bruto)}
LMI Consolidado: ${formatCurrency(selectedProp?.lmi_lmg)}

Recomendação do Analista:
${recomendacao}
`
    const blob = new Blob([pptxContent], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Bycor_Apresentacao_${selectedEmp?.nome_empreendimento?.replace(/\s+/g, '_') || 'Proposta'}.pptx`
    a.click()
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
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
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <label className="text-xs font-semibold text-gray-700 block mb-1">
            Proposta Vencedora Selecionada:
          </label>
          <select
            value={selectedPropId}
            onChange={(e) => setSelectedPropId(e.target.value)}
            className="w-full h-9 text-xs border border-gray-300 rounded px-2 bg-white"
          >
            {propostas.map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.expand?.seguradora?.nome || 'Seguradora'} —{' '}
                {formatCurrency(prop.premio_bruto)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* A4 PRINT PREVIEW LAYOUT */}
      <div className="bg-white max-w-4xl mx-auto rounded-xl border border-[#E4E9F0] shadow-md p-8 sm:p-12 space-y-8 text-gray-900 print:m-0 print:p-0 print:border-none print:shadow-none">
        {/* Document Header */}
        <div className="flex items-center justify-between border-b pb-6">
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
        <div className="space-y-3">
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
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Shield className="w-4 h-4" />
            2. Estrutura da Apólice Recomendada
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-lg bg-blue-50/60 border border-blue-200">
              <span className="text-blue-600 block font-medium">Seguradora Líder</span>
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
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Layers className="w-4 h-4" />
            3. Resumo de Coberturas Incluídas
          </h2>
          <div className="border rounded-lg overflow-hidden text-xs">
            <table className="w-full text-left">
              <thead className="bg-gray-100 text-gray-700 font-semibold border-b">
                <tr>
                  <th className="py-2.5 px-3">Garantia / Cobertura</th>
                  <th className="py-2.5 px-3">Categoria Normalizada</th>
                  <th className="py-2.5 px-3 text-right">Limite (LMI)</th>
                  <th className="py-2.5 px-3">Franquia / POS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {selectedProp?.coberturas && selectedProp.coberturas.length > 0 ? (
                  selectedProp.coberturas.map((c, i) => (
                    <tr key={i}>
                      <td className="py-2 px-3 font-semibold text-gray-900">{c.nome}</td>
                      <td className="py-2 px-3 text-gray-600">{c.categoria_normalizada}</td>
                      <td className="py-2 px-3 text-right font-bold text-gray-900 tabular-nums">
                        {formatCurrency(c.lmi)}
                      </td>
                      <td className="py-2 px-3 text-gray-500">{c.franquia || 'Padrão'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-gray-400">
                      Coberturas padrão conforme edital de cotação.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Parecer e Recomendação do Corretor */}
        <div className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#16578B] flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            4. Parecer Técnico e Recomendação da Corretora
          </h2>
          <textarea
            value={recomendacao}
            onChange={(e) => setRecomendacao(e.target.value)}
            className="w-full p-3 rounded-lg border text-xs leading-relaxed text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#16578B] print:border-none print:p-0"
            rows={4}
          />
        </div>

        {/* Signatures Footer */}
        <div className="pt-8 border-t grid grid-cols-2 gap-8 text-center text-xs text-gray-600">
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
