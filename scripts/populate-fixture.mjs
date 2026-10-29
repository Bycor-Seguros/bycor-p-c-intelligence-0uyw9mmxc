import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const bigJsonPath = path.resolve(
  rootDir,
  'src/assets/diagnostico-fragmentos-apoliceempresatokiobtfortaleza26-copia1-ff6f9.json',
)
const destFixturePath = path.resolve(
  rootDir,
  'src/services/__tests__/fixtures/tokio-bt-fortaleza.json',
)

const raw = fs.readFileSync(bigJsonPath, 'utf8')
const data = JSON.parse(raw)
const targetPages = [1, 2, 3, 4, 5, 6, 7, 204]
const filteredPages = data.pages.filter((p) => targetPages.includes(p.pageNumber))

const fixtureData = {
  metadata: {
    sourcePdf: data.metadata?.sourcePdf || 'APOLICE_EMPRESA_TOKIO_BT_FORTALEZA_26 - cópia.pdf',
    extractedAt: data.metadata?.extractedAt || new Date().toISOString(),
    totalPagesInPdf: data.metadata?.totalPagesInPdf || 204,
    pagesIncluded: targetPages,
  },
  pages: filteredPages,
}

fs.writeFileSync(destFixturePath, JSON.stringify(fixtureData, null, 2), 'utf8')
