/**
 * Módulo de Normalização e Unificação Canônica de Seguradoras
 *
 * Garante que nenhuma gravação no sistema gere variantes de grafia de seguradoras.
 * Regras estritas:
 * 1. Casamento prioritário por CNPJ (limpo, só dígitos) contra o cadastro 'seguradoras'.
 * 2. Casamento por nome normalizado:
 *    - Remove acentos, caixa baixa, pontuação
 *    - Desconsidera conteúdos entre parênteses (ex.: '(MSIG)')
 *    - Trata equivalências empresariais: 's.a.', 's/a', 'sa', 'cia', 'companhia', 'de', 'do', 'da'
 * 3. Se casar, retorna o nome canônico já existente no cadastro 'seguradoras'.
 * 4. Só cria novo registro em 'seguradoras' se nenhum registro casar (se autoCadastrar=true).
 * 5. Possui cache em memória durante a sessão/operação assíncrona para evitar chamadas repetidas.
 */

import pb from '@/lib/pocketbase/client'

export interface SeguradoraCadastroRecord {
  id: string
  nome: string
  cnpj?: string
  susep?: string
  observacoes?: string
  posicionamento?: string
  faixa_lmi?: string
  condicoes_tipicas?: string
  contatos?: any
  historico_relacionamento?: any[]
}

export interface NormalizarSeguradoraOptions {
  cnpj?: string | null
  susep?: string | null
  razaoSocial?: string | null
  autoCadastrar?: boolean
  cadastrosExistentes?: SeguradoraCadastroRecord[]
}

export interface NormalizarSeguradoraResult {
  id?: string
  nomeCanonica: string
  cnpj?: string
  susep?: string
  matched: boolean
  autoCadastrada: boolean
}

// Dicionário canônico padrão em memória (gabarito alinhado com a migração 0014)
export const SEGURADORAS_CANONICAS_DEFAULT: Array<{
  nome: string
  cnpj: string
  susep?: string
  aliases: string[]
}> = [
  {
    nome: 'AXA Seguros S.A.',
    cnpj: '19.323.190/0001-06',
    susep: '0285-2',
    aliases: ['axa', 'axa seguros', 'axa seguros s/a', 'axa seguros sa', 'axa seguros s a'],
  },
  {
    nome: 'Mitsui Sumitomo Seguros S.A.',
    cnpj: '33.016.221/0001-07',
    susep: '05266',
    aliases: [
      'mitsui',
      'msig',
      'mitsui sumitomo',
      'mitsui sumitomo seguros',
      'mitsui sumitomo seguros s/a',
      'mitsui sumitomo seguros sa',
      'mitsui sumitomo seguros s a',
      'mitsui sumitomo seguros s a msig',
    ],
  },
  {
    nome: 'Porto Seguro Cia. de Seguros Gerais',
    cnpj: '61.198.164/0001-60',
    susep: '05886',
    aliases: [
      'porto seguro',
      'porto',
      'porto seguro companhia de seguros gerais',
      'porto seguro cia de seguros gerais',
      'porto seguros',
    ],
  },
  {
    nome: 'Tokio Marine Seguradora S.A.',
    cnpj: '33.164.021/0001-00',
    susep: '06157',
    aliases: ['tokio marine', 'tokio', 'tokio marine seguradora', 'tokio marine seguradora s a'],
  },
  {
    nome: 'Chubb Seguros Brasil S.A.',
    cnpj: '03.502.099/0001-18',
    susep: '06513',
    aliases: ['chubb', 'chubb seguros', 'chubb seguros brasil', 'chubb seguros brasil s a'],
  },
  {
    nome: 'Ezze Seguros S.A.',
    cnpj: '31.534.848/0001-24',
    susep: '03158',
    aliases: ['ezze', 'ezze seguros', 'ezze seguros s a'],
  },
  {
    nome: 'Allianz Seguros S.A.',
    cnpj: '061.573.796/0001-66',
    susep: '15414.900340/2018-85',
    aliases: ['allianz', 'allianz seguros', 'allianz seguros s a'],
  },
  {
    nome: 'Zurich Minas Brasil Seguros S.A.',
    cnpj: '17.197.385/0001-21',
    susep: '05495',
    aliases: ['zurich', 'zurich minas brasil', 'zurich seguros'],
  },
  {
    nome: 'Mapfre Seguros Gerais S.A.',
    cnpj: '61.074.175/0001-38',
    susep: '06238',
    aliases: ['mapfre', 'mapfre seguros'],
  },
]

