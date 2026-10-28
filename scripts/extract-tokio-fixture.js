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
import { MessageChannel } from 'node:worker_threads'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const pdfPath = path.join(rootDir, 'src/assets/apoliceempresatokiobtfortaleza26-copia-6714c.pdf')
const outputPath = path.join(rootDir, 'src/services/__tests__/fixtures/tokio-bt-fortaleza.json')

import https from 'node:https'

async function fetchCdn(url) {
  console.log(`Buscando ${url}...`)
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Accept: '*/*',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location
            if (nextUrl.startsWith('/')) {
              const u = new URL(url)
              nextUrl = `${u.protocol}//${u.host}${nextUrl}`
            }
            return resolve(fetchCdn(nextUrl))
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} para ${url}`))
          }
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        },
      )
      .on('error', reject)
  })
}

async function run() {
  console.log('Iniciando extração do PDF Tokio...')
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF não encontrado em ${pdfPath}`)
  }

  const cacheDir = path.resolve(rootDir, '.cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const pdfJsCachePath = path.join(cacheDir, 'pdf.legacy.2.16.105.js')

  let pdfJsCode = fs.readFileSync(pdfJsCachePath, 'utf8')

  const sandbox = {
    console,
    process,
    Buffer,
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
    RegExp,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Error,
    TypeError,
    RangeError,
    globalThis: null,
    window: {},
  }
  sandbox.window = sandbox
  sandbox.global = sandbox
  sandbox.self = sandbox

  vm.createContext(sandbox)
  vm.runInContext(pdfJsCode, sandbox)

  const pdfjsLib = sandbox.pdfjsLib || sandbox.window.pdfjsLib || sandbox['pdfjs-dist/build/pdf']
  if (!pdfjsLib) {
    throw new Error('pdfjsLib não foi instanciado no sandbox')
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = ''

  const pdfData = new Uint8Array(fs.readFileSync(pdfPath))
  console.log(`PDF carregado: ${pdfData.byteLength} bytes`)

  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    useSystemFonts: true,
    disableFontFace: true,
  })

  const pdf = await loadingTask.promise
  console.log(`Total de páginas: ${pdf.numPages}`)

  // Extrai especificamente págs 5, 6, 7
  const extractedPages = []

  for (let i = 5; i <= 7; i++) {
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
        x,
        y,
        width,
        height,
        texto: item.str,
        str: item.str,
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
