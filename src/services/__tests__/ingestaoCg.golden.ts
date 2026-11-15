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
  ehLinhaSumario,
  extrairExclusoesDoBloco,
  chaveGuardaCg,
  detectarProcessoSusepCg,
  detectarProcessoSusepNomeArquivo,
  detectarProdutoVersaoCg,
} from '@/services/cgIngestaoReader'
import {
  casarComMotorC3,
  calcularItensGuardaCg,
  LIMIAR_CONFIANCA_CG,
} from '@/services/cgIngestaoService'
import type { CoberturaCanonicaRecord } from '@/services/equivalenciaCoberturasService'

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
    },
  )

  return resultados
}
