import fs from 'node:fs'
import path from 'node:path'

// Script auxiliar para inspecionar o resultado do parser Tokio
const rootDir = process.cwd()
const fixturePath = path.resolve(rootDir, 'src/services/__tests__/fixtures/tokio-bt-fortaleza.json')

import { extractTokioCoberturas, extractTokioEmpresarialApolice, detectSeguradoraApolice } from '../apoliceReader'

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
    const franquiaOk = match.franquiaPos.trim().toLowerCase() === gab.franquiaPos.trim().toLowerCase()
    const premioVal = match.observacao ? parseFloat(match.observacao.replace(/[^0-9,.]/g, '').replace(',', '.')) : 0
    const premioOk = Math.abs(premioVal - gab.premio) < 0.05

    if (lmiOk && franquiaOk && premioOk) {
      matches++
      console.log(`[OK] ${gab.nomeCompleto}`)
    } else {
      console.log(`[DIVERGENCIA] ${gab.nomeCompleto}: LMI(${lmiOk} ext=${match.lmi} gab=${gab.lmi}), Franquia(${franquiaOk} ext="${match.franquiaPos}" gab="${gab.franquiaPos}"), Premio(${premioOk} ext=${premioVal} gab=${gab.premio})`)
    }
  }

  console.log(`Score: ${matches} de ${TABELA_VERDADE_TOKIO.length}`)
  return { matches, total: TABELA_VERDADE_TOKIO.length }
}

export function getTokioCurrentResults() {
  let targetPath = fixturePath
  if (!fs.existsSync(targetPath)) {
    targetPath = path.resolve(rootDir, 'src/assets/diagnostico-fragmentos-apoliceempresatokiobtfortaleza26-copia1-ff6f9.json')
  }
  if (!fs.existsSync(targetPath)) {
    return []
  }
  const raw = fs.readFileSync(targetPath, 'utf8')
  const fixture = JSON.parse(raw)
  const pages = fixture.pages.filter((p: any) => [1, 2, 3, 4, 5, 6, 7, 204].includes(p.pageNumber))
  const segInfo = detectSeguradoraApolice(pages.map((p: any) => p.text).join('\n'))
  const apolice = extractTokioEmpresarialApolice(pages, segInfo)
  return apolice.coberturas
}
