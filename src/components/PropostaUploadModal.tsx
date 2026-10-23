import React, { useState, useRef } from 'react'
import {
  Upload,
  FileText,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Layers,
  Sparkles,
  Info,
  Calendar,
  DollarSign,
  ShieldCheck,
  ChevronRight,
  Edit2,
  X,
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
import {
  processPropostaPdf,
  PropostaSegmentoExtracao,
  LeitorPropostaResultado,
  ExtractedCoberturaItem,
} from '@/services/propostaReader'
import { registrarPropostaComArquivo, RfqSeguradoraRecord } from '@/services/rfqPropostasService'
import { canonicalizeInsurerName } from '@/services/guardiaImporter'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { isCoberturaBasica, isCoberturaLucrosCessantes } from '@/services/submissionKitService'

interface PropostaUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rfqId: string
  rfqNumero?: string
  seguradorasDisponiveis: Array<{ id: string; nome: string }>
  initialSeguradoraId?: string
  initialSeguradoraNome?: string
  onSuccess: (resultado: {
    propostaId: string
    rfqSeguradora: RfqSeguradoraRecord
    seguradoraNome: string
    autoCadastrada: boolean
  }) => void
}

type Step = 'upload' | 'select_segment' | 'preview'

export default function PropostaUploadModal({
  open,
  onOpenChange,
  rfqId,
  rfqNumero,
  seguradorasDisponiveis,
  initialSeguradoraId,
  initialSeguradoraNome,
  onSuccess,
}: PropostaUploadModalProps) {
  const [step, setStep] = useState<Step>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [extractionResult, setExtractionResult] = useState<LeitorPropostaResultado | null>(null)
  const [selectedSegment, setSelectedSegment] = useState<PropostaSegmentoExtracao | null>(null)

  // Campos editáveis na pré-visualização (nunca grava sem confirmação humana)
  const [targetSeguradoraId, setTargetSeguradoraId] = useState<string>('')
  const [seguradoraNome, setSeguradoraNome] = useState<string>('')
  const [seguradoraCnpj, setSeguradoraCnpj] = useState<string>('')
  const [seguradoraSusep, setSeguradoraSusep] = useState<string>('')
  const [dataProposta, setDataProposta] = useState<string>('')
  const [numeroCotacao, setNumeroCotacao] = useState<string>('')
  const [versao, setVersao] = useState<string>('')
  const [validadeCotacao, setValidadeCotacao] = useState<string>('')
  const [vigenciaInicio, setVigenciaInicio] = useState<string>('')
  const [vigenciaFim, setVigenciaFim] = useState<string>('')
  const [premioLiquido, setPremioLiquido] = useState<string>('')
  const [premioBruto, setPremioBruto] = useState<string>('')
  const [iof, setIof] = useState<string>('')
  const [custoApolice, setCustoApolice] = useState<string>('')
  const [lmiLmg, setLmiLmg] = useState<string>('')
  const [posFranquias, setPosFranquias] = useState<string>('')
  const [formaPagamento, setFormaPagamento] = useState<string>('')
  const [numeroParcelas, setNumeroParcelas] = useState<string>('')
  const [clausulas, setClausulas] = useState<string>('')
  const [exclusoes, setExclusoes] = useState<string>('')
  const [coberturas, setCoberturas] = useState<ExtractedCoberturaItem[]>([])

  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Ao abrir o modal, reseta ou inicializa com a seguradora da linha
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState()
    } else {
      if (initialSeguradoraId) {
        setTargetSeguradoraId(initialSeguradoraId)
        setSeguradoraNome(initialSeguradoraNome || '')
      }
    }
    onOpenChange(newOpen)
  }

  const resetState = () => {
    setStep('upload')
    setSelectedFile(null)
    setIsProcessing(false)
    setExtractionResult(null)
    setSelectedSegment(null)
    setErrorMessage(null)
    setTargetSeguradoraId(initialSeguradoraId || '')
    setSeguradoraNome(initialSeguradoraNome || '')
  }

  // Preenche formulário da prévia a partir do segmento extraído
  const applySegmentToForm = (seg: PropostaSegmentoExtracao) => {
    setSelectedSegment(seg)

    // Tenta casar a seguradora detectada com as do banco (match estrito por token/canônica, sem colisão de substring)
    const detectedCanonical = canonicalizeInsurerName(seg.seguradora.nomeCanonica)
    const matchedBank = seguradorasDisponiveis.find((s) => {
      const sCanonical = canonicalizeInsurerName(s.nome)
      if (detectedCanonical && sCanonical) {
        return detectedCanonical === sCanonical
      }
      const sLower = s.nome.toLowerCase().trim()
      const detectedName = seg.seguradora.nomeCanonica.toLowerCase().trim()
      return sLower === detectedName
    })

    if (matchedBank) {
      setTargetSeguradoraId(matchedBank.id)
      setSeguradoraNome(matchedBank.nome)
    } else if (initialSeguradoraId) {
      setTargetSeguradoraId(initialSeguradoraId)
      setSeguradoraNome(
        initialSeguradoraNome || seg.seguradora.razaoSocial || seg.seguradora.nomeCanonica,
      )
    } else {
      setTargetSeguradoraId('auto') // Marca para auto-cadastro no Mapa
      setSeguradoraNome(seg.seguradora.razaoSocial || seg.seguradora.nomeCanonica)
    }

    setSeguradoraCnpj(seg.seguradora.cnpj || '')
    setSeguradoraSusep(seg.seguradora.susep || '')
    setDataProposta(seg.dataCotacao || new Date().toISOString().slice(0, 10))
    setNumeroCotacao(seg.numeroCotacao || '')
    setVersao(seg.versao || '1')
    setValidadeCotacao(seg.validadeCotacao || '')
    setVigenciaInicio(seg.vigenciaInicio || '')
    setVigenciaFim(seg.vigenciaFim || '')
    setPremioLiquido(seg.premioLiquido ? String(seg.premioLiquido) : '')
    setPremioBruto(seg.premioTotal ? String(seg.premioTotal) : '')
    setIof(seg.iof ? String(seg.iof) : '')
    setCustoApolice(
      seg.custoApolice !== undefined && seg.custoApolice !== null ? String(seg.custoApolice) : '',
    )
    setLmiLmg(seg.lmiTotal ? String(seg.lmiTotal) : '')
    setPosFranquias(seg.posFranquiasGerais || '')
    setFormaPagamento(seg.formaPagamento || '')
    setNumeroParcelas(seg.numeroParcelas ? String(seg.numeroParcelas) : '')
    setCoberturas(seg.coberturas || [])
    setStep('preview')
  }

  // Executa processamento do arquivo PDF
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setIsProcessing(true)
    setErrorMessage(null)

    try {
      const res = await processPropostaPdf(file)
      setExtractionResult(res)

      if (res.erro || res.documentos.length === 0) {
        setErrorMessage(res.erro || 'Nenhuma proposta ou texto pôde ser extraído do documento.')
        setIsProcessing(false)
        return
      }

      // Se houver mais de um segmento detectado no PDF mesclado, mostra a lista para o analista escolher
      if (res.documentos.length > 1) {
        setStep('select_segment')
      } else {
        // Documento único: vai direto para a tela de pré-visualização
        applySegmentToForm(res.documentos[0])
      }
    } catch (err: unknown) {
      console.error(err)
      setErrorMessage('Falha ao processar arquivo: ' + (err as Error).message)
    } finally {
      setIsProcessing(false)
    }
  }

  // Confirmar e salvar proposta no banco
  const handleConfirmarRegistro = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dataProposta) {
      alert('Informe a data da proposta.')
      return
    }

    try {
      setSaving(true)
      const res = await registrarPropostaComArquivo({
        rfqId,
        seguradoraId: targetSeguradoraId === 'auto' ? undefined : targetSeguradoraId,
        seguradoraNome: seguradoraNome.trim(),
        seguradoraCnpj: seguradoraCnpj.trim() || undefined,
        seguradoraSusep: seguradoraSusep.trim() || undefined,
        dataProposta,
        numeroCotacao: numeroCotacao.trim() || undefined,
        versao: versao.trim() || undefined,
        validadeCotacao: validadeCotacao || undefined,
        vigenciaInicio: vigenciaInicio || undefined,
        vigenciaFim: vigenciaFim || undefined,
        premioLiquido: premioLiquido ? Number(premioLiquido) : null,
        premioBruto: premioBruto ? Number(premioBruto) : null,
        iof: iof ? Number(iof) : null,
        lmiLmg: lmiLmg ? Number(lmiLmg) : null,
        posFranquias: posFranquias.trim() || undefined,
        formaPagamento: formaPagamento.trim() || undefined,
        clausulas: clausulas.trim() || undefined,
        exclusoes: exclusoes.trim() || undefined,
        coberturas,
        arquivo: selectedFile,
        arquivoExtracaoJson: selectedSegment,
      })

      onSuccess({
        propostaId: res.propostaId,
        rfqSeguradora: res.rfqSeguradora,
        seguradoraNome: res.seguradoraNome,
        autoCadastrada: res.autoCadastrada,
      })

      handleOpenChange(false)
    } catch (err: unknown) {
      console.error(err)
      alert('Erro ao registrar proposta: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#16578B]" />
              <span>Subir Proposta de Seguradora (PDF com Extração)</span>
            </DialogTitle>
            {rfqNumero && (
              <span className="font-mono text-xs font-bold text-[#16578B] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                RFQ {rfqNumero}
              </span>
            )}
          </div>
          <DialogDescription className="text-xs text-gray-500">
            Envie a cotação/proposta em PDF. O motor extrai seguradora, número, vigência, prêmio,
            LMI e quadro de coberturas, além de auto-cadastrar a companhia no Mapa de Mercado se
            necessário.
          </DialogDescription>
        </DialogHeader>

        {/* ETAPA 1: UPLOAD DO PDF */}
        {step === 'upload' && (
          <div className="space-y-4 pt-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isProcessing
                  ? 'border-blue-300 bg-blue-50/50 pointer-events-none'
                  : 'border-gray-300 hover:border-[#16578B] hover:bg-gray-50/70 bg-gray-50/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileChange}
                disabled={isProcessing}
              />

              {isProcessing ? (
                <div className="flex flex-col items-center justify-center space-y-3 py-4">
                  <Loader2 className="w-9 h-9 animate-spin text-[#16578B]" />
                  <div className="text-center">
                    <h4 className="text-sm font-bold text-gray-900">
                      Processando documento e extraindo propostas...
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      Identificando seguradoras, quadro de valores, prêmios e divisões de cotação
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#16578B] flex items-center justify-center mb-1">
                    <Upload className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">
                    Selecione ou arraste o arquivo PDF da proposta
                  </h4>
                  <p className="text-xs text-gray-500 max-w-sm">
                    Suporta propostas individuais ou <strong>arquivos mesclados</strong> com
                    múltiplas cotações (AXA, Chubb, Tokio Marine, Zurich e demais).
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8"
                  >
                    Escolher arquivo PDF
                  </Button>
                </div>
              )}
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-gray-600 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-[#16578B]">
                <Info className="w-3.5 h-3.5" />
                <span>Padrão de Calibração P&C Ativo</span>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-600">
                O leitor reconhece o layout corporativo das principais seguradoras (quadro de
                sublimites AXA Empresa Flex, Property Online Chubb com rateio e prêmio total,
                propostas Tokio Marine por objeto e cotações Zurich). Arquivos mesclados são
                desdobrados automaticamente por segmento.
              </p>
            </div>
          </div>
        )}

        {/* ETAPA 2: ESCOLHA DO SEGMENTO SE O PDF FOR MESCLADO */}
        {step === 'select_segment' && extractionResult && (
          <div className="space-y-3 pt-2">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
              <Layers className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              <div>
                <strong>PDF Mesclado Detectado:</strong> Encontramos{' '}
                <strong>{extractionResult.documentos.length} propostas/cotações</strong> em um único
                arquivo ({extractionResult.totalPaginas} páginas). Escolha qual proposta deseja
                registrar neste momento:
              </div>
            </div>

            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {extractionResult.documentos.map((seg, idx) => {
                const confianca = seg.seguradora.confianca
                const valorPremio = seg.premioTotal || seg.premioLiquido

                return (
                  <div
                    key={seg.id}
                    onClick={() => applySegmentToForm(seg)}
                    className="p-3.5 rounded-xl border border-gray-200 hover:border-[#16578B] hover:bg-blue-50/30 transition-all cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[#0F2B46] text-white flex items-center justify-center font-bold text-xs shrink-0">
                        {idx + 1}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-gray-900 text-xs group-hover:text-[#16578B]">
                            {seg.seguradora.nomeCanonica}
                          </h4>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              confianca === 'alta'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {confianca === 'alta' ? 'Identificada' : 'Parcial'}
                          </span>
                        </div>

                        <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>
                            Cotação: <strong className="text-gray-800">{seg.numeroCotacao}</strong>
                          </span>
                          {seg.versao && seg.versao !== '1' && (
                            <span className="font-semibold text-blue-700 bg-blue-50 px-1 py-0.2 rounded border border-blue-200 text-[10px]">
                              {seg.versao.startsWith('V') || seg.versao.startsWith('v')
                                ? seg.versao
                                : `Versão ${seg.versao}`}
                            </span>
                          )}
                          <span className="text-gray-300">•</span>
                          <span>
                            Páginas {seg.paginaInicio} a {seg.paginaFim}
                          </span>
                          {seg.vigenciaInicio && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span>
                                Vigência: {seg.vigenciaInicio}
                                {seg.vigenciaFim ? ` a ${seg.vigenciaFim}` : ''}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="text-[11px] text-gray-600 flex items-center gap-3 pt-0.5">
                          {valorPremio ? (
                            <span>
                              Prêmio:{' '}
                              <strong className="text-emerald-800">
                                {formatCurrency(valorPremio)}
                              </strong>
                            </span>
                          ) : (
                            <span className="text-gray-400">Prêmio: a confirmar</span>
                          )}

                          {seg.lmiTotal ? (
                            <span>
                              LMI:{' '}
                              <strong className="text-gray-800">
                                {formatCurrency(seg.lmiTotal)}
                              </strong>
                            </span>
                          ) : null}

                          {seg.coberturas.length > 0 && (
                            <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded">
                              {seg.coberturas.length} cobertura(s) extraída(s)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-7 text-xs border-gray-300 group-hover:bg-[#16578B] group-hover:text-white group-hover:border-[#16578B]"
                    >
                      <span>Selecionar</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className="pt-2 flex justify-between items-center text-xs text-gray-400">
              <span>Você poderá registrar os outros segmentos depois repetindo o processo.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep('upload')}
                className="text-xs h-7"
              >
                Voltar / Trocar arquivo
              </Button>
            </div>
          </div>
        )}

        {/* ETAPA 3: PRÉ-VISUALIZAÇÃO COM CAMPOS EDITÁVEIS (CONFIRMAÇÃO HUMANA) */}
        {step === 'preview' && (
          <form onSubmit={handleConfirmarRegistro} className="space-y-4 pt-1 text-xs">
            {/* Aviso de Confirmação */}
            <div className="p-3 rounded-lg bg-blue-50/80 border border-blue-200 text-xs text-blue-950 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#16578B] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Pré-visualização da Extração Automática</div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    Revise os campos identificados pelo leitor antes de confirmar. Valores
                    destacados em cinza podem ser preenchidos ou corrigidos livremente pelo
                    analista.
                  </div>
                </div>
              </div>

              {extractionResult && extractionResult.documentos.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep('select_segment')}
                  className="h-6 text-[10px] px-2 border-blue-300 text-[#16578B] shrink-0"
                >
                  Trocar proposta do PDF
                </Button>
              )}
            </div>

            {/* SEÇÃO 1: SEGURADORA E MAPA DE MERCADO */}
            <div className="bg-gray-50/70 p-3.5 rounded-xl border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Seguradora & Vinculação ao Mapa de Mercado</span>
                </span>
                {targetSeguradoraId === 'auto' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    Auto-cadastro novo no Mapa
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Seguradora Vinculada
                  </Label>
                  <select
                    value={targetSeguradoraId}
                    onChange={(e) => {
                      const val = e.target.value
                      setTargetSeguradoraId(val)
                      if (val !== 'auto') {
                        const found = seguradorasDisponiveis.find((s) => s.id === val)
                        if (found) setSeguradoraNome(found.nome)
                      }
                    }}
                    className="w-full h-8 rounded border border-gray-300 bg-white px-2 text-xs"
                  >
                    <option value="auto">
                      ✨ Auto-cadastrar nova seguradora no Mapa ({seguradoraNome || 'Detectada'})
                    </option>
                    {seguradorasDisponiveis.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Razão Social Extraída
                  </Label>
                  <Input
                    type="text"
                    value={seguradoraNome}
                    onChange={(e) => setSeguradoraNome(e.target.value)}
                    placeholder="Ex: AXA Seguros S.A."
                    className="h-8 text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    CNPJ do Documento
                  </Label>
                  <Input
                    type="text"
                    value={seguradoraCnpj}
                    onChange={(e) => setSeguradoraCnpj(e.target.value)}
                    placeholder="Ex: 19.323.190/0001-06"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Código / Processo SUSEP
                  </Label>
                  <Input
                    type="text"
                    value={seguradoraSusep}
                    onChange={(e) => setSeguradoraSusep(e.target.value)}
                    placeholder="Ex: 0285-2"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* SEÇÃO 2: DADOS DA PROPOSTA / COTAÇÃO E VIGÊNCIA */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700">
                  Nº da Cotação / Proposta
                </Label>
                <Input
                  type="text"
                  value={numeroCotacao}
                  onChange={(e) => setNumeroCotacao(e.target.value)}
                  placeholder="Ex: 3840019 - V2"
                  className="h-8 text-xs font-bold"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700">
                  Data de Recebimento
                </Label>
                <Input
                  type="date"
                  value={dataProposta}
                  onChange={(e) => setDataProposta(e.target.value)}
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700">
                  Início de Vigência
                </Label>
                <Input
                  type="date"
                  value={vigenciaInicio}
                  onChange={(e) => setVigenciaInicio(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700">Fim de Vigência</Label>
                <Input
                  type="date"
                  value={vigenciaFim}
                  onChange={(e) => setVigenciaFim(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* SEÇÃO 3: VALORES MONETÁRIOS (PRÊMIOS, LMI E IOF) */}
            <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-3">
              <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-700" />
                <span>Condições Financeiras da Oferta</span>
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-gray-700">
                      Prêmio Total / Bruto (R$)
                    </Label>
                    {premioBruto && (
                      <span className="text-[10px] font-mono text-emerald-700">
                        {formatCurrency(premioBruto)}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={premioBruto}
                    onChange={(e) => setPremioBruto(e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs font-bold text-emerald-800"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-gray-700">
                      Prêmio Líquido (R$)
                    </Label>
                    {premioLiquido && (
                      <span className="text-[10px] font-mono text-gray-600">
                        {formatCurrency(premioLiquido)}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={premioLiquido}
                    onChange={(e) => setPremioLiquido(e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-gray-700">
                      LMI / LMG Máximo (R$)
                    </Label>
                    {lmiLmg && (
                      <span className="text-[10px] font-mono text-gray-600">
                        {formatCurrency(lmiLmg)}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={lmiLmg}
                    onChange={(e) => setLmiLmg(e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-gray-700">IOF (R$)</Label>
                    {iof && (
                      <span className="text-[10px] font-mono text-gray-600">
                        {formatCurrency(iof)}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={iof}
                    onChange={(e) => setIof(e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs text-gray-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-gray-700">
                      Custo da Apólice (R$)
                    </Label>
                    {custoApolice && (
                      <span className="text-[10px] font-mono text-gray-600">
                        {formatCurrency(custoApolice)}
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={custoApolice}
                    onChange={(e) => setCustoApolice(e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs text-gray-600"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Forma de Pagamento
                  </Label>
                  <Input
                    type="text"
                    value={formaPagamento}
                    onChange={(e) => setFormaPagamento(e.target.value)}
                    placeholder="Ex: Boleto Bancário (4x)"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Nº de Parcelas</Label>
                  <Input
                    type="number"
                    step="1"
                    value={numeroParcelas}
                    onChange={(e) => setNumeroParcelas(e.target.value)}
                    placeholder="Ex: 4 ou 6"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1 pt-1">
                <Label className="text-[11px] font-semibold text-gray-700">
                  Franquias Gerais / P.O.S.
                </Label>
                <Input
                  type="text"
                  value={posFranquias}
                  onChange={(e) => setPosFranquias(e.target.value)}
                  placeholder="Ex: 10% com mínimo de R$ 5.000 para Danos Elétricos"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* SEÇÃO 4: DADOS QUALITATIVOS E COMPLEMENTARES (QUANDO DISPONÍVEIS) */}
            {selectedSegment?.dadosComplementares && (
              <div className="p-3 rounded-xl border border-blue-100 bg-blue-50/40 space-y-2">
                <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Informações Complementares e Qualitativas do Documento</span>
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-gray-700">
                  {selectedSegment.dadosComplementares.seguradoNome && (
                    <div>
                      <span className="text-gray-400 block text-[10px]">Proponente:</span>
                      <strong className="text-gray-900">
                        {selectedSegment.dadosComplementares.seguradoNome}
                      </strong>
                    </div>
                  )}
                  {selectedSegment.dadosComplementares.seguradoCnpj && (
                    <div>
                      <span className="text-gray-400 block text-[10px]">CNPJ Proponente:</span>
                      <strong className="font-mono text-gray-900">
                        {selectedSegment.dadosComplementares.seguradoCnpj}
                      </strong>
                    </div>
                  )}
                  {selectedSegment.dadosComplementares.tipoConstrucao && (
                    <div>
                      <span className="text-gray-400 block text-[10px]">Construção:</span>
                      <span className="text-gray-800">
                        {selectedSegment.dadosComplementares.tipoConstrucao}
                      </span>
                    </div>
                  )}
                  {selectedSegment.dadosComplementares.atividade && (
                    <div>
                      <span className="text-gray-400 block text-[10px]">Atividade do Local:</span>
                      <span className="text-gray-800">
                        {selectedSegment.dadosComplementares.atividade}
                      </span>
                    </div>
                  )}
                  {selectedSegment.dadosComplementares.valorEmRiscoDeclarado && (
                    <div>
                      <span className="text-gray-400 block text-[10px]">Valor em Risco (VRD):</span>
                      <strong className="text-gray-900">
                        {formatCurrency(selectedSegment.dadosComplementares.valorEmRiscoDeclarado)}
                      </strong>
                    </div>
                  )}
                  {selectedSegment.dadosComplementares.respostasQuestionario?.['valor_de_novo'] && (
                    <div>
                      <span className="text-gray-400 block text-[10px]">Valor de Novo:</span>
                      <span className="font-bold text-emerald-800">
                        {selectedSegment.dadosComplementares.respostasQuestionario['valor_de_novo']}
                      </span>
                    </div>
                  )}
                </div>

                {selectedSegment.dadosComplementares.protecionais &&
                  selectedSegment.dadosComplementares.protecionais.length > 0 && (
                    <div className="pt-1 border-t border-blue-100 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 font-semibold mr-1">
                        Protecionais:
                      </span>
                      {selectedSegment.dadosComplementares.protecionais.map((p, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white border border-blue-200 text-blue-900"
                        >
                          ✔ {p}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {/* SEÇÃO 5: COBERTURAS EXTRAÍDAS */}
            {coberturas.length > 0 && (
              <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#16578B]" />
                    <span>Quadro de Coberturas Extraídas ({coberturas.length} itens)</span>
                  </span>
                  <span className="text-[10px] text-gray-500">
                    Alimentará diretamente a Tabulação C3
                  </span>
                </div>

                <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-gray-50 border-b text-gray-600 font-semibold sticky top-0">
                      <tr>
                        <th className="py-1.5 px-3">Cobertura</th>
                        <th className="py-1.5 px-2">Classificação</th>
                        <th className="py-1.5 px-2 text-right">LMI</th>
                        <th className="py-1.5 px-2 text-right">Prêmio</th>
                        <th className="py-1.5 px-3">Franquia / P.O.S.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        // Garante que no máximo UMA cobertura no quadro receba a marca de Básica
                        const firstBasicaIndex = coberturas.findIndex((c) =>
                          isCoberturaBasica({
                            nome: c.cobertura,
                            categoriaNormalizada: c.categoriaNormalizada,
                          }),
                        )

                        return coberturas.map((c, i) => {
                          const isBasica = i === firstBasicaIndex
                          const isLc =
                            !isBasica &&
                            isCoberturaLucrosCessantes({
                              nome: c.cobertura,
                              categoriaNormalizada: c.categoriaNormalizada,
                            })

                          return (
                            <tr
                              key={i}
                              className={`hover:bg-gray-50/70 transition-colors ${
                                isBasica
                                  ? 'bg-blue-50/40 font-semibold'
                                  : isLc
                                    ? 'bg-amber-50/30'
                                    : ''
                              }`}
                            >
                              <td className="py-1.5 px-3 font-medium text-gray-900">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span>{c.cobertura}</span>
                                  {isBasica && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wide bg-blue-100 text-[#16578B] border border-blue-300">
                                      ★ Básica
                                    </span>
                                  )}
                                  {isLc && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-100 text-amber-900 border border-amber-300">
                                      Lucros Cessantes
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-gray-500 text-[10px]">
                                {c.categoriaNormalizada}
                              </td>
                              <td className="py-1.5 px-2 text-right text-gray-800 font-mono">
                                {c.lmi ? formatCurrency(c.lmi) : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right text-emerald-800 font-mono">
                                {c.premioLiquido ? formatCurrency(c.premioLiquido) : '—'}
                              </td>
                              <td
                                className="py-1.5 px-3 text-gray-600 text-[10px] truncate max-w-[180px]"
                                title={c.franquia}
                              >
                                {c.franquia || 'Conforme apólice'}
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* BOTÕES DE CONFIRMAÇÃO */}
            <div className="pt-2 flex items-center justify-between border-t border-gray-100">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setStep(
                    extractionResult && extractionResult.documentos.length > 1
                      ? 'select_segment'
                      : 'upload',
                  )
                }
                className="text-xs h-8 text-gray-600"
              >
                Voltar
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  className="text-xs h-8"
                >
                  Cancelar
                </Button>

                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs h-8 px-4 font-semibold shadow-sm flex items-center gap-1.5"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      <span>Gravando Proposta...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-300" />
                      <span>Confirmar & Gravar Proposta</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
