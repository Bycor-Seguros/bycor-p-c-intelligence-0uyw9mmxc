/**
 * cgIngestaoReader — Leitor de Condições Gerais (CG) de seguradoras.
 *
 * EXTRAÇÃO PURA (sem interface, sem banco): dado o texto do PDF da CG
 * (páginas com fragmentos { str, y }), devolve a lista de itens candidatos —
 * coberturas e exclusões — com página de origem e slotY (mesmo padrão do
 * leitor de QAR).
 *
 * Mesmo desenho do qarReader.ts: parser/interface separados, tolerante a
 * variações de layout entre cias, calibrado no piloto AXA (RC Geral produto
 * secundário, LC produto secundário e Riscos Nomeados 296 págs). Nenhum texto
 * do documento real está embutido aqui: as heurísticas descrevem a ESTRUTURA
 * genérica das CGs (Sumário + seções COBERTURA/CLÁUSULA + RISCOS EXCLUÍDOS
 * com alíneas a), b), c)...), não o conteúdo.
 *
 * Heurísticas:
 *  - Candidatas a COBERTURA: seções "COBERTURA BÁSICA/ADICIONAL/ESPECIAL
 *    <nome>" (e "COBERTURA ADICIONAL RESPONSABILIDADE CIVIL <nome>"), entradas
 *    de Sumário que apontam para essas seções e "CONDIÇÕES ESPECIAIS PARA O
 *    SEGURO DE <nome>".
 *  - NÃO coberturas: cabeçalhos estruturais (Sumário, Apresentação,
 *    Disposições Gerais, glossário...) e CLÁUSULA PARTICULAR/ESPECÍFICA/DE
 *    EXCLUSÃO — cláusulas particulares em geral são extensão/exclusão/ajuste,
 *    nunca cobertura (salvo cláusula de cobertura explícita, ex. salvamento).
 *  - EXCLUSÕES: bloco "RISCOS EXCLUÍDOS"/"NÃO ESTÃO COBERTOS" dentro da seção
 *    de cobertura; cada alínea a), b)... é uma exclusão da seção.
 */

import type { PdfPageText } from './pdfTextExtractor'

export interface CgIngestaoExclusaoExtraida {
  texto: string
  pagina: number
  slotY: number
}

export interface CgIngestaoItemExtraido {
  tipoItem: 'cobertura' | 'exclusao'
  nomeExtraido: string
  secaoOrigem: string
  pagina: number
  slotY: number
  exclusoes: CgIngestaoExclusaoExtraida[]
}

