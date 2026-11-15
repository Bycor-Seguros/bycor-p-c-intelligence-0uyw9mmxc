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

/** Chave normalizada da LINHA FANTASMA documentada (caso real Anália): o item
 * "RC Produtos e Trabalhos Concluídos" NÃO existe no formulário real do PDF —
 * nunca é criada a partir do bloco de opções (mesmo tratamento das espúrias
 * "Opção 1/2/3" e "Outros"). */
const CHAVE_LINHA_FANTASMA_QAR = 'rc produtos e trabalhos concluidos'

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

/** Remove marcação de checkbox (☒/☑/☐/✓/✔/×) e bullets do início da linha. */
function removerMarcacaoInicio(linha: string): string {
  return linha
    .replace(/^[\s•\-–—*.:;]*(?:[☒☑☐✓✔×✗✘]+\s*)+/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Chave de casamento de um nome de cobertura com os LMGs padrão: normaliza
 * (sem acentos, minúsculo), tira o prefixo "RC" que o PDF real nem sempre
 * imprime, e comprime separadores (espaço, hífen –/—/-, travessão, "e" de
 * ligação de título partido) — o PDF real quebra títulos em várias linhas e
 * troca o hífen simples por en-dash (ex.: "Percurso estabelecimento-garagem" /
 * "Percurso entre o estabelecimento e a garagem" / "RC Produtos e Trabalhos
 * Concluídos" partido em duas linhas).
 */
function chaveLmgPadrao(nome: string): string {
  return normalizarTermoEquivalenciaQar(nome)
    .replace(/^rc\b\s*/, '')
    .replace(/\b(hif|travessao)\b/g, '')
    .replace(/\s+/g, '')
}

/**
 * Índice do LMG padrão (0..3, -1 quando não é LMG padrão) para um nome de
 * cobertura. Casamento por chave comprimida (exato) com fallback por prefixo:
 * o título do PDF real pode vir partido em duas linhas (a 2ª linha traz o
 * restante do título — o nome só casa se COMEÇAR com o LMG padrão).
 */
function casarLmgPadrao(nome: string): number {
  const chave = chaveLmgPadrao(nome)
  if (!chave) return -1
  const exato = QAR_LMGS_PADRAO.findIndex((lmg) => chaveLmgPadrao(lmg) === chave)
  if (exato >= 0) return exato
  return QAR_LMGS_PADRAO.findIndex(
    (lmg) => chave.startsWith(chaveLmgPadrao(lmg)) && chave.length > chaveLmgPadrao(lmg).length,
  )
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
  const idxMilhar = texto.search(/\b\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?\b/)
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
    // Espaço interno no número (PDF real: "R$ 2 . 5 00.000,00") entra na
    // captura — parseNumeroPtBr remove os espaços e aplica a regra pt-BR de milhar.
    const mVal = trechoValor.match(/R\$\s*[\d.,\s]*\d[\d.,\s]*/)
    if (mVal) valorPretendido = parseValorQar(mVal[0])
  }
  if (valorPretendido === null && !mPct) {
    // Número solto com separador de milhar (ex.: "2.000.000" sem R$).
    // Com % declarado na linha, o % É o valor da cobertura — a milhar vinda
    // depois (coluna da tabela) nunca sobrescreve o % (regra do formulário).
    const mMilhar = trechoValor.match(/\b\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?\b/)
    if (mMilhar) valorPretendido = parseValorQar(mMilhar[0])
  }

  const km = texto.match(/(\d+(?:[.,]\d+)?)\s*km/i)
  const detalheKm = km ? `${km[1]} km` : null

  const tipoValor: 'percentual' | 'fixo' = valorPretendido !== null ? 'fixo' : 'percentual'

  return { cobertura: nome, tipoValor, percentual, valorPretendido, detalheKm }
}

/** "Percurso estabelecimento-garagem" => true (caso Anália: 1 km). */
export function isCoberturaLmgConhecida(nome: string): boolean {
  return casarLmgPadrao(nome) >= 0
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

  const opcoesLmg: Array<{ valor: number; marcada: boolean }> = []
  // Linhas já consumidas por uma junção de título partido (não reprocessar).
  const consumidos = new Set<number>()

  /** LMG padrão marcado só com checkbox (linha "RC ... ☒" sem % nem valor). */
  const parseLmgSoCheckbox = (textoLimpo: string): ReturnType<typeof parseQarLinhaCobertura> => {
    const nomeCb = textoLimpo
      .replace(/[\s]*[☒☑☐✓✔×✗✘][\s☒☑☐✓✔×✗✘]*$/u, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!nomeCb || casarLmgPadrao(nomeCb) < 0) return null
    return {
      cobertura: nomeCb,
      tipoValor: 'fixo' as const,
      percentual: null,
      valorPretendido: null,
      detalheKm: null,
    }
  }

  for (let i = idxInicio + 1; i < idxFim; i++) {
    if (consumidos.has(i)) continue
    const texto = linhas[i].trim()
    if (!texto || texto.length < 4) continue
    if (/\bLMG\s*\d/i.test(texto)) continue // LMGs capturados à parte
    // Cabeçalhos/legendas do formulário nunca são coberturas
    const n = normalizarTermoEquivalenciaQar(texto)
    if (n.includes('marcar e informar')) continue
    if (n.includes('% da is') && n.includes('cobertura')) continue

    // PDF real: a marcação ☒ vem colada no início da linha (ex.: "☒ Colisão ...")
    const textoLimpo = removerMarcacaoInicio(texto)

    // Bloco de opções de LMG/IS do formulário real (ex.: "☒ Opção 1 : R$ 2 .000.000,00"):
    // NUNCA são coberturas — definem a escala de opções. A MENOR opção MARCADA
    // vira a IS pretendida (regra do usuário; se a opção fechada não for a menor,
    // o analista corrige na edição) e o LMG adotado dos 4 LMGs padrão.
    if (/^(?:op[çc][ãa]o\s*\d+|outros)\s*[:-]/i.test(textoLimpo)) {
      const mVal = textoLimpo.match(/R\$\s*[\d.,\s]*\d[\d.,\s]*/)
      const valor = mVal ? parseValorQar(mVal[0]) : null
      if (valor !== null && valor > 0) {
        opcoesLmg.push({ valor, marcada: /[☒☑✓✔]/u.test(texto) })
      }
      continue
    }

    let parsed = parseQarLinhaCobertura(textoLimpo)
    // LMG padrão com a linha só da marcação (☒ no fim, sem % nem valor) é um
    // LMG pretendido informado — não sugestão do formulário.
    if (!parsed) parsed = parseLmgSoCheckbox(textoLimpo)
    // PDF real: o título da cobertura pode vir PARTIDO em duas linhas com o
    // %/valor na 2ª ou na 3ª (caso Anália: "Colisão de Veículos de Terceiros
    // Compreensiva – Incêndio, Roubo e" / "Colisão" / "R$ 2 .000.000,00") —
    // junta com a(s) linha(s) seguinte(s) até achar o valor; as linhas usadas
    // na junção ficam consumidas. LMG padrão inteiro e sugestões não se juntam.
    if (!parsed && !/sugest/i.test(textoLimpo) && casarLmgPadrao(textoLimpo) < 0) {
      for (let k = 1; k <= 2 && i + k < idxFim; k++) {
        const partes = [textoLimpo]
        for (let j = 1; j <= k; j++) partes.push(removerMarcacaoInicio(linhas[i + j].trim()))
        const juncao = removerMarcacaoInicio(partes.join(' '))
        const pJuncao = parseQarLinhaCobertura(juncao) || parseLmgSoCheckbox(juncao)
        if (pJuncao) {
          parsed = pJuncao
          for (let j = 1; j <= k; j++) consumidos.add(i + j)
          break
        }
      }
    }
    if (!parsed) {
      // Sem % nem valor: se a linha tem nome de cobertura, é sugestão do formulário
      const nomeSugestao = textoLimpo
        .replace(/^[\s•\-–—*.:;]+/, '')
        .replace(/\s+[(]?\s*sugest[aã]o.*$/i, '')
        .trim()
      if (nomeSugestao && /\p{L}{3}/u.test(nomeSugestao) && nomeSugestao.length >= 3) {
        res.sugestoesIgnoradas.push(nomeSugestao)
      }
      continue
    }
    if (isCoberturaPropertyQar(parsed.cobertura)) continue // fora do leitor
    const lmgIdx = casarLmgPadrao(parsed.cobertura)
    const cobertura: QarCoberturaDeclarada = {
      ...parsed,
      lmgMarcado: lmgIdx >= 0,
      lmgIndex: lmgIdx >= 0 ? lmgIdx + 1 : null,
      linhaOriginal: texto,
    }
    if (cobertura.lmgMarcado) res.lmgsMarcados.push(cobertura.cobertura)
    res.coberturas.push(cobertura)
  }

  // Resgate: coberturas conhecidas do formulário que o PDF real imprime FORA da
  // janela do item 21 (ex.: Colisão de Veículos; Alagamento/Inundação). Sem isso,
  // o caso Anália as perde — a janela do item 21 termina antes da seção delas.
  if (idxInicio >= 0) {
    for (let i = 0; i < linhas.length; i++) {
      if (i >= idxInicio && i < idxFim) continue
      const texto = linhas[i].trim()
      if (!texto || texto.length < 4) continue
      const textoLimpo = removerMarcacaoInicio(texto)
      const n = normalizarTermoEquivalenciaQar(textoLimpo)
      if (!/^(colisao|alagamento|portoes autom|poluicao subita|percurso)/.test(n)) continue
      if (isCoberturaPropertyQar(textoLimpo)) continue
      // PDF real: o título pode vir PARTIDO em duas linhas — a 2ª (com %/valor)
      // não caseia o prefixo sozinha; casa contra "início + 2ª linha" unidas.
      let textoCompleto = textoLimpo
      let parsed = parseQarLinhaCobertura(textoLimpo)
      if (!parsed && i + 1 < linhas.length) {
        const juncao = removerMarcacaoInicio(`${textoLimpo} ${linhas[i + 1].trim()}`)
        parsed = parseQarLinhaCobertura(juncao)
        if (parsed) textoCompleto = juncao
      }
      if (!parsed) continue
      const chave = normalizarTermoEquivalenciaQar(parsed.cobertura)
      if (res.coberturas.some((c) => normalizarTermoEquivalenciaQar(c.cobertura) === chave)) {
        continue
      }
      const lmgIdx = casarLmgPadrao(parsed.cobertura)
      res.coberturas.push({
        ...parsed,
        lmgMarcado: lmgIdx >= 0,
        lmgIndex: lmgIdx >= 0 ? lmgIdx + 1 : null,
        linhaOriginal: texto,
      })
      if (lmgIdx >= 0) res.lmgsMarcados.push(parsed.cobertura)
    }
  }

  // IS pretendida: MENOR opção MARCADA do bloco de opções (regra do usuário)
  let lmgAdotado: number | null = null
  if (opcoesLmg.length > 0) {
    const marcadas = opcoesLmg.filter((o) => o.marcada)
    const escolhidas = marcadas.length > 0 ? marcadas : opcoesLmg
    const menor = Math.min(...escolhidas.map((o) => o.valor))
    if (res.importanciaSeguradaPretendida === null) {
      res.importanciaSeguradaPretendida = menor
    }
    lmgAdotado = menor
  }

  // Bloco de opções presente => os 4 LMGs padrão saem MARCADOS da leitura
  // (lmg_marcado = true, lmgIndex 1..4): "marcado" significa LMG pretendido
  // INFORMADO, não checkbox do PDF — na leitura real do caso Anália os 4 LMGs
  // padrão gravam lmg_marcado=false e o eixo QAR × Apólice perde o LMG
  // declarado. LMG sem linha declarada no formulário recebe o LMG adotado (a
  // menor opção marcada) como valor.
  // Filtro de proteção: a linha fantasma "RC Produtos e Trabalhos Concluídos"
  // do caso Anália (LMG padrão criado pelo bloco de opções; o item real do
  // formulário não existe no PDF) NUNCA é criada quando ausente das linhas.
  // (A gravação em qarPersistencia também a filtra — guarda dupla.)

  if (lmgAdotado !== null) {
    QAR_LMGS_PADRAO.forEach((lmg, idx) => {
      const existente = res.coberturas.find((c) => casarLmgPadrao(c.cobertura) === idx)
      if (existente) {
        existente.lmgMarcado = true
        existente.lmgIndex = idx + 1
        // LMG padrão marcado só com checkbox (☒ sem % nem valor) adota o LMG
        // adotado (a MENOR opção marcada do bloco) — caso Anália: "RC Operações
        // (Estabelecimentos Comerciais/Industriais)" ficava com valor null.
        if (existente.valorPretendido === null) {
          existente.valorPretendido = lmgAdotado
          existente.tipoValor = 'fixo'
        }
        // Reetiqueta com o nome EXATO do LMG padrão: o dedupe do re-upload e o
        // cruzamento com a apólice casam por nome (caso real Anália:
        // "Síndico 100%" gravado como cobertura própria separada de
        // "RC Danos Morais" que também veio no PDF).
        existente.cobertura = lmg
        if (!res.lmgsMarcados.includes(existente.cobertura)) {
          res.lmgsMarcados.push(existente.cobertura)
        }
      } else {
        // Linha fantasma documentada: não existe no formulário real — nunca vira
        // cobertura nem entra nos LMGs marcados (mesmo destino de "Opção 1/2/3").
        if (normalizarTermoEquivalenciaQar(lmg) === CHAVE_LINHA_FANTASMA_QAR) return
        res.coberturas.push({
          cobertura: lmg,
          tipoValor: 'fixo',
          percentual: null,
          valorPretendido: lmgAdotado,
          detalheKm: null,
          lmgMarcado: true,
          lmgIndex: idx + 1,
          linhaOriginal: '',
        })
        res.lmgsMarcados.push(lmg)
      }
    })
  }

  return res
}
