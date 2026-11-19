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
 *    de Sumário que apontam essas seções e "CONDIÇÕES ESPECIAIS PARA O
 *    SEGURO DE <nome>".
 *  - Assinatura estrutural Zurich (v0.0.227): título de cobertura em CAIXA
 *    MISTA sem prefixo ("Danos ao Cais", "Erros e Omissões"), ancorado na
 *    linha seguinte "1. Riscos Cobertos" — as exclusões variam entre "2." e
 *    "3. Riscos Excluídos", por isso a numeração dos blocos seguintes NÃO é
 *    âncora. Quebra de página: o título pode nascer no FIM de uma página com
 *    a âncora "1. Riscos Cobertos" na PRIMEIRA linha da página seguinte — a
 *    assinatura também é avaliada nessa atravessada. Cláusulas ("1. Fica
 *    entendido…") e linhas de Sumário pontilhadas são guardadas; a guarda de
 *    fragmento usa só o núcleo INSENSÍVEL à caixa (a regra de minúscula
 *    inicial rejeitaria todo título caixa mista).
 *  - NÃO coberturas: cabeçalhos estruturais (Sumário, Apresentação,
 *    Disposições Gerais, glossário...) e CLÁUSULA PARTICULAR/ESPECÍFICA/DE
 *    EXCLUSÃO — cláusulas particulares em geral são extensão/exclusão/ajuste,
 *    nunca cobertura (salvo cláusula de cobertura explícita, ex. salvamento,
 *    e a extensão de garantia do formato Tokio).
 *  - EXCLUSÕES: bloco "RISCOS EXCLUÍDOS"/"NÃO ESTÃO COBERTOS" dentro da seção
 *    de cobertura; cada alínea a), b)... é uma exclusão da seção.
 */

import type { PdfPageText } from './pdfTextExtractor'

// ---------------------------------------------------------------------------
// Guarda de PDF sem camada de texto (escaneado) — v0.0.223
// ---------------------------------------------------------------------------

/** Mensagem de erro para PDF escaneado — exibida ao analista no modal de ingestão. */
export const MSG_PDF_SEM_TEXTO_CG =
  'Este PDF parece ser escaneado: só contém imagens, sem texto selecionável (a extração das ' +
  '{{PAGINAS}} página(s) retornou praticamente nenhum caractere). O leitor de CGs não consegue ' +
  'ler um documento assim. Obtenha a versão da CG com camada de texto — as condições gerais com ' +
  'texto estão disponíveis no portal de cadastro de produtos da SUSEP — e tente novamente.'

/**
 * Limiar de caracteres por página abaixo do qual o documento é considerado
 * escaneado. Um PDF de CG com texto tem dezenas/milhares de caracteres por
 * página; um escaneado tem 0 (a extração devolve as páginas em branco).
 * A média absorve páginas de capa/contracapa quase vazias de CGs legítimas.
 */
const CARACTERES_POR_PAGINA_MINIMO = 20

export interface DeteccaoPdfSemTextoResultado {
  semTexto: boolean
  caracteres: number
  paginas: number
  mediaPorPagina: number
}

/**
 * Detecta documento escaneado: a extração de texto rodou sobre TODAS as
 * páginas e o total de caracteres é praticamente zero (média <
 * CARACTERES_POR_PAGINA_MINIMO). Função pura — testada na suíte golden
 * (seção 11). Não confunde com CG legítima: 19 páginas em branco (caso
 * Zurich "CG RN LC") têm 0 caracteres; uma CG real tem milhares.
 */
export function detectarPdfSemTextoCg(pages: PdfPageText[]): DeteccaoPdfSemTextoResultado {
  const paginas = pages.length
  const caracteres = pages.reduce((acc, p) => acc + (p.text || '').trim().length, 0)
  const mediaPorPagina = paginas > 0 ? caracteres / paginas : 0
  return {
    semTexto: paginas > 0 && mediaPorPagina < CARACTERES_POR_PAGINA_MINIMO,
    caracteres,
    paginas,
    mediaPorPagina,
  }
}

/** Mensagem final com o número de páginas preenchido (o modal a exibe). */
export function mensagemPdfSemTextoCg(paginas: number): string {
  return MSG_PDF_SEM_TEXTO_CG.replace('{{PAGINAS}}', String(paginas || 0))
}

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

/**
 * Exceção v0.0.223 (Tokio) — "CLÁUSULA PARTICULAR DE EXTENSÃO DE COBERTURA/
 * GARANTIA ..." É extensão real de garantia: o formato Tokio usa dezenas
 * dessas seções como coberturas extensivas (Sumário, várias páginas).
 */
const RE_CLAUSULA_PARTICULAR_EXTENSAO =
  /cl[aá]usula\s+particular\s+de\s+extens[aã]o\s+de\s+(cobertura|garantia)/i

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
 * Guarda v0.0.222 (Tokio) — cauda de PERÍODO ABERTO: título de seção de CG
 * NUNCA termina em ";", "," ou "…" — pontuação que LIGA a linha ao que vem
 * depois, sinais de continuação de período do corpo de cláusulas. Fragmentos
 * em CAIXA ALTA que escapavam das guardas acima (sem minúscula, sem verbo,
 * sem ponto final) — o rabo em caixa alta do parágrafo DPVAT/RC Facultativa
 * ("... EM BENEFÍCIO DOS PROPRIETÁRIOS DOS CITADOS VEÍCULOS, INCLUSIVE...;")
 * passava pelo prefixo /^responsabilidade civil\b/ e virava cobertura
 * espúria. "..." no fim (linha pdf.js truncada) também é cauda aberta.
 */
const RE_CAUDA_PERIODO_ABERTO = /[;,…]$|,\s*$/

/**
 * Guarda v0.0.222 (Tokio) — MEIO de frase em caixa alta: título de seção não
 * contém conectores de frase do corpo (" este último,", " e jamais ", " e, ",
 * " aplicando-se", ", segue ...") nem abre com vírgula (linha que começa após
 * quebra de fragmento). Determinístico, sem listas de palavras da cia.
 */