export interface CgIngestaoLeitura {
  itens: CgIngestaoItemExtraido[]
  produtoVersaoDetectado: string
  processoSusepDetectado: string
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export function normalizarTituloCg(t: string): string {
  return (t || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Cauda numérica de índice de Sumário que escapou da detecção de pontilhado:
 * no FIM do título, um número solto ("... 23") ou sequência de números soltos
 * ligados por conectores curtos entre espaços ("... 9999 x 2"). Números que
 * fazem parte de nomes legítimos de cobertura não são tocados — a cauda precisa
 * TERMINAR em dígito (ex.: "Danos Elétricos 24h" preserva o "24h", que não é
 * índice) e os conectores são tokens isolados (x, ×, e, /), nunca letras de
 * palavra.
 */
const RE_CAUDA_INDICE_SUMARIO = /\s+\d[\d.,]*(?:\s+(?:x|×|e|\/)\s+\d[\d.,]*)+\s*$|\s+\d[\d.,]*\s*$/

/**
 * Chave de dedup de seções por título: igual a normalizarTituloCg, mas remove
 * a cauda numérica de índice de Sumário do FIM, para que a entrada de índice
 * que escapou do pontilhado ("COBERTURA ADICIONAL DANOS ELÉTRICOS 9999 x 2")
 * e a seção real ("COBERTURA ADICIONAL DANOS ELÉTRICOS") caiam na MESMA chave
 * e a última ocorrência (seção real) vença. NÃO altera o nome exibido ao
 * analista — usada apenas como chave de agrupamento.
 */
export function chaveDedupTituloCg(t: string): string {
  return normalizarTituloCg(t).replace(RE_CAUDA_INDICE_SUMARIO, '').trim()
}

// ---------------------------------------------------------------------------
// Classificação de título de seção
// ---------------------------------------------------------------------------

/** Cabeçalhos estruturais que nunca são coberturas. */
const RE_NAO_COBERTURA = new RegExp(
  [
    '^sumario',
    '^apresenta',
    '^estrutura das condi',
    '^disposi',
    '^glossario',
    '^condi[cç]ao contratual',
    '^avalia',
    '^informa',
    '^ouvidoria',
    '^tabela de prazo',
    '^anexo',
    '^nota ',
    '^registro susep',
  ].join('|'),
)

/** Cláusulas particulares/específicas/de exclusão em geral NÃO são coberturas. */
const RE_CLAUSULA_NAO_COBERTURA = /cl[aá]usula\s+(particular|espec[ií]fica|de exclus[aã]o)/i

/**
 * Exceção: cláusula ESPECÍFICA/ESPECIAL que É cobertura declarada
 * (ex.: coberturas de salvamento/contenção/custo de defesa).
 */
const RE_CLAUSULA_COBERTURA_EXPLICITA =
  /cobertura\s+(de\s+|adicional\s+de\s+)?(despesas|salvamento|conten)|custo\s+de\s+defesa/i

/** Subtítulos "COBERTURA BÁSICA" / "COBERTURAS ADICIONAIS" soltos (marcadores de bloco). */
const RE_MARCADOR_BLOCO =
  /^(cobertura(s)?\s+(basica|básica|adicional(is)?|especial)(is)?|cl[aá]usulas particulares|condi[cç][oõ]es (especiais|particulares))\s*$/i

/**
 * Guarda v0.0.211 — FRAGMENTOS DE FRASE nunca são título de seção. Casos reais
 * AXA Riscos Nomeados (pág. 28): linha de continuação do parágrafo 15.2
 * ("cobertura básica (Incêndio, ... Explosão de") e rabo da alínea "b"
 * ("Incêndio, Raio e Explosão – Perda de receita bruta.") passavam pelos
 * prefixos /^cobertura\s+basica/ e /^inc[êe]ndio/ e viravam cobertura espúria
 * na fila. Título de seção de CG é uma linha FECHADA, em caixa alta, sem
 * pontuação final de frase — as guardas abaixo descrevem o que um fragmento
 * TEM e um título NÃO TEM.
 */

/** Alínea de lista ("a)", "b)", "aa)") — corpo, nunca título de seção. */
const RE_FRAGMENTO_ALINEA = /^[a-z]{1,3}\s*[).]\s+/i

/** Verbo/frase de cláusula no meio da linha — título de seção não tem frase. */
const RE_FRAGMENTO_CLAUSULA =
  /\b(ser[aá]|serao|serão|dever[aá]|deve|poder[aá]|fica(?:r[aá])?|entendido|acordado|quando|caso|desde que|limites?\s+m[aá]xim)\b/i

/** Continuação de período: começa em minúscula ou parêntese aberto. */
const RE_FRAGMENTO_MINUSCULA = /^[a-z(]/i

/** Cauda de frase: termina em ponto final (fora de "S.A.", numerais etc.). */
const RE_CAUDA_FIM_DE_FRASE = /[a-zà-ú.]\.$|\.\)$/i

/**
 * A linha é um FRAGMENTO de frase (continuação de parágrafo, texto dentro de
 * cláusula numerada, rabo de alínea)? (função pura — testada na suíte golden)
 */
export function ehFragmentoFraseCg(titulo: string): boolean {
  const t = (titulo || '').trim()
  if (!t) return false
  if (RE_FRAGMENTO_ALINEA.test(t)) return true
  if (RE_CAUDA_FIM_DE_FRASE.test(t)) return true
  if (RE_FRAGMENTO_CLAUSULA.test(normalizarTituloCg(t))) return true
  // Minúscula inicial: só é fragmento se a linha não é um título em caixa alta
  // quebrado (título quebrado mantém caixa alta em todas as linhas).
  if (RE_FRAGMENTO_MINUSCULA.test(t) && t !== t.toUpperCase()) return true
  return false
}

/**
 * Guarda v0.0.212 — um título de seção de CG nunca deixa PARÊNTESE ABERTO:
 * se a linha tem mais "(" do que ")", é continuação truncada de frase (ex.:
 * "COBERTURA BÁSICA (INCÊNDIO, INCLUSIVE DECORRENTE DE TUMULTOS" — caixa alta
 * do parágrafo 15.2 do RN AXA, que escapava das guardas v0.0.211 porque não
 * tem minúscula inicial, ponto final, alínea nem verbo de cláusula). Títulos
 * legítimos com parênteses balanceados ("... (Sprinklers)", "... (Período
 * Indenitário = 12 Meses)") passam normalmente. Contagem simples, sem pilha:
 * mais "(" do que ")" no fim da linha é fragmento — determinístico.
 */
export function temPareneseAbertoCg(titulo: string): boolean {
  const t = (titulo || '').trim()
  if (!t) return false
  const abre = (t.match(/\(/g) || []).length
  const fecha = (t.match(/\)/g) || []).length
  return abre > fecha
}

/**
 * Título é uma seção de cobertura? (função pura — testada na suíte golden)
 */
export function tituloEhCobertura(titulo: string): boolean {
  const t = (titulo || '').trim()
  if (!t) return false
  if (t.length < 6) return false
  const norm = normalizarTituloCg(t)
  if (RE_NAO_COBERTURA.test(norm)) return false
  if (RE_MARCADOR_BLOCO.test(norm)) return false

  // v0.0.212: parêntese aberto sem fechar = continuação truncada de frase,
  // nunca título de seção (roda ANTES dos prefixos de cobertura, que só
  // recebem títulos legítimos — pacto anti-regressão).
  if (temPareneseAbertoCg(t)) return false

  // v0.0.211: fragmento de frase (continuação de cláusula 15.x, alínea a/b/c,
  // fim de período) nunca é título de seção — vale mesmo quando a frase usa
  // palavras de cobertura ("cobertura básica (Incêndio, ...)").
  if (ehFragmentoFraseCg(t)) return false

  // Cláusula particular/específica/de exclusão: regra geral é NÃO cobertura,
  // salvo cláusula de cobertura explícita (salvamento/contenção/defesa etc.)
  if (RE_CLAUSULA_NAO_COBERTURA.test(norm)) {
    return RE_CLAUSULA_COBERTURA_EXPLICITA.test(norm)
  }

  if (/^cobertura\s+(basica|adicional|especial)\b/i.test(norm)) return true
  if (/^cobertura\s+(de\s+|adicional\s+-\s+)/i.test(t)) return true
  // v0.0.218 Chubb: "CONDIÇÃO ESPECIAL/CONDIÇÃO PARTICULAR NN - ..." com nome
  // livre no resto da linha (a CG RN 96 da Chubb usa este formato em TODAS as
  // coberturas: "CONDIÇÃO ESPECIAL 21 - CONDIÇÕES ESPECIAIS PARA O SEGURO DE
  // RECOMPOSIÇÃO DE REGISTROS...", "COBERTURA ADICIONAL - LUCRO BRUTO",
  // "CONDIÇÃO PARTICULAR 06 - CLÁUSULA ESPECIAL DE..."). O nome vem depois do
  // traço — pode ser OU NÃO o padrão "para o seguro de" já coberto acima.
  // Cláusula PARTICULAR: cauda "COBERTURA ..." depois do traço É cobertura
  // (ex. "CONDIÇÃO PARTICULAR 02 - COBERTURA ADICIONAL - ..."); qualquer outra
  // cauda ("CLÁUSULA ESPECIAL DE ...") só é cobertura se declarar cobertura
  // explícita (salvamento/contenção/defesa) — regra geral intacta.
  const mParticular = t.match(/^condi[cç][aã]o\s+particular\s*\d+\s*-\s*(.+)$/i)
  if (mParticular) {
    if (/^cobertura\b/i.test(mParticular[1])) return true
    return RE_CLAUSULA_COBERTURA_EXPLICITA.test(norm)
  }
  if (/^condi[cç][aã]o\s+(especial)\s*\d+\s*-\s*\S/i.test(t)) return true
  if (/^cobertura\s+adicional\s*-\s*\S/i.test(t)) return true
  if (/condi[cç][oõ]es especiais para o seguro de /i.test(norm)) return true
  if (/^responsabilidade civil\b/i.test(norm)) return true
  if (/^lucros cessantes/i.test(norm)) return true
  if (/^perda de receita bruta/i.test(norm)) return true
  if (/^interrup[cç][aã]o de produ[cç][aã]o/i.test(norm)) return true
  if (/^despesas fixas/i.test(norm)) return true
  if (/^inc[êe]ndio/i.test(norm)) return true
  if (/^roubo/i.test(norm)) return true
  if (/^benfeitorias/i.test(norm)) return true
  if (/^danos el/i.test(norm)) return true
  if (/^vendaval/i.test(norm)) return true
  if (/^quebra de m/i.test(norm)) return true
  return false
}

// ---------------------------------------------------------------------------
// Extração de exclusões de um bloco de corpo (função pura — testada na golden)
// ---------------------------------------------------------------------------

// Exportado para a suíte golden (seção 9 — formato Chubb): a asserção trava
// que a linha 1 do cabeçalho quebrado abre o bloco de exclusões.
export const RE_INICIO_EXCLUSOES =
  /^(?:\d+(?:\.\d+)*[.)]?\s*)?(riscos?\s+exclu[íi]dos|exclus[õo]es|exclus[ãa]o|riscos?\s+n[ãa]o\s+cobertos|n[ãa]o\s+est[ãa]o\s+cobertos|bens\s+n[ãa]o\s+cobertos|bens\s+e\s+locais\s+n[ãa]o\s+cobertos)/i

// Alíneas a), b), ..., z), aa), bb), aaa) — CGs usam letras repetidas quando a
// lista passa de "z". Hífen não entra aqui: classe de caractere com hífen deve
// tê-lo PRIMEIRO ([^-–]) para não virar range inválido.
const RE_ALINEA = /^\s*([a-z]{1,3})\s*[).]\s*(.+)$/i

