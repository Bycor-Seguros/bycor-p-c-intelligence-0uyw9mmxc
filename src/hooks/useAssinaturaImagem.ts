import { useCallback, useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'

export interface AssinaturaImagemState {
  /** Nome do arquivo da assinatura no usuário logado (string vazia se nenhuma). */
  arquivo: string
  /** URL completa da imagem (ou null quando não há assinatura). */
  url: string | null
}

/**
 * Assinatura digitalizada (imagem) do usuário logado, persistida no próprio
 * usuário (campo `assinatura_imagem`, migration 0035). O upload é único:
 * subir uma nova substitui a anterior.
 */
export function useAssinaturaImagem() {
  const [state, setState] = useState<AssinaturaImagemState>({ arquivo: '', url: null })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usuario = pb.authStore.record as { id?: string; assinatura_imagem?: string } | null

  const recarregar = useCallback(async () => {
    if (!pb.authStore.isValid) return
    setLoading(true)
    setError(null)
    try {
      const rec = await pb.collection('users').getOne(usuario?.id ?? '')
      const arquivo = typeof rec.assinatura_imagem === 'string' ? rec.assinatura_imagem : ''
      setState({
        arquivo,
        url: arquivo ? pb.files.getURL(rec, arquivo, { thumb: '0x0' }) : null,
      })
    } catch {
      setError('Não foi possível carregar a assinatura salva.')
    } finally {
      setLoading(false)
    }
  }, [usuario?.id])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  /** Faz o upload único (substitui o anterior) e devolve a URL da imagem. */
  const salvarAssinatura = useCallback(
    async (file: File): Promise<string | null> => {
      if (!usuario?.id) {
        setError('Usuário não autenticado.')
        return null
      }
      setSaving(true)
      setError(null)
      try {
        const formData = new FormData()
        formData.append('assinatura_imagem', file)
        const rec = await pb.collection('users').update(usuario.id, formData)
        const arquivo = typeof rec.assinatura_imagem === 'string' ? rec.assinatura_imagem : ''
        const url = arquivo ? pb.files.getURL(rec, arquivo, { thumb: '0x0' }) : null
        setState({ arquivo, url })
        // Mantém o authStore em sincronia (o Layout e outros leitores do usuário).
        pb.authStore.save(pb.authStore.token, rec)
        return url
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Falha ao salvar a assinatura: ${msg}`)
        return null
      } finally {
        setSaving(false)
      }
    },
    [usuario?.id],
  )

  /** Remove a assinatura atual. */
  const removerAssinatura = useCallback(async () => {
    if (!usuario?.id) return
    setSaving(true)
    setError(null)
    try {
      const rec = await pb.collection('users').update(usuario.id, { assinatura_imagem: null })
      setState({ arquivo: '', url: null })
      pb.authStore.save(pb.authStore.token, rec)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Falha ao remover a assinatura: ${msg}`)
    } finally {
      setSaving(false)
    }
  }, [usuario?.id])

  return { ...state, loading, saving, error, salvarAssinatura, removerAssinatura, recarregar }
}