const RE_MEIO_FRASE_CAIXA_ALTA =
  /,\s+este\s|,\s+o\s+qual|,\s+a\s+qual|\be\s+jamais\b|\baplicando-se\b|\be,\s|,\s+segue\b/i

/**
 * Guarda v0.0.228 (Zurich) — cláusula específica "Cláusula para ..." (ex.:
 * "Cláusula para Imóveis Tombados pelo Patrimônio Histórico", pág. 137 do
 * formato real): NÃO é cobertura — é ajuste particular de cálculo, seguido do
 * bloco "1. Riscos Cobertos" da PRÓPRIA cláusula. O título de cobertura Zurich
 * real nunca começa com "Cláusula para". Cobre também a família "Cláusula
 * de ..." / "Cláusulas ..." (particulares/exclusões/agrupadores), já guardada
 * desde a v0.0.226 — o \b depois do "s" preserva o plural ("Cláusulas
 * Particulares", "Cláusulas de Coberturas Adicionais") e o singular ("Cláusula
 * de 1º Risco Absoluto", "Cláusula de Exclusão de Asbestos – WEH").
 */
const RE_CLAUSULA_PARA_ZURICH = /^cl[aá]usulas?\s+para\b/i

/**
 * Guarda v0.0.229 (Zurich) — fecho repetido da seção "Riscos Excluídos":
 * "Permanecem as exclusões da Cláusula 6ª - Exclusões Gerais das Condições
 * Gerais que não tenham sido expressamente alteradas pela presente cobertura
 * ou pelas demais coberturas adicionais contratadas…" (e a variante
 * "Permanecem as demais exclusões da Cláusula 6ª…"). O Zurich repete esse
 * fecho em CADA seção de exclusões (págs. 65, 73, 94, 104, 123, 131, 134 e
 * 136 do formato real) — em QUALQUER página nunca é cobertura. A 2ª
 * alternativa cobre a linha embrulhada que traz só a cauda do período.
 */
export const RE_PERMANECEM_EXCLUSOES_ZURICH =
  /^(?:permanecem\s+as\s+(?:demais\s+)?exclus[oõ]es\s+da\s+cl[aá]usula|al[eé]m\s+das\s+exclus[oõ]es\s+constantes\s+da\s+cl[aá]usula)\b|n[ãa]o\s+(?:tenham\s+sido\s+expressamente\s+alteradas|est[ãa]o\s+abrangidos)\s+pela\s+presente\s+cobertura/i

/**
 * Guarda v0.0.229 (Zurich) — cauda de VALOR POR EXTENSO de tabela de limites:
 * o pdf.js quebra "…(dezessete mil e quinhentos reais)" e a linha "reais)"
 * (pág. 128) nunca é título — termina em "mil/milhões/reais)" fechado.
 */
export const RE_CAUDA_VALOR_EXTESTO_ZURICH = /\b(?:milh[õo]es?|mil|reais?)\s*\)\s*$/i

/**
 * Guarda v0.0.231 (tarefa 2e, família 3) — Preposição ou conectivo isolado no fim da linha:
 * indica continuidade de frase (ex.: "... rompimento do obstáculo à").
 */
export const RE_CAUDA_PREPOSICAO_CONECTIVO =
  /\b(?:[aà]|ao|aos|d[eao]s?|e|ou|com|em|para|por|sob|sobre|que)\s*$/i

/**
 * Guarda v0.0.231 (tarefa 2e, família 3) — Fragmento de meio de sentença típico de cláusula
 * contratual: termos jurídicos/operacionais que aparecem no meio de cláusulas e nunca em títulos
 * de cobertura (ex.: "Indenização fixado na Apólice para a presente cobertura...", "Código Penal...").
 */
export const RE_FRAGMENTO_MEIO_SENTENCA =
  /\b(?:fixad[oa]s?\s+na\s+ap[oó]lice|para\s+a\s+presente\s+cobertura|perdas\s+e\s+danos|c[oó]digo\s+penal|c[oó]digo\s+civil|sem\s+que\s+tenha|tenha\s+havido|rompimento\s+d[eo]\s+obst[aá]culo|avarias,?\s+perdas)\b/i

/**
 * Guarda v0.0.231 (tarefa 2e, famílias 1 e 2) — Normalizador de espaços para detecção de rodapés:
 * pdf.js quebra "Setembro/2024" como "/20 2 4". Colapsa dígitos separados por espaço e normaliza barras.
 */
