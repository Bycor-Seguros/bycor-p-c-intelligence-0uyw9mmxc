// LEITOR DE QAR — PARSE (espelho do riskCardReader, parser/interface separados)
// Item 21 do formulário padrão Bycor (mesmo layout para todas as seguradoras).
// Coberturas com % ou valor declarado entram; sugestões (sem % ou valor) são
// ignoradas; coberturas de property (Danos por Água; Despesas de Salvamento e
// Contenção) ficam FORA do leitor (regra de produto, eixo RC).
// % declarado é % da Importância Segurada pretendida.

// ---------- INTERFACE (gravada em qar_declarados, migration 0044) ----------

export interface QarCoberturaDeclarada {
  /** Nome no formulário (ex.: "Poluição Súbita e Acidental"). */
  cobertura: string
  /** "percentual" (X% da IS pretendida) ou "fixo" (valor em R$). */
  tipoValor: 'percentual' | 'fixo'
  /** 5 => 5% da IS pretendida. */
  percentual: number | null
  /** Valor declarado em R$ (ex.: 2.000.000). */
  valorPretendido: number | null
  /** Detalhe da linha, ex.: "1 km" no Percurso estabelecimento↔garagem. */
  detalheKm: string | null
  /** É um dos 4 LMGs marcados do item 21. */
  lmgMarcado: boolean
  /** 1..4 quando lmgMarcado. */
  lmgIndex: number | null
  /** Linha bruta do PDF (rastreabilidade, sem gravar o documento). */
  linhaOriginal: string
}

export interface QarResultado {
  /** 4 LMGs marcados no item 21, em ordem. */
  lmgsMarcados: string[]
  /** Importância Segurada pretendida (R$) declarada no formulário. */
  importanciaSeguradaPretendida: number | null
  coberturas: QarCoberturaDeclarada[]
  /** Coberturas listadas sem % nem valor — sugestões do formulário (ignoradas). */
  sugestoesIgnoradas: string[]
}

// ---------- CONSTANTES DO FORMULÁRIO PADRÃO ----------

/** Os 4 LMGs padrão do item 21 (formulário fixo Bycor). */
export const QAR_LMGS_PADRAO = [
  'RC Operações (Estabelecimentos Comerciais/Industriais)',
  'RC Danos Morais',
  'RC Empregador',
  'RC Produtos e Trabalhos Concluídos',
] as const

export const QAR_TIPOVALOR = { PERCENTUAL: 'percentual', FIXO: 'fixo' } as const

/** Coberturas de PROPERTY fora do eixo RC — nunca entram no leitor do QAR. */
export const QAR_COBERTURAS_PROPERTY = [
  'Danos por Água',
  'Despesas de Salvamento e Contenção',
] as const

