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
  Trash2,
  Plus,
  Check,
  Download,
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
import {
  registrarPropostaComArquivo,
  RfqSeguradoraRecord,
  desnormalizarBasePremioParaUi,
} from '@/services/rfqPropostasService'
import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { canonicalizeInsurerName } from '@/services/guardiaImporter'
import { normalizarSeguradora } from '@/services/seguradoraNormalizer'
import { formatCurrency, formatDate, CATEGORIAS_48 } from '@/lib/formatters'
import { isCoberturaBasica, isCoberturaLucrosCessantes } from '@/services/submissionKitService'
import { matchCanonicalCategory } from '@/services/riskCardReader'

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
  const [opcaoSelecionada, setOpcaoSelecionada] = useState<number>(1)
  const [opcoesExistentes, setOpcoesExistentes] = useState<number[]>([1])
  const [modoRegistro, setModoRegistro] = useState<'nova_versao' | 'nova_opcao' | 'sobrescrever'>(
    'nova_versao',
  )
  const [versao, setVersao] = useState<string>('')
  const [criarNovaVersao, setCriarNovaVersao] = useState<boolean>(true)
  const [temPropostaPrevia, setTemPropostaPrevia] = useState<boolean>(false)
  const [versaoExistenteMax, setVersaoExistenteMax] = useState<number>(1)
  const [validadeCotacao, setValidadeCotacao] = useState<string>('')
  const [vigenciaInicio, setVigenciaInicio] = useState<string>('')
  const [vigenciaFim, setVigenciaFim] = useState<string>('')
  const [premioLiquido, setPremioLiquido] = useState<string>('')
  const [premioBruto, setPremioBruto] = useState<string>('')
  const [premioNet, setPremioNet] = useState<string>('')
  const [iof, setIof] = useState<string>('')
  const [custoApolice, setCustoApolice] = useState<string>('')
  const [lmiLmg, setLmiLmg] = useState<string>('')
  const [posFranquias, setPosFranquias] = useState<string>('')
  const [formaPagamento, setFormaPagamento] = useState<string>('')
  const [numeroParcelas, setNumeroParcelas] = useState<string>('')
  const [clausulas, setClausulas] = useState<string>('')
  const [exclusoes, setExclusoes] = useState<string>('')
  const [coberturas, setCoberturas] = useState<ExtractedCoberturaItem[]>([])

  // Bloco VRD (Danos Materiais, MMU, MMP, Lucros Cessantes + seletor base LC)
  const [vrdDm, setVrdDm] = useState<string>('')
  const [vrdMmu, setVrdMmu] = useState<string>('')
  const [vrdMmp, setVrdMmp] = useState<string>('')
  const [vrdLc, setVrdLc] = useState<string>('')
  const [vrdLcBase, setVrdLcBase] = useState<string>('Lucro Bruto')

  // Comissão trabalhada, agravo e base do prêmio (reativo)
  const [comissaoTrabalhada, setComissaoTrabalhada] = useState<string>('')
  const [agravo, setAgravo] = useState<string>('0')
  const [basePremio, setBasePremio] = useState<'liquido' | 'net'>('liquido')

  // Estado para exclusão com confirmação e edição inline de coberturas
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editCategoria, setEditCategoria] = useState('')
  const [editLmi, setEditLmi] = useState<string>('')
  const [editPremio, setEditPremio] = useState<string>('')
  const [editFranquia, setEditFranquia] = useState('')

  // Estado para adicionar nova cobertura
  const [showAddForm, setShowAddForm] = useState(false)
  const [newNome, setNewNome] = useState('')
  const [newCategoria, setNewCategoria] = useState<string>(CATEGORIAS_48[0])
  const [newLmi, setNewLmi] = useState<string>('')
  const [newPremio, setNewPremio] = useState<string>('')
  const [newFranquia, setNewFranquia] = useState('')

  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Função utilitária para baixar o diagnóstico de extração em JSON
  const handleDownloadDiagnostico = (segment?: PropostaSegmentoExtracao | null) => {
    const target = segment || selectedSegment || extractionResult?.documentos[0]
    if (!target) return

    const diagPayload = {
      arquivoOrigem: selectedFile?.name || 'proposta.pdf',
      dataProcessamento: new Date().toISOString(),
      documento: {
        id: target.id,
        titulo: target.titulo,
        seguradora: target.seguradora,
        numeroCotacao: target.numeroCotacao,
        versao: target.versao,
        vigenciaInicio: target.vigenciaInicio,
        vigenciaFim: target.vigenciaFim,
        premioLiquido: target.premioLiquido,
        premioTotal: target.premioTotal,
        iof: target.iof,
        custoApolice: target.custoApolice,
        lmiTotal: target.lmiTotal,
        coberturas: target.coberturas,
        dadosComplementares: target.dadosComplementares,
      },
      diagnostico: target.diagnostico || {
        nota: 'Diagnóstico detalhado não gerado para este segmento',
      },
    }

    const safeInsurerSlug = (target.seguradora.nomeCanonica || 'porto')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `diagnostico-extracao-${safeInsurerSlug}-${timestamp}.json`

    const blob = new Blob([JSON.stringify(diagPayload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

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
    setTemPropostaPrevia(false)
    setCriarNovaVersao(true)
    setVersaoExistenteMax(1)
    setOpcaoSelecionada(1)
    setOpcoesExistentes([1])
    setModoRegistro('nova_versao')
    setDeletingIndex(null)
    setEditingIndex(null)
    setShowAddForm(false)
    setVrdDm('')
    setVrdMmu('')
    setVrdMmp('')
    setVrdLc('')
    setVrdLcBase('Lucro Bruto')
    setComissaoTrabalhada('')
    setAgravo('0')
    setBasePremio('liquido')
    setPremioNet('')
  }

  // Funções de manipulação do quadro de coberturas
  const startEditingCoverage = (index: number) => {
    const item = coberturas[index]
    if (!item) return
    setEditingIndex(index)
    setEditNome(item.cobertura)
    setEditCategoria(item.categoriaNormalizada || matchCanonicalCategory(item.cobertura))
    setEditLmi(item.lmi !== null && item.lmi !== undefined ? String(item.lmi) : '')
    setEditPremio(
      item.premioLiquido !== null && item.premioLiquido !== undefined
        ? String(item.premioLiquido)
        : '',
    )
    setEditFranquia(item.franquia || '')
    setDeletingIndex(null)
  }

  const cancelEditingCoverage = () => {
    setEditingIndex(null)
  }

  const saveEditingCoverage = () => {
    if (editingIndex === null) return
    if (!editNome.trim()) {
      alert('Informe o nome da cobertura.')
      return
    }
    const cat = editCategoria.trim() || matchCanonicalCategory(editNome.trim())
    const updated = [...coberturas]
    updated[editingIndex] = {
      cobertura: editNome.trim(),
      categoriaNormalizada: cat,
      lmi: editLmi === '' ? null : Number(editLmi),
      premioLiquido: editPremio === '' ? null : Number(editPremio),
      franquia: editFranquia.trim() || 'Conforme apólice',
    }
    setCoberturas(updated)
    setEditingIndex(null)
  }

  const confirmDeleteCoverage = (index: number) => {
    setCoberturas((prev) => prev.filter((_, i) => i !== index))
    setDeletingIndex(null)
    if (editingIndex === index) {
      setEditingIndex(null)
    }
  }

  const handleAddNewCoverage = () => {
    if (!newNome.trim()) {
      alert('Informe o nome da cobertura.')
      return
    }
    const cat = newCategoria.trim() || matchCanonicalCategory(newNome.trim())
    const newItem: ExtractedCoberturaItem = {
      cobertura: newNome.trim(),
      categoriaNormalizada: cat,
      lmi: newLmi === '' ? null : Number(newLmi),
      premioLiquido: newPremio === '' ? null : Number(newPremio),
      franquia: newFranquia.trim() || 'Conforme apólice',
    }
    setCoberturas((prev) => [...prev, newItem])
    setNewNome('')
    setNewLmi('')
    setNewPremio('')
    setNewFranquia('')
    setShowAddForm(false)
  }

  // Preenche formulário da prévia a partir do segmento extraído
  const applySegmentToForm = async (seg: PropostaSegmentoExtracao) => {
    setSelectedSegment(seg)

    // Normaliza contra o cadastro do banco ou dicionário canônico (por CNPJ e por nome)
    const segNorm = await normalizarSeguradora(seg.seguradora.nomeCanonica, {
      cnpj: seg.seguradora.cnpj,
      susep: seg.seguradora.susep,
      razaoSocial: seg.seguradora.razaoSocial,
      autoCadastrar: false,
    })

    if (segNorm.id) {
      setTargetSeguradoraId(segNorm.id)
      setSeguradoraNome(segNorm.nomeCanonica)
    } else if (initialSeguradoraId) {
      setTargetSeguradoraId(initialSeguradoraId)
      setSeguradoraNome(initialSeguradoraNome || segNorm.nomeCanonica)
    } else {
      setTargetSeguradoraId('auto') // Marca para auto-cadastro no Mapa com o nome canônico
      setSeguradoraNome(segNorm.nomeCanonica)
    }

    setSeguradoraCnpj(segNorm.cnpj || seg.seguradora.cnpj || '')
    setSeguradoraSusep(segNorm.susep || seg.seguradora.susep || '')
    setDataProposta(seg.dataCotacao || new Date().toISOString().slice(0, 10))
    setNumeroCotacao(seg.numeroCotacao || '')
    setVersao(seg.versao || '1')
    setValidadeCotacao(seg.validadeCotacao || '')
    setVigenciaInicio(seg.vigenciaInicio || '')
    setVigenciaFim(seg.vigenciaFim || '')

    // Prêmio net e comissão
    const extractedNet =
      seg.premioNet !== null && seg.premioNet !== undefined
        ? seg.premioNet
        : seg.dadosComplementares?.premioNet !== null &&
            seg.dadosComplementares?.premioNet !== undefined
          ? seg.dadosComplementares.premioNet
          : null

    const pLiqVal = seg.premioLiquido ? Number(seg.premioLiquido) : null
    let pIofVal = seg.iof ? Number(seg.iof) : null
    let pTotalVal = seg.premioTotal ? Number(seg.premioTotal) : null

    // Regra do usuário: quando a proposta declara Prêmio Net (sem Prêmio Líquido explícito):
    // Líquido, IOF e Bruto ficam pendentes/vazios (sem presunção de comissão).
    const temNetSemLiquido =
      (!pLiqVal || pLiqVal === 0) && extractedNet !== null && extractedNet > 0

    if (!temNetSemLiquido && pLiqVal !== null && pLiqVal > 0) {
      if (!pIofVal || pIofVal === 0) {
        pIofVal = Number((pLiqVal * 0.0738).toFixed(2))
      }
      if (!pTotalVal || pTotalVal === 0) {
        pTotalVal = Number((pLiqVal + pIofVal).toFixed(2))
      }
    } else if (temNetSemLiquido) {
      pIofVal = null
      pTotalVal = null
    }

    setPremioLiquido(pLiqVal ? String(pLiqVal) : '')
    setPremioBruto(pTotalVal ? String(pTotalVal) : '')
    setIof(pIofVal ? String(pIofVal) : '')
    setCustoApolice(
      seg.custoApolice !== undefined && seg.custoApolice !== null ? String(seg.custoApolice) : '',
    )
    setLmiLmg(seg.lmiTotal ? String(seg.lmiTotal) : '')
    setPosFranquias(seg.posFranquiasGerais || '')
    setFormaPagamento(seg.formaPagamento || '')
    setNumeroParcelas(seg.numeroParcelas ? String(seg.numeroParcelas) : '')
    setCoberturas(seg.coberturas || [])

    // Popula campos VRD extraídos / derivados
    setVrdDm(
      seg.vrdDm !== null && seg.vrdDm !== undefined
        ? String(seg.vrdDm)
        : seg.dadosComplementares?.vrdDm !== null && seg.dadosComplementares?.vrdDm !== undefined
          ? String(seg.dadosComplementares.vrdDm)
          : '',
    )
    setVrdMmu(
      seg.vrdMmu !== null && seg.vrdMmu !== undefined
        ? String(seg.vrdMmu)
        : seg.dadosComplementares?.vrdMmu !== null && seg.dadosComplementares?.vrdMmu !== undefined
          ? String(seg.dadosComplementares.vrdMmu)
          : '',
    )
    setVrdMmp(
      seg.vrdMmp !== null && seg.vrdMmp !== undefined
        ? String(seg.vrdMmp)
        : seg.dadosComplementares?.vrdMmp !== null && seg.dadosComplementares?.vrdMmp !== undefined
          ? String(seg.dadosComplementares.vrdMmp)
          : '',
    )
    setVrdLc(
      seg.vrdLc !== null && seg.vrdLc !== undefined
        ? String(seg.vrdLc)
        : seg.dadosComplementares?.vrdLc !== null && seg.dadosComplementares?.vrdLc !== undefined
          ? String(seg.dadosComplementares.vrdLc)
          : '',
    )
    setVrdLcBase(seg.vrdLcBase || seg.dadosComplementares?.vrdLcBase || 'Lucro Bruto')

    if (extractedNet) {
      setPremioNet(String(extractedNet))
      setBasePremio(
        seg.basePremio || seg.dadosComplementares?.basePremio
          ? desnormalizarBasePremioParaUi(seg.basePremio || seg.dadosComplementares?.basePremio)
          : 'net',
      )
    } else {
      setPremioNet('')
      setBasePremio(
        seg.basePremio || seg.dadosComplementares?.basePremio
          ? desnormalizarBasePremioParaUi(seg.basePremio || seg.dadosComplementares?.basePremio)
          : 'liquido',
      )
    }
    setComissaoTrabalhada('')
    setAgravo('0')

    // Checa se já existe proposta para essa seguradora neste RFQ
    try {
      const resolvedSegId = segNorm.id || initialSeguradoraId
      if (resolvedSegId && resolvedSegId !== 'auto') {
        const existProps = await pb
          .collection('propostas')
          .getFullList<{ id: string; versao?: number; opcao?: number }>({
            filter: `rfq = "${rfqId}" && seguradora = "${resolvedSegId}"`,
            sort: '-versao',
          })
        if (existProps.length > 0) {
          const ops = Array.from(new Set(existProps.map((p) => Number(p.opcao || 1)))).sort(
            (a, b) => a - b,
          )
          const opAtiva = ops[0] || 1
          const propsDestaOp = existProps.filter((p) => Number(p.opcao || 1) === opAtiva)
          const maxV =
            propsDestaOp.length > 0
              ? Math.max(...propsDestaOp.map((p) => Number(p.versao || 1)))
              : 1

          setTemPropostaPrevia(true)
          setOpcoesExistentes(ops)
          setOpcaoSelecionada(opAtiva)
          setVersaoExistenteMax(maxV)
          setModoRegistro('nova_versao')
          setCriarNovaVersao(true)
          setVersao(String(maxV + 1))
        } else {
          setTemPropostaPrevia(false)
          setOpcoesExistentes([1])
          setOpcaoSelecionada(1)
          setCriarNovaVersao(true)
          setModoRegistro('nova_versao')
        }
      } else {
        setTemPropostaPrevia(false)
        setOpcoesExistentes([1])
        setOpcaoSelecionada(1)
        setCriarNovaVersao(true)
        setModoRegistro('nova_versao')
      }
    } catch {
      setTemPropostaPrevia(false)
      setOpcoesExistentes([1])
      setOpcaoSelecionada(1)
      setCriarNovaVersao(true)
      setModoRegistro('nova_versao')
    }

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

    const agravoNum = agravo !== '' && !isNaN(Number(agravo)) ? Number(agravo) : 0
    const pNetNum = premioNet ? Number(premioNet) : null
    const premioNetPosAgravoNum =
      agravoNum > 0 && pNetNum !== null
        ? Number((pNetNum * (1 + agravoNum / 100)).toFixed(2))
        : pNetNum !== null
          ? pNetNum
          : null

    // Sanitizar coberturas editadas manualmente para evitar campos null/undefined ou tipos inválidos
    const coberturasSanitizadas: ExtractedCoberturaItem[] = (coberturas || []).map((c) => ({
      cobertura: String(c.cobertura || '').trim() || 'Cobertura',
      categoriaNormalizada: String(
        c.categoriaNormalizada || matchCanonicalCategory(c.cobertura || ''),
      ).trim(),
      lmi: c.lmi !== null && c.lmi !== undefined && !isNaN(Number(c.lmi)) ? Number(c.lmi) : null,
      premioLiquido:
        c.premioLiquido !== null && c.premioLiquido !== undefined && !isNaN(Number(c.premioLiquido))
          ? Number(c.premioLiquido)
          : null,
      franquia: String(c.franquia || 'Conforme apólice').trim(),
    }))

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
        opcao:
          modoRegistro === 'nova_opcao' ? Math.max(...opcoesExistentes, 1) + 1 : opcaoSelecionada,
        versao: versao.trim() || undefined,
        modoRegistro: temPropostaPrevia ? modoRegistro : 'nova_versao',
        criarNovaVersao: temPropostaPrevia ? modoRegistro !== 'sobrescrever' : true,
        validadeCotacao: validadeCotacao || undefined,
        vigenciaInicio: vigenciaInicio || undefined,
        vigenciaFim: vigenciaFim || undefined,
        premioLiquido: premioLiquido ? Number(premioLiquido) : null,
        premioBruto: premioBruto ? Number(premioBruto) : null,
        premioNet: premioNet ? Number(premioNet) : null,
        agravo: agravoNum,
        premioNetPosAgravo: premioNetPosAgravoNum,
        iof: iof ? Number(iof) : null,
        comissaoTrabalhada: comissaoTrabalhada ? Number(comissaoTrabalhada) : null,
        basePremio: basePremio,
        lmiLmg: lmiLmg ? Number(lmiLmg) : null,
        vrdDm: vrdDm ? Number(vrdDm) : null,
        vrdMmu: vrdMmu ? Number(vrdMmu) : null,
        vrdMmp: vrdMmp ? Number(vrdMmp) : null,
        vrdLc: vrdLc ? Number(vrdLc) : null,
        vrdLcBase: vrdLcBase || undefined,
        posFranquias: posFranquias.trim() || undefined,
        formaPagamento: formaPagamento.trim() || undefined,
        numeroParcelas:
          numeroParcelas !== '' && !isNaN(Number(numeroParcelas)) ? Number(numeroParcelas) : null,
        clausulas: clausulas.trim() || undefined,
        exclusoes: exclusoes.trim() || undefined,
        coberturas: coberturasSanitizadas,
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
      const msg = getErrorMessage(err)
      alert('Erro ao registrar proposta: ' + msg)
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
                          ) : seg.premioNet ? (
                            <span>
                              Prêmio Net:{' '}
                              <strong className="text-blue-900 font-bold">
                                {formatCurrency(seg.premioNet)}
                              </strong>{' '}
                              <span className="text-[10px] text-amber-700 bg-amber-50 px-1 py-0.5 rounded font-medium border border-amber-200">
                                Líquido/Bruto pendente de comissão
                              </span>
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleDownloadDiagnostico(extractionResult.documentos[0])}
                className="text-xs h-7 text-gray-500 hover:text-[#16578B] flex items-center gap-1.5 px-2"
                title="Baixar dados brutos e geometria de extração do documento em JSON"
              >
                <Download className="w-3.5 h-3.5 text-gray-400" />
                <span>Baixar diagnóstico de extração (JSON)</span>
              </Button>

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
            {/* DIÁLOGO / PERGUNTA DE OPÇÃO × VERSÃO QUANDO JÁ EXISTIR PROPOSTA DESTA CIA */}
            {temPropostaPrevia && (
              <div className="p-3.5 rounded-xl border-2 border-amber-300 bg-amber-50/70 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold text-amber-950 text-xs">
                      Esta seguradora já possui proposta registrada neste RFQ (Opções:{' '}
                      {opcoesExistentes.map((o) => `Opção ${o}`).join(', ')} — até v
                      {versaoExistenteMax})
                    </div>
                    {/* Pergunta-guia do usuário */}
                    <div className="text-[11px] text-amber-900 bg-white/80 p-2 rounded-md border border-amber-200 leading-relaxed">
                      <strong>💡 Pergunta-guia para classificação:</strong> A estrutura da oferta
                      (VRD, LMI, LMG ou coberturas) mudou fundamentalmente?
                      <br />• <strong>Se SIM</strong> (oferta distinta de contratação com
                      limites/franquias diferentes): selecione{' '}
                      <span className="text-blue-800 font-bold">"Nova Opção da mesma cia"</span>.
                      <br />• <strong>Se NÃO</strong> (apenas revisão de preço, reajuste ou correção
                      da mesma oferta): selecione{' '}
                      <span className="text-emerald-800 font-bold">
                        "Mesma Opção — nova versão"
                      </span>
                      .
                    </div>
                  </div>
                </div>

                {/* 3 Escolhas definidas no conceito de produto */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  {/* (a) Mesma Opção - nova versão */}
                  <label
                    className={`flex flex-col gap-1 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      modoRegistro === 'nova_versao'
                        ? 'bg-blue-50 border-[#16578B] ring-1 ring-[#16578B] shadow-sm'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="modoRegistro"
                        checked={modoRegistro === 'nova_versao'}
                        onChange={() => {
                          setModoRegistro('nova_versao')
                          setCriarNovaVersao(true)
                          setVersao(String(versaoExistenteMax + 1))
                        }}
                        className="text-[#16578B] focus:ring-[#16578B]"
                      />
                      <span className="font-bold text-gray-900 text-[11px]">
                        ✨ Mesma Opção — v{versaoExistenteMax + 1}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500 pl-5">
                      Recomendado para revisão/reajuste da Opção {opcaoSelecionada}. Preserva
                      histórico.
                    </span>
                  </label>

                  {/* (b) Nova Opção da mesma cia */}
                  <label
                    className={`flex flex-col gap-1 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      modoRegistro === 'nova_opcao'
                        ? 'bg-purple-50 border-purple-600 ring-1 ring-purple-600 shadow-sm'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="modoRegistro"
                        checked={modoRegistro === 'nova_opcao'}
                        onChange={() => {
                          setModoRegistro('nova_opcao')
                          setCriarNovaVersao(true)
                          setVersao('1')
                        }}
                        className="text-purple-600 focus:ring-purple-600"
                      />
                      <span className="font-bold text-purple-950 text-[11px]">
                        🏢 Nova Opção {Math.max(...opcoesExistentes, 1) + 1} (v1)
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500 pl-5">
                      Oferta distinta da mesma cia com LMI/LMG/VRD diferentes. Cada opção mantém sua
                      ativa.
                    </span>
                  </label>

                  {/* (c) Sobrescrever */}
                  <label
                    className={`flex flex-col gap-1 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      modoRegistro === 'sobrescrever'
                        ? 'bg-amber-50 border-amber-600 ring-1 ring-amber-600 shadow-sm'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="modoRegistro"
                        checked={modoRegistro === 'sobrescrever'}
                        onChange={() => {
                          setModoRegistro('sobrescrever')
                          setCriarNovaVersao(false)
                          setVersao(String(versaoExistenteMax))
                        }}
                        className="text-amber-600 focus:ring-amber-600"
                      />
                      <span className="font-bold text-gray-900 text-[11px]">
                        Sobrescrever versão atual
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500 pl-5">
                      Atualiza os dados da Opção {opcaoSelecionada} v{versaoExistenteMax} no mesmo
                      registro.
                    </span>
                  </label>
                </div>

                {/* Seletor de qual opção existente está sendo versionada caso haja múltiplas */}
                {modoRegistro === 'nova_versao' && opcoesExistentes.length > 1 && (
                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="font-semibold text-gray-700">Vincular à Opção:</span>
                    <select
                      value={opcaoSelecionada}
                      onChange={(e) => {
                        const op = Number(e.target.value)
                        setOpcaoSelecionada(op)
                      }}
                      className="h-7 text-xs rounded border border-gray-300 bg-white px-2 font-bold text-[#16578B]"
                    >
                      {opcoesExistentes.map((op) => (
                        <option key={op} value={op}>
                          Opção {op}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700">
                  Nº da Cotação / Proposta
                </Label>
                <Input
                  type="text"
                  value={numeroCotacao}
                  onChange={(e) => setNumeroCotacao(e.target.value)}
                  placeholder="Ex: 3840019"
                  className="h-8 text-xs font-bold"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700 flex items-center justify-between">
                  <span>Opção</span>
                  {modoRegistro === 'nova_opcao' && (
                    <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-1 rounded">
                      Nova
                    </span>
                  )}
                </Label>
                <Input
                  type="number"
                  min="1"
                  value={
                    modoRegistro === 'nova_opcao'
                      ? Math.max(...opcoesExistentes, 1) + 1
                      : opcaoSelecionada
                  }
                  onChange={(e) => setOpcaoSelecionada(Number(e.target.value) || 1)}
                  disabled={modoRegistro === 'nova_opcao'}
                  className="h-8 text-xs font-mono font-bold bg-gray-50/70"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700 flex items-center justify-between">
                  <span>Versão</span>
                  {modoRegistro === 'nova_versao' && temPropostaPrevia && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 rounded">
                      Nova
                    </span>
                  )}
                </Label>
                <Input
                  type="number"
                  min="1"
                  value={versao}
                  onChange={(e) => setVersao(e.target.value)}
                  placeholder="1"
                  className="h-8 text-xs font-mono font-bold"
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

              {/* BLOCO DE PRÊMIOS, AGRAVO E COMISSÃO TRABALHADA */}
              {(() => {
                const agravoNum = parseFloat(agravo) || 0
                const pNetNum = parseFloat(premioNet) || 0
                const temAgravoVal = agravoNum > 0 && pNetNum > 0
                const pNetPosAgravoCalc = temAgravoVal ? pNetNum * (1 + agravoNum / 100) : null

                return (
                  <div className="p-3 bg-gray-50/80 rounded-lg border border-gray-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-gray-800 text-[11px] flex items-center gap-1.5">
                        <span>Comissão, Agravo & Base do Prêmio</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 font-medium">
                          Apresentação da Cotação:
                        </span>
                        <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-[10px]">
                          <button
                            type="button"
                            onClick={() => {
                              setBasePremio('liquido')
                              const temC =
                                comissaoTrabalhada.trim() !== '' &&
                                !isNaN(parseFloat(comissaoTrabalhada))
                              const c = temC ? parseFloat(comissaoTrabalhada) : null
                              const agr = parseFloat(agravo) || 0
                              const pLiq = parseFloat(premioLiquido) || 0
                              if (pLiq > 0 && c !== null && c >= 0 && c < 100) {
                                const net = pLiq * (1 - c / 100)
                                setPremioNet(net.toFixed(2))
                                if (agr > 0) {
                                  const netPos = net * (1 + agr / 100)
                                  const liqRecalc = netPos / (1 - c / 100)
                                  setPremioLiquido(liqRecalc.toFixed(2))
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((liqRecalc * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((liqRecalc + iofVal).toFixed(2))
                                }
                              }
                            }}
                            className={`px-2 py-0.5 rounded font-medium transition-colors ${
                              basePremio === 'liquido'
                                ? 'bg-[#16578B] text-white'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            Prêmio Líquido (com comissão)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBasePremio('net')
                              const temC =
                                comissaoTrabalhada.trim() !== '' &&
                                !isNaN(parseFloat(comissaoTrabalhada))
                              const c = temC ? parseFloat(comissaoTrabalhada) : null
                              const agr = parseFloat(agravo) || 0
                              const pNet = parseFloat(premioNet) || 0
                              if (pNet > 0 && c !== null && c >= 0 && c < 100) {
                                const netBaseParaLiq = agr > 0 ? pNet * (1 + agr / 100) : pNet
                                const liq = netBaseParaLiq / (1 - c / 100)
                                setPremioLiquido(liq.toFixed(2))
                                const iofVal = iof
                                  ? parseFloat(iof)
                                  : Number((liq * 0.0738).toFixed(2))
                                if (!iof) setIof(iofVal.toFixed(2))
                                setPremioBruto((liq + iofVal).toFixed(2))
                              } else if (c === null) {
                                // Base Net sem comissão: derivados pendentes
                                setPremioLiquido('')
                                setIof('')
                                setPremioBruto('')
                              }
                            }}
                            className={`px-2 py-0.5 rounded font-medium transition-colors ${
                              basePremio === 'net'
                                ? 'bg-[#16578B] text-white'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            Prêmio Net (sem comissão)
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                      {/* Comissão Trabalhada */}
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-gray-700">
                          Comissão Trabalhada (%)
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="99.9"
                          value={comissaoTrabalhada}
                          onChange={(e) => {
                            const val = e.target.value
                            setComissaoTrabalhada(val)
                            const temVal = val.trim() !== '' && !isNaN(parseFloat(val))
                            const c = temVal ? parseFloat(val) : null
                            const agr = parseFloat(agravo) || 0

                            if (basePremio === 'liquido') {
                              const pLiq = parseFloat(premioLiquido) || 0
                              if (pLiq > 0 && c !== null && c < 100) {
                                const net = pLiq * (1 - c / 100)
                                setPremioNet(net.toFixed(2))
                                if (agr > 0) {
                                  const netPos = net * (1 + agr / 100)
                                  const liqRecalc = netPos / (1 - c / 100)
                                  setPremioLiquido(liqRecalc.toFixed(2))
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((liqRecalc * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((liqRecalc + iofVal).toFixed(2))
                                } else {
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((pLiq * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((pLiq + iofVal).toFixed(2))
                                }
                              }
                            } else {
                              // base Net
                              const pNet = parseFloat(premioNet) || 0
                              if (pNet > 0) {
                                if (c !== null && c >= 0 && c < 100) {
                                  const netParaLiq = agr > 0 ? pNet * (1 + agr / 100) : pNet
                                  const pLiq = netParaLiq / (1 - c / 100)
                                  setPremioLiquido(pLiq.toFixed(2))
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((pLiq * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((pLiq + iofVal).toFixed(2))
                                } else if (c === null) {
                                  // Comissão apagada/vazia: Líquido, IOF e Bruto voltam a ficar pendentes
                                  setPremioLiquido('')
                                  setIof('')
                                  setPremioBruto('')
                                }
                              }
                            }
                          }}
                          placeholder="Ex: 15 ou 20"
                          className="h-8 text-xs font-mono font-bold text-blue-900"
                        />
                      </div>

                      {/* Agravo (%) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold text-gray-700">
                            Agravo (%)
                          </Label>
                          <span className="text-[10px] text-gray-400 font-normal">opcional</span>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={agravo}
                          onChange={(e) => {
                            const val = e.target.value
                            setAgravo(val)
                            const agr = parseFloat(val) || 0
                            const temC =
                              comissaoTrabalhada.trim() !== '' &&
                              !isNaN(parseFloat(comissaoTrabalhada))
                            const c = temC ? parseFloat(comissaoTrabalhada) : null

                            if (basePremio === 'liquido') {
                              // Agravo age sobre o Net.
                              // Se base é líquido, o Net original deriva do líquido digitado (ou do net já em tela)
                              const pLiq = parseFloat(premioLiquido) || 0
                              const netOriginal =
                                parseFloat(premioNet) ||
                                (pLiq > 0 && c !== null && c < 100 ? pLiq * (1 - c / 100) : 0)
                              if (netOriginal > 0) {
                                setPremioNet(netOriginal.toFixed(2))
                                const netPos = agr > 0 ? netOriginal * (1 + agr / 100) : netOriginal
                                if (c !== null && c < 100) {
                                  const liqNovo = netPos / (1 - c / 100)
                                  setPremioLiquido(liqNovo.toFixed(2))
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((liqNovo * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((liqNovo + iofVal).toFixed(2))
                                }
                              }
                            } else {
                              // base Net
                              const pNet = parseFloat(premioNet) || 0
                              if (pNet > 0) {
                                if (c !== null && c >= 0 && c < 100) {
                                  const netPos = agr > 0 ? pNet * (1 + agr / 100) : pNet
                                  const pLiq = netPos / (1 - c / 100)
                                  setPremioLiquido(pLiq.toFixed(2))
                                  const iofVal = Number((pLiq * 0.0738).toFixed(2))
                                  setIof(iofVal.toFixed(2))
                                  setPremioBruto((pLiq + iofVal).toFixed(2))
                                } else {
                                  // Sem comissão: Líquido, IOF e Bruto continuam vazios/pendentes
                                  setPremioLiquido('')
                                  setIof('')
                                  setPremioBruto('')
                                }
                              }
                            }
                          }}
                          placeholder="Ex: 10"
                          className="h-8 text-xs font-mono font-bold text-amber-900 bg-amber-50/30"
                        />
                      </div>

                      {/* Prêmio Net */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold text-gray-700">
                            Prêmio Net (sem comissão)
                          </Label>
                          {premioNet && (
                            <span className="text-[10px] font-mono text-gray-600">
                              {formatCurrency(premioNet)}
                            </span>
                          )}
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          value={premioNet}
                          onChange={(e) => {
                            const val = e.target.value
                            setPremioNet(val)
                            const pNet = parseFloat(val) || 0
                            const temC =
                              comissaoTrabalhada.trim() !== '' &&
                              !isNaN(parseFloat(comissaoTrabalhada))
                            const c = temC ? parseFloat(comissaoTrabalhada) : null
                            const agr = parseFloat(agravo) || 0

                            if (basePremio === 'net') {
                              if (pNet > 0 && c !== null && c >= 0 && c < 100) {
                                const netPos = agr > 0 ? pNet * (1 + agr / 100) : pNet
                                const pLiq = netPos / (1 - c / 100)
                                setPremioLiquido(pLiq.toFixed(2))
                                const iofVal = Number((pLiq * 0.0738).toFixed(2))
                                setIof(iofVal.toFixed(2))
                                setPremioBruto((pLiq + iofVal).toFixed(2))
                              } else {
                                setPremioLiquido('')
                                setIof('')
                                setPremioBruto('')
                              }
                            } else if (basePremio === 'liquido') {
                              if (pNet > 0 && c !== null && c >= 0 && c < 100) {
                                const pLiq = pNet / (1 - c / 100)
                                setPremioLiquido(pLiq.toFixed(2))
                                const iofVal = Number((pLiq * 0.0738).toFixed(2))
                                setIof(iofVal.toFixed(2))
                                setPremioBruto((pLiq + iofVal).toFixed(2))
                              }
                            }
                          }}
                          placeholder="0,00"
                          className={`h-8 text-xs font-semibold ${
                            basePremio === 'net' ? 'border-[#16578B] bg-blue-50/30' : ''
                          }`}
                        />
                      </div>

                      {/* Prêmio Líquido */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold text-gray-700">
                            Prêmio Líquido (com comissão)
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
                          onChange={(e) => {
                            const val = e.target.value
                            setPremioLiquido(val)
                            const pLiq = parseFloat(val) || 0
                            const c = parseFloat(comissaoTrabalhada) || 0
                            const agr = parseFloat(agravo) || 0

                            if (basePremio === 'liquido') {
                              if (pLiq > 0 && c < 100) {
                                const net = pLiq * (1 - c / 100)
                                setPremioNet(net.toFixed(2))
                                if (agr > 0) {
                                  const netPos = net * (1 + agr / 100)
                                  const liqRecalc = netPos / (1 - c / 100)
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((liqRecalc * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((liqRecalc + iofVal).toFixed(2))
                                } else {
                                  const iofVal = iof
                                    ? parseFloat(iof)
                                    : Number((pLiq * 0.0738).toFixed(2))
                                  if (!iof) setIof(iofVal.toFixed(2))
                                  setPremioBruto((pLiq + iofVal).toFixed(2))
                                }
                              }
                            } else {
                              const iofVal = iof
                                ? parseFloat(iof)
                                : Number((pLiq * 0.0738).toFixed(2))
                              if (!iof) setIof(iofVal.toFixed(2))
                              setPremioBruto((pLiq + iofVal).toFixed(2))
                            }
                          }}
                          placeholder="0,00"
                          className={`h-8 text-xs font-semibold ${
                            basePremio === 'liquido' ? 'border-[#16578B] bg-blue-50/30' : ''
                          }`}
                        />
                      </div>

                      {/* Prêmio Bruto */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold text-gray-700">
                            Prêmio Bruto (Líquido + IOF)
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
                    </div>

                    {/* Resumo derivado em pill badges com Quarteto de Prêmios */}
                    <div className="p-2 bg-white rounded border border-gray-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="text-gray-500 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="font-semibold">
                          {temAgravoVal ? 'Quarteto de Prêmios Derivados:' : 'Tríade de Prêmios:'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 font-mono">
                        <span>
                          Net:{' '}
                          <strong className="text-gray-800">
                            {premioNet ? formatCurrency(premioNet) : 'R$ 0,00'}
                          </strong>
                        </span>

                        {temAgravoVal && pNetPosAgravoCalc !== null && (
                          <>
                            <span className="text-gray-300">•</span>
                            <span className="bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-amber-900">
                              Net Pós Agravo ({agravoNum}%):{' '}
                              <strong className="font-bold text-amber-950">
                                {formatCurrency(pNetPosAgravoCalc)}
                              </strong>{' '}
                              <span className="text-[9px] uppercase font-sans font-semibold text-amber-700">
                                [calculado]
                              </span>
                            </span>
                          </>
                        )}

                        <span className="text-gray-300">•</span>
                        <span>
                          Líquido:{' '}
                          {premioLiquido ? (
                            <strong className="text-blue-900">
                              {formatCurrency(premioLiquido)}
                            </strong>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                              Pendente (informe comissão)
                            </span>
                          )}
                          {temAgravoVal && premioLiquido && (
                            <span className="text-[9px] text-blue-600 font-sans ml-1">
                              (derivado)
                            </span>
                          )}
                        </span>
                        <span className="text-gray-300">•</span>
                        <span>
                          Bruto:{' '}
                          {premioBruto ? (
                            <strong className="text-emerald-700">
                              {formatCurrency(premioBruto)}
                            </strong>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                              Pendente
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    onChange={(e) => {
                      const val = e.target.value
                      setIof(val)
                      const iofNum = parseFloat(val) || 0
                      const liqNum = parseFloat(premioLiquido) || 0
                      if (liqNum > 0) {
                        setPremioBruto((liqNum + iofNum).toFixed(2))
                      }
                    }}
                    placeholder="0,00"
                    className="h-8 text-xs text-gray-600"
                  />
                </div>

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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
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

              {/* BLOCO VRD (VALOR EM RISCO DECLARADO) — SUBSTITUI O CAMPO FRANQUIAS GERAIS / P.O.S. */}
              <div className="p-3 bg-blue-50/40 rounded-xl border border-blue-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#16578B]" />
                    <span>Bloco VRD (Valor em Risco Declarado)</span>
                  </span>
                  <span className="text-[10px] text-gray-500">
                    Editável pelo analista • Gravado em campos numéricos por seção
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold text-gray-700">
                        VRD - Danos Materiais (DM)
                      </Label>
                      {vrdDm && (
                        <span className="text-[9px] font-mono text-gray-500">
                          {formatCurrency(vrdDm)}
                        </span>
                      )}
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      value={vrdDm}
                      onChange={(e) => setVrdDm(e.target.value)}
                      placeholder="0,00"
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold text-gray-700">VRD - MMU</Label>
                      {vrdMmu && (
                        <span className="text-[9px] font-mono text-gray-500">
                          {formatCurrency(vrdMmu)}
                        </span>
                      )}
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      value={vrdMmu}
                      onChange={(e) => setVrdMmu(e.target.value)}
                      placeholder="0,00"
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold text-gray-700">VRD - MMP</Label>
                      {vrdMmp && (
                        <span className="text-[9px] font-mono text-gray-500">
                          {formatCurrency(vrdMmp)}
                        </span>
                      )}
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      value={vrdMmp}
                      onChange={(e) => setVrdMmp(e.target.value)}
                      placeholder="0,00"
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold text-gray-700">
                        VRD - Lucros Cessantes (LC)
                      </Label>
                      {vrdLc && (
                        <span className="text-[9px] font-mono text-gray-500">
                          {formatCurrency(vrdLc)}
                        </span>
                      )}
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      value={vrdLc}
                      onChange={(e) => setVrdLc(e.target.value)}
                      placeholder="0,00"
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-gray-700">Base da LC</Label>
                    <select
                      value={vrdLcBase}
                      onChange={(e) => setVrdLcBase(e.target.value)}
                      className="w-full h-8 rounded border border-gray-300 bg-white px-2 text-xs font-medium text-gray-800"
                    >
                      <option value="Lucro Bruto">Lucro Bruto</option>
                      <option value="Despesas Fixas">Despesas Fixas</option>
                      <option value="Lucro Líquido (LL)">Lucro Líquido (LL)</option>
                    </select>
                  </div>
                </div>
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

            {/* SEÇÃO 5: COBERTURAS EXTRAÍDAS (EDITÁVEL ANTES DE GRAVAR) */}
            <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#16578B]" />
                  <span>Quadro de Coberturas ({coberturas.length} itens)</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 hidden sm:inline">
                    Edite ou exclua coberturas excedentes antes de confirmar
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAddForm(!showAddForm)
                      setDeletingIndex(null)
                      setEditingIndex(null)
                    }}
                    className="h-6 text-[10px] px-2 text-[#16578B] border-blue-200 hover:bg-blue-50"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    <span>Adicionar cobertura</span>
                  </Button>
                </div>
              </div>

              {/* Formulário inline para adicionar nova cobertura */}
              {showAddForm && (
                <div className="p-3 bg-white border border-blue-200 rounded-lg space-y-2 shadow-sm animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-[#0F2B46] flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5 text-[#16578B]" />
                      <span>Nova Cobertura Manual</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="sm:col-span-2 space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Nome da Cobertura</Label>
                      <Input
                        type="text"
                        placeholder="Ex: Danos Elétricos"
                        value={newNome}
                        onChange={(e) => {
                          const val = e.target.value
                          setNewNome(val)
                          const autoCat = matchCanonicalCategory(val)
                          if (autoCat && CATEGORIAS_48.includes(autoCat as any)) {
                            setNewCategoria(autoCat)
                          }
                        }}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Categoria Canônica</Label>
                      <select
                        value={newCategoria}
                        onChange={(e) => setNewCategoria(e.target.value)}
                        className="w-full h-7 rounded border border-gray-300 bg-white px-2 text-xs"
                      >
                        {CATEGORIAS_48.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-gray-600">LMI / IS (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={newLmi}
                        onChange={(e) => setNewLmi(e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Prêmio (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={newPremio}
                        onChange={(e) => setNewPremio(e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-0.5">
                      <Label className="text-[10px] text-gray-600">Franquia / P.O.S.</Label>
                      <Input
                        type="text"
                        placeholder="Ex: 10% min R$ 5.000"
                        value={newFranquia}
                        onChange={(e) => setNewFranquia(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-1.5 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddForm(false)}
                      className="h-6 text-[10px] px-2 text-gray-600"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddNewCoverage}
                      className="h-6 text-[10px] px-2.5 bg-[#0F2B46] text-white hover:bg-[#1B3C5D]"
                    >
                      Incluir no Quadro
                    </Button>
                  </div>
                </div>
              )}

              {coberturas.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400 bg-white border border-gray-200 rounded-lg">
                  Nenhuma cobertura incluída. Clique em "Adicionar cobertura" se desejar inserir
                  manualmente.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-gray-50 border-b text-gray-600 font-semibold sticky top-0 z-10">
                      <tr>
                        <th className="py-1.5 px-3">Cobertura</th>
                        <th className="py-1.5 px-2">Classificação</th>
                        <th className="py-1.5 px-2 text-right">LMI</th>
                        <th className="py-1.5 px-2 text-right">Prêmio</th>
                        <th className="py-1.5 px-3">Franquia / P.O.S.</th>
                        <th className="py-1.5 px-2 text-right w-20">Ações</th>
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
                          const isEditing = editingIndex === i
                          const isDeleting = deletingIndex === i

                          if (isEditing) {
                            return (
                              <tr key={i} className="bg-blue-50/60">
                                <td colSpan={6} className="p-2.5 space-y-2">
                                  <div className="flex items-center justify-between pb-1 border-b border-blue-200 text-xs font-semibold text-[#0F2B46]">
                                    <span>Editar Linha de Cobertura #{i + 1}</span>
                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={saveEditingCoverage}
                                        className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1"
                                      >
                                        <Check className="w-3 h-3" />
                                        <span>Salvar Linha</span>
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={cancelEditingCoverage}
                                        className="h-6 text-[10px] px-2 text-gray-600"
                                      >
                                        Cancelar
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                    <div className="sm:col-span-2 space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">Nome</Label>
                                      <Input
                                        type="text"
                                        value={editNome}
                                        onChange={(e) => setEditNome(e.target.value)}
                                        className="h-7 text-xs bg-white"
                                      />
                                    </div>
                                    <div className="sm:col-span-2 space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        Categoria Canônica
                                      </Label>
                                      <select
                                        value={editCategoria}
                                        onChange={(e) => setEditCategoria(e.target.value)}
                                        className="w-full h-7 rounded border border-gray-300 bg-white px-2 text-xs"
                                      >
                                        {CATEGORIAS_48.map((cat) => (
                                          <option key={cat} value={cat}>
                                            {cat}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        LMI / IS (R$)
                                      </Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={editLmi}
                                        onChange={(e) => setEditLmi(e.target.value)}
                                        className="h-7 text-xs font-mono bg-white"
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        Prêmio (R$)
                                      </Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={editPremio}
                                        onChange={(e) => setEditPremio(e.target.value)}
                                        className="h-7 text-xs font-mono bg-white"
                                      />
                                    </div>
                                    <div className="sm:col-span-2 space-y-0.5">
                                      <Label className="text-[10px] text-gray-600">
                                        Franquia / P.O.S.
                                      </Label>
                                      <Input
                                        type="text"
                                        value={editFranquia}
                                        onChange={(e) => setEditFranquia(e.target.value)}
                                        className="h-7 text-xs bg-white"
                                      />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                          }

                          return (
                            <tr
                              key={i}
                              className={`hover:bg-gray-50/70 transition-colors ${
                                isDeleting
                                  ? 'bg-rose-50/60'
                                  : isBasica
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
                                {c.lmi !== null && c.lmi !== undefined
                                  ? formatCurrency(c.lmi)
                                  : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right text-emerald-800 font-mono">
                                {c.premioLiquido !== null && c.premioLiquido !== undefined
                                  ? formatCurrency(c.premioLiquido)
                                  : '—'}
                              </td>
                              <td
                                className="py-1.5 px-3 text-gray-600 text-[10px] truncate max-w-[150px]"
                                title={c.franquia}
                              >
                                {c.franquia || 'Conforme apólice'}
                              </td>
                              <td className="py-1.5 px-2 text-right whitespace-nowrap">
                                {isDeleting ? (
                                  <div className="inline-flex items-center gap-1 bg-white border border-rose-300 rounded px-1.5 py-0.5 shadow-sm">
                                    <span className="text-[10px] text-rose-700 font-semibold">
                                      Excluir?
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => confirmDeleteCoverage(i)}
                                      className="text-rose-700 hover:text-rose-900 font-bold px-1 text-[10px] underline"
                                      title="Confirmar exclusão desta cobertura"
                                    >
                                      Sim
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeletingIndex(null)}
                                      className="text-gray-500 hover:text-gray-700 px-1 text-[10px]"
                                      title="Cancelar exclusão"
                                    >
                                      Não
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => startEditingCoverage(i)}
                                      className="p-1 text-gray-500 hover:text-[#16578B] hover:bg-blue-50 rounded transition-colors"
                                      title="Editar nome, LMI, prêmio e franquia desta linha"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeletingIndex(i)
                                        setEditingIndex(null)
                                      }}
                                      className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                      title="Excluir esta cobertura extra do quadro"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* BOTÕES DE CONFIRMAÇÃO */}
            <div className="pt-2 flex items-center justify-between border-t border-gray-100">
              <div className="flex items-center gap-2">
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

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownloadDiagnostico(selectedSegment)}
                  className="text-xs h-8 text-gray-500 hover:text-[#16578B] flex items-center gap-1.5 px-2"
                  title="Baixar dados brutos, limites calibrados, linhas montadas e resultado final da extração em JSON"
                >
                  <Download className="w-3.5 h-3.5 text-gray-400" />
                  <span>Baixar diagnóstico de extração</span>
                </Button>
              </div>

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
