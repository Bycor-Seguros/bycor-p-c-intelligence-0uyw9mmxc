// Script auxiliar para inspecionar o resultado do parser Tokio
const g: any = typeof globalThis !== 'undefined' ? globalThis : {}
const rootDir =
  typeof g.process !== 'undefined' && typeof g.process.cwd === 'function' ? g.process.cwd() : ''
const fixturePath = 'src/services/__tests__/fixtures/tokio-bt-fortaleza.json'

import {
  extractTokioCoberturas,
  extractTokioEmpresarialApolice,
  detectSeguradoraApolice,
} from '../apoliceReader'

import { TABELA_VERDADE_TOKIO } from './run-golden-tests'

export function evaluateTokioGoldenSuite() {
  const extracted = getTokioCurrentResults()
  console.log(`Extraídas: ${extracted.length} coberturas`)

  let matches = 0
  for (const gab of TABELA_VERDADE_TOKIO) {
    const match = extracted.find((c) => gab.nomePattern.test(c.nome))
    if (!match) {
      console.log(`[FALHA] ${gab.nomeCompleto} NÃO encontrada`)
      continue
    }

    const lmiOk = Math.abs(match.lmi - gab.lmi) < 0.01
    const franquiaOk =
      match.franquiaPos.trim().toLowerCase() === gab.franquiaPos.trim().toLowerCase()
    const premioVal = match.observacao
      ? parseFloat(match.observacao.replace(/[^0-9,.]/g, '').replace(',', '.'))
      : 0
    const premioOk = Math.abs(premioVal - gab.premio) < 0.05

    if (lmiOk && franquiaOk && premioOk) {
      matches++
      console.log(`[OK] ${gab.nomeCompleto}`)
    } else {
      console.log(
        `[DIVERGENCIA] ${gab.nomeCompleto}: LMI(${lmiOk} ext=${match.lmi} gab=${gab.lmi}), Franquia(${franquiaOk} ext="${match.franquiaPos}" gab="${gab.franquiaPos}"), Premio(${premioOk} ext=${premioVal} gab=${gab.premio})`,
      )
    }
  }

  console.log(`Score: ${matches} de ${TABELA_VERDADE_TOKIO.length}`)
  return { matches, total: TABELA_VERDADE_TOKIO.length }
}

export function getTokioCurrentResults(): import('../apoliceReader').ExtractedApoliceCobertura[] {
  try {
    const fixtureModules = (import.meta as any).glob('./fixtures/*.json', { eager: true })
    for (const k of Object.keys(fixtureModules || {})) {
      if (k.includes('tokio-bt-fortaleza')) {
        const data = fixtureModules[k]?.default || fixtureModules[k]
        if (data?.pages && data.pages.length > 0) {
          return extractTokioCoberturas(data.pages)
        }
      }
    }
  } catch {
    // Fallback
  }
  return []
}
