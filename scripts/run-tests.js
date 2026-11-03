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

  // Executa backup garantido se ainda não existir backup completo
  try {
    const bakPath = path.resolve(rootDir, 'scripts/apoliceReader.v0.0.79.bak')
    const srcPath = path.resolve(rootDir, 'src/services/apoliceReader.ts')
    if (!fs.existsSync(bakPath) || fs.statSync(bakPath).size < 1000) {
      fs.copyFileSync(srcPath, bakPath)
      console.log(
        'Backup scripts/apoliceReader.v0.0.79.bak criado com sucesso:',
        fs.statSync(bakPath).size,
        'bytes',
      )
    }
  } catch (e) {
    console.error('Erro ao criar backup:', e)
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
    console.log('Executando validação de estrutura do pacote PPTX OpenXML...')
    const pptxTest = await vite.ssrLoadModule('/src/services/__tests__/pptxValidation.test.ts')
    const sampleData = {
      clienteNome: 'Hotel Teste Resort & Spa',
      razaoSocial: 'Hotel Teste Ltda',
      cidade: 'Fortaleza',
      uf: 'CE',
      areaConstruida: 15400,
      seguradoraNome: 'Tokio Marine Seguradora — Opção 1 (v1)',
      premioBruto: 185420.5,
      lmiLmg: 50000000,
      recomendacao: 'Proposta altamente recomendada devido à cobertura abrangente.',
      coberturas: [
        { nome: 'Incêndio / Raio / Explosão', lmi: 50000000, franquia: 'Não Há' },
        { nome: 'Vendaval / Furacão / Ciclone', lmi: 5000000, franquia: '10% min R$ 5.000,00' },
        { nome: 'Danos Elétricos', lmi: 2000000, franquia: '15% min R$ 3.000,00' },
        { nome: 'Responsabilidade Civil Operações', lmi: 10000000, franquia: 'R$ 2.500,00' },
      ],
    }
    const validation = await pptxTest.validatePptxOpenXml(sampleData)
    if (!validation.passed) {
      console.error('❌ Falha na validação PPTX OpenXML:', validation.errors)
      process.exit(1)
    }
    console.log(
      `✅ PPTX OpenXML válido via PptxGenJS! ${validation.slideCount} slides e ${validation.partCount} partes verificadas sem divergências.`,
    )

    const testModule = await vite.ssrLoadModule('/src/services/__tests__/run-golden-tests.ts')
  } catch (err) {
    console.error('Erro ao executar suite de testes:', err)
    process.exit(1)
  } finally {
    await vite.close()
  }
}

run()
