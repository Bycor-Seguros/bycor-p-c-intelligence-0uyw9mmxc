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

  // Inicializa instância vite em modo ssr para importar módulos TypeScript diretamente sem compilação prévia
  const vite = await createServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'custom',
  })

  try {
    const testModule = await vite.ssrLoadModule('/src/services/__tests__/run-golden-tests.ts')
    console.log('Suite de testes executada com sucesso via Vite SSR runner.')
  } catch (err) {
    console.error('Erro ao executar suite de testes:', err)
    process.exit(1)
  } finally {
    await vite.close()
  }
}

run()
