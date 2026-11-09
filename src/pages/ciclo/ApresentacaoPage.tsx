import React, { useState, useEffect, useMemo } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  Printer,
  Download,
  Building,
  Shield,
  Layers,
  Sparkles,
  Trophy,
  XCircle,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, formatNumber, formatCnpj } from '@/lib/formatters'
import { generatePresentationPptx } from '@/services/pptxExportService'
import {
  generateEstudoMercadoPptx,
  EstudoMercadoEditavelData,
} from '@/services/pptxEstudoMercadoService'
import { SecaoEstudoMercado, EstudoMercadoFormState } from '@/components/SecaoEstudoMercado'
import {
  listarTaxonomiaCanonicas,
  listarSinonimos,
  CoberturaCanonicaRecord,
  CoberturaSinonimoRecord,
} from '@/services/equivalenciaCoberturasService'
import {
  PropostaInputEstudo,
  extrairParcelamentoECondicoes,
  calcularTotaisVrdEstudo,
} from '@/services/estudoMercadoResolver'
import { toast } from '@/hooks/use-toast'
import { usePedidoEmissao } from '@/hooks/usePedidoEmissao'
import PedidoEmissaoDocumento from '@/components/PedidoEmissaoDocumento'
import { montarDadosPedidoEmissao } from '@/services/pedidoEmissaoService'

interface EmpreendimentoOpt {
  id: string
  nome_empreendimento: string
  razao_social: string
  cnpj?: string
  cossegurado_nome?: string
  cossegurado_cnpj?: string
  endereco?: string
  cidade: string
  uf: string
  atividade?: string
  atividade_exercida?: string
  ano_construcao?: number
  area_construida_m2?: number
  tipo_construcao?: string
  num_andares?: number
  num_unidades?: number
  num_elevadores?: number
  vagas_estacionamento?: number
  prot_extintores?: boolean
  prot_hidrantes?: boolean
  prot_sprinklers?: boolean
  prot_detector_fumaca?: boolean
  prot_alarme_incendio?: boolean
  prot_brigada_incendio?: boolean
  prot_pararraios?: boolean
  prot_cftv?: boolean
  prot_cameras_seguranca?: boolean
  prot_cofres?: boolean
  prot_alarme_roubo?: boolean
  prot_controle_entrada?: boolean
  prot_vigilancia?: boolean
  sinistros_ultimos_5anos?: string
  detalhe_sinistros?: string
  faturamento_12m_rs: number
}