/** Limpa CNPJ para manter somente dígitos (14 dígitos) */
export function limparCnpj(val: unknown): string {
  if (!val) return ''
  return String(val).replace(/\D/g, '')
}

/** Formata dígitos de CNPJ para máscara padrão XX.XXX.XXX/XXXX-XX */
export function formatarCnpj(val: string): string {
  const digits = limparCnpj(val)
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`
  }
  return val
}

/**
 * Normaliza uma string de nome de seguradora para comparação canônica:
 * - Descarta parênteses e seus conteúdos (ex: '(MSIG)', '(BRASIL)')
 * - Remove acentuação
 * - Caixa baixa
 * - Converte pontuação para espaço
 * - Remove palavras de forma jurídica e conectivos: 's.a.', 's/a', 'sa', 'cia', 'companhia', 'de', 'do', 'da', 'seguros', 'seguradora'
 */
export function normalizarNomeParaComparacao(raw: string): string {
  if (!raw) return ''

  // 1. Descartar sufixos e conteúdos entre parênteses
  let s = raw.replace(/\(.*?\)/g, ' ')

  // 2. Normalizar acentos
  s = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  // 3. Substituir pontuações comuns de S.A., S/A, Cia., etc.
  s = s.replace(/s\s*\/\s*a/g, ' ')
  s = s.replace(/s\s*\.\s*a\b/g, ' ')
  s = s.replace(/[^a-z0-9]/g, ' ')

  // 4. Tokenizar e filtrar tokens ruído / sufixos jurídicos equivalentes
  const stopTokens = new Set([
    'sa',
    'cia',
    'com',
    'companhia',
    'de',
    'da',
    'do',
    'dos',
    'das',
    'e',
    'brasil',
    'gerais',
    'seguros',
    'seguradora',
  ])

  const tokens = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !stopTokens.has(t))

  return tokens.join(' ')
}

// Cache em memória de curto prazo para chamadas repetidas
let seguradorasCache: SeguradoraCadastroRecord[] | null = null
let lastCacheFetchTime = 0
const CACHE_TTL_MS = 60000 // 1 minuto

/**
 * Carrega a lista completa da coleção 'seguradoras' do backend com cache.
 */
export async function getSeguradorasCadastro(
  forceRefresh = false,
): Promise<SeguradoraCadastroRecord[]> {
  const now = Date.now()
  if (!forceRefresh && seguradorasCache && now - lastCacheFetchTime < CACHE_TTL_MS) {
    return seguradorasCache
  }

  try {
    const list = await pb.collection('seguradoras').getFullList<SeguradoraCadastroRecord>({
      sort: 'nome',
      batch: 200,
    })
    seguradorasCache = list
    lastCacheFetchTime = now
    return list
  } catch (err) {
    console.warn('Não foi possível carregar cadastro de seguradoras:', err)
    return seguradorasCache || []
  }
}

/** Invalida o cache local de seguradoras */
export function invalidateSeguradorasCache(): void {
  seguradorasCache = null
  lastCacheFetchTime = 0
}

/**
 * Função síncrona pura para casar uma seguradora contra uma lista de registros já fornecida.
 */
export function casarSeguradoraComLista(
  nomeOuTexto: string,
  cadastros: SeguradoraCadastroRecord[],
  cnpjInformado?: string | null,
): SeguradoraCadastroRecord | null {
  const cnpjLimpo = limparCnpj(cnpjInformado)

  // 1. Casamento prioritário por CNPJ (se tiver 14 dígitos)
  if (cnpjLimpo && cnpjLimpo.length >= 14) {
    const matchCnpj = cadastros.find((c) => {
      const cCnpj = limparCnpj(c.cnpj)
      if (cCnpj && cCnpj === cnpjLimpo) return true

      // Verifica se o CNPJ está gravado no texto das observações
      if (c.observacoes && limparCnpj(c.observacoes).includes(cnpjLimpo)) {
        return true
      }
      return false
    })

    if (matchCnpj) return matchCnpj
  }

  const rawNome = (nomeOuTexto || '').trim()
  if (!rawNome) return null

  // 2. Casamento exato por nome
  const matchExato = cadastros.find((c) => c.nome.trim().toLowerCase() === rawNome.toLowerCase())
  if (matchExato) return matchExato

  // 3. Casamento por nome normalizado (sem acentos, sem 'S.A.'/'S/A', etc.)
  const normBuscado = normalizarNomeParaComparacao(rawNome)
  if (normBuscado) {
    // Casamento por igualdade dos tokens centrais normalizados
    const matchNormExato = cadastros.find((c) => {
      const cNorm = normalizarNomeParaComparacao(c.nome)
      return cNorm === normBuscado
    })
    if (matchNormExato) return matchNormExato

    // Casamento por tokens principais: AXA, Mitsui Sumitomo, Porto Seguro, Chubb, Allianz, Tokio Marine, Ezze, Zurich
    const matchPrefixOuInclusao = cadastros.find((c) => {
      const cNorm = normalizarNomeParaComparacao(c.nome)
      if (!cNorm) return false
      // Se um inclui o outro completamente
      if (cNorm.includes(normBuscado) || normBuscado.includes(cNorm)) return true
      return false
    })
    if (matchPrefixOuInclusao) return matchPrefixOuInclusao

    // Trata apelidos específicos de mercado (ex.: "MSIG" -> "Mitsui Sumitomo Seguros S.A.")
    if (normBuscado.includes('msig') || rawNome.toLowerCase().includes('msig')) {
      const msigMatch = cadastros.find((c) => {
        const cLower = c.nome.toLowerCase()
        return cLower.includes('mitsui') || cLower.includes('msig')
      })
      if (msigMatch) return msigMatch
    }
  }

  // 4. Casamento com gabarito estático canônico caso o cadastro esteja vazio
  const canonicaEstatica = SEGURADORAS_CANONICAS_DEFAULT.find((def) => {
    if (cnpjLimpo && limparCnpj(def.cnpj) === cnpjLimpo) return true
    const defNorm = normalizarNomeParaComparacao(def.nome)
    if (
      normBuscado &&
      (defNorm === normBuscado || defNorm.includes(normBuscado) || normBuscado.includes(defNorm))
    ) {
      return true
    }
    return def.aliases.some((a) => {
      const aNorm = normalizarNomeParaComparacao(a)
      return aNorm === normBuscado || rawNome.toLowerCase().includes(a)
    })
  })

  if (canonicaEstatica) {
    const matchBancoPeloNomeEstatico = cadastros.find(
      (c) => c.nome.trim().toLowerCase() === canonicaEstatica.nome.toLowerCase(),
    )
    if (matchBancoPeloNomeEstatico) return matchBancoPeloNomeEstatico
  }

  return null
}

/**
 * Função canônica principal: normalizarSeguradora
 *
 * Busca o cadastro de seguradoras, tenta casar por CNPJ ou nome normalizado,
 * e opcionalmente cadastra automaticamente apenas se ninguém casar.
 */
export async function normalizarSeguradora(
  nomeOuTexto: string,
  options: NormalizarSeguradoraOptions = {},
): Promise<NormalizarSeguradoraResult> {
  const { cnpj, susep, razaoSocial, autoCadastrar = false, cadastrosExistentes } = options

  const rawNome = (nomeOuTexto || '').trim()
  const rawCnpj = cnpj || null
  const rawSusep = susep || null

  // Obtém lista de seguradoras existentes
  const cadastros = cadastrosExistentes || (await getSeguradorasCadastro())

  // Tenta casar
  const matched = casarSeguradoraComLista(rawNome, cadastros, rawCnpj)

  if (matched) {
    // Atualiza suavemente CNPJ ou SUSEP no cadastro caso ainda estejam vazios
    const cnpjLimpo = limparCnpj(rawCnpj)
    const hasNewCnpj = cnpjLimpo && !limparCnpj(matched.cnpj)
    const hasNewSusep =
      rawSusep && (!matched.observacoes || !matched.observacoes.includes(rawSusep))

    if (hasNewCnpj || hasNewSusep) {
      try {
        const updatePayload: Record<string, any> = {}
        if (hasNewCnpj && rawCnpj) {
          updatePayload.cnpj = formatarCnpj(rawCnpj)
        }
        if (hasNewSusep && rawSusep) {
          const currentObs = matched.observacoes || ''
          updatePayload.observacoes = currentObs
            ? `${currentObs} | SUSEP: ${rawSusep}`
            : `SUSEP: ${rawSusep}`
        }
        await pb.collection('seguradoras').update(matched.id, updatePayload)
        // Atualiza objeto em memória
        if (updatePayload.cnpj) matched.cnpj = updatePayload.cnpj
        if (updatePayload.observacoes) matched.observacoes = updatePayload.observacoes
      } catch (err) {
        console.warn('Aviso: Não foi possível atualizar metadados da seguradora:', err)
      }
    }

    return {
      id: matched.id,
      nomeCanonica: matched.nome,
      cnpj: matched.cnpj || (rawCnpj ? formatarCnpj(rawCnpj) : undefined),
      susep: rawSusep || undefined,
      matched: true,
      autoCadastrada: false,
    }
  }

  // Se casou com o gabarito canônico estático, usa o nome oficial canônico
  const cnpjLimpo = limparCnpj(rawCnpj)
  const normBuscado = normalizarNomeParaComparacao(rawNome)
  const canonicaEstatica = SEGURADORAS_CANONICAS_DEFAULT.find((def) => {
    if (cnpjLimpo && limparCnpj(def.cnpj) === cnpjLimpo) return true
    const defNorm = normalizarNomeParaComparacao(def.nome)
    if (
      normBuscado &&
      (defNorm === normBuscado || defNorm.includes(normBuscado) || normBuscado.includes(defNorm))
    ) {
      return true
    }
    return def.aliases.some((a) => {
      const aNorm = normalizarNomeParaComparacao(a)
      return aNorm === normBuscado || rawNome.toLowerCase().includes(a)
    })
  })

  const nomeFinal = canonicaEstatica ? canonicaEstatica.nome : razaoSocial || rawNome
  const cnpjFinal = canonicaEstatica?.cnpj || (rawCnpj ? formatarCnpj(rawCnpj) : undefined)
  const susepFinal = canonicaEstatica?.susep || rawSusep || undefined

  // Se autoCadastrar for solicitado e não casou com nenhum registro existente no banco
  if (autoCadastrar && nomeFinal) {
    try {
      const hoje = new Date().toISOString().slice(0, 10)
      const obs = [
        'Cadastrada a partir de proposta/apólice (extração automática) — completar dados',
        cnpjFinal ? `CNPJ: ${cnpjFinal}` : '',
        susepFinal ? `SUSEP: ${susepFinal}` : '',
      ]
        .filter(Boolean)
        .join(' | ')

      const novoRec = await pb.collection('seguradoras').create<SeguradoraCadastroRecord>({
        nome: nomeFinal,
        cnpj: cnpjFinal || '',
        posicionamento: 'Seguradora de Ramos Elementares e P&C (Auto-cadastrada)',
        apetite_segmentos: { 'Hotéis & Resorts': 'Médio' },
        faixa_lmi: 'Sob consulta',
        condicoes_tipicas:
          'Cadastro originado automaticamente de processamento de apólice/proposta.',
        observacoes: obs,
        contatos: {
          email: '',
          telefone: '',
          responsavel: 'Cadastro via Sistema',
        },
        historico_relacionamento: [
          {
            data: hoje,
            fonte: 'Auto-cadastro',
            observacao: `Seguradora cadastrada automaticamente com nome canônico "${nomeFinal}"${
              cnpjFinal ? ` (CNPJ ${cnpjFinal})` : ''
            }.`,
          },
        ],
      })

      invalidateSeguradorasCache()

      return {
        id: novoRec.id,
        nomeCanonica: novoRec.nome,
        cnpj: novoRec.cnpj || cnpjFinal,
        susep: susepFinal,
        matched: false,
        autoCadastrada: true,
      }
    } catch (createErr) {
      console.warn('Erro ao auto-cadastrar seguradora:', createErr)
    }
  }

  return {
    nomeCanonica: nomeFinal,
    cnpj: cnpjFinal,
    susep: susepFinal,
    matched: false,
    autoCadastrada: false,
  }
}

/**
 * Função síncrona rápida para normalizar nome sem chamada de rede,
 * baseada no dicionário canônico oficial.
 */
export function normalizarNomeSeguradoraSync(
  nomeOuTexto: string,
  cnpjInformado?: string | null,
): string {
  if (!nomeOuTexto) return ''
  const cnpjLimpo = limparCnpj(cnpjInformado)
  const normBuscado = normalizarNomeParaComparacao(nomeOuTexto)

  const found = SEGURADORAS_CANONICAS_DEFAULT.find((def) => {
    if (cnpjLimpo && limparCnpj(def.cnpj) === cnpjLimpo) return true
    const defNorm = normalizarNomeParaComparacao(def.nome)
    if (
      normBuscado &&
      (defNorm === normBuscado || defNorm.includes(normBuscado) || normBuscado.includes(defNorm))
    ) {
      return true
    }
    return def.aliases.some((a) => {
      const aNorm = normalizarNomeParaComparacao(a)
      return aNorm === normBuscado || nomeOuTexto.toLowerCase().includes(a)
    })
  })

  if (found) return found.nome

  // Limpa sufixos de parênteses se houver
  const semParenteses = nomeOuTexto
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return semParenteses || nomeOuTexto
}
