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
  /** Coberturas cujo LMG editado pelo analista foi preservado no re-upload. */
  lmgsPreservados: number
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
    lmgsPreservados: 0,
    errors: [],
  }

  if (!params.empreendimentoId) {
    res.errors.push('Empreendimento do ciclo é obrigatório para gravar o QAR.')
    return res
  }

  const extracao: QarResultado = parseQar21(params.linhasTexto)
  res.sugestoesIgnoradas = extracao.sugestoesIgnoradas.length
  res.lmgsMarcados = extracao.lmgsMarcados

  // GUARDA DE SOBRESCRITA (flag lmg_editado_pelo_analista, migration 0046):
  // descobrir ANTES de gravar o que o analista já corrigiu — o re-upload do
  // QAR nunca sobrescreve a correção humana (LMG por cobertura nem a IS
  // pretendida do empreendimento).
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
  const lmgEditados = new Set<string>()
  for (const rec of existing) {
    if (!rec.lmg_editado_pelo_analista) continue
    lmgEditados.add(
      normalizarTermoEquivalenciaQar(String(rec.cobertura || rec.cobertura_normalizada || '')),
    )
  }

  // 1. IS pretendida + LMGs marcados no empreendimento (JSON idempotente).
  // Guarda: se o analista já editou a IS pretendida, o re-upload não a sobrescreve.
  onProgress?.('Vinculando QAR ao empreendimento do ciclo...')
  const isPretendida = extracao.importanciaSeguradaPretendida
  let isPretendidaEditada = false
  if (isPretendida !== null) {
    let anterior: Record<string, unknown> = {}
    try {
      const emp = await pb.collection('empreendimentos').getOne(params.empreendimentoId)
      const raw = (emp as Record<string, unknown>)?.qar_is_pretendida_json
      anterior = typeof raw === 'string' ? JSON.parse(raw) : raw || {}
      isPretendidaEditada = Boolean(
        (anterior as Record<string, unknown>).is_pretendida_editada_pelo_analista,
      )
    } catch {
      anterior = {}
    }
    if (isPretendidaEditada) {
      // Guarda da IS: o analista já corrigiu a IS pretendida — o re-upload
      // preserva a correção (só atualiza os LMGs marcados, se houver).
      if (extracao.lmgsMarcados !== anterior.lmgs_marcados) {
        try {
          await executeWithRetry(() =>
            pb.collection('empreendimentos').update(params.empreendimentoId, {
              qar_is_pretendida_json: JSON.stringify({
                ...anterior,
                lmgs_marcados: extracao.lmgsMarcados,
                imported_at: new Date().toISOString(),
              }),
            }),
          )
        } catch {
          /* IS preservada; falha ao atualizar LMGs marcados não bloqueia o fluxo */
        }
      }
    } else {
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
  }

  // 2. Dedupe: coberturas já gravadas para este empreendimento — EXCETO as que
  // o analista editou (lmgEditados): essas preservam o valor corrigido e não
  // entram no loop de update/create abaixo.
  const existingMap = new Map<string, Record<string, unknown>>()
  for (const rec of existing) {
    const chave = normalizarTermoEquivalenciaQar(String(rec.cobertura || ''))
    if (lmgEditados.has(chave)) continue // guarda: preserva a edição humana
    existingMap.set(chave, rec)
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
    if (lmgEditados.has(key)) {
      // Guarda: o analista já corrigiu esta cobertura — não sobrescreve nem
      // cria duplicata; mantém o registro editado como está.
      res.lmgsPreservados = (res.lmgsPreservados || 0) + 1
      continue
    }
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

// ---------------------------------------------------------------------------
// EDIÇÃO DO LMG/IS PELO ANALISTA (eixo QAR × Apólice na Auditoria)
// ---------------------------------------------------------------------------

export interface SalvarEdicaoLmgQarParams {
  empreendimentoId: string
  /** Nome da cobertura como declarado no QAR (texto da linha do item 21). */
  cobertura: string
  /** Novo valor do LMG declarado, em R$ (número). */
  novoLmg: number
  /** IS pretendida atual do QAR, para gravar no registro (rastreabilidade). */
  importanciaSeguradaPretendida?: number | null
}

export interface SalvarEdicaoIsPretendidaParams {
  empreendimentoId: string
  /** Nova IS pretendida, em R$ (número > 0). */
  novaIs: number
  /** Usuário que editou (rastreabilidade no JSON do empreendimento). */
  usuarioEmail?: string
}

export interface EdicaoQarResultado {
  success: boolean
  acao: 'atualizado' | 'criado' | 'is_pretendida'
  erro?: string
}

/**
 * Grava a EDIÇÃO do LMG declarado de uma cobertura pelo analista.
 * - Atualiza o registro existente de qar_declarados (por empreendimento +
 *   cobertura normalizada) OU cria um novo quando ele ainda não existe.
 * - Marca lmg_editado_pelo_analista = true.
 * - A correção do analista PREVALECE: salvarQarDeclarado nunca sobrescreve
 *   registros com o flag marcado (guarda de re-upload).
 */
export async function salvarEdicaoLmgQarDeclarado(
  params: SalvarEdicaoLmgQarParams,
): Promise<EdicaoQarResultado> {
  const { empreendimentoId, cobertura, novoLmg, importanciaSeguradaPretendida } = params
  if (!empreendimentoId || !cobertura || !Number.isFinite(novoLmg) || novoLmg <= 0) {
    return { success: false, acao: 'atualizado', erro: 'Dados da edição incompletos ou inválidos.' }
  }

  try {
    const existentes = (await executeWithRetry(() =>
      pb.collection(QAR_DECLARADOS).getFullList({
        filter: `empreendimento="${empreendimentoId}"`,
      }),
    )) as unknown as Array<Record<string, unknown>>
    const chave = normalizarTermoEquivalenciaQar(cobertura)
    const rec = existentes.find(
      (r) => normalizarTermoEquivalenciaQar(String(r.cobertura || '')) === chave,
    )

    if (rec) {
      await executeWithRetry(() =>
        pb.collection(QAR_DECLARADOS).update(String(rec.id), {
          valor_pretendido_rs: novoLmg,
          tipo_valor: 'fixo',
          ...(typeof importanciaSeguradaPretendida === 'number'
            ? { importancia_segurada_pretendida: importanciaSeguradaPretendida }
            : {}),
          lmg_editado_pelo_analista: true,
        }),
      )
      return { success: true, acao: 'atualizado' }
    }

    // Registro ainda não existe — cria com o valor corrigido pelo analista.
    await executeWithRetry(() =>
      pb.collection(QAR_DECLARADOS).create({
        empreendimento: empreendimentoId,
        cobertura,
        cobertura_normalizada: chave,
        tipo_valor: 'fixo',
        percentual_is_pretendida: null,
        valor_pretendido_rs: novoLmg,
        lmg_marcado: false,
        ...(typeof importanciaSeguradaPretendida === 'number'
          ? { importancia_segurada_pretendida: importanciaSeguradaPretendida }
          : {}),
        lmg_editado_pelo_analista: true,
        fonte_arquivo: 'edição manual do analista',
      }),
    )
    return { success: true, acao: 'criado' }
  } catch (err) {
    return { success: false, acao: 'atualizado', erro: (err as Error).message }
  }
}

/**
 * Grava a EDIÇÃO da IS pretendida do QAR do empreendimento (JSON idempotente
 * qar_is_pretendida_json). A correção do analista prevalece: re-uploads
 * posteriores do QAR não voltam para a menor opção do formulário.
 */
export async function salvarEdicaoIsPretendidaQar(
  params: SalvarEdicaoIsPretendidaParams,
): Promise<EdicaoQarResultado> {
  const { empreendimentoId, novaIs } = params
  if (!empreendimentoId || !Number.isFinite(novaIs) || novaIs <= 0) {
    return {
      success: false,
      acao: 'is_pretendida',
      erro: 'Valor da IS pretendida inválido.',
    }
  }

  try {
    let anterior: Record<string, unknown> = {}
    try {
      const emp = await pb.collection('empreendimentos').getOne(empreendimentoId)
      const raw = (emp as Record<string, unknown>)?.qar_is_pretendida_json
      anterior = typeof raw === 'string' ? JSON.parse(raw) : raw || {}
    } catch {
      anterior = {}
    }
    const payloadEmp = {
      ...anterior,
      is_pretendida: novaIs,
      is_pretendida_editada_pelo_analista: true,
      edited_at: new Date().toISOString(),
      ...(params.usuarioEmail ? { usuario_email: params.usuarioEmail } : {}),
    }
    await executeWithRetry(() =>
      pb.collection('empreendimentos').update(empreendimentoId, {
        qar_is_pretendida_json: JSON.stringify(payloadEmp),
      }),
    )
    return { success: true, acao: 'is_pretendida' }
  } catch (err) {
    return { success: false, acao: 'is_pretendida', erro: (err as Error).message }
  }
}
