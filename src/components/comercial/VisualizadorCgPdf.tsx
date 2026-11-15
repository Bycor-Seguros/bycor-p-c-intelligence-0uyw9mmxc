/**
 * VisualizadorCgPdf — preview pdf.js da CG de origem de uma sessão de ingestão.
 *
 * Renderiza a página exata gravada no item da fila (cg_ingestao_itens.pagina)
 * e rola até a posição vertical slot_y (coordenada Y de texto do pdf.js,
 * origem no rodapé da página). PDF vem do campo file de cg_ingestoes — só
 * sessões novas (com arquivo anexado) têm visualizador.
 */

import { useEffect, useRef, useState } from 'react'
import { loadPdfJs } from '@/services/pdfTextExtractor'
import { Loader2, AlertCircle } from 'lucide-react'

interface Props {
  urlPdf: string
  pagina: number
  slotY: number
  nomeItem: string
}

const ESCALA = 1.6

export function VisualizadorCgPdf({ urlPdf, pagina, slotY, nomeItem }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false

    const renderizar = async () => {
      setCarregando(true)
      setErro('')
      try {
        const pdfjs = await loadPdfJs()
        if (cancelado) return
        if (!pdfDocRef.current) {
          const task = pdfjs.getDocument({ url: urlPdf })
          pdfDocRef.current = await task.promise
        }
        if (cancelado) return
        const pdf = pdfDocRef.current
        const page = await pdf.getPage(Math.max(1, pagina))
        if (cancelado) return

        renderTaskRef.current?.cancel?.()
        const viewport = page.getViewport({ scale: ESCALA })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
        if (cancelado) return

        // Scroll até a posição slotY do item (coordenada Y de texto do PDF:
        // origem no rodapé, logo yVisual = alturaDaPágina − slotY·escala).
        const container = containerRef.current
        if (container && slotY > 0) {
          const yVisual = Math.max(0, viewport.height - slotY * ESCALA)
          container.scrollTop = Math.max(0, yVisual - container.clientHeight / 2)
        } else if (container) {
          container.scrollTop = 0
        }
      } catch (e: unknown) {
        if (cancelado) return
        setErro(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    renderizar()

    return () => {
      cancelado = true
      try {
        renderTaskRef.current?.cancel?.()
      } catch {
        /* render já concluído */
      }
      try {
        pdfDocRef.current?.destroy?.()
      } catch {
        /* destroy já concluído */
      }
      pdfDocRef.current = null
      renderTaskRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPdf, pagina, slotY])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-gray-700 truncate" title={nomeItem}>
          {nomeItem}
        </p>
        <span className="text-[10px] text-gray-400 shrink-0">
          página {pagina}
          {slotY > 0 ? ` · posição ${Math.round(slotY)}` : ''}
        </span>
      </div>
      <div
        ref={containerRef}
        className="border border-gray-200 rounded bg-gray-100 overflow-y-auto h-[52vh]"
      >
        {carregando && (
          <p className="text-xs text-gray-500 flex items-center gap-2 p-4">
            <Loader2 className="w-3 h-3 animate-spin" /> Carregando PDF…
          </p>
        )}
        {erro && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded m-3 p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
          </p>
        )}
        <canvas ref={canvasRef} className="block mx-auto max-w-full" />
      </div>
    </div>
  )
}