/**
 * Cabeçalho de seção numerado de CG (ex.: "1.3 LIMITE DE INDENIZAÇÃO",
 * "2.10.1 CONDIÇÕES GERAIS"): número de cláusula/seção + título em caixa alta.
 * NUNCA é exclusão — marca o fim do bloco "RISCOS EXCLUÍDOS". Linhas de corpo
 * que começam com número mas têm texto em minúsculas (ex.: "3 veículos ...")
 * não são cabeçalho e não encerram o bloco.
 */
const RE_CABECALHO_SECAO_NUMERADO = /^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/

function ehCabecalhoSecaoNumerado(t: string): boolean {
  const m = t.match(RE_CABECALHO_SECAO_NUMERADO)
  if (!m) return false
  const resto = m[2].trim()
  if (resto.length < 4) return false
  if (resto !== resto.toUpperCase()) return false
  // exige ao menos uma letra no título (descarta "1.2 10/2018" etc.)
  return /[A-ZÁÉÍÓÚÂÊÔÃÕÇÜ]/.test(resto)
}

/**
 * Guarda Chubb (v0.0.218) — o cabeçalho da seção de exclusões pode vir
 * QUEBRADO em duas linhas pelo pdf.js: "2. RISCOS EXCLUIDOS / PREJUÍZOS NÃO
 * INDENIZÁVEIS / BENS NÃO" + "COMPREENDIDOS NO SEGURO:". A 2ª linha é caixa
 * alta e, sem guarda, fechava o bloco antes da primeira alínea (sessões
 * Chubb gravavam total_exclusoes: 0). É continuação de cabeçalho a linha em
 * caixa alta que repete o vocabulário do cabeçalho E tem formato de título
 * quebrado (termina em ":" ou contém "/" separando as três partes). Subtítulos
 * de fechamento ("LIMITE DE INDENIZAÇÃO", "RATIFICAÇÃO") NÃO repetem esse
 * vocabulário e continuam fechando o bloco — formato AXA intacto.
 * "EXCLUIDOS" sem acento, " / " com espaços e numeração "2." já casam em
 * RE_INICIO_EXCLUSOES — a quebra de linha era a variação faltante.
 */
