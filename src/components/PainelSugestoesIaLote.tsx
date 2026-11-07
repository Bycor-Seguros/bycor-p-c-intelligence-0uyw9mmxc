import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Sparkles, X } from 'lucide-react'
import { SugestaoLoteItem } from '@/hooks/useSugestoesIaEquivalencia'

export interface PainelSugestoesIaLoteProps {
  loteAtivo: boolean
  loteItens: SugestaoLoteItem[]
  loteIndice: number
  onCancel: () => void
  onClose: () => void
  /** Reaproveita o mesmo handler do fluxo por célula (grava feedback igualmente) */
  onAceitar: (item: SugestaoLoteItem) => Promise<void>
  onRejeitar: (item: SugestaoLoteItem) => Promise<void>
  /** Retira da lista um item já decidido (Aceito/Rejeitado) */
  onRemover: (chave: string) => void
}

/** Peso numérico de cada grau de confiança (usado para ordenar e filtrar em massa) */
const ORDEM_CONFIANCA: Record<string, number> = { Alta: 1, Media: 0.8, Baixa: 0.4 }

const badgeConfianca = (g?: string) => {
  if (g === 'Alta') return <Badge className="bg-green-100 text-green-800">Alta</Badge>
  if (g === 'Media') return <Badge className="bg-amber-100 text-amber-800">Média</Badge>
  if (g === 'Baixa') return <Badge className="bg-red-100 text-red-800">Baixa</Badge>
  return null
}

/**
 * Painel de revisão em lote das sugestões de equivalência da IA (C3 — Tabulação).
 * Mostra progresso da varredura e permite Aceitar/Rejeitar individual (gravando
 * feedback na coleção ia_equivalencia_feedback) e aceitar em massa por confiança.
 */
export function PainelSugestoesIaLote({
  loteAtivo,
  loteItens,
  loteIndice,
  onCancel,
  onClose,
  onAceitar,
  onRejeitar,
  onRemover,
}: PainelSugestoesIaLoteProps) {
  const [processando, setProcessando] = useState<Record<string, boolean>>({})
  const algumProcessando = Object.keys(processando).length > 0

  const concluidas = useMemo(
    () =>
      [...loteItens]
        .filter((i) => i.status === 'concluida' && i.sugestao)
        .sort(
          (a, b) =>
            (ORDEM_CONFIANCA[b.sugestao?.grau_confianca || ''] || 0) -
            (ORDEM_CONFIANCA[a.sugestao?.grau_confianca || ''] || 0),
        ),
    [loteItens],
  )
  const erros = loteItens.filter((i) => i.status === 'erro')
  const processadas = concluidas.length + erros.length
  const total = loteItens.length
  const totalPendentes = total - processadas

  // Aceitação em massa: sugestões com grau de confiança >= X (default Alta+Média ≥ 0.8)
  const handleAceitarTodas = async (confiancaMinima: number) => {
    const candidatas = concluidas.filter(
      (i) => (ORDEM_CONFIANCA[i.sugestao?.grau_confianca || ''] || 0) >= confiancaMinima,
    )
    setProcessando((prev) => {
      const copy = { ...prev }
      candidatas.forEach((i) => (copy[i.chave] = true))
      return copy
    })
    try {
      for (const item of candidatas) {
        await onAceitar(item)
        onRemover(item.chave)
      }
    } finally {
      setProcessando({})
    }
  }

  const handleAcaoIndividual = async (
    item: SugestaoLoteItem,
    acao: (item: SugestaoLoteItem) => Promise<void>,
  ) => {
    setProcessando((prev) => ({ ...prev, [item.chave]: true }))
    try {
      await acao(item)
      onRemover(item.chave)
    } finally {
      setProcessando((prev) => {
        const copy = { ...prev }
        delete copy[item.chave]
        return copy
      })
    }
  }

  return (
    <Card className="border-primary/40 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Sugestões de equivalência (IA)
            {!loteAtivo && total > 0 && (
              <Badge variant="outline">
                {concluidas.length} sugestão(ões) · {erros.length} erro(s)
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {!loteAtivo && concluidas.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={algumProcessando}
                  onClick={() => handleAceitarTodas(1)}
                  title="Aceita apenas as sugestões com grau de confiança Alta"
                >
                  Aceitar todas (Alta)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={algumProcessando}
                  onClick={() => handleAceitarTodas(0.8)}
                  title="Aceita sugestões Alta e Média (confiança ≥ 0,8)"
                >
                  Aceitar ≥ 0,8
                </Button>
              </>
            )}
            {loteAtivo ? (
              <Button size="sm" variant="destructive" onClick={onCancel}>
                <X className="mr-1 h-4 w-4" />
                Cancelar varredura
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {loteAtivo && (
          <div className="mt-2 space-y-1">
            <p className="text-sm text-muted-foreground">
              Analisando {Math.min(loteIndice + 1, total)} de {total}…
              {totalPendentes > 0 && ` (${totalPendentes} restantes)`}
            </p>
            <Progress value={total > 0 ? ((loteIndice + 1) / total) * 100 : 0} />
          </div>
        )}
      </CardHeader>
      {total > 0 && (
        <CardContent className="pt-0">
          <ScrollArea className="max-h-[420px] pr-3">
            <div className="space-y-3">
              {loteItens.map((item, idx) => {
                const emProcessamento = processando[item.chave]
                const precisaDecisao =
                  item.status === 'concluida' && item.sugestao && !emProcessamento
                return (
                  <div key={item.chave} className="rounded-md border p-3 space-y-2 bg-background">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {idx + 1}. {item.par.alias}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.par.seguradoraNome}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.status === 'analisando' && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                        {item.status === 'concluida' &&
                          item.sugestao &&
                          badgeConfianca(item.sugestao.grau_confianca)}
                        {item.status === 'erro' && <Badge variant="destructive">Erro</Badge>}
                        {item.status === 'cancelado' && <Badge variant="outline">Cancelado</Badge>}
                      </div>
                    </div>

                    {item.status === 'concluida' && item.sugestao && (
                      <div className="space-y-2">
                        <p className="text-sm">
                          <span className="text-muted-foreground">Sugestão:</span>{' '}
                          <span className="font-medium">{item.sugestao.canonica_sugerida}</span>
                        </p>
                        {item.sugestao.justificativa_curta && (
                          <p className="text-xs text-muted-foreground italic">
                            “{item.sugestao.justificativa_curta}”
                          </p>
                        )}
                        {precisaDecisao && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={algumProcessando}
                              onClick={() => handleAcaoIndividual(item, onAceitar)}
                            >
                              Aceitar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={algumProcessando}
                              onClick={() => handleAcaoIndividual(item, onRejeitar)}
                            >
                              Rejeitar
                            </Button>
                          </div>
                        )}
                        {emProcessamento && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Registrando decisão…
                          </div>
                        )}
                      </div>
                    )}

                    {item.status === 'erro' && item.erro && (
                      <p className="text-xs text-destructive">{item.erro}</p>
                    )}

                    {emProcessamento && item.status !== 'concluida' && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Registrando decisão…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  )
}
