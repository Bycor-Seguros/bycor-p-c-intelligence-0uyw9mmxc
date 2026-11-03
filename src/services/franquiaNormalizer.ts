/**
 * Módulo de estruturação e comparação de Franquias / POS
 * Converte strings brutas de franquia de qualquer seguradora (Tokio, AXA, Chubb, Porto, etc.)
 * em componentes estruturados e provê comparador canônico para auditoria Cartão x Apólice.
 */

import { parseCurrencyValue } from '@/lib/formatters'

export type FranquiaTipo = 'percentual' | 'valor' | 'dias' | 'mista' | 'nao_ha'

export interface FranquiaEstruturada {
  tipo: FranquiaTipo
  percentual?: number | null // ex: 10, 15, 20
  base?: string // ex: "prejuízos indenizáveis", "LMI"
  minimo?: number | null // valor mínimo em R$ (ex: 5000)
  valor?: number | null // valor fixo em R$ (ex: 1000)
  maximo?: number | null // valor máximo em R$ se houver
  diasHoras?: number | null // número de dias ou horas (ex: 96, 10, 7)
  unidadeTemporal?: 'dias' | 'horas' | 'meses' | null
  gatilhoRateio?: string | null // ex: "Rateio se VRD < 80% do VRA (cláusula 10.1)"
  sufixoAplicacao?: string | null // ex: "por reclamante", "por veículo", "por evento"
  condicao?: string | null // ex: "(EXCLUSIVAMENTE EM CASO DE RAIO)"
  textoOriginal: string
  textoFormatado?: string // ex: "10% min R$ 1.500,00" ou "Não Há" ou "R$ 1.000,00"
}

/**
 * Normaliza textos de valor monetário pt-BR (ex: "5.000,00" ou "5000") para number
 */
function parseValorRs(valStr: string | null | undefined): number | null {
  if (!valStr) return null
  const clean = valStr.replace(/[R$\s]/g, '').trim()
  const num = parseCurrencyValue(clean)
  return isNaN(num) ? null : num
}

/**
 * Converte string crua de Franquia / POS em componentes estruturados normalizados
 */
/**
 * Converte string crua ou valor de franquia percentual no formato padronizado "X% min R$Y".
 * Se não for percentual ou se não tiver percentual identificável, mantém a nomenclatura original.
 * Ex.:
 * - "10% com mínimo de R$ 920,00" -> "10% min R$ 920,00"
 * - "10% min R$ 920" -> "10% min R$ 920,00"
 * - "10% c/ 20 mil" -> "10% min R$ 20.000,00"
 * - "R$ 1.000,00" -> "R$ 1.000,00" (mantém)
 * - "Não Há" -> "Não Há" (mantém)
 * - "05 dias" -> "05 dias" (mantém)
 */
export function formatFranquiaPadrao(textoRaw: string | any): string {
  let original = ''
  if (typeof textoRaw === 'string') {
    original = textoRaw.trim()
  } else if (typeof textoRaw === 'object' && textoRaw !== null) {
    const rawVal =
      textoRaw.textoFormatado ||
      textoRaw.texto_formatado ||
      textoRaw.textoOriginal ||
      textoRaw.texto_original ||
      textoRaw.descricao ||
      ''
    if (rawVal && typeof rawVal === 'string') {
      original = rawVal.trim()
    } else if (textoRaw.percentual !== undefined && textoRaw.percentual !== null) {
      const pct = textoRaw.percentual
      if (textoRaw.minimo) {
        original = `${pct}% min R$ ${textoRaw.minimo}`
      } else {
        original = `${pct}%`
      }
    } else {
      original = String(textoRaw).trim()
    }
  } else {
    original = String(textoRaw || '').trim()
  }

  if (!original) return 'Não há'

  const est = parseFranquiaEstruturada(original)

  if (est.tipo === 'nao_ha') {
    return 'Não há'
  }

  // Franquia com percentual (tipo percentual ou mista com percentual)
  if (est.percentual !== null && est.percentual !== undefined && !isNaN(est.percentual)) {
    const pct = est.percentual
    let result = `${pct}%`

    if (est.minimo !== null && est.minimo !== undefined && !isNaN(est.minimo)) {
      const minStr = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: est.minimo % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(est.minimo)
      result = `${pct}% min R$${minStr}`
    } else if (est.maximo !== null && est.maximo !== undefined && !isNaN(est.maximo)) {
      const maxStr = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: est.maximo % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(est.maximo)
      result = `${pct}% máx R$${maxStr}`
    }

    if (est.sufixoAplicacao) {
      result = `${result} ${est.sufixoAplicacao}`.trim()
    }
    if (est.condicao) {
      result = `${result} ${est.condicao}`.trim()
    }
    return result
  }

  // Demais tipos (valor fixo, dias, mista sem percentual, não há) -> nomenclatura original
  return original
}

