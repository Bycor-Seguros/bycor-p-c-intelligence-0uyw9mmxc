/**
 * Script auxiliar para gerar fixture compacto das páginas de teste Tokio Marine a partir dos diagnósticos em src/assets/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function run() {
  const targetFixture = path.resolve(
    rootDir,
    'src/services/__tests__/fixtures/tokio-bt-fortaleza.json',
  )
  if (fs.existsSync(targetFixture)) {
    try {
      const cur = JSON.parse(fs.readFileSync(targetFixture, 'utf8'))
      if (cur.pages && cur.pages.length > 0) {
        return
      }
    } catch {
      // recria
    }
  }

  const assetsDir = path.resolve(rootDir, 'src/assets')
  if (!fs.existsSync(assetsDir)) return

  const files = fs.readdirSync(assetsDir)
  const tokioFile = files.find(
    (f) =>
      f.includes('diagnostico-fragmentos') && f.includes('tokiobtfortaleza') && f.endsWith('.json'),
  )

  if (!tokioFile) return

  try {
    const raw = fs.readFileSync(path.join(assetsDir, tokioFile), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed.pages) return

    const targetPages = [1, 2, 3, 4, 5, 6, 7, 204]
    const filteredPages = parsed.pages.filter((p) => targetPages.includes(p.pageNumber))

    const compact = {
      metadata: {
        sourcePdf: tokioFile,
        extractedAt: new Date().toISOString(),
        pagesIncluded: targetPages,
      },
      pages: filteredPages,
    }

    const fixtureDir = path.dirname(targetFixture)
    if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true })

    fs.writeFileSync(targetFixture, JSON.stringify(compact, null, 2), 'utf8')
    console.log('Fixture compacto tokio-bt-fortaleza.json gerado com sucesso.')
  } catch (e) {
    console.error('Erro ao gerar fixture compacto:', e)
  }
}

run()