/** Nome normalizado (sem acentos, minúsculo) para dedupe e matching. */
export function normalizarTermoEquivalenciaQar(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Verdade de projeto: é property (fora do leitor)? */
export function isCoberturaPropertyQar(nome: string): boolean {
  const n = normalizarTermoEquivalenciaQar(nome)
  if (!n) return false
  return (
    n.includes('danos por agua') ||
    n.includes('danos de agua') ||
    n.includes('salvamento e contencao') ||
    n.includes('despesas de salvamento')
  )
}

// ---------- PARSER (puro — sem I/O) ----------

function parseNumeroPtBr(raw: string): number | null {
  if (!raw) return null
  const limpo = raw.replace(/[R$\s]/gi, '').trim()
  if (!limpo) return null
  const negativo = limpo.startsWith('(') && limpo.endsWith(')')
  const soNumeros = limpo.replace(/[()]/g, '')
  const temVirgula = soNumeros.includes(',')
  const temPonto = soNumeros.includes('.')
  let normalizado: string
  if (temVirgula && temPonto) {
    // pt-BR: ponto milhar, vírgula decimal
    normalizado = soNumeros.replace(/\./g, '').replace(',', '.')
  } else if (temVirgula) {
    normalizado = soNumeros.replace(',', '.')
  } else if (temPonto && /^\d{1,3}(\.\d{3})+$/.test(soNumeros)) {
    // Só pontos: todos são separadores de milhar (ex.: "2.000.000")
    normalizado = soNumeros.replace(/\./g, '')
  } else {
    normalizado = soNumeros
  }
  const n = Number(normalizado.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/** 1.000.000,00 => 1000000 ; 2.000.000 => 2000000 ; 100.000,50 => 100000.5 */
export function parseValorQar(raw: string): number | null {
  return parseNumeroPtBr(raw)
}

/** "5%" => 5 ; "0,5%" => 0.5 */
export function parsePercentualQar(raw: string): number | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/)
  if (!m) return null
  const n = parseNumeroPtBr(m[1])
  return n === null ? null : Math.min(n, 100)
}

function parseQarLinhaCobertura(
  linha: string,
): Pick<
  QarCoberturaDeclarada,
  'cobertura' | 'tipoValor' | 'percentual' | 'valorPretendido' | 'detalheKm'
> | null {
  const texto = linha.trim()
  if (!texto || texto.length < 4) return null

  // Índice de início do valor: primeiro de % ou R$ na linha
  const idxPct = texto.search(/\d{1,3}(?:[.,]\d+)?\s*%/)
  const idxValor = texto.indexOf('R$')
  // Número de milhar sem R$ nem % (ex.: "Portões Automáticos 100.000"):
  // também é corte de valor declarado — não é sugestão do formulário.
  const idxMilhar = texto.search(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/)
  const cortes = [idxPct, idxValor, idxMilhar].filter((i) => i >= 0)
  if (cortes.length === 0) return null
  const corte = Math.min(...cortes)

  const nomeBruto = texto.slice(0, corte).trim()
  const nome = nomeBruto
    .replace(/^[\s•\-–—*.:;]+/, '')
    // "X" de marcação que gruda no nome no PDF (ex.: "Colisão ... X")
    .replace(/\s+[xX]\s*$/, '')
    .replace(/[\s\-–—:;,.(]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!nome || !/\p{L}/u.test(nome)) return null

  const trechoValor = texto.slice(corte)
  const mPct = trechoValor.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/)
  const percentual = mPct ? parsePercentualQar(mPct[0]) : null

  let valorPretendido: number | null = null
  if (idxValor >= 0) {
    const mVal = trechoValor.match(/R\$\s*[\d.,]+/)
    if (mVal) valorPretendido = parseValorQar(mVal[0])
  }
  if (valorPretendido === null && !mPct) {
    // Número solto com separador de milhar (ex.: "2.000.000" sem R$).
    // Com % declarado na linha, o % É o valor da cobertura — a milhar vinda
    // depois (coluna da tabela) nunca sobrescreve o % (regra do formulário).
    const mMilhar = trechoValor.match(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/)
    if (mMilhar) valorPretendido = parseValorQar(mMilhar[0])
  }

  const km = texto.match(/(\d+(?:[.,]\d+)?)\s*km/i)
  const detalheKm = km ? `${km[1]} km` : null

  const tipoValor: 'percentual' | 'fixo' = valorPretendido !== null ? 'fixo' : 'percentual'

  return { cobertura: nome, tipoValor, percentual, valorPretendido, detalheKm }
}

/** "Percurso estabelecimento-garagem" => true (caso Anália: 1 km). */
export function isCoberturaLmgConhecida(nome: string): boolean {
  const n = normalizarTermoEquivalenciaQar(nome)
  return QAR_LMGS_PADRAO.some((lmg) => normalizarTermoEquivalenciaQar(lmg) === n)
}

/**
 * Parse do item 21 do QAR a partir das linhas de texto do PDF
 * (extraído antes por extractTextFromPdf). Parser puro.
 */
export function parseQar21(linhas: string[]): QarResultado {
  const res: QarResultado = {
    lmgsMarcados: [],
    importanciaSeguradaPretendida: null,
    coberturas: [],
    sugestoesIgnoradas: [],
  }

  // IS pretendida: procurada no texto inteiro (cabeçalho antes do item 21)
  for (const linha of linhas) {
    if (res.importanciaSeguradaPretendida === null) {
      const n = normalizarTermoEquivalenciaQar(linha)
      if (n.includes('importancia segurada pretendida')) {
        const mR$ = linha.match(/R\$\s*[\d.,]+/)
        const mMilhar = linha.match(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/)
        if (mR$) {
          res.importanciaSeguradaPretendida = parseValorQar(mR$[0])
        } else if (mMilhar) {
          res.importanciaSeguradaPretendida = parseValorQar(mMilhar[0])
        }
      }
    }
  }

  // Localiza o item 21 e vai até o próximo item (22, 23...) ou fim
  const idxInicio = linhas.findIndex((l) => {
    const n = normalizarTermoEquivalenciaQar(l)
    return (
      /^21\s*[-.):–]/.test(n) ||
      /^item 21\b/.test(n) ||
      (/^21\b/.test(n) && (n.includes('cobertura') || n.includes('responsabilidade')))
    )
  })

  if (idxInicio < 0) return res

  let idxFim = linhas.length
  for (let i = idxInicio + 1; i < linhas.length; i++) {
    const n = normalizarTermoEquivalenciaQar(linhas[i])
    if (/^2[2-9]\s*[-.):–]/.test(n) || /^item 2[2-9]\b/.test(n)) {
      idxFim = i
      break
    }
  }

  for (let i = idxInicio + 1; i < idxFim; i++) {
    const texto = linhas[i].trim()
    if (!texto || texto.length < 4) continue
    if (/\bLMG\s*\d/i.test(texto)) continue // LMGs capturados à parte
    // Cabeçalhos/legendas do formulário nunca são coberturas
    const n = normalizarTermoEquivalenciaQar(texto)
    if (n.includes('marcar e informar')) continue
    if (n.includes('% da is') && n.includes('cobertura')) continue

    const parsed = parseQarLinhaCobertura(texto)
    if (!parsed) {
      // Sem % nem valor: se a linha tem nome de cobertura, é sugestão do formulário
      const nomeSugestao = texto
        .replace(/^[\s•\-–—*.:;]+/, '')
        .replace(/\s+[(]?\s*sugest[aã]o.*$/i, '')
        .trim()
      if (nomeSugestao && /\p{L}{3}/u.test(nomeSugestao) && nomeSugestao.length >= 3) {
        res.sugestoesIgnoradas.push(nomeSugestao)
      }
      continue
    }
    if (isCoberturaPropertyQar(parsed.cobertura)) continue // fora do leitor
    const lmgIdx = QAR_LMGS_PADRAO.findIndex(
      (lmg) =>
        normalizarTermoEquivalenciaQar(lmg) === normalizarTermoEquivalenciaQar(parsed.cobertura),
    )
    const cobertura: QarCoberturaDeclarada = {
      ...parsed,
      lmgMarcado: lmgIdx >= 0,
      lmgIndex: lmgIdx >= 0 ? lmgIdx + 1 : null,
      linhaOriginal: texto,
    }
    if (cobertura.lmgMarcado) res.lmgsMarcados.push(cobertura.cobertura)
    res.coberturas.push(cobertura)
  }

  return res
}
