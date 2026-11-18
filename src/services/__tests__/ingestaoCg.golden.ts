/**
 * Casos golden novos da suíte "Ingestão CGs".
 *
 * IMPORTANTE: nenhum conteúdo dos PDFs reais do usuário entra aqui. As fixtures
 * usam frases ESTRUTURAIS genéricas (Sumário, COBERTURA ADICIONAL ...,
 * RISCOS EXCLUÍDOS, alíneas a), b)...), escritas do zero para validar as
 * heurísticas do leitor — mesmo padrão das fixtures QAR.
 * run-golden-tests.ts importa esta função e chama dentro de runAllSuites().
 */

import type { PdfPageText, PdfTextFragment } from '@/services/pdfTextExtractor'
import {
  lerCondicoesGerais,
  tituloEhCobertura,
  ehFragmentoFraseCg,
  ehLinhaSumario,
  extrairExclusoesDoBloco,
  ehContinuacaoCabecalhoExclusoes,
  RE_INICIO_EXCLUSOES,
  chaveGuardaCg,
  chaveDedupTituloCg,
  detectarProcessoSusepCg,
  detectarProcessoSusepNomeArquivo,
  detectarProdutoVersaoCg,
  detectarPdfSemTextoCg,
  mensagemPdfSemTextoCg,
  tituloEhCoberturaZurich,
} from '@/services/cgIngestaoReader'
import {
  casarComMotorC3,
  calcularItensGuardaCg,
  LIMIAR_CONFIANCA_CG,
} from '@/services/cgIngestaoService'
import { dividirEmLotes, calcularPausaProgressiva } from '@/services/pocketbaseWriteHelper'
import {
  normalizarTermoC3,
  normalizarTermoEquivalencia,
  type CoberturaCanonicaRecord,
} from '@/services/equivalenciaCoberturasService'
import { normalizeMatchText } from '@/services/guardiaImporter'
import { RE_CAUDA_VALOR_EXTESTO_ZURICH } from '@/services/cgIngestaoReader'


// ---------------------------------------------------------------------------
// Helpers de fixture (estrutura genérica, zero texto real)
// ---------------------------------------------------------------------------

function frag(str: string, y: number): PdfTextFragment {
  return { str, x: 0, y }
}

function page(pageNumber: number, linhas: Array<[string, number]>): PdfPageText {
  return {
    pageNumber,
    text: linhas.map(([l]) => l).join('\n'),
    items: linhas.map(([l, y]) => frag(l, y)),
    lines: linhas.map(([l]) => l),
  } as unknown as PdfPageText
}

const CANONICAS_FIXTURE: CoberturaCanonicaRecord[] = [
  {
    id: 'can_1',
    nome: 'RC Guarda de Veículos',
    eventos_tipicos: ['Roubo de veículos sob guarda'],
  },
  { id: 'can_2', nome: 'Danos Morais', eventos_tipicos: [] },
  { id: 'can_3', nome: 'Lucros Cessantes', eventos_tipicos: [] },
  { id: 'can_4', nome: 'Danos por Água', eventos_tipicos: [] },
  { id: 'can_5', nome: 'Vendaval, Furacão, Ciclone, Tornado e Granizo', eventos_tipicos: [] },
]

// ---------------------------------------------------------------------------
// Suíte
// ---------------------------------------------------------------------------

