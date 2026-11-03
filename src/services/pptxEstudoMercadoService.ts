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
} from './estudoMercadoResolver'
import { CoberturaCanonicaRecord, CoberturaSinonimoRecord } from './equivalenciaCoberturasService'
import { LOGO_BYCOR_PATH } from '@/assets/logoBycorBase64'

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

function addHeaderBycor(slide: pptxgen.Slide, titulo: string, numeroPagina: string) {
  // Título da página
  slide.addText([{ text: titulo, options: { fontSize: 22, bold: true, color: C_NAVY } }], {
    x: 0.6,
    y: 0.4,
    w: 7.2,
    h: 0.6,
    fontFace: 'Arial',
    margin: 0,
  })

  // Logo oficial da Bycor no canto superior direito (embutida como asset do pacote PPTX)
  slide.addImage({
    path: LOGO_BYCOR_PATH,
    x: 8.85,
    y: 0.28,
    w: 0.55,
    h: 0.72,
  })

  // Rodapé número de página "NN/12"
  slide.addText(numeroPagina, {
    x: 8.5,
    y: 5.2,
    w: 1.0,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 9,
    color: C_MUTED,
    align: 'right',
  })
}

/**
 * Gera os bytes PPTX de alta fidelidade ao PDF de 12 páginas do Estudo de Mercado.
 */
