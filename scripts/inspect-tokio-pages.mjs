import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function inspectTokio() {
  const cacheDir = path.resolve(process.cwd(), '.cache')
  const pdfJsCachePath = path.join(cacheDir, 'pdf.legacy.2.16.105.js')
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

  const pdfPath = path.resolve(
    process.cwd(),
    'src/assets/apoliceempresatokiobtfortaleza26-copia-e8210.pdf',
  )
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true })
    .promise

  console.log('PDF carregado, total de páginas:', pdf.numPages)

  for (let p = 5; p <= 7; p++) {
    const page = await pdf.getPage(p)
    const textContent = await page.getTextContent()
    const rawItems = textContent.items || []

    const items = rawItems
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({
        str: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        w: Math.round(it.width || 0),
        h: Math.round(it.height || 0),
      }))

    console.log(`\n=== PÁGINA ${p} (total ${items.length} itens) ===`)
    // Ordenar por Y decrescente (topo para baixo)
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    for (const it of items) {
      // Mostrar y, x, texto
      console.log(`P${p} [y=${it.y}, x=${it.x}, w=${it.w}] "${it.str}"`)
    }
  }
}

inspectTokio().catch(console.error)
