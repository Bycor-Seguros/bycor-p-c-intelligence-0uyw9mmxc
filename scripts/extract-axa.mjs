import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const assetsDir = path.resolve(process.cwd(), 'src/assets')
const files = fs.readdirSync(assetsDir)
const axaFiles = files.filter((f) => /axa/i.test(f) && f.endsWith('.pdf'))
console.log('PDFs AXA:', axaFiles)

if (axaFiles.length === 0) {
  console.error('Nenhum PDF AXA encontrado!')
  process.exit(1)
}

const targetPdfPath = path.join(assetsDir, axaFiles[0])
console.log('Alvo:', targetPdfPath, 'Tamanho:', fs.statSync(targetPdfPath).size)

const cacheDir = path.resolve(process.cwd(), '.cache')
const pdfJsCachePath = path.join(cacheDir, 'pdf.legacy.2.16.105.js')

if (!fs.existsSync(pdfJsCachePath)) {
  console.error('pdfjs legacy build não encontrada no cache!')
  process.exit(1)
}

const pdfJsCode = fs.readFileSync(pdfJsCachePath, 'utf8')
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
pdfjsLib.GlobalWorkerOptions.workerSrc = ''

async function run() {
  const data = new Uint8Array(fs.readFileSync(targetPdfPath))
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  })
  const pdf = await loadingTask.promise
  console.log(`PDF AXA tem ${pdf.numPages} páginas`)

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

  fs.writeFileSync(path.join(cacheDir, 'axa_extracted_pages.json'), JSON.stringify(pages, null, 2))
  console.log('Páginas AXA extraídas e salvas com sucesso em .cache/axa_extracted_pages.json')
}

run().catch(console.error)