export async function generateEstudoMercadoPptx(
  data: EstudoMercadoEditavelData,
): Promise<Uint8Array> {
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

  // Faixa esquerda de ilustração / cor
  s1.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 4.4,
    h: 5.625,
    fill: { color: C_NAVY },
    line: { color: C_NAVY },
  })

  // Logo oficial Bycor em destaque na capa
  s1.addImage({
    path: LOGO_BYCOR_PATH,
    x: 0.6,
    y: 0.7,
    w: 1.1,
    h: 1.45,
  })

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
  addHeaderBycor(s2, 'Somos a BYCOR Seguros', '02/12')

  s2.addText(
    'A BYCOR Consultoria e Corretora de Seguros é especialista na transferência de riscos por meio de apólices de seguro, atuando com foco na proteção customizada de negócios e devidamente registrada na SUSEP.',
    { x: 0.6, y: 1.05, w: 8.8, h: 0.5, fontFace: 'Arial', fontSize: 10, color: C_TEXT },
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
      desc: 'Suporte dedicado para tomadas de decisão e gestão de seguros e foco na proteção customizada do seu negócio',
    },
  ]

  const cardW = 1.68
  const cardH = 2.0
  const startX = 0.6
  const gapX = 0.1
  const cardY = 1.65

  diferenciais.forEach((d, i) => {
    const xPos = startX + i * (cardW + gapX)
    s2.addShape(pptx.ShapeType.roundRect, {
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
  s2.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 3.8,
    w: 8.8,
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
    { x: 0.8, y: 3.9, w: 8.4, h: 1.1, fontFace: 'Arial' },
  )

  // =========================================================================
  // SLIDE 3: Conteúdo do Estudo (Índice)
  // =========================================================================
  const s3 = pptx.addSlide()
  addHeaderBycor(s3, 'Conteúdo do Estudo', '03/12')

  s3.addText(
    `Este estudo apresenta as cotações das Seguradoras para o Seguro Patrimonial do ${data.empreendimentoNome}${data.cosseguradoNome ? ' e do novo ' + data.cosseguradoNome : ''}, estruturado em seis blocos temáticos:`,
    { x: 0.6, y: 1.05, w: 8.8, h: 0.5, fontFace: 'Arial', fontSize: 10, color: C_TEXT },
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
  const bGapX = 0.25
  const bGapY = 0.25

  blocosIndice.forEach((b, idx) => {
    const col = idx % 3
    const row = Math.floor(idx / 3)
    const bx = 0.6 + col * (bW + bGapX)
    const by = 1.75 + row * (bH + bGapY)

    s3.addShape(pptx.ShapeType.roundRect, {
      x: bx,
      y: by,
      w: bW,
      h: bH,
      fill: { color: C_BG_CARD },
      line: { color: C_BORDER, width: 1 },
      rectRadius: 0.08,
    })

    // Barra azul superior
    s3.addShape(pptx.ShapeType.rect, {
      x: bx,
      y: by,
      w: bW,
      h: 0.06,
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
  addHeaderBycor(s4, 'Objetivo do Estudo', '04/12')

  // Card do texto do objetivo
  s4.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.05,
    w: 8.8,
    h: 2.1,
    fill: { color: C_BG_CARD },
    line: { color: C_BORDER, width: 1 },
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
    { x: 0.8, y: 1.15, w: 8.4, h: 1.9, fontFace: 'Arial' },
  )

  // 3 Fotos ilustrativas (conforme PDF de referência)
  const imgW = 2.8
  const imgH = 1.7
  const imgY = 3.3
  const imgGap = 0.2

  const fotoPlaceholders = [
    'https://img.usecurling.com/p/600/400?q=hotel+bedroom&color=blue',
    'https://img.usecurling.com/p/600/400?q=hotel+lounge&color=blue',
    'https://img.usecurling.com/p/600/400?q=hotel+suite&color=blue',
  ]

  fotoPlaceholders.forEach((url, i) => {
    const ix = 0.6 + i * (imgW + imgGap)
    s4.addImage({
      path: url,
      x: ix,
      y: imgY,
      w: imgW,
      h: imgH,
    })
  })

  // =========================================================================
  // SLIDE 5: Dados do Segurado e do Risco
  // =========================================================================
  const s5 = pptx.addSlide()
  addHeaderBycor(s5, 'Dados do Segurado e do Risco', '05/12')

  // Tabela esquerda: Dados cadastrais e operacionais do risco
  const rowsCadastrais: pptxgen.TableRow[] = [
    [
      { text: 'Campo', options: { bold: true, fill: { color: 'E2E8F0' }, fontSize: 8.5 } },
      { text: 'Informação', options: { bold: true, fill: { color: 'E2E8F0' }, fontSize: 8.5 } },
    ],
    [{ text: 'Segurado' }, { text: data.empreendimentoNome }],
    [{ text: 'CNPJ' }, { text: data.cnpj || '38.594.094/0001-47' }],
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
    [{ text: 'CNAE / Atividade' }, { text: data.cnaeAtividade || 'Hotel / Apart-Hotel' }],
    [{ text: 'Local do Risco' }, { text: data.enderecoTexto }],
    [
      { text: 'Construção' },
      {
        text:
          data.construcaoTexto ||
          'Tipo Superior – Alvenaria; 14.013m²; sem Isopainéis; 15 andares + 4 Subsolos; 298 Aptos; Estacionamento Terceirizado Rotativo c/ 250 vagas, 6 Elevadores, Academia, Chiller e Geradores.',
      },
    ],
    [
      { text: 'Protecionais' },
      {
        text:
          data.protecionaisTexto ||
          'Incêndio: Extintores, Hidrantes, Sprinklers, Detectores e Alarmes de Fumaça, Brigada de Incêndio, SPDA; RTI; C/Manutenção Preventiva das Instalações Elétricas.\nRoubo: recepção disponível 24 horas e serviço de segurança/atendimento contínuo na portaria CFTV, Cofres.',
      },
    ],
    [
      { text: 'Sinistros' },
      { text: data.sinistrosTexto || 'Seguro Novo → sem registros de sinistros' },
    ],
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
    x: 0.6,
    y: 1.05,
    w: 5.2,
    colW: [1.3, 3.9],
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.04,
  })

  // Tabela direita: Valores em Risco Declarados
  const vrdPredioStr = formatLmiEstudo(data.vrdPredio || 60000000)
  const vrdMmuStr = formatLmiEstudo(data.vrdMmu || 20000000)
  const vrdMmpStr = data.vrdMmp && data.vrdMmp > 0 ? formatLmiEstudo(data.vrdMmp) : '--'
  const vrdDmTotalStr = formatLmiEstudo(data.vrdDmTotal || 80000000)
  const vrdLcAnualStr = formatLmiEstudo(data.vrdLcAnual || 15000000)
  const vrdTotalStr = formatLmiEstudo(data.vrdDmPlusLc || 95000000)

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
    y: 1.05,
    w: 3.4,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 11,
    bold: true,
    color: C_NAVY,
  })

  s5.addTable(rowsVrd, {
    x: 6.0,
    y: 1.4,
    w: 3.4,
    colW: [2.2, 1.2],
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.05,
  })

  // =========================================================================
  // SLIDE 6: Marco Regulatório Nova Lei de Seguros 15.040/2024 (Fixo)
  // =========================================================================
  const s6 = pptx.addSlide()
  addHeaderBycor(s6, 'Informações', '06/12')

  s6.addText('Marco Regulatório Nova Lei de Seguros 15.040/2024 em vigor a partir de 11/12/2025', {
    x: 0.6,
    y: 1.0,
    w: 8.8,
    h: 0.35,
    fontFace: 'Arial',
    fontSize: 13,
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
    { x: 0.6, y: 1.4, w: 8.8, h: 3.7, fontFace: 'Arial', fontSize: 8.5, color: C_TEXT },
  )

  // =========================================================================
  // SLIDE 7: Seguradoras Consultadas
  // =========================================================================
  const s7 = pptx.addSlide()
  addHeaderBycor(s7, 'Seguradoras Consultadas', '07/12')

  // Card Cias que apresentaram Propostas
  s7.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.1,
    w: 5.0,
    h: 1.9,
    fill: { color: C_BG_CARD },
    line: { color: C_BORDER, width: 1 },
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
    { x: 0.8, y: 1.25, w: 4.6, h: 1.6, fontFace: 'Arial' },
  )

  // Card Cias em análise ou não apresentaram
  s7.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 3.2,
    w: 5.0,
    h: 1.9,
    fill: { color: C_BG_CARD },
    line: { color: C_BORDER, width: 1 },
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
    { x: 0.8, y: 3.35, w: 4.6, h: 1.6, fontFace: 'Arial' },
  )

  // Foto de fachada corporativa à direita
  s7.addImage({
    path: 'https://img.usecurling.com/p/600/800?q=modern+glass+building+headquarters&color=blue',
    x: 5.9,
    y: 1.1,
    w: 3.5,
    h: 4.0,
  })

  // =========================================================================
  // SLIDE 8: Prêmios
  // =========================================================================
  const s8 = pptx.addSlide()
  addHeaderBycor(s8, 'Prêmios', '08/12')

  // Cabeçalho da tabela de prêmios por cia
  const colCias =
    data.propostas && data.propostas.length > 0
      ? data.propostas
      : [
          {
            id: 'demo1',
            seguradoraNome: 'SWISS RE',
            premioTotalComIof: 56344,
            parcelamentoSemJurosTexto: '7x',
            numeroCoberturas: 31,
            coberturasOriginais: [],
          },
          {
            id: 'demo2',
            seguradoraNome: 'ALLIANZ',
            premioTotalComIof: 74323,
            parcelamentoSemJurosTexto: '4x',
            numeroCoberturas: 24,
            coberturasOriginais: [],
          },
          {
            id: 'demo3',
            seguradoraNome: 'PORTO',
            premioTotalComIof: 88370,
            parcelamentoSemJurosTexto: '6x',
            numeroCoberturas: 33,
            coberturasOriginais: [],
          },
          {
            id: 'demo4',
            seguradoraNome: 'AXA 1',
            premioTotalComIof: 62335,
            parcelamentoSemJurosTexto: '4x',
            numeroCoberturas: 42,
            coberturasOriginais: [],
          },
          {
            id: 'demo5',
            seguradoraNome: 'AXA 2',
            premioTotalComIof: 49772,
            parcelamentoSemJurosTexto: '4x',
            numeroCoberturas: 42,
            coberturasOriginais: [],
          },
        ]

  const numColCias = colCias.length
  const colWPrimeira = 2.8
  const colWRestante = (8.8 - colWPrimeira) / numColCias
  const colWArrayPremios = [colWPrimeira, ...Array(numColCias).fill(colWRestante)]

  const rowsPremios: pptxgen.TableRow[] = [
    [
      {
        text: 'Item',
        options: { bold: true, fill: { color: C_NAVY }, color: C_WHITE, fontSize: 8.5 },
      },
      {
        text: 'Dados / Opções',
        options: {
          bold: true,
          fill: { color: C_NAVY },
          color: C_WHITE,
          fontSize: 8.5,
          align: 'center',
          colspan: numColCias,
        },
      },
    ],
    [
      { text: 'Valor em Risco Declarado – D.Materiais' },
      { text: vrdDmTotalStr, options: { align: 'center', bold: true, colspan: numColCias } },
    ],
    [
      { text: 'Valor em Risco Declarado – Lucros Cessantes – L. Bruto (12 meses)' },
      { text: vrdLcAnualStr, options: { align: 'center', bold: true, colspan: numColCias } },
    ],
    [
      { text: 'Seguradora', options: { bold: true, fill: { color: 'F1F5F9' } } },
      ...colCias.map((p) => {
        const nome = p.opcao ? `${p.seguradoraNome} (Opção ${p.opcao})` : p.seguradoraNome
        return {
          text: nome,
          options: { bold: true, fill: { color: 'F1F5F9' }, align: 'center' as const },
        }
      }),
    ],
    [
      { text: 'Prêmio Total (com IOF) R$', options: { bold: true, color: C_NAVY } },
      ...colCias.map((p) => ({
        text: formatLmiEstudo(p.premioTotalComIof),
        options: { bold: true, fontSize: 10, color: C_NAVY, align: 'center' as const },
      })),
    ],
    [
      { text: 'Parcelamento sem Juros' },
      ...colCias.map((p) => ({
        text: p.parcelamentoSemJurosTexto || '1x',
        options: { align: 'center' as const, bold: true },
      })),
    ],
    [
      { text: 'Nº de Coberturas' },
      ...colCias.map((p) => ({
        text: String(p.numeroCoberturas || p.coberturasOriginais?.length || 42),
        options: { align: 'center' as const, bold: true },
      })),
    ],
  ]

  s8.addTable(rowsPremios, {
    x: 0.6,
    y: 1.05,
    w: 8.8,
    colW: colWArrayPremios,
    border: { pt: 0.5, color: C_BORDER },
    margin: 0.05,
  })

  // Rodapé técnico do slide de prêmios: Risco Relativo vs Risco Absoluto
  s8.addText(
    [
      {
        text: 'Patrimonial - Tipo de Cobertura\n\n',
        options: {
          bold: true,
          fontSize: 9.5,
          color: C_NAVY,
          underline: { style: 'sng', color: C_NAVY },
        },
      },
      {
        text: 'Básica: 1º Risco Relativo     |     Lucros Cessantes: 1º Risco Relativo     |     Demais Coberturas: 1º Risco Absoluto\n\n',
        options: { bold: true, fontSize: 8.5, color: C_TEXT },
      },
      {
        text: '• Risco Relativo = Se o Valor em Risco Declarado na apólice for inferior a 80% do Valor em Risco apurado no momento do sinistro, será aplicada Cláusula de Rateio.\n',
        options: { fontSize: 8, color: C_MUTED },
      },
      {
        text: '• Risco Absoluto = Indenização pelo valor integral de qualquer sinistro até o Limite Máximo de Indenização da cobertura reivindicada/contratada.\n',
        options: { fontSize: 8, color: C_MUTED },
      },
      {
        text: '• Demais coberturas/exclusões conforme Condições Gerais das Seguradoras',
        options: { fontSize: 8, color: C_MUTED },
      },
    ],
    { x: 0.6, y: 3.8, w: 8.8, h: 1.4, fontFace: 'Arial' },
  )

  // =========================================================================
  // SLIDE 9: Tabela Comparativa de Coberturas (42 linhas canônicas)
  // Paginação inteligente: O Estudo exibe a descrição COMPLETA da cobertura canônica
  // (decisão do analista). Para comportar linhas mais altas sem estourar o slide (h=5.625"),
  // paginamos em 3 slides de 14 linhas (14 + 14 + 14 = 42).
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
    addHeaderBycor(sCob, 'Tabela Comparativa de Coberturas', subNum)

    // Cabeçalho
    const headerRow: pptxgen.TableRow = [
      {
        text: 'COBERTURAS',
        options: { bold: true, fill: { color: C_NAVY }, color: C_WHITE, fontSize: 6.8 },
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
        const numCob = c.numeroCoberturas || c.coberturasOriginais?.length || 42
        const nome = c.opcao ? `${c.seguradoraNome} (${numCob})` : `${c.seguradoraNome} (${numCob})`
        return {
          text: nome,
          options: {
            bold: true,
            fill: { color: C_NAVY },
            color: C_WHITE,
            fontSize: 6.8,
            align: 'center' as const,
          },
        }
      }),
    ]

    const dataRows: pptxgen.TableRow[] = linhasChunk.map((linha, lIdx) => {
      const bg = lIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC'
      const solStr =
        typeof linha.item.lmiSolicitado === 'number'
          ? formatLmiEstudo(linha.item.lmiSolicitado)
          : String(linha.item.lmiSolicitado || '—')

      // Exibe a nomenclatura da Taxonomia (campo nome da coberturas_canonicas)
      const textoNome = linha.item.nome || linha.item.titulo

      return [
        {
          text: `${linha.item.numero}  ${textoNome}`,
          options: { bold: true, fontSize: 6.2, color: C_NAVY, fill: { color: bg } },
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
          const cell = linha.celulasPorProposta.get(c.id)
          const val = cell?.valorFormatado || 'X'
          const isAbaixo = cell?.abaixoDoSolicitado
          const isX = val === 'X'
          const fontColor = isX ? '94A3B8' : isAbaixo ? 'B91C1C' : C_TEXT
          return {
            text: val,
            options: {
              fontSize: 6.2,
              color: fontColor,
              fill: { color: bg },
              align: 'center' as const,
              bold: isAbaixo || val === '✓',
            },
          }
        }),
      ]
    })

    // Se for o último slide de coberturas (3/3), inclui a linha final de Prêmio Bruto (R$)
    if (chunkIdx === chunksLinhas.length - 1) {
      dataRows.push([
        {
          text: 'Prêmio Bruto (R$)',
          options: { bold: true, fill: { color: 'EFF6FF' }, fontSize: 7, color: C_NAVY },
        },
        { text: '', options: { fill: { color: 'EFF6FF' } } },
        ...colCias.map((c) => ({
          text: formatLmiEstudo(c.premioTotalComIof),
          options: {
            bold: true,
            fill: { color: 'EFF6FF' },
            fontSize: 7,
            color: C_NAVY,
            align: 'center' as const,
          },
        })),
      ])
    }

    // Aumenta a coluna do nome para 4.1 polegadas para acomodar as descrições completas
    const colWNome = 4.1
    const colWSol = 1.2
    const colWCiasCob = (8.8 - colWNome - colWSol) / numColCias

    sCob.addTable([headerRow, ...dataRows], {
      x: 0.6,
      y: 0.95,
      w: 8.8,
      colW: [colWNome, colWSol, ...Array(numColCias).fill(colWCiasCob)],
      border: { pt: 0.5, color: C_BORDER },
      margin: 0.02,
    })
  })

  // =========================================================================
  // SLIDE 10: Tabela Comparativa de POS & Franquias (42 linhas canônicas)
  // Paginamos também em 3 slides de 14 linhas (14 + 14 + 14 = 42) para
  // acomodar as descrições completas das coberturas e as franquias no padrão X% min R$Y.
  // =========================================================================
  chunksLinhas.forEach((linhasChunk, chunkIdx) => {
    const sPos = pptx.addSlide()
    const subNum =
      chunkIdx === 0 ? '10/12' : chunkIdx === 1 ? '10/12 (cont. 1/2)' : '10/12 (cont. 2/2)'
    addHeaderBycor(sPos, 'Tabela Comparativa de POS & Franquias', subNum)

    const headerRow: pptxgen.TableRow = [
      {
        text: 'COBERTURAS',
        options: { bold: true, fill: { color: C_NAVY }, color: C_WHITE, fontSize: 6.8 },
      },
      ...colCias.map((c) => {
        const numCob = c.numeroCoberturas || c.coberturasOriginais?.length || 42
        return {
          text: `${c.seguradoraNome} (${numCob})`,
          options: {
            bold: true,
            fill: { color: C_NAVY },
            color: C_WHITE,
            fontSize: 6.8,
            align: 'center' as const,
          },
        }
      }),
    ]

    const dataRows: pptxgen.TableRow[] = linhasChunk.map((linha, lIdx) => {
      const bg = lIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC'

      // Exibe a nomenclatura da Taxonomia (campo nome da coberturas_canonicas)
      const textoNome = linha.item.nome || linha.item.titulo

      return [
        {
          text: `${linha.item.numero}  ${textoNome}`,
          options: { bold: true, fontSize: 6.2, color: C_NAVY, fill: { color: bg } },
        },
        ...colCias.map((c) => {
          const cell = linha.celulasPorProposta.get(c.id)
          const franq = cell?.franquiaTexto || 'Não há'
          const isX = franq === 'X'
          return {
            text: franq,
            options: {
              fontSize: 6.2,
              color: isX ? '94A3B8' : C_TEXT,
              fill: { color: bg },
              align: 'center' as const,
            },
          }
        }),
      ]
    })

    const colWNomePos = 4.2
    const colWCiasPos = (8.8 - colWNomePos) / numColCias

    sPos.addTable([headerRow, ...dataRows], {
      x: 0.6,
      y: 0.95,
      w: 8.8,
      colW: [colWNomePos, ...Array(numColCias).fill(colWCiasPos)],
      border: { pt: 0.5, color: C_BORDER },
      margin: 0.02,
    })

    // Rodapé de asterisco obrigatório em todos os slides de POS
    sPos.addText('* POS & Franquia por Reclamante, Evento, Veículo, Equipamento.', {
      x: 0.6,
      y: 5.25,
      w: 7.5,
      h: 0.25,
      fontFace: 'Arial',
      fontSize: 7.5,
      italic: true,
      color: C_MUTED,
    })
  })

  // =========================================================================
  // SLIDE 11: Opções de Contratação (Editável)
  // =========================================================================
  const s11 = pptx.addSlide()
  addHeaderBycor(s11, 'Opções de Contratação', '11/12')

  // Tabela compacta com as opções no topo
  const rowsOpcoesContratacao: pptxgen.TableRow[] = [
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
      { text: 'Opção de Contratação', options: { bold: true } },
      ...colCias.map(() => ({ text: '(   )', options: { align: 'center' as const, bold: true } })),
    ],
    [
      { text: 'Seguradora', options: { bold: true } },
      ...colCias.map((c) => ({
        text: c.seguradoraNome,
        options: { align: 'center' as const, bold: true },
      })),
    ],
    [
      { text: 'Prêmio Total (com IOF) R$', options: { bold: true, color: C_NAVY } },
      ...colCias.map((c) => ({
        text: formatLmiEstudo(c.premioTotalComIof),
        options: { align: 'center' as const, bold: true },
      })),
    ],
    [
      { text: 'Parcelamento sem Juros' },
      ...colCias.map((c) => ({
        text: c.parcelamentoSemJurosTexto || '1x',
        options: { align: 'center' as const },
      })),
    ],
    [
      { text: 'Nº de Coberturas' },
      ...colCias.map((c) => ({
        text: String(c.numeroCoberturas || 42),
        options: { align: 'center' as const },
      })),
    ],
  ]

  s11.addTable(rowsOpcoesContratacao, {
    x: 0.6,
    y: 0.95,
    w: 8.8,
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
          `    Custos de Defesa: ${data.sugestaoCustosDefesa || 'R$ 100.000,00'}       Indenizações e Acordos: ${data.vrdDmPlusLc ? 'Saldo do LMG' : '____'}\n\n`,
      },
      {
        text: `• Observações: ${data.observacoesContratacao || 'A seguradora terá prazo de até 25 dias para avaliação do risco.'}\n\n`,
      },
      {
        text: `Data: ${data.dataApresentacaoTexto || '____/____/2026'}       Assinatura do Responsável: ___________________________________       Cargo: ${data.assinaturaCargo || '_________________'}\n\n`,
      },
      {
        text: `Este documento é parte integrante do estudo do seguro patrimonial do ${data.empreendimentoNome}${data.cosseguradoNome ? ' e ' + data.cosseguradoNome : ''}, ${data.vigenciaTexto}, apresentado em ${data.dataApresentacaoTexto || '28/10/2026'}.`,
        options: { fontSize: 7.5, italic: true, color: C_MUTED },
      },
    ],
    { x: 0.6, y: 2.7, w: 8.8, h: 2.5, fontFace: 'Arial', fontSize: 8, color: C_TEXT },
  )

  // =========================================================================
  // SLIDE 12: Encerramento (Fixo)
  // =========================================================================
  const s12 = pptx.addSlide()

  // Foto à esquerda com arquitetura moderna
  s12.addImage({
    path: 'https://img.usecurling.com/p/600/800?q=modern+glass+building+lobby&color=blue',
    x: 0,
    y: 0,
    w: 4.2,
    h: 5.625,
  })

  // Logo Bycor superior direita no encerramento
  s12.addImage({
    path: LOGO_BYCOR_PATH,
    x: 8.8,
    y: 0.35,
    w: 0.65,
    h: 0.85,
  })

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
  s12.addShape(pptx.ShapeType.rect, {
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
