/**
 * Runner determinístico de QA / Golden Tests para Parsers de Apólices.
 * Pode ser executado em ambiente browser ou Node.js (via Vite runner ou Vitest).
 *
 * NOTA: O fixture tokio-bt-fortaleza.json é opcional (pode não estar commitado
 * ou ser gerado via botão de debug na C1). Caso não exista, a suíte entra em
 * modo pendente reportando instruções sem quebrar o compilador TypeScript (TS2307).
 */
import {
  extractTokioCoberturas,
  extractTokioEmpresarialApolice,
  detectSeguradoraApolice,
  extractAxaApolice,
  extractAxaEmpresaFlexApolice,
  extractCleanCnpj,
  ExtractedApoliceCobertura,
} from '../apoliceReader'
import type { PdfPageText } from '../pdfTextExtractor'

// Utilitários de teste simples e expressivos
export interface TestResult {
  name: string
  suite: string
  passed: boolean
  pending?: boolean
  error?: string
}

export const results: TestResult[] = []

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label} -> Esperado: ${JSON.stringify(expected)} | Recebido: ${JSON.stringify(actual)}`,
    )
  }
}

function runTest(suite: string, name: string, fn: () => void) {
  try {
    fn()
    results.push({ suite, name, passed: true })
    console.log(`  ✓ [PASS] ${name}`)
  } catch (err: any) {
    results.push({ suite, name, passed: false, error: err?.message || String(err) })
    console.log(`  ✗ [FAIL] ${name}`)
    console.log(`    ↳ ${err?.message || err}`)
  }
}

function runPendingTest(suite: string, name: string, reason: string) {
  results.push({ suite, name, passed: true, pending: true, error: reason })
  console.log(`  ⊘ [PENDENTE] ${name}`)
  console.log(`    ↳ ${reason}`)
}

// Tabela-verdade das 17 coberturas oficiais travadas
export interface CoberturaGabarito {
  id: number
  nomePattern: RegExp
  nomeCompleto: string
  lmi: number
  franquiaPos: string
  franquiaTipo?: string
  premio: number
  condicao?: string
  textoOriginalFranquia?: RegExp
}

export const TABELA_VERDADE_TOKIO: CoberturaGabarito[] = [
  {
    id: 1,
    nomePattern: /Inc[êe]ndio.*Raio.*Explos[ãa]o/i,
    nomeCompleto:
      'Incêndio (Inclusive Decorrente de Tumultos, Greves e Lockout), Raio, Explosão, Implosão, Fumaça e Queda de Aeronaves',
    lmi: 3137400.0,
    franquiaPos: '10% min R$ 1.500,00',
    premio: 779.98,
    condicao: '(EXCLUSIVAMENTE EM CASO DE RAIO)',
  },
  {
    id: 2,
    nomePattern: /Custos\s+de\s+Defesa/i,
    nomeCompleto: 'Custos de Defesa do Segurado',
    lmi: 6000.0,
    franquiaPos: 'Não Há',
    premio: 18.55,
  },
  {
    id: 3,
    nomePattern: /Despesas\s+de\s+Conten[çc][ãa]o\s+e\s+Salvamento/i,
    nomeCompleto: 'Despesas de Contenção e Salvamento',
    lmi: 50000.0,
    franquiaPos: '10% min R$ 1.000,00',
    premio: 76.23,
  },
  {
    id: 4,
    nomePattern: /Danos\s+El[ée]tricos/i,
    nomeCompleto: 'Danos Elétricos',
    lmi: 30000.0,
    franquiaPos: '15% min R$ 2.500,00',
    premio: 261.81,
  },
  {
    id: 5,
    nomePattern: /Desmoronamento/i,
    nomeCompleto: 'Desmoronamento',
    lmi: 10000.0,
    franquiaPos: '20% min R$ 5.000,00',
    premio: 32.97,
  },
  {
    id: 6,
    nomePattern: /Equipamentos\s+Eletr[ôo]nicos/i,
    nomeCompleto: 'Equipamentos Eletrônicos',
    lmi: 10000.0, // conferido na Tabela-Verdade (~10.000,00)
    franquiaPos: '10% min R$ 500,00',
    premio: 36.26,
  },
  {
    id: 7,
    nomePattern: /Infidelidade\s+de\s+Empregados/i,
    nomeCompleto: 'Infidelidade de Empregados',
    lmi: 50000.0, // conferido no fixture
    franquiaPos: '10% min R$ 750,00',
    premio: 310.06,
  },
  {
    id: 8,
    nomePattern: /Lucros\s+Cessantes/i,
    nomeCompleto:
      'Lucros Cessantes (Despesas Fixas), em Decorrência de Incêndio (Inclusive Decorrente de Tumultos, Greves e Lockout), Raio, Explosão, Implosão, Fumaça e Queda de Aeronaves (Período Indenitário = 12 Meses)',
    lmi: 390000.0,
    franquiaPos: 'AS PRIMEIRAS 96 HORAS DE PARALISAÇÃO.',
    premio: 217.74,
    textoOriginalFranquia: /96\s*HORAS\s+DE\s+PARALISA[ÇC][ÃA]O/i,
  },
  {
    id: 9,
    nomePattern: /Recomposi[çc][ãa]o\s+de\s+Registros/i,
    nomeCompleto: 'Recomposição de Registros e Documentos',
    lmi: 10000.0, // conferido no fixture
    franquiaPos: '10% min R$ 600,00',
    premio: 91.95,
  },
  {
    id: 10,
    nomePattern: /Responsabilidade\s+Civil\s+Opera[çc][õo]es/i,
    nomeCompleto: 'Responsabilidade Civil Operações',
    lmi: 30000.0, // conferido no fixture
    franquiaPos: 'Não Há',
    premio: 69.67,
  },
  {
    id: 11,
    nomePattern: /Roubo\s+de\s+Bens\s+de\s+H[óo]spedes/i,
    nomeCompleto: 'Roubo de Bens de Hóspedes',
    lmi: 50000.0, // conferido no fixture
    franquiaPos: 'R$ 1.000,00',
    premio: 44.05,
  },
  {
    id: 12,
    nomePattern: /Roubo\s+e\s+Furto\s+Mediante\s+Arrombamento/i,
    nomeCompleto: 'Roubo e Furto Mediante Arrombamento',
    lmi: 5000.0,
    franquiaPos: '10% min R$ 3.000,00',
    premio: 91.95,
  },
  {
    id: 13,
    nomePattern: /Tumultos,\s*Greves,\s*Lockout\s*e\s*Atos\s*Dolosos/i,
    nomeCompleto: 'Tumultos, Greves, Lockout e Atos Dolosos',
    lmi: 10000.0, // conferido no fixture
    franquiaPos: '10% min R$ 750,00',
    premio: 32.97,
  },
  {
    id: 14,
    nomePattern: /Valores\s+em\s+Tr[âa]nsito/i,
    nomeCompleto: 'Valores em Trânsito',
    lmi: 10000.0, // conferido no fixture
    franquiaPos: '10% min R$ 500,00',
    premio: 393.97,
  },
  {
    id: 15,
    nomePattern: /Valores\s+no\s+Interior/i,
    nomeCompleto: 'Valores no Interior do Estabelecimento',
    lmi: 5000.0, // conferido no fixture
    franquiaPos: '10% min R$ 500,00',
    premio: 196.96,
  },
  {
    id: 16,
    nomePattern: /Sprinklers|Chuveiros|Equipamentos\s+Autom[áa]ticos/i,
    nomeCompleto: 'Vazamento de Chuveiros Automáticos (Sprinklers)',
    lmi: 100000.0,
    franquiaPos: '10% min R$ 500,00',
    premio: 32.97,
  },
  {
    id: 17,
    nomePattern: /Vendaval.*Impacto\s+de\s+Ve[íi]culos/i,
    nomeCompleto: 'Vendaval, Furacão, Ciclone, Tornado, Granizo e Impacto de Veículos',
    lmi: 100000.0,
    franquiaPos: '15% min R$ 2.500,00',
    premio: 79.27,
  },
]

// =========================================================================
// 1. CARREGAMENTO DO FIXTURE VIA IMPORT DINÂMICO
// =========================================================================
async function loadTokioFixture(): Promise<PdfPageText[] | null> {
  // Suporta ambiente Node.js (executado via `node scripts/run-tests.js` ou Vite SSR)
  try {
    const g: any = typeof globalThis !== 'undefined' ? globalThis : {}
    const proc = g.process
    if (proc && typeof proc.cwd === 'function') {
      const fsModName = 'node:fs'
      const pathModName = 'node:path'
      const fs = await import(/* @vite-ignore */ fsModName)
      const path = await import(/* @vite-ignore */ pathModName)
      const fixturePath = path.resolve(
        proc.cwd(),
        'src/services/__tests__/fixtures/tokio-bt-fortaleza.json',
      )
      if (fs.existsSync(fixturePath)) {
        const raw = fs.readFileSync(fixturePath, 'utf8')
        const data = JSON.parse(raw)
        if (data?.pages && data.pages.length > 0) {
          return data.pages
        }
      }
    }
  } catch {
    // Continua para fallback no browser via import.meta.glob
  }

  try {
    // Tenta carregar do diretório de fixtures primeiro
    const fixtureModules = (import.meta as any).glob('./fixtures/*.json', { eager: true })
    for (const k of Object.keys(fixtureModules || {})) {
      if (k.includes('tokio-bt-fortaleza')) {
        const data = fixtureModules[k]?.default || fixtureModules[k]
        if (data?.pages && data.pages.length > 0) {
          return data.pages
        }
      }
    }

    // Tenta carregar do diretório de assets diretamente onde o diagnóstico do anexo está instalado
    const assetModules = (import.meta as any).glob('../../assets/*tokio*.json', { eager: true })
    for (const k of Object.keys(assetModules || {})) {
      if (k.includes('diagnostico-fragmentos') || k.includes('tokiobtfortaleza') || k.includes('tokio')) {
        const mod: any = assetModules[k]
        const data = mod?.default || mod
        if (data?.pages && data.pages.length > 0) {
          const targetPages = [1, 2, 3, 4, 5, 6, 7, 204]
          return data.pages.filter((p: any) => targetPages.includes(p.pageNumber))
        }
      }
    }
  } catch {
    // Vite glob indisponível ou arquivo não localizado
  }

  return null
}

console.log('\n=================================================================')
console.log('  BYCOR P&C INTELLIGENCE - SUITE DE GOLDEN TESTS & NÃO-REGRESSÃO')
console.log('=================================================================\n')

// =========================================================================
// EXECUÇÃO PRINCIPAL
// =========================================================================
export async function runAllSuites() {
  const tokioPages = await loadTokioFixture()

  // =========================================================================
  // SUITE A: TOKIO MARINE EMPRESARIAL - GOLDEN TEST (17 COBERTURAS TRAVADAS)
  // =========================================================================
  console.log('SUITE A: Tokio Marine BT Fortaleza (Gabarito 17 Coberturas)')

  if (!tokioPages) {
    const pendingMsg =
      'fixture ausente — gere via botão de debug na C1 (Exportar diagnóstico de fragmentos)'
    console.log(`  [AVISO] ${pendingMsg}`)
    runPendingTest('Tokio Marine', 'Asserções de Nível de Apólice', pendingMsg)
    runPendingTest('Tokio Marine', 'Quadro de Coberturas (17 Linhas)', pendingMsg)
    for (const gab of TABELA_VERDADE_TOKIO) {
      runPendingTest('Tokio Marine', `Cobertura ${gab.id}/17: ${gab.nomeCompleto}`, pendingMsg)
    }
  } else {
    // Executa a extração no pipeline real
    const tokioSegInfo = detectSeguradoraApolice(tokioPages.map((p) => p.text).join('\n'))
    const tokioApoliceResult = extractTokioEmpresarialApolice(tokioPages, tokioSegInfo)
    const _tokioCoberturasGeometricas = extractTokioCoberturas(tokioPages)

    runTest(
      'Tokio Marine',
      'Asserções de Nível de Apólice (Número, Vigência, CNPJ, Forma de Contratação)',
      () => {
        assertEqual(
          tokioApoliceResult.seguradoraNome,
          'Tokio Marine Seguradora S.A.',
          'Nome Seguradora',
        )
        assertEqual(tokioApoliceResult.seguradoraCnpj, '33.164.021/0001-00', 'CNPJ Seguradora')
        assertEqual(
          tokioApoliceResult.numeroApolice,
          '03739924',
          'Número da Apólice (apenas sequência identificadora)',
        )
        assertEqual(tokioApoliceResult.numeroProposta, '15772067', 'Número da Proposta')
        assertEqual(tokioApoliceResult.seguradoNome, 'BT FORTALEZA HOTEIS LTDA', 'Nome do Segurado')
        assertEqual(tokioApoliceResult.seguradoCnpj, '38.594.094/0001-47', 'CNPJ do Segurado')
        assertEqual(
          tokioApoliceResult.formaContratacao,
          '1º Risco Relativo',
          'Forma de Contratação Principal',
        )

        // VRD e Prêmios
        assertEqual(tokioApoliceResult.vrdTotalDm, 3137400, 'VRD Total DM')
        assertEqual(tokioApoliceResult.vrdTotalLc, 390000, 'VRD Total LC')
        assertEqual(tokioApoliceResult.premioLiquido, 2708.38, 'Prêmio Líquido')
        assertEqual(tokioApoliceResult.iof, 199.87, 'IOF')
        assertEqual(tokioApoliceResult.premioTotal, 2908.25, 'Prêmio Total')

        // Cláusulas 10.1 e 10.3 na observação / preview
        assert(
          tokioApoliceResult.rawTextPreview.includes(
            'Rateio se VRD < 80% do VRA (cláusula 10.1)',
          ) || tokioApoliceResult.rawTextPreview.includes('Rateio se VRD < 80% do VRA'),
          'P.O.S. de Rateio DM cláusula 10.1 deve constar na observação/preview',
        )
      },
    )

    runTest(
      'Tokio Marine',
      'Quadro de Coberturas: Total Exato de 17 Linhas e Nenhuma Espúria',
      () => {
        assertEqual(
          tokioApoliceResult.coberturas.length,
          17,
          'Total de coberturas extraídas do quadro "Especificação da Apólice" (págs 5–7)',
        )
        const nomesEspurios = [
          'queda de aeronaves',
          'salvamento danos elétricos',
          'documentos responsabilidade civil operações',
          'estabelecimento vazamento de chuveiros',
          'dolosos valores em trânsito',
        ]
        for (const c of tokioApoliceResult.coberturas) {
          for (const esp of nomesEspurios) {
            assert(
              c.nome.trim().toLowerCase() !== esp,
              `Cobertura espúria detectada no quadro: "${c.nome}" (derivação incorreta de quebra de linha)`,
            )
          }
        }
      },
    )

    // Rodar asserções individuais travadas para as 17 coberturas
    for (const gab of TABELA_VERDADE_TOKIO) {
      runTest('Tokio Marine', `Cobertura ${gab.id}/17: ${gab.nomeCompleto}`, () => {
        const cob = tokioApoliceResult.coberturas.find((c) => gab.nomePattern.test(c.nome))
        assert(
          Boolean(cob),
          `Cobertura "${gab.nomeCompleto}" não foi encontrada entre as lidas pelo parser`,
        )

        if (!cob) return

        assertEqual(cob.lmi, gab.lmi, `LMI da cobertura "${gab.nomeCompleto}"`)
        assertEqual(
          cob.franquiaPos,
          gab.franquiaPos,
          `Franquia Normalizada da cobertura "${gab.nomeCompleto}"`,
        )
        assert(
          cob.observacao?.includes(gab.premio.toFixed(2)) || false,
          `Prêmio da cobertura "${gab.nomeCompleto}" -> Esperado: R$ ${gab.premio.toFixed(2)} | Observação: ${cob.observacao}`,
        )

        if (gab.condicao) {
          assert(
            cob.franquiaEstruturada?.condicao?.includes('RAIO') ||
              cob.franquiaEstruturada?.textoOriginal?.includes('RAIO') ||
              false,
            `Condição original "${gab.condicao}" deve estar presente no campo estruturado`,
          )
        }

        assert(
          !cob.franquiaPos.includes(gab.premio.toFixed(2)),
          `Prêmio R$ ${gab.premio.toFixed(2)} não pode vazar para dentro da franquia ("${cob.franquiaPos}")`,
        )
      })
    }

    // Imprime a tabela diagnóstica detalhada das 17 coberturas se fixture presente
    console.log('\nMAPA DE DISCREPÂNCIAS DO PARSER TOKIO ATUAL (Insumo da Rodada B):')
    console.log('-----------------------------------------------------------------')
    TABELA_VERDADE_TOKIO.forEach((gab) => {
      const cob = tokioApoliceResult.coberturas.find((c) => gab.nomePattern.test(c.nome))
      if (!cob) {
        console.log(`[#${gab.id}] ${gab.nomeCompleto}`)
        console.log(`     Status: NÃO ENCONTRADA / FALTANTE`)
        return
      }

      const lmiOk = cob.lmi === gab.lmi
      const franqOk = cob.franquiaPos === gab.franquiaPos
      const premOk = cob.observacao?.includes(gab.premio.toFixed(2))

      const status = lmiOk && franqOk && premOk ? 'CASOU' : 'DIVERGIU'
      console.log(`[#${gab.id}] [${status}] ${gab.nomeCompleto}`)
      if (!lmiOk) {
        console.log(`     LMI Divergente: obtido ${cob.lmi} vs esperado ${gab.lmi}`)
      }
      if (!franqOk) {
        console.log(
          `     Franquia Divergente: obtido "${cob.franquiaPos}" vs esperado "${gab.franquiaPos}"`,
        )
      }
      if (!premOk) {
        console.log(
          `     Prêmio Divergente: obtido "${cob.observacao}" vs esperado "R$ ${gab.premio.toFixed(2)}"`,
        )
      }
    })
  }

  // =========================================================================
  // SUITE B: TESTES DE NÃO-REGRESSÃO AXA E GUARDS DE INTEGRIDADE
  // =========================================================================
  console.log('\nSUITE B: Não-Regressão AXA (RN e Empresa Flex) e Guards de Integridade')

  // Teste B.1: Guard CNPJ seguradora ≠ corretora
  runTest(
    'Integridade',
    'Guard de Integridade: CNPJ Seguradora nunca pode ser idêntico ao do Corretor',
    () => {
      const corretorCnpjBycor = '17.267.516/0001-08'

      const sampleTextWithRepeatedCnpj = `
      Seguradora: AXA Seguros S.A.
      CNPJ: 17.267.516/0001-08
      Corretor: BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA
      CNPJ: 17.267.516/0001-08
    `
      const segCnpj = extractCleanCnpj(sampleTextWithRepeatedCnpj, 'Seguradora')
      assert(segCnpj === corretorCnpjBycor, 'Extração crua isolada capturaria o CNPJ')

      const mockPages: PdfPageText[] = [
        {
          pageNumber: 1,
          lines: [
            'AXA Seguros S.A.',
            'Apólice: 02852.2026.0001.0196.0009004',
            'Ramo: 01.96 RISCOS NOMEADOS',
          ],
          text: 'AXA Seguros S.A.\nApólice: 02852.2026.0001.0196.0009004\nRamo: 01.96 RISCOS NOMEADOS',
        },
        {
          pageNumber: 2,
          lines: [
            'Seguradora: AXA Seguros S.A.',
            'CNPJ: 17.267.516/0001-08',
            'Corretor: BYCOR CONSULTORIA',
            'CNPJ: 17.267.516/0001-08',
          ],
          text: 'Seguradora: AXA Seguros S.A.\nCNPJ: 17.267.516/0001-08\nCorretor: BYCOR CONSULTORIA\nCNPJ: 17.267.516/0001-08',
        },
      ]

      const axaRes = extractAxaApolice(mockPages)
      assert(
        axaRes.seguradoraCnpj !== axaRes.corretorCnpj,
        `CNPJ Seguradora (${axaRes.seguradoraCnpj}) NÃO pode ser igual ao do Corretor (${axaRes.corretorCnpj})`,
      )
      assertEqual(
        axaRes.seguradoraCnpj,
        '19.323.190/0001-06',
        'CNPJ AXA canônico restaurado pelo guard',
      )
    },
  )

  // Teste B.2: Parser AXA Riscos Nomeados (amostra representativa)
  runTest('AXA RN', 'Parser AXA Riscos Nomeados: extrai apólice, proposta e vigência', () => {
    const axaRnPages: PdfPageText[] = [
      {
        pageNumber: 1,
        lines: [
          'Apólice: 02852.2026.0001.0196.0009004',
          'Ramo: Proposta: Endosso:',
          '01.96 RISCOS NOMEADOS P-0119084',
          'Início de Vigência: Fim de Vigência:',
          'Ás 24h do dia 25/09/2026 Ás 24h do dia 25/09/2027',
          'Segurado: CONDOMINIO EDIFICIO CAESAR TOWERS ANALIA',
          'CNPJ: 04.082.217/0001-49',
          'Corretor: BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA',
          'CNPJ: 17.267.516/0001-08 SUSEP: 202027021',
        ],
        text: [
          'Apólice: 02852.2026.0001.0196.0009004',
          'Ramo: Proposta: Endosso:',
          '01.96 RISCOS NOMEADOS P-0119084',
          'Início de Vigência: Fim de Vigência:',
          'Ás 24h do dia 25/09/2026 Ás 24h do dia 25/09/2027',
          'Segurado: CONDOMINIO EDIFICIO CAESAR TOWERS ANALIA',
          'CNPJ: 04.082.217/0001-49',
          'Corretor: BYCOR CONSULTORIA E CORRETORA DE SEGUROS LTDA',
          'CNPJ: 17.267.516/0001-08 SUSEP: 202027021',
        ].join('\n'),
      },
      {
        pageNumber: 2,
        lines: [
          'Seguradora: AXA Seguros S.A.',
          'CNPJ: 19.323.190/0001-06 Registo Susep 0285-2',
          'Prêmio R$ 31.471,85 Moeda: Real',
          'Valor IOF(7,38%) R$ 2.322,62',
          'PRÊMIO TOTAL R$ 33.794,47',
        ],
        text: [
          'Seguradora: AXA Seguros S.A.',
          'CNPJ: 19.323.190/0001-06 Registo Susep 0285-2',
          'Prêmio R$ 31.471,85 Moeda: Real',
          'Valor IOF(7,38%) R$ 2.322,62',
          'PRÊMIO TOTAL R$ 33.794,47',
        ].join('\n'),
      },
      {
        pageNumber: 3,
        lines: [
          '1.2 Detalhamento do valor em risco',
          '1 49.441.434,38 0,00 0,00 49.441.434,38 5.340.925,00',
          '1.3 Limite Máximo de Garantia LMGA: 54.982.359,38',
        ],
        text: [
          '1.2 Detalhamento do valor em risco',
          '1 49.441.434,38 0,00 0,00 49.441.434,38 5.340.925,00',
          '1.3 Limite Máximo de Garantia LMGA: 54.982.359,38',
        ].join('\n'),
      },
    ]

    const result = extractAxaApolice(axaRnPages)
    assertEqual(result.seguradoraNome, 'AXA Seguros S.A.', 'Nome Seguradora')
    assertEqual(result.seguradoraCnpj, '19.323.190/0001-06', 'CNPJ AXA')
    assertEqual(result.numeroApolice, '02852.2026.0001.0196.0009004', 'Nº Apólice AXA RN')
    assertEqual(result.numeroProposta, 'P-0119084', 'Nº Proposta AXA RN')
    assertEqual(result.vigenciaInicio, '2026-09-25', 'Início Vigência')
    assertEqual(result.vigenciaFim, '2027-09-25', 'Fim Vigência')
    assertEqual(result.premioLiquido, 31471.85, 'Prêmio Líquido')
    assertEqual(result.iof, 2322.62, 'IOF')
    assertEqual(result.premioTotal, 33794.47, 'Prêmio Total')
  })

  // Teste B.3: Parser AXA Empresa Flex (amostra representativa)
  runTest('AXA Empresa Flex', 'Parser AXA Empresa Flex: extrai dados e vigência', () => {
    const axaFlexPages: PdfPageText[] = [
      {
        pageNumber: 1,
        lines: [
          'AXA Seguros S.A.',
          'EMPRESA FLEX',
          'Apólice: EMP0201800071129',
          'Proposta: EMP0201800071129',
          'Ramo: 01.18 – Empresarial',
          'Segurado: BT SORRISO HOTEIS LTDA',
          'CNPJ: 62.805.347/0001-69',
          'Corretor: Bycor Consultoria E Corretora De Seguros Ltda',
          'CNPJ: 17.267.516/0001-08',
        ],
        text: [
          'AXA Seguros S.A.',
          'EMPRESA FLEX',
          'Apólice: EMP0201800071129',
          'Proposta: EMP0201800071129',
          'Ramo: 01.18 – Empresarial',
          'Segurado: BT SORRISO HOTEIS LTDA',
          'CNPJ: 62.805.347/0001-69',
          'Corretor: Bycor Consultoria E Corretora De Seguros Ltda',
          'CNPJ: 17.267.516/0001-08',
        ].join('\n'),
      },
      {
        pageNumber: 2,
        lines: ['Prêmio Líquido: R$ 28.130,10', 'IOF: R$ 2.076,00', 'Prêmio Total: R$ 30.206,10'],
        text: [
          'Prêmio Líquido: R$ 28.130,10',
          'IOF: R$ 2.076,00',
          'Prêmio Total: R$ 30.206,10',
        ].join('\n'),
      },
    ]

    const flexRes = extractAxaEmpresaFlexApolice(axaFlexPages)
    assertEqual(flexRes.seguradoraNome, 'AXA Seguros S.A.', 'Nome Seguradora Empresa Flex')
    assertEqual(flexRes.numeroApolice, 'EMP0201800071129', 'Número Apólice Empresa Flex')
    assertEqual(flexRes.seguradoNome, 'BT SORRISO HOTEIS LTDA', 'Nome Segurado')
    assertEqual(flexRes.seguradoCnpj, '62.805.347/0001-69', 'CNPJ Segurado')
  })

  // =========================================================================
  // RESUMO DA EXECUÇÃO
  // =========================================================================
  console.log('\n-----------------------------------------------------------------')
  console.log('RESUMO DA EXECUÇÃO:')
  const passedCount = results.filter((r) => r.passed && !r.pending).length
  const pendingCount = results.filter((r) => r.pending).length
  const failedCount = results.filter((r) => !r.passed).length
  console.log(
    `Total de testes: ${results.length} | Aprovados: ${passedCount} | Pendentes: ${pendingCount} | Falhas: ${failedCount}`,
  )
  console.log('-----------------------------------------------------------------\n')
}

// Execução automática auto-invocada
void runAllSuites()