export function runIngestaoCgSuite(): Array<{ nome: string; ok: boolean; detalhe?: string }> {
  const resultados: Array<{ nome: string; ok: boolean; detalhe?: string }> = []
  const t = (nome: string, fn: () => void) => {
    try {
      fn()
      resultados.push({ nome, ok: true })
    } catch (e: any) {
      resultados.push({ nome, ok: false, detalhe: e?.message || String(e) })
    }
  }
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg)
  }

  // ------------------------------------------------------------------
  // 1) Classificação de títulos (heurística estrutural)
  // ------------------------------------------------------------------
  t('Ingestão CG: seção "COBERTURA ADICIONAL ..." é candidata a cobertura', () => {
    assert(
      tituloEhCobertura('COBERTURA ADICIONAL RESPONSABILIDADE CIVIL CHAPA DE EXPERIÊNCIA'),
      'cobertura adicional RC deveria ser cobertura',
    )
  })
  t('Ingestão CG: "COBERTURA BASICA - COBERTURA LUCROS CESSANTES" é cobertura', () => {
    assert(
      tituloEhCobertura('COBERTURA BASICA - COBERTURA LUCROS CESSANTES'),
      'deveria ser cobertura',
    )
  })
  t('Ingestão CG: "CLÁUSULA PARTICULAR - USO RESTRITO" NÃO é cobertura', () => {
    assert(
      !tituloEhCobertura('CLAUSULA PARTICULAR - USO RESTRITO'),
      'cláusula particular não deveria ser cobertura',
    )
  })
  t(
    'Ingestão CG: "CLÁUSULA ESPECÍFICA DE EXCLUSÃO DE DOENÇA TRANSMISSÍVEL" NÃO é cobertura',
    () => {
      assert(
        !tituloEhCobertura('CLÁUSULA ESPECÍFICA DE EXCLUSÃO DE DOENÇA TRANSMISSÍVEL'),
        'cláusula de exclusão não deveria ser cobertura',
      )
    },
  )
  t('Ingestão CG: cláusula de cobertura explícita (salvamento) É cobertura', () => {
    assert(
      tituloEhCobertura('COBERTURA DE DESPESAS DE SALVAMENTO E CONTENÇÃO DE SINISTROS'),
      'cláusula de salvamento deveria ser cobertura',
    )
  })
  t('Ingestão CG: cabeçalho estrutural (Sumário/Apresentação) NÃO é cobertura', () => {
    assert(!tituloEhCobertura('Sumário'), 'Sumário não deveria ser cobertura')
    assert(!tituloEhCobertura('APRESENTAÇÃO'), 'Apresentação não deveria ser cobertura')
  })

  // ------------------------------------------------------------------
  // 2) Leitura de documento estruturado (Sumário + seções)
  // ------------------------------------------------------------------
  t('Ingestão CG: leitura extrai seções com página/slotY e ignora Sumário', () => {
    const pages = [
      page(1, [
        ['CONDIÇÕES GERAIS', 700],
        ['Sumário', 640],
        ['1. COBERTURA ADICIONAL GUARDA DE VEÍCULOS DE TERCEIROS ......... 3', 600],
        ['2. CLAUSULA PARTICULAR - USO RESTRITO .......................... 5', 570],
      ]),
      page(2, [
        ['CONDIÇÕES ESPECIAIS', 700],
        ['COBERTURA ADICIONAL GUARDA DE VEÍCULOS DE TERCEIROS', 650],
        ['1.1 RISCOS COBERTOS', 600],
        ['texto de riscos cobertos da seção', 560],
        ['1.2 RISCOS EXCLUÍDOS', 520],
        ['a) veículos conduzidos por pessoa não habilitada', 480],
        ['b) veículos em teste de direção', 440],
        ['1.3 LIMITE DE INDENIZAÇÃO', 400],
        ['texto de limite', 360],
      ]),
      page(3, [
        ['CLAUSULA PARTICULAR - USO RESTRITO', 700],
        ['texto da cláusula particular', 650],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(coberturas.length === 1, `esperava 1 cobertura, veio ${coberturas.length}`)
    const cov = coberturas[0]
    assert(
      cov.nomeExtraido.startsWith('COBERTURA ADICIONAL GUARDA DE VEÍCULOS'),
      `nome inesperado: ${cov.nomeExtraido}`,
    )
    assert(cov.pagina === 2, `esperava página 2, veio ${cov.pagina}`)
    assert(cov.slotY > 0, 'slotY deveria ser > 0')
    assert(
      cov.exclusoes.length === 2,
      `esperava 2 exclusões (alíneas a e b), veio ${cov.exclusoes.length}: ${JSON.stringify(cov.exclusoes)}`,
    )
    assert(
      cov.exclusoes[0].texto.startsWith('veículos conduzidos por pessoa não habilitada'),
      `texto de alínea inesperado: ${cov.exclusoes[0].texto}`,
    )
    assert(cov.exclusoes[0].pagina === 2, 'exclusão deveria vir da página 2')
  })

  t('Ingestão CG: documento grande (várias seções) mantém ordem e página', () => {
    const pages: PdfPageText[] = []
    pages.push(
      page(1, [
        ['Sumário', 700],
        ['1. COBERTURA ADICIONAL DANOS ELÉTRICOS .... 2', 650],
      ]),
    )
    pages.push(
      page(2, [
        ['COBERTURA ADICIONAL DANOS ELÉTRICOS', 700],
        ['1.1 RISCOS COBERTOS', 650],
      ]),
    )
    pages.push(
      page(3, [
        ['COBERTURA ADICIONAL QUEBRA DE MÁQUINAS', 700],
        ['1.1 RISCOS COBERTOS', 650],
      ]),
    )
    pages.push(
      page(4, [
        ['CLÁUSULA PARTICULAR DE COBERTURA EXCLUÍDA', 700],
        ['texto particular', 650],
      ]),
    )
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(coberturas.length === 2, `esperava 2 coberturas, veio ${coberturas.length}`)
    assert(coberturas[0].pagina === 2 && coberturas[1].pagina === 3, 'ordem de página incorreta')
  })

  // ------------------------------------------------------------------
  // 3) Casamento via motor C3
  // ------------------------------------------------------------------
  t('Ingestão CG: nome extraído casa com canônica por similaridade (C3)', () => {
    const r = casarComMotorC3(
      'COBERTURA ADICIONAL GUARDA DE VEÍCULOS DE TERCEIROS',
      CANONICAS_FIXTURE,
    )
    assert(r.canonicaId === 'can_1', `esperava can_1, veio ${r.canonicaId} (${r.canonicaNome})`)
    assert(r.confianca >= LIMIAR_CONFIANCA_CG, `confiança baixa: ${r.confianca}`)
  })
  t('Ingestão CG: termo sem pareamento vai para revisão sem sugestão firme', () => {
    const r = casarComMotorC3('COBERTURA ADICIONAL CHAPA DE EXPERIÊNCIA', CANONICAS_FIXTURE)
    assert(r.matchType === 'sem_sugestao', `esperava sem_sugestao, veio ${r.matchType}`)
  })

  // ------------------------------------------------------------------
  // 4) Guarda de re-ingestão (não duplica sinônimos)
  // ------------------------------------------------------------------
  t('Ingestão CG: guarda marca como não-duplicar o item já confirmado antes', () => {
    const r = calcularItensGuardaCg(
      [
        {
          id: 'sin_1',
          chave_normalizada: 'cobertura adicional guarda de veiculos de terceiros',
          nome_extraido: 'x',
        },
      ],
      ['COBERTURA ADICIONAL GUARDA DE VEÍCULOS DE TERCEIROS'].map(chaveGuardaCg),
    )
    assert(
      r.length === 1 && r[0].acao === 'nao_duplicar',
      `esperava nao_duplicar: ${JSON.stringify(r)}`,
    )
  })
  t('Ingestão CG: guarda tolera sufixo (leitura anterior truncada/estendida)', () => {
    const r = calcularItensGuardaCg(
      [
        {
          id: 'sin_1',
          chave_normalizada: 'cobertura adicional guarda de veiculos de terceiros',
          nome_extraido: 'x',
        },
      ],
      ['COBERTURA ADICIONAL GUARDA DE VEÍCULOS DE TERCEIROS COMPREENSIVA'].map(chaveGuardaCg),
    )
    assert(r[0].acao === 'nao_duplicar', `sufixo deveria casar: ${JSON.stringify(r)}`)
  })
  t('Ingestão CG: guarda NÃO tolera lixo de prefixo', () => {
    const r = calcularItensGuardaCg(
      [
        {
          id: 'sin_1',
          chave_normalizada: 'cobertura adicional guarda de veiculos de terceiros',
          nome_extraido: 'x',
        },
      ],
      ['GUARDA DE VEÍCULOS DE TERCEIROS'].map(chaveGuardaCg),
    )
    assert(r[0].acao === 'revisar', `prefixo não deveria casar: ${JSON.stringify(r)}`)
  })

  // ------------------------------------------------------------------
  // 5) Detecção de metadados (processo/versão)
  // ------------------------------------------------------------------
  t('Ingestão CG: detecta processo SUSEP e versão do documento', () => {
    const texto =
      'CONDIÇÕES GERAIS\nProcesso SUSEP nº 15414.902025/2014-69 – 12/2025\nProcesso SUSEP nº: 15414.902020/2014-36 – Versão 2 / 2018'
    assert(detectarProcessoSusepCg(texto) === '15414.902025/2014-69', 'processo SUSEP incorreto')
    assert(detectarProdutoVersaoCg(texto) === 'Versão 2/2018', 'versão incorreta')
  })
  t(
    'Ingestão CG: processo SUSEP do LC detectado no texto com espaços do pdf.js ("2014 - 36")',
    () => {
      // Linha reconstruída pelo extractTextFromPdf: fragmentos do cabeçalho da
      // CG de LC da AXA chegam com espaço em volta da barra e do hífen do DV.
      const texto = 'CONDIÇÕES GERAIS\nProcesso Susep nº: 15414.902020/2014 - 36 – Versão 2 / 2018'
      assert(
        detectarProcessoSusepCg(texto) === '15414.902020/2014-36',
        `processo com espaços deveria casar, veio: ${detectarProcessoSusepCg(texto)}`,
      )
    },
  )
  t('Ingestão CG: processo SUSEP no NOME do arquivo com espaço no lugar da barra (LC AXA)', () => {
    assert(
      detectarProcessoSusepNomeArquivo(
        'CG_AXA_LC Secundário RN 15414.902020 2014-36 - cópia.pdf',
      ) === '15414.902020/2014-36',
      'nome com espaço no lugar da barra deveria casar',
    )
    // Formato sem barra antigo (RC Geral AXA) continua casando.
    assert(
      detectarProcessoSusepNomeArquivo('CG_AXA_15414.9020252014-69_20251210.pdf') ===
        '15414.902025/2014-69',
      'formato sem barra deveria continuar casando',
    )
  })
  t('Ingestão CG: versão repetida no CORPO prevalece sobre a da capa (12/2025 × 2/2018)', () => {
    const capa = 'Versão 12/2025'
    const corpo = ['Versão 2 / 2018', 'Versão 2 / 2018', 'Versão 2 / 2018']
    const texto = [capa, ...corpo].join('\n')
    assert(
      detectarProdutoVersaoCg(texto) === 'Versão 2/2018',
      `versão do corpo deveria prevalecer, veio: ${detectarProdutoVersaoCg(texto)}`,
    )
    // Só a capa com versão: comportamento anterior (1ª ocorrência) preservado.
    assert(
      detectarProdutoVersaoCg('CONDIÇÕES GERAIS\nVersão 12/2025') === 'Versão 12/2025',
      'só capa deveria devolver 12/2025',
    )
  })
  t(
    'Ingestão CG: documento LC (capa + corpo fragmentado) detecta processo e versão do corpo',
    () => {
      const pages = [
        page(1, [
          ['CONDIÇÕES GERAIS', 700],
          ['Versão 12/2025', 650],
        ]),
        page(2, [
          ['Processo Susep nº: 15414.902020/2014 - 36 – Versão 2 / 2018', 700],
          ['COBERTURA BASICA - COBERTURA LUCROS CESSANTES', 650],
          ['1.1 RISCOS COBERTOS', 600],
          ['texto de riscos cobertos da seção', 560],
          ['1.2 RISCOS EXCLUÍDOS', 520],
          ['a) perdas em decorrência de variação cambial', 480],
          ['b) lucros esperados não realizados', 440],
          ['1.3 LIMITE DE INDENIZAÇÃO', 400],
          ['texto de limite', 360],
        ]),
        page(3, [
          ['Versão 2 / 2018', 700],
          ['texto de cláusula particular', 650],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      assert(
        leitura.processoSusepDetectado === '15414.902020/2014-36',
        `processo inesperado: ${leitura.processoSusepDetectado}`,
      )
      assert(
        leitura.produtoVersaoDetectado === 'Versão 2/2018',
        `versão inesperada: ${leitura.produtoVersaoDetectado}`,
      )
    },
  )
  t('Ingestão CG: alíneas com mais de uma letra (aa, bb, aaa) viram exclusões', () => {
    const corpo = [
      { texto: '1.4 RISCOS EXCLUÍDOS', pagina: 1, slotY: 500 },
      { texto: 'a) primeira exclusão da seção', pagina: 1, slotY: 480 },
      { texto: 'aa) exclusão de letra dupla', pagina: 1, slotY: 460 },
      { texto: 'aaa) exclusão de letra tripla', pagina: 1, slotY: 440 },
      { texto: '1.5 LIMITE DE INDENIZAÇÃO', pagina: 1, slotY: 420 },
      { texto: 'texto de limite', pagina: 1, slotY: 400 },
    ]
    const r = extrairExclusoesDoBloco(corpo)
    assert(r.length === 3, `esperava 3 exclusões, veio ${r.length}`)
    assert(r[1].texto.startsWith('exclusão de letra dupla'), 'alínea aa deveria ser extraída')
    assert(r[2].texto.startsWith('exclusão de letra tripla'), 'alínea aaa deveria ser extraída')
  })

  // ------------------------------------------------------------------
  // 6) Linhas de Sumário em qualquer formato de pontilhado (caso LC)
  // ------------------------------------------------------------------
  t('Ingestão CG: linha de Sumário reconhecida em qualquer formato de pontilhado', () => {
    // Pontos corridos, elipses U+2026, pontos espaçados e fragmento separado —
    // todas as formas que o pdf.js entrega DEVEM ser reconhecidas como índice.
    assert(ehLinhaSumario('COBERTURA BASICA - DESPESAS FIXAS........... 23'), 'pontos corridos')
    assert(ehLinhaSumario('COBERTURA BASICA - DESPESAS FIXAS…… 23'), 'elipses U+2026')
    assert(ehLinhaSumario('COBERTURA BASICA - DESPESAS FIXAS . . . . . . 23'), 'pontos espaçados')
    assert(ehLinhaSumario('. ............................. 29'), 'fragmento separado com ponto')
    assert(ehLinhaSumario('............ 23'), 'fragmento só de pontilhado + nº')
    assert(ehLinhaSumario('… 23'), 'fragmento só de elipses + nº')
    assert(!ehLinhaSumario('TITULO DA SECAO 23'), 'título com nº, SEM pontilhado, não é Sumário')
    assert(!ehLinhaSumario('texto corrido do corpo da seção'), 'corpo não é Sumário')
  })
  t(
    'Ingestão CG: título no Sumário (elipses/fragmento separado) não vira seção — seção real vence',
    () => {
      // Estrutura genérica do caso LC: Sumário com pontilhados que o pdf.js
      // entrega em formatos variados (elipses, espaçados, fragmento separado
      // na linha seguinte) e as seções reais adiante.
      const pages = [
        page(1, [
          ['CONDIÇÕES GERAIS', 700],
          ['Sumário', 660],
          ['COBERTURA BASICA - DESPESAS FIXAS…… 6', 620],
          ['COBERTURA ADICIONAL DESPESAS EXTRAORDINARIAS . . . . . . 8', 590],
          ['COBERTURA ADICIONAL PERDA OU PAGAMENTO DE ALUGUEL', 560],
          ['. ............................. 10', 530],
        ]),
        page(6, [
          ['COBERTURA BASICA - DESPESAS FIXAS', 700],
          ['1.1 FICA ENTENDIDO E ACORDADO QUE', 650],
          ['texto de riscos cobertos da seção', 610],
          ['1.2 RISCOS EXCLUÍDOS', 570],
          ['a) perdas em decorrência de variação cambial', 530],
          ['b) multas ou penalidades de qualquer natureza', 490],
          ['1.3 RATIFICAÇÃO', 450],
          ['texto de ratificação', 410],
        ]),
        page(8, [
          ['COBERTURA ADICIONAL DESPESAS EXTRAORDINARIAS', 700],
          ['texto de riscos cobertos da seção', 650],
        ]),
        page(10, [
          ['COBERTURA ADICIONAL PERDA OU PAGAMENTO DE ALUGUEL', 700],
          ['texto de riscos cobertos da seção', 650],
          ['2. RISCOS EXCLUÍDOS', 600],
          ['a) valores de alugueis que excedam o custo médio de locação', 550],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 3,
        `esperava 3 coberturas (Sumário não vira seção), veio ${coberturas.length}: ${JSON.stringify(coberturas.map((c) => [c.nomeExtraido, c.pagina]))}`,
      )
      const despesasFixas = coberturas.find((c) => c.nomeExtraido.startsWith('COBERTURA BASICA'))
      assert(!!despesasFixas, 'DESPESAS FIXAS deveria estar entre as coberturas')
      assert(
        despesasFixas!.pagina === 6,
        `item deveria apontar para a página da seção REAL (6), veio ${despesasFixas!.pagina}`,
      )
      assert(
        despesasFixas!.exclusoes.length === 2,
        `esperava 2 exclusões da seção real, veio ${despesasFixas!.exclusoes.length}`,
      )
      const aluguel = coberturas.find((c) => c.nomeExtraido.includes('ALUGUEL'))
      assert(!!aluguel, 'ALUGUEL deveria estar entre as coberturas')
      assert(
        aluguel!.pagina === 10,
        `título quebrado do Sumário (fragmento separado) deveria apontar para a seção real (10), veio ${aluguel!.pagina}`,
      )
    },
  )
  t(
    'Ingestão CG: cinto de segurança — última ocorrência do título vence (seção real > Sumário)',
    () => {
      // Se o pontilhado do Sumário escapar da detecção, a seção real (que vem
      // DEPOIS) ainda prevalece sobre a entrada de índice.
      const pages = [
        page(1, [
          ['Sumário', 700],
          ['COBERTURA ADICIONAL DANOS ELÉTRICOS 9999 x 2', 650], // sem pontilhado: escaparia
        ]),
        page(5, [
          ['COBERTURA ADICIONAL DANOS ELÉTRICOS', 700],
          ['1.1 RISCOS COBERTOS', 650],
          ['texto de riscos cobertos da seção', 610],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 1,
        `esperava 1 cobertura, veio ${coberturas.length}: ${JSON.stringify(coberturas.map((c) => [c.nomeExtraido, c.pagina]))}`,
      )
      assert(
        coberturas[0].pagina === 5,
        `seção real (última ocorrência) deveria vencer, veio página ${coberturas[0].pagina}`,
      )
      // O nome EXIBIDO é o da seção real — o lixo de índice nunca vira nome.
      assert(
        !coberturas[0].nomeExtraido.includes('9999'),
        `nome exibido não deveria carregar cauda de índice, veio: ${coberturas[0].nomeExtraido}`,
      )
      // Números legítimos no nome não são removidos da chave de dedup.
      assert(
        chaveDedupTituloCg('COBERTURA ADICIONAL DANOS ELÉTRICOS 24H') ===
          'cobertura adicional danos eletricos 24h',
        `número legítimo do nome não deveria ser removido, veio: ${chaveDedupTituloCg('COBERTURA ADICIONAL DANOS ELÉTRICOS 24H')}`,
      )
    },
  )

  // ------------------------------------------------------------------
  // N) Fluxo de gravação em lotes (pocketbaseWriteHelper) — v0.0.207
  // ------------------------------------------------------------------

  t(
    'Ingestão CG: gravação em lotes divide a fila grande (RN 113 coberturas) em lotes de 20',
    () => {
      const itens = Array.from({ length: 113 }, (_, i) => ({
        tipoItem: 'cobertura' as const,
        nomeExtraido: `COBERTURA ADICIONAL TESTE ${i + 1}`,
        secaoOrigem: 'COBERTURA ADICIONAL TESTE',
        pagina: 2,
        slotY: i,
        exclusoes: [] as string[],
        sugestaoCanonicaId: '',
        sugestaoCanonicaNome: '',
        confianca: 0,
        matchType: 'sem_sugestao' as const,
        status: 'pendente' as const,
      }))
      // 113 itens / 20 por lote = 5×20 + 1×13 → 6 lotes (helper correto; correção v0.0.209 da asserção).
      const lotes = dividirEmLotes(itens)
      assert(lotes.length === 6, `esperava 6 lotes, veio ${lotes.length}`)
      assert(lotes[0].length === 20, `1º lote deveria ter 20, veio ${lotes[0].length}`)
      assert(lotes[5].length === 13, `último lote deveria ter 13, veio ${lotes[5].length}`)
      assert(
        lotes.reduce((a, l) => a + l.length, 0) === itens.length,
        'soma dos lotes deveria ser o total de itens',
      )
    },
  )

  t('Ingestão CG: calcularPausaProgressiva cresce com o nº de tentativas (backoff 429)', () => {
    assert(
      calcularPausaProgressiva(1) >= 1000 && calcularPausaProgressiva(1) <= 1400,
      `1ª pausa deveria ser ~1s, veio ${calcularPausaProgressiva(1)}ms`,
    )
    assert(
      calcularPausaProgressiva(2) > calcularPausaProgressiva(1),
      '2ª pausa deveria ser maior que a 1ª',
    )
    assert(
      calcularPausaProgressiva(5) > calcularPausaProgressiva(3),
      'pausa deveria crescer progressivamente',
    )
  })

  // ------------------------------------------------------------------
  // 7) Fragmentos de frase NUNCA são cobertura (v0.0.211 — caso real AXA
  //    Riscos Nomeados, pág. 28 slots 142 e 198 do overlay "Origem no PDF")
  // ------------------------------------------------------------------

  // Caso real 1 (pág. 28 slot 142): linha de continuação do período da cláusula
  // 15.2 — o PDF quebrou "Explosão" por hifenização e a linha ficou truncada no
  // meio da frase, mas começava com "cobertura básica (" e passava pelo prefixo
  // /^cobertura\s+basica/. NÃO pode virar cobertura.
  t('Ingestão CG: continuação do parágrafo 15.2 (pág. 28 slot 142) NÃO é cobertura', () => {
    const linhaSlot142 =
      'cobertura básica (Incêndio, inclusive decorrente de Tumultos, Queda de Raio e Explo são de'
    assert(
      ehFragmentoFraseCg(linhaSlot142),
      'linha de continuação deveria ser detectada como fragmento',
    )
    assert(!tituloEhCobertura(linhaSlot142), 'continuação de 15.2 não deveria ser cobertura')
    // Variante em caixa alta truncada (pdf.js) também é barrada: termina em
    // preposição e não fecha período — mesma frase da cláusula 15.2.
    assert(
      !tituloEhCobertura('COBERTURA BÁSICA (INCÊNDIO, INCLUSIVE DECORRENTE DE TUMULTOS'),
      'caixa alta truncada também não é cobertura',
    )
  })

  // Caso real 2 (pág. 28 slot 198): rabo da alínea "b" — fecha o período com
  // ponto final; começa com "Incêndio" e passava pelo prefixo /^inc[êe]ndio/.
  t('Ingestão CG: rabo da alínea "b" (pág. 28 slot 198) NÃO é cobertura', () => {
    const linhaSlot198 = 'Incêndio, Raio e Explosão – Perda de receita bruta.'
    assert(ehFragmentoFraseCg(linhaSlot198), 'rabo de alínea deveria ser detectado como fragmento')
    assert(!tituloEhCobertura(linhaSlot198), 'rabo de alínea não deveria ser cobertura')
    // A mesma linha SEM o ponto final (pdf.js às vezes o deixa fora do
    // fragmento) continua sendo barrada pelo teste de estrutura da pág. 28:
    // alínea real nunca chega sem o marcador "b)" na linha anterior.
  })

  // Guardas estruturais gerais (alínea, minúscula, verbo de cláusula) + a
  // página 28 inteira reconstruída: nenhuma linha vira cobertura.
  t('Ingestão CG: página 28 real (alínea b + 15.2 + seção 16) não gera cobertura espúria', () => {
    assert(!tituloEhCobertura('a) veículos conduzidos por pessoa não habilitada'), 'alínea a)')
    assert(!tituloEhCobertura('b) Demolição e Desentulho; Lucros Cessantes'), 'alínea b)')
    assert(!tituloEhCobertura('texto corrido do corpo da cláusula'), 'minúscula inicial')
    assert(
      !tituloEhCobertura('o Limite Máximo de Garantia (LMG) será igual ao da cobertura básica'),
      'frase de cláusula com "será igual ao da"',
    )
    assert(
      !tituloEhCobertura('Quando não forem contratadas as Cláusulas de Coberturas da alínea "b"'),
      'frase iniciada por "Quando"',
    )
    // Títulos legítimos continuam passando com as guardas ativas (pacto
    // anti-regressão: tudo que hoje é cobertura continua sendo).
    assert(tituloEhCobertura('COBERTURA ADICIONAL PERDA DE RECEITA BRUTA'), 'título legítimo')
    assert(tituloEhCobertura('INCÊNDIO E ROUBO DE BENS'), 'título legítimo Incêndio')
    assert(!ehFragmentoFraseCg('COBERTURA ADICIONAL DANOS ELÉTRICOS'), 'título não é fragmento')

    // Estrutura da pág. 28 do RN AXA: rabo de alínea anterior, corpo da
    // cláusula 15.2 em 3 linhas e o cabeçalho "16. FORMA DE CONTRATAÇÃO".
    const pages = [
      page(28, [
        ['Natureza);', 230],
        ['b) Demolição e Desentulho; Lucros Cessantes; Perda ou Pagamento de Alugueis Por', 200],
        ['Locação de Imóvel, Despesas Fixas e Interrupção de Negócio em Consequência de', 185],
        ['Incêndio, Raio e Explosão – Perda de receita bruta.', 170],
        [
          '15.2 Quando não forem contratadas as Cláusulas de Coberturas constantes da alínea "b" do',
          142,
        ],
        [
          'subitem 15.1 destas Condições Gerais, o Limite Máximo de Garantia (LMG) será igual ao da',
          130,
        ],
        [
          'cobertura básica (Incêndio, inclusive decorrente de Tumultos, Queda de Raio e Explo são de',
          118,
        ],
        ['Qualquer Natureza).', 106],
        ['16. FORMA DE CONTRATAÇÃO', 90],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas.length === 0,
      `esperava 0 coberturas, veio ${coberturas.length}: ${JSON.stringify(coberturas.map((c) => [c.nomeExtraido, c.slotY]))}`,
    )
  })

  // ------------------------------------------------------------------
  // 8) Equivalência C3: "Resp. Civil" ≡ "Responsabilidade Civil" (v0.0.214)
  //    A abreviação recorrente em PDFs de CG casa com a canônica RC por
  //    extenso — validado ANTES do pareamento (parser/interface separados).
  // ------------------------------------------------------------------
  t(
    'Ingestão CG: C3 normaliza "Resp. Civil"/"Resp Civ"/"rc" para "responsabilidade civil" e casa com a canônica RC Compreensiva',
    () => {
      // Normalização direta (normalizarTermoC3 roda sobre o texto JÁ
      // normalizado por normalizeMatchText — pontuação e acentos saem antes).
      assert(
        normalizarTermoC3(normalizeMatchText('Resp. Civil')) === 'responsabilidade civil',
        `"Resp. Civil" deveria virar "responsabilidade civil", veio: ${normalizarTermoC3(normalizeMatchText('Resp. Civil'))}`,
      )
      assert(
        normalizarTermoC3(normalizeMatchText('Resp Civ')) === 'responsabilidade civil',
        '"Resp Civ" deveria virar "responsabilidade civil"',
      )
      assert(
        normalizarTermoC3(normalizeMatchText('Resp. Civil Guarda de Veículos de Terceiros')) ===
          'responsabilidade civil guarda de veiculos de terceiros',
        'abreviação no meio do título deveria expandir',
      )
      assert(
        normalizarTermoC3(normalizeMatchText('RC Guarda de Veículos de Terceiros')) ===
          'responsabilidade civil guarda de veiculos de terceiros',
        'token isolado "rc" da canônica deveria expandir',
      )
      // Vias de entrada com acento e ponto ("resp. cív.", pdf.js) também normalizam.
      assert(
        normalizarTermoEquivalencia('Resp. Cív.') === 'responsabilidade civil',
        'variante com acento deveria normalizar',
      )

      // Casamento com a canônica real (migration 0051): a abreviação do PDF
      // alcança o limiar de pareamento do motor C3 contra
      // "RC Guarda de Veículos de Terceiros - Compreensiva / Ampla".
      const CANONICA_RC_COMPREENSIVA: CoberturaCanonicaRecord = {
        id: 'can_rc_compreensiva',
        nome: 'RC Guarda de Veículos de Terceiros - Compreensiva / Ampla',
        ramo: 'RC',
        eventos_tipicos: ['Roubo de veículos sob guarda'],
      }
      for (const termo of ['Resp. Civil', 'Resp Civ', 'RC', 'rc']) {
        const r = casarComMotorC3(termo, [CANONICA_RC_COMPREENSIVA])
        assert(
          r.canonicaId === 'can_rc_compreensiva' && r.confianca >= LIMIAR_CONFIANCA_CG,
          `termo "${termo}" deveria casar com a canônica RC Compreensiva acima do limiar ${LIMIAR_CONFIANCA_CG}, veio: ${JSON.stringify(r)}`,
        )
        // "rc" isolado não deve escorrer para outra canônica (só RC na fixture).
      }

      // Regressão: token que apenas CONTÉM "rc" (ex.: "circuito") NÃO expande.
      assert(
        normalizarTermoC3(normalizeMatchText('circuitos eletricos')) === 'circuitos eletricos',
        'substring "rc" não deveria expandir (\\b)',
      )
    },
  )

  // ------------------------------------------------------------------
  // 9) Formato Chubb — seção de exclusões QUEBRADA em duas linhas dentro de
  //    Condição Especial (v0.0.219). Seção NOVA: nenhuma asserção existente
  //    foi alterada ou removida (pacto anti-regressão).
  //    Caso real: CG RN Chubb, cada Condição Especial traz o cabeçalho de
  //    exclusões numerado ("2. RISCOS EXCLUIDOS / PREJUÍZOS NÃO INDENIZÁVEIS /
  //    BENS NÃO COMPREENDIDOS NO SEGURO:") que o pdf.js quebra em 2 linhas
  //    caixa alta. A 2ª linha fechava o bloco antes da 1ª alínea — as sessões
  //    Chubb gravavam total_exclusoes: 0.
  // ------------------------------------------------------------------

  t('Ingestão CG: cabeçalho de exclusões Chubb quebrado em 2 linhas não fecha o bloco', () => {
    // Linha 1 do cabeçalho: "RISCOS EXCLUIDOS" sem acento e com numeração "2."
    // já casam em RE_INICIO_EXCLUSOES — abre o bloco de exclusões.
    assert(
      RE_INICIO_EXCLUSOES.test('2. RISCOS EXCLUIDOS / PREJUÍZOS NÃO INDENIZÁVEIS / BENS NÃO'),
      'linha 1 do cabeçalho Chubb deveria abrir o bloco de exclusões',
    )
    // Linha 2 ("COMPREENDIDOS NO SEGURO:") casa a guarda de continuação —
    // não fecha o bloco antes da 1ª alínea.
    assert(
      ehContinuacaoCabecalhoExclusoes('COMPREENDIDOS NO SEGURO:'),
      'linha 2 do cabeçalho Chubb deveria casar como continuação de cabeçalho',
    )
    // Subtítulo de fechamento legítimo NÃO casa a guarda — o formato AXA
    // continua fechando o bloco normalmente.
    assert(
      !ehContinuacaoCabecalhoExclusoes('1.3 LIMITE DE INDENIZAÇÃO'),
      'subtítulo de fechamento não deveria casar como continuação',
    )
  })
  t(
    'Ingestão CG: exclusões extraídas da Condição Especial Chubb com cabeçalho quebrado em 2 linhas',
    () => {
      // Estrutura genérica de uma Condição Especial Chubb: título, riscos
      // cobertos, cabeçalho de exclusões QUEBRADO em duas linhas caixa alta e
      // alíneas a), b), c). Frases ESTRUTURAIS genéricas, sem conteúdo real.
      const corpo = [
        {
          texto: '2. RISCOS EXCLUIDOS / PREJUÍZOS NÃO INDENIZÁVEIS / BENS NÃO',
          pagina: 4,
          slotY: 500,
        },
        { texto: 'COMPREENDIDOS NO SEGURO:', pagina: 4, slotY: 485 },
        {
          texto: 'a) perdas decorrentes de fato gerador anterior ao período',
          pagina: 4,
          slotY: 460,
        },
        {
          texto: 'b) danos causados por atos de quem detém a guarda do bem',
          pagina: 4,
          slotY: 440,
        },
        { texto: 'c) multas ou penalidades aplicadas por autoridade', pagina: 4, slotY: 420 },
        // Fechamento do bloco: subtítulo numerado em caixa alta.
        { texto: '3. LIMITE DE INDENIZAÇÃO', pagina: 4, slotY: 400 },
        { texto: 'texto de limite da seção', pagina: 4, slotY: 380 },
      ]
      const r = extrairExclusoesDoBloco(corpo)
      assert(r.length === 3, `esperava 3 exclusões, veio ${r.length}: ${JSON.stringify(r)}`)
      assert(r[0].texto.startsWith('perdas decorrentes de fato gerador anterior'), 'alínea a)')
      assert(r[1].texto.startsWith('danos causados por atos de quem detém a guarda'), 'alínea b)')
      assert(r[2].texto.startsWith('multas ou penalidades aplicadas por autoridade'), 'alínea c)')
    },
  )

  t(
    'Ingestão CG: leitura completa da Condição Especial Chubb liga exclusões à cobertura certa',
    () => {
      // Documento mínimo no formato Chubb: Condição Especial numerada com nome
      // quebrado em 2 linhas, cabeçalho de exclusões quebrado em 2 linhas e
      // alíneas. A cobertura deve herdar as exclusões do SEU bloco.
      const pages = [
        page(1, [
          ['Sumário', 700],
          ['1. CONDIÇÃO ESPECIAL 21 - CONDIÇÕES ESPECIAIS ..... 3', 650],
        ]),
        page(3, [
          ['CONDIÇÃO ESPECIAL 21 - CONDIÇÕES ESPECIAIS', 700],
          ['PARA O SEGURO DE RECOMPOSIÇÃO DE REGISTROS', 680],
          ['1.1 RISCOS COBERTOS', 650],
          ['texto de riscos cobertos da seção', 620],
          ['2. RISCOS EXCLUIDOS / PREJUÍZOS NÃO INDENIZÁVEIS / BENS NÃO', 580],
          ['COMPREENDIDOS NO SEGURO:', 560],
          ['a) perdas decorrentes de fato gerador anterior ao período', 530],
          ['b) multas ou penalidades aplicadas por autoridade', 510],
          ['3. LIMITE DE INDENIZAÇÃO', 480],
          ['texto de limite da seção', 450],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 1,
        `esperava 1 cobertura, veio ${coberturas.length}: ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      const cov = coberturas[0]
      // Título quebrado: as 2 linhas do título se juntam num só nome.
      assert(
        cov.nomeExtraido.includes('RECOMPOSIÇÃO DE REGISTROS'),
        `título quebrado deveria juntar as 2 linhas, veio: ${cov.nomeExtraido}`,
      )
      assert(cov.pagina === 3, `esperava página 3, veio ${cov.pagina}`)
      assert(
        cov.exclusoes.length === 2,
        `esperava 2 exclusões ligadas à cobertura (total_exclusoes > 0), veio ${cov.exclusoes.length}: ${JSON.stringify(cov.exclusoes)}`,
      )
      assert(
        cov.exclusoes[0].texto.startsWith('perdas decorrentes de fato gerador anterior'),
        `alínea a) inesperada: ${cov.exclusoes[0].texto}`,
      )
      assert(cov.exclusoes[0].pagina === 3, 'exclusão deveria vir da página 3')
    },
  )

  // Falso-positivo: as OUTRAS seções (formato AXA, cabeçalho em 1 linha) não
  // podem ser afetadas pela guarda Chubb — subtítulo de fechamento continua
  // fechando o bloco e a guarda só age na linha 2 do cabeçalho quebrado.
  t(
    'Ingestão CG: guarda Chubb não captura falso-positivo no formato AXA (cabeçalho em 1 linha)',
    () => {
      const corpo = [
        { texto: '1.2 RISCOS EXCLUÍDOS', pagina: 2, slotY: 500 },
        { texto: 'a) veículos conduzidos por pessoa não habilitada', pagina: 2, slotY: 480 },
        { texto: 'b) veículos em teste de direção', pagina: 2, slotY: 460 },
        { texto: '1.3 LIMITE DE INDENIZAÇÃO', pagina: 2, slotY: 440 },
        { texto: 'texto de limite', pagina: 2, slotY: 420 },
      ]
      const r = extrairExclusoesDoBloco(corpo)
      assert(r.length === 2, `esperava 2 exclusões (formato AXA intocado), veio ${r.length}`)
      // Subtítulos de fechamento sem vocabulário do cabeçalho Chubb fecham o bloco.
      assert(
        !r.some((e) => e.texto.includes('texto de limite')),
        'linha após fechamento não deveria ser capturada',
      )
    },
  )

  // ------------------------------------------------------------------
  // 10) Fragmentos em CAIXA ALTA de continuação de período NUNCA são
  //     título de seção (v0.0.222 — caso real Tokio, pág. 94/101: rabo em
  //     caixa alta do parágrafo DPVAT/RC Facultativa, sem minúscula, sem
  //     verbo, termina em ";" — passava pelo prefixo /^responsabilidade
  //     civil\b/ e virava cobertura espúria). Seção NOVA: nenhuma asserção
  //     existente alterada ou removida (pacto anti-regressão). Frases
  //     ESTRUTURAIS genéricas, zero conteúdo do PDF real.
  // ------------------------------------------------------------------

  t(
    'Ingestão CG: fragmento CAIXA ALTA de continuação de período (termina em ";") NÃO é cobertura',
    () => {
      // Frase genérica com a MESMA estrutura do caso real: continuação de
      // período em caixa alta, com conector de meio de frase, terminando em
      // ponto-e-vírgula. Título de seção nunca tem cauda de período aberto.
      const fragmento =
        'RESPONSABILIDADE CIVIL FACULTATIVA, ESTE ÚLTIMO CONTRATADO, APLICANDO-SE SOMENTE EM PROTEÇÃO AOS INTERESSES DO SEGURADO E JAMAIS EM BENEFÍCIO DE TERCEIROS ENVOLVIDOS;'
      assert(
        ehFragmentoFraseCg(fragmento),
        'cauda ";" deveria marcar a linha como fragmento de frase',
      )
      assert(
        !tituloEhCobertura(fragmento),
        'continuação de período em caixa alta não deveria ser cobertura',
      )
      // Variante sem ponto-e-vírgula (linha pdf.js truncada antes do ";"):
      // o conector de meio de frase em caixa alta também barra.
      const truncada = fragmento.replace(/;$/, '')
      assert(
        !tituloEhCobertura(truncada),
        'variante truncada com conector de meio de frase também não é cobertura',
      )
      assert(ehFragmentoFraseCg(truncada), 'linha com conector de frase deveria ser fragmento')
      // Caudas abertas em geral: vírgula e elipses no fim da linha.
      assert(ehFragmentoFraseCg('TEXTO DE CLÁUSULA INTERROMPIDO,'), 'cauda vírgula')
      assert(ehFragmentoFraseCg('TEXTO DE CLÁUSULA TRUNCADO PELO EXTRATOR…'), 'cauda elipses')
      assert(ehFragmentoFraseCg('TEXTO EM CAIXA ALTA, SEGUE CONTINUAÇÃO'), 'conector ", segue"')
    },
  )

  t(
    'Ingestão CG: título de cobertura Tokio em CAIXA ALTA legítimo continua sendo cobertura',
    () => {
      // Padrões estruturais do formato Tokio — NENHUM termina em ";"/"," e
      // nenhum contém conector de meio de frase. Devem continuar passando
      // (pacto anti-regressão).
      assert(
        tituloEhCobertura('COBERTURA ADICIONAL Nº. 095 - COBERTURA ADICIONAL DE EXEMPLO'),
        'COBERTURA ADICIONAL Nº. com nome no resto da linha',
      )
      assert(
        tituloEhCobertura('COBERTURA BÁSICA Nº. 001C - INCÊNDIO DO OBJETO DO SEGURO'),
        'COBERTURA BÁSICA nº. com código',
      )
      assert(
        tituloEhCobertura(
          'COBERTURA ADICIONAL Nº. 138 - COBERTURA ADICIONAL PARA INTERRUPÇÃO DE UTILIDADES',
        ),
        'COBERTURA ADICIONAL Nº. em 2 linhas',
      )
      assert(tituloEhCobertura('RESPONSABILIDADE CIVIL FACULTATIVA'), 'RC Facultativa sem cauda')
      assert(
        tituloEhCobertura('CLÁUSULA PARTICULAR DE EXTENSÃO DE GARANTIA PARA EXEMPLO'),
        'cláusula particular passando pelo teste geral (não-bloqueada por fragmento)',
      )
      // ... e o teste geral da cláusula particular (regra NÃO cobertura)
      // continua valendo — a guarda nova não mudou essa regra.
      assert(
        !tituloEhCobertura('CLÁUSULA PARTICULAR DE USO RESTRITO'),
        'cláusula particular continua NÃO cobertura (regra intacta)',
      )
    },
  )

  t(
    'Ingestão CG: página Tokio reconstruída (fragmento em caixa alta + títulos legítimos) não gera cobertura espúria',
    () => {
      // Página estrutural genérica: parágrafo DPVAT/RC em caixa alta quebrado
      // em várias linhas (uma delas termina em ";") + títulos Tokio legítimos
      // antes e depois. Os títulos passam; o fragmento não vira seção.
      const pages = [
        page(93, [
          ['COBERTURA ADICIONAL Nº. 095 - COBERTURA ADICIONAL DE EXEMPLO UM', 700],
          ['1.1 RISCOS COBERTOS', 650],
          ['texto de riscos cobertos da seção', 610],
        ]),
        page(94, [
          ['COBERTURA ADICIONAL Nº. 096 - COBERTURA ADICIONAL DE EXEMPLO DOIS', 720],
          [
            'RESPONSABILIDADE CIVIL FACULTATIVA, ESTE ÚLTIMO CONTRATADO, APLICANDO-SE SOMENTE EM',
            690,
          ],
          [
            'PROTEÇÃO AOS INTERESSES DO SEGURADO E JAMAIS EM BENEFÍCIO DE TERCEIROS ENVOLVIDOS;',
            670,
          ],
          ['texto de continuação do parágrafo da cláusula', 640],
          ['COBERTURA ADICIONAL Nº. 097 - COBERTURA ADICIONAL DE EXEMPLO TRÊS', 600],
          ['1.1 RISCOS COBERTOS', 560],
          ['texto de riscos cobertos da seção', 520],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 3,
        `esperava 3 coberturas (fragmento não vira seção), veio ${coberturas.length}: ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      assert(
        !coberturas.some((c) => c.nomeExtraido.includes('JAMAIS')),
        'fragmento em caixa alta de continuação de período não deveria virar cobertura',
      )
    },
  )

  t(
    'Ingestão CG: fragmento Tokio barrado não afeta exclusões nem títulos quebrados (formato Chubb/AXA intactos)',
    () => {
      // Falso-positivo de proteção: a guarda nova (cauda ";"/"," + conector)
      // não pode fechar o bloco de exclusões antes da 1ª alínea nem barrar
      // títulos quebrados em 2 linhas que não têm cauda aberta.
      const pages = [
        page(1, [
          ['Sumário', 700],
          ['1. COBERTURA ADICIONAL DESPESAS EXTRAORDINARIAS ..... 3', 650],
        ]),
        page(3, [
          ['COBERTURA ADICIONAL DESPESAS EXTRAORDINARIAS', 700],
          ['1.1 RISCOS COBERTOS', 650],
          ['texto de riscos cobertos da seção', 620],
          ['2. RISCOS EXCLUIDOS / PREJUÍZOS NÃO INDENIZÁVEIS / BENS NÃO', 580],
          ['COMPREENDIDOS NO SEGURO:', 560],
          ['FRAGMENTO EM CAIXA ALTA INTERROMPIDO, SEGUINDO COM A CONTINUAÇÃO DO PERÍODO;', 540],
          ['a) perdas decorrentes de fato gerador anterior ao período', 520],
          ['b) multas ou penalidades aplicadas por autoridade', 500],
          ['3. LIMITE DE INDENIZAÇÃO', 480],
          ['texto de limite da seção', 450],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 1,
        `esperava 1 cobertura, veio ${coberturas.length}: ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      assert(
        coberturas[0].exclusoes.length === 2,
        `esperava 2 exclusões (guarda nova não fecha bloco), veio ${coberturas[0].exclusoes.length}`,
      )
      // O fragmento em caixa alta com cauda ";" não vira seção e não entra
      // como exclusão da cobertura da página.
      assert(
        !coberturas[0].exclusoes.some((e) => e.texto.includes('FRAGMENTO EM CAIXA ALTA')),
        'fragmento barrado não deveria entrar nem como seção nem como exclusão',
      )
    },
  )

  // ------------------------------------------------------------------
  // 11) PDF SEM CAMADA DE TEXTO (escaneado) — v0.0.223 (caso real Zurich
  //     "CG RN LC", 19 páginas em branco na extração). Seção NOVA: nenhuma
  //     asserção existente alterada ou removida (pacto anti-regressão).
  //     Fixtures ESTRUTURAIS genéricas, zero conteúdo do PDF real.
  // ------------------------------------------------------------------

  t('Ingestão CG: PDF escaneado (19 páginas em branco) é detectado como sem texto', () => {
    // Estrutura do caso real: N páginas que a extração devolve VAZIAS —
    // o PDF tem só imagem, sem texto selecionável. Fixtures genéricas:
    // páginas em branco, sem nenhum caractere.
    const paginasVazias = Array.from({ length: 19 }, (_, i) => ({
      pageNumber: i + 1,
      text: '',
      items: [],
      lines: [],
    })) as unknown as PdfPageText[]
    const deteccao = detectarPdfSemTextoCg(paginasVazias)
    assert(
      deteccao.semTexto,
      `19 páginas em branco deveriam ser detectadas como escaneadas, veio ${JSON.stringify(deteccao)}`,
    )
    assert(deteccao.caracteres === 0, 'total de caracteres extraídos deveria ser 0')
    assert(deteccao.paginas === 19, 'deveria contar as 19 páginas')
    // Mensagem ao analista: menciona SUSEP e o número de páginas.
    const msg = mensagemPdfSemTextoCg(deteccao.paginas)
    assert(msg.includes('SUSEP'), 'mensagem deveria apontar o portal SUSEP')
    assert(msg.includes('19'), 'mensagem deveria citar o número de páginas')
    assert(msg.includes('texto'), 'mensagem deveria explicar que falta texto selecionável')
  })

  t('Ingestão CG: CG legítima com texto nunca é confundida com PDF escaneado', () => {
    // Página de capa quase vazia + páginas de corpo com texto (frases
    // ESTRUTURAIS genéricas) — a média por página fica bem acima do limiar.
    const pages = [
      page(1, [['CG DE EXEMPLO', 700]]),
      page(2, [
        ['COBERTURA ADICIONAL DE EXEMPLO UM', 700],
        ['1.1 RISCOS COBERTOS', 650],
        ['texto de riscos cobertos da seção', 610],
        ['2. RISCOS EXCLUIDOS', 580],
        ['a) perdas decorrentes de fato gerador anterior ao período', 540],
      ]),
      page(3, [
        ['COBERTURA ADICIONAL DE EXEMPLO DOIS', 700],
        ['1.1 RISCOS COBERTOS', 650],
        ['texto de riscos cobertos da seção', 610],
      ]),
    ]
    const deteccao = detectarPdfSemTextoCg(pages)
    assert(
      !deteccao.semTexto,
      `CG com texto não deveria ser marcada como escaneada, veio ${JSON.stringify(deteccao)}`,
    )
    // E a leitura normal segue funcionando (a guarda não intercepta o fluxo).
    const leitura = lerCondicoesGerais(pages)
    assert(
      leitura.itens.length >= 2,
      `leitura normal deveria achar as 2 seções, veio ${leitura.itens.length}`,
    )
    // Caso intermediário: documento com texto esparsíssimo (abaixo do
    // limiar por página) também é escaneado — evita falso-negativo em
    // PDFs com OCR de rodapé.
    const paginasEsparsas = Array.from({ length: 10 }, (_, i) => ({
      pageNumber: i + 1,
      text: ' ',
      items: [],
      lines: [],
    })) as unknown as PdfPageText[]
    assert(
      detectarPdfSemTextoCg(paginasEsparsas).semTexto,
      'páginas só com espaços também deveriam ser detectadas como escaneadas',
    )
  })

  // ------------------------------------------------------------------
  // 12) ASSINATURA ESTRUTURAL ZURICH — v0.0.226 (tarefa 2a), v0.0.227
  //     (tarefa 2b, parte 1: quebra de página). Títulos de
  //     cobertura em CAIXA MISTA sem prefixo ("Danos ao Cais", "Erros e
  //     Omissões"), ancorados na linha seguinte "1. Riscos Cobertos"
  //     (as exclusões variam entre "2." e "3. Riscos Excluídos" — a
  //     numeração seguinte NÃO é âncora). Guardas: linha de Sumário
  //     pontilhada e cláusula "1. Fica entendido…" NÃO viram cobertura.
  //     Fixtures ESTRUTURAIS genéricos (pacto anti-regressão: seção NOVA,
  //     nenhuma asserção anterior alterada ou removida).
  // ------------------------------------------------------------------

  t('Ingestão CG: título Zurich em caixa mista ("Danos ao Cais") é cobertura', () => {
    // Assinatura pura: título seguido da linha âncora "1. Riscos Cobertos".
    assert(
      tituloEhCoberturaZurich('Danos ao Cais', '1. Riscos Cobertos'),
      '"Danos ao Cais" + "1. Riscos Cobertos" deveria ser reconhecido como cobertura Zurich',
    )
    // E também via leitura completa: seção vira item do tipo cobertura.
    const pages = [
      page(1, [
        ['Danos ao Cais', 700],
        ['1. Riscos Cobertos', 660],
      ]),
      page(2, [
        ['Mediante contratação desta cláusula, estarão cobertos os danos ao cais', 680],
        ['3. Riscos Excluídos', 640],
        ['a) danos consequentes de defeito ou vício próprio do bem', 600],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas.some((c) => c.nomeExtraido === 'Danos ao Cais'),
      `leitura completa deveria extrair a cobertura "Danos ao Cais", veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
    )
  })

  t(
    'Ingestão CG: título Zurich ("Erros e Omissões") é cobertura mesmo com exclusões no bloco 3',
    () => {
      // A ancoragem é na linha "1. Riscos Cobertos" — a exclusão pode vir no
      // bloco "3." (numeração seguinte variável, não é âncora).
      assert(
        tituloEhCoberturaZurich('Erros e Omissões', '1. Riscos Cobertos'),
        '"Erros e Omissões" deveria ser reconhecido como cobertura Zurich',
      )
      const pages = [
        page(1, [
          ['Erros e Omissões', 700],
          ['1. Riscos Cobertos', 660],
        ]),
        page(2, [
          ['texto de riscos cobertos da seção', 680],
          ['3. Riscos Excluídos', 640],
          ['a) omissão de registro em sistema da companhia', 600],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.some((c) => c.nomeExtraido === 'Erros e Omissões'),
        `leitura completa deveria extrair a cobertura "Erros e Omissões", veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
    },
  )

  t('Ingestão CG: linha de Sumário pontilhada Zurich não vira cobertura', () => {
    // No Sumário real, a entrada de cobertura em caixa mista vem com
    // pontilhado e número de página — nunca deve casar a assinatura.
    assert(
      !tituloEhCoberturaZurich('Danos ao Cais ......... 55', '1. Riscos Cobertos'),
      'linha de Sumário pontilhada não deveria casar a assinatura Zurich',
    )
    // E via leitura completa: uma linha pontilhada seguida de "1. Riscos
    // Cobertos" não gera item (o pontilhado já é limpo antes do teste —
    // a guarda ehLinhaSumario trava o resto).
    const pages = [
      page(1, [['Danos ao Cais ......... 55', 700]]),
      page(2, [['texto de riscos cobertos da seção', 680]]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      !coberturas.some((c) => c.nomeExtraido.includes('Danos ao Cais')),
      'entrada de Sumário não deveria virar cobertura',
    )
  })

  t('Ingestão CG: cláusula "1. Fica entendido…" não vira cobertura Zurich', () => {
    // Cláusulas particulares/exclusões (págs. 137–146 do formato real) têm
    // título em caixa mista seguido de "1. Fica entendido e acordado…" —
    // NÃO da âncora "1. Riscos Cobertos".
    assert(
      !tituloEhCoberturaZurich('Cláusula de 1º Risco Absoluto', '1. Fica entendido e acordado que'),
      'cláusula não deveria casar a assinatura Zurich',
    )
    assert(
      !tituloEhCoberturaZurich(
        'Cláusula de Exclusão de Asbestos',
        '1. Fica entendido e acordado que',
      ),
      'cláusula de exclusão não deveria casar a assinatura Zurich',
    )
  })

  t('Ingestão CG: assinatura Zurich não afeta formatos Tokio/Chubb/AXA', () => {
    // Guardas de proteção: CAIXA ALTA e "Cláusula..." nunca passam pela
    // assinatura nova; os formatos existentes continuam pelos prefixos.
    assert(
      !tituloEhCoberturaZurich('COBERTURA ADICIONAL DE EXEMPLO', '1. RISCOS COBERTOS'),
      'título em CAIXA ALTA não deveria passar pela assinatura Zurich',
    )
    assert(
      !tituloEhCoberturaZurich('Cláusulas Particulares', '1. Riscos Cobertos'),
      'cabeçalho agrupador "Cláusulas Particulares" não deveria ser cobertura',
    )
    // Formato AXA intacto: prefixo caixa alta + "1.1 RISCOS COBERTOS".
    const pages = [
      page(1, [
        ['COBERTURA ADICIONAL DE EXEMPLO', 700],
        ['1.1 RISCOS COBERTOS', 660],
        ['texto de riscos cobertos da seção', 620],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas.some((c) => c.nomeExtraido === 'COBERTURA ADICIONAL DE EXEMPLO'),
      'formato AXA (prefixo caixa alta) deveria continuar reconhecendo a cobertura',
    )
    // A mesma página com título Zurich + prefixo caixa alto não duplica.
    const pages2 = [
      page(1, [
        ['Danos ao Cais', 700],
        ['1. Riscos Cobertos', 660],
        ['COBERTURA ADICIONAL DE EXEMPLO', 600],
        ['1.1 RISCOS COBERTOS', 560],
      ]),
    ]
    const leitura2 = lerCondicoesGerais(pages2)
    const coberturas2 = leitura2.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas2.length === 2,
      `deveria reconhecer as 2 coberturas (Zurich + AXA), veio ${JSON.stringify(coberturas2.map((c) => c.nomeExtraido))}`,
    )
  })

  t(
    'Ingestão CG: título Zurich atravessando a quebra de página ("Contas a Receber") é cobertura',
    () => {
      // v0.0.227 (tarefa 2b, parte 1): o título nasce no FIM de uma página
      // (após o bloco "5. Franquia") e a âncora "1. Riscos Cobertos" é a
      // PRIMEIRA linha da página seguinte — par título-âncora na atravessada
      // vira cobertura, com o corpo começando APÓS a âncora.
      assert(
        tituloEhCoberturaZurich('Contas a Receber', '1. Riscos Cobertos'),
        '"Contas a Receber" + "1. Riscos Cobertos" deveria casar a assinatura Zurich',
      )
      const pages = [
        page(1, [
          ['texto de riscos cobertos da seção anterior', 700],
          ['5. Franquia', 660],
          ['aplicável a cada cobertura, observado o limite mínimo', 620],
          ['Contas a Receber', 560],
        ]),
        page(2, [
          ['1. Riscos Cobertos', 700],
          ['mediante contratação desta cláusula, estarão cobertos os créditos', 660],
          ['3. Riscos Excluídos', 620],
          ['a) insolvência ou mora de devedores já noticiada na contratação', 580],
        ]),
        page(3, [['texto de riscos cobertos da próxima seção', 700]]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.some((c) => c.nomeExtraido === 'Contas a Receber'),
        `leitura completa deveria extrair a cobertura "Contas a Receber" atravessando a quebra de página, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      // O corpo da seção começa APÓS a âncora (a linha "1. Riscos Cobertos"
      // nunca entra como texto de cobertura) e a ocorrência aponta para a
      // página ONDE O TÍTULO NASCE (pág. 53 no caso real, pág. 1 aqui).
      const contas = coberturas.find((c) => c.nomeExtraido === 'Contas a Receber')
      assert(!!contas, 'cobertura "Contas a Receber" deveria existir na leitura')
      assert(
        contas!.pagina === 1 && contas!.slotY === 560,
        `a ocorrência deveria apontar para a página do título (1, y=560), veio ${contas?.pagina}/${contas?.slotY}`,
      )
      const todasExclusoesContas = (contas?.exclusoes || []).map((e) => e.texto || '').join(' | ')
      assert(
        !todasExclusoesContas.includes('1. Riscos Cobertos'),
        'a linha âncora "1. Riscos Cobertos" não deveria entrar no corpo da seção',
      )
      assert(
        todasExclusoesContas.includes('insolvência ou mora de devedores'),
        `as exclusões do bloco 3 da página seguinte deveriam ser extraídas, veio ${JSON.stringify(contas?.exclusoes || [])}`,
      )
      // Nenhuma outra cobertura deve nascer: "5. Franquia" não é título de
      // cobertura e a página 3 inteira é corpo da seção "Contas a Receber".
      assert(
        coberturas.length === 1,
        `deveria haver exatamente 1 cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
    },
  )

  // ------------------------------------------------------------------
  // 12.b) ZURICH — v0.0.228 (tarefa 2b, parte 2): guarda "Cláusula para
  //      ..." (Imóveis Tombados, pág. 137), cabeçalhos agrupadores no
  //      PLURAL ("Cláusulas Particulares" pág. 137, "Cláusulas de
  //      Coberturas Adicionais" pág. 45) e capa sem dois-pontos (Processo
  //      SUSEP Nº ... + Versão Setembro/2024). Fixtures ESTRUTURAIS
  //      genéricos (nenhum texto real do PDF entra aqui).
  // ------------------------------------------------------------------

  t('Ingestão CG: "Cláusula para Imóveis ..." não vira cobertura Zurich', () => {
    // Pág. 137 do formato real: título em caixa mista seguido da linha
    // "1. Riscos Cobertos" DA PRÓPRIA cláusula — sem a guarda, casava a
    // assinatura e virava cobertura espúria na fila.
    assert(
      !tituloEhCoberturaZurich(
        'Cláusula para Imóveis Tombados pelo Patrimônio Histórico',
        '1. Riscos Cobertos',
      ),
      '"Cláusula para ..." não deveria casar a assinatura Zurich',
    )
    // E via leitura completa: título + âncora na mesma página não gera item.
    const pages = [
      page(1, [
        ['Cláusula para Imóveis Tombados pelo Patrimônio Histórico', 700],
        ['1. Riscos Cobertos', 660],
        ['texto da cláusula, não de cobertura', 620],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas.length === 0,
      `"Cláusula para ..." não deveria virar cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
    )
  })

  t('Ingestão CG: cabeçalhos agrupadores no plural não são cobertura (não-regressão)', () => {
    // "Cláusulas Particulares" (pág. 137) e "Cláusulas de Coberturas
    // Adicionais" (pág. 45) são cabeçalhos de bloco, não cobertura — o
    // plural é barrado pela família "Cláusula(s) ..." desde a v0.0.226.
    assert(
      !tituloEhCoberturaZurich('Cláusulas Particulares', '1. Riscos Cobertos'),
      '"Cláusulas Particulares" não deveria ser cobertura',
    )
    assert(
      !tituloEhCoberturaZurich('Cláusulas de Coberturas Adicionais', '1. Riscos Cobertos'),
      '"Cláusulas de Coberturas Adicionais" não deveria ser cobertura',
    )
    // Via leitura completa: cabeçalho + âncora na mesma página não gera item.
    const pages = [
      page(1, [
        ['Cláusulas de Coberturas Adicionais', 700],
        ['1. Riscos Cobertos', 660],
        ['texto de riscos cobertos da seção', 620],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas.length === 0,
      `cabeçalho agrupador plural não deveria virar cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
    )
    // E o MARCADOR de bloco ("Cláusulas Particulares" solto na linha) também
    // não vira cobertura pelo caminho dos prefixos clássicos.
    assert(
      !tituloEhCobertura('Cláusulas Particulares'),
      '"Cláusulas Particulares" não deveria casar os prefixos clássicos',
    )
    assert(
      !tituloEhCobertura('Cláusulas de Coberturas Adicionais'),
      '"Cláusulas de Coberturas Adicionais" não deveria casar os prefixos clássicos',
    )
  })

  t(
    'Ingestão CG: capa Zurich sem dois-pontos detecta Processo SUSEP e Versão Setembro/2024',
    () => {
      // Capa (pág. 1): "Processo SUSEP Nº ..." SEM dois-pontos e versão com
      // NOME DE MÊS ("Versão Setembro/2024"). Nas páginas internas há
      // dois-pontos ("Processo SUSEP nº: ...", "Versão: Setembro/2024") —
      // formato que o detector já cobria.
      const textoCapa =
        'ZURICH Riscos Nomeados\nProcesso SUSEP Nº 15414.004288/2007-81\nVersão Setembro/2024'
      assert(
        detectarProcessoSusepCg(textoCapa) === '15414.004288/2007-81',
        `processo SUSEP da capa sem dois-pontos deveria casar, veio: ${detectarProcessoSusepCg(textoCapa)}`,
      )
      assert(
        detectarProdutoVersaoCg(textoCapa) === 'Versão Setembro/2024',
        `versão com nome de mês deveria ser detectada, veio: ${detectarProdutoVersaoCg(textoCapa)}`,
      )
      // Página interna (com dois-pontos) continua casando (pacto).
      const textoInterno =
        'ZURICH Riscos Nomeados\nProcesso SUSEP nº 15414.004288/2007-81\nVersão: Setembro/2024'
      assert(
        detectarProcessoSusepCg(textoInterno) === '15414.004288/2007-81',
        'formato com dois-pontos deveria continuar casando',
      )
      assert(
        detectarProdutoVersaoCg(textoInterno) === 'Versão Setembro/2024',
        'versão com dois-pontos deveria continuar casando',
      )
      // Versão NUMÉRICA tem prioridade sobre o nome de mês (pacto: a regra
      // da mais frequente só se aplica às ocorrências numéricas).
      assert(
        detectarProdutoVersaoCg('Versão Setembro/2024\nVersão 2 / 2018\nVersão 2 / 2018') ===
          'Versão 2/2018',
        'versão numérica deveria prevalecer sobre o nome de mês',
      )
      // E via leitura completa (documento inteiro, capa + interna).
      const pages = [
        page(1, [
          ['ZURICH Riscos Nomeados', 700],
          ['Processo SUSEP Nº 15414.004288/2007-81', 650],
          ['Versão Setembro/2024', 600],
        ]),
        page(2, [
          ['Processo SUSEP nº 15414.004288/2007-81', 700],
          ['Versão: Setembro/2024', 660],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      assert(
        leitura.processoSusepDetectado === '15414.004288/2007-81',
        `processo inesperado: ${leitura.processoSusepDetectado}`,
      )
      assert(
        leitura.produtoVersaoDetectado === 'Versão Setembro/2024',
        `versão inesperada: ${leitura.produtoVersaoDetectado}`,
      )
    },
  )

  // ------------------------------------------------------------------
  // 12.c) ZURICH — v0.0.230 (tarefa 2c): as 3 famílias de guarda da
  //      re-ingestão REAL (desvios das págs. 58, 124, 128, 131, 134 e 135
  //      do formato real — nenhum texto real entra aqui, só a ESTRUTURA):
  //      família 1 — título quebrado em 2-3 linhas (a cauda sozinha nunca
  //      vira cobertura; o título COMPLETO vira); família 2 — cauda de
  //      valor por extenso de tabela ("... reais)"); família 3 —
  //      continuação de parágrafo de fecho ("Permanecem as demais
  //      exclusões da Cláusula 6ª...").
  // ------------------------------------------------------------------

  t(
    'Ingestão CG: título Zurich quebrado em 2 linhas — cauda não vira cobertura e título completo vira',
    () => {
      // Estrutura do caso real (pág. 58): título em caixa mista quebrado —
      // "Danos Materiais por Interrupção do Fornecimento de Utilidades e/ou" +
      // "Serviços" + âncora "1. Riscos Cobertos". Sem o join, a cauda "Serviços"
      // casava a assinatura (âncora abaixo) e virava cobertura espúria.
      assert(
        tituloEhCoberturaZurich('Serviços', '1. Riscos Cobertos'),
        'a CAUDA sozinha casaria a assinatura — o join no leitor é quem impede a seção espúria',
      )
      const pages = [
        page(1, [
          ['Danos Materiais por Interrupção do Fornecimento de Utilidades e/ou', 620],
          ['Serviços', 580],
          ['1. Riscos Cobertos', 540],
          ['texto de riscos cobertos da seção', 500],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 1,
        `deveria haver exatamente 1 cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      assert(
        coberturas[0].nomeExtraido ===
          'Danos Materiais por Interrupção do Fornecimento de Utilidades e/ou Serviços',
        `o título COMPLETO deveria virar a cobertura, veio "${coberturas[0]?.nomeExtraido}"`,
      )
    },
  )

  t(
    'Ingestão CG: título Zurich quebrado em 3 linhas — cauda "Terrestres e Fumaça" não vira cobertura',
    () => {
      // Estrutura do caso real (pág. 135, título em 3 linhas): "Vendaval,
      // Furacão, Ciclone, Tornado, Granizo, Queda de Aeronaves ou Quaisquer
      // Outros Engenhos Aéreos ou Espaciais, Impacto de Veículos" +
      // "Terrestres e Fumaça" + âncora.
      const pages = [
        page(1, [
          ['Vendaval, Furacão, Ciclone, Tornado, Granizo, Queda de Aeronaves ou Quaisquer', 660],
          ['Outros Engenhos Aéreos ou Espaciais, Impacto de Veículos', 620],
          ['Terrestres e Fumaça', 580],
          ['1. Riscos Cobertos', 540],
        ]),
        page(2, [
          ['texto de riscos cobertos da seção', 680],
          ['3. Riscos Excluídos', 640],
          ['a) danos a aeronaves e engenhos aéreos ou espaciais', 600],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 1,
        `deveria haver exatamente 1 cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      assert(
        coberturas[0].nomeExtraido ===
          'Vendaval, Furacão, Ciclone, Tornado, Granizo, Queda de Aeronaves ou Quaisquer Outros Engenhos Aéreos ou Espaciais, Impacto de Veículos Terrestres e Fumaça',
        `o título COMPLETO em 3 linhas deveria virar a cobertura, veio "${coberturas[0]?.nomeExtraido}"`,
      )
    },
  )

  t('Ingestão CG: cauda de valor por extenso ("reais)") não vira cobertura Zurich', () => {
    // Estrutura do caso real (pág. 128, pos. 78): a tabela de limites quebra
    // "…(dezessete mil e quinhentos reais)" e a linha "reais)" — casada pela
    // assinatura (âncora abaixo) — virava cobertura espúria.
    assert(
      !tituloEhCoberturaZurich('reais)', '1. Riscos Cobertos'),
      'cauda "reais)" não deveria casar a assinatura Zurich (guarda 6)',
    )
    assert(
      RE_CAUDA_VALOR_EXTESTO_ZURICH.test('reais)'),
      'a guarda RE_CAUDA_VALOR_EXTESTO_ZURICH deveria casar "reais)"',
    )
    const pages = [
      page(1, [
        ['(dezessete mil e quinhentos', 620],
        ['reais)', 580],
        ['1. Riscos Cobertos', 540],
        ['texto de riscos cobertos da seção', 500],
      ]),
    ]
    const leitura = lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    assert(
      coberturas.length === 0,
      `cauda "reais)" não deveria virar cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
    )
  })

  t(
    'Ingestão CG: continuação de parágrafo "Permanecem as demais exclusões…" não vira cobertura Zurich',
    () => {
      // Estrutura do caso real (págs. 131 e 134): a linha embrulhada do fecho
      // da seção de exclusões — e a linha de abertura completa — nunca são
      // cobertura em QUALQUER página (guarda 5).
      const linhaAbertura =
        'Permanecem as demais exclusões da Cláusula 6ª - Exclusões Gerais das Condições Gerais'
      const linhaCauda =
        'que não tenham sido expressamente alteradas pela presente cobertura ou pelas demais'
      assert(
        !tituloEhCoberturaZurich(linhaAbertura, '1. Riscos Cobertos'),
        'fecho "Permanecem as demais exclusões..." não deveria casar a assinatura (guarda 5)',
      )
      assert(
        !tituloEhCoberturaZurich(linhaCauda, '1. Riscos Cobertos'),
        'cauda embrulhada "que não tenham sido expressamente alteradas..." não deveria casar a assinatura (guarda 5)',
      )
      const pages = [
        page(1, [
          ['Erros e Omissões', 700],
          ['1. Riscos Cobertos', 660],
          ['texto de riscos cobertos da seção', 620],
          ['3. Riscos Excluídos', 580],
          [linhaAbertura, 540],
          [linhaCauda, 500],
          ['1. Riscos Cobertos', 460],
          ['texto do bloco seguinte', 420],
        ]),
      ]
      const leitura = lerCondicoesGerais(pages)
      const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      assert(
        coberturas.length === 1 && coberturas[0].nomeExtraido === 'Erros e Omissões',
        `as 2 linhas do fecho não deveriam virar cobertura, veio ${JSON.stringify(coberturas.map((c) => c.nomeExtraido))}`,
      )
      assert(
        !coberturas.some((c) => c.nomeExtraido.startsWith('Permanecem')),
        'nenhuma linha "Permanecem..." deveria virar cobertura',
      )
    },
  )

  return resultados
}
