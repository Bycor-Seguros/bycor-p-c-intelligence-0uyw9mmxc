/**
 * Script de extração one-off dos fragmentos brutos das págs 5-7 do PDF Tokio Marine
 * src/assets/apoliceempresatokiobtfortaleza26-copia-6714c.pdf
 *
 * Executável com: node scripts/extract-tokio-fixture.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const pdfPath = path.join(rootDir, 'src/assets/apoliceempresatokiobtfortaleza26-copia-6714c.pdf')
const outputPath = path.join(rootDir, 'src/services/__tests__/fixtures/tokio-bt-fortaleza.json')

async function fetchCdn(url) {
  console.log(`Buscando ${url}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: ${res.statusText}`)
  return await res.text()
}

async function run() {
  console.log('Iniciando extração do PDF Tokio...')
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF não encontrado em ${pdfPath}`)
  }

  // Baixa pdf.js build clássica
  const pdfJsCode = await fetchCdn('https://unpkg.com/pdfjs-dist@2.16.105/legacy/build/pdf.js')
  const workerCode = await fetchCdn('https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.js')

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Uint8Array,
    ArrayBuffer,
    Math,
    Date,
    Promise,
    URL,
    Map,
    Set,
    String,
    Number,
    Boolean,
    Object,
    Error,
    TypeError,
    RangeError,
    globalThis: null,
    window: null,
    self: null,
  }
  sandbox.globalThis = sandbox
  sandbox.window = sandbox
  sandbox.self = sandbox

  const context = vm.createContext(sandbox)
  vm.runInContext(pdfJsCode, context)

  const pdfjsLib = sandbox.pdfjsLib || sandbox.window.pdfjsLib
  if (!pdfjsLib) {
    throw new Error('pdfjsLib não foi instanciado no sandbox')
  }

  const pdfData = new Uint8Array(fs.readFileSync(pdfPath))
  console.log(`PDF carregado: ${pdfData.byteLength} bytes`)

  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    useSystemFonts: true,
    disableFontFace: true,
  })

  const pdf = await loadingTask.promise
  console.log(`Total de páginas: ${pdf.numPages}`)

  // Extrai especificamente págs 5, 6, 7 (e páginas 1 a 7 para contexto de apólice completa)
  const extractedPages = []

  for (let i = 1; i <= Math.min(pdf.numPages, 7); i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    const rawItems = textContent.items || []
    const styles = textContent.styles || {}
    const pageFragments = []
    const lineMap = new Map()

    rawItems.forEach((item) => {
      if (!item.str) return
      const y = item.transform ? Math.round(item.transform[5]) : 0
      const x = item.transform ? Math.round(item.transform[4]) : 0
      const width = item.width ? Math.round(item.width) : undefined
      const height = item.height ? Math.round(item.height) : undefined
      const rawFontName = item.fontName || ''

      const styleObj = rawFontName ? styles[rawFontName] : undefined
      const resolvedFontFamily = styleObj?.fontFamily || styleObj?.fontName || ''
      const combinedFontDesc = `${rawFontName} ${resolvedFontFamily}`.toLowerCase()

      const isBold =
        Boolean(item.bold) ||
        (typeof item.fontWeight === 'number' && item.fontWeight >= 600) ||
        (typeof item.fontWeight === 'string' &&
          /bold|heavy|black|semibold|demibold/i.test(item.fontWeight)) ||
        /\b(bold|heavy|black|semibold|demibold)\b/i.test(combinedFontDesc) ||
        /[-+_](?:b|bold|bd|black|heavy)\b/i.test(combinedFontDesc) ||
        /bold/i.test(combinedFontDesc)

      pageFragments.push({
        str: item.str,
        x,
        y,
        width,
        height,
        fontName: rawFontName || resolvedFontFamily || undefined,
        isBold,
      })

      let foundY = y
      for (const existingY of lineMap.keys()) {
        if (Math.abs(existingY - y) <= 2.5) {
          foundY = existingY
          break
        }
      }
      if (!lineMap.has(foundY)) {
        lineMap.set(foundY, [])
      }
      lineMap.get(foundY).push({ str: item.str, x })
    })

    const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a)
    const lines = sortedYs
      .map((y) => {
        const lineItems = lineMap.get(y) || []
        lineItems.sort((a, b) => a.x - b.x)
        return lineItems
          .map((it) => it.str)
          .join(' ')
          .trim()
      })
      .filter(Boolean)

    const text = lines.join('\n')

    extractedPages.push({
      pageNumber: i,
      text,
      lines,
      items: pageFragments,
    })
    console.log(`Página ${i}: ${pageFragments.length} fragmentos, ${lines.length} linhas`)
  }

  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const payload = {
    metadata: {
      sourcePdf: 'apoliceempresatokiobtfortaleza26-copia-6714c.pdf',
      extractedAt: new Date().toISOString(),
      totalPagesInPdf: pdf.numPages,
      pagesIncluded: extractedPages.map((p) => p.pageNumber),
    },
    pages: extractedPages,
  }

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`Fixture gravado com sucesso em ${outputPath}!`)
}

run().catch((err) => {
  console.error('Erro na extração:', err)
  process.exit(1)
})
