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
  /** Linhas espúrias de leituras antigas deletadas pelo re-upload ("substituir tudo"). */
  deletadas: number
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
 * Linha fantasma documentada do leitor antigo (caso real Anália): o item
 * "RC Produtos e Trabalhos Concluídos" não existe no formulário real do PDF —
 * a linha foi gravada por leitura antiga a partir do bloco de opções (ver o
 * comentário do bloco de opções em qarReader.ts). No re-upload ("substituir
 * tudo") ela é SEMPRE órfã: a leitura atual recria o LMG padrão com o valor
 * correto. A correção do analista (lmg_editado_pelo_analista) tem precedência
 * sobre a fantasma.
 */
const CHAVE_LINHA_FANTASMA_LMG_QAR = 'rc produtos e trabalhos concluidos'

/** A linha fantasma documentada do leitor antigo (sempre órfã no re-upload). */
function isLinhaFantasmaLmgQar(chave: string): boolean {
  return chave === CHAVE_LINHA_FANTASMA_LMG_QAR
}

/**
 * Casamento entre o nome gravado no banco (leitura antiga) e o nome que o
 * leitor atual produz — MESMA normalização (normalizarTermoEquivalenciaQar)
 * dos dois lados, com tolerância ao lixo de junção de linhas do PDF no
 * SUFIXO da leitura antiga (ex.: "Poluição Súbita e Acidental – 72hrs" casa
 * com "Poluição Súbita e Acidental" da leitura atual). Lixo no PREFIXO
 * (ex.: "imóveis Poluição...") NÃO casa — é espúrio e vira órfão.
 */
function casaComLeituraAtualQar(coberturaAntiga: string, chavesNovas: string[]): boolean {
  const chave = normalizarTermoEquivalenciaQar(coberturaAntiga)
  if (chavesNovas.includes(chave)) return true
  return chavesNovas.some((nk) => nk.length > 0 && chave.startsWith(nk) && chave.length > nk.length)
}

/**
 * SUBSTITUIR TUDO (reconciliação pura do re-upload do QAR): retorna os ids das
 * linhas órfãs de leituras antigas que a NOVA leitura NÃO trouxe — as espúrias
 * do caso Anália ("☒ Opção 1/2/3", "☒ Outros", "RC Produtos e Trabalhos
 * Concluídos") somem ao reenviar o PDF. Linhas com lmg_editado_pelo_analista
 * (chaves presentes em lmgEditados) NUNCA são órfãs: a correção do analista
 * sobrevive ao reenvio.
 */
export function calcularLinhasOrfasQar(
  existing: Array<{ id: string; cobertura: string }>,
  coberturasNovas: string[],
  lmgEditados: Set<string>,
): Array<{ id: string; cobertura: string }> {
  const chavesNovas = coberturasNovas.map((c) => normalizarTermoEquivalenciaQar(c))
  return existing
    .map((rec) => ({ id: rec.id, cobertura: rec.cobertura }))
    .filter((rec) => {
      const chave = normalizarTermoEquivalenciaQar(rec.cobertura)
      if (lmgEditados.has(chave)) return false // correção do analista nunca é perdida
      if (isLinhaFantasmaLmgQar(chave)) return true // fantasma documentada: sempre órfã
      return !casaComLeituraAtualQar(rec.cobertura, chavesNovas)
    })
}

/**
 * Grava o QAR declarado do item 21 no banco, vinculado ao ciclo/empreendimento.
 * Idempotente por dedupe (empreendimento + cobertura normalizada): atualiza o
 * registro existente se algo mudou, pula se idêntico.
 *
 * Segunda camada de guarda (regra de produto): coberturas de property (Danos
 * por Água; Despesas de Salvamento e Contenção) e sugestões do formulário
 * nunca são gravadas — o parser já as exclui.
 *
 * Reconciliação com o casamento tolerante (mesma semântica de
 * calcularLinhasOrfasQar): a linha fantasma do leitor antigo sai do dedupe (a
 * leitura atual recria o LMG padrão limpa) e o lookup aceita a chave antiga
 * com lixo de sufixo — evita duplicata quando a leitura antiga gravou o nome
 * estendido (ex.: "Poluição Súbita e Acidental – 72hrs").
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
    deletadas: 0,
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
    if (isLinhaFantasmaLmgQar(chave)) continue // fantasma: a leitura atual recria o LMG limpa
    existingMap.set(chave, rec)
  }

  /** Lookup tolerante: chave exata OU chave antiga que estende a nova (lixo de sufixo). */
  const acharExistenteQar = (chaveNova: string): Record<string, unknown> | undefined => {
    const exato = existingMap.get(chaveNova)
    if (exato) return exato
    for (const [chaveExistente, rec] of existingMap) {
      if (chaveExistente.length > chaveNova.length && chaveExistente.startsWith(chaveNova))
        return rec
    }
    return undefined
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
    const rec = acharExistenteQar(key)
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

  // 4. SUBSTITUIR TUDO: o re-upload do QAR reflete o formulário ATUAL — linhas
  // de leituras antigas que a nova leitura NÃO trouxe são deletadas (ex.:
  // "☒ Opção 1/2/3", "☒ Outros" e a linha fantasma "RC Produtos e Trabalhos
  // Concluídos" do caso Anália, gravadas pelo leitor antigo). PRESERVAÇÃO
  // GARANTIDA: registros com lmg_editado_pelo_analista=true (a correção do
  // analista nunca é perdida) e qualquer cobertura que a nova leitura trouxe
  // (casamento por chave normalizada, tolerante a lixo de sufixo).
  if (existing.length > 0) {
    const idsOrfaos = calcularLinhasOrfasQar(
      existing.map((r) => ({ id: String(r.id), cobertura: String(r.cobertura || '') })),
      declaradas.map((c) => c.cobertura),
      lmgEditados,
    )
    for (const { id, cobertura } of idsOrfaos) {
      try {
        await executeWithRetry(() => pb.collection(QAR_DECLARADOS).delete(id))
        res.deletadas++
      } catch (err) {
        res.errors.push(`Erro ao remover linha obsoleta "${cobertura}": ${(err as Error).message}`)
      }
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
