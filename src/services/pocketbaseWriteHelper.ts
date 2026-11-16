/**
 * pocketbaseWriteHelper — gravação em ONDAS de requisições individuais com
 * retry no 429.
 *
 * Usado pelo fluxo de persistência da fila de ingestão de CGs
 * (cgIngestaoService.salvarSessaoIngestao / regravarItensFaltantes) para criar
 * ~1.300 registros (cg_ingestao_itens) sem estourar o rate-limit do PocketBase
 * (429 Too Many Requests).
 *
 * v0.0.209 — TROCA DE TRANSPORTE: o endpoint de batch do PocketBase
 * (POST /api/batch) NÃO é permitido no Skip Cloud — responde 403 "Batch
 * requests are not allowed." e NENHUM item era gravado. PROIBIDO usar
 * /api/batch. Cada registro agora viaja numa requisição individual
 * (POST /api/collections/{colecao}/records, via SDK pb.collection().create),
 * agrupada em ONDAS PEQUENAS (20 por onda, com pequena pausa entre ondas).
 *
 * Estratégia:
 * - ONDAS PEQUENAS: 20 requisições individuais por onda.
 * - Pausa ENTRE ondas (250 ms) para não saturar o servidor.
 * - 429 → pausa progressiva e RETENTA O MESMO registro (até 6 tentativas:
 *   ~1s, 2s, 4s, 8s, 16s, 32s de espera — teto 30s). Outros erros (400, 403)
 *   abortam — falha real, retry não resolve.
 * - Devolve { sucesso, gravados, erro } SEM lançar: quem chama decide marcar a
 *   sessão como ingestão incompleta e regravar os faltantes depois.
 *
 * Idempotência por item: quem chama já filtra os faltantes por
 * chave_normalizada (chaveGuardaCg) antes de chamar — um registro já gravado
 * nunca é reenviado, então o retry de onda não duplica nada.
 */

import pb from '@/lib/pocketbase/client'

export const CG_LOTE_TAMANHO = 20
const PAUSA_ENTRE_ONDAS_MS = 250
const MAX_TENTATIVAS_POR_ITEM = 6
const PAUSA_INICIAL_429_MS = 1000
const PAUSA_MAXIMA_429_MS = 30_000

function pausar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mensagem do erro de criação (quando o próprio registro responde 400). */
function resumoErroItem(err: unknown): string {
  const anyErr = err as { response?: { message?: string; data?: Record<string, unknown> } }
  const data = anyErr?.response?.data
  const detalhe =
    data && typeof data === 'object'
      ? Object.entries(data)
          .map(([campo, v]) => `${campo}: ${(v as { message?: string })?.message || String(v)}`)
          .join('; ')
      : ''
  const base = anyErr?.response?.message || (err instanceof Error ? err.message : String(err))
  return detalhe ? `${base} (${detalhe})` : base
}

/**
 * Divide a fila em ondas pequenas (CG_LOTE_TAMANHO por onda). Expoto para a
 * suíte golden provar o fatiamento da fila RN (113 coberturas + 1.188
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
 * golden provar o crescimento (1ª ~1s → 2ª 2s → 3ª 4s → …), teto 30s.
 */
export function calcularPausaProgressiva(tentativa: number): number {
  return Math.min(
    PAUSA_INICIAL_429_MS * Math.pow(2, Math.max(0, tentativa - 1)),
    PAUSA_MAXIMA_429_MS,
  )
}

/** Cria UM registro por requisição individual (POST /api/collections/.../records). */
async function criarUmRegistro(colecao: string, registro: Record<string, unknown>): Promise<void> {
  await pb.collection(colecao).create(registro)
}

/**
 * Cria registros em ondas de requisições INDIVIDUAIS — sem /api/batch
 * (proibido: o Skip Cloud responde 403 "Batch requests are not allowed.").
 *
 * Cada onda tem CG_LOTE_TAMANHO criações individuais; em 429, pausa
 * progressiva e retenta o MESMO registro — os já gravados na onda ficam
 * gravados e os seguintes continuam (a chamada seguinte pula os existentes
 * pela chave_normalizada). Como quem chama filtra os faltantes antes, nada é
 * duplicado.
 *
 * @param registros lista já no formato do banco (não aplica mapItemToRecord)
 * @param colecao nome da coleção destino (ex.: 'cg_ingestao_itens')
 */
export async function criarItensEmLotes(
  registros: Array<Record<string, unknown>>,
  colecao: string,
): Promise<{ sucesso: boolean; gravados: number; erro?: string }> {
  let gravados = 0

  for (const onda of dividirEmLotes(registros)) {
    for (const reg of onda) {
      let ok = false
      let ultimoErro: unknown = null

      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_POR_ITEM && !ok; tentativa++) {
        try {
          await criarUmRegistro(colecao, reg)
          ok = true
        } catch (err: unknown) {
          ultimoErro = err
          const status = (err as { status?: number })?.status
          const statusResp = (err as { response?: { status?: number } })?.response?.status
          const eh429 = status === 429 || statusResp === 429
          if (!eh429) break // erro real (validação, permissão) — retry não resolve
          if (tentativa < MAX_TENTATIVAS_POR_ITEM) {
            // 429: pausa progressiva e retenta o MESMO registro.
            await pausar(calcularPausaProgressiva(tentativa))
          }
        }
      }

      if (!ok) {
        return {
          sucesso: false,
          gravados,
          erro: `Falha ao gravar item ${gravados + 1} após ${MAX_TENTATIVAS_POR_ITEM} tentativas: ${resumoErroItem(ultimoErro)}`,
        }
      }

      gravados++
      // Pequena pausa entre itens dentro da onda não é necessária: as ondas
      // já respiram a cada 20 requisições (abaixo).
    }

    if (gravados < registros.length) {
      await pausar(PAUSA_ENTRE_ONDAS_MS) // respira entre ondas — não satura
    }
  }

  return { sucesso: true, gravados }
}
