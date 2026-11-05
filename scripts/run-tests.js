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

// Logotipo da Bycor em disco: os serviços de PPTX resolvem o asset via Vite, que em
// Node/SSR devolve a URL de dev-server ("/src/assets/logo-bycor-3c53f.jpg") — inexistente
// no sistema de arquivos. Antes de carregar qualquer módulo via SSR, expomos o caminho
// absoluto real (raiz do projeto) para que src/assets/logoBycorBase64.ts resolva a mídia
// no disco dentro do harness. No navegador/SSR de produção nada muda.
const logoDiskPath = path.resolve(rootDir, 'src/assets/logo-bycor-3c53f.jpg')
if (fs.existsSync(logoDiskPath)) {
  process.env.BYCOR_LOGO_DISK_PATH = logoDiskPath
} else {
  // Mídia é OPCIONAL na validação PPTX do harness: sem o logotipo em disco a geração
  // segue sem imagens embutidas (includeLogo=false) e a suíte NÃO aborta.
  console.warn(
    `⚠️ Logotipo da Bycor não encontrado no disco: ${logoDiskPath} — a validação PPTX seguirá SEM mídia embutida.`,
  )
}

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
      // exitCode em vez de exit(): permite o finally fechar o servidor Vite com elegância
      process.exitCode = 1
      return
    }
    if (validation.warnings && validation.warnings.length > 0) {
      console.warn('⚠️ Avisos da validação PPTX OpenXML:', validation.warnings)
    }
    console.log(
      `✅ PPTX OpenXML válido via PptxGenJS! ${validation.slideCount} slides e ${validation.partCount} partes verificadas sem divergências.`,
    )

    process.env.BYCOR_HARNESS = '1'
    const testModule = await vite.ssrLoadModule('/src/services/__tests__/run-golden-tests.ts')
    if (typeof testModule.runAllSuites === 'function') {
      await testModule.runAllSuites()
    }
  } catch (err) {
    console.error('Erro ao executar suite de testes:', err)
    process.exitCode = 1
  } finally {
    await vite.close()
  }
}

run()
