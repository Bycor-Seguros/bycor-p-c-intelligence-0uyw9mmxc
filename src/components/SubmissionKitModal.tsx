import React, { useState, useMemo } from 'react'
import {
  Copy,
  Check,
  FileSpreadsheet,
  Printer,
  Search,
  Filter,
  Building,
  ShieldCheck,
  AlertTriangle,
  Flame,
  CheckCircle2,
  ExternalLink,
  Layers,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SubmissionKitData,
  SubmissionKitField,
  generateSubmissionKitXlsx,
  printSubmissionKitPdf,
} from '@/services/submissionKitService'

interface SubmissionKitModalProps {
  data: SubmissionKitData | null
  loading: boolean
  onClose: () => void
}

export function SubmissionKitModal({ data, loading, onClose }: SubmissionKitModalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategoria, setSelectedCategoria] = useState<string>('TODAS')
  const [copiedAll, setCopiedAll] = useState(false)

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => {
        setCopiedId(null)
      }, 2000)
    } catch (err) {
      console.error('Falha ao copiar:', err)
    }
  }

  const handleCopySummary = async () => {
    if (!data) return
    const lines: string[] = [
      `=== SUBMISSÃO DE RFQ - ${data.rfqCode} ===`,
      `Segurado: ${data.razaoSocial}`,
      `CNPJ: ${data.cnpj}`,
      `Local de Risco: ${data.endereco} ${data.cidade ? `— ${data.cidade}/${data.uf}` : ''}`,
      `Atividade: ${data.atividadeExercida || data.atividade}`,
      `Tipo Cobertura: ${data.tipoCobertura}`,
      `VRD Prédio / DM: ${data.vrdPredio ? `R$ ${data.vrdPredio.toLocaleString('pt-BR')}` : '—'}`,
      `VRD LC: ${data.vrdLucrosCessantes ? `R$ ${data.vrdLucrosCessantes.toLocaleString('pt-BR')}` : '—'}`,
      `VRD Total: ${data.vrdTotal ? `R$ ${data.vrdTotal.toLocaleString('pt-BR')}` : '—'}`,
      `Padrão Construtivo: ${data.tipoConstrucao || '—'}`,
      `SLA Cotação: ${data.prazoLimite}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 2200)
    } catch (err) {
      console.error(err)
    }
  }

  const categorias = useMemo(() => {
    if (!data) return []
    const cats = Array.from(new Set(data.fields.map((f) => f.categoria)))
    return cats
  }, [data])

  const filteredFields = useMemo(() => {
    if (!data) return []
    return data.fields.filter((field) => {
      const matchCat = selectedCategoria === 'TODAS' || field.categoria === selectedCategoria
      const matchSearch =
        searchTerm.trim() === '' ||
        field.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        field.value.toLowerCase().includes(searchTerm.toLowerCase())
      return matchCat && matchSearch
    })
  }, [data, selectedCategoria, searchTerm])

  if (loading) {
    return (
      <div className="py-20 text-center space-y-3">
        <div className="w-10 h-10 border-4 border-[#16578B] border-t-transparent rounded-full animate-spin mx-auto" />
        <h4 className="text-sm font-semibold text-gray-800">Compilando Kit de Submissão...</h4>
        <p className="text-xs text-gray-500 max-w-sm mx-auto">
          Lendo Cartão de Risco, VRD, histórico de sinistros, apólices e coberturas vinculadas ao
          RFQ.
        </p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="py-16 text-center space-y-3">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
        <h4 className="text-sm font-semibold text-gray-800">
          Dados insuficientes para gerar o Kit
        </h4>
        <p className="text-xs text-gray-500 max-w-md mx-auto">
          Este RFQ não possui um empreendimento ou processo de apólice associado. Importe a planilha
          na aba C1 ou selecione um empreendimento válido.
        </p>
        <Button onClick={onClose} variant="outline" className="text-xs mt-3">
          Fechar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5 text-xs">
      {/* Barra de Formatos e Downloads rápidos */}
      <div className="bg-gradient-to-r from-[#0F2B46] to-[#16578B] text-white p-4 sm:p-5 rounded-xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
              {data.rfqCode}
            </span>
            <span className="font-semibold text-sm">Kit de Submissão para Portais</span>
          </div>
          <p className="text-blue-100 text-[11px] mt-1 max-w-xl">
            {data.nomeEmpreendimento} · Agilize a entrega no portal das seguradoras sem redigitação
            manual. Gere a planilha padronizada, o PDF ou copie campo a campo com 1 clique.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => generateSubmissionKitXlsx(data)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-3.5 shadow-sm flex items-center gap-2"
            title="Exportar XLSX estruturado pronto para envio aos portais que aceitam anexo de planilha"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
            <span>Baixar XLSX Padronizado</span>
          </Button>

          <Button
            onClick={() => printSubmissionKitPdf(data)}
            variant="outline"
            className="bg-white/10 hover:bg-white/20 border-white/30 text-white font-semibold text-xs h-9 px-3.5 flex items-center gap-2"
            title="Abrir layout de impressão formatado em folha A4 para salvar como PDF"
          >
            <Printer className="w-4 h-4 text-blue-200" />
            <span>Gerar PDF / Imprimir</span>
          </Button>

          <Button
            onClick={handleCopySummary}
            variant="outline"
            className="bg-white/10 hover:bg-white/20 border-white/30 text-white font-semibold text-xs h-9 px-3 flex items-center gap-1.5"
            title="Copiar resumo textual dos dados principais"
          >
            {copiedAll ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-300" />
                <span className="text-emerald-200">Resumo Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-blue-200" />
                <span>Copiar Resumo</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Cartões Rápidos de Destaque */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg">
          <span className="text-[10px] text-gray-500 uppercase font-semibold block">
            Segurado / CNPJ
          </span>
          <div className="font-bold text-gray-900 truncate mt-0.5" title={data.razaoSocial}>
            {data.razaoSocial || data.nomeEmpreendimento}
          </div>
          <div className="text-[11px] font-mono text-gray-600">{data.cnpj || 'Sem CNPJ'}</div>
        </div>

        <div className="bg-blue-50/70 border border-blue-200 p-3 rounded-lg">
          <span className="text-[10px] text-blue-700 uppercase font-semibold block">
            VRD Total Declarado
          </span>
          <div className="font-bold text-[#0F2B46] text-sm mt-0.5">
            {data.vrdTotal ? `R$ ${data.vrdTotal.toLocaleString('pt-BR')}` : 'A definir'}
          </div>
          <div className="text-[10px] text-blue-800">Tipo: {data.tipoCobertura}</div>
        </div>

        <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-lg">
          <span className="text-[10px] text-amber-700 uppercase font-semibold block">
            Padrão / Proteções
          </span>
          <div className="font-bold text-gray-900 mt-0.5 truncate">
            {data.tipoConstrucao || 'Alvenaria'}
          </div>
          <div className="text-[10px] text-amber-800">
            {Object.values(data.protecoes).filter(Boolean).length} proteções ativas
          </div>
        </div>

        <div className="bg-teal-50/70 border border-teal-200 p-3 rounded-lg">
          <span className="text-[10px] text-teal-700 uppercase font-semibold block">
            Sinistros Declarados
          </span>
          <div className="font-bold text-gray-900 mt-0.5">
            {data.sinistros.length === 0
              ? 'Nenhum (0 em 5 anos)'
              : `${data.sinistros.length} evento(s)`}
          </div>
          <div className="text-[10px] text-teal-800">
            {data.coberturas.length} coberturas no edital
          </div>
        </div>
      </div>

      {/* Painel de Cópia Rápida Campo a Campo */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Barra de Filtros e Busca */}
        <div className="p-3.5 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
            <Input
              type="text"
              placeholder="Buscar campo (ex: CNPJ, VRD, bombeiros, piscina)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-xs bg-white"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <Button
              size="sm"
              variant={selectedCategoria === 'TODAS' ? 'default' : 'outline'}
              onClick={() => setSelectedCategoria('TODAS')}
              className={`h-7 text-[11px] px-2.5 ${
                selectedCategoria === 'TODAS'
                  ? 'bg-[#0F2B46] text-white hover:bg-[#1B3C5D]'
                  : 'text-gray-700 bg-white'
              }`}
            >
              Todas ({data.fields.length})
            </Button>
            {categorias.map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={selectedCategoria === cat ? 'default' : 'outline'}
                onClick={() => setSelectedCategoria(cat)}
                className={`h-7 text-[11px] px-2.5 whitespace-nowrap ${
                  selectedCategoria === cat
                    ? 'bg-[#0F2B46] text-white hover:bg-[#1B3C5D]'
                    : 'text-gray-700 bg-white'
                }`}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Tabela de Campos com Botão Copiar */}
        <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
          {filteredFields.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              Nenhum campo corresponde ao filtro selecionado.
            </div>
          ) : (
            filteredFields.map((field) => {
              const isCopied = copiedId === field.id
              return (
                <div
                  key={field.id}
                  className={`p-3 flex items-center justify-between gap-4 transition-colors ${
                    isCopied
                      ? 'bg-emerald-50/70'
                      : field.destaque
                        ? 'bg-blue-50/20 hover:bg-blue-50/40'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                        {field.categoria}
                      </span>
                      {field.destaque && (
                        <span className="text-[9px] font-bold bg-blue-100 text-[#16578B] px-1.5 py-0.2 rounded">
                          Destaque
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-gray-900 text-xs mt-0.5">{field.label}</div>
                    <div className="text-gray-700 text-xs mt-1 font-mono bg-white inline-block px-2 py-0.5 rounded border border-gray-200 select-all max-w-full break-all">
                      {field.value}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant={isCopied ? 'default' : 'outline'}
                    onClick={() => handleCopy(field.id, field.value)}
                    className={`h-8 px-3 text-xs shrink-0 transition-all font-semibold flex items-center gap-1.5 ${
                      isCopied
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                        : 'border-gray-300 hover:border-gray-400 text-gray-700 bg-white'
                    }`}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-white animate-scale-in" />
                        <span>Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-gray-500" />
                        <span>Copiar</span>
                      </>
                    )}
                  </Button>
                </div>
              )
            })
          )}
        </div>

        {/* Rodapé do painel */}
        <div className="p-3 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between text-[11px] text-gray-500 gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>
              Dica: clique em <strong>Copiar</strong> para enviar cada dado direto ao formulário do
              portal da seguradora.
            </span>
          </div>
          <div className="font-semibold text-gray-700">
            {filteredFields.length} de {data.fields.length} campos exibidos
          </div>
        </div>
      </div>

      {/* Botão de Fechar */}
      <div className="flex justify-end pt-1">
        <Button onClick={onClose} variant="outline" className="text-xs h-9 px-4">
          Fechar Kit de Submissão
        </Button>
      </div>
    </div>
  )
}
