/**
 * Gerador profissional de PPTX editável do Estudo de Mercado Bycor (12 slides fiéis ao PDF).
 * Utiliza PptxGenJS (OpenXML nativo em conformidade com Microsoft PowerPoint).
 */
import pptxgen from 'pptxgenjs'
import { COBERTURAS_ESTUDO_42 } from './estudoMercadoCanonicas'
import {
  PropostaInputEstudo,
  resolverGradeEstudo42,
  LinhaComparativaEstudo,
  formatLmiEstudo,
  calcularTotaisVrdEstudo,
} from './estudoMercadoResolver'
import { CoberturaCanonicaRecord, CoberturaSinonimoRecord } from './equivalenciaCoberturasService'
import { LOGO_BYCOR_PATH, isLogoMediaAvailable } from '@/assets/logoBycorBase64'

export interface EstudoMercadoEditavelData {
  // Dados Gerais do Cabeçalho / Capa
  empreendimentoNome: string
  cosseguradoNome?: string
  vigenciaTexto: string // ex: "01.11.2026 a 01.11. 2027 (365 dias)"
  versaoTexto: string // ex: "Outubro/2026 - V2"
  enderecoTexto: string // ex: "Al. Terracota, 250 • Ceramica • São Caetano do Sul • Cep 09531-190"

  // Bloco 4 (Editável): Objetivo
  objetivoTexto: string
  objetivoImportanteTexto: string

  // Bloco 5: Dados do Segurado e Risco
  cnpj?: string
  cosseguradoCnpj?: string
  tipoSeguro?: string
  coberturaResumo?: string
  statusSeguro?: string // "NOVO" ou "RENOVAÇÃO"
  cnaeAtividade?: string
  construcaoTexto?: string
  protecionaisTexto?: string
  sinistrosTexto?: string
  vrdPredio?: number
  vrdMmu?: number
  vrdMmp?: number
  vrdDmTotal?: number
  vrdLcAnual?: number
  vrdDmPlusLc?: number

  // Bloco 7: Cias Consultadas
  ciasApresentaramProposta: string[]
  ciasEmAnaliseOuNaoApresentaram: string[]

  // Bloco 8, 9, 10, 11: Propostas e Matriz Comparativa
  propostas: PropostaInputEstudo[]
  canonicasC3?: CoberturaCanonicaRecord[]
  sinonimosC3?: CoberturaSinonimoRecord[]

  // Bloco 11 (Editável): Opções de Contratação
  contatoInspecaoNome?: string
  contatoInspecaoTel?: string
  contatoInspecaoEmail?: string
  cosseguradoContratacao?: string
  sugestaoCustosDefesa?: string
  observacoesContratacao?: string
  dataApresentacaoTexto?: string
  assinaturaNome?: string
  assinaturaCargo?: string
}

// Paleta de Cores do Estudo Real Bycor
const C_NAVY = '0F2B46'
const C_BLUE = '16578B'
const C_LIGHT_BLUE = '2563EB'
const C_MUTED = '64748B'
const C_BG_CARD = 'F8FAFC'
const C_BORDER = 'CBD5E1'
const C_TEXT = '1E293B'
const C_WHITE = 'FFFFFF'
const C_GREEN = '15803D'
const C_GOLD = 'D97706'
const C_GOLD_BG = 'FEF3C7'
const C_GOLD_BORDER = 'F59E0B'
const C_ZEBRA = 'F8FAFC'
const C_ZEBRA_ROW = 'F8FAFC'
const C_VENCEDORA_BG = 'DCFCE7'
const C_VENCEDORA_TEXT = '15803D'

// Grid global de margens e alinhamentos
const GRID = {
  marginLeft: 0.6,
  marginRight: 0.6,
  contentWidth: 8.8,
  titleTop: 0.35,
  contentTop: 1.05,
  footerBottom: 5.22,
  slideWidth: 10.0,
  slideHeight: 5.625,
}

function addSlideHeaderAndFooter(
  slide: pptxgen.Slide,
  titulo: string,
  subtitulo: string | null,
  numeroPagina: string,
  logo: { path: string; x: number; y: number; w: number; h: number } | null,
) {
  // Bloco de título + subtítulo alinhados
  const titleRuns: pptxgen.TextProps[] = [
    { text: titulo, options: { fontSize: 20, bold: true, color: C_NAVY, fontFace: 'Arial' } },
  ]
  if (subtitulo) {
    titleRuns.push({
      text: `   |   ${subtitulo}`,
      options: { fontSize: 10, bold: false, color: C_MUTED, fontFace: 'Arial' },
    })
  }

  slide.addText(titleRuns, {
    x: GRID.marginLeft,
    y: GRID.titleTop,
    w: 7.8,
    h: 0.55,
    margin: 0,
  })

  // Linha sutil separadora abaixo do cabeçalho
  slide.addShape('rect' as pptxgen.ShapeType, {
    x: GRID.marginLeft,
    y: GRID.titleTop + 0.58,
    w: GRID.contentWidth,
    h: 0.015,
    fill: { color: 'E2E8F0' },
    line: { color: 'E2E8F0', width: 0.5 },
  })

  // Logo Bycor superior direito
  if (logo) {
    slide.addImage(logo)
  }

  // Rodapé unificado: marca Bycor à esquerda, numeração à direita
  slide.addText(
    [
      { text: 'BYCOR P&C INTELLIGENCE', options: { bold: true, color: C_NAVY } },
      { text: '   •   Estudo Técnico de Mercado', options: { color: C_MUTED } },
    ],
    {
      x: GRID.marginLeft,
      y: GRID.footerBottom,
      w: 6.0,
      h: 0.3,
      fontFace: 'Arial',
      fontSize: 8,
      margin: 0,
    },
  )

  slide.addText(numeroPagina, {
    x: 8.0,
    y: GRID.footerBottom,
    w: 1.4,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 8.5,
    bold: true,
    color: C_MUTED,
    align: 'right',
    margin: 0,
  })
}

/**
 * Gera os bytes PPTX de alta fidelidade ao PDF de 12 páginas do Estudo de Mercado.
 */
export interface GenerateEstudoPptxOptions {
  /** Incluir a mídia do logotipo Bycor (desativado no fallback do harness Node sem mídia em disco) */
  includeLogo?: boolean
  /** Incluir os placeholders de foto via URL remota (desativado no fallback do harness Node sem rede) */
  includePhotos?: boolean
}

