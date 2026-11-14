import React, { useEffect, useRef, useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { parseCurrencyValue } from '@/lib/formatters'

/** Pega o valor digitado e devolve número (parser pt-BR) ou null se inválido. */
export function parseValorEditadoPtBr(raw: string): number | null {
  const n = parseCurrencyValue(raw)
  return n !== null && Number.isFinite(n) && n > 0 ? n : null
}

export interface ValorEditavelInlineProps {
  /** Valor atual, em R$ (número) ou null/undefined quando não há. */
  valor: number | null
  /** Texto exibido quando não há valor. */
  placeholder?: string
  /** Chamado com o valor parseado ao confirmar (Enter ou blur). */
  onSalvar: (valor: number) => Promise<void> | void
  /** Largura do input em edição. */
  inputClassName?: string
  /** Classes extras no botão de leitura (mesma largura etc.). */
  buttonClassName?: string
  /** Desabilita a edição (ex.: durante um salvamento em lote). */
  disabled?: boolean
  ariaLabel: string
}

/**
 * Valor numérico clicável que vira input pt-BR para edição inline.
 * Enter/blur salva (parse pt-BR); Esc cancela; clique fora salva.
 * O componente é burro: quem salva e recalcula é quem o usa.
 */
export function ValorEditavelInline({
  valor,
  placeholder = '—',
  onSalvar,
  inputClassName = 'w-40',
  buttonClassName = '',
  disabled = false,
  ariaLabel,
}: ValorEditavelInlineProps) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editando) inputRef.current?.select()
  }, [editando])

  const abrirEdicao = () => {
    if (disabled || salvando) return
    setTexto(valor !== null ? String(valor) : '')
    setEditando(true)
  }

  const confirmar = async () => {
    const novo = parseValorEditadoPtBr(texto)
    if (novo === null) {
      // inválido/vazio: volta ao modo leitura sem gravar nada
      setEditando(false)
      return
    }
    if (valor !== null && Math.abs(novo - valor) < 0.01) {
      setEditando(false)
      return
    }
    setSalvando(true)
    try {
      await onSalvar(novo)
      setEditando(false)
    } catch {
      // mantém em edição para o analista corrigir/repetir
    } finally {
      setSalvando(false)
    }
  }

  const cancelar = () => {
    setEditando(false)
  }

  if (editando) {
    return (
      <Input
        ref={inputRef}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            inputRef.current?.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelar()
          }
        }}
        className={`h-7 py-1 text-right font-mono text-xs ${inputClassName}`}
        placeholder="Ex.: 5.000.000"
        disabled={salvando}
        aria-label={ariaLabel}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={abrirEdicao}
      disabled={disabled || salvando}
      title="Clique para editar"
      className={`group inline-flex items-center justify-end gap-1 rounded px-1 py-0.5 font-mono text-xs text-gray-900 hover:bg-blue-50 hover:text-[#16578B] disabled:opacity-60 ${buttonClassName}`}
      aria-label={ariaLabel}
    >
      {salvando ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin text-[#16578B]" />
          Salvando...
        </>
      ) : (
        <>
          {valor !== null
            ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : placeholder}
          <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0" />
        </>
      )}
    </button>
  )
}
