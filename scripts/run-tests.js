/**
 * Script de execução do suite de testes de ouro (Golden Tests) e não-regressão.
 * Usa o Vite/esbuild embutido via transform ou runner leve em Node.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

async function run() {
  console.log('Inicializando ambiente de teste Vite/Node...')

  // Gera fixture compacto se ainda não tiver páginas
  const fixturePath = path.resolve(
    rootDir,
    'src/services/__tests__/fixtures/tokio-bt-fortaleza.json',
  )
  let needGen = false
  try {
    if (!fs.existsSync(fixturePath)) {
      needGen = true
    } else {
      const cur = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
      if (!cur.pages || cur.pages.length === 0) needGen = true
    }
  } catch {
    needGen = true
  }

  if (needGen) {
    console.log('Executando geração do fixture compacto...')
    await import('./generate-compact-fixture.js')
  }

  // Inicializa instância vite em modo ssr para importar módulos TypeScript diretamente sem compilação prévia
  const vite = await createServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'custom',
  })

  try {
    const testModule = await vite.ssrLoadModule('/src/services/__tests__/run-golden-tests.ts')
  } catch (err) {
    console.error('Erro ao executar suite de testes:', err)
    process.exit(1)
  } finally {
    await vite.close()
  }
}

run()