export async function generateEstudoMercadoPptx(
  data: EstudoMercadoEditavelData,
  options: GenerateEstudoPptxOptions = {},
): Promise<Uint8Array> {
  const { includeLogo = true, includePhotos = true } = options

  // Mídia indisponível (Node sem acesso ao disco): omitir logos em vez de abortar.
  const logoUsavel = includeLogo && isLogoMediaAvailable()

  // Logos do header/capa/encerramento: omitidos no Node sem mídia em disco
  const logoHeader = logoUsavel
    ? {
        path: LOGO_BYCOR_PATH,
        x: 8.85,
        y: 0.28,
        w: 0.55,
        h: 0.72,
      }
    : null
  const logoCapa = logoUsavel
    ? {
        path: LOGO_BYCOR_PATH,
        x: 0.6,
        y: 0.7,
        w: 1.1,
        h: 1.45,
      }
    : null
  const logoEncerramento = logoUsavel
    ? {
        path: LOGO_BYCOR_PATH,
        x: 8.8,
        y: 0.35,
        w: 0.65,
        h: 0.85,
      }
    : null

  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9' // 10" x 5.625"
  pptx.author = 'Bycor P&C Intelligence'
  pptx.company = 'Bycor Consultoria e Corretora de Seguros'
  pptx.title = `Estudo de Mercado - ${data.empreendimentoNome}`

  // Resolução das 42 coberturas para as propostas
  const linhas42: LinhaComparativaEstudo[] = resolverGradeEstudo42({
    propostas: data.propostas || [],
    canonicasC3: data.canonicasC3 || [],
    sinonimosC3: data.sinonimosC3 || [],
  })

  // =========================================================================
  // SLIDE 1: Capa
  // =========================================================================
  const s1 = pptx.addSlide()

  const shapeRect = (pptx.ShapeType?.rect || 'rect') as pptxgen.ShapeType
  const shapeRoundRect = (pptx.ShapeType?.roundRect || 'roundRect') as pptxgen.ShapeType
  const chartBar = (pptx.ChartType?.bar || (pptx as any).charts?.BAR || 'bar') as any

  // Faixa esquerda de ilustração / cor
  s1.addShape(shapeRect, {
    x: 0,
    y: 0,
    w: 10,
    h: 5.625,
    fill: { color: C_NAVY },
    line: { color: C_NAVY },
  })
  // Logo oficial Bycor em destaque na capa
  if (logoCapa) {
    s1.addImage(logoCapa)
  }

  s1.addText(
    [
      { text: 'BYCOR\n', options: { fontSize: 30, bold: true, color: '10B981' } },
      { text: 'P&C INTELLIGENCE\n\n', options: { fontSize: 13, bold: true, color: '93C5FD' } },
      {
        text: 'Estudo Técnico de Mercado\nColocação & Transferência de Risco',
        options: { fontSize: 11, color: 'E2E8F0' },
      },
    ],
    { x: 0.6, y: 2.3, w: 3.4, h: 2.5, fontFace: 'Arial', align: 'left' },
  )

  // Lado direito: Título principal, Empreendimento e Vigência
  s1.addText(
    [
      { text: 'Condomínio\n', options: { fontSize: 18, color: C_NAVY, bold: true } },
      {
        text: `${data.empreendimentoNome}\n\n`,
        options: { fontSize: 24, bold: true, color: C_NAVY },
      },
      {
        text: `${data.cosseguradoNome || ''}\n`,
        options: { fontSize: 14, bold: true, color: C_BLUE },
      },
      { text: `${data.enderecoTexto || ''}\n\n\n`, options: { fontSize: 9.5, color: C_MUTED } },
      {
        text: 'Estudo para Contratação do\nSeguro Patrimonial\n\n',
        options: { fontSize: 18, bold: true, color: C_NAVY },
      },
      {
        text: `Vigência: ${data.vigenciaTexto} | ${data.versaoTexto}`,
        options: { fontSize: 10, bold: true, color: C_BLUE },
      },
    ],
    { x: 4.8, y: 0.8, w: 4.8, h: 4.2, fontFace: 'Arial', align: 'left', margin: 0 },
  )

  // Avisos legais no rodapé
  s1.addText(
    [
      { text: 'Material de uso restrito ao segurado.\n' },
      {
        text: 'Contratação sujeita à proposta, aceitação, inspeção e condições contratuais vigentes.',
      },
    ],
    {
      x: 4.8,
      y: 5.0,
      w: 4.8,
      h: 0.5,
      fontFace: 'Arial',
      fontSize: 8,
      italic: true,
      color: C_MUTED,
    },
  )

  // =========================================================================
  // SLIDE 2: Institucional BYCOR (Fixo)
  // =========================================================================
  const s2 = pptx.addSlide()
  addSlideHeaderAndFooter(
    s2,
    'Somos a BYCOR Seguros',
    'Apresentação Corporativa',
    '02/12',
    logoHeader,
  )

  s2.addText(
    'A BYCOR Consultoria e Corretora de Seguros é especialista na transferência de riscos por meio de apólices de seguro, atuando com foco na proteção customizada de negócios e devidamente registrada na SUSEP.',
    {
      x: GRID.marginLeft,
      y: GRID.contentTop,
      w: GRID.contentWidth,
      h: 0.45,
      fontFace: 'Arial',
      fontSize: 10,
      color: C_TEXT,
    },
  )

  // 5 Diferenciais em Cards horizontais
  const diferenciais = [
    {
      titulo: 'Especialistas em Riscos',
      desc: 'Consultores técnicos em seguros com experiência em soluções customizadas',
    },
    {
      titulo: 'Registrada na SUSEP',
      desc: 'Atuação regulamentada, com RC Profissional e segurança jurídica',
    },
    {
      titulo: 'Grandes Players',
      desc: 'Parceira dos maiores players do mercado e seguradoras segmentadas/nicho',
    },
    {
      titulo: 'Datacenter Tier3',
      desc: 'Segurança na proteção de dados via Datacenter Tier3 e Microsoft Azure',
    },
    {
      titulo: 'Atendimento Personalizado',
      desc: 'Suporte dedicado para tomadas de decisão e gestão com proteção customizada',
    },
  ]

  const cardW = 1.68
  const cardH = 2.0
  const startX = GRID.marginLeft
  const gapX = 0.1
  const cardY = 1.6

  diferenciais.forEach((d, i) => {
    const xPos = startX + i * (cardW + gapX)
    s2.addShape(shapeRoundRect, {
      x: xPos,
      y: cardY,
      w: cardW,
      h: cardH,
      fill: { color: C_BG_CARD },
      line: { color: C_BORDER, width: 1 },
      rectRadius: 0.08,
    })

    s2.addText(
      [
        { text: `${d.titulo}\n\n`, options: { fontSize: 10, bold: true, color: C_NAVY } },
        { text: d.desc, options: { fontSize: 8.5, color: C_MUTED } },
      ],
      { x: xPos + 0.1, y: cardY + 0.15, w: cardW - 0.2, h: cardH - 0.3, fontFace: 'Arial' },
    )
  })

  // Segmentos e Produtos no rodapé
  s2.addShape(shapeRoundRect, {
    x: GRID.marginLeft,
    y: 3.75,
    w: GRID.contentWidth,
    h: 1.3,
    fill: { color: 'F0FDF4' },
    line: { color: 'BBF7D0', width: 1 },
    rectRadius: 0.08,
  })

  s2.addText(
    [
      {
        text: 'Atuação nos Segmentos: Benefícios, Patrimonial e Responsabilidades\n',
        options: { fontSize: 10.5, bold: true, color: C_NAVY },
      },
      {
        text: 'Com expertise nos Produtos:\n',
        options: { fontSize: 9.5, bold: true, color: C_BLUE },
      },
      {
        text: '• Saúde     • Dental     • Vida em Grupo     • Empresarial / Patrimonial     • Responsabilidade Civil Geral     • D&O (Resp. Civil Administradores)     • Cyber',
        options: { fontSize: 9, color: C_TEXT },
      },
    ],
    { x: GRID.marginLeft + 0.2, y: 3.85, w: GRID.contentWidth - 0.4, h: 1.1, fontFace: 'Arial' },
  )

  // =========================================================================
  // SLIDE 3: Conteúdo do Estudo (Índice)
  // =========================================================================
  const s3 = pptx.addSlide()
  addSlideHeaderAndFooter(s3, 'Conteúdo do Estudo', 'Índice Executivo', '03/12', logoHeader)

  s3.addText(
    `Este estudo apresenta as cotações das Seguradoras para o Seguro Patrimonial do ${data.empreendimentoNome}${data.cosseguradoNome ? ' e do novo ' + data.cosseguradoNome : ''}, estruturado em seis blocos temáticos:`,
    {
      x: GRID.marginLeft,
      y: GRID.contentTop,
      w: GRID.contentWidth,
      h: 0.45,
      fontFace: 'Arial',
      fontSize: 10,
      color: C_TEXT,
    },
  )

  const blocosIndice = [
    {
      num: '01',
      tit: 'Objetivo',
      desc: 'Apresentação e contexto do estudo para contratação do seguro patrimonial.',
    },
    {
      num: '02',
      tit: 'Informações do Risco',
      desc: 'Dados do segurado, do risco, valores declarados e estruturas do empreendimento.',
    },
    {
      num: '03',
      tit: 'Cias Consultadas',
      desc: 'Resultado da consulta com as principais seguradoras do mercado.',
    },
    {
      num: '04',
      tit: 'Prêmios',
      desc: 'Valores apresentados pela Cias e formas de pagamento disponíveis.',
    },
    {
      num: '05',
      tit: 'Coberturas – POS & Franquias',
      desc: 'Todas as coberturas cotadas com Importâncias Seguradas (LMI) e POS & Franquias.',
    },
    {
      num: '06',
      tit: 'Condições de Contratação',
      desc: 'Condições técnicas, requisitos e próximos passos para a contratação.',
    },
  ]

  const bW = 2.75
  const bH = 1.35
  const bGapX = 0.27
  const bGapY = 0.22

  blocosIndice.forEach((b, idx) => {
    const col = idx % 3
    const row = Math.floor(idx / 3)
    const bx = GRID.marginLeft + col * (bW + bGapX)
    const by = 1.7 + row * (bH + bGapY)

    s3.addShape(shapeRoundRect, {
      x: bx,
      y: by,
      w: bW,
      h: bH,
      fill: { color: C_BG_CARD },
      line: { color: C_BORDER, width: 1 },
      rectRadius: 0.06,
    })

    // Faixa colorida no topo do card
    s3.addShape(shapeRect, {
      x: bx,
      y: by,
      w: bW,
      h: 0.04,
      fill: { color: C_BLUE },
      line: { color: C_BLUE },
    })
    s3.addText(
      [
        { text: `${b.num}\n`, options: { fontSize: 13, bold: true, color: C_BLUE } },
        { text: `${b.tit}\n`, options: { fontSize: 12, bold: true, color: C_NAVY } },
        { text: b.desc, options: { fontSize: 8.5, color: C_MUTED } },
      ],
      { x: bx + 0.15, y: by + 0.12, w: bW - 0.3, h: bH - 0.2, fontFace: 'Arial' },
    )
  })

  // =========================================================================
  // SLIDE 4: Objetivo do Estudo (Editável pelo Analista)
  // =========================================================================
  const s4 = pptx.addSlide()
  addSlideHeaderAndFooter(
    s4,
    'Objetivo do Estudo',
    'Contexto Técnico e Operacional',
    '04/12',
    logoHeader,
  )

  // Card do texto do objetivo
  s4.addShape(shapeRoundRect, {
    x: GRID.marginLeft,
    y: 3.45,
    w: GRID.contentWidth,
    h: 1.6,
    fill: { color: 'FEF2F2' },
    line: { color: 'FECACA', width: 1.2 },
    rectRadius: 0.08,
  })
  s4.addText(
    [
      {
        text: `${data.objetivoTexto}\n\n`,
        options: { fontSize: 10, color: C_TEXT },
      },
      {
        text: 'IMPORTANTE – ',
        options: { fontSize: 10, bold: true, color: 'DC2626' },
      },
      {
        text: data.objetivoImportanteTexto,
        options: { fontSize: 9.5, color: C_TEXT },
      },
    ],
    {
      x: GRID.marginLeft + 0.2,
      y: GRID.contentTop + 0.12,
      w: GRID.contentWidth - 0.4,
      h: 1.85,
      fontFace: 'Arial',
    },
  )

  // 3 Fotos ilustrativas (conforme PDF de referência)
  const imgW = 2.8
  const imgH = 1.75
  const imgY = 3.3
  const imgGap = 0.2

  const fotoPlaceholders = [
    'https://img.usecurling.com/p/600/400?q=hotel+bedroom&color=blue',
    'https://img.usecurling.com/p/600/400?q=hotel+lounge&color=blue',
    'https://img.usecurling.com/p/600/400?q=hotel+suite&color=blue',
  ]

  if (includePhotos) {
    fotoPlaceholders.forEach((url, i) => {
      const ix = GRID.marginLeft + i * (imgW + imgGap)
      s4.addImage({
        path: url,
        x: ix,
        y: imgY,
        w: imgW,
        h: imgH,
      })
    })
  }

  // =========================================================================
  // SLIDE 5: Dados do Segurado e do Risco
  // =========================================================================
  const s5 = pptx.addSlide()
  addSlideHeaderAndFooter(
    s5,
    'Dados do Segurado e do Risco',
    'Perfil Operacional e VRD',
    '05/12',
    logoHeader,
  )

  // Tabela esquerda: Dados cadastrais e operacionais do risco
  const rowsCadastrais: pptxgen.TableRow[] = [
    [
      { text: 'Campo', options: { bold: true, fill: { color: 'E2E8F0' }, fontSize: 8.5 } },
      { text: 'Informação', options: { bold: true, fill: { color: 'E2E8F0' }, fontSize: 8.5 } },
    ],
    [{ text: 'Segurado' }, { text: data.empreendimentoNome }],
    [{ text: 'CNPJ' }, { text: data.cnpj || '—' }],
    [
      { text: 'Co-segurado' },
      {
        text: data.cosseguradoNome
          ? `${data.cosseguradoNome} - ${data.cosseguradoCnpj || ''}`
          : 'Não aplicável',
      },
    ],
    [{ text: 'Tipo de Seguro' }, { text: data.tipoSeguro || 'Patrimonial' }],
    [
      { text: 'Cobertura' },
      { text: data.coberturaResumo || 'Prédio, Conteúdo (MMU/MMP) e Lucros Cessantes (L.Bruto)' },
    ],
    [{ text: 'Seguro' }, { text: data.statusSeguro || 'NOVO' }],
    [{ text: 'Para a Vigência' }, { text: data.vigenciaTexto }],
    [{ text: 'CNAE / Atividade' }, { text: data.cnaeAtividade || '—' }],
    [{ text: 'Local do Risco' }, { text: data.enderecoTexto }],
    [{ text: 'Construção' }, { text: data.construcaoTexto || '—' }],
    [{ text: 'Protecionais' }, { text: data.protecionaisTexto || '—' }],
    [{ text: 'Sinistros' }, { text: data.sinistrosTexto || '—' }],
  ].map((row, idx) => {
    if (idx === 0) return row as pptxgen.TableRow
    const bg = idx % 2 === 0 ? 'F8FAFC' : 'FFFFFF'
    return [
      {
        text: (row[0] as any).text,
        options: { bold: true, fontSize: 7.5, color: C_NAVY, fill: { color: bg } },
      },
      {
        text: (row[1] as any).text,
        options: { fontSize: 7.5, color: C_TEXT, fill: { color: bg } },
      },
    ]
  })

  s5.addTable(rowsCadastrais, {
    x: GRID.marginLeft,
    y: GRID.contentTop,
    w: 5.2,
    colW: [1.3, 3.9],
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.04,
  })

  // Tabela direita: Valores em Risco Declarados
  // Aplica o racional C4 de cálculo de VRDs caso o caller não tenha pré-calculado:
  // - Total DM = Prédio + MMU/MMP quando ambos existirem; ou só Prédio quando não houver MMU/MMP
  // - LMGA (Total DM + LC) = Total DM + LC apenas quando houver LC
  // Sem fallbacks chumbados: onde o cadastro/proposta não traz o valor, fica '—'
  // para o analista preencher (nunca dados de outro empreendimento).
  const totaisCalculados = calcularTotaisVrdEstudo({
    vrdPredio: data.vrdPredio,
    vrdMmu: data.vrdMmu,
    vrdMmp: data.vrdMmp,
    vrdDmTotal: data.vrdDmTotal,
    vrdLc: data.vrdLcAnual,
    vrdDmPlusLc: data.vrdDmPlusLc,
  })

  const vrdPredioFinal = totaisCalculados.vrdPredio ?? data.vrdPredio
  const vrdMmuFinal = totaisCalculados.vrdMmu ?? data.vrdMmu
  const vrdMmpFinal = totaisCalculados.vrdMmp ?? data.vrdMmp
  const vrdDmTotalFinal = totaisCalculados.vrdDmTotal ?? data.vrdDmTotal
  const vrdLcAnualFinal = totaisCalculados.vrdLcAnual ?? data.vrdLcAnual
  const vrdTotalFinal = totaisCalculados.vrdDmPlusLc ?? data.vrdDmPlusLc

  const vrdPredioStr = vrdPredioFinal ? formatLmiEstudo(vrdPredioFinal) : '—'
  const vrdMmuStr = vrdMmuFinal ? formatLmiEstudo(vrdMmuFinal) : '—'
  const vrdMmpStr = vrdMmpFinal && vrdMmpFinal > 0 ? formatLmiEstudo(vrdMmpFinal) : '--'
  const vrdDmTotalStr = vrdDmTotalFinal ? formatLmiEstudo(vrdDmTotalFinal) : '—'
  const vrdLcAnualStr = vrdLcAnualFinal ? formatLmiEstudo(vrdLcAnualFinal) : '—'
  const vrdTotalStr = vrdTotalFinal ? formatLmiEstudo(vrdTotalFinal) : '—'

  const rowsVrd: pptxgen.TableRow[] = [
    [
      {
        text: 'Item',
        options: { bold: true, fill: { color: C_NAVY }, color: C_WHITE, fontSize: 8.5 },
      },
      {
        text: 'Valor (R$)',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 8.5,
          align: 'right',
        },
      },
    ],
    [{ text: 'Prédio' }, { text: vrdPredioStr }],
    [{ text: 'MMU (Máquinas, Móveis e Utensílios)' }, { text: vrdMmuStr }],
    [{ text: 'MMP (Mercadorias e Matérias Primas)' }, { text: vrdMmpStr }],
    [{ text: 'Total Danos Materiais' }, { text: vrdDmTotalStr }],
    [{ text: 'Lucros Cessantes (anual)' }, { text: vrdLcAnualStr }],
    [{ text: 'Total DM + LC' }, { text: vrdTotalStr }],
  ].map((row, idx) => {
    if (idx === 0) return row as pptxgen.TableRow
    const isTotal = idx === 4 || idx === 6
    const bg = isTotal ? 'EFF6FF' : idx % 2 === 0 ? 'F8FAFC' : 'FFFFFF'
    return [
      {
        text: (row[0] as any).text,
        options: { bold: isTotal, fontSize: 8, color: C_NAVY, fill: { color: bg } },
      },
      {
        text: (row[1] as any).text,
        options: { bold: isTotal, fontSize: 8, color: C_NAVY, fill: { color: bg }, align: 'right' },
      },
    ]
  })

  s5.addText('Valores em Risco Declarados', {
    x: 6.0,
    y: GRID.contentTop,
    w: 3.4,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 11,
    bold: true,
    color: C_NAVY,
  })

  s5.addTable(rowsVrd, {
    x: 6.0,
    y: GRID.contentTop + 0.35,
    w: 3.4,
    colW: [2.1, 1.3],
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.05,
  })

  // =========================================================================
  // SLIDE 6: Marco Regulatório Nova Lei de Seguros 15.040/2024 (Fixo)
  // =========================================================================
  const s6 = pptx.addSlide()
  addSlideHeaderAndFooter(
    s6,
    'Informações Regulatórias',
    'Nova Lei de Seguros 15.040/2024',
    '06/12',
    logoHeader,
  )

  s6.addText('Marco Regulatório Nova Lei de Seguros 15.040/2024 em vigor a partir de 11/12/2025', {
    x: GRID.marginLeft,
    y: GRID.contentTop,
    w: GRID.contentWidth,
    h: 0.35,
    fontFace: 'Arial',
    fontSize: 12.5,
    bold: true,
    color: C_NAVY,
  })

  s6.addText(
    [
      {
        text: 'Visão geral das principais mudanças nos clausulados\n',
        options: { bold: true, fontSize: 10, color: C_BLUE },
      },
      {
        text: '✓ Documentos Contratuais → Revisão completa de questionários, propostas, apólices, certificados e condições gerais\n',
      },
      {
        text: '✓ Prazo para Aceitação da Seguradora/Recusa do Risco → Novo prazo: 25 dias (antes: 15 dias)\n',
      },
      {
        text: '✓ Prazo para Pagamento de Prêmio, Suspensão e Cancelamento → Atenção à data de vencimento do prêmio Novos prazos para envio de avisos de inadimplência (conforme Lei):\n',
      },
      {
        text: '    - Primeira parcela ou pagamento único: O atraso da primeira mensalidade ou da cota única, enseja cancelamento do contrato.\n',
      },
      {
        text: '    - Demais parcelas (mensalidades seguintes): Há 30 dias de tolerância antes do cancelamento (15 dias para pagar sem perder o seguro + 15 dias suspensão)\n\n',
      },
      {
        text: 'CONDIÇÕES PARTICULARES DE PERDAS INDENIZÁVEIS E CUSTOS DE DEFESA\n',
        options: { bold: true, fontSize: 10, color: C_BLUE },
      },
      {
        text: 'Considerando a "Nova Lei de Seguros" (https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l15040.htm), a partir do dia 11/12/2025, as apólices de Seguro de Responsabilidade Civil serão obrigadas a estipular um LMG específico para Custos de Defesa, Indenizações e Despesas de Salvamento, não podendo utilizar 100% da capacidade para as três modalidades. Considerando a nova lei, a divisão da proposta se dará da seguinte maneira:\n\n',
      },
      {
        text: 'COBERTURA DE CUSTOS DE DEFESA\n',
        options: { bold: true, fontSize: 9.5, color: C_NAVY },
      },
      {
        text: 'Para a cobertura de Custos de Defesa, fica estabelecido um limite separado do Limite Máximo de Garantia das coberturas contratadas, observado os sublimites, se aplicável, integrando o Limite Máximo de Garantia da apólice.\n\n',
      },
      { text: 'COBERTURA DE INDENIZAÇÃO\n', options: { bold: true, fontSize: 9.5, color: C_NAVY } },
      {
        text: 'Para a cobertura de Indenização, fica estabelecido um limite separado subtraído o limite reservado para Custos de Defesa, do Limite Máximo de Garantia das coberturas contratadas, observado os sublimites, se aplicável, integrando o Limite Máximo de Garantia da apólice.\n\n',
      },
      {
        text: 'COBERTURA DE DESPESAS DE SALVAMENTO E CONTENÇÃO\n',
        options: { bold: true, fontSize: 9.5, color: C_NAVY },
      },
      {
        text: 'Para a cobertura de Despesas de Salvamento e Contenção, fica estabelecido um limite definido por cada Cia, no Limite Máximo de Garantia das coberturas contratadas. Há a opção de contratar a cobertura de forma adicional.',
      },
    ],
    {
      x: GRID.marginLeft,
      y: GRID.contentTop + 0.38,
      w: GRID.contentWidth,
      h: 3.7,
      fontFace: 'Arial',
      fontSize: 8.5,
      color: C_TEXT,
    },
  )

  // =========================================================================
  // SLIDE 7: Seguradoras Consultadas
  // =========================================================================
  const s7 = pptx.addSlide()
  addSlideHeaderAndFooter(
    s7,
    'Seguradoras Consultadas',
    'Status da Rodada RFQ',
    '07/12',
    logoHeader,
  )

  // Card Cias que apresentaram Propostas
  s7.addShape(shapeRoundRect, {
    x: GRID.marginLeft,
    y: 1.7,
    w: 4.4,
    h: 3.3,
    fill: { color: 'F0FDF4' },
    line: { color: 'BBF7D0', width: 1 },
    rectRadius: 0.08,
  })
  const ciasPropList =
    data.ciasApresentaramProposta && data.ciasApresentaramProposta.length > 0
      ? data.ciasApresentaramProposta
      : ['ALLIANZ SEGUROS', 'AXA SEGUROS', 'PORTO SEGURO', 'SWISS RE SEGUROS']

  s7.addText(
    [
      {
        text: 'Cias Seguradoras que apresentaram Propostas:\n\n',
        options: { bold: true, fontSize: 11, color: C_NAVY },
      },
      ...ciasPropList.map((c) => ({
        text: `✓  ${c.toUpperCase()}\n`,
        options: { fontSize: 10, bold: true, color: C_GREEN },
      })),
    ],
    { x: GRID.marginLeft + 0.2, y: GRID.contentTop + 0.15, w: 4.7, h: 1.65, fontFace: 'Arial' },
  )

  // Card Cias em análise ou não apresentaram
  s7.addShape(shapeRoundRect, {
    x: 5.2,
    y: 1.7,
    w: 4.2,
    h: 3.3,
    fill: { color: 'FEF2F2' },
    line: { color: 'FECACA', width: 1 },
    rectRadius: 0.08,
  })
  const ciasSemPropList =
    data.ciasEmAnaliseOuNaoApresentaram && data.ciasEmAnaliseOuNaoApresentaram.length > 0
      ? data.ciasEmAnaliseOuNaoApresentaram
      : [
          'TOKIO MARINE',
          'CHUBB SEGUROS (Apólice - Atlântica)',
          'ZURICH SEGUROS (Cosseguro na Apólice Chubb)',
        ]

  s7.addText(
    [
      {
        text: 'Cias Seguradoras que estão em análise ou não apresentaram até o momento:\n\n',
        options: { bold: true, fontSize: 11, color: C_NAVY },
      },
      ...ciasSemPropList.map((c) => ({
        text: `✕  ${c.toUpperCase()}\n`,
        options: { fontSize: 10, bold: true, color: 'DC2626' },
      })),
    ],
    { x: GRID.marginLeft + 0.2, y: 3.3, w: 4.7, h: 1.65, fontFace: 'Arial' },
  )

  // Foto de fachada corporativa à direita
  if (includePhotos) {
    s7.addImage({
      path: 'https://img.usecurling.com/p/600/800?q=modern+glass+building+headquarters&color=blue',
      x: 5.9,
      y: GRID.contentTop,
      w: 3.5,
      h: 4.0,
    })
  }

  // =========================================================================
  // SLIDE 8: Prêmios
  // =========================================================================
  const s8 = pptx.addSlide()
  addSlideHeaderAndFooter(s8, 'Prêmios', 'Comparativo Financeiro e Condições', '08/12', logoHeader)

  // Cabeçalho da tabela de prêmios por cia
  const colCias =
    data.propostas && data.propostas.length > 0
      ? data.propostas
      : [
          {
            id: 'demo1',
            seguradoraNome: 'SWISS RE',
            premioTotalComIof: 56344,
            parcelamentoSemJurosTexto: '',
            numeroCoberturas: 31,
            coberturasOriginais: [],
          },
          {
            id: 'demo2',
            seguradoraNome: 'ALLIANZ',
            premioTotalComIof: 74323,
            parcelamentoSemJurosTexto: '',
            numeroCoberturas: 24,
            coberturasOriginais: [],
          },
          {
            id: 'demo3',
            seguradoraNome: 'PORTO',
            premioTotalComIof: 88370,
            parcelamentoSemJurosTexto: '',
            numeroCoberturas: 33,
            coberturasOriginais: [],
          },
          {
            id: 'demo4',
            seguradoraNome: 'AXA 1',
            premioTotalComIof: 62335,
            parcelamentoSemJurosTexto: '',
            numeroCoberturas: 42,
            coberturasOriginais: [],
          },
          {
            id: 'demo5',
            seguradoraNome: 'AXA 2',
            premioTotalComIof: 49772,
            parcelamentoSemJurosTexto: '',
            numeroCoberturas: 42,
            coberturasOriginais: [],
            vencedora: true,
          },
        ]

  const numColCias = colCias.length
  const colWPrimeira = 2.4
  const colWRestante = (GRID.contentWidth - colWPrimeira) / numColCias
  const colWArrayPremios = [colWPrimeira, ...Array(numColCias).fill(colWRestante)]

  const rowsPremios: pptxgen.TableRow[] = [
    [
      {
        text: 'Item',
        options: { bold: true, fill: { color: C_NAVY }, color: C_WHITE, fontSize: 8 },
      },
      {
        text: 'Dados / Opções',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 8,
          align: 'center',
          colspan: numColCias,
        },
      },
    ],
    [
      {
        text: 'Valor em Risco – D.Materiais',
        options: { fontSize: 7.5, bold: true, fill: { color: 'FFFFFF' } },
      },
      {
        text: vrdDmTotalStr,
        options: {
          align: 'right',
          bold: true,
          colspan: numColCias,
          fontSize: 7.5,
          fill: { color: 'FFFFFF' },
        },
      },
    ],
    [
      {
        text: 'Valor em Risco – Lucros Cessantes',
        options: { fontSize: 7.5, bold: true, fill: { color: C_ZEBRA_ROW } },
      },
      {
        text: vrdLcAnualStr,
        options: {
          align: 'right',
          bold: true,
          colspan: numColCias,
          fontSize: 7.5,
          fill: { color: C_ZEBRA_ROW },
        },
      },
    ],
    [
      {
        text: 'Seguradora',
        options: { bold: true, fontSize: 7.5, fill: { color: 'E2E8F0' }, color: C_NAVY },
      },
      ...colCias.map((p) => {
        const isVencedora = Boolean(p.vencedora)
        const rotulo = p.opcao ? `${p.seguradoraNome} (Opção ${p.opcao})` : p.seguradoraNome
        const texto = isVencedora ? `★ ${rotulo}\n[Recomendada]` : rotulo
        return {
          text: texto,
          options: {
            bold: true,
            fontSize: 7.5,
            fill: { color: isVencedora ? C_VENCEDORA_BG : 'E2E8F0' },
            color: isVencedora ? C_VENCEDORA_TEXT : C_NAVY,
            align: 'center' as const,
          },
        }
      }),
    ],
    [
      {
        text: 'Prêmio Total (com IOF)',
        options: { bold: true, fontSize: 8, color: C_NAVY, fill: { color: 'FFFFFF' } },
      },
      ...colCias.map((p) => {
        const isVencedora = Boolean(p.vencedora)
        return {
          text: formatLmiEstudo(p.premioTotalComIof),
          options: {
            bold: true,
            fontSize: 8.5,
            color: isVencedora ? C_VENCEDORA_TEXT : C_NAVY,
            fill: { color: isVencedora ? 'DCFCE7' : 'FFFFFF' },
            align: 'right' as const,
          },
        }
      }),
    ],
    [
      { text: 'Parcelamento sem Juros', options: { fontSize: 7.5, fill: { color: C_ZEBRA_ROW } } },
      ...colCias.map((p) => {
        const isVencedora = Boolean(p.vencedora)
        return {
          text: p.parcelamentoSemJurosTexto || '—',
          options: {
            align: 'center' as const,
            bold: true,
            fontSize: 7.5,
            fill: { color: isVencedora ? C_VENCEDORA_BG : C_ZEBRA_ROW },
          },
        }
      }),
    ],
    [
      { text: 'Nº de Coberturas', options: { fontSize: 7.5, fill: { color: 'FFFFFF' } } },
      ...colCias.map((p) => {
        const isVencedora = Boolean(p.vencedora)
        return {
          text: String(p.numeroCoberturas || p.coberturasOriginais?.length || 42),
          options: {
            align: 'center' as const,
            bold: true,
            fontSize: 7.5,
            fill: { color: isVencedora ? C_VENCEDORA_BG : 'FFFFFF' },
          },
        }
      }),
    ],
  ]

  // Renderiza tabela comparativa de prêmios
  s8.addTable(rowsPremios, {
    x: GRID.marginLeft,
    y: GRID.contentTop,
    w: GRID.contentWidth,
    colW: colWArrayPremios,
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.04,
  })

  // Gráfico de barras comparando prêmio total das propostas (Item 5 do escopo)
  try {
    const chartLabels = colCias.map((p) => {
      const base = p.opcao ? `${p.seguradoraNome} Op.${p.opcao}` : p.seguradoraNome
      return p.vencedora ? `★ ${base}` : base
    })
    const chartValues = colCias.map((p) => Math.round(p.premioTotalComIof || 0))

    const chartData = [
      {
        name: 'Prêmio Total (com IOF)',
        labels: chartLabels,
        values: chartValues,
      },
    ]

    s8.addChart(chartBar, chartData, {
      x: GRID.marginLeft,
      y: 2.85,
      w: 4.6,
      h: 2.1,
      barDir: 'col',
      chartColors: [C_NAVY],
      dataLabelPosition: 'outEnd',
      dataLabelFormatCode: '#,##0',
      dataLabelFontSize: 7,
      dataLabelColor: C_NAVY,
      showValue: true,
      showLegend: false,
      showTitle: true,
      title: 'Comparativo de Prêmio Total (R$)',
      titleFontSize: 8.5,
      titleColor: C_NAVY,
      valAxisHidden: false,
      catAxisLabelFontSize: 7,
      catAxisLabelColor: C_TEXT,
      valAxisLabelFontSize: 6.5,
    })
  } catch (err) {
    console.warn('[EstudoMercado] Não foi possível adicionar gráfico no Slide 8:', err)
  }

  // Bloco técnico lateral: Risco Relativo vs Risco Absoluto e Destaque
  s8.addShape(shapeRoundRect, {
    x: 5.4,
    y: 2.85,
    w: 4.0,
    h: 2.1,
    fill: { color: C_BG_CARD },
    line: { color: C_BORDER, width: 1 },
    rectRadius: 0.06,
  })

  s8.addText(
    [
      {
        text: 'Patrimonial - Tipo de Cobertura\n\n',
        options: {
          bold: true,
          fontSize: 8.5,
          color: C_NAVY,
          underline: { style: 'sng', color: C_NAVY },
        },
      },
      {
        text: 'Básica / Lucros Cessantes: 1º Risco Relativo (Rateio se VRD < 80% do apurado)\n\n',
        options: { bold: true, fontSize: 7.5, color: C_TEXT },
      },
      {
        text: 'Demais Coberturas: 1º Risco Absoluto (Indenização integral até o LMI contratado)\n\n',
        options: { bold: true, fontSize: 7.5, color: C_TEXT },
      },
      {
        text: '• Destaque verde indica a proposta recomendada pela Bycor para contratação.\n',
        options: { fontSize: 7, color: C_GREEN, bold: true },
      },
      {
        text: '• Coberturas e exclusões regidas pelas CGs das respectivas seguradoras.',
        options: { fontSize: 7, color: C_MUTED },
      },
    ],
    { x: 5.55, y: 2.95, w: 3.7, h: 1.9, fontFace: 'Arial' },
  )

  // =========================================================================
  // SLIDE 9: Tabela Comparativa de Coberturas (42 linhas canônicas)
  // Paginação com cabeçalho repetido em cada slide, zebra e largura proporcional
  // =========================================================================
  const CHUNK_SIZE = 14
  const chunksLinhas: (typeof linhas42)[] = [
    linhas42.slice(0, CHUNK_SIZE),
    linhas42.slice(CHUNK_SIZE, CHUNK_SIZE * 2),
    linhas42.slice(CHUNK_SIZE * 2, 42),
  ]

  chunksLinhas.forEach((linhasChunk, chunkIdx) => {
    const sCob = pptx.addSlide()
    const subNum =
      chunkIdx === 0 ? '09/12' : chunkIdx === 1 ? '09/12 (cont. 1/2)' : '09/12 (cont. 2/2)'
    const subtitulo = `Parte ${chunkIdx + 1} de 3 • Limites Máximos de Indenização (LMI)`
    addSlideHeaderAndFooter(sCob, 'Tabela Comparativa de Coberturas', subtitulo, subNum, logoHeader)

    // Cabeçalho da tabela de coberturas repetido em todas as páginas
    const headerRow: pptxgen.TableRow = [
      {
        text: 'COBERTURAS',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 6.8,
          align: 'left',
        },
      },
      {
        text: 'SOLICITADA',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 6.8,
          align: 'right',
        },
      },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        const numCob = c.numeroCoberturas || c.coberturasOriginais?.length || 42
        const nome = isVenc
          ? `★ ${c.seguradoraNome} (${numCob})`
          : `${c.seguradoraNome} (${numCob})`
        return {
          text: nome,
          options: {
            bold: true,
            fill: { color: isVenc ? '047857' : C_NAVY },
            color: C_WHITE,
            fontSize: 6.8,
            align: 'center' as const,
          },
        }
      }),
    ]

    const dataRows: pptxgen.TableRow[] = linhasChunk.map((linha, lIdx) => {
      const bg = lIdx % 2 === 0 ? 'FFFFFF' : C_ZEBRA_ROW
      const solStr =
        typeof linha.item.lmiSolicitado === 'number'
          ? formatLmiEstudo(linha.item.lmiSolicitado)
          : String(linha.item.lmiSolicitado || '—')

      // Exibe a nomenclatura da Taxonomia (campo nome da coberturas_canonicas)
      const textoNome = linha.item.nome || linha.item.titulo

      return [
        {
          text: `${linha.item.numero}  ${textoNome}`,
          options: {
            bold: true,
            fontSize: 6.2,
            color: C_NAVY,
            fill: { color: bg },
            align: 'left' as const,
          },
        },
        {
          text: solStr,
          options: {
            bold: true,
            fontSize: 6.2,
            color: C_NAVY,
            fill: { color: bg },
            align: 'right' as const,
          },
        },
        ...colCias.map((c) => {
          const isVenc = Boolean(c.vencedora)
          const cell = linha.celulasPorProposta.get(c.id)
          const val = cell?.valorFormatado || 'X'
          const isAbaixo = cell?.abaixoDoSolicitado
          const isX = val === 'X'
          const fontColor = isX
            ? '94A3B8'
            : isAbaixo
              ? 'B91C1C'
              : isVenc
                ? C_VENCEDORA_TEXT
                : C_TEXT
          const cellBg = isVenc ? (lIdx % 2 === 0 ? 'F0FDF4' : 'DCFCE7') : bg
          const isNumeric = val !== 'X' && val !== '✓' && val !== '—' && val !== 'Não há'
          return {
            text: val,
            options: {
              fontSize: 6.2,
              color: fontColor,
              fill: { color: cellBg },
              align: (isNumeric ? 'right' : 'center') as 'right' | 'center',
              bold: isAbaixo || val === '✓' || isVenc,
            },
          }
        }),
      ]
    })

    // Se for o último slide de coberturas (3/3), inclui a linha final de Prêmio Bruto (R$)
    if (chunkIdx === chunksLinhas.length - 1) {
      dataRows.push([
        {
          text: 'Prêmio Total com IOF (R$)',
          options: {
            bold: true,
            fill: { color: 'EFF6FF' },
            fontSize: 6.8,
            color: C_NAVY,
            align: 'left' as const,
          },
        },
        { text: '', options: { fill: { color: 'EFF6FF' } } },
        ...colCias.map((c) => {
          const isVenc = Boolean(c.vencedora)
          return {
            text: formatLmiEstudo(c.premioTotalComIof),
            options: {
              bold: true,
              fill: { color: isVenc ? 'DCFCE7' : 'EFF6FF' },
              fontSize: 6.8,
              color: isVenc ? C_VENCEDORA_TEXT : C_NAVY,
              align: 'right' as const,
            },
          }
        }),
      ])
    }

    const colWNome = 4.1
    const colWSol = 1.1
    const colWCiasCob = (GRID.contentWidth - colWNome - colWSol) / numColCias

    sCob.addTable([headerRow, ...dataRows], {
      x: GRID.marginLeft,
      y: GRID.contentTop,
      w: GRID.contentWidth,
      colW: [colWNome, colWSol, ...Array(numColCias).fill(colWCiasCob)],
      border: { pt: 0.5, color: C_BORDER },
      margin: 0.02,
    })
  })

  // =========================================================================
  // SLIDE 10: Tabela Comparativa de POS & Franquias (42 linhas canônicas)
  // Cabeçalho repetido em todas as páginas e larguras proporcionais
  // =========================================================================
  chunksLinhas.forEach((linhasChunk, chunkIdx) => {
    const sPos = pptx.addSlide()
    const subNum =
      chunkIdx === 0 ? '10/12' : chunkIdx === 1 ? '10/12 (cont. 1/2)' : '10/12 (cont. 2/2)'
    const subtitulo = `Parte ${chunkIdx + 1} de 3 • Participação Obrigatória do Segurado`
    addSlideHeaderAndFooter(
      sPos,
      'Tabela Comparativa de POS & Franquias',
      subtitulo,
      subNum,
      logoHeader,
    )

    const headerRow: pptxgen.TableRow = [
      {
        text: 'COBERTURAS',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 6.8,
          align: 'left',
        },
      },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        const numCob = c.numeroCoberturas || c.coberturasOriginais?.length || 42
        const nome = isVenc
          ? `★ ${c.seguradoraNome} (${numCob})`
          : `${c.seguradoraNome} (${numCob})`
        return {
          text: nome,
          options: {
            bold: true,
            fill: { color: isVenc ? '047857' : C_NAVY },
            color: C_WHITE,
            fontSize: 6.8,
            align: 'center' as const,
          },
        }
      }),
    ]

    const dataRows: pptxgen.TableRow[] = linhasChunk.map((linha, lIdx) => {
      const bg = lIdx % 2 === 0 ? 'FFFFFF' : C_ZEBRA_ROW

      // Exibe a nomenclatura da Taxonomia (campo nome da coberturas_canonicas)
      const textoNome = linha.item.nome || linha.item.titulo

      return [
        {
          text: `${linha.item.numero}  ${textoNome}`,
          options: {
            bold: true,
            fontSize: 6.2,
            color: C_NAVY,
            fill: { color: bg },
            align: 'left' as const,
          },
        },
        ...colCias.map((c) => {
          const isVenc = Boolean(c.vencedora)
          const cell = linha.celulasPorProposta.get(c.id)
          const franq = cell?.franquiaTexto || 'Não há'
          const isX = franq === 'X'
          const cellBg = isVenc ? (lIdx % 2 === 0 ? 'F0FDF4' : 'DCFCE7') : bg
          return {
            text: franq,
            options: {
              fontSize: 6.2,
              color: isX ? '94A3B8' : isVenc ? C_VENCEDORA_TEXT : C_TEXT,
              fill: { color: cellBg },
              align: 'center' as const,
              bold: isVenc && !isX,
            },
          }
        }),
      ]
    })

    const colWNomePos = 4.2
    const colWCiasPos = (GRID.contentWidth - colWNomePos) / numColCias

    sPos.addTable([headerRow, ...dataRows], {
      x: GRID.marginLeft,
      y: GRID.contentTop,
      w: GRID.contentWidth,
      colW: [colWNomePos, ...Array(numColCias).fill(colWCiasPos)],
      border: { pt: 0.5, color: C_BORDER },
      margin: 0.02,
    })

    // Nota de rodapé técnica
    sPos.addText('* POS & Franquia por Reclamante, Evento, Veículo, Equipamento.', {
      x: GRID.marginLeft,
      y: 5.0,
      w: 7.5,
      h: 0.2,
      fontFace: 'Arial',
      fontSize: 7.2,
      italic: true,
      color: C_MUTED,
    })
  })

  // =========================================================================
  // SLIDE 11: Opções de Contratação (Editável)
  // =========================================================================
  const s11 = pptx.addSlide()
  addSlideHeaderAndFooter(
    s11,
    'Opções de Contratação',
    'Quadro de Decisão e Aceite',
    '11/12',
    logoHeader,
  )

  // Tabela compacta com as opções no topo e destaque da vencedora
  const rowsOpcoesContratacao: pptxgen.TableRow[] = [
    [
      {
        text: 'Item',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 8,
          align: 'left',
        },
      },
      {
        text: 'Dados / Opções',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 8,
          align: 'center',
          colspan: numColCias,
        },
      },
    ],
    [
      {
        text: 'Opção de Contratação',
        options: { bold: true, fontSize: 7.5, fill: { color: 'FFFFFF' } },
      },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        return {
          text: isVenc ? '( ✓ ) [RECOMENDADA]' : '(   )',
          options: {
            align: 'center' as const,
            bold: true,
            fontSize: 7.5,
            fill: { color: isVenc ? C_VENCEDORA_BG : 'FFFFFF' },
            color: isVenc ? C_VENCEDORA_TEXT : C_TEXT,
          },
        }
      }),
    ],
    [
      { text: 'Seguradora', options: { bold: true, fontSize: 7.5, fill: { color: C_ZEBRA_ROW } } },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        const rotulo = c.opcao ? `${c.seguradoraNome} (Opção ${c.opcao})` : c.seguradoraNome
        return {
          text: rotulo,
          options: {
            align: 'center' as const,
            bold: true,
            fontSize: 7.5,
            fill: { color: isVenc ? C_VENCEDORA_BG : C_ZEBRA_ROW },
            color: isVenc ? C_VENCEDORA_TEXT : C_NAVY,
          },
        }
      }),
    ],
    [
      {
        text: 'Prêmio Total (com IOF)',
        options: { bold: true, color: C_NAVY, fontSize: 8, fill: { color: 'FFFFFF' } },
      },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        return {
          text: formatLmiEstudo(c.premioTotalComIof),
          options: {
            align: 'right' as const,
            bold: true,
            fontSize: 8.5,
            fill: { color: isVenc ? 'DCFCE7' : 'FFFFFF' },
            color: isVenc ? C_VENCEDORA_TEXT : C_NAVY,
          },
        }
      }),
    ],
    [
      { text: 'Parcelamento sem Juros', options: { fontSize: 7.5, fill: { color: C_ZEBRA_ROW } } },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        return {
          text: c.parcelamentoSemJurosTexto || '—',
          options: {
            align: 'center' as const,
            fontSize: 7.5,
            bold: true,
            fill: { color: isVenc ? C_VENCEDORA_BG : C_ZEBRA_ROW },
          },
        }
      }),
    ],
    [
      { text: 'Nº de Coberturas', options: { fontSize: 7.5, fill: { color: 'FFFFFF' } } },
      ...colCias.map((c) => {
        const isVenc = Boolean(c.vencedora)
        return {
          text: String(c.numeroCoberturas || 42),
          options: {
            align: 'center' as const,
            fontSize: 7.5,
            bold: true,
            fill: { color: isVenc ? C_VENCEDORA_BG : 'FFFFFF' },
          },
        }
      }),
    ],
  ]

  s11.addTable(rowsOpcoesContratacao, {
    x: GRID.marginLeft,
    y: GRID.contentTop,
    w: GRID.contentWidth,
    colW: colWArrayPremios,
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.04,
  })

  // Formulário de aceite e termos legais
  const contatoResp = data.contatoInspecaoNome
    ? `${data.contatoInspecaoNome} | Tel: ${data.contatoInspecaoTel || ''} | E-mail: ${data.contatoInspecaoEmail || ''}`
    : 'Resp: _____________________________________________________________________'

  const cossegTexto =
    data.cosseguradoContratacao ||
    (data.cosseguradoNome
      ? `${data.cosseguradoNome} - ${data.cosseguradoCnpj || ''}`
      : 'Não aplicável')

  s11.addText(
    [
      {
        text: `• Após a decisão pelo produto mais adequado aos interesses do ${data.empreendimentoNome}${data.cosseguradoNome ? ' e ' + data.cosseguradoNome : ''}\n`,
        options: { bold: true, fontSize: 8.5, color: C_NAVY },
      },
      { text: '• 1. Assinalar a Seguradora/Opção escolhida\n' },
      {
        text: '2. As propostas estão sujeitas à inspeção de risco; informar dados do contato para a mesma (Nome/Tel ou Cel / E-mail):\n',
      },
      { text: `    ${contatoResp}\n` },
      { text: `3. Cossegurado: ${cossegTexto}\n` },
      {
        text:
          '4. Gastos de Defesa nos Seguros de Responsabilidade Civil: deverá ser estabelecido um limite específico, onde as coberturas para "Custos de Defesa" e "Cobertura Básica (Indenização e Acordos)" a prejudicados não poderão compartilhar o mesmo limite. Desta forma, o segurado deverá determinar, dentro do Limite Máximo de Garantia (LMG) contratado, qual proporção será destinada a "Gastos de Defesa" e "Cobertura Básica (Indenização e Acordos)".\n' +
          'Sob nenhuma hipótese a Seguradora ou Corretora irá sugerir essa proporcionalidade, ficando sob responsabilidade integral do segurado essa definição. Este estudo contempla 100 mil a título de sugestão.\n' +
          `    Custos de Defesa: ${data.sugestaoCustosDefesa || '—'}       Indenizações e Acordos: ${vrdTotalFinal ? 'Saldo do LMG' : '____'}\n\n`,
      },
      {
        text: `• Observações: ${data.observacoesContratacao || '—'}\n\n`,
      },
      {
        text: `Data: ${data.dataApresentacaoTexto || '____/____/____'}       Assinatura do Responsável: ___________________________________       Cargo: ${data.assinaturaCargo || '_________________'}\n\n`,
      },
      {
        text: `Este documento é parte integrante do estudo do seguro patrimonial do ${data.empreendimentoNome}${data.cosseguradoNome ? ' e ' + data.cosseguradoNome : ''}, ${data.vigenciaTexto || ''}, apresentado em ${data.dataApresentacaoTexto || ''}.`,
        options: { fontSize: 7.5, italic: true, color: C_MUTED },
      },
    ],
    {
      x: GRID.marginLeft,
      y: 2.65,
      w: GRID.contentWidth,
      h: 2.55,
      fontFace: 'Arial',
      fontSize: 8,
      color: C_TEXT,
    },
  )

  // =========================================================================
  // SLIDE 12: Encerramento (Fixo)
  // =========================================================================
  const s12 = pptx.addSlide()

  // Foto à esquerda com arquitetura moderna
  if (includePhotos) {
    s12.addImage({
      path: 'https://img.usecurling.com/p/600/800?q=modern+glass+building+lobby&color=blue',
      x: 0,
      y: 0,
      w: 4.2,
      h: 5.625,
    })
  }

  // Logo Bycor superior direita no encerramento
  if (logoEncerramento) {
    s12.addImage(logoEncerramento)
  }

  // Bloco central: Obrigado e Mensagem institucional
  s12.addText(
    [
      { text: 'Obrigado\n\n', options: { fontSize: 36, bold: true, color: C_NAVY } },
      {
        text: 'Proteção sob medida para seus negócios !',
        options: { fontSize: 16, bold: true, color: C_BLUE },
      },
    ],
    { x: 4.6, y: 1.8, w: 5.0, h: 1.6, fontFace: 'Arial', align: 'center' },
  )

  // Contatos institucionais
  s12.addText(
    [
      { text: '🌐  www.bycor.com.br\n', options: { fontSize: 11, bold: true, color: C_BLUE } },
      { text: '💼  bycor_seguros\n', options: { fontSize: 11, color: C_NAVY } },
      { text: '📷  BYCOR Seguros\n', options: { fontSize: 11, color: C_NAVY } },
    ],
    { x: 4.8, y: 4.0, w: 4.8, h: 1.2, fontFace: 'Arial' },
  )

  // Barra Navy no rodapé
  s12.addShape(shapeRect, {
    x: 0,
    y: 5.5,
    w: 10,
    h: 0.125,
    fill: { color: C_NAVY },
    line: { color: C_NAVY },
  })

  // Retorna Uint8Array compatível com browser e node
  const output = await pptx.write({ outputType: 'uint8array' })
  if (output instanceof Uint8Array) return output
  if (output instanceof ArrayBuffer) return new Uint8Array(output)
  return new Uint8Array(output as any)
}
