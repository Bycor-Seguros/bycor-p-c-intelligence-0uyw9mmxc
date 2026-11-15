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
 * Título é uma seção de cobertura? (função pura — testada na suíte golden)
 */
export function tituloEhCobertura(titulo: string): boolean {
  const t = (titulo || '').trim()
  if (!t) return false
  if (t.length < 6) return false
  const norm = normalizarTituloCg(t)
  if (RE_NAO_COBERTURA.test(norm)) return false
  if (RE_MARCADOR_BLOCO.test(norm)) return false

  // Cláusula particular/específica/de exclusão: regra geral é NÃO cobertura,
  // salvo cláusula de cobertura explícita (salvamento/contenção/defesa etc.)
  if (RE_CLAUSULA_NAO_COBERTURA.test(norm)) {
    return RE_CLAUSULA_COBERTURA_EXPLICITA.test(norm)
  }

  if (/^cobertura\s+(basica|adicional|especial)\b/i.test(norm)) return true
  if (/^cobertura\s+de\s+/i.test(t)) return true
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

const RE_INICIO_EXCLUSOES =
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

  for (const linha of corpoLinhas) {
    const t = (linha.texto || '').trim()
    if (!t) continue

    if (!dentroExclusoes) {
      if (RE_INICIO_EXCLUSOES.test(t)) dentroExclusoes = true
      continue
    }

    // fim da lista de exclusões: novo subtítulo em caixa alta (com ou sem
    // numeração de cláusula, ex. "1.3 LIMITE DE INDENIZAÇÃO")
    const ehAlinea = RE_ALINEA.test(t)
    const iniciaPalavra = /^[A-Za-zÁÉÍÓÚÂÊÔÃÕÇ]/.test(t)
    if (!ehAlinea) {
      if (RE_INICIO_EXCLUSOES.test(t)) continue // "NÃO ESTÃO COBERTOS:" repetido/renumerado
      if ((iniciaPalavra && t === t.toUpperCase() && t.length > 3) || ehCabecalhoSecaoNumerado(t)) {
        dentroExclusoes = false
        continue
      }
    }

    const mAlinea = t.match(RE_ALINEA)
    const textoAlinea = (mAlinea ? mAlinea[2] : t).trim()
    if (textoAlinea.length < 8) continue
    exclusoes.push({ texto: textoAlinea, pagina: linha.pagina, slotY: linha.slotY })
  }

  return exclusoes
}

// ---------------------------------------------------------------------------
// Leitura completa (Sumário + seções)
// ---------------------------------------------------------------------------

function limparLinhaSumario(linha: string): string {
  return (linha || '')
    .replace(/\.{2,}|…{1,}|·{2,}/g, ' ')
    .replace(/\s*\.{0,2}\s*\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const RE_PROCESSO_SUSEP = /processo\s+susep[^0-9]{0,30}(\d{2,5}\.?\d{3,6}\/\d{4}-\d{1,2})/i

export function detectarProcessoSusepCg(textoGlobal: string): string {
  const m = textoGlobal.match(RE_PROCESSO_SUSEP)
  return m ? m[1] : ''
}

export function detectarProdutoVersaoCg(textoGlobal: string): string {
  const mVersao = textoGlobal.match(/vers[aã]o\s*:?\s*(\d{1,3}\s*\/\s*\d{4})/i)
  const mMes = textoGlobal.match(/processo\s+susep[^-–\n]{0,60}[-–]\s*(\d{2}\/\d{4})/i)
  if (mVersao) return `Versão ${mVersao[1].replace(/\s+/g, '')}`
  if (mMes) return mMes[1]
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

  // 1ª passada: seções de cobertura (título pode quebrar em 2-3 linhas caixa alta)
  const secoes: SecaoCobertura[] = []
  const nomesJaVistos = new Set<string>()

  for (const page of pages) {
    const linhas = linhasPorPagina.get(page.pageNumber) || []
    for (let i = 0; i < linhas.length; i++) {
      const bruto = limparLinhaSumario(linhas[i].texto)
      if (!bruto || !tituloEhCobertura(bruto)) continue
      // linha de Sumário: contém pontilhado seguido de nº — é índice, o título
      // real da seção vem adiante; ignora para não duplicar
      if (/\.{3,}/.test(linhas[i].texto)) continue

      const linhasTitulo = [bruto]
      let j = i + 1
      while (j < linhas.length && linhasTitulo.length < 3) {
        const prox = limparLinhaSumario(linhas[j].texto)
        if (
          prox &&
          prox === prox.toUpperCase() &&
          !ehInicioSubtitulo(prox) &&
          !/\.{3,}/.test(prox)
        ) {
          linhasTitulo.push(prox)
          j++
        } else break
      }
      const nomeCompleto = linhasTitulo.join(' ').replace(/\s+/g, ' ').trim()
      const chave = normalizarTituloCg(nomeCompleto)
      if (!nomesJaVistos.has(chave)) {
        nomesJaVistos.add(chave)
        secoes.push({
          nome: nomeCompleto,
          pagina: page.pageNumber,
          slotY: linhas[i].slotY,
          corpo: [],
        })
      }
      i = j - 1
    }
  }

  // 2ª passada: corpo de cada seção (até a próxima seção) e exclusões
  const itens: CgIngestaoItemExtraido[] = []
  for (let s = 0; s < secoes.length; s++) {
    const secao = secoes[s]
    const fimPag =
      s + 1 < secoes.length ? secoes[s + 1].pagina : (pages[pages.length - 1]?.pageNumber || 1) + 1
    for (const page of pages) {
      if (page.pageNumber < secao.pagina || page.pageNumber > fimPag) continue
      for (const linha of linhasPorPagina.get(page.pageNumber) || []) {
        const limpo = limparLinhaSumario(linha.texto)
        if (!limpo) continue
        if (
          page.pageNumber === secao.pagina &&
          normalizarTituloCg(limpo) === normalizarTituloCg(secao.nome)
        )
          continue
        if (tituloEhCobertura(limpo) && !/\.{3,}/.test(linha.texto)) {
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
