import React from 'react'
import {
  FileText,
  Download,
  Building,
  UserCheck,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/formatters'
import { PropostaInputEstudo } from '@/services/estudoMercadoResolver'
import { COBERTURAS_ESTUDO_42 } from '@/services/estudoMercadoCanonicas'

export interface EstudoMercadoFormState {
  objetivoTexto: string
  objetivoImportanteTexto: string
  contatoInspecaoNome: string
  contatoInspecaoTel: string
  contatoInspecaoEmail: string
  cosseguradoContratacao: string
  sugestaoCustosDefesa: string
  observacoesContratacao: string
  assinaturaCargo: string
  dataApresentacaoTexto: string
}

interface SecaoEstudoMercadoProps {
  formState: EstudoMercadoFormState
  onChangeFormState: (field: keyof EstudoMercadoFormState, val: string) => void
  onExportarPptx: () => void
  isExporting: boolean
  empreendimentoNome: string
  propostasComparadas: PropostaInputEstudo[]
}

export function SecaoEstudoMercado({
  formState,
  onChangeFormState,
  onExportarPptx,
  isExporting,
  empreendimentoNome,
  propostasComparadas,
}: SecaoEstudoMercadoProps) {
  const [aberto, setAberto] = React.useState(true)
  const [tabAtiva, setTabAtiva] = React.useState<'campos' | 'grade'>('campos')

  return (
    <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
      {/* Header Retrátil com Ação de Exportar */}
      <div className="p-5 bg-gradient-to-r from-[#0F2B46] to-[#16578B] text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-400 text-gray-900">
              Estudo de Mercado F1
            </span>
            <h3 className="text-lg font-bold">Apresentação PPTX Editável em 12 Páginas</h3>
          </div>
          <p className="text-xs text-blue-100 mt-1">
            Gera o arquivo PowerPoint idêntico ao modelo oficial Bycor ({empreendimentoNome}) pronto
            para edição final pelo analista.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAberto(!aberto)}
            variant="outline"
            size="sm"
            className="text-xs h-9 bg-white/10 hover:bg-white/20 border-white/20 text-white"
          >
            {aberto ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 mr-1" /> Ocultar Campos
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 mr-1" /> Editar Campos
              </>
            )}
          </Button>

          <Button
            onClick={onExportarPptx}
            disabled={isExporting}
            className="bg-emerald-500 hover:bg-emerald-600 text-gray-950 font-bold text-xs h-9 shadow-md flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-gray-950" />
            <span>{isExporting ? 'Gerando PPTX...' : 'Exportar Estudo de Mercado (PPTX)'}</span>
          </Button>
        </div>
      </div>

      {aberto && (
        <div className="p-6 space-y-6">
          {/* Abas internas: Campos Editáveis vs Prévia das 42 Coberturas */}
          <div className="flex items-center gap-2 border-b pb-3">
            <button
              type="button"
              onClick={() => setTabAtiva('campos')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                tabAtiva === 'campos'
                  ? 'bg-blue-50 text-[#16578B] border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Campos Editáveis do Analista (Blocos 04 e 11)
            </button>
            <button
              type="button"
              onClick={() => setTabAtiva('grade')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                tabAtiva === 'grade'
                  ? 'bg-blue-50 text-[#16578B] border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Tabela das 42 Coberturas Canônicas ({propostasComparadas.length} cias na mesa)
            </button>
          </div>

          {tabAtiva === 'campos' ? (
            <div className="space-y-6">
              {/* Bloco 04: Objetivo do Estudo */}
              <div className="bg-gray-50/80 rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#0F2B46] font-bold text-xs uppercase tracking-wide">
                  <Shield className="w-4 h-4 text-[#16578B]" />
                  <span>Bloco 04 — Objetivo do Estudo (Editável)</span>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-gray-700">
                    Texto de Transição e Contextualização do Empreendimento:
                  </Label>
                  <Textarea
                    value={formState.objetivoTexto}
                    onChange={(e) => onChangeFormState('objetivoTexto', e.target.value)}
                    rows={3}
                    className="text-xs bg-white"
                    placeholder="Estudo de transição, para proteção patrimonial..."
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-red-700">
                    Parágrafo de Aviso e Responsabilidade dos LMI / LMGA (Alerta Importante):
                  </Label>
                  <Textarea
                    value={formState.objetivoImportanteTexto}
                    onChange={(e) => onChangeFormState('objetivoImportanteTexto', e.target.value)}
                    rows={3}
                    className="text-xs bg-white text-gray-800"
                    placeholder="Os valores de LMI por cobertura assim como LMGA..."
                  />
                </div>
              </div>

              {/* Bloco 11: Opções de Contratação & Inspeção */}
              <div className="bg-gray-50/80 rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 text-[#0F2B46] font-bold text-xs uppercase tracking-wide">
                  <UserCheck className="w-4 h-4 text-[#16578B]" />
                  <span>Bloco 11 — Opções de Contratação &amp; Inspeção de Risco (Editável)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Contato para Inspeção (Nome):
                    </Label>
                    <Input
                      type="text"
                      value={formState.contatoInspecaoNome}
                      onChange={(e) => onChangeFormState('contatoInspecaoNome', e.target.value)}
                      placeholder="Nome do responsável técnico no risco"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Telefone / Celular:
                    </Label>
                    <Input
                      type="text"
                      value={formState.contatoInspecaoTel}
                      onChange={(e) => onChangeFormState('contatoInspecaoTel', e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      E-mail de Contato:
                    </Label>
                    <Input
                      type="email"
                      value={formState.contatoInspecaoEmail}
                      onChange={(e) => onChangeFormState('contatoInspecaoEmail', e.target.value)}
                      placeholder="contato@hotel.com.br"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Cossegurado na Contratação:
                    </Label>
                    <Input
                      type="text"
                      value={formState.cosseguradoContratacao}
                      onChange={(e) => onChangeFormState('cosseguradoContratacao', e.target.value)}
                      placeholder="BT Morumbi Hotéis Ltda - 22.417.104/0001-39"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Sugestão de Custos de Defesa (Item 4 da Nova Lei):
                    </Label>
                    <Input
                      type="text"
                      value={formState.sugestaoCustosDefesa}
                      onChange={(e) => onChangeFormState('sugestaoCustosDefesa', e.target.value)}
                      placeholder="R$ 100.000,00"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Data da Apresentação:
                    </Label>
                    <Input
                      type="text"
                      value={formState.dataApresentacaoTexto}
                      onChange={(e) => onChangeFormState('dataApresentacaoTexto', e.target.value)}
                      placeholder="28/10/2026"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Cargo do Responsável:
                    </Label>
                    <Input
                      type="text"
                      value={formState.assinaturaCargo}
                      onChange={(e) => onChangeFormState('assinaturaCargo', e.target.value)}
                      placeholder="Síndico / Diretor Financeiro"
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-gray-700">
                      Observação de Prazo / Aceitação:
                    </Label>
                    <Input
                      type="text"
                      value={formState.observacoesContratacao}
                      onChange={(e) => onChangeFormState('observacoesContratacao', e.target.value)}
                      placeholder="A seguradora terá prazo de até 25 dias..."
                      className="text-xs bg-white h-8 mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  Estrutura canônica de <strong>42 coberturas</strong> resolvida em conformidade com
                  a Grade da C3 (tabulação).
                </span>
                <span className="font-semibold text-[#16578B]">
                  {propostasComparadas.length} seguradora(s) na mesa
                </span>
              </div>

              <div className="max-h-96 overflow-y-auto border rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0F2B46] text-white sticky top-0">
                    <tr>
                      <th className="py-2 px-3 w-12 text-center">Nº</th>
                      <th className="py-2 px-3">Cobertura Canônica (Bycor)</th>
                      <th className="py-2 px-3 text-right">LMI Solicitado</th>
                      {propostasComparadas.map((p) => (
                        <th key={p.id} className="py-2 px-3 text-center">
                          {p.seguradoraNome}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {COBERTURAS_ESTUDO_42.map((c) => (
                      <tr key={c.numero} className="hover:bg-gray-50">
                        <td className="py-1.5 px-3 text-center font-mono font-bold text-gray-500">
                          {c.numero}
                        </td>
                        <td className="py-1.5 px-3 font-semibold text-gray-900">{c.titulo}</td>
                        <td className="py-1.5 px-3 text-right font-mono text-gray-700">
                          {typeof c.lmiSolicitado === 'number'
                            ? formatCurrency(c.lmiSolicitado)
                            : c.lmiSolicitado}
                        </td>
                        {propostasComparadas.map((p) => (
                          <td
                            key={p.id}
                            className="py-1.5 px-3 text-center font-medium text-emerald-800"
                          >
                            ✓
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
