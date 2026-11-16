/**
 * pocketbaseWriteHelper — escrita em lotes (batch) com retry no 429.
 *
 * Usado pelo fluxo de persistência da fila de ingestão de CGs
 * (cgIngestaoService.salvarSessaoIngestao / regravarItensFaltantes) para criar
 * ~1.300 registros (cg_ingestao_itens) em poucas requisições em vez de uma
 * requisição por item — que estourava o rate-limit do PocketBase (429 Too Many
 * Requests) e deixava a sessão fantasma com zero itens gravados.
 *
 * Estratégia:
 * - LOTES PEQUENOS (20 por requisição, via POST /api/batch).
 * - Pausa ENTRE lotes (250 ms a cada 20) para não saturar o servidor.
 * - 429 → pausa progressiva e RETENTA o MESMO lote (até 6 tentativas: 750ms,
 *   1.5s, 3s, 6s, 12s, 24s de espera). Outros erros (400, 403) abortam —
 *   falha real, retry não resolve.
 * - Devolve { sucesso, gravados, erro } SEM lançar: quem chama decide marcar a
 *   sessão como ingestão incompleta e regravar os faltantes depois.
 */

import pb from '@/lib/pocketbase/client'

export const CG_LOTE_TAMANHO = 20
const PAUSA_ENTRE_LOTES_MS = 250
const MAX_TENTATIVAS_POR_LOTE = 6
const PAUSA_INICIAL_429_MS = 750
const PAUSA_MAXIMA_429_MS = 30_000

function pausar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mensagem do erro de um item do batch (quando o próprio lote responde 400). */
function resumoErroBatch(err: unknown): string {
  const anyErr = err as { response?: { message?: string; data?: Record<string, unknown> } }
  const data = anyErr?.response?.data
  const detalheItem =
    data && typeof data === 'object'
      ? Object.entries(data)
          .map(([campo, v]) => `${campo}: ${(v as { message?: string })?.message || String(v)}`)
          .join('; ')
      : ''
  const base = anyErr?.response?.message || (err instanceof Error ? err.message : String(err))
  return detalheItem ? `${base} (${detalheItem})` : base
}

/**
 * Divide a fila em lotes pequenos (CG_LOTE_TAMANHO por requisição). Expoto
 * para a suíte golden provar o fatiamento da fila RN (113 coberturas + 1.188
 * exclusões) sem tocar no PocketBase.
 */
export function dividirEmLotes<T>(registros: T[]): T[][] {
  const lotes: T[][] = []
  for (let inicio = 0; inicio < registros.length; inicio += CG_LOTE_TAMANHO) {
    lotes.push(registros.slice(inicio, inicio + CG_LOTE_TAMANHO))
  }
  return lotes
}

/**
 * Pausa progressiva (backoff exponencial) ao receber 429. Expoto para a suíte
 * golden provar o crescimento (1ª ~750ms → 2ª 1.5s → 3ª 3s → …), teto 30s.
 */
export function calcularPausaProgressiva(tentativa: number): number {
  return Math.min(
    PAUSA_INICIAL_429_MS * Math.pow(2, Math.max(0, tentativa - 1)),
    PAUSA_MAXIMA_429_MS,
  )
}

/**
 * Cria registros em lotes pequenos. Cada lote viaja numa única requisição
 * (POST /api/batch). Em 429, pausa progressiva e retenta o MESMO lote — nada
 * é gravado duas vezes (o abort do batch é transacional).
 *
 * @param registros lista já no formato do banco (não aplica mapItemToRecord)
 * @param colecao nome da coleção destino (ex.: 'cg_ingestao_itens')
 */
export async function criarItensEmLotes(
  registros: Array<Record<string, unknown>>,
  colecao: string,
): Promise<{ sucesso: boolean; gravados: number; erro?: string }> {
  let gravados = 0

  for (const lote of dividirEmLotes(registros)) {
    let ok = false
    let ultimoErro: unknown = null

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_POR_LOTE && !ok; tentativa++) {
      try {
        const batch = pb.createBatch()
        for (const reg of lote) {
          batch.collection(colecao).create(reg)
        }
        await batch.send()
        ok = true
      } catch (err: unknown) {
        ultimoErro = err
        const status = (err as { status?: number })?.status
        const statusResp = (err as { response?: { status?: number } })?.response?.status
        const eh429 = status === 429 || statusResp === 429
        if (!eh429) break // erro real (validação, permissão) — retry não resolve
        if (tentativa < MAX_TENTATIVAS_POR_LOTE) {
          // 429: pausa progressiva e retenta o MESMO lote (transacional, não duplica)
          await pausar(calcularPausaProgressiva(tentativa))
        }
      }
    }

    if (!ok) {
      return {
        sucesso: false,
        gravados,
        erro: `Falha ao gravar itens (lote a partir do ${gravados + 1}º) após ${MAX_TENTATIVAS_POR_LOTE} tentativas: ${resumoErroBatch(ultimoErro)}`,
      }
    }

    gravados += lote.length
    if (gravados < registros.length) {
      await pausar(PAUSA_ENTRE_LOTES_MS) // respira entre lotes — não satura
    }
  }

  return { sucesso: true, gravados }
}