interface PropostaOption {
  id: string
  rfq?: string
  seguradora: string
  opcao?: number
  versao?: number
  ativa?: boolean
  proposta_vencedora?: boolean
  premio_bruto: number
  premio_liquido?: number
  comissao_trabalhada?: number
  lmi_lmg: number
  coberturas: any[]
  status?: string
  data_proposta?: string
  vigencia_inicio?: string
  vigencia_fim?: string
  arquivo?: string
  arquivo_nome?: string
  expand?: {
    seguradora?: { id?: string; nome: string }
    rfq?: {
      id?: string
      conta_empreendimento?: string
      expand?: {
        conta_empreendimento?: EmpreendimentoOpt
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

const MESES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

function formatDataBrPonto(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

// Vigência a partir da proposta/rodada selecionada (ex.: "01.11.2026 a 01.11.2027 (365 dias)")
function montarVigenciaTexto(inicio?: string, fim?: string): string {
  const i = formatDataBrPonto(inicio)
  const f = formatDataBrPonto(fim)
  if (!i && !f) return ''
  if (i && f && inicio && fim) {
    const dias = Math.max(
      0,
      Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 86400000),
    )
    return `${i} a ${f} (${dias} dias)`
  }
  return i || f
}

// Versão a partir da proposta selecionada (ex.: "Outubro/2026 - V2")
function montarVersaoTexto(prop?: PropostaOption): string {
  if (!prop) return ''
  const partes: string[] = []
  if (prop.data_proposta) {
    const d = new Date(prop.data_proposta)
    if (!isNaN(d.getTime())) partes.push(`${MESES_PT[d.getMonth()]}/${d.getFullYear()}`)
  }
  partes.push(`V${Number(prop.versao || 1)}`)
  return partes.join(' - ')
}

// Construção a partir do cadastro real do empreendimento selecionado
function montarConstrucaoTexto(emp?: EmpreendimentoOpt): string {
  if (!emp) return ''
  const partes: string[] = []
  if (emp.tipo_construcao) partes.push(`Tipo ${emp.tipo_construcao}`)
  if (emp.area_construida_m2) partes.push(`${formatNumber(emp.area_construida_m2)}m²`)
  if (emp.num_andares) partes.push(`${emp.num_andares} andares`)
  if (emp.num_unidades) partes.push(`${emp.num_unidades} unidades`)
  if (emp.ano_construcao) partes.push(`construção em ${emp.ano_construcao}`)
  if (emp.vagas_estacionamento) partes.push(`estacionamento ${emp.vagas_estacionamento} vagas`)
  if (emp.num_elevadores) partes.push(`${emp.num_elevadores} elevadores`)
  return partes.join('; ')
}

// Proteções a partir do cadastro real do empreendimento selecionado
function montarProtecoesTexto(emp?: EmpreendimentoOpt): string {
  if (!emp) return ''
  const incendio: string[] = []
  if (emp.prot_extintores) incendio.push('Extintores')
  if (emp.prot_hidrantes) incendio.push('Hidrantes')
  if (emp.prot_sprinklers) incendio.push('Sprinklers')
  if (emp.prot_detector_fumaca) incendio.push('Detectores de Fumaça')
  if (emp.prot_alarme_incendio) incendio.push('Alarme de Incêndio')
  if (emp.prot_brigada_incendio) incendio.push('Brigada de Incêndio')
  if (emp.prot_pararraios) incendio.push('SPDA (Pararraios)')
  const roubo: string[] = []
  if (emp.prot_cftv || emp.prot_cameras_seguranca) roubo.push('CFTV')
  if (emp.prot_cofres) roubo.push('Cofres')
  if (emp.prot_alarme_roubo) roubo.push('Alarme de Roubo')
  if (emp.prot_controle_entrada) roubo.push('Controle de Entrada')
  if (emp.prot_vigilancia) roubo.push('Vigilância')
  const linhas: string[] = []
  if (incendio.length > 0) linhas.push(`Incêndio: ${incendio.join(', ')}.`)
  if (roubo.length > 0) linhas.push(`Roubo: ${roubo.join(', ')}.`)
  return linhas.join('\n')
}

// Sinistros a partir do cadastro real do empreendimento selecionado
function montarSinistrosTexto(emp?: EmpreendimentoOpt): string {
  if (!emp) return ''
  const base = emp.sinistros_ultimos_5anos?.trim() || ''
  const detalhe = emp.detalhe_sinistros?.trim() || ''
  if (!base && !detalhe) return ''
  if (base && detalhe) return `${base} — ${detalhe}`
  return base || detalhe
}

// Cossegurado na contratação a partir do cadastro do empreendimento selecionado
function montarCosseguradoContratacao(emp?: EmpreendimentoOpt): string {
  if (!emp?.cossegurado_nome) return ''
  const cnpj = emp.cossegurado_cnpj ? formatCnpj(emp.cossegurado_cnpj) : ''
  return cnpj ? `${emp.cossegurado_nome} - ${cnpj}` : emp.cossegurado_nome
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
  const [exportingPptx, setExportingPptx] = useState(false)
  const [exportingEstudoPptx, setExportingEstudoPptx] = useState(false)
  const [marcandoVencedora, setMarcandoVencedora] = useState(false)
  const [mostrarPedidoEmissao, setMostrarPedidoEmissao] = useState(false)
  const [carregandoEmps, setCarregandoEmps] = useState(false)

  // Equivalências para resolução fiel da taxonomia canônica (C3)
  const [canonicasC3, setCanonicasC3] = useState<CoberturaCanonicaRecord[]>([])
  const [sinonimosC3, setSinonimosC3] = useState<CoberturaSinonimoRecord[]>([])

  // Formulário editável do Estudo de Mercado Bycor (Blocos 04 e 11)
  const [estudoForm, setEstudoForm] = useState<EstudoMercadoFormState>({
    objetivoTexto:
      'Estudo de transição, para proteção patrimonial do Condomínio São International Square e BT São Caetano Hotéis Ltda para vigência de 01/11/2026 a 01/11/2027. Comparativo baseado nas características do empreendimento, coberturas da apólice anterior, know-how Bycor (Hotéis e Resorts) e propostas das seguradoras.',
    objetivoImportanteTexto:
      'Os valores de LMI (Limite Máximo de Indenização) por cobertura assim como LMGA (Limite Máximo de Garantia Agregada) para coberturas de RC são estimativos e, devem ser avaliados pelo contratante/segurado que é o legítimo conhecedor do valor em risco. O valor das coberturas são de inteira responsabilidade do Segurado. Por conta da transição sugerimos que após a implantação do Blue Tree seja feita reavaliação dos valores para adequar as proteções.',
    contatoInspecaoNome: '',
    contatoInspecaoTel: '',
    contatoInspecaoEmail: '',
    cosseguradoContratacao: '',
    sugestaoCustosDefesa: 'R$ 100.000,00',
    observacoesContratacao: 'A seguradora terá prazo de até 25 dias para avaliação do risco',
    assinaturaCargo: 'Síndico / Responsável Legal',
    dataApresentacaoTexto: '28/10/2026',
  })

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
            expand: 'seguradora,rfq,rfq.conta_empreendimento',
          }),
        ])
        setEmpreendimentos(emps)
        setPropostas(props)