// Exportada para a suíte golden (seção 9 — formato Chubb): a asserção trava
// que a linha 2 ("BENS NÃO COMPREENDIDOS NO SEGURO:") casa como continuação.
export function ehContinuacaoCabecalhoExclusoes(t: string): boolean {
  const norm = normalizarTituloCg(t)
  if (!norm) return false
  if (/compreendid/.test(norm)) return true // "BENS NÃO COMPREENDIDOS NO SEGURO:"
  if (!/(prejuiz|indenizav|exclu)/.test(norm)) return false
  return t.includes('/') || t.endsWith(':')
}

/**
 * Dado o corpo (linhas com posição) de UMA seção de cobertura, extrai as
 * exclusões: a partir do subtítulo "RISCOS EXCLUÍDOS" até o próximo subtítulo
 * em caixa alta (com ou sem numeração de cláusula). Cada alínea a), b),
 * aa)... vira uma exclusão; linhas de texto corrido fora do bloco nunca são
 * capturadas.
 */
export function extrairExclusoesDoBloco(
  corpoLinhas: Array<{ texto: string; pagina: number; slotY: number }>,
): CgIngestaoExclusaoExtraida[] {
  const exclusoes: CgIngestaoExclusaoExtraida[] = []
  let dentroExclusoes = false
  // Guarda Chubb: só consome continuação de cabeçalho ANTES da 1ª alínea —
  // depois que a lista começou, linha caixa alta é subtítulo e fecha o bloco.
  let exclusoesDesdeAbertura = 0

  for (const linha of corpoLinhas) {
    const t = (linha.texto || '').trim()
    if (!t) continue

    if (!dentroExclusoes) {
      if (RE_INICIO_EXCLUSOES.test(t)) {
        dentroExclusoes = true
        exclusoesDesdeAbertura = 0
      }
      continue
    }

    // fim da lista de exclusões: novo subtítulo em caixa alta (com ou sem
    // numeração de cláusula, ex. "1.3 LIMITE DE INDENIZAÇÃO")
    const ehAlinea = RE_ALINEA.test(t)
    const iniciaPalavra = /^[A-Za-zÁÉÍÓÚÂÊÔÃÕÇ]/.test(t)
    if (!ehAlinea) {
      if (RE_INICIO_EXCLUSOES.test(t)) continue // "NÃO ESTÃO COBERTOS:" repetido/renumerado
      if (
        iniciaPalavra &&
        t === t.toUpperCase() &&
        t.length > 3 &&
        !ehCabecalhoSecaoNumerado(t) &&
        exclusoesDesdeAbertura === 0 &&
        ehContinuacaoCabecalhoExclusoes(t)
      ) {
        // linha 2+ do cabeçalho de exclusões quebrado — NÃO fecha o bloco
        continue
      }
      if ((iniciaPalavra && t === t.toUpperCase() && t.length > 3) || ehCabecalhoSecaoNumerado(t)) {
        dentroExclusoes = false
        continue
      }
    }

    const mAlinea = t.match(RE_ALINEA)
    const textoAlinea = (mAlinea ? mAlinea[2] : t).trim()
    if (textoAlinea.length < 8) continue
    exclusoes.push({ texto: textoAlinea, pagina: linha.pagina, slotY: linha.slotY })
    exclusoesDesdeAbertura += 1
  }

  return exclusoes
}

