/**
 * Probe do caso de 3 linhas da seção 12 do golden (tarefa v0.0.236).
 *
 * Roda: node scripts/probe-cg-3-linhas.ts
 * Reproduz exatamente as linhas do caso 'título Zurich quebrado em 3 linhas —
 * cauda "Terrestres e Fumaça" não vira cobertura' e imprime, para cada linha:
 * o que removerPrefixoRodapeCg devolve, cada guarda do joiner e a leitura final.
 */
import { createServer } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

async function main() {
  const vite = await createServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const r: any = await vite.ssrLoadModule('/src/services/cgIngestaoReader.ts')
    const reader = r

    const frag = (str: string, y: number) => ({ str, x: 0, y })
    const page = (pageNumber: number, linhas: Array<[string, number]>) => ({
      pageNumber,
      text: linhas.map(([l]) => l).join('\n'),
      items: linhas.map(([l, y]) => frag(l, y)),
      lines: linhas.map(([l]) => l),
    })

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

    const linhas1 = [
      'Vendaval, Furacão, Ciclone, Tornado, Granizo, Queda de Aeronaves ou Quaisquer',
      'Outros Engenhos Aéreos ou Espaciais, Impacto de Veículos',
      'Terrestres e Fumaça',
      '1. Riscos Cobertos',
    ]
    console.log('=== Linhas da página 1 (pós limparLinhaSumario/removerPrefixoRodapeCg) ===')
    for (const l of linhas1) {
      const limpo = reader.removerPrefixoRodapeCg(l)
      console.log(
        JSON.stringify(l),
        '→',
        JSON.stringify(limpo),
        '| rodapé?',
        reader.ehLinhaRodapeCg(limpo),
      )
    }

    console.log('\n=== Joiner (ehContinuacaoTituloZurich) sobre cada linha ===')
    for (const l of linhas1) {
      console.log(
        JSON.stringify(l),
        '→',
        reader.__probe_joiner ? reader.__probe_joiner(l) : '(não exportado)',
      )
    }

    console.log('\n=== Assinatura Zurich ===')
    const cand0 = linhas1[0]
    const cand1 = linhas1[1]
    const cand2 = linhas1[2]
    console.log(
      'tituloEhCoberturaZurich("Terrestres e Fumaça", "1. Riscos Cobertos") =',
      reader.tituloEhCoberturaZurich(cand2, linhas1[3]),
    )
    console.log(
      'tituloEhCoberturaZurich("Outros Engenhos...", "Terrestres e Fumaça") =',
      reader.tituloEhCoberturaZurich(cand1, cand2),
    )
    console.log(
      'tituloEhCoberturaZurich("Vendaval...", "Outros Engenhos...") =',
      reader.tituloEhCoberturaZurich(cand0, cand1),
    )

    console.log('\n=== Leitura completa ===')
    const leitura = reader.lerCondicoesGerais(pages)
    const coberturas = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
    console.log(
      'coberturas:',
      JSON.stringify(
        coberturas.map((c) => c.nomeExtraido),
        null,
        2,
      ),
    )
    console.log('total itens:', leitura.itens.length)
  } finally {
    await vite.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
