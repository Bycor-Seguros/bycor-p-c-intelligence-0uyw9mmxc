/**
 * Loader seguro para PDF.js client-side via CDN sem bundling complexo.
 * Permite carregar pdfjsLib a partir de CDN padrão com worker configurado.
 */

declare global {
  interface Window {
    pdfjsLib?: any
  }
}

let pdfjsLoadingPromise: Promise<any> | null = null

export async function loadPdfJs(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('PDF.js só pode ser executado no navegador')
  }

  if (window.pdfjsLib) {
    return window.pdfjsLib
  }

  if (pdfjsLoadingPromise) {
    return pdfjsLoadingPromise
  }

  pdfjsLoadingPromise = new Promise((resolve, reject) => {
    // CDN confiável: cdnjs / unpkg para pdf.js build clássico
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'
    script.async = true
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'
        resolve(window.pdfjsLib)
      } else {
        reject(new Error('Biblioteca PDF.js não pôde ser inicializada'))
      }
    }
    script.onerror = () => {
      // Fallback para cdnjs v2.7.570 ou unpkg
      const fallbackScript = document.createElement('script')
      fallbackScript.src = 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js'
      fallbackScript.async = true
      fallbackScript.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js'
          resolve(window.pdfjsLib)
        } else {
          reject(new Error('Falha ao carregar script do leitor de PDF'))
        }
      }
      fallbackScript.onerror = () =>
        reject(new Error('Não foi possível carregar o motor de leitura PDF via CDN.'))
      document.head.appendChild(fallbackScript)
    }
    document.head.appendChild(script)
  })

  return pdfjsLoadingPromise
}

export interface PdfPageText {
  pageNumber: number
  text: string
  lines: string[]
}

/**
 * Extrai texto página por página de um PDF (ArrayBuffer ou File)
 */
export async function extractTextFromPdf(
  source: ArrayBuffer | Uint8Array | File,
  maxPages: number = 350,
): Promise<PdfPageText[]> {
  const pdfjs = await loadPdfJs()

  let data: Uint8Array
  if (source instanceof File) {
    const buffer = await source.arrayBuffer()
    data = new Uint8Array(buffer)
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source)
  } else {
    data = source
  }

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  })

  const pdf = await loadingTask.promise
  const numPages = Math.min(pdf.numPages, maxPages)
  const pages: PdfPageText[] = []

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()

      // Organiza itens por posição vertical para reconstruir linhas aproximadas
      // item.transform[5] é coordenada Y aproximada
      const items = (textContent.items || []) as Array<{
        str: string
        transform?: number[]
        hasEOL?: boolean
      }>

      // Agrupar itens com Y similar na mesma linha
      const lineMap = new Map<number, string[]>()
      items.forEach((item) => {
        if (!item.str) return
        const y = item.transform ? Math.round(item.transform[5]) : 0
        // Achar chave mais próxima (tolerância de 3 pontos)
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
        lineMap.get(foundY)!.push(item.str)
      })

      // Ordena por Y decrescente (topo para base da folha)
      const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a)
      const lines = sortedYs.map((y) => (lineMap.get(y) || []).join(' ').trim()).filter(Boolean)
      const text = lines.join('\n')

      pages.push({
        pageNumber: i,
        text,
        lines,
      })
    } catch (pageErr) {
      console.warn(`Erro na leitura da página ${i}:`, pageErr)
    }
  }

  return pages
}