// ---------------------------------------------------------------------------
// Leitura completa (Sumário + seções)
// ---------------------------------------------------------------------------

function limparLinhaSumario(linha: string): string {
  return (
    (linha || '')
      // pontilhado em qualquer formato vira um espaço: pontos corridos,
      // pontos espaçados (". . . ."), elipses U+2026 e pontos médios
      .replace(/(?:[.·]\s*){2,}|…+/g, ' ')
      .replace(/\s*\.{0,2}\s*\d+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Linha de Sumário (índice): título + pontilhado + número de página no fim da
 * linha. O pdf.js entrega o pontilhado de várias formas — todas devem casar:
 *  - "TÍTULO........... 23" (pontos corridos, com ou sem espaço antes do nº);
 *  - "TÍTULO . . . . 23" (pontos espaçados);
 *  - "TÍTULO…… 23" / "TÍTULO … 23" (elipses U+2026);
 *  - fragmento separado: pontilhado + nº SOZINHOS na linha seguinte
 *    ("............ 23" ou ". .......... 29").
 * Requisito mínimo: pontilhado (2+ pontos, mesmo espaçados, ou U+2026)
 * seguido de número de 1-3 dígitos no fim da linha.
 */
export function ehLinhaSumario(linha: string): boolean {
  const t = (linha || '').trim()
  if (!t) return false
  // fragmento separado: a linha é só pontilhado (+ nº de página)
  if (/^(?:[.·]\s*){2,}[…]*\s*\d{1,3}\s*$/.test(t)) return true
  if (/^[.·]?\s*…+\s*\d{1,3}\s*$/.test(t)) return true
  // "título pontilhado número" na mesma linha
  const semNumero = t.replace(/\s*\d{1,3}\s*$/, '')
  if (semNumero === t || !semNumero.trim()) return false
  const resto = semNumero.trim()
  if (/(?:[.·]\s*){2,}/.test(resto)) return true
  return resto.includes('…')
}

/**
 * Marca quais linhas da página pertencem a entradas de Sumário, incluindo as
 * partes de entradas quebradas em várias linhas: uma linha de pontilhado+nº
 * marca também as linhas CAIXA ALTA imediatamente anteriores (título quebrado
 * em duas linhas ou título separado do pontilhado por quebra do pdf.js).
 * Assim "TÍTULO" na linha i + "..... 23" na linha i+1 não gera seção fantasma.
 */
function marcarLinhasSumario(linhas: Array<{ texto: string }>): boolean[] {
  const flags = new Array<boolean>(linhas.length).fill(false)
  for (let i = 0; i < linhas.length; i++) {
    if (!ehLinhaSumario(linhas[i].texto)) continue
    flags[i] = true
    for (let j = i - 1; j >= 0 && !flags[j]; j--) {
      const prev = limparLinhaSumario(linhas[j].texto)
      if (!prev || prev.length < 4) break
      if (prev !== prev.toUpperCase()) break
      if (ehInicioSubtitulo(prev)) break
      flags[j] = true
    }
  }
  return flags
}

/**
 * Processo SUSEP — dois formatos, ambos ancorados no rótulo "Processo SUSEP"
 * (até 30 caracteres não numéricos de intervalo) para nunca casar telefone,
 * CNPJ ou data soltos:
 *  - padrão SUSEP com barra: 15414.900340/2018-85 (5 dígitos, ponto, 3-6
 *    dígitos, /, ano de 4, -, dígito verificador de 1-2);
 *  - formato sem barra da AXA: 15414.9020252014-69 (5 dígitos, ponto, até 10
 *    dígitos, hífen, 2 dígitos). Sem barra, exige hífen + 2 dígitos no fim
 *    como âncora — a alternância com barra vem primeiro e não retrocede para
 *    dentro de números com "/".
 *
 * Tolerância a fragmentação do pdf.js: o extrator de texto reconstrói linhas
 * juntando fragmentos com espaço — o cabeçalho da CG de LC da AXA chega como
 * "Processo SUSEP nº: 15414.902020/2014-36 – Versão 2 / 2018" com ESPAÇO em
 * volta do hífen do DV ("2014- 36") e em volta da barra ("/ 2018"). A classe
 * [\s\/.-]* engole esses separadores fantasma no interior do número; o
 * normalizador devolve o número na forma canônica com barra e hífen.
 */
const RE_PROCESSO_SUSEP =
  /processo\s+susep[^0-9]{0,30}(\d{2,5}\s*[./.-]*\s*\d{3,6}\s*[./.-]*\s*\/\s*\d{4}\s*[./.-]*\s*-\s*\d{1,2}|\d{5}\s*[./.-]*\s*\d{1,10}\s*[./.-]*\s*-\s*\d{2})/i

/**
 * Normaliza o número detectado para a forma canônica: remove espaços que o
 * pdf.js insere na reconstrução da linha e colapsa o caso "2014 - 36" →
 * "2014-36" e "902020 / 2014" → "902020/2014".
 */
function normalizarNumeroProcessoSusep(bruto: string): string {
  return (bruto || '').replace(/\s+/g, '')
}

export function detectarProcessoSusepCg(textoGlobal: string): string {
  const m = textoGlobal.match(RE_PROCESSO_SUSEP)
  return m ? normalizarNumeroProcessoSusep(m[1]) : ''
}

/**
 * Fallback de detecção pelo NOME do arquivo. Casos conhecidos:
 *  - "CG_..._15414.9020252014-69_20251210.pdf" (formato sem barra da AXA);
 *  - "CG_AXA_LC Secundário RN 15414.902020 2014-36 - cópia.pdf" — a barra da
 *    cópia aparece como ESPAÇO no nome do arquivo, com hífen do DV preservado.
 *
 * Estratégia: captura o CANDIDATO bruto (dígito+ponto+até 10 dígitos, hífen e
 * 2 dígitos finais, tolerando espaço no lugar da barra) e normaliza depois
 * retirando os espaços: "15414.902020 2014-36" → "15414.9020202014-36" →
 * com barra em "2014-36" → "15414.902020/2014-36". Sem barra, o hífen + 2
 * dígitos no fim é âncora obrigatória — nunca recorta parte de CNPJ/telefone.
 */
export function detectarProcessoSusepNomeArquivo(nomeArquivo: string): string {
  const m = (nomeArquivo || '').match(/(^|[^0-9])(\d{5}\.[\d\s]{3,12}-\s?\d{2})([^0-9]|$)/)
  if (!m) return ''
  let numero = m[2].replace(/\s+/g, '')
  // Barra faltante (espaço no nome do arquivo): insere antes do ano + DV.
  const mSemBarra = numero.match(/^(\d{5}\.\d{1,10})(\d{4}-\d{2})$/)
  if (mSemBarra) numero = `${mSemBarra[1]}/${mSemBarra[2]}`
  return numero
}

/**
 * Produto/versão — a CG de LC da AXA traz "Versão 12/2025" SÓ na capa (p. 1)
 * e "Versão 2 / 2018" repetido no corpo; a versão correta do produto é a que
 * se REPETE no corpo. Regra: agrupa todas as ocorrências (tolerando espaços
 * em volta da barra que o pdf.js insere) e devolve a MAIS FREQUENTE — empatou,
 * vale a última (corpo vem depois da capa). Se só a capa traz versão, cai para
 * a primeira ocorrência (comportamento anterior preservado).
 */
export function detectarProdutoVersaoCg(textoGlobal: string): string {
  const texto = textoGlobal || ''
  const mMes = texto.match(/processo\s+susep[^-–\n]{0,60}[-–]\s*(\d{2}\s*\/\s*\d{4})/i)

  const ocorrencias = [...texto.matchAll(/vers[aã]o\s*:?\s*(\d{1,3})\s*\/\s*(\d{4})/gi)]
  if (ocorrencias.length > 0) {
    // Frequência por chave normalizada "n/aaaa" (espaços da barra ignorados).
    const freq = new Map<string, { versao: string; n: number; ultima: { v: string; i: number } }>()
    ocorrencias.forEach((m, i) => {
      const chave = `${m[1]}/${m[2]}`
      const atual = freq.get(chave)
      if (atual) {
        atual.n += 1
        atual.ultima = { v: chave, i }
      } else {
        freq.set(chave, { versao: chave, n: 1, ultima: { v: chave, i } })
      }
    })
    let melhor: { v: string; n: number; i: number } | null = null
    for (const f of freq.values()) {
      if (!melhor || f.n > melhor.n || (f.n === melhor.n && f.ultima.i > melhor.i)) {
        melhor = { v: f.versao, n: f.n, i: f.ultima.i }
      }
    }
    if (melhor) return `Versão ${melhor.v}`
  }
  if (mMes) return mMes[1]?.replace(/\s+/g, '') ?? ''
  return ''
}

/** Reconstrói linhas com slotY a partir dos fragmentos posicionados da página. */
function linhasComSlotY(page: PdfPageText): Array<{ texto: string; slotY: number }> {
  const frags = (page.items || []).map((f) => ({ texto: f.str || '', y: f.y ?? 0 }))
  const linhas: Array<{ texto: string; slotY: number }> = []
  if (frags.length === 0) {
    for (const l of page.lines || []) linhas.push({ texto: l, slotY: 0 })
    return linhas
  }
  let atual: string[] = []
  let yAtual: number | null = null
  for (const f of frags) {
    if (yAtual === null || Math.abs(f.y - yAtual) <= 2.5) {
      atual.push(f.texto)
      if (yAtual === null) yAtual = f.y
    } else {
      linhas.push({ texto: atual.join(' ').replace(/\s+/g, ' ').trim(), slotY: yAtual })
      atual = [f.texto]
      yAtual = f.y
    }
  }
  if (atual.length > 0) {
    linhas.push({ texto: atual.join(' ').replace(/\s+/g, ' ').trim(), slotY: yAtual })
  }
  return linhas.filter((l) => l.texto)
}

interface SecaoCobertura {
  nome: string
  pagina: number
  slotY: number
  /**
   * Índice da ÚLTIMA linha do título desta seção NA PRÓPRIA página — o título
   * pode quebrar em 2-3 linhas (ex.: Chubb "CONDIÇÃO ESPECIAL 21 - ..." +
   * "RECOMPOSIÇÃO DE REGISTROS E DOCUMENTOS"). A 2ª passada pula as linhas
   * até aqui antes do teste de próxima seção; sem isso, a 1ª linha do
   * próprio título quebrado casava o prefixo de cobertura e CORTAVA o corpo
   * da própria seção (exclusões nunca eram vinculadas — caso Chubb).
   */
  ateLinhaTitulo: number
  corpo: Array<{ texto: string; pagina: number; slotY: number }>
}

/** Indica se a linha inicia um novo subtítulo estrutural (ex.: "1.1 RISCOS COBERTOS"). */
function ehInicioSubtitulo(linha: string): boolean {
  return /^\d+(\.\d+)*[.)]?\s+[A-ZÁÉÍÓÚ]/.test(linha) || /^RISCOS COBERTOS/i.test(linha)
}

/**
 * Lê o texto página a página da CG e devolve itens candidatos.
 * pages: saída do extractTextFromPdf (linhas + fragmentos posicionados).
 */
export function lerCondicoesGerais(pages: PdfPageText[]): CgIngestaoLeitura {
  const textoGlobal = pages.map((p) => p.text).join('\n')
  const processoSusep = detectarProcessoSusepCg(textoGlobal)
  const produtoVersao = detectarProdutoVersaoCg(textoGlobal)

  const linhasPorPagina = new Map<number, Array<{ texto: string; slotY: number }>>()
  for (const page of pages) linhasPorPagina.set(page.pageNumber, linhasComSlotY(page))
  const sumarioFlagsPorPagina = new Map<number, boolean[]>()
  for (const page of pages) {
    sumarioFlagsPorPagina.set(
      page.pageNumber,
      marcarLinhasSumario(linhasPorPagina.get(page.pageNumber) || []),
    )
  }

  // 1ª passada: ocorrências de título de cobertura (título pode quebrar em
  // 2-3 linhas caixa alta). Linhas de Sumário — pontilhado em QUALQUER formato
  // — são ignoradas. Guarda TODAS as ocorrências: no fim, a ÚLTIMA ocorrência
  // de cada título vence, porque a seção real nunca vem antes do Sumário.
  const ocorrencias: Array<{
    nome: string
    pagina: number
    slotY: number
    ordem: number
    ateLinhaTitulo: number
  }> = []
  let ordem = 0

  for (const page of pages) {
    const linhas = linhasPorPagina.get(page.pageNumber) || []
    const flags = sumarioFlagsPorPagina.get(page.pageNumber) || []
    for (let i = 0; i < linhas.length; i++) {
      if (flags[i]) continue
      const bruto = limparLinhaSumario(linhas[i].texto)
      if (!bruto || !tituloEhCobertura(bruto)) continue

      const linhasTitulo = [bruto]
      let j = i + 1
      while (j < linhas.length && linhasTitulo.length < 3) {
        if (flags[j]) break
        const prox = limparLinhaSumario(linhas[j].texto)
        if (prox && prox === prox.toUpperCase() && !ehInicioSubtitulo(prox)) {
          linhasTitulo.push(prox)
          j++
        } else break
      }
      ocorrencias.push({
        nome: linhasTitulo.join(' ').replace(/\s+/g, ' ').trim(),
        pagina: page.pageNumber,
        slotY: linhas[i].slotY,
        ordem: ordem++,
        // título quebrado: a última linha consumida pelo join é parte do
        // TÍTULO, não do corpo — a 2ª passada pula até aqui (v0.0.218 Chubb).
        ateLinhaTitulo: j - 1,
      })
      i = j - 1
    }
  }

  // Dedupe por título normalizado mantendo a ÚLTIMA ocorrência (cinto de
  // segurança: se o pontilhado do Sumário escapou da marcação, a entrada de
  // índice nunca vence a seção real do corpo), preservando a ordem do documento.
  const ultimaPorChave = new Map<
    string,
    { nome: string; pagina: number; slotY: number; ordem: number; ateLinhaTitulo: number }
  >()
  for (const o of ocorrencias) ultimaPorChave.set(chaveDedupTituloCg(o.nome), o)
  const secoes: SecaoCobertura[] = [...ultimaPorChave.values()]
    .sort((a, b) => a.ordem - b.ordem)
    .map((o) => ({
      nome: o.nome,
      pagina: o.pagina,
      slotY: o.slotY,
      ateLinhaTitulo: o.ateLinhaTitulo,
      corpo: [],
    }))

  // 2ª passada: corpo de cada seção (até a próxima seção) e exclusões
  const itens: CgIngestaoItemExtraido[] = []
  for (let s = 0; s < secoes.length; s++) {
    const secao = secoes[s]
    const fimPag =
      s + 1 < secoes.length ? secoes[s + 1].pagina : (pages[pages.length - 1]?.pageNumber || 1) + 1
    for (const page of pages) {
      if (page.pageNumber < secao.pagina || page.pageNumber > fimPag) continue
      const linhas = linhasPorPagina.get(page.pageNumber) || []
      const flags = sumarioFlagsPorPagina.get(page.pageNumber) || []
      for (let idx = 0; idx < linhas.length; idx++) {
        if (flags[idx]) continue // linha de Sumário não entra no corpo
        const linha = linhas[idx]
        const limpo = limparLinhaSumario(linha.texto)
        if (!limpo) continue
        if (page.pageNumber === secao.pagina && idx <= secao.ateLinhaTitulo) continue
        if (tituloEhCobertura(limpo)) {
          // próxima seção começa no meio desta página: corta o corpo aqui
          break
        }
        secao.corpo.push({ texto: limpo, pagina: page.pageNumber, slotY: linha.slotY })
      }
    }
    const exclusoes = extrairExclusoesDoBloco(secao.corpo)
    itens.push({
      tipoItem: 'cobertura',
      nomeExtraido: secao.nome,
      secaoOrigem: secao.nome,
      pagina: secao.pagina,
      slotY: secao.slotY,
      exclusoes,
    })
  }

  return {
    itens,
    produtoVersaoDetectado: produtoVersao,
    processoSusepDetectado: processoSusep,
  }
}

// ---------------------------------------------------------------------------
// Guarda de re-ingestão (mesma semântica do dedupe de cobertura do QAR)
// ---------------------------------------------------------------------------

/** Chave de guarda: nome da cobertura normalizado (a cia entra no filtro da query). */
export function chaveGuardaCg(nomeCobertura: string): string {
  return normalizarTituloCg(nomeCobertura)
}

/**
 * Casamento da guarda: igual ou tolerante a SUFIXO (chave antiga que estende a
 * nova casa — leitura anterior truncada/estendida). Lixo de PREFIXO nunca casa.
 */
export function guardasIguaisCg(a: string, b: string): boolean {
  const na = normalizarTituloCg(a)
  const nb = normalizarTituloCg(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return na.startsWith(nb) || nb.startsWith(na)
}
