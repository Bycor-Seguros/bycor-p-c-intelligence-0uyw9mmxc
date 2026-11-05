/**
 * Gerador de apresentações comerciais (.pptx) para o Módulo C4 (Apresentação Comercial ao Segurado).
 * Utiliza a biblioteca profissional PptxGenJS para garantir 100% de conformidade com o Microsoft PowerPoint
 * em macOS (evitando janelas de aviso de reparo) e Windows, além de Keynote e Google Slides.
 */
import pptxgen from 'pptxgenjs'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { LOGO_BYCOR_PATH, isLogoMediaAvailable } from '@/assets/logoBycorBase64'

export interface PptxCoverageItem {
  nome: string
  lmi: number | null
  franquia: string
}

export interface PptxPresentationData {
  clienteNome: string
  razaoSocial?: string
  cidade?: string
  uf?: string
  areaConstruida?: number
  seguradoraNome: string
  premioBruto: number
  lmiLmg: number
  recomendacao: string
  coberturas: PptxCoverageItem[]
}

const BRAND_NAVY = '0F2B46'
const BRAND_BLUE = '16578B'
const BRAND_LIGHT_BLUE = '60A5FA'
const BRAND_BG_GRAY = 'F8FAFC'
const BRAND_BORDER_GRAY = 'E2E8F0'
const BRAND_TEXT_MUTED = '64748B'
const BRAND_TEXT_DARK = '1E293B'

/**
 * Constrói e gera os bytes do PPTX usando PptxGenJS com os slides idênticos aos anteriores:
 * 1. Capa Executiva Bycor
 * 2. Perfil Operacional do Segurado & Estrutura Financeira Recomendada
 * 3..N. Resumo de Coberturas Incluídas (paginadas em blocos de 7 linhas)
 * Final. Parecer Técnico da Corretora & Assinaturas de Aceite
 */
export interface GeneratePptxOptions {
  /** Incluir a mídia do logotipo Bycor (desativado no fallback do harness Node sem mídia em disco) */
  includeLogo?: boolean
}

