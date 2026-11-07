import { useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'

export function usePedidoEmissao(propostaId: string | undefined) {
  const [pedido, setPedido] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPedido(null)
    if (!propostaId) return

    setLoading(true)
    pb.collection('pedido_emissao')
      .getFirstListItem(`proposta = "${propostaId}"`)
      .then((rec) => {
        if (!cancelled) setPedido(rec)
      })
      .catch(() => {
        if (!cancelled) setPedido(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [propostaId])

  return { pedido, loading }
}