export function normalizarEspacosRodape(texto: string): string {
  return (texto || '')
    .replace(/(?<=\d)\s+(?=\d)/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Padrão estrutural de rodapé repetido nas páginas da Zurich (tarefa 2e, famílias 1 e 2).
 */
export const RE_RODAPE_ZURICH =
  /^(?:processo\s+susep[^-–\n]{0,60}[-–]\s*)?vers[aã]o\s*:?\s*[a-zà-ú]+\s*\/\s*\d{4}(?:\s+plano\s+de\s+seguro\s+[ivx\d]+)?(?:\s*[-–]?\s*danos\s+materiais)?(?:\s*[-–]?\s*cobertura\s+b[aá]sica\s*[-–]\s*inc[êe]ndio,\s*queda\s+de\s+raio,\s*explos[aã]o\s+e\s+implos[aã]o)?|^processo\s+susep\b[^-–\n]{0,60}(?:[-–]\s*vers[aã]o\s*:?\s*[a-zà-ú]+\s*\/\s*\d{4})?/i

/**
 * Remove o prefixo de rodapé colado ao início de um título legítimo (tarefa 2e, família 2).
 * Se a linha for unicamente o rodapé, devolve string vazia (tarefa 2e, família 1).
 */
export function removerPrefixoRodapeCg(linha: string): string {
  const t = (linha || '').trim()
  if (!t) return ''
  const tNormEspacos = normalizarEspacosRodape(t)
  const tNormLower = tNormEspacos.toLowerCase()

  // 1. Processo SUSEP como prefixo
  const mSusep = tNormEspacos.match(
    /^processo\s+susep[^-–\n]{0,60}(?:[-–]\s*vers[aã]o\s*:?\s*[a-zà-ú]+\s*\/\s*\d{4})?(?:\s+plano\s+de\s+seguro\s+[ivx\d]+)?(?:\s*[-–]?\s*danos\s+materiais)?(?:\s*[-–]?\s*cobertura\s+b[aá]sica\s*[-–]\s*inc[êe]ndio,\s*queda\s+de\s+raio,\s*explos[aã]o\s+e\s+implos[aã]o)?\s*/i,
  )
  if (mSusep && mSusep[0].length >= 15) {
    const resto = tNormEspacos.slice(mSusep[0].length).trim()
    if (resto.length >= 4) {
      // v0.0.232: o "resto" já veio do normalizado (que quebrou "/20 2 4" →
      // "/2024") — devolver direto o normalizado preserva o rodapé removido.
      // Antes: indexOf do resto no ORIGINAL (com ano fragmentado) nunca
      // casava → o resto INTEIRO voltava e o rodapé reabria como título,
      // competindo com o joiner multi-linha de cauda Zurich (158→160 golden).
      return resto
    }
    return ''
  }

  // 2. Versão : Mês/Ano ... Cobertura Básica ... como prefixo
  const mVersao = tNormEspacos.match(
    /^vers[aã]o\s*:?\s*[a-zà-ú]+\s*\/\s*\d{4}(?:\s+plano\s+de\s+seguro\s+[ivx\d]+)?(?:\s*[-–]?\s*danos\s+materiais)?(?:\s*[-–]?\s*cobertura\s+b[aá]sica\s*[-–]\s*inc[êe]ndio,\s*queda\s+de\s+raio,\s*explos[aã]o\s+e\s+implos[aã]o)?\s*/i,
  )
  if (mVersao && mVersao[0].length >= 10) {
    const resto = tNormEspacos.slice(mVersao[0].length).trim()
    if (resto.length >= 4) {
      // v0.0.232: o "resto" já veio do normalizado — devolver o normalizado
      // preserva o rodapé removido; indexOf no original (com ano fragmentado
      // "/20 2 4") nunca casava e o resto INTEIRO voltava.
      return resto
    }
    return ''
  }

  return t
}

/**
 * Linha de rodapé corrido isolado (tarefa 2e, família 1).
 */
export function ehLinhaRodapeCg(linha: string): boolean {
  const t = (linha || '').trim()
  if (!t) return false
  const tNorm = normalizarEspacosRodape(t)
  if (
    /^processo\s+susep\b/i.test(tNorm) ||
    /^vers[aã]o\s*:?\s*[a-zà-ú]+\s*\/\s*\d{4}/i.test(tNorm)
  ) {
    const limpo = removerPrefixoRodapeCg(t)
    return !limpo || limpo.length < 4
  }
  return false
}

/**
 * Núcleo da guarda de fragmento, INSENSÍVEL à caixa (v0.0.227): alínea, cauda
 * de período aberto, conector de meio de frase e verbo de cláusula. Usada
 * direto pela assinatura Zurich — o formato Zurich É caixa mista, então a
 * regra de minúscula inicial (que depende de comparar a linha com a própria
 * caixa alta) não pode entrar aqui: ela classificava TODO título Zurich
 * ("Danos ao Cais") como fragmento e a assinatura nunca casava (falha
 * v0.0.226 — golden 149/152). (função pura — testada na suíte golden)
 */
function ehFragmentoFraseInsensivelCaixaCg(titulo: string): boolean {
  const t = (titulo || '').trim()
  if (!t) return false
  if (RE_FRAGMENTO_ALINEA.test(t)) return true
  if (RE_CAUDA_FIM_DE_FRASE.test(t)) return true
  if (RE_CAUDA_PERIODO_ABERTO.test(t)) return true
  if (RE_CAUDA_PREPOSICAO_CONECTIVO.test(t)) return true
  if (RE_MEIO_FRASE_CAIXA_ALTA.test(t)) return true
  if (/^,\s/.test(t)) return true
  if (RE_FRAGMENTO_CLAUSULA.test(normalizarTituloCg(t))) return true
  if (RE_FRAGMENTO_MEIO_SENTENCA.test(normalizarTituloCg(t))) return true
  return false
}

/**
 * A linha é um FRAGMENTO de frase (continuação de parágrafo, texto dentro de
 * cláusula numerada, rabo de alínea)? (função pura — testada na suíte golden)
 */
export function ehFragmentoFraseCg(titulo: string): boolean {
  if (ehFragmentoFraseInsensivelCaixaCg(titulo)) return true
  const t = (titulo || '').trim()
  // Minúscula inicial: só é fragmento se a linha não é um título em caixa alta
  // quebrado (título quebrado mantém caixa alta em todas as linhas).
  return RE_FRAGMENTO_MINUSCULA.test(t) && t !== t.toUpperCase()
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
  const limpo = removerPrefixoRodapeCg(titulo || '').trim()
  if (!limpo) return false
  if (ehLinhaRodapeCg(limpo)) return false
  const t = limpo
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
  // salvo a extensão real de garantia/cobertura (formato Tokio, v0.0.223) e
  // cláusula de cobertura explícita (salvamento/contenção/defesa etc.)
  if (RE_CLAUSULA_NAO_COBERTURA.test(norm)) {
    if (RE_CLAUSULA_PARTICULAR_EXTENSAO.test(norm)) return true
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
  // v0.0.223 (Tokio): "COBERTURA ADICIONAL Nº. NN - ..." e "COBERTURA BÁSICA
  // nº. NNNC - ..." com código e nome no resto da linha (o nome em caixa alta
  // pode quebrar em 2 linhas — a junção no lerCondicoesGerais cuida disso).
  if (/^cobertura\s+(b[aá]sica|adicional)\s+n[ºo°.]*/i.test(norm)) return true
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
// Assinatura estrutural Zurich (v0.0.226) — coberturas em caixa mista sem
// prefixo ("Danos ao Cais", "Danos por Água", "Erros e Omissões"), sempre
// seguidas da linha âncora "1. Riscos Cobertos". A ancoragem é NO bloco 1:
// as exclusões variam entre "2." e "3. Riscos Excluídos", logo a numeração
// dos blocos seguintes não serve de âncora. Função pura — testada na suíte
// golden (seção 12).
// ---------------------------------------------------------------------------

/** Âncora: a linha IMEDIATAMENTE abaixo do título ("1. Riscos Cobertos"). */
const RE_ANCORAGEM_RISCOS_COBERTOS_ZURICH = /^1\.?\s*riscos?\s+cobertos\b/i

/**
 * v0.0.229 (tarefa 2c): a linha é uma CONTINUAÇÃO de título Zurich quebrado
 * em 2-3 linhas? Os títulos Zurich quebram SEM pontuação de fechamento
 * ("…Utilidades e/ou" + "Serviços", "…Interior de" + "Cofre", "…Impacto de
 * Veículos" + "Terrestres e Fumaça"): linha que termina em "."/";"/":"
 * fechou a frase anterior (corpo) e NÃO é continuação; linha de Sumário,
 * subtítulo numerado, âncora, família "Cláusula...", fecho "Permanecem..."
 * e fragmento de frase também não. (função pura — testada na suíte golden)
 * Exportada (v0.0.236) para diagnóstico do caso de 3 linhas no probe
 * scripts/probe-cg-3-linhas.ts — exportar não altera nenhum fluxo.
 */
export function ehContinuacaoTituloZurich(linha: string): boolean {
  const limpo = removerPrefixoRodapeCg(linha || '').trim()
  if (!limpo) return false
  if (ehLinhaRodapeCg(limpo)) return false
  const t = limpo
  if (/[.;:]$/.test(t)) return false
  if (ehLinhaSumario(t)) return false
  if (ehInicioSubtitulo(t)) return false
  if (RE_ANCORAGEM_RISCOS_COBERTOS_ZURICH.test(t)) return false
  if (RE_CLAUSULA_ZURICH.test(t) || RE_CLAUSULA_PARA_ZURICH.test(t)) return false
  if (RE_PERMANECEM_EXCLUSOES_ZURICH.test(t)) return false
  if (RE_CAUDA_VALOR_EXTESTO_ZURICH.test(t)) return false
  // v0.0.233 (tarefa 2c × 2e): cauda de preposição/conectivo no FIM da linha
  // ("…Utilidades e/ou", "…Interrupção do") dentro de um bloco de título Zurich
  // é SINAL de continuação — é exatamente a linha que precisa JUNTAR à cauda
  // ("Serviços") ancorada em "1. Riscos Cobertos" logo abaixo. A guarda da
  // 2e (família 3) continua valendo em todo o resto: ela impede FRAGMENTOS de
  // corpo de virarem cobertura, mas não pode separar as linhas de um título
  // que a assinatura ancora (regressão v0.0.232: golden 158/160).
  if (RE_CAUDA_PREPOSICAO_CONECTIVO.test(t)) return true
  if (ehFragmentoFraseInsensivelCaixaCg(t)) return false
  return true
}

/**
 * Âncora ATRAVESSANDO a quebra de página (v0.0.227): a linha imediatamente
 * abaixo do título pode ser a PRIMEIRA linha da página seguinte — o título
 * "Contas a Receber" nasce no fim da pág. 53 (após o bloco "5. Franquia") e
 * a âncora "1. Riscos Cobertos" abre a pág. 54. A assinatura é a MESMA em
 * ambos os casos; a diferença é só DE ONDE vem o par de linhas.
 */

/** Família "Cláusula(s) ..." nunca é cobertura Zurich (particulares, exclusões, agrupadores: "Cláusulas Particulares", "Cláusulas de Coberturas Adicionais"). O plural exige \b depois do S. */
const RE_CLAUSULA_ZURICH = /^cl[aá]usulas?\b/i

export function tituloEhCoberturaZurich(titulo: string, linhaSeguinte: string): boolean {
  const limpo = removerPrefixoRodapeCg(titulo || '').trim()
  if (!limpo) return false
  if (ehLinhaRodapeCg(limpo)) return false
  const t = limpo
  const prox = (linhaSeguinte || '').trim()
  if (!t || !prox) return false
  // Guarda 0 — a âncora "1. Riscos Cobertos" é em caixa MISTA no formato
  // Zurich; a versão em CAIXA ALTA ("1. RISCOS COBERTOS") é de outros
  // formatos (Chubb) e NÃO ativa esta assinatura — protege o AXA/Chubb/Tokio
  // de linhas de corpo em caixa mista seguidas de subtítulo caixa alto.
  if (prox === prox.toUpperCase()) return false
  if (!RE_ANCORAGEM_RISCOS_COBERTOS_ZURICH.test(prox)) return false
  // Guarda 1 — linha de Sumário (pontilhada em qualquer formato): nunca título.
  if (ehLinhaSumario(t)) return false
  // Guarda 2 — CAIXA ALTA não passa pela assinatura Zurich: os formatos
  // AXA/Chubb/Tokio continuam sendo reconhecidos pelos prefixos existentes
  // (pacto anti-regressão); a assinatura é só para caixa mista.
  if (t === t.toUpperCase()) return false
  // Guarda 3 — cláusulas ("Cláusula de 1º Risco Absoluto", "Cláusula de
  // Exclusão de Asbestos", cabeçalho "Cláusulas Particulares") abrem com
  // "1. Fica entendido…" e nunca são cobertura. Nenhuma cobertura Zurich
  // começa com "Cláusula" — bloqueia a família inteira. v0.0.228: guarda
  // explícita para "Cláusula para ..." (Imóveis Tombados, pág. 137) — sem
  // ela, o casamento da família cobriria, mas o caso fica travado por
  // asserção própria na suíte golden (seção 12).
  if (RE_CLAUSULA_ZURICH.test(t)) return false
  if (RE_CLAUSULA_PARA_ZURICH.test(t)) return false
  // Guarda 4 — fragmento de frase (continuação de parágrafo) nunca é título.
  // Núcleo INSENSÍVEL à caixa: alínea, cauda de período aberto (";"/","/"…"),
  // conector de meio de frase e verbo de cláusula. A regra de minúscula
  // inicial NÃO entra (v0.0.227): ela comparava a linha com a própria caixa
  // alta e rejeitava TODO título em caixa mista — justamente o formato Zurich
  // (falha v0.0.226: golden 149/152, "Danos ao Cais"/"Erros e Omissões" não
  // eram reconhecidos).
  if (ehFragmentoFraseInsensivelCaixaCg(t)) return false
  // Guarda 5 — v0.0.229/v0.0.231 (Zurich): fecho "Permanecem as (demais) exclusões da
  // Cláusula 6ª …" e "Além das exclusões constantes da Cláusula 6ª..." — nunca cobertura.
  if (RE_PERMANECEM_EXCLUSOES_ZURICH.test(t)) return false
  // Guarda 6 — v0.0.229 (Zurich): título Zurich sempre começa por MAIÚSCULA;
  // linha que começa em minúscula ou em ")" é fragmento (ex.: "reias)"… o
  // caso real é "reais)", pág. 128 — cauda do valor por extenso da tabela de
  // limites). Título de cobertura Zurich nunca termina em valor por extenso.
  if (/^[a-z)]/.test(t)) return false
  if (RE_CAUDA_VALOR_EXTESTO_ZURICH.test(t)) return false
  return true
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
      // v0.0.223 (Tokio): fragmento de frase em CAIXA ALTA (cauda ";"/"," ou
      // conector de meio de frase) dentro do bloco NÃO fecha o bloco nem entra
      // como exclusão — subtítulo numerado legítimo continua fechando.
      if (
        !ehCabecalhoSecaoNumerado(t) &&
        iniciaPalavra &&
        t === t.toUpperCase() &&
        t.length > 3 &&
        ehFragmentoFraseCg(t)
      ) {
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
  // v0.0.228 (Zurich): a versão pode vir com NOME DE MÊS — "Versão
  // Setembro/2024" na capa (sem dois-pontos) e "Versão: Setembro/2024" no
  // cabeçalho das páginas internas. Formato NUMÉRICO ("Versão 12/2025")
  // tem prioridade (pacto anti-regressão: a regra da mais frequente só se
  // aplica às ocorrências numéricas); o nome de mês é FALLBACK — usado só
  // quando nenhuma ocorrência numérica existe no documento inteiro. A
  // primeira ocorrência vence (capa vem antes do corpo no texto global).
  if (ocorrencias.length === 0) {
    const ocorrenciasMes = [
      ...texto.matchAll(
        /vers[aã]o\s*:?\s*(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(\d{4})/gi,
      ),
    ]
    if (ocorrenciasMes.length > 0) {
      const primeiro = ocorrenciasMes[0]
      return `Versão ${primeiro[1]}/${primeiro[2]}`
    }
  }
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
  /**
   * Página onde a ÂNCORA "1. Riscos Cobertos" cai quando ela NÃO está na
   * página do título (v0.0.227, Zurich atravessando quebra de página). O corpo
   * da seção começa NESSA página; 0 = âncora na própria página (normal).
   */
  paginaAncora: number
  corpo: Array<{ texto: string; pagina: number; slotY: number }>
}

/** Indica se a linha inicia um novo subtítulo estrutural (ex.: "1.1 RISCOS COBERTOS"). */
function ehInicioSubtitulo(linha: string): boolean {
  return /^\d+(\.\d+)*[.)]?\s+[A-ZÁÉÍÓÚ]/.test(linha) || /^RISCOS COBERTOS/i.test(linha)
}

/**
 * v0.0.238 — Guard do CABEÇA de título Zurich quebrado em 3 linhas, EXTRAÍDA
 * (função pura, exportada para o probe scripts/probe-cg-3-linhas.ts):
 *
 *   linha 1 (cabeça): "Vendaval, Furacão, Ciclone, Tornado, Granizo, Queda de
 *                     Aeronaves ou Quaisquer"
 *   linha 2:          "Outros Engenhos Aéreos ou Espaciais, Impacto de Veículos"
 *   linha 3:          "Terrestres e Fumaça"
 *   linha 4 (âncora): "1. Riscos Cobertos"
 *
 * A assinatura Zurich de 1 linha (tituloEhCoberturaZurich) fica deslocada 2
 * linhas para baixo pela cabeça: quem fecha o título é a 3ª linha, com a
 * âncora IMEDIATAMENTE abaixo dela. O par correto é SEMPRE (linha3, âncora) —
 * versões anteriores passavam o par invertido/deslocado e a guarda nunca
 * ativava (golden 159/160 no Mac). O trace devolve CADA condição booleana
 * separadamente para o probe imprimir qual teste passa e qual falha.
 */
export interface TraceCabecaTitulo3LinhasZurich {
  ativo: boolean
  /** Cabeça casa prefixo de cobertura (ex.: /^vendaval/) — tituloEhCobertura. */
  cabecaEhCobertura: boolean
  /** Linha 2 é continuação de título Zurich (sem pontuação de fechamento etc.). */
  linha2EhContinuacao: boolean
  /** Linha 3 fecha a assinatura com a âncora IMEDIATAMENTE abaixo dela. */
  linha3FechaAssinaturaComAncora: boolean
}

export function avaliarCabecaTitulo3LinhasZurich(
  cabeca: string,
  linha2: string,
  linha3: string,
  ancora: string,
): TraceCabecaTitulo3LinhasZurich {
  const cabecaEhCobertura = tituloEhCobertura(cabeca)
  const linha2EhContinuacao = ehContinuacaoTituloZurich(linha2)
  const linha3FechaAssinaturaComAncora = tituloEhCoberturaZurich(linha3, ancora)
  return {
    ativo: cabecaEhCobertura && linha2EhContinuacao && linha3FechaAssinaturaComAncora,
    cabecaEhCobertura,
    linha2EhContinuacao,
    linha3FechaAssinaturaComAncora,
  }
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
    paginaAncora: number
    slotY: number
    ordem: number
    ateLinhaTitulo: number
  }> = []
  let ordem = 0

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx]
    const linhas = linhasPorPagina.get(page.pageNumber) || []
    const flags = sumarioFlagsPorPagina.get(page.pageNumber) || []
    // v0.0.227 (Zurich, quebra de página): página IMEDIATAMENTE anterior na
    // ordem lida e sua ÚLTIMA linha fora de Sumário — candidato a título que
    // nasceu no fim dela com a âncora já na página atual.
    const pagAnterior = pIdx > 0 ? pages[pIdx - 1] : null
    const numeroPaginaAnterior = pagAnterior?.pageNumber || 0
    let ultimaLinhaPaginaAnterior = ''
    let slotYUltimaLinhaPaginaAnterior = 0
    if (pagAnterior) {
      const linhasAnt = linhasPorPagina.get(pagAnterior.pageNumber) || []
      const flagsAnt = sumarioFlagsPorPagina.get(pagAnterior.pageNumber) || []
      for (let k = linhasAnt.length - 1; k >= 0; k--) {
        if (flagsAnt[k]) continue
        const c = limparLinhaSumario(linhasAnt[k].texto)
        if (!c) continue
        ultimaLinhaPaginaAnterior = c
        slotYUltimaLinhaPaginaAnterior = linhasAnt[k].slotY
        break
      }
    }
    for (let i = 0; i < linhas.length; i++) {
      if (flags[i]) continue
      const limpo = removerPrefixoRodapeCg(limparLinhaSumario(linhas[i].texto))
      if (!limpo || ehLinhaRodapeCg(limpo)) continue
      const bruto = limpo
      // v0.0.226 (Zurich): assinatura estrutural — título em caixa mista sem
      // prefixo seguido da linha âncora "1. Riscos Cobertos". Avaliada ANTES
      // dos prefixos de cobertura: o nome Zurich ("Danos ao Cais") não casa
      // nenhum prefixo. A linha do título NÃO entra no join de caixa alta
      // (o formato Zurich não quebra o título em caixa alta).
      // v0.0.237: coleta ATÉ 3 linhas seguintes (a 1ª continua sendo a
      // "linha seguinte" de sempre; a 2ª e a 3ª só alimentam o guard de
      // cabeça de título Zurich quebrado em 3 linhas, logo abaixo).
      const seguintesTitulo: Array<{ texto: string; index: number }> = []
      for (let ni = i + 1; ni < linhas.length && seguintesTitulo.length < 3; ni++) {
        if (flags[ni]) continue
        const cand = removerPrefixoRodapeCg(limparLinhaSumario(linhas[ni].texto))
        if (!cand || ehLinhaRodapeCg(cand)) continue
        seguintesTitulo.push({ texto: cand, index: ni })
      }
      const proximaLinhaTitulo = seguintesTitulo[0]?.texto || ''
      const segundaLinhaSeguinteTitulo = seguintesTitulo[1]?.texto || ''
      const terceiraLinhaTitulo = seguintesTitulo[2]?.texto || ''
      // v0.0.227: a MESMA assinatura avaliada na atravessada da quebra de
      // página — título = última linha da página anterior, âncora = esta
      // linha. A ocorrência aponta para a página ONDE O TÍTULO NASCE. Só é
      // avaliada quando a assinatura na mesma página NÃO casou (o caso
      // same-page tem prioridade; nenhuma linha é âncora e título ao mesmo
      // tempo, então os dois caminhos nunca competem).
      const ehZurichMesmaPagina = tituloEhCoberturaZurich(bruto, proximaLinhaTitulo)
      const ehZurichAtravessandoPagina =
        !ehZurichMesmaPagina &&
        !!ultimaLinhaPaginaAnterior &&
        tituloEhCoberturaZurich(ultimaLinhaPaginaAnterior, bruto)
      if (ehZurichMesmaPagina || ehZurichAtravessandoPagina) {
        if (ehZurichAtravessandoPagina) {
          ocorrencias.push({
            nome: ultimaLinhaPaginaAnterior,
            pagina: numeroPaginaAnterior,
            paginaAncora: page.pageNumber,
            slotY: slotYUltimaLinhaPaginaAnterior,
            ordem: ordem++,
            // título está na PÁGINA ANTERIOR: nenhuma linha DESTE página é
            // título — a 2ª passada não pula nada aqui (o corpo começa na
            // âncora, já nesta página).
            ateLinhaTitulo: -1,
          })
        } else {
          // v0.0.229 (tarefa 2c, família 1): título Zurich QUEBRADO em 2-3
          // linhas — a assinatura casa na ÚLTIMA linha do título (a que tem a
          // âncora abaixo), então as linhas ACIMA dela são caudas do MESMO
          // título ("…Utilidades e/ou" + "Serviços", pág. 58; "…Interior de"
          // + "Cofre", pág. 124; 3 linhas em pág. 135). Junta TODAS as linhas
          // do título antes de criar a seção — a cauda sozinha nunca vira
          // cobertura espúria.
          const partes = [bruto]
          let inicio = i
          while (inicio - 1 >= 0 && partes.length < 3) {
            if (flags[inicio - 1]) break
            const cand = limparLinhaSumario(linhas[inicio - 1].texto)
            if (!cand || !ehContinuacaoTituloZurich(cand)) break
            // a própria linha acima não pode ser OUTRO título Zurich com
            // âncora própria (seção legítima anterior) — não se junta.
            const candProx = inicio - 2 >= 0 ? limparLinhaSumario(linhas[inicio - 2].texto) : ''
            if (tituloEhCoberturaZurich(cand, candProx)) break
            partes.unshift(cand)
            inicio--
          }
          ocorrencias.push({
            nome: partes.join(' ').replace(/\s+/g, ' ').trim(),
            pagina: page.pageNumber,
            paginaAncora: 0,
            slotY: linhas[inicio].slotY,
            ordem: ordem++,
            ateLinhaTitulo: inicio,
          })
        }
        continue
      }
      // v0.0.238 (seção 12, caso de 3 linhas): CABEÇA de título Zurich
      // quebrado em 3 linhas que casa um prefixo de cobertura ("Vendaval,
      // Furacão, ..."). Sem este guard, a cabeça virava seção TRUNCADA
      // espúria (interceptada por /^vendaval/) e o joiner da cauda — que só
      // junta 2 partes — não reconstruía o título de 3 linhas. O guard usa a
      // função EXTRAÍDA avaliarCabecaTitulo3LinhasZurich (o par da assinatura
      // é SEMPRE (linha 3, âncora/linha 4), ver doc dela). Quando ativa, a
      // SEÇÃO COMPLETA nasce AQUI, com o título das 3 linhas juntadas —
      // inerte nos demais formatos: caixa alta (AXA/Chubb/Tokio) não passa
      // pela assinatura (guarda 0) e os casos de 1 e 2 linhas Zurich têm a
      // âncora em outra posição do par.
      const trace3Linhas = avaliarCabecaTitulo3LinhasZurich(
        bruto,
        proximaLinhaTitulo,
        segundaLinhaSeguinteTitulo,
        terceiraLinhaTitulo,
      )
      if (trace3Linhas.ativo) {
        // título COMPLETO = cabeça + as 2 linhas de continuação juntadas.
        const tituloCompleto = [bruto, proximaLinhaTitulo, segundaLinhaSeguinteTitulo]
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        ocorrencias.push({
          nome: tituloCompleto,
          pagina: page.pageNumber,
          paginaAncora: 0,
          slotY: linhas[i].slotY,
          ordem: ordem++,
          // ÍNDICE REAL da última linha consumida como título (a 2ª linha
          // seguinte; linhas de Sumário/rodapé puladas não contam) — a 2ª
          // passada pula as 3 linhas do título e começa o corpo na âncora.
          ateLinhaTitulo: seguintesTitulo[1].index,
        })
        i = seguintesTitulo[1].index
        continue
      }
      // v0.0.236 (seção 12, cinto de segurança): cabeça de título Zurich
      // quebrado em 3 linhas que NÃO fecha a assinatura com a 1ª continuação
      // (variação de formato) — a linha truncada nunca vira seção aqui; o
      // joiner da cauda ainda pode reconstruir o título quando o loop
      // alcançar a última linha. Sem este continue, a cabeça casava
      // /^vendaval/ e nascia uma seção TRUNCADA espúria.
      if (
        tituloEhCobertura(bruto) &&
        tituloEhCoberturaZurich(segundaLinhaSeguinteTitulo, terceiraLinhaTitulo)
      ) {
        continue
      }
      if (!tituloEhCobertura(bruto)) continue

      const linhasTitulo = [bruto]
      let j = i + 1
      while (j < linhas.length && linhasTitulo.length < 3) {
        if (flags[j]) break
        const prox = limparLinhaSumario(linhas[j].texto)
        // v0.0.223 (Tokio): fragmento de frase em caixa alta (cauda ";"/","
        // ou conector de meio de frase) NÃO é juntado ao título — título
        // quebrado legítimo (2 linhas caixa alta sem cauda aberta) continua
        // sendo juntado (ex.: "COBERTURA ADICIONAL nº. 023 - ANÚNCIOS" +
        // "LUMINOSOS").
        if (
          prox &&
          prox === prox.toUpperCase() &&
          !ehInicioSubtitulo(prox) &&
          !ehFragmentoFraseCg(prox)
        ) {
          linhasTitulo.push(prox)
          j++
        } else break
      }
      ocorrencias.push({
        nome: linhasTitulo.join(' ').replace(/\s+/g, ' ').trim(),
        pagina: page.pageNumber,
        paginaAncora: 0,
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
    {
      nome: string
      pagina: number
      paginaAncora: number
      slotY: number
      ordem: number
      ateLinhaTitulo: number
    }
  >()
  for (const o of ocorrencias) ultimaPorChave.set(chaveDedupTituloCg(o.nome), o)
  const secoes: SecaoCobertura[] = [...ultimaPorChave.values()]
    .sort((a, b) => a.ordem - b.ordem)
    .map((o) => ({
      nome: o.nome,
      pagina: o.pagina,
      paginaAncora: o.paginaAncora,
      slotY: o.slotY,
      ateLinhaTitulo: o.ateLinhaTitulo,
      corpo: [],
    }))

  // 2ª passada: corpo de cada seção (até a próxima seção) e exclusões
  const itens: CgIngestaoItemExtraido[] = []
  for (let s = 0; s < secoes.length; s++) {
    const secao = secoes[s]
    // v0.0.227 (Zurich, quebra de página): a ÂNCORA "1. Riscos Cobertos" pode
    // cair na PÁGINA SEGUINTE à do título — o corpo começa NESSA página. O
    // limite de fim (página da próxima seção) continua sendo o mais adiantado.
    const inicioCorpo = secao.paginaAncora || secao.pagina
    const fimPag =
      s + 1 < secoes.length ? secoes[s + 1].pagina : (pages[pages.length - 1]?.pageNumber || 1) + 1
    for (let pCorpo = 0; pCorpo < pages.length; pCorpo++) {
      const page = pages[pCorpo]
      if (page.pageNumber < inicioCorpo || page.pageNumber > fimPag) continue
      const linhas = linhasPorPagina.get(page.pageNumber) || []
      const flags = sumarioFlagsPorPagina.get(page.pageNumber) || []
      // v0.0.227: última linha fora de Sumário da página IMEDIATAMENTE anterior
      // a esta, na ordem lida — candidato a título Zurich que nasceu no fim
      // dela com a âncora na primeira linha da página atual.
      let ultimaLinhaPagAntCorpo = ''
      if (pCorpo > 0) {
        const pagAnt = pages[pCorpo - 1]
        const linhasAnt = linhasPorPagina.get(pagAnt.pageNumber) || []
        const flagsAnt = sumarioFlagsPorPagina.get(pagAnt.pageNumber) || []
        for (let k = linhasAnt.length - 1; k >= 0; k--) {
          if (flagsAnt[k]) continue
          const c = limparLinhaSumario(linhasAnt[k].texto)
          if (!c) continue
          ultimaLinhaPagAntCorpo = c
          break
        }
      }
      for (let idx = 0; idx < linhas.length; idx++) {
        if (flags[idx]) continue // linha de Sumário não entra no corpo
        const linha = linhas[idx]
        const limpoBruto = removerPrefixoRodapeCg(limparLinhaSumario(linha.texto))
        if (!limpoBruto || ehLinhaRodapeCg(limpoBruto)) continue
        const limpo = limpoBruto
        if (page.pageNumber === secao.pagina && idx <= secao.ateLinhaTitulo) continue
        // v0.0.226 (Zurich): o título da próxima seção em caixa mista não casa
        // os prefixos — corta também pela assinatura Zurich, senão o corpo da
        // seção anterior engolia o título seguinte (que virava "exclusão").
        const proximaLinhaCorpo =
          idx + 1 < linhas.length ? limparLinhaSumario(linhas[idx + 1].texto) : ''
        // v0.0.227 (Zurich, quebra de página): PRIMEIRA linha fora de Sumário
        // da página SEGUINTE (na ordem lida) — a âncora de um título que nasce
        // no fim desta página pode estar lá.
        let primeiraLinhaPaginaSeguinte = ''
        if (pCorpo + 1 < pages.length) {
          const pagSeg = pages[pCorpo + 1]
          const linhasSeg = linhasPorPagina.get(pagSeg.pageNumber) || []
          const flagsSeg = sumarioFlagsPorPagina.get(pagSeg.pageNumber) || []
          for (let k = 0; k < linhasSeg.length; k++) {
            if (flagsSeg[k]) continue
            const c = limparLinhaSumario(linhasSeg[k].texto)
            if (!c) continue
            primeiraLinhaPaginaSeguinte = c
            break
          }
        }
        // v0.0.227 (Zurich, quebra de página), corte da seção ANTERIOR:
        //  a) o TÍTULO atravessado (última linha desta página, com a âncora
        //     na primeira linha da página seguinte) NÃO entra no corpo;
        //  b) a ÂNCORA "1. Riscos Cobertos" na primeira linha de uma página
        //     também corta (cinto de segurança — senão a seção anterior
        //     engoliria título, âncora e corpo da seção atravessada).
        // A própria seção atravessada não corta: o corpo DELA começa na âncora.
        const ehTituloSecaoAtravessada =
          !!primeiraLinhaPaginaSeguinte &&
          tituloEhCoberturaZurich(limpo, primeiraLinhaPaginaSeguinte)
        const ehAncoraSecaoAtravessada =
          idx === 0 &&
          !!ultimaLinhaPagAntCorpo &&
          secao.paginaAncora !== page.pageNumber &&
          tituloEhCoberturaZurich(ultimaLinhaPagAntCorpo, limpo)
        // v0.0.229 (tarefa 2c, família 1): a seção ANTERIOR também corta na
        // PRIMEIRA linha de um título Zurich quebrado — a assinatura só casa
        // na ÚLTIMA linha do título (com a âncora), então sem este corte as
        // linhas de cima do título entravam no corpo da seção anterior.
        // Guarda anti-falso-positivo: a linha candidata não tem dígito (linha
        // de valor/tabela) e parece continuação de título (sem pontuação de
        // fechamento) — linha de corpo legítima não é cortada.
        const segundaLinhaSeguinteCorpo =
          idx + 2 < linhas.length
            ? limparLinhaSumario(linhas[idx + 2].texto)
            : primeiraLinhaPaginaSeguinte
        const ehTituloZurichQuebradoAqui =
          !!proximaLinhaCorpo &&
          !/\d/.test(limpo) &&
          ehContinuacaoTituloZurich(limpo) &&
          tituloEhCoberturaZurich(proximaLinhaCorpo, segundaLinhaSeguinteCorpo)
        if (
          tituloEhCobertura(limpo) ||
          tituloEhCoberturaZurich(limpo, proximaLinhaCorpo) ||
          ehTituloSecaoAtravessada ||
          ehAncoraSecaoAtravessada ||
          ehTituloZurichQuebradoAqui
        ) {
          // próxima seção começa no meio desta página: corta o corpo aqui
          break
        }
        // v0.0.227 (Zurich, quebra de página): a âncora "1. Riscos Cobertos"
        // da seção ATUAL no começo da página do corpo NÃO entra no corpo (a
        // leitura começa depois dela) — e nunca deve fechar o bloco de
        // exclusões como subtítulo (não é caixa alta, não fecha).
        if (
          secao.paginaAncora &&
          page.pageNumber === inicioCorpo &&
          secao.corpo.length === 0 &&
          RE_ANCORAGEM_RISCOS_COBERTOS_ZURICH.test(limpo)
        ) {
          continue
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