export async function generatePresentationPptx(
  data: PptxPresentationData,
  options: GeneratePptxOptions = {},
): Promise<Uint8Array> {
  const { includeLogo = true } = options
  // Mídia indisponível (Node sem acesso ao disco): omitir o logo em vez de abortar.
  const logoUsavel = includeLogo && isLogoMediaAvailable()
  const logoImage = logoUsavel
    ? {
        path: LOGO_BYCOR_PATH,
        x: 7.8,
        y: 0.9,
        w: 0.9,
        h: 1.18,
      }
    : null
  const logoMarcaDiscreta = logoUsavel
    ? {
        path: LOGO_BYCOR_PATH,
        x: 8.85,
        y: 0.28,
        w: 0.55,
        h: 0.72,
      }
    : null

  const pptx = new pptxgen()

  // Layout Widescreen 16:9 (10" x 5.625")
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'Bycor P&C Intelligence'
  pptx.company = 'Bycor Consultoria e Corretora de Seguros'
  pptx.title = `${data.clienteNome || 'Cliente'} - Apresentação Comercial Bycor`

  // ----------------------------------------------------
  // SLIDE 1: Capa Institucional Executiva Bycor
  // ----------------------------------------------------
  const slide1 = pptx.addSlide()

  // Cartão Navy de fundo com borda azul
  slide1.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 0.6,
    w: 8.4,
    h: 4.4,
    fill: { color: BRAND_NAVY },
    line: { color: BRAND_BLUE, width: 1.5 },
    rectRadius: 0.15,
  })

  // Logo oficial da Bycor no canto superior direito do card
  if (logoImage) {
    slide1.addImage(logoImage)
  }

  // Tag superior Bycor
  slide1.addText('BYCOR CONSULTORIA E CORRETORA DE SEGUROS', {
    x: 1.2,
    y: 1.0,
    w: 6.4,
    h: 0.4,
    fontFace: 'Arial',
    fontSize: 11,
    bold: true,
    color: BRAND_LIGHT_BLUE,
    margin: 0,
  })

  // Título e Subtítulo
  slide1.addText(
    [
      {
        text: 'Apresentação Comercial ao Segurado\n',
        options: { fontSize: 24, bold: true, color: 'FFFFFF' },
      },
      {
        text: 'Relatório Técnico de Recomendação & Minuta Executiva P&C',
        options: { fontSize: 13, color: '94A3B8' },
      },
    ],
    {
      x: 1.2,
      y: 1.6,
      w: 7.6,
      h: 1.3,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // Bloco de Identificação do Cliente e Data
  const emissionDateStr = formatDate(new Date().toISOString())
  slide1.addText(
    [
      {
        text: 'Cliente / Empreendimento: ',
        options: { fontSize: 12, bold: true, color: '93C5FD' },
      },
      {
        text: `${data.clienteNome || 'Cliente Corporativo'}\n`,
        options: { fontSize: 13, bold: true, color: 'FFFFFF' },
      },
      {
        text: `Data de Emissão: ${emissionDateStr} | Versão Executiva 1.0`,
        options: { fontSize: 10, color: 'CBD5E1' },
      },
    ],
    {
      x: 1.2,
      y: 3.3,
      w: 7.6,
      h: 1.2,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // ----------------------------------------------------
  // SLIDE 2: Perfil Operacional & Estrutura da Apólice Recomendada
  // ----------------------------------------------------
  const slide2 = pptx.addSlide()

  // Título do Slide
  slide2.addText('1. Perfil Operacional & Estrutura Recomendada', {
    x: 0.6,
    y: 0.4,
    w: 7.8,
    h: 0.5,
    fontFace: 'Arial',
    fontSize: 18,
    bold: true,
    color: BRAND_NAVY,
    margin: 0,
  })

  // Marca discreta da Bycor no topo direito
  if (logoMarcaDiscreta) {
    slide2.addImage(logoMarcaDiscreta)
  }

  // Card superior: Dados Operacionais do Cliente
  slide2.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.05,
    w: 8.8,
    h: 1.7,
    fill: { color: BRAND_BG_GRAY },
    line: { color: BRAND_BORDER_GRAY, width: 1 },
    rectRadius: 0.1,
  })

  const areaStr = data.areaConstruida ? `${data.areaConstruida} m²` : '—'
  const locStr = `${data.cidade || 'São Paulo'} - ${data.uf || 'SP'}`

  slide2.addText(
    [
      {
        text: 'DADOS OPERACIONAIS DO CLIENTE\n',
        options: { fontSize: 10, bold: true, color: BRAND_BLUE },
      },
      {
        text: 'Empreendimento: ',
        options: { fontSize: 10, bold: true, color: '334155' },
      },
      {
        text: `${data.clienteNome || '—'}\n`,
        options: { fontSize: 10, color: BRAND_NAVY },
      },
      {
        text: 'Razão Social: ',
        options: { fontSize: 10, bold: true, color: '334155' },
      },
      {
        text: `${data.razaoSocial || 'Não informado'}\n`,
        options: { fontSize: 10, color: BRAND_NAVY },
      },
      {
        text: 'Localização: ',
        options: { fontSize: 10, bold: true, color: '334155' },
      },
      {
        text: `${locStr}          `,
        options: { fontSize: 10, color: BRAND_NAVY },
      },
      {
        text: 'Área Construída: ',
        options: { fontSize: 10, bold: true, color: '334155' },
      },
      {
        text: `${areaStr}`,
        options: { fontSize: 10, color: BRAND_NAVY },
      },
    ],
    {
      x: 0.8,
      y: 1.15,
      w: 8.4,
      h: 1.5,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // 3 Cards inferiores: Seguradora Recomendada, LMI/LMG, Investimento (Prêmio Total)
  const cardY = 2.9
  const cardW = 2.8
  const cardH = 2.2
  const gap = 0.2

  // Card 1: Seguradora Recomendada
  const card1X = 0.6
  slide2.addShape(pptx.ShapeType.roundRect, {
    x: card1X,
    y: cardY,
    w: cardW,
    h: cardH,
    fill: { color: 'EFF6FF' },
    line: { color: 'BFDBFE', width: 1 },
    rectRadius: 0.1,
  })
  slide2.addText(
    [
      {
        text: 'SEGURADORA RECOMENDADA\n\n',
        options: { fontSize: 9, bold: true, color: '2563EB' },
      },
      {
        text: `${data.seguradoraNome || 'Seguradora Selecionada'}\n\n`,
        options: { fontSize: 12, bold: true, color: BRAND_NAVY },
      },
      {
        text: 'Avaliação técnica aprovada no comitê de colocação de risco Bycor.',
        options: { fontSize: 9, color: BRAND_TEXT_MUTED },
      },
    ],
    {
      x: card1X + 0.15,
      y: cardY + 0.15,
      w: cardW - 0.3,
      h: cardH - 0.3,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // Card 2: LMI / LMG Consolidado
  const card2X = card1X + cardW + gap
  slide2.addShape(pptx.ShapeType.roundRect, {
    x: card2X,
    y: cardY,
    w: cardW,
    h: cardH,
    fill: { color: BRAND_BG_GRAY },
    line: { color: 'CBD5E1', width: 1 },
    rectRadius: 0.1,
  })
  slide2.addText(
    [
      {
        text: 'LMI / LMG CONSOLIDADO\n\n',
        options: { fontSize: 9, bold: true, color: BRAND_TEXT_MUTED },
      },
      {
        text: `${formatCurrency(data.lmiLmg)}\n\n`,
        options: { fontSize: 13, bold: true, color: BRAND_NAVY },
      },
      {
        text: 'Garantia patrimonial máxima contratada por evento.',
        options: { fontSize: 9, color: BRAND_TEXT_MUTED },
      },
    ],
    {
      x: card2X + 0.15,
      y: cardY + 0.15,
      w: cardW - 0.3,
      h: cardH - 0.3,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // Card 3: Investimento (Prêmio Total)
  const card3X = card2X + cardW + gap
  slide2.addShape(pptx.ShapeType.roundRect, {
    x: card3X,
    y: cardY,
    w: cardW,
    h: cardH,
    fill: { color: 'F0FDF4' },
    line: { color: 'BBF7D0', width: 1 },
    rectRadius: 0.1,
  })
  slide2.addText(
    [
      {
        text: 'INVESTIMENTO (PRÊMIO TOTAL)\n\n',
        options: { fontSize: 9, bold: true, color: '16A34A' },
      },
      {
        text: `${formatCurrency(data.premioBruto)}\n\n`,
        options: { fontSize: 13, bold: true, color: '14532D' },
      },
      {
        text: 'Com IOF incluso · Condições negociadas de mercado.',
        options: { fontSize: 9, color: '15803D' },
      },
    ],
    {
      x: card3X + 0.15,
      y: cardY + 0.15,
      w: cardW - 0.3,
      h: cardH - 0.3,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // ----------------------------------------------------
  // SLIDES 3..N: Coberturas Tabuladas (blocos de até 7 linhas por slide)
  // ----------------------------------------------------
  const LINES_PER_SLIDE = 7
  const MAX_TOTAL_SLIDES = 20
  const FIXED_NON_COVERAGE_SLIDES = 3 // Slide 1 (capa), Slide 2 (perfil), Slide Final (parecer)
  const MAX_COVERAGE_SLIDES = Math.max(1, MAX_TOTAL_SLIDES - FIXED_NON_COVERAGE_SLIDES)

  const coverageChunks: PptxCoverageItem[][] = []
  if (data.coberturas && data.coberturas.length > 0) {
    for (let i = 0; i < data.coberturas.length; i += LINES_PER_SLIDE) {
      if (coverageChunks.length >= MAX_COVERAGE_SLIDES) break
      coverageChunks.push(data.coberturas.slice(i, i + LINES_PER_SLIDE))
    }
  } else {
    coverageChunks.push([])
  }

  const numCoverageSlides = coverageChunks.length

  coverageChunks.forEach((chunk, chunkIdx) => {
    const k = chunkIdx + 1
    const n = numCoverageSlides
    const slideCoverage = pptx.addSlide()

    const slideTitle =
      k === 1
        ? `2. Resumo de Coberturas Incluídas (Parte 1/${n})`
        : `Continuação — Coberturas (${k}/${n})`

    slideCoverage.addText(slideTitle, {
      x: 0.6,
      y: 0.4,
      w: 7.8,
      h: 0.5,
      fontFace: 'Arial',
      fontSize: 18,
      bold: true,
      color: BRAND_NAVY,
      margin: 0,
    })

    // Marca discreta da Bycor no topo direito
    if (logoMarcaDiscreta) {
      slideCoverage.addImage(logoMarcaDiscreta)
    }

    // Cabeçalho da tabela com 3 colunas padrão
    const tableRows: pptxgen.TableRow[] = [
      [
        {
          text: 'Garantia / Cobertura Contratada',
          options: {
            bold: true,
            color: 'FFFFFF',
            fill: { color: BRAND_NAVY },
            fontSize: 10,
            align: 'left',
            valign: 'middle',
          },
        },
        {
          text: 'Limite (LMI)',
          options: {
            bold: true,
            color: 'FFFFFF',
            fill: { color: BRAND_NAVY },
            fontSize: 10,
            align: 'right',
            valign: 'middle',
          },
        },
        {
          text: 'Franquia / POS',
          options: {
            bold: true,
            color: 'FFFFFF',
            fill: { color: BRAND_NAVY },
            fontSize: 10,
            align: 'left',
            valign: 'middle',
          },
        },
      ],
    ]

    if (chunk.length > 0) {
      chunk.forEach((c, idx) => {
        const bgClr = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC'
        const nomeText = c.nome?.trim() || 'Cobertura Contratada'
        const lmiText =
          c.lmi !== null && c.lmi !== undefined ? formatCurrency(c.lmi) : 'Consulte Apólice'
        const franqText = c.franquia?.trim() || 'Padrão da Seguradora'

        tableRows.push([
          {
            text: nomeText,
            options: {
              bold: true,
              color: BRAND_NAVY,
              fill: { color: bgClr },
              fontSize: 9,
              align: 'left',
              valign: 'middle',
            },
          },
          {
            text: lmiText,
            options: {
              bold: true,
              color: BRAND_NAVY,
              fill: { color: bgClr },
              fontSize: 9,
              align: 'right',
              valign: 'middle',
            },
          },
          {
            text: franqText,
            options: {
              color: '475569',
              fill: { color: bgClr },
              fontSize: 9,
              align: 'left',
              valign: 'middle',
            },
          },
        ])
      })
    } else {
      const lmiVal = formatCurrency(data.lmiLmg) || 'Consulte Apólice'
      tableRows.push([
        {
          text: 'Incêndio Básica (Danos Materiais)',
          options: {
            color: BRAND_TEXT_MUTED,
            fill: { color: 'FFFFFF' },
            fontSize: 9,
            align: 'left',
            valign: 'middle',
          },
        },
        {
          text: lmiVal,
          options: {
            bold: true,
            color: BRAND_NAVY,
            fill: { color: 'FFFFFF' },
            fontSize: 9,
            align: 'right',
            valign: 'middle',
          },
        },
        {
          text: 'Padrão de mercado',
          options: {
            color: '475569',
            fill: { color: 'FFFFFF' },
            fontSize: 9,
            align: 'left',
            valign: 'middle',
          },
        },
      ])
    }

    // Adiciona tabela ao slide
    slideCoverage.addTable(tableRows, {
      x: 0.6,
      y: 1.1,
      w: 8.8,
      colW: [4.2, 2.3, 2.3],
      border: { pt: 0.5, color: 'E2E8F0' },
      margin: 0.08,
    })
  })

  // ----------------------------------------------------
  // SLIDE FINAL: Parecer Técnico & Recomendação da Corretora
  // ----------------------------------------------------
  const slideFinal = pptx.addSlide()

  slideFinal.addText('3. Parecer Técnico & Recomendação da Corretora', {
    x: 0.6,
    y: 0.4,
    w: 7.8,
    h: 0.5,
    fontFace: 'Arial',
    fontSize: 18,
    bold: true,
    color: BRAND_NAVY,
    margin: 0,
  })

  // Marca discreta da Bycor no topo direito
  if (logoMarcaDiscreta) {
    slideFinal.addImage(logoMarcaDiscreta)
  }

  // Card do Parecer
  slideFinal.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.05,
    w: 8.8,
    h: 2.8,
    fill: { color: BRAND_BG_GRAY },
    line: { color: 'CBD5E1', width: 1 },
    rectRadius: 0.1,
  })

  slideFinal.addText(
    [
      {
        text: 'PARECER TÉCNICO BYCOR CONSULTORIA:\n\n',
        options: { fontSize: 10, bold: true, color: BRAND_BLUE },
      },
      {
        text: data.recomendacao || 'Recomendamos a contratação da apólice recomendada.',
        options: { fontSize: 10, color: BRAND_TEXT_DARK },
      },
    ],
    {
      x: 0.8,
      y: 1.2,
      w: 8.4,
      h: 2.5,
      fontFace: 'Arial',
      margin: 0,
    },
  )

  // Bloco de Assinaturas
  // Linha 1: Bycor Seguros
  slideFinal.addShape(pptx.ShapeType.line, {
    x: 1.0,
    y: 4.4,
    w: 3.2,
    h: 0,
    line: { color: '94A3B8', width: 1 },
  })
  slideFinal.addText(
    [
      {
        text: 'BYCOR Seguros\n',
        options: { fontSize: 10, bold: true, color: BRAND_NAVY },
      },
      {
        text: 'Consultoria Técnica P&C',
        options: { fontSize: 9, color: BRAND_TEXT_MUTED },
      },
    ],
    {
      x: 1.0,
      y: 4.45,
      w: 3.2,
      h: 0.7,
      fontFace: 'Arial',
      align: 'center',
      margin: 0,
    },
  )

  // Linha 2: Segurado
  slideFinal.addShape(pptx.ShapeType.line, {
    x: 5.8,
    y: 4.4,
    w: 3.2,
    h: 0,
    line: { color: '94A3B8', width: 1 },
  })
  slideFinal.addText(
    [
      {
        text: `${data.clienteNome || 'De Acordo do Segurado'}\n`,
        options: { fontSize: 10, bold: true, color: BRAND_NAVY },
      },
      {
        text: 'Assinatura de Aceite do Segurado',
        options: { fontSize: 9, color: BRAND_TEXT_MUTED },
      },
    ],
    {
      x: 5.8,
      y: 4.45,
      w: 3.2,
      h: 0.7,
      fontFace: 'Arial',
      align: 'center',
      margin: 0,
    },
  )

  // Gera o buffer em formato uint8array compatível com Node e Browser
  const output = await pptx.write({ outputType: 'uint8array' })
  if (output instanceof Uint8Array) {
    return output
  }
  if (output instanceof ArrayBuffer) {
    return new Uint8Array(output)
  }
  return new Uint8Array(output as any)
}
