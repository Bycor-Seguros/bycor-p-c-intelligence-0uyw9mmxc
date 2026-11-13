// INTERFACE DE GRAVAÇÃO DO QAR (espelho do fluxo do Cartão de Risco)
// Parser puro em qarReader.ts; a interface de gravação vive aqui.
// Grava os dados declarados do item 21 vinculados ao ciclo/empreendimento,
// reaproveitando coleções existentes (empreendimentos) + coleção nova
// qar_declarados (migration 0044).

import pb from '@/lib/pocketbase/client'
import { executeWithRetry } from '@/services/guardiaImporter'
import {
  isCoberturaPropertyQar,
  parseQar21,
  normalizarTermoEquivalenciaQar,
  type QarResultado,
} from '@/services/qarReader'

const QAR_DECLARADOS = 'qar_declarados'

export interface QarUploadParams {
  /** Empreendimento do ciclo (obrigatório — vínculo principal). */
  empreendimentoId: string
  /** RFQ do ciclo, quando existir (rastreabilidade). */
  rfqId?: string
  /** Nome do arquivo PDF de origem (rastreabilidade, sem o arquivo). */
  fonteArquivo: string
  /** E-mail do usuário do ciclo (rastreabilidade). */
  usuarioEmail: string
  /** Linhas de texto já extraídas do PDF (via extractTextFromPdf). */
  linhasTexto: string[]
}

export interface QarUploadResultado {
  success: boolean
  created: number
  updated: number
  unchanged: number
  isPretendidaGravada: boolean
  lmgsMarcados: string[]
  coberturasGravadas: number
  sugestoesIgnoradas: number
  errors: string[]
}

/** "1 km" => 1 ; "1,5 km" => 1.5 ; null => null (campo distancia_km numérico). */
function parseNumeroQarKm(detalheKm: string | null): number | null {
  if (!detalheKm) return null
  const m = detalheKm.match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return null
  return Number(m[1].replace(',', '.'))
}

function identicalQar(rec: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  const eq = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')
  return (
    eq(rec.cobertura, payload.cobertura) &&
    eq(rec.tipo_valor, payload.tipo_valor) &&
    eq(rec.percentual_is_pretendida, payload.percentual_is_pretendida) &&
    eq(rec.valor_pretendido_rs, payload.valor_pretendido_rs) &&
    eq(rec.distancia_km, payload.distancia_km) &&
    eq(rec.lmg_marcado, payload.lmg_marcado) &&
    eq(rec.lmg_index, payload.lmg_index) &&
    eq(rec.importancia_segurada_pretendida, payload.importancia_segurada_pretendida)
  )
}

/**
 * Grava o QAR declarado do item 21 no banco, vinculado ao ciclo/empreendimento.
 * Idempotente por dedupe (empreendimento + cobertura normalizada): atualiza o
 * registro existente se algo mudou, pula se idêntico.
 *
 * Segunda camada de guarda (regra de produto): coberturas de property (Danos
 * por Água; Despesas de Salvamento e Contenção) e sugestões do formulário
 * nunca são gravadas — o parser já as exclui.
 */
export async function salvarQarDeclarado(
  params: QarUploadParams,
  onProgress?: (msg: string) => void,
): Promise<QarUploadResultado> {
  const res: QarUploadResultado = {
    success: false,
    created: 0,
    updated: 0,
    unchanged: 0,
    isPretendidaGravada: false,
    lmgsMarcados: [],
    coberturasGravadas: 0,
    sugestoesIgnoradas: 0,
    errors: [],
  }

  if (!params.empreendimentoId) {
    res.errors.push('Empreendimento do ciclo é obrigatório para gravar o QAR.')
    return res
  }

  const extracao: QarResultado = parseQar21(params.linhasTexto)
  res.sugestoesIgnoradas = extracao.sugestoesIgnoradas.length
  res.lmgsMarcados = extracao.lmgsMarcados

  // 1. IS pretendida + LMGs marcados no empreendimento (JSON idempotente)
  onProgress?.('Vinculando QAR ao empreendimento do ciclo...')
  const isPretendida = extracao.importanciaSeguradaPretendida
  if (isPretendida !== null) {
    let anterior: Record<string, unknown> = {}
    try {
      const emp = await pb.collection('empreendimentos').getOne(params.empreendimentoId)
      const raw = (emp as Record<string, unknown>)?.qar_is_pretendida_json
      anterior = typeof raw === 'string' ? JSON.parse(raw) : raw || {}
    } catch {
      anterior = {}
    }
    const payloadEmp = {
      ...anterior,
      is_pretendida: isPretendida,
      lmgs_marcados: extracao.lmgsMarcados,
      fonte_arquivo: params.fonteArquivo,
      usuario_email: params.usuarioEmail,
      imported_at: new Date().toISOString(),
    }
    try {
      await executeWithRetry(() =>
        pb.collection('empreendimentos').update(params.empreendimentoId, {
          qar_is_pretendida_json: JSON.stringify(payloadEmp),
        }),
      )
      res.isPretendidaGravada = true
    } catch (err) {
      res.errors.push(`Erro ao gravar IS pretendida no empreendimento: ${(err as Error).message}`)
      return res
    }
  }

  // 2. Dedup: coberturas já gravadas para este empreendimento
  let existing: Array<Record<string, unknown>> = []
  try {
    existing = (await executeWithRetry(() =>
      pb.collection(QAR_DECLARADOS).getFullList({
        filter: `empreendimento="${params.empreendimentoId}"`,
      }),
    )) as unknown as Array<Record<string, unknown>>
  } catch {
    existing = []
  }
  const existingMap = new Map<string, Record<string, unknown>>()
  for (const rec of existing) {
    existingMap.set(normalizarTermoEquivalenciaQar(String(rec.cobertura || '')), rec)
  }

  // 3. Grava apenas as coberturas declaradas (com % ou valor) — property nunca grava
  const declaradas = extracao.coberturas.filter((c) => !isCoberturaPropertyQar(c.cobertura))
  res.coberturasGravadas = declaradas.length

  for (const cob of declaradas) {
    const payload: Record<string, unknown> = {
      empreendimento: params.empreendimentoId,
      ...(params.rfqId ? { rfq: params.rfqId } : {}),
      cobertura: cob.cobertura,
      cobertura_normalizada: normalizarTermoEquivalenciaQar(cob.cobertura),
      tipo_valor: cob.tipoValor,
      percentual_is_pretendida: cob.percentual,
      valor_pretendido_rs: cob.valorPretendido,
      distancia_km: parseNumeroQarKm(cob.detalheKm),
      lmg_marcado: cob.lmgMarcado,
      lmg_index: cob.lmgIndex,
      linha_original: cob.linhaOriginal,
      fonte_arquivo: params.fonteArquivo,
      usuario_email: params.usuarioEmail,
      importancia_segurada_pretendida: isPretendida,
    }

    const key = normalizarTermoEquivalenciaQar(cob.cobertura)
    const rec = existingMap.get(key)
    try {
      if (rec) {
        if (identicalQar(rec, payload)) {
          res.unchanged++
          continue
        }
        await executeWithRetry(() => pb.collection(QAR_DECLARADOS).update(String(rec.id), payload))
        res.updated++
      } else {
        await executeWithRetry(() => pb.collection(QAR_DECLARADOS).create(payload))
        res.created++
      }
    } catch (err) {
      res.errors.push(`Erro ao gravar cobertura "${cob.cobertura}": ${(err as Error).message}`)
    }
  }

  res.success = res.errors.length === 0
  onProgress?.('Gravação do QAR concluída!')
  return res
}
