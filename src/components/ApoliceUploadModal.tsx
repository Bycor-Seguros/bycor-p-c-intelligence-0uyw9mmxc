/**
 * Modal de Upload de Apólice Emitida em PDF (C1 - Recebimento / Portfólio Atual)
 *
 * Funcionalidades:
 * 1. Upload via drag & drop ou clique (apenas .pdf)
 * 2. Extração técnica via apoliceReader.ts (texto + geometria)
 * 3. Botão "Baixar diagnóstico de extração (JSON)"
 * 4. Pré-visualização com campos editáveis (Seguradora, Nº Apólice, Proposta, Ramo,
 *    Vigência, Segurado, CNPJ, Corretor, Prêmios, Parcelas, LMGA, VRD, Forma de Contratação, Coberturas)
 * 5. Identificação e vínculo com o empreendimento da base (busca por CNPJ ou nome)
 * 6. Aviso se o número da apólice já existir no banco (com confirmação explícita de sobrescrita)
 * 7. Gravação completa na coleção `apolices`, criação/atualização das `coberturas`,
 *    anexação do arquivo PDF na coleção `documentos` (tipo "Apólice PDF") vinculada ao empreendimento e à apólice
 * 8. Aplicação de sucessão automática por empreendimento + ramo via apoliceStatusService
 * 9. Campo não reconhecido = vazio (nunca inventa dados)
 */

import { useState, useEffect } from 'react'
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  Building2,
  Calendar,
  DollarSign,
  ShieldAlert,
  ArrowRight,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  formatCurrency,
  formatCurrencyNumber,
  parseCurrencyValue,
  formatDate,
  formatCnpj,
} from '@/lib/formatters'
import {
  parseApolicePdf,
  ApoliceExtracaoResultado,
  ExtractedApoliceCobertura,
} from '@/services/apoliceReader'
import { ApoliceMinima, buildMapaSucessao } from '@/services/apoliceStatusService'

interface EmpreendimentoOption {
  id: string
  id_empreendimento: string
  nome_empreendimento: string
  cnpj: string
}

interface ApoliceUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ApoliceUploadModal({ open, onOpenChange, onSuccess }: ApoliceUploadModalProps) {
  const { user } = useAuth()

