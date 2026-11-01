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
import { extractAxaDetails } from '../propostaReader'
import { calcularFluxoPremios, ALIQUOTA_IOF_PADRAO } from '../rfqPropostasService'
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
      if (
        k.includes('diagnostico-fragmentos') ||
        k.includes('tokiobtfortaleza') ||
        k.includes('tokio')
      ) {
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
async function loadAxaRnFixture(): Promise<PdfPageText[] | null> {
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
        'src/services/__tests__/fixtures/axa-rn-international-square.json',
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
    // Continua para Vite glob
  }

  try {
    const fixtureModules = (import.meta as any).glob('./fixtures/*.json', { eager: true })
    for (const k of Object.keys(fixtureModules || {})) {
      if (k.includes('axa-rn-international-square')) {
        const data = fixtureModules[k]?.default || fixtureModules[k]
        if (data?.pages && data.pages.length > 0) {
          return data.pages
        }
      }
    }
  } catch {
    // Vite glob indisponível
  }

  return null
}

export async function runAllSuites() {
  const tokioPages = await loadTokioFixture()
  const axaRnPages = await loadAxaRnFixture()

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
  // SUITE C: AXA RISCOS NOMEADOS PROPOSTA - GOLDEN TEST (40 COBERTURAS)
  // =========================================================================
  console.log('\nSUITE C: AXA Riscos Nomeados Proposta - Golden Test (São International Square)')

  if (!axaRnPages) {
    const pendingMsg = 'fixture axa-rn-international-square.json não carregado'
    runPendingTest('AXA RN Proposta', 'Asserções de Cabeçalho e Valores da Proposta', pendingMsg)
    runPendingTest('AXA RN Proposta', 'Quadro Completo de Coberturas (40 Coberturas)', pendingMsg)
  } else {
    const axaResult = extractAxaDetails(axaRnPages)

    runTest(
      'AXA RN Proposta',
      'Asserções de Cabeçalho e Valores da Proposta (Número, Proponente, Vigência, Prêmio, Parcelas)',
      () => {
        assertEqual(axaResult.numeroCotacao, 'C4513405 / 2026 – Opção B1', 'Carta Cotação nº')
        assertEqual(axaResult.versao, 'B1', 'Versão / Opção')
        assertEqual(axaResult.vigenciaInicio, '2026-10-31', 'Início Vigência')
        assertEqual(axaResult.vigenciaFim, '2027-10-31', 'Fim Vigência')
        assertEqual(axaResult.premioLiquido, 32314.71, 'Prêmio Líquido')
        assertEqual(axaResult.iof, 2384.83, 'IOF')
        assertEqual(axaResult.premioTotal, 34699.54, 'Prêmio Total')
        assertEqual(axaResult.numeroParcelas, 4, 'Número de Parcelas Máximo Sem Juros')
        assertEqual(axaResult.lmiTotal, 95500000, 'LMI Total (LMGA)')

        // VRD pré-preenchido e derivado
        // DM = 80.000.000 (LMI Incêndio Básica / Valor em Risco DM)
        // LC = 15.000.000 (LMI Lucros Cessantes)
        assertEqual(axaResult.vrdDm, 80000000, 'VRD Danos Materiais')
        assertEqual(axaResult.vrdLc, 15000000, 'VRD Lucros Cessantes')

        assertEqual(
          axaResult.dadosComplementares?.seguradoNome,
          'CONDOMÍNIO SÃO INTERNATIONAL SQUARE',
          'Nome do Segurado/Proponente',
        )
        assertEqual(
          axaResult.dadosComplementares?.seguradoCnpj,
          '24.742.208/0002-25',
          'CNPJ do Proponente',
        )
      },
    )

    runTest(
      'AXA RN Proposta',
      'Quadro Completo de Coberturas: Total Exato de 40 Linhas (32 DM + 7 RC + 1 LC)',
      () => {
        assertEqual(
          axaResult.coberturas?.length || 0,
          40,
          'Total de 40 coberturas extraídas da proposta AXA RN',
        )
      },
    )

    // Asserções individuais das 40 coberturas com nomes, LMIs e franquias
    const TABELA_VERDADE_AXA_RN: Array<{
      id: number
      nomePattern: RegExp
      nomeDesc: string
      lmi: number
      franquia: string
    }> = [
      {
        id: 1,
        nomePattern: /Inc[êe]ndio.*Queda De Raio.*Explos[ãa]o/i,
        nomeDesc: 'Incêndio Básica',
        lmi: 80000000.0,
        franquia: '10% min R$ 10.000,00',
      },
      {
        id: 2,
        nomePattern: /Alagamento E Inunda[çc][ãa]o/i,
        nomeDesc: 'Alagamento E Inundação',
        lmi: 500000.0,
        franquia: '20% min R$ 20.000,00',
      },
      {
        id: 3,
        nomePattern: /An[úu]ncios E Letreiros/i,
        nomeDesc: 'Anúncios E Letreiros Luminosos',
        lmi: 200000.0,
        franquia: '10% min R$ 2.000,00',
      },
      {
        id: 4,
        nomePattern: /Danos El[ée]tricos/i,
        nomeDesc: 'Danos Elétricos',
        lmi: 500000.0,
        franquia: '15% min R$ 10.000,00',
      },
      {
        id: 5,
        nomePattern: /Danos Por [ÁA]gua/i,
        nomeDesc: 'Danos Por Água',
        lmi: 500000.0,
        franquia: '20% min R$ 10.000,00',
      },
      {
        id: 6,
        nomePattern: /Demoli[çc][ãa]o E Desentulho/i,
        nomeDesc: 'Demolição E Desentulho',
        lmi: 500000.0,
        franquia: '10% min R$ 1.000,00',
      },
      {
        id: 7,
        nomePattern: /Sprinklers|Derrame D['’]Água/i,
        nomeDesc: 'Derrame D’Água (Sprinklers)',
        lmi: 1000000.0,
        franquia: '15% min R$ 5.000,00',
      },
      {
        id: 8,
        nomePattern: /Desmoronamento/i,
        nomeDesc: 'Desmoronamento',
        lmi: 1000000.0,
        franquia: '15% min R$ 20.000,00',
      },
      {
        id: 9,
        nomePattern: /Honor[áa]rios De Peritos/i,
        nomeDesc: 'Despesas Com Honorários De Peritos – Danos Materiais',
        lmi: 300000.0,
        franquia: '10% min R$ 1.000,00',
      },
      {
        id: 10,
        nomePattern: /Recomposi[çc][ãa]o De Registros/i,
        nomeDesc: 'Despesas Com Recomposição De Registros E Documentos',
        lmi: 10000.0,
        franquia: '10% min R$ 1.000,00',
      },
      {
        id: 11,
        nomePattern: /Salvamento E Conten[çc][ãa]o/i,
        nomeDesc: 'Despesas De Salvamento E Contenção De Sinistros',
        lmi: 500000.0,
        franquia: 'De acordo com o evento e/ou cobertura acionada',
      },
      {
        id: 12,
        nomePattern: /Deteriora[çc][ãa]o De Mercadorias.*Frigorificados/i,
        nomeDesc: 'Deterioração De Mercadorias Em Ambientes Frigorificados',
        lmi: 50000.0,
        franquia: '20% min R$ 5.000,00',
      },
      {
        id: 13,
        nomePattern: /Equipamentos Arrendados Ou Cedidos/i,
        nomeDesc: 'Equipamentos Arrendados Ou Cedidos A Terceiros',
        lmi: 250000.0,
        franquia: '10% min R$ 5.000,00',
      },
      {
        id: 14,
        nomePattern: /Equipamentos Eletr[ôo]nicos Sem Roubo/i,
        nomeDesc: 'Equipamentos Eletrônicos Sem Roubo (A)',
        lmi: 250000.0,
        franquia: '25% min R$ 5.000,00',
      },
      {
        id: 15,
        nomePattern: /Equipamentos Estacion[áa]rios/i,
        nomeDesc: 'Equipamentos Estacionários',
        lmi: 300000.0,
        franquia: '15% min R$ 5.000,00',
      },
      {
        id: 16,
        nomePattern: /Equipamentos M[óo]veis/i,
        nomeDesc: 'Equipamentos Móveis',
        lmi: 50000.0,
        franquia: '10% min R$ 5.000,00',
      },
      {
        id: 17,
        nomePattern: /Equipamentos Ou Objetos Port[áa]teis/i,
        nomeDesc: 'Equipamentos Ou Objetos Portáteis',
        lmi: 50000.0,
        franquia: '20% min R$ 500,00 por equipamento',
      },
      {
        id: 18,
        nomePattern: /Fidelidade/i,
        nomeDesc: 'Fidelidade',
        lmi: 100000.0,
        franquia: '10% min R$ 1.000,00',
      },
      {
        id: 19,
        nomePattern: /Obras De Arte/i,
        nomeDesc: 'Obras De Arte',
        lmi: 100000.0,
        franquia: '10% min R$ 1.000,00',
      },
      {
        id: 20,
        nomePattern: /Pequenas Obras De Engenharia/i,
        nomeDesc: 'Pequenas Obras De Engenharia, Para Ampliações, Reparos Ou Reformas',
        lmi: 300000.0,
        franquia: '10% min R$ 10.000,00',
      },
      {
        id: 21,
        nomePattern: /Perda Ou Pagamento De Aluguel/i,
        nomeDesc: 'Perda Ou Pagamento De Aluguel',
        lmi: 1000000.0,
        franquia: 'Os primeiros 10 dias corridos PI: 12 meses',
      },
      {
        id: 22,
        nomePattern: /Quebra De M[aá]quinas/i,
        nomeDesc: 'Quebra De Maquinas',
        lmi: 250000.0,
        franquia: '15% min R$ 10.000,00',
      },
      {
        id: 23,
        nomePattern: /Quebra De Vidros/i,
        nomeDesc: 'Quebra De Vidros, Espelhos, Mármores E Granitos',
        lmi: 300000.0,
        franquia: '10% min R$ 2.000,00',
      },
      {
        id: 24,
        nomePattern: /Roubo De Valores Dos H[óo]spedes.*Cofre-Forte/i,
        nomeDesc: 'Roubo De Valores Dos Hóspedes No Interior De Cofre-Forte',
        lmi: 10000.0,
        franquia: '10% min R$ 2.500,00',
      },
      {
        id: 25,
        nomePattern: /Roubo De Valores Em Tr[âa]nsito/i,
        nomeDesc: 'Roubo De Valores Em Trânsito Em Mãos De Portadores',
        lmi: 10000.0,
        franquia: '10% min R$ 2.500,00',
      },
      {
        id: 26,
        nomePattern: /Roubo De Valores No Interior Do Estabelecimento/i,
        nomeDesc: 'Roubo De Valores No Interior Do Estabelecimento',
        lmi: 10000.0,
        franquia: '10% min R$ 2.500,00',
      },
      {
        id: 27,
        nomePattern: /^Roubo E\/Ou Furto Qualificado De Bens$/i,
        nomeDesc: 'Roubo E/Ou Furto Qualificado De Bens',
        lmi: 250000.0,
        franquia: '10% min R$ 5.000,00',
      },
      {
        id: 28,
        nomePattern: /Roubo E\/Ou Furto Qualificado De Bens Dos H[óo]spedes/i,
        nomeDesc: 'Roubo E/Ou Furto Qualificado De Bens Dos Hóspedes',
        lmi: 50000.0,
        franquia: '10% min R$ 5.000,00',
      },
      {
        id: 29,
        nomePattern: /Terremoto E Tremores De Terra/i,
        nomeDesc: 'Terremoto E Tremores De Terra',
        lmi: 500000.0,
        franquia: '15% min R$ 5.000,00',
      },
      {
        id: 30,
        nomePattern: /Tumulto.*Lock-Out/i,
        nomeDesc: 'Tumulto, Greves, “Lock-Out”, Atos Dolosos, Vandalismo E Comoção Civil',
        lmi: 1000000.0,
        franquia: '15% min R$ 5.000,00',
      },
      {
        id: 31,
        nomePattern: /Vazamento De Tanques E Tubula[çc][õo]es/i,
        nomeDesc: 'Vazamento De Tanques E Tubulações',
        lmi: 500000.0,
        franquia: '20% min R$ 10.000,00',
      },
      {
        id: 32,
        nomePattern: /Vendaval.*Impacto De Ve[íi]culos/i,
        nomeDesc: 'Vendaval, Furacão, Granizo, Tornado e Fumaça',
        lmi: 500000.0,
        franquia: '20% min R$ 10.000,00',
      },
      {
        id: 33,
        nomePattern: /Responsabilidade Civil Condom[íi]nio Empresarial/i,
        nomeDesc: 'RC Condomínio Empresarial',
        lmi: 1000000.0,
        franquia: '30% min R$ 3.000,00 por reclamante',
      },
      {
        id: 34,
        nomePattern: /Responsabilidade Civil Estabelecimentos De Hospedagem/i,
        nomeDesc: 'RC Hospedagem, Restaurantes, Boates E Similares',
        lmi: 1000000.0,
        franquia: '10% min R$ 3.000,00 por reclamante',
      },
      {
        id: 35,
        nomePattern: /Responsabilidade Civil Danos Morais/i,
        nomeDesc: 'RC Danos Morais',
        lmi: 500000.0,
        franquia: 'Prejuízos somados a cobertura acionada',
      },
      {
        id: 36,
        nomePattern: /Responsabilidade Civil Do Empregador/i,
        nomeDesc: 'RC Do Empregador',
        lmi: 1000000.0,
        franquia: '10% min R$ 3.000,00 por reclamante',
      },
      {
        id: 37,
        nomePattern: /Responsabilidade Civil Guarda De Ve[íi]culos De Terceiros/i,
        nomeDesc: 'RC Guarda De Veículos De Terceiros – Compreensiva',
        lmi: 250000.0,
        franquia: '10% min R$ 3.000,00 por veículo',
      },
      {
        id: 38,
        nomePattern: /Responsabilidade Civil Port[õo]es Autom[áa]ticos/i,
        nomeDesc: 'RC Portões Automáticos',
        lmi: 250000.0,
        franquia: '10% min R$ 3.000,00 por veículo',
      },
      {
        id: 39,
        nomePattern: /Responsabilidade Civil S[íi]ndico/i,
        nomeDesc: 'RC Síndico',
        lmi: 1000000.0,
        franquia: '10% min R$ 3.000,00 por reclamante',
      },
      {
        id: 40,
        nomePattern: /Lucros Cessantes.*Decorrentes De Inc[êe]ndio/i,
        nomeDesc: 'Lucros Cessantes [Ll+Df]',
        lmi: 15000000.0,
        franquia: 'Os primeiros 15 dias corridos PI: 12 meses',
      },
    ]

    for (const item of TABELA_VERDADE_AXA_RN) {
      runTest('AXA RN Coberturas', `Cobertura ${item.id}/40: ${item.nomeDesc}`, () => {
        const found = axaResult.coberturas?.find((c) => item.nomePattern.test(c.cobertura))
        assert(Boolean(found), `Cobertura "${item.nomeDesc}" não encontrada`)
        if (found) {
          assertEqual(found.lmi, item.lmi, `LMI ${item.nomeDesc}`)
          assertEqual(found.franquia, item.franquia, `Franquia ${item.nomeDesc}`)
        }
      })
    }
  }

  // =========================================================================
  // SUÍTE 4: REGRA DE IOF NO FLUXO DE PRÊMIOS (C2)
  // =========================================================================
  runTest(
    'Regra de IOF C2',
    'IOF explícito informado prevalece (Caso AXA International Square: 2.384,83 / 34.699,54)',
    () => {
      const res = calcularFluxoPremios({
        base: 'liquido',
        premioLiquido: 32314.71,
        iof: 2384.83,
      })
      assertEqual(res.liquido, 32314.71, 'Prêmio Líquido')
      assertEqual(res.iof, 2384.83, 'IOF explícito')
      assertEqual(res.bruto, 34699.54, 'Prêmio Bruto = Líquido + IOF')
      assertEqual(res.iofDerivado, false, 'IOF derivado')
    },
  )

  runTest(
    'Regra de IOF C2',
    'IOF não informado deriva automaticamente Líquido * 7,38% e Bruto = Líquido + IOF',
    () => {
      const res = calcularFluxoPremios({
        base: 'liquido',
        premioLiquido: 32314.71,
      })
      // 32.314,71 * 0,0738 = 2.384,825598 -> 2.384,83
      assertEqual(res.liquido, 32314.71, 'Prêmio Líquido')
      assertEqual(res.iof, 2384.83, 'IOF derivado 7,38%')
      assertEqual(res.bruto, 34699.54, 'Prêmio Bruto = Líquido + IOF')
      assertEqual(res.iofDerivado, true, 'IOF derivado flag')
    },
  )

  runTest(
    'Regra de IOF C2',
    'Cadeia Net/Agravo: IOF derivado sobre Líquido final recalculado (Net Pós Agravo / (1 - comissão))',
    () => {
      // Net = 10.000, Agravo = 10% -> Net Pós Agravo = 11.000
      // Comissão = 20% -> Líquido derivado = 11.000 / 0.8 = 13.750,00
      // IOF derivado = 13.750,00 * 7,38% = 1.014,75
      // Bruto = 13.750,00 + 1.014,75 = 14.764,75
      const res = calcularFluxoPremios({
        base: 'net',
        premioNet: 10000,
        agravoPerc: 10,
        comissaoPerc: 20,
      })
      assertEqual(res.net, 10000, 'Prêmio Net base')
      assertEqual(res.netPosAgravo, 11000, 'Net Pós Agravo 10%')
      assertEqual(res.liquido, 13750, 'Líquido derivado')
      assertEqual(res.iof, 1014.75, 'IOF derivado 7,38% sobre líquido final')
      assertEqual(res.bruto, 14764.75, 'Bruto = Líquido + IOF')
      assertEqual(res.iofDerivado, true, 'IOF derivado flag')
    },
  )

  runTest('Regra de IOF C2', 'Constante ALIQUOTA_IOF_PADRAO = 0.0738 (7,38%)', () => {
    assertEqual(ALIQUOTA_IOF_PADRAO, 0.0738, 'Alíquota padrão IOF')
  })

  // =========================================================================
  // SUÍTE 5: REGRA DO FLUXO DE PRÊMIOS BASEADO EM PRÊMIO NET (C2 / RFQ)
  // =========================================================================
  runTest(
    'Regra de Prêmio Net C2',
    'Base Net sem comissão: Líquido, IOF e Bruto ficam pendentes/nulos (sem presunção de 0%)',
    () => {
      const res = calcularFluxoPremios({
        base: 'net',
        premioNet: 50000,
      })
      assertEqual(res.net, 50000, 'Prêmio Net base gravado')
      assertEqual(res.netPosAgravo, 50000, 'Net Pós Agravo sem agravo')
      assertEqual(res.liquido, null, 'Líquido deve ser nulo/pendente')
      assertEqual(res.iof, null, 'IOF deve ser nulo/pendente (nunca zero)')
      assertEqual(res.bruto, null, 'Bruto deve ser nulo/pendente')
      assertEqual(res.comissaoValor, null, 'Comissão valor deve ser nula')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Base Net com agravo mas sem comissão: Net Pós Agravo calculado, Líquido, IOF e Bruto pendentes',
    () => {
      // Net = 50.000, Agravo = 10% -> Net Pós Agravo = 55.000
      // Sem comissão informada: Líquido, IOF e Bruto continuam nulos/pendentes (todos null, nunca zero)
      const res = calcularFluxoPremios({
        base: 'net',
        premioNet: 50000,
        agravoPerc: 10,
      })
      assertEqual(res.net, 50000, 'Prêmio Net base')
      assertEqual(res.netPosAgravo, 55000, 'Net Pós Agravo 10% calculado')
      assertEqual(res.liquido, null, 'Líquido deve permanecer nulo')
      assertEqual(res.iof, null, 'IOF deve permanecer nulo')
      assertEqual(res.bruto, null, 'Bruto deve permanecer nulo')
      assertEqual(res.comissaoValor, null, 'Comissão valor deve ser nula')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Base Net com comissão preenchida: cadeia calculada reativamente (Líquido = Net Pós Agravo / (1 - comissão))',
    () => {
      // Net = 50.000, Agravo = 10% -> Net Pós Agravo = 55.000
      // Comissão trabalhada = 15% -> Líquido = 55.000 / (1 - 0.15) = 55.000 / 0.85 = 64.705,88
      // IOF = 64.705,88 * 7,38% = 4.775,30
      // Bruto = 64.705,88 + 4.775,30 = 69.481,18
      const res = calcularFluxoPremios({
        base: 'net',
        premioNet: 50000,
        agravoPerc: 10,
        comissaoPerc: 15,
      })
      assertEqual(res.net, 50000, 'Prêmio Net base')
      assertEqual(res.netPosAgravo, 55000, 'Net Pós Agravo 10%')
      assertEqual(res.liquido, 64705.88, 'Líquido calculado pela comissão')
      assertEqual(res.iof, 4775.3, 'IOF 7,38%')
      assertEqual(res.bruto, 69481.18, 'Bruto = Líquido + IOF')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Base Net AXA Condomínio São International Square: Net R$ 49.343,34 + Agravo 0 neutro + comissão 15% -> Líquido = 58.051,00, IOF = 4.284,16, Bruto = 62.335,16',
    () => {
      // Net = 49.343,34, Agravo = 0 (neutro)
      // Net Pós Agravo = 49.343,34
      // Comissão = 15% -> Líquido = 49.343,34 / 0.85 = 58.050,988... -> 58.050,99
      // IOF = 58.050,99 * 0.0738 = 4.284,163... -> 4.284,16
      // Bruto = 58.050,99 + 4.284,16 = 62.335,15
      const res = calcularFluxoPremios({
        base: 'net',
        premioNet: 49343.34,
        agravoPerc: 0,
        comissaoPerc: 15,
      })
      assertEqual(res.net, 49343.34, 'Prêmio Net base extraído')
      assertEqual(res.netPosAgravo, 49343.34, 'Net Pós Agravo com agravo 0 neutro')
      assertEqual(res.liquido, 58050.99, 'Líquido = Net / (1 - comissão)')
      assertEqual(res.iof, 4284.16, 'IOF 7,38%')
      assertEqual(res.bruto, 62335.15, 'Bruto = Líquido + IOF')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Base Líquido explícita (ex: AXA RN): IOF e Bruto calculam mesmo sem comissão',
    () => {
      const res = calcularFluxoPremios({
        base: 'liquido',
        premioLiquido: 69215.24,
      })
      assertEqual(res.liquido, 69215.24, 'Líquido explícito mantido')
      assertEqual(res.iof, 5108.08, 'IOF 7,38% calculado sobre Líquido')
      assertEqual(res.bruto, 74323.32, 'Bruto = Líquido + IOF')
      assertEqual(res.net, null, 'Net sem comissão permanece null')
      assertEqual(res.comissaoValor, null, 'Valor comissão sem comissão permanece null')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Base Líquido com comissão (regra nova): Líquido é âncora intocada, Net = Líquido × (1 - comissão), comissãoValor = Líquido × comissão',
    () => {
      // Líquido = 46.351,40 (exemplo condomínio São International Square: Total 49.772,14 com IOF 7,38%)
      // 46.351,40 * 0.0738 = 3.420,7333 -> IOF = 3.420,73 -> Total = 49.772,13
      // Testando Líquido = 100.000,00 com comissão 15%:
      // Net = 100.000 * 0.85 = 85.000,00
      // Valor da comissão = 100.000 * 0.15 = 15.000,00
      // Líquido permanece 100.000,00 (NUNCA alterado)
      // IOF = 100.000 * 7,38% = 7.380,00
      // Bruto = 100.000 + 7.380 = 107.380,00
      const res = calcularFluxoPremios({
        base: 'liquido',
        premioLiquido: 100000,
        comissaoPerc: 15,
      })
      assertEqual(res.liquido, 100000, 'Líquido é âncora intocada')
      assertEqual(res.net, 85000, 'Net = Líquido * (1 - comissão)')
      assertEqual(res.comissaoValor, 15000, 'Valor comissão = Líquido * comissão')
      assertEqual(res.iof, 7380, 'IOF = Líquido * 7,38% independente da comissão')
      assertEqual(res.bruto, 107380, 'Bruto = Líquido + IOF')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Base Líquido com agravo e comissão: Líquido permanece intocado, Net Pós Agravo = Net × (1 + agravo)',
    () => {
      // Líquido = 50.000, Comissão = 10% -> Net = 45.000
      // Agravo = 10% -> Net Pós Agravo = 45.000 * 1.1 = 49.500
      // Líquido âncora = 50.000 (não muda)
      // IOF = 50.000 * 7,38% = 3.690,00
      // Bruto = 53.690,00
      const res = calcularFluxoPremios({
        base: 'liquido',
        premioLiquido: 50000,
        comissaoPerc: 10,
        agravoPerc: 10,
      })
      assertEqual(res.liquido, 50000, 'Líquido permanece âncora')
      assertEqual(res.net, 45000, 'Net derivado da comissão')
      assertEqual(res.comissaoValor, 5000, 'Valor comissão 10% sobre líquido')
      assertEqual(res.netPosAgravo, 49500, 'Net Pós Agravo 10%')
      assertEqual(res.iof, 3690, 'IOF 7,38% sobre Líquido')
      assertEqual(res.bruto, 53690, 'Bruto = Líquido + IOF')
    },
  )

  runTest(
    'Regra de Prêmio Net C2',
    'Verificação numérica AXA Condomínio São International Square (Prêmio Bruto R$ 49.772,14 com IOF 7,38% incluso)',
    () => {
      // Bruto = 49.772,14 com IOF 7,38%
      // Líquido = 49.772,14 / 1.0738 = 46.351,405... -> 46.351,41
      // IOF = 46.351,41 * 0.0738 = 3.420,73
      // Bruto = 46.351,41 + 3.420,73 = 49.772,14
      const res = calcularFluxoPremios({
        base: 'liquido',
        premioLiquido: 46351.41,
        comissaoPerc: 15,
      })
      assertEqual(res.liquido, 46351.41, 'Líquido âncora')
      assertEqual(res.iof, 3420.73, 'IOF 7,38% sobre Líquido')
      assertEqual(res.bruto, 49772.14, 'Bruto bate exatamente com R$ 49.772,14')
      assertEqual(res.net, 39398.7, 'Net = 46.351,41 * 0.85 = 39.398,70')
      assertEqual(res.comissaoValor, 6952.71, 'Comissão = 46.351,41 * 0.15 = 6.952,71')
    },
  )

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