export function parseFranquiaEstruturada(textoRaw: string | null | undefined): FranquiaEstruturada {
  const original = (textoRaw || '').trim()

  if (!original) {
    return {
      tipo: 'nao_ha',
      textoOriginal: '',
    }
  }

  const norm = original
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, ' ')
    .trim()

  // 1. Extrai gatilho de rateio (ex: "Rateio se VRD < 80% do VRA...")
  let gatilhoRateio: string | null = null
  if (
    norm.includes('rateio') &&
    (norm.includes('80%') ||
      norm.includes('vrd') ||
      norm.includes('clausula 10') ||
      norm.includes('vra'))
  ) {
    gatilhoRateio = 'Rateio se VRD < 80% do VRA (cláusula 10.1)'
  }

  // 2. Caso NÃO HÁ / NÃO APLICÁVEL / ISENTO ou gatilho de rateio puro
  if (
    norm === 'nao ha' ||
    norm === 'sem franquia' ||
    norm === 'isento' ||
    norm === 'nao se aplica' ||
    norm === 'livre' ||
    norm === '-' ||
    norm === '—' ||
    norm.startsWith('nao ha') ||
    norm === 'rateio se vrd < 80% do vra (clausula 10.1)'
  ) {
    return {
      tipo: 'nao_ha',
      gatilhoRateio,
      textoOriginal: original,
    }
  }

  // 3. Sufixo de aplicação (por reclamante, por veículo, por evento)
  let sufixoAplicacao: string | null = null
  if (norm.includes('por reclamante') || norm.includes('p/ reclamante')) {
    sufixoAplicacao = 'por reclamante'
  } else if (norm.includes('por veiculo') || norm.includes('p/ veiculo')) {
    sufixoAplicacao = 'por veículo'
  } else if (norm.includes('por evento') || norm.includes('p/ evento')) {
    sufixoAplicacao = 'por evento'
  }

  // 4. Franquia em DIAS ou HORAS (ex: "AS PRIMEIRAS 96 HORAS", "Os primeiros 10 dias corridos", "05 dias", "AS PRIMEIRAS 96")
  const matchHoras = norm.match(/(?:primeiras?\s*)?(\d{1,4})\s*(?:horas?|h\b)/)
  const matchDias = norm.match(/(?:primeiros?\s*)?(\d{1,3})\s*dias?/)
  const matchPrimeirasApenas = norm.match(/(?:as\s+)?primeiras?\s*(\d{1,4})\b/)

  if (matchHoras || matchDias || matchPrimeirasApenas) {
    let isHoras = Boolean(matchHoras)
    let qtde = 0
    if (matchHoras) {
      qtde = parseInt(matchHoras[1], 10)
    } else if (matchDias) {
      qtde = parseInt(matchDias[1], 10)
    } else if (matchPrimeirasApenas) {
      qtde = parseInt(matchPrimeirasApenas[1], 10)
      isHoras = qtde >= 24
    }
    return {
      tipo: 'dias',
      diasHoras: qtde,
      unidadeTemporal: isHoras ? 'horas' : 'dias',
      gatilhoRateio,
      sufixoAplicacao,
      textoOriginal: original,
    }
  }

  // 5. Franquia com PERCENTUAL (ex: "10% DOS PREJUÍZOS, COM MÍNIMO DE R$ 5.000,00", "10% min R$ 5.000,00", "15% dos prejuízos")
  const matchPct = norm.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/)
  if (matchPct) {
    const pctVal = parseFloat(matchPct[1].replace(',', '.'))

    // Base do percentual
    let base = 'prejuízos indenizáveis'
    if (norm.includes('lmi') || norm.includes('limite maximo')) {
      base = 'LMI'
    } else if (norm.includes('is') || norm.includes('importancia segurada')) {
      base = 'importância segurada'
    } else if (norm.includes('sinistro') || norm.includes('prejuizo')) {
      base = 'prejuízos indenizáveis'
    }

    // Procura MÍNIMO em R$ (ex: "com mínimo de R$ 1.500,00", "minimo r$ 500,00", "min R$ 2.500,00", "c/ 20 mil", "c/ 1,5 mil", "com mín. R$ 1.500,00")
    let minimoVal: number | null = null

    // Caso "c/ X mil" ou "min X mil" ou "com mín. X mil"
    const matchMil = norm.match(/(?:c\/|com|m[ií]n(?:imo|ima)?\.?(?:\s*de)?)\s*([\d.,]+)\s*mil\b/)
    if (matchMil) {
      const numMil = parseValorRs(matchMil[1])
      if (numMil !== null) {
        minimoVal = numMil * 1000
      }
    }

    if (minimoVal === null) {
      const matchMin = norm.match(
        /(?:com\s+)?m[ií]n(?:imo|ima)?\.?(?:\s*de)?(?:\s*r\$)?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2}|[\d]{1,3}(?:\.[\d]{3})+|\d+)/,
      )
      if (matchMin) {
        minimoVal = parseValorRs(matchMin[1])
      }
    }

    // Procura MÁXIMO em R$ se houver
    let maximoVal: number | null = null
    const matchMax = norm.match(
      /(?:com\s+)?m[aá]x(?:imo|ima)?\.?\s*(?:de)?\s*(?:r\$)?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2}|[\d]{1,3}(?:\.[\d]{3})+|\d+)/,
    )
    if (matchMax) {
      maximoVal = parseValorRs(matchMax[1])
    }

    const tipo: FranquiaTipo = minimoVal !== null || maximoVal !== null ? 'mista' : 'percentual'

    // Extrai condição entre parênteses (ex: "(EXCLUSIVAMENTE EM CASO DE RAIO)")
    const condMatch = original.match(/\((?:EXCLUSIVAMENTE\s+)?EM\s+CASO\s+DE\s+[^)]+\)/i)
    const condicao = condMatch ? condMatch[0].trim() : null

    // Formata exibição resumida "X% min R$Y" quando houver mínimo
    let textoFormatado = `${pctVal}%`
    if (minimoVal !== null) {
      const minStr = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: minimoVal % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(minimoVal)
      textoFormatado = `${pctVal}% min R$${minStr}`
    } else if (maximoVal !== null) {
      const maxStr = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: maximoVal % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(maximoVal)
      textoFormatado = `${pctVal}% máx R$${maxStr}`
    }

    return {
      tipo,
      percentual: pctVal,
      base,
      minimo: minimoVal,
      maximo: maximoVal,
      gatilhoRateio,
      sufixoAplicacao,
      condicao,
      textoOriginal: original,
      textoFormatado,
    }
  }

  // 6. Franquia em VALOR FIXO (ex: "R$ 1.000,00", "1.500,00", "R$ 5.000,00 por reclamante")
  const matchValorFixo = original.match(/(?:R\$\s*)?([\d]{1,3}(?:\.[\d]{3})*,\d{2})/)
  if (matchValorFixo) {
    const vFixo = parseValorRs(matchValorFixo[1])
    if (vFixo !== null && vFixo > 0) {
      return {
        tipo: 'valor',
        valor: vFixo,
        gatilhoRateio,
        sufixoAplicacao,
        textoOriginal: original,
      }
    }
  }

  // 7. Fallback: preserva texto original com tipo valor/mista dependendo do conteúdo
  return {
    tipo: 'valor',
    gatilhoRateio,
    sufixoAplicacao,
    textoOriginal: original,
  }
}