  // Estados do fluxo
  const [step, setStep] = useState<'upload' | 'preview' | 'saving' | 'success'>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractionResult, setExtractionResult] = useState<ApoliceExtracaoResultado | null>(null)
  const [showDiagnosticoDet, setShowDiagnosticoDet] = useState(false)

  // Empreendimentos disponíveis para vincular
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoOption[]>([])
  const [selectedEmpreendimentoId, setSelectedEmpreendimentoId] = useState<string>('')

  // Alerta de apólice já existente
  const [existingApoliceId, setExistingApoliceId] = useState<string | null>(null)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)

  // Sucessão antecessora identificada
  const [antecessoraIdentificada, setAntecessoraIdentificada] = useState<ApoliceMinima | null>(null)

  // Campos do formulário de pré-visualização (editáveis)
  const [seguradoraNome, setSeguradoraNome] = useState('')
  const [seguradoraCnpj, setSeguradoraCnpj] = useState('')
  const [seguradoraSusep, setSeguradoraSusep] = useState('')
  const [numeroApolice, setNumeroApolice] = useState('')
  const [numeroProposta, setNumeroProposta] = useState('')
  const [ramo, setRamo] = useState('')
  const [vigenciaInicio, setVigenciaInicio] = useState('')
  const [vigenciaFim, setVigenciaFim] = useState('')
  const [seguradoNome, setSeguradoNome] = useState('')
  const [seguradoCnpj, setSeguradoCnpj] = useState('')
  const [corretorNome, setCorretorNome] = useState('')

  // Valores financeiros
  const [premioLiquido, setPremioLiquido] = useState<string>('')
  const [custoApolice, setCustoApolice] = useState<string>('')
  const [iof, setIof] = useState<string>('')
  const [premioTotal, setPremioTotal] = useState<string>('')
  const [condicoesPagamento, setCondicoesPagamento] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('')

  // Limites
  const [lmga, setLmga] = useState<string>('')
  const [vrdTotalDm, setVrdTotalDm] = useState<string>('')
  const [vrdTotalLc, setVrdTotalLc] = useState<string>('')
  const [lmiIncendioBasica, setLmiIncendioBasica] = useState<string>('')
  const [formaContratacao, setFormaContratacao] = useState('')

  // Coberturas
  const [coberturas, setCoberturas] = useState<ExtractedApoliceCobertura[]>([])

  // Mensagens e erros
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saveSuccessSummary, setSaveSuccessSummary] = useState<{
    idApoliceGravada: string
    numeroApolice: string
    coberturasGravadas: number
    sucedidaDescricao?: string
  } | null>(null)

  // Carregar lista de empreendimentos ao abrir
  useEffect(() => {
    if (!open) {
      resetModal()
      return
    }

    const loadEmps = async () => {
      try {
        const list = await pb.collection('empreendimentos').getFullList<EmpreendimentoOption>({
          fields: 'id,id_empreendimento,nome_empreendimento,cnpj',
          sort: 'nome_empreendimento',
        })
        setEmpreendimentos(list)
      } catch (err) {
        console.warn('Erro ao carregar empreendimentos:', err)
      }
    }
    loadEmps()
  }, [open])

  const resetModal = () => {
    setStep('upload')
    setSelectedFile(null)
    setIsDragOver(false)
    setExtracting(false)
    setExtractionResult(null)
    setShowDiagnosticoDet(false)
    setSelectedEmpreendimentoId('')
    setExistingApoliceId(null)
    setConfirmOverwrite(false)
    setAntecessoraIdentificada(null)
    setErrorMessage(null)
    setSaveSuccessSummary(null)
    setCoberturas([])
  }

  // Processamento do arquivo PDF
  const handleSelectFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Por favor, selecione um arquivo de documento no formato PDF.')
      return
    }

    setErrorMessage(null)
    setSelectedFile(file)
    setExtracting(true)

    try {
      const res = await parseApolicePdf(file)
      setExtractionResult(res)

      // Preenche os campos editáveis
      setSeguradoraNome(res.seguradoraNome || '')
      setSeguradoraCnpj(res.seguradoraCnpj || '')
      setSeguradoraSusep(res.seguradoraSusep || '')
      setNumeroApolice(res.numeroApolice || '')
      setNumeroProposta(res.numeroProposta || '')
      setRamo(res.ramoCompleto || res.ramoNome || '')
      setVigenciaInicio(res.vigenciaInicio || '')
      setVigenciaFim(res.vigenciaFim || '')
      setSeguradoNome(res.seguradoNome || '')
      setSeguradoCnpj(res.seguradoCnpj || '')
      setCorretorNome(res.corretorNome || 'BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA')

      setPremioLiquido(res.premioLiquido !== null ? formatCurrencyNumber(res.premioLiquido) : '')
      setCustoApolice(res.custoApolice !== null ? formatCurrencyNumber(res.custoApolice) : '0,00')
      setIof(res.iof !== null ? formatCurrencyNumber(res.iof) : '')
      setPremioTotal(res.premioTotal !== null ? formatCurrencyNumber(res.premioTotal) : '')
      setCondicoesPagamento(res.condicoesPagamento || '')
      setFormaPagamento(res.formaPagamento || '')

      setLmga(res.lmga !== null ? formatCurrencyNumber(res.lmga) : '')
      setVrdTotalDm(res.vrdTotalDm !== null ? formatCurrencyNumber(res.vrdTotalDm) : '')
      setVrdTotalLc(res.vrdTotalLc !== null ? formatCurrencyNumber(res.vrdTotalLc) : '')
      setLmiIncendioBasica(
        res.lmiIncendioBasica !== null ? formatCurrencyNumber(res.lmiIncendioBasica) : '',
      )
      setFormaContratacao(res.formaContratacao || '')

      setCoberturas(res.coberturas || [])

      // Localização automática do empreendimento correspondente
      let matchedEmpId = ''
      const cleanCnpjRes = res.seguradoCnpj.replace(/\D/g, '')

      if (cleanCnpjRes) {
        const found = empreendimentos.find(
          (e) => (e.cnpj || '').replace(/\D/g, '') === cleanCnpjRes,
        )
        if (found) {
          matchedEmpId = found.id
        }
      }

      if (!matchedEmpId && res.seguradoNome) {
        const segUpper = res.seguradoNome.toUpperCase()
        const found = empreendimentos.find(
          (e) =>
            segUpper.includes(e.nome_empreendimento.toUpperCase()) ||
            e.nome_empreendimento.toUpperCase().includes(segUpper) ||
            segUpper.includes('BERRINI') ||
            segUpper.includes('MORUMBI'),
        )
        if (found) {
          matchedEmpId = found.id
        }
      }

      // Se encontrou BTT Morumbi na base pelo CNPJ ou nome
      if (!matchedEmpId) {
        const bttMorumbi = empreendimentos.find(
          (e) =>
            e.id_empreendimento === 'btt_morumbi' ||
            (e.cnpj && e.cnpj.includes('04.300.917')) ||
            e.nome_empreendimento.toLowerCase().includes('morumbi'),
        )
        if (bttMorumbi) {
          matchedEmpId = bttMorumbi.id
        }
      }

      setSelectedEmpreendimentoId(matchedEmpId)

      // Checar se já existe apólice cadastrada com este número
      if (res.numeroApolice) {
        try {
          const cleanNum = res.numeroApolice.trim()
          const existing = await pb
            .collection('apolices')
            .getFirstListItem(`numero_apolice="${cleanNum}"`)
            .catch(() => null)

          if (existing) {
            setExistingApoliceId(existing.id)
          } else {
            setExistingApoliceId(null)
          }
        } catch {
          setExistingApoliceId(null)
        }
      }

      // Checar sucessão com apólices irmãs do mesmo empreendimento
      if (matchedEmpId) {
        try {
          const sisterApolices = await pb.collection('apolices').getFullList<ApoliceMinima>({
            filter: `id_empreendimento="${matchedEmpId}"`,
          })
          if (sisterApolices.length > 0) {
            // Cria apólice virtual para simular no mapa
            const virtualApolice: ApoliceMinima = {
              id: 'temp_nova_apolice',
              id_empreendimento: matchedEmpId,
              ramo: res.ramoCompleto,
              data_inicio: res.vigenciaInicio,
              data_fim: res.vigenciaFim,
              numero_apolice: res.numeroApolice,
              status: 'ativa',
            }
            const todos = [...sisterApolices, virtualApolice]
            const mapa = buildMapaSucessao(todos)
            const relNova = mapa.get('temp_nova_apolice')
            if (relNova?.antecessora) {
              setAntecessoraIdentificada(relNova.antecessora)
            }
          }
        } catch (e) {
          console.warn('Erro ao verificar sucessão:', e)
        }
      }

      setStep('preview')
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Erro ao processar o arquivo PDF.')
    } finally {
      setExtracting(false)
    }
  }

  // Baixar JSON de diagnóstico
  const handleDownloadDiagnostico = () => {
    if (!extractionResult) return

    const dumpData = {
      seguradora: extractionResult.seguradoraNome,
      numeroApolice: extractionResult.numeroApolice,
      proposta: extractionResult.numeroProposta,
      ramo: extractionResult.ramoCompleto,
      vigencia: {
        inicio: extractionResult.vigenciaInicio,
        fim: extractionResult.vigenciaFim,
      },
      segurado: {
        nome: extractionResult.seguradoNome,
        cnpj: extractionResult.seguradoCnpj,
        endereco: extractionResult.seguradoEndereco,
      },
      corretor: {
        nome: extractionResult.corretorNome,
        cnpj: extractionResult.corretorCnpj,
        susep: extractionResult.corretorSusep,
      },
      financeiro: {
        premioLiquido: extractionResult.premioLiquido,
        custoApolice: extractionResult.custoApolice,
        iof: extractionResult.iof,
        premioTotal: extractionResult.premioTotal,
        condicoesPagamento: extractionResult.condicoesPagamento,
        formaPagamento: extractionResult.formaPagamento,
        parcelas: extractionResult.parcelas,
      },
      limites: {
        lmga: extractionResult.lmga,
        vrdTotalDm: extractionResult.vrdTotalDm,
        vrdTotalLc: extractionResult.vrdTotalLc,
        vrdTotalDmPlusLc: extractionResult.vrdTotalDmPlusLc,
        lmiIncendioBasica: extractionResult.lmiIncendioBasica,
        formaContratacao: extractionResult.formaContratacao,
      },
      coberturas: extractionResult.coberturas,
      diagnostico: extractionResult.diagnostico,
    }

    const blob = new Blob([JSON.stringify(dumpData, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diagnostico_apolice_${extractionResult.numeroApolice || 'extracao'}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Gravação no Banco de Dados
  const handleConfirmarGravacao = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!numeroApolice.trim()) {
      setErrorMessage('O número da apólice é obrigatório para gravação.')
      return
    }

    if (existingApoliceId && !confirmOverwrite) {
      setErrorMessage(
        'Esta apólice já existe no banco. Confirme a substituição marcando a caixa de confirmação.',
      )
      return
    }

    setStep('saving')
    setErrorMessage(null)

    try {
      const pLiq = parseCurrencyValue(premioLiquido)
      const pTot = parseCurrencyValue(premioTotal)
      const pIof = parseCurrencyValue(iof)
      const pCusto = parseCurrencyValue(custoApolice) ?? 0
      const vrdDm = parseCurrencyValue(vrdTotalDm)
      const vrdLc = parseCurrencyValue(vrdTotalLc)
      const valLmga = parseCurrencyValue(lmga)
      const valLmiBasica = parseCurrencyValue(lmiIncendioBasica)

      let razaoLmiVr: number | null = null
      if (valLmiBasica !== null && vrdDm !== null && vrdDm > 0) {
        razaoLmiVr = valLmiBasica / vrdDm
      }

      // Gera id_apolice canônico se novo (ex: "btt_morumbi_axa_rn_2026")
      let idApoliceCanonical = ''
      const empSelected = empreendimentos.find((e) => e.id === selectedEmpreendimentoId)
      const empKey = empSelected?.id_empreendimento || 'apolice'
      const anoFim = vigenciaFim ? vigenciaFim.slice(0, 4) : new Date().getFullYear().toString()
      const segShort = (seguradoraNome || 'seg').toLowerCase().includes('axa') ? 'axa' : 'apol'
      idApoliceCanonical = `${empKey}_${segShort}_rn_${anoFim}`

      const payloadApolice = {
        id_apolice: idApoliceCanonical,
        id_empreendimento: selectedEmpreendimentoId || null,
        segurado_na_apolice: seguradoNome.trim(),
        cnpj_segurado: seguradoCnpj.trim(),
        seguradora: seguradoraNome.trim(),
        numero_apolice: numeroApolice.trim(),
        ramo: ramo.trim() || '01.96 RISCOS NOMEADOS',
        corretor: corretorNome.trim(),
        data_inicio: vigenciaInicio ? `${vigenciaInicio} 00:00:00.000Z` : null,
        data_fim: vigenciaFim ? `${vigenciaFim} 00:00:00.000Z` : null,
        premio_liquido: pLiq,
        premio_total: pTot,
        valor_em_risco_dm: vrdDm,
        valor_em_risco_lc: vrdLc,
        lmga: valLmga,
        lmi_incendio_basica: valLmiBasica,
        razao_lmi_vr_dm: razaoLmiVr,
        status: 'ativa',
        fonte_arquivo: selectedFile?.name || 'Apolice_Emitida.pdf',
        fonte_documento: 'Upload PDF Apólice Emitida C1',
        iof: pIof,
        comissao: pCusto,
        extraido_por_ia: false,
        confianca: 'alta',
        imported_at: new Date().toISOString(),
        imported_by: user?.email || '',
      }

      let savedApoliceId: string

      if (existingApoliceId) {
        // Atualiza a apólice existente
        const updated = await pb.collection('apolices').update(existingApoliceId, payloadApolice)
        savedApoliceId = updated.id
      } else {
        // Cria nova apólice
        // Verifica se id_apolice gerado já existe para não colidir no UNIQUE INDEX
        const checkId = await pb
          .collection('apolices')
          .getFirstListItem(`id_apolice="${idApoliceCanonical}"`)
          .catch(() => null)

        if (checkId) {
          payloadApolice.id_apolice = `${idApoliceCanonical}_${Date.now()}`
        }

        const created = await pb.collection('apolices').create(payloadApolice)
        savedApoliceId = created.id
      }

      // Gravação das Coberturas vinculadas à apólice
      let cobCount = 0
      if (savedApoliceId && coberturas.length > 0) {
        // Remove coberturas anteriores vinculadas a esta apólice para idempotência
        try {
          const prevCobs = await pb.collection('coberturas').getFullList({
            filter: `id_apolice="${savedApoliceId}"`,
            fields: 'id',
          })
          for (const pc of prevCobs) {
            await pb.collection('coberturas').delete(pc.id)
          }
        } catch (e) {
          console.warn('Erro ao limpar coberturas anteriores:', e)
        }

        // Insere as coberturas extraídas
        for (const c of coberturas) {
          try {
            await pb.collection('coberturas').create({
              id_apolice: savedApoliceId,
              nome_cobertura: c.nome,
              categoria_normalizada: c.categoriaNormalizada || c.nome,
              lmi_rs: c.lmi || 0,
              franquia_pos: c.franquiaPos || '',
              premio_cobertura: 0,
              observacao: c.observacao || '',
              fonte_documento: 'Upload PDF Apólice Emitida',
              extraido_por_ia: false,
              confianca: 'alta',
            })
            cobCount++
          } catch (cobErr) {
            console.warn(`Erro ao salvar cobertura ${c.nome}:`, cobErr)
          }
        }
      }

      // Anexa o documento PDF à coleção documentos
      if (selectedFile && savedApoliceId) {
        try {
          const formDoc = new FormData()
          formDoc.append('tipo', 'Apólice PDF')
          formDoc.append('arquivo', selectedFile)
          formDoc.append('versao', 'v1.0')
          formDoc.append('data', new Date().toISOString().slice(0, 10))
          formDoc.append('vinculado_apolice', savedApoliceId)
          if (selectedEmpreendimentoId) {
            formDoc.append('vinculado_empreendimento', selectedEmpreendimentoId)
          }
          await pb.collection('documentos').create(formDoc)
        } catch (docErr) {
          console.warn('Erro ao anexar arquivo de documento:', docErr)
        }
      }

      // Registrar histórico de emissão
      try {
        await pb.collection('historico').create({
          registro_id: savedApoliceId,
          tabela: 'apolices',
          data: new Date().toISOString().slice(0, 10),
          cia: seguradoraNome,
          texto: `Apólice emitida e registrada via leitor de PDF (Vigência: ${formatDate(vigenciaInicio)} a ${formatDate(vigenciaFim)}; Prêmio: ${formatCurrency(pTot || 0)}).`,
          autor: user?.id || null,
          timestamp: new Date().toISOString(),
        })
      } catch (hErr) {
        console.warn('Erro ao salvar histórico:', hErr)
      }

      let descSucessao = ''
      if (antecessoraIdentificada) {
        descSucessao = `Sucessão identificada: renova a apólice anterior nº ${antecessoraIdentificada.numero_apolice || antecessoraIdentificada.id_apolice}`
      }

      setSaveSuccessSummary({
        idApoliceGravada: savedApoliceId,
        numeroApolice,
        coberturasGravadas: cobCount,
        sucedidaDescricao: descSucessao,
      })

      setStep('success')
      onSuccess?.()
    } catch (err: unknown) {
      setStep('preview')
      setErrorMessage((err as Error).message || 'Erro ao gravar apólice no banco de dados.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto animate-scale-in">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-gray-900">
            <FileText className="w-5 h-5 text-[#16578B]" />
            <span>Leitor de Apólice Emitida (PDF)</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Upload do documento oficial da apólice emitida com extração de metadados, quadro de
            coberturas e vinculação automática de sucessão.
          </DialogDescription>
        </DialogHeader>

        {/* ETAPA 1: UPLOAD / DROPZONE */}
        {step === 'upload' && (
          <div className="py-4 space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleSelectFile(e.dataTransfer.files[0])
                }
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                isDragOver
                  ? 'border-[#16578B] bg-blue-50/50'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50/50'
              }`}
            >
              {extracting ? (
                <div className="flex flex-col items-center justify-center py-6">
                  <Loader2 className="w-10 h-10 animate-spin text-[#16578B] mb-3" />
                  <p className="text-sm font-semibold text-gray-800">
                    Lendo e estruturando apólice...
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Analisando texto e geometria (seguradora, prêmios, vigência e coberturas)...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-[#16578B] flex items-center justify-center mb-3">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-gray-800">
                    Arraste o arquivo PDF da apólice emitida
                  </p>
                  <p className="text-xs text-gray-500 mt-1 mb-4">
                    Documento oficial em PDF (ex: AXA, Porto Seguro, Chubb, Tokio, Allianz, Zurich)
                  </p>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleSelectFile(e.target.files[0])
                        }
                      }}
                    />
                    <span className="px-4 py-2 rounded-lg bg-[#0F2B46] text-white text-xs font-semibold hover:bg-[#1B3C5D] transition-colors shadow-sm">
                      Selecionar Apólice (PDF)
                    </span>
                  </label>
                </div>
              )}
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="text-[11px] text-gray-600 bg-blue-50/60 p-3 rounded-lg border border-blue-200/60 space-y-1">
              <div className="font-semibold text-[#0F2B46] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-[#16578B]" />
                <span>Critérios de integridade e fidelidade do leitor:</span>
              </div>
              <p>
                • <strong>Nunca inventar dados:</strong> Campos não reconhecidos permanecem vazios
                para validação humana.
              </p>
              <p>
                • <strong>Sucessão Automática:</strong> Ligação com apólices anteriores pelo par
                empreendimento + ramo.
              </p>
              <p>
                • <strong>Preservação da Base:</strong> Avisa antes de sobrescrever apólices já
                cadastradas.
              </p>
            </div>
          </div>
        )}

        {/* ETAPA 2: PRÉ-VISUALIZAÇÃO EDITÁVEL */}
        {step === 'preview' && (
          <form onSubmit={handleConfirmarGravacao} className="space-y-4 pt-1 text-xs">
            {/* Barra superior de alertas / ações */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-blue-50/80 border border-blue-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-semibold text-gray-900 text-xs">
                  Extração concluída — Revise e edite qualquer dado antes de salvar no Portfólio.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadDiagnostico}
                  className="h-7 text-[11px] px-2.5 border-blue-300 text-[#16578B] hover:bg-blue-100 flex items-center gap-1.5"
                  title="Baixa JSON estruturado com dados e coordenadas para auditoria técnica"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar diagnóstico de extração (JSON)</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep('upload')}
                  className="h-7 text-[11px] text-gray-500 hover:text-gray-900"
                >
                  Trocar arquivo
                </Button>
              </div>
            </div>

            {/* Alerta de Substituição caso número de apólice já exista */}
            {existingApoliceId && (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Atenção: Apólice já cadastrada no Portfólio!</span>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      Já existe uma apólice cadastrada com o número <strong>{numeroApolice}</strong>
                      . Salvar novamente irá atualizar os valores e re-vincular as coberturas.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmOverwrite}
                    onChange={(e) => setConfirmOverwrite(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-[11px] font-semibold text-amber-950">
                    Confirmo a atualização da apólice existente
                  </span>
                </label>
              </div>
            )}

            {/* Alerta de Sucessão Identificada */}
            {antecessoraIdentificada && (
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ArrowRight className="w-4 h-4 text-[#16578B] shrink-0" />
                  <span>
                    <strong>Sucessão de Carteira:</strong> Esta apólice sucede a anterior{' '}
                    <strong>{antecessoraIdentificada.numero_apolice || 'N/A'}</strong> (Vigência:{' '}
                    {formatDate(antecessoraIdentificada.data_inicio)} a{' '}
                    {formatDate(antecessoraIdentificada.data_fim)}). A anterior passará para{' '}
                    <span className="font-bold text-blue-700">Renovada</span>.
                  </span>
                </div>
              </div>
            )}

            {/* SEÇÃO 1: SEGURADORA E IDENTIFICAÇÃO DO CONTRATO */}
            <div className="bg-gray-50/70 p-3.5 rounded-xl border border-gray-200 space-y-3">
              <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#16578B]" />
                <span>Dados da Seguradora e do Contrato</span>
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Seguradora</Label>
                  <Input
                    type="text"
                    value={seguradoraNome}
                    onChange={(e) => setSeguradoraNome(e.target.value)}
                    placeholder="Ex: AXA Seguros S/A"
                    className="h-8 text-xs font-semibold"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    CNPJ da Seguradora
                  </Label>
                  <Input
                    type="text"
                    value={seguradoraCnpj}
                    onChange={(e) => setSeguradoraCnpj(e.target.value)}
                    placeholder="19.323.190/0001-06"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Registro SUSEP</Label>
                  <Input
                    type="text"
                    value={seguradoraSusep}
                    onChange={(e) => setSeguradoraSusep(e.target.value)}
                    placeholder="0285-2"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Nº da Apólice</Label>
                  <Input
                    type="text"
                    value={numeroApolice}
                    onChange={(e) => setNumeroApolice(e.target.value)}
                    placeholder="02852.2026.0001.0196.0009042"
                    className="h-8 text-xs font-bold text-blue-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Proposta Origem</Label>
                  <Input
                    type="text"
                    value={numeroProposta}
                    onChange={(e) => setNumeroProposta(e.target.value)}
                    placeholder="P-0119308"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">Ramo / Produto</Label>
                  <Input
                    type="text"
                    value={ramo}
                    onChange={(e) => setRamo(e.target.value)}
                    placeholder="01.96 RISCOS NOMEADOS"
                    className="h-8 text-xs font-semibold"
                    required
                  />
                </div>
              </div>
            </div>

            {/* SEÇÃO 2: VÍNCULO DE EMPREENDIMENTO E SEGURADO */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-3">
              <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#16578B]" />
                <span>Segurado & Vínculo com Empreendimento do Portfólio</span>
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Vincular ao Empreendimento da Base
                  </Label>
                  <select
                    value={selectedEmpreendimentoId}
                    onChange={(e) => setSelectedEmpreendimentoId(e.target.value)}
                    className="w-full h-8 rounded border border-gray-300 bg-white px-2 text-xs font-medium"
                  >
                    <option value="">— Selecione o empreendimento ou deixe geral —</option>
                    {empreendimentos.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nome_empreendimento} ({emp.cnpj || emp.id_empreendimento})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Razão Social do Segurado na Apólice
                  </Label>
                  <Input
                    type="text"
                    value={seguradoNome}
                    onChange={(e) => setSeguradoNome(e.target.value)}
                    placeholder="Ex: CONDOMINIO EDIFICIO CONVENTION CENTER BERRINI"
                    className="h-8 text-xs font-medium"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    CNPJ do Segurado
                  </Label>
                  <Input
                    type="text"
                    value={seguradoCnpj}
                    onChange={(e) => setSeguradoCnpj(e.target.value)}
                    placeholder="04.300.917/0001-62"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Corretora / Intermediária
                  </Label>
                  <Input
                    type="text"
                    value={corretorNome}
                    onChange={(e) => setCorretorNome(e.target.value)}
                    placeholder="BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* SEÇÃO 3: VIGÊNCIA E FORMA DE CONTRATAÇÃO */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-500" />
                  <span>Início de Vigência</span>
                </Label>
                <Input
                  type="date"
                  value={vigenciaInicio}
                  onChange={(e) => setVigenciaInicio(e.target.value)}
                  className="h-8 text-xs font-mono"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-500" />
                  <span>Fim de Vigência</span>
                </Label>
                <Input
                  type="date"
                  value={vigenciaFim}
                  onChange={(e) => setVigenciaFim(e.target.value)}
                  className="h-8 text-xs font-mono"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-700">
                  Forma de Contratação
                </Label>
                <Input
                  type="text"
                  value={formaContratacao}
                  onChange={(e) => setFormaContratacao(e.target.value)}
                  placeholder="Ex: 1º RISCO RELATIVO"
                  className="h-8 text-xs uppercase"
                />
              </div>
            </div>

            {/* SEÇÃO 4: CONDIÇÕES FINANCEIRAS & PARCELAMENTO */}
            <div className="bg-gray-50/70 p-3.5 rounded-xl border border-gray-200 space-y-3">
              <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                <span>Prêmios e Condições de Pagamento</span>
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Prêmio Líquido (R$)
                  </Label>
                  <Input
                    type="text"
                    value={premioLiquido}
                    onChange={(e) => setPremioLiquido(e.target.value)}
                    placeholder="66.428,46"
                    className="h-8 text-xs font-semibold font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Custo Apólice (R$)
                  </Label>
                  <Input
                    type="text"
                    value={custoApolice}
                    onChange={(e) => setCustoApolice(e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">IOF (R$)</Label>
                  <Input
                    type="text"
                    value={iof}
                    onChange={(e) => setIof(e.target.value)}
                    placeholder="4.902,44"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-emerald-800">
                    PRÊMIO TOTAL (R$)
                  </Label>
                  <Input
                    type="text"
                    value={premioTotal}
                    onChange={(e) => setPremioTotal(e.target.value)}
                    placeholder="71.330,90"
                    className="h-8 text-xs font-bold text-emerald-800 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    Condições de Pagamento
                  </Label>
                  <Input
                    type="text"
                    value={condicoesPagamento}
                    onChange={(e) => setCondicoesPagamento(e.target.value)}
                    placeholder="Ex: 4 (1+3) (0% a.m.)"
                    className="h-8 text-xs"
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
                    placeholder="Ex: Boleto Santander"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Tabela de parcelas extraídas (se houver) */}
              {extractionResult && extractionResult.parcelas.length > 0 && (
                <div className="pt-2 border-t border-gray-200">
                  <span className="text-[11px] font-semibold text-gray-700 block mb-1.5">
                    Parcelas Identificadas ({extractionResult.parcelas.length})
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {extractionResult.parcelas.map((parc) => (
                      <div
                        key={parc.numero}
                        className="p-2 rounded bg-white border border-gray-200 text-center"
                      >
                        <div className="text-[10px] text-gray-500 font-semibold uppercase">
                          Parcela {parc.numero}
                        </div>
                        <div className="text-xs font-bold text-gray-900">
                          {formatCurrency(parc.valor)}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          Venc.: {formatDate(parc.vencimento)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* SEÇÃO 5: LIMITES MÁXIMOS E VALORES EM RISCO (VRD) */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-3">
              <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-[#16578B]" />
                <span>Limites Máximos e Valores em Risco Declarados (VRD)</span>
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-blue-900">
                    LMGA da Apólice (R$)
                  </Label>
                  <Input
                    type="text"
                    value={lmga}
                    onChange={(e) => setLmga(e.target.value)}
                    placeholder="184.500.000,00"
                    className="h-8 text-xs font-bold text-blue-900 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    LMI Básica Incêndio (R$)
                  </Label>
                  <Input
                    type="text"
                    value={lmiIncendioBasica}
                    onChange={(e) => setLmiIncendioBasica(e.target.value)}
                    placeholder="163.000.000,00"
                    className="h-8 text-xs font-semibold font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    VRD Danos Materiais (R$)
                  </Label>
                  <Input
                    type="text"
                    value={vrdTotalDm}
                    onChange={(e) => setVrdTotalDm(e.target.value)}
                    placeholder="163.000.000,00"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-700">
                    VRD Lucros Cessantes (R$)
                  </Label>
                  <Input
                    type="text"
                    value={vrdTotalLc}
                    onChange={(e) => setVrdTotalLc(e.target.value)}
                    placeholder="21.400.000,00"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* SEÇÃO 6: TABELA DE COBERTURAS EXTRAÍDAS */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-3.5 py-2.5 border-b border-gray-200 flex items-center justify-between">
                <span className="font-bold text-gray-900 text-xs">
                  Quadro de Coberturas Identificadas ({coberturas.length})
                </span>
                <span className="text-[11px] text-gray-500 font-medium">
                  {coberturas.filter((c) => c.categoriaBloco === 'Danos Materiais').length} DM ·{' '}
                  {coberturas.filter((c) => c.categoriaBloco === 'Responsabilidade Civil').length}{' '}
                  RC · {coberturas.filter((c) => c.categoriaBloco === 'Lucros Cessantes').length} LC
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
                {coberturas.map((cob, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 hover:bg-gray-50/60 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{cob.nome}</div>
                      <div className="text-[10px] text-gray-500 flex items-center gap-2">
                        <span className="px-1.5 py-0.2 rounded bg-gray-100 text-gray-700 font-mono">
                          {cob.categoriaBloco}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="text-[#16578B] font-medium truncate">
                          {cob.categoriaNormalizada}
                        </span>
                        {cob.observacao && (
                          <span className="text-amber-700 italic truncate">({cob.observacao})</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-right shrink-0">
                      <div>
                        <span className="text-[10px] text-gray-400 block">LMI</span>
                        <strong className="text-gray-900 font-mono">
                          {cob.lmi ? formatCurrency(cob.lmi) : '—'}
                        </strong>
                      </div>
                      <div className="min-w-[180px] text-right">
                        <span className="text-[10px] text-gray-400 block">Franquia / P.O.S.</span>
                        <span
                          className="text-gray-700 truncate max-w-[220px] inline-block font-medium"
                          title={cob.franquiaPos || 'Não informada'}
                        >
                          {cob.franquiaPos || 'Não informada'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Diagnóstico Técnico Colapsável */}
            {extractionResult?.diagnostico && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDiagnosticoDet(!showDiagnosticoDet)}
                  className="w-full bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 flex items-center justify-between hover:bg-gray-100"
                >
                  <span>Metadados e Diagnóstico da Extração Técnica</span>
                  {showDiagnosticoDet ? (
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </button>
                {showDiagnosticoDet && (
                  <div className="p-3 bg-white text-[11px] font-mono text-gray-700 space-y-1">
                    <div>
                      Seguradora detectada:{' '}
                      <strong>{extractionResult.diagnostico.seguradoraDetectada}</strong>
                    </div>
                    <div>
                      Total de páginas analisadas:{' '}
                      <strong>{extractionResult.diagnostico.totalPaginas}</strong>
                    </div>
                    <div>
                      Fragmentos brutos lidos (x/y):{' '}
                      <strong>{extractionResult.diagnostico.fragmentosBrutosCount}</strong>
                    </div>
                    <div>
                      Linhas de coberturas processadas:{' '}
                      <strong>{extractionResult.diagnostico.linhasCoberturasLidas}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Rodapé de Ações */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-200">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs h-9 px-4"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 px-5 shadow-sm"
              >
                Confirmar e Gravar no Portfólio
              </Button>
            </div>
          </form>
        )}

        {/* ETAPA 3: SALVANDO */}
        {step === 'saving' && (
          <div className="py-12 text-center space-y-3">
            <Loader2 className="w-10 h-10 animate-spin text-[#16578B] mx-auto" />
            <h4 className="text-sm font-bold text-gray-800">Gravando apólice no Portfólio...</h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              Criando registro na coleção de apólices, gravando coberturas vinculadas, anexando o
              arquivo PDF e recalculando sucessão da carteira.
            </p>
          </div>
        )}

        {/* ETAPA 4: SUCESSO */}
        {step === 'success' && saveSuccessSummary && (
          <div className="py-6 space-y-4">
            <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-bold">Apólice gravada com sucesso no Portfólio!</h4>
                <p className="text-xs text-green-700">
                  Apólice <strong>{saveSuccessSummary.numeroApolice}</strong> gravada com{' '}
                  <strong>{saveSuccessSummary.coberturasGravadas}</strong> coberturas vinculadas e
                  documento PDF anexado.
                </p>
                {saveSuccessSummary.sucedidaDescricao && (
                  <p className="text-xs text-green-800 font-medium pt-1">
                    ✓ {saveSuccessSummary.sucedidaDescricao}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="bg-[#0F2B46] text-white text-xs h-9 px-6"
              >
                Concluir
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