        // Carrega equivalências C3
        try {
          const [cans, sins] = await Promise.all([listarTaxonomiaCanonicas(), listarSinonimos()])
          setCanonicasC3(cans)
          setSinonimosC3(sins)
        } catch (eqErr) {
          console.warn('Aviso: falha ao carregar taxonomia C3:', eqErr)
        }
        if (props.length > 0) {
          const vencedora = props.find((p: any) => p.proposta_vencedora)
          const inicialProp =
            vencedora || props.find((p: any) => p.status === 'Selecionada') || props[0]
          setSelectedPropId(inicialProp.id)

          // Inicializa o dropdown de empreendimento com o empreendimento do RFQ da proposta inicial
          const rfq = inicialProp.expand?.rfq
          const empDoRfqId = rfq?.conta_empreendimento || rfq?.expand?.conta_empreendimento?.id
          if (empDoRfqId && emps.some((e) => e.id === empDoRfqId)) {
            setSelectedEmpId(empDoRfqId)
          } else if (emps.length > 0) {
            setSelectedEmpId(emps[0].id)
          }
        } else if (emps.length > 0) {
          setSelectedEmpId(emps[0].id)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchInit()
  }, [])

  // Sincroniza o dropdown de Empreendimento quando o usuário troca a Proposta selecionada.
  // Se a proposta tiver RFQ associado com conta_empreendimento, o dropdown muda para esse empreendimento.
  useEffect(() => {
    if (!selectedPropId || propostas.length === 0) return
    const prop = propostas.find((p) => p.id === selectedPropId)
    const rfq = prop?.expand?.rfq
    const empId = rfq?.conta_empreendimento || rfq?.expand?.conta_empreendimento?.id
    if (empId && empreendimentos.some((e) => e.id === empId)) {
      setSelectedEmpId(empId)
    }
  }, [selectedPropId, propostas, empreendimentos])

  // Fonte da verdade do empreendimento: o dropdown "Selecione o Cliente / Empreendimento" (selectedEmpId).
  // Alimenta a Minuta A4, a Minuta Executiva PPTX, o Estudo de Mercado F1 e o perfil em tela.
  const selectedEmp = useMemo(() => {
    if (selectedEmpId) {
      const match = empreendimentos.find((e) => e.id === selectedEmpId)
      if (match) return match
    }
    return empreendimentos[0]
  }, [empreendimentos, selectedEmpId])

  // Todas as propostas da seguradora da proposta selecionada (para seletor de versões)
  const selectedProp = propostas.find((p) => p.id === selectedPropId)

  // Ao trocar a proposta selecionada, atualiza as observações de contratação com a condição de pagamento
  // real da proposta (ex.: parcelamento com juros), preservando texto editado se compatível.
  useEffect(() => {
    if (!selectedProp) return
    const forma = (selectedProp as any).forma_pagamento
    const numP = (selectedProp as any).numero_parcelas
    const { condicoesPagamentoTexto } = extrairParcelamentoECondicoes(forma, numP)

    setEstudoForm((prev) => {
      // Se há condição de pagamento real e observações atuais são a padrão ou vazias,
      // compõe a observação incluindo as condições de pagamento da proposta selecionada.
      const basePadrao = 'A seguradora terá prazo de até 25 dias para avaliação do risco'
      let novaObs = prev.observacoesContratacao
      if (condicoesPagamentoTexto) {
        if (!novaObs || novaObs === basePadrao || novaObs.startsWith('Condições de pagamento:')) {
          novaObs = `Condições de pagamento: ${condicoesPagamentoTexto}. ${basePadrao}.`
        }
      } else if (novaObs.startsWith('Condições de pagamento:')) {
        novaObs = basePadrao
      }
      return {
        ...prev,
        observacoesContratacao: novaObs,
      }
    })
  }, [
    selectedProp?.id,
    (selectedProp as any)?.forma_pagamento,
    (selectedProp as any)?.numero_parcelas,
  ])

  // Ao trocar o empreendimento selecionado, limpa os campos editáveis de Bloco 11
  // dependentes do risco — nunca carregar dados de outro empreendimento;
  // o cossegurado é reposto a partir do cadastro real, quando houver.
  useEffect(() => {
    setEstudoForm((prev) => ({
      ...prev,
      contatoInspecaoNome: '',
      contatoInspecaoTel: '',
      contatoInspecaoEmail: '',
      cosseguradoContratacao: montarCosseguradoContratacao(selectedEmp),
      objetivoTexto: selectedEmp?.nome_empreendimento
        ? `Estudo de transição, para proteção patrimonial de ${selectedEmp.nome_empreendimento}${
            selectedEmp.cossegurado_nome ? ` e ${selectedEmp.cossegurado_nome}` : ''
          } para vigência de 01/11/2026 a 01/11/2027. Comparativo baseado nas características do empreendimento, coberturas da apólice anterior, know-how Bycor (Hotéis e Resorts) e propostas das seguradoras.`
        : prev.objetivoTexto,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmp?.id])

  // Agrupa todas as propostas por CIA + OPÇÃO. Cada opção tem sua versão ativa própria.
  // propostasExibicao apresenta cada opção com sua versão ativa para o usuário escolher como oferta
  const propostasExibicao = React.useMemo(() => {
    const map = new Map<string, PropostaOption[]>()
    propostas.forEach((p) => {
      const op = Number(p.opcao || 1)
      const chave = `${p.seguradora}__op__${op}`
      const list = map.get(chave) || []
      list.push(p)
      map.set(chave, list)
    })
    const result: PropostaOption[] = []
    map.forEach((pList) => {
      const ativa = pList.find((p) => p.ativa)
      if (ativa) {
        result.push(ativa)
      } else if (pList.length > 0) {
        const sorted = [...pList].sort((a, b) => Number(b.versao || 1) - Number(a.versao || 1))
        result.push(sorted[0])
      }
    })
    result.sort((a, b) => {
      const nomeA = a.expand?.seguradora?.nome || ''
      const nomeB = b.expand?.seguradora?.nome || ''
      if (nomeA !== nomeB) return nomeA.localeCompare(nomeB)
      return Number(a.opcao || 1) - Number(b.opcao || 1)
    })
    return result.length > 0 ? result : propostas
  }, [propostas])

  // Seletor de versão para a MESMA OPÇÃO da seguradora atualmente selecionada
  // (a versão ativa é por opção, trocar versão aqui atua dentro desta opção)
  const versoesDaMesmaOpcao = propostas.filter(
    (p) =>
      selectedProp &&
      p.seguradora === selectedProp.seguradora &&
      Number(p.opcao || 1) === Number(selectedProp.opcao || 1),
  )

  const handlePrint = () => {
    window.print()
  }

  // ------- Proposta Vencedora (Opção escolhida pelo cliente) -------
  const isVencedoraSelecionada = Boolean(selectedProp?.proposta_vencedora)
  const { pedido: pedidoEmissaoRec, loading: loadingPedidoEmissao } = usePedidoEmissao(
    isVencedoraSelecionada ? selectedPropId : undefined,
  )

  const carregarEmpreendimentoDaProposta = async (
    prop: PropostaOption,
  ): Promise<EmpreendimentoOpt | undefined> => {
    try {
      const rfqId = prop.rfq || prop.expand?.rfq?.conta_empreendimento
      if (!rfqId) return selectedEmp
      const rfqRec: any = await pb.collection('rfq').getOne(rfqId, {
        expand: 'conta_empreendimento',
      })
      const emp = rfqRec?.expand?.conta_empreendimento
      if (emp) return emp as EmpreendimentoOpt
    } catch {
      // ignora — usa o empreendimento selecionado na tela como fallback
    }
    return selectedEmp
  }

  const handleMarcarVencedora = async () => {
    if (!selectedProp || marcandoVencedora) return
    setMarcandoVencedora(true)
    try {
      const rfqId = selectedProp.rfq
      if (rfqId) {
        const irmaos = await pb.collection('propostas').getFullList<any>({
          filter: `rfq = "${rfqId}"`,
        })
        for (const irmao of irmaos) {
          if (irmao.proposta_vencedora) {
            await pb.collection('propostas').update(irmao.id, { proposta_vencedora: false })
          }
        }
      }
      await pb.collection('propostas').update(selectedProp.id, { proposta_vencedora: true })
      setPropostas((prev) =>
        prev.map((p) => ({ ...p, proposta_vencedora: p.id === selectedProp.id })),
      )
      toast({
        title: 'Proposta Vencedora marcada',
        description: `${selectedProp.expand?.seguradora?.nome || 'Seguradora'} — Opção ${
          selectedProp.opcao || 1
        } (v${selectedProp.versao || 1}) é a escolha do cliente neste RFQ.`,
      })
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao marcar vencedora',
        description: err?.message || 'Não foi possível marcar a proposta vencedora.',
        variant: 'destructive',
      })
    } finally {
      setMarcandoVencedora(false)
    }
  }

  const handleDesmarcarVencedora = async () => {
    if (!selectedProp || marcandoVencedora) return
    setMarcandoVencedora(true)
    try {
      await pb.collection('propostas').update(selectedProp.id, { proposta_vencedora: false })
      setPropostas((prev) =>
        prev.map((p) => (p.id === selectedProp.id ? { ...p, proposta_vencedora: false } : p)),
      )
      toast({ title: 'Marcação de vencedora removida' })
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao desmarcar vencedora',
        description: err?.message || 'Não foi possível desmarcar a proposta vencedora.',
        variant: 'destructive',
      })
    } finally {
      setMarcandoVencedora(false)
    }
  }

  const dadosPedidoEmissao = useMemo(async () => {
    if (!selectedProp) return null
    const emp = await carregarEmpreendimentoDaProposta(selectedProp)
    return montarDadosPedidoEmissao(selectedProp as any, emp as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProp?.id, selectedEmp?.id])
  const [dadosPedido, setDadosPedido] = useState<Awaited<
    ReturnType<typeof montarDadosPedidoEmissao>
  > | null>(null)
  useEffect(() => {
    let cancelled = false
    dadosPedidoEmissao.then((d) => {
      if (!cancelled) setDadosPedido(d)
    })
    return () => {
      cancelled = true
    }
  }, [dadosPedidoEmissao])

  // Prepara lista de propostas ativas comparadas na mesa (todas as cias/opções ativas)
  const propostasParaEstudo: PropostaInputEstudo[] = React.useMemo(() => {
    return propostasExibicao.map((p) => {
      const segNome = p.expand?.seguradora?.nome || 'Seguradora'
      const opNum = Number(p.opcao || 1)
      const numParcRaw = (p as any).numero_parcelas
      const formaPagRaw = (p as any).forma_pagamento

      const { parcelamentoSemJurosTexto, condicoesPagamentoTexto, numeroParcelasSemJuros } =
        extrairParcelamentoECondicoes(formaPagRaw, numParcRaw)

      return {
        id: p.id,
        seguradoraNome: segNome,
        opcao: opNum,
        versao: Number(p.versao || 1),
        ativa: p.ativa,
        propostaVencedora: Boolean(p.proposta_vencedora),
        premioTotalComIof: Number(p.premio_bruto || 0),
        premioLiquido: Number((p as any).premio_liquido || 0),
        parcelamentoSemJurosTexto,
        numeroParcelasSemJuros,
        condicoesPagamentoTexto,
        numeroCoberturas: (p.coberturas || []).length || 42,
        vrdDm: Number((p as any).vrd_dm || 80000000),
        vrdLc: Number((p as any).vrd_lc || 15000000),
        coberturasOriginais: p.coberturas || [],
      }
    })
  }, [propostasExibicao])

  // Exportador do Estudo de Mercado F1 (12 páginas fiéis ao PDF oficial)
  const handleExportEstudoMercadoPptx = async () => {
    if (exportingEstudoPptx) return
    setExportingEstudoPptx(true)
    try {
      const emp = selectedEmp
      const prop = selectedProp

      const ciasComProposta = Array.from(
        new Set(propostasParaEstudo.map((p) => p.seguradoraNome.toUpperCase())),
      )

      const vrdPredioRaw = Number((prop as any)?.vrd_dm) || undefined
      const vrdMmuRaw = Number((prop as any)?.vrd_mmu) || undefined
      const vrdMmpRaw = Number((prop as any)?.vrd_mmp) || undefined
      const vrdLcRaw = Number((prop as any)?.vrd_lc) || undefined

      // Racional C4 de Danos Materiais e LMGA:
      // - Total DM = Prédio + MMU/MMP (somados quando ambos existirem)
      // - Sem MMU/MMP = Total DM é o valor de Prédio sozinho
      // - LMGA (Total DM + LC) = Total DM + LC (apenas quando houver valor de LC)
      const totaisVrd = calcularTotaisVrdEstudo({
        vrdPredio: vrdPredioRaw,
        vrdMmu: vrdMmuRaw,
        vrdMmp: vrdMmpRaw,
        vrdLc: vrdLcRaw,
      })

      // Perfil do empreendimento SELECIONADO: todos os campos vêm do cadastro real
      // (empreendimentos) e da proposta/rodada. Onde não há dado, fica vazio ('—' no
      // PPTX) para o analista preencher — nunca dados de outro empreendimento.
      // Deriva o nome limpo do segurado principal para a capa e relatórios
      // Se nome_empreendimento contiver sufixo de CNPJ (ex: "Condomínio São International Square - 24.742.208/0002-25"),
      // extrai o nome sem o CNPJ; caso contrário utiliza razao_social ou nome_empreendimento.
      const seguradoPrincipalDerivado = (() => {
        const rawNome = emp?.razao_social || emp?.nome_empreendimento || ''
        const semCnpj = rawNome.replace(/\s*[-–]\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*$/, '').trim()
        return semCnpj || rawNome || 'Segurado Principal'
      })()

      const estudoData: EstudoMercadoEditavelData = {
        empreendimentoNome: emp?.nome_empreendimento || '',
        seguradoPrincipalNome: seguradoPrincipalDerivado,
        cosseguradoNome: emp?.cossegurado_nome || undefined,
        vigenciaTexto: montarVigenciaTexto(prop?.vigencia_inicio, prop?.vigencia_fim),
        versaoTexto: montarVersaoTexto(prop),
        enderecoTexto: emp?.endereco || '',
        objetivoTexto: estudoForm.objetivoTexto,
        objetivoImportanteTexto: estudoForm.objetivoImportanteTexto,
        cnpj: emp?.cnpj || undefined,
        cosseguradoCnpj: emp?.cossegurado_cnpj || undefined,
        tipoSeguro: 'Patrimonial',
        coberturaResumo: 'Prédio, Conteúdo (MMU/MMP) e Lucros Cessantes (L.Bruto)',
        cnaeAtividade: emp?.atividade || emp?.atividade_exercida || undefined,
        construcaoTexto: montarConstrucaoTexto(emp),
        protecionaisTexto: montarProtecoesTexto(emp),
        sinistrosTexto: montarSinistrosTexto(emp),
        vrdPredio: totaisVrd.vrdPredio,
        vrdMmu: totaisVrd.vrdMmu,
        vrdMmp: totaisVrd.vrdMmp,
        vrdDmTotal: totaisVrd.vrdDmTotal,
        vrdLcAnual: totaisVrd.vrdLcAnual,
        vrdDmPlusLc: totaisVrd.vrdDmPlusLc,
        ciasApresentaramProposta: ciasComProposta,
        ciasEmAnaliseOuNaoApresentaram: [],
        propostas: propostasParaEstudo,
        canonicasC3,
        sinonimosC3,
        contatoInspecaoNome: estudoForm.contatoInspecaoNome,
        contatoInspecaoTel: estudoForm.contatoInspecaoTel,
        contatoInspecaoEmail: estudoForm.contatoInspecaoEmail,
        cosseguradoContratacao: estudoForm.cosseguradoContratacao,
        sugestaoCustosDefesa: estudoForm.sugestaoCustosDefesa,
        observacoesContratacao: estudoForm.observacoesContratacao,
        dataApresentacaoTexto: estudoForm.dataApresentacaoTexto,
        assinaturaCargo: estudoForm.assinaturaCargo,
      }

      const pptxBytes = await generateEstudoMercadoPptx(estudoData)

      const blob = new Blob([pptxBytes as Uint8Array<ArrayBuffer>], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Estudo_de_Mercado_Bycor_${emp?.nome_empreendimento?.replace(/\s+/g, '_') || 'Patrimonial'}.pptx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      toast({
        title: 'Estudo de Mercado F1 exportado com sucesso!',
        description: 'Arquivo PPTX com as 12 páginas em formato 100% editável para PowerPoint.',
      })
    } catch (err: any) {
      console.error('Erro ao gerar Estudo de Mercado PPTX:', err)
      toast({
        title: 'Erro ao gerar Estudo de Mercado',
        description: err?.message || 'Ocorreu uma falha na geração do arquivo PPTX.',
        variant: 'destructive',
      })
    } finally {
      setExportingEstudoPptx(false)
    }
  }

  // Generates a fully valid OpenXML PresentationML (.pptx) file via PptxGenJS
  const handleExportPptx = async () => {
    if (exportingPptx) return
    setExportingPptx(true)
    try {
      const coberturas = (selectedProp?.coberturas || []).map((c: any) => ({
        nome: getCoverageName(c),
        lmi: getCoverageLmi(c),
        franquia: getCoverageFranquia(c),
      }))

      const opNum = Number(selectedProp?.opcao || 1)
      const vNum = Number(selectedProp?.versao || 1)
      const segNomeComOpcaoEVersao = selectedProp?.expand?.seguradora?.nome
        ? `${selectedProp.expand.seguradora.nome} — Opção ${opNum} (v${vNum})`
        : 'Seguradora Selecionada'

      const pptxBytes = await generatePresentationPptx({
        clienteNome: selectedEmp?.nome_empreendimento || 'Cliente Corporativo',
        razaoSocial: selectedEmp?.razao_social,
        cidade: selectedEmp?.cidade,
        uf: selectedEmp?.uf,
        areaConstruida: selectedEmp?.area_construida_m2,
        seguradoraNome: segNomeComOpcaoEVersao,
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

      toast({
        title: 'Apresentação PPTX gerada com sucesso',
        description: 'Arquivo compatível com Microsoft PowerPoint (Mac/Windows).',
      })
    } catch (err: any) {
      console.error('Erro ao gerar PPTX:', err)
      toast({
        title: 'Erro ao gerar apresentação PPTX',
        description: err?.message || 'Ocorreu uma falha na geração do arquivo. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setExportingPptx(false)
    }
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
            disabled={exportingPptx}
            variant="outline"
            className="border-gray-300 text-gray-700 text-xs h-9 font-medium flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-gray-400" />
            <span>{exportingPptx ? 'Gerando Minuta...' : 'Minuta Executiva PPTX'}</span>
          </Button>
        </div>
      </div>

      {/* Seção Estudo de Mercado F1 (Campos Editáveis & Pré-visualização) */}
      <SecaoEstudoMercado
        formState={estudoForm}
        onChangeFormState={(field, val) => setEstudoForm((p) => ({ ...p, [field]: val }))}
        onExportarPptx={handleExportEstudoMercadoPptx}
        isExporting={exportingEstudoPptx}
        empreendimentoNome={selectedEmp?.nome_empreendimento || 'Empreendimento Selecionado'}
        propostasComparadas={propostasParaEstudo}
      />

      {/* Barra da Proposta Vencedora (C4 pós-apresentação) */}
      <div className="bg-white rounded-xl border-2 border-amber-300 p-4 shadow-sm print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
              Proposta Vencedora — Opção escolhida pelo cliente
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedProp && (
              <Button
                onClick={isVencedoraSelecionada ? handleDesmarcarVencedora : handleMarcarVencedora}
                disabled={marcandoVencedora || !selectedProp}
                variant={isVencedoraSelecionada ? 'outline' : 'default'}
                className={
                  isVencedoraSelecionada
                    ? 'h-8 text-xs border-gray-300 text-gray-600'
                    : 'h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white font-bold'
                }
              >
                {marcandoVencedora ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </span>
                ) : isVencedoraSelecionada ? (
                  <>
                    <XCircle className="w-3.5 h-3.5 mr-1.5" /> Desmarcar vencedora
                  </>
                ) : (
                  <>
                    <Trophy className="w-3.5 h-3.5 mr-1.5" /> Marcar esta como Vencedora
                  </>
                )}
              </Button>
            )}
            {isVencedoraSelecionada && (
              <Button
                onClick={() => setMostrarPedidoEmissao((v) => !v)}
                className="h-8 text-xs bg-[#16578B] hover:bg-[#0F2B46] text-white font-bold"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                {mostrarPedidoEmissao
                  ? 'Ocultar Pedido de Emissão'
                  : pedidoEmissaoRec
                    ? 'Abrir Pedido de Emissão'
                    : 'Gerar Pedido de Emissão'}
              </Button>
            )}
          </div>
        </div>
        {isVencedoraSelecionada && selectedProp && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50/70 border border-amber-200 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-gray-800">
              <strong className="text-amber-700">★ Proposta Vencedora:</strong>{' '}
              {selectedProp.expand?.seguradora?.nome || 'Seguradora'} — Opção{' '}
              {selectedProp.opcao || 1} (v{selectedProp.versao || 1}) —{' '}
              {formatCurrency(selectedProp.premio_bruto)}
            </div>
            <div className="text-[11px] text-gray-500">
              {loadingPedidoEmissao
                ? 'Carregando Pedido de Emissão...'
                : pedidoEmissaoRec
                  ? 'Pedido de Emissão já gerado — consultável e editável abaixo.'
                  : 'Pedido de Emissão ainda não gerado para esta vencedora.'}
            </div>
          </div>
        )}
      </div>

      {/* Documento do Pedido de Emissão (editável) */}
      {isVencedoraSelecionada && mostrarPedidoEmissao && dadosPedido && (
        <PedidoEmissaoDocumento
          dados={dadosPedido}
          pedidoExistente={pedidoEmissaoRec}
          onSalvo={() => window.location.reload()}
          onFechar={() => setMostrarPedidoEmissao(false)}
        />
      )}

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
              Oferta / Proposta Selecionada (por Cia + Opção):
            </label>
            {selectedProp && (
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-[#16578B] border border-blue-200">
                Opção {selectedProp.opcao || 1} · v{selectedProp.versao || 1}{' '}
                {selectedProp.ativa ? '● ativa' : ''}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={selectedPropId}
              onChange={(e) => setSelectedPropId(e.target.value)}
              className="flex-1 h-9 text-xs border border-gray-300 rounded px-2 bg-white font-medium"
            >
              {propostasExibicao.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.expand?.seguradora?.nome || 'Seguradora'} — Opção {prop.opcao || 1} (v
                  {prop.versao || 1}) — {formatCurrency(prop.premio_bruto)}
                  {prop.status === 'Selecionada' ? ' [Selecionada em C3]' : ''}
                </option>
              ))}
            </select>

            {/* Seletor de versão ativa dentro DESTA MESMA OPÇÃO */}
            {versoesDaMesmaOpcao.length > 1 && (
              <select
                value={selectedPropId}
                onChange={(e) => setSelectedPropId(e.target.value)}
                className="w-36 h-9 text-xs border border-blue-300 bg-blue-50/60 rounded px-2 text-[#16578B] font-bold"
                title="Trocar versão ativa dentro da Opção selecionada"
              >
                {versoesDaMesmaOpcao.map((v) => (
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
                <span className="text-blue-600 font-medium">Oferta Recomendada</span>
                {selectedProp && (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-[#16578B] border border-blue-200">
                    Opção {selectedProp.opcao || 1} · v{selectedProp.versao || 1}
                  </span>
                )}
              </div>
              <strong className="text-base text-[#0F2B46] block mt-1">
                {selectedProp?.expand?.seguradora?.nome || 'Seguradora Selecionada'} — Opção{' '}
                {selectedProp?.opcao || 1}
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