/**
 * Resultado da comparação semântica entre duas franquias estruturadas
 */
export interface FranquiaComparacaoResultado {
  equivalentes: boolean
  divergenciaGravidade: 'nenhuma' | 'leve' | 'critica'
  motivo?: string
  fCartao: FranquiaEstruturada
  fApolice: FranquiaEstruturada
}

/**
 * Compara duas franquias por seus componentes estruturados (evitando falsas divergências
 * causadas por variação de maiúsculas, pontuação, acentuação ou redação equivalente).
 *
 * Exemplo:
 * - "10% dos prejuízos com mínimo de R$ 5.000,00" vs "10% min R$ 5.000,00" => EQUIVALENTES!
 * - "Não Há" vs "NÃO HÁ" => EQUIVALENTES!
 * - "AS PRIMEIRAS 96 HORAS" vs "96 horas" => EQUIVALENTES!
 * - "10% min R$ 5.000,00" vs "20% min R$ 5.000,00" => DIVERGENTES!
 */
export function compararFranquiasEstruturadas(
  cartaoRaw: string | null | undefined,
  apoliceRaw: string | null | undefined,
): FranquiaComparacaoResultado {
  const fC = parseFranquiaEstruturada(cartaoRaw)
  const fA = parseFranquiaEstruturada(apoliceRaw)

  // Se ambos forem vazios ou "não há"
  if ((fC.tipo === 'nao_ha' || !fC.textoOriginal) && (fA.tipo === 'nao_ha' || !fA.textoOriginal)) {
    return {
      equivalentes: true,
      divergenciaGravidade: 'nenhuma',
      fCartao: fC,
      fApolice: fA,
    }
  }

  // Se um for "não há" e o outro tiver franquia real
  if (fC.tipo === 'nao_ha' && fA.tipo !== 'nao_ha' && fA.textoOriginal) {
    return {
      equivalentes: false,
      divergenciaGravidade: 'critica',
      motivo: `Cartão de Risco sem franquia, mas Apólice possui: "${fA.textoOriginal}".`,
      fCartao: fC,
      fApolice: fA,
    }
  }

  if (fC.tipo !== 'nao_ha' && fC.textoOriginal && (fA.tipo === 'nao_ha' || !fA.textoOriginal)) {
    return {
      equivalentes: false,
      divergenciaGravidade: 'leve',
      motivo: `Cartão solicitou franquia ("${fC.textoOriginal}"), mas Apólice veio sem franquia.`,
      fCartao: fC,
      fApolice: fA,
    }
  }

  // Comparação de DIAS / HORAS
  if (fC.tipo === 'dias' || fA.tipo === 'dias') {
    if (
      fC.tipo === fA.tipo &&
      fC.diasHoras === fA.diasHoras &&
      fC.unidadeTemporal === fA.unidadeTemporal
    ) {
      return {
        equivalentes: true,
        divergenciaGravidade: 'nenhuma',
        fCartao: fC,
        fApolice: fA,
      }
    }
    // Conversão 96 horas = 4 dias? Se unidades forem diferentes mas valor proporcional for igual
    if (
      (fC.unidadeTemporal === 'horas' &&
        fA.unidadeTemporal === 'dias' &&
        (fC.diasHoras || 0) === (fA.diasHoras || 0) * 24) ||
      (fC.unidadeTemporal === 'dias' &&
        fA.unidadeTemporal === 'horas' &&
        (fC.diasHoras || 0) * 24 === (fA.diasHoras || 0))
    ) {
      return {
        equivalentes: true,
        divergenciaGravidade: 'nenhuma',
        fCartao: fC,
        fApolice: fA,
      }
    }
    return {
      equivalentes: false,
      divergenciaGravidade: 'critica',
      motivo: `Franquia temporal diverge: Cartão "${fC.textoOriginal}" vs Apólice "${fA.textoOriginal}".`,
      fCartao: fC,
      fApolice: fA,
    }
  }

  // Comparação de PERCENTUAL / MISTA
  if (
    fC.percentual !== undefined &&
    fC.percentual !== null &&
    fA.percentual !== undefined &&
    fA.percentual !== null
  ) {
    const pctIgual = Math.abs(fC.percentual - fA.percentual) < 0.01
    const minIgual =
      (fC.minimo === null || fC.minimo === undefined) &&
      (fA.minimo === null || fA.minimo === undefined)
        ? true
        : fC.minimo !== null &&
          fA.minimo !== null &&
          Math.abs((fC.minimo || 0) - (fA.minimo || 0)) < 1.0

    const sufixoCompativel =
      !fC.sufixoAplicacao || !fA.sufixoAplicacao || fC.sufixoAplicacao === fA.sufixoAplicacao

    if (pctIgual && minIgual && sufixoCompativel) {
      return {
        equivalentes: true,
        divergenciaGravidade: 'nenhuma',
        fCartao: fC,
        fApolice: fA,
      }
    }

    const motivos: string[] = []
    if (!pctIgual) motivos.push(`Percentual: Cartão ${fC.percentual}% vs Apólice ${fA.percentual}%`)
    if (!minIgual)
      motivos.push(`Mínimo: Cartão R$ ${fC.minimo ?? '—'} vs Apólice R$ ${fA.minimo ?? '—'}`)
    if (!sufixoCompativel)
      motivos.push(`Aplicação: Cartão "${fC.sufixoAplicacao}" vs Apólice "${fA.sufixoAplicacao}"`)

    return {
      equivalentes: false,
      divergenciaGravidade: pctIgual ? 'leve' : 'critica',
      motivo: motivos.join('; '),
      fCartao: fC,
      fApolice: fA,
    }
  }

  // Comparação de VALOR FIXO
  if (fC.valor !== undefined && fC.valor !== null && fA.valor !== undefined && fA.valor !== null) {
    const valIgual = Math.abs(fC.valor - fA.valor) < 1.0
    if (valIgual) {
      return {
        equivalentes: true,
        divergenciaGravidade: 'nenhuma',
        fCartao: fC,
        fApolice: fA,
      }
    }
    return {
      equivalentes: false,
      divergenciaGravidade: 'critica',
      motivo: `Valor de franquia diverge: Cartão R$ ${fC.valor} vs Apólice R$ ${fA.valor}.`,
      fCartao: fC,
      fApolice: fA,
    }
  }

  // Fallback de texto se os tipos forem heterogêneos
  const strCIgualA =
    fC.textoOriginal.toLowerCase().replace(/\s+/g, ' ').trim() ===
    fA.textoOriginal.toLowerCase().replace(/\s+/g, ' ').trim()
  if (strCIgualA) {
    return {
      equivalentes: true,
      divergenciaGravidade: 'nenhuma',
      fCartao: fC,
      fApolice: fA,
    }
  }

  return {
    equivalentes: false,
    divergenciaGravidade: 'critica',
    motivo: `Estrutura de franquia divergente: Cartão "${fC.textoOriginal}" vs Apólice "${fA.textoOriginal}".`,
    fCartao: fC,
    fApolice: fA,
  }
}
