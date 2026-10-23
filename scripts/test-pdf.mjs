import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import vm from 'node:vm'

// 1. Localizar o arquivo Porto no src/assets
const assetsDir = path.resolve(process.cwd(), 'src/assets')
const files = fs.readdirSync(assetsDir)
const portoFiles = files.filter((f) => /porto/i.test(f) && f.endsWith('.pdf'))
console.log('PDFs Porto encontrados em src/assets:', portoFiles)

if (portoFiles.length === 0) {
  console.error('Nenhum PDF Porto encontrado em src/assets!')
  process.exit(1)
}

const targetPdfPath = path.join(assetsDir, portoFiles[0])
console.log('Alvo:', targetPdfPath, 'Tamanho:', fs.statSync(targetPdfPath).size)

// Baixar pdfjs v2.16.105 legacy se não estiver em cache
async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchUrl(res.headers.location))
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} para ${url}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', reject)
  })
}

async function run() {
  const cacheDir = path.resolve(process.cwd(), '.cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir)
  const pdfJsCachePath = path.join(cacheDir, 'pdf.legacy.2.16.105.js')

  let pdfJsCode
  if (fs.existsSync(pdfJsCachePath)) {
    pdfJsCode = fs.readFileSync(pdfJsCachePath, 'utf8')
  } else {
    console.log('Baixando pdfjs legacy build...')
    const buf = await fetchUrl('https://unpkg.com/pdfjs-dist@2.16.105/legacy/build/pdf.js')
    pdfJsCode = buf.toString('utf8')
    fs.writeFileSync(pdfJsCachePath, pdfJsCode)
  }

  // Executar no VM
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    process,
    Buffer,
    Uint8Array,
    ArrayBuffer,
    Math,
    Date,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    Object,
    JSON,
    window: {},
  }
  sandbox.window = sandbox
  sandbox.global = sandbox
  sandbox.self = sandbox

  vm.createContext(sandbox)
  vm.runInContext(pdfJsCode, sandbox)

  const pdfjsLib = sandbox.pdfjsLib || sandbox.window.pdfjsLib || sandbox['pdfjs-dist/build/pdf']
  if (!pdfjsLib) {
    throw new Error('pdfjsLib não inicializado no sandbox')
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = '' // fake worker fallback in legacy

  console.log('PDF.js carregado com sucesso. Versão:', pdfjsLib.version)

  // Extração idêntica ao pdfTextExtractor.ts
  const data = new Uint8Array(fs.readFileSync(targetPdfPath))
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  })
  const pdf = await loadingTask.promise
  console.log(`PDF tem ${pdf.numPages} páginas`)

  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const rawItems = textContent.items || []

    const pageFragments = []
    const lineMap = new Map()

    rawItems.forEach((item) => {
      if (!item.str) return
      const y = item.transform ? Math.round(item.transform[5]) : 0
      const x = item.transform ? Math.round(item.transform[4]) : 0
      const width = item.width ? Math.round(item.width) : undefined
      const height = item.height ? Math.round(item.height) : undefined

      pageFragments.push({
        str: item.str,
        x,
        y,
        width,
        height,
      })

      let foundY = y
      for (const existingY of lineMap.keys()) {
        if (Math.abs(existingY - y) <= 4) {
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

    pages.push({
      pageNumber: i,
      text,
      lines,
      items: pageFragments,
    })
  }

  // Salvar diagnóstico completo em .cache/extracted_pages.json
  fs.writeFileSync(path.join(cacheDir, 'extracted_pages.json'), JSON.stringify(pages, null, 2))
  console.log('Páginas extraídas e salvas em .cache/extracted_pages.json')

  return pages
}

run().catch((err) => {
  console.error('Erro ao executar pipeline:', err)
  process.exit(1)
})
