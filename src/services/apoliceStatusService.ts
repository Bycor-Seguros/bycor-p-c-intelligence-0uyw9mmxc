/**
 * Utilitário de derivação dinâmica de status de apólices e relacionamento de sucessão/renovação.
 * Regras do Bycor P&C Intelligence:
 *
 * 1. Status derivado da vigência: se a data fim da vigência < hoje, nunca exibir "ATIVA"
 * 2. Sucessão de apólices: se existir apólice mais recente para o mesmo empreendimento + ramo,
 *    marcar a vencida como "Renovada", mostrando "Sucedida pela apólice [nº]";
 *    na sucessora, mostrar "Renova a apólice [nº]".
 * 3. Sem sucessora: status "Vencida", com ação na Ficha para o usuário classificar manualmente como "Perdida" ou "Em Emissão".
 *    "Em Emissão" pode ser revertida ou quando a nova apólice for emitida, a sucessora domina -> "Renovada".
 * 4. Não alterar dados importados: a regra é em tempo de leitura. Status manuais ("Perdida", "Em Emissão")
 *    ficam gravados em `status_manual`.
 * 5. Apólices sem data fim conhecida (vigência em aberto, ex.: "Condomínio São International Square"
 *    com data_fim vazia/nula) não devem ser marcadas como vencidas; comportamento atual preservado.
 */

export type StatusDerivado =
  | 'ATIVA'
  | 'A VENCER'
  | 'RENOVADA'
  | 'VENCIDA'
  | 'PERDIDA'
  | 'EM EMISSÃO'
  | 'PROSPECT'
  | 'NÃO RENOVADA'

export interface ApoliceMinima {
  id: string
  id_apolice?: string
  numero_apolice?: string
  id_empreendimento?: string
  segurado_na_apolice?: string
  cnpj_segurado?: string
  ramo?: string
  data_inicio?: string
  data_fim?: string
  status?: string
  status_manual?: 'Perdida' | 'Em Emissão' | string | null
  renovada_em?: string | null
  apolice_sucessora?: string | null
  expand?: {
    id_empreendimento?: {
      id?: string
      id_empreendimento?: string
      nome_empreendimento?: string
    }
    apolice_sucessora?: {
      id?: string
      numero_apolice?: string
      id_apolice?: string
      data_inicio?: string
      data_fim?: string
    }
  }
}

export interface RelacaoSucessao {
  sucessora?: ApoliceMinima
  antecessora?: ApoliceMinima
  statusDerivado: StatusDerivado
}

/**
 * Normaliza strings de ramos para agrupamento inteligente por ramo e produto.
 * Exemplos:
 * - "Empresarial (inclui RC Condomínio)" e "Empresarial Hotéis/Motéis/Pousadas" -> "empresarial"
 * - "Riscos Nomeados (Prédio)" -> "riscos_nomeados_predio"
 * - "Responsabilidade Civil Geral" -> "rcg"
 */
export function normalizarRamoParaSucessao(ramoRaw?: string | null): string {
  if (!ramoRaw) return 'geral'
  const norm = ramoRaw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  // RC Geral / RCG
  if (
    norm.includes('responsabilidade civil') ||
    norm.includes('rcg') ||
    norm.includes('51 -') ||
    norm.includes('0351')
  ) {
    return 'rcg'
  }

  // Riscos Nomeados - se tiver prédio vs conteúdo
  if (norm.includes('riscos nomeados') || norm.includes('01.96') || norm.includes('0196')) {
    if (norm.includes('predio') && !norm.includes('conteudo')) {
      return 'riscos_nomeados_predio'
    }
    if (norm.includes('conteudo') && !norm.includes('predio')) {
      return 'riscos_nomeados_conteudo'
    }
    return 'riscos_nomeados'
  }

  // Riscos Diversos
  if (norm.includes('riscos diversos') || norm.includes('01.71') || norm.includes('0171')) {
    return 'riscos_diversos'
  }

  // Empresarial / Compreensivo
  if (
    norm.includes('empresarial') ||
    norm.includes('compreensivo') ||
    norm.includes('01.18') ||
    norm.includes('0118')
  ) {
    if (norm.includes('conteudo') && !norm.includes('predio')) {
      return 'empresarial_conteudo'
    }
    return 'empresarial'
  }

  // Fallback: remover caracteres especiais e usar o termo normalizado
  return norm.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')
}

/**
 * Obtém a chave de agrupamento da unidade de renovação:
 * empreendimento + ramo normalizado.
 */
export function getChaveRenovacao(apolice: ApoliceMinima): string {
  const empId =
    apolice.id_empreendimento ||
    apolice.expand?.id_empreendimento?.id ||
    apolice.expand?.id_empreendimento?.id_empreendimento ||
    apolice.cnpj_segurado ||
    apolice.segurado_na_apolice ||
    'sem_emp'

  const ramoNorm = normalizarRamoParaSucessao(apolice.ramo)
  return `${empId}:::${ramoNorm}`
}

/**
 * Converte data em timestamp para comparação de datas.
 * Aceita "YYYY-MM-DD" ou formato ISO.
 */
function parseDateMs(dateStr?: string | null): number | null {
  if (!dateStr || !dateStr.trim()) return null
  try {
    const clean = dateStr.slice(0, 10)
    const [y, m, d] = clean.split('-').map(Number)
    if (y && m && d) {
      return new Date(y, m - 1, d).getTime()
    }
    const dt = new Date(dateStr)
    return isNaN(dt.getTime()) ? null : dt.getTime()
  } catch {
    return null
  }
}

/**
 * Retorna o início do dia atual em milissegundos (00:00:00).
 */
export function getHojeMs(): number {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return hoje.getTime()
}

/**
 * Constrói o mapa de sucessão e status derivado para uma lista completa de apólices.
 */
export function buildMapaSucessao(apolices: ApoliceMinima[]): Map<string, RelacaoSucessao> {
  const mapa = new Map<string, RelacaoSucessao>()
  const hojeMs = getHojeMs()

  // Index rápido por id para relacionamento direto de apolice_sucessora
  const porId = new Map<string, ApoliceMinima>()
  for (const ap of apolices) {
    if (ap.id) porId.set(ap.id, ap)
  }

  // Agrupar apólices por unidade de renovação (empreendimento + ramo)
  const grupos = new Map<string, ApoliceMinima[]>()
  for (const ap of apolices) {
    const chave = getChaveRenovacao(ap)
    const list = grupos.get(chave) || []
    list.push(ap)
    grupos.set(chave, list)
  }
  // Para cada grupo, ordenar cronologicamente por vigência (data_fim ou data_inicio)
  grupos.forEach((itens) => {
    // Ordenar do mais antigo ao mais recente
    const sorted = [...itens].sort((a, b) => {
      const fimA = parseDateMs(a.data_fim) ?? parseDateMs(a.data_inicio) ?? 0
      const fimB = parseDateMs(b.data_fim) ?? parseDateMs(b.data_inicio) ?? 0
      if (fimA !== fimB) return fimA - fimB
      const iniA = parseDateMs(a.data_inicio) ?? 0
      const iniB = parseDateMs(b.data_inicio) ?? 0
      return iniA - iniB
    })

    for (let i = 0; i < sorted.length; i++) {
      const atual = sorted[i]
      const fimAtualMs = parseDateMs(atual.data_fim)
      const iniAtualMs = parseDateMs(atual.data_inicio)
      const rawStatus = (atual.status || '').toLowerCase().trim()
      const manual = (atual.status_manual || '').trim()

      // Localizar sucessora imediata ou mais recente que seja posterior
      let sucessora: ApoliceMinima | undefined = undefined
      for (let j = i + 1; j < sorted.length; j++) {
        const candidata = sorted[j]
        const fimCandMs = parseDateMs(candidata.data_fim)
        const iniCandMs = parseDateMs(candidata.data_inicio)

        // Candidata é mais recente se o fim ou início for maior que a atual
        const candPosterior =
          (fimCandMs && fimAtualMs && fimCandMs > fimAtualMs) ||
          (iniCandMs && iniAtualMs && iniCandMs > iniAtualMs) ||
          (fimCandMs &&
            fimAtualMs &&
            fimCandMs === fimAtualMs &&
            iniCandMs &&
            iniAtualMs &&
            iniCandMs > iniAtualMs)

        if (candPosterior) {
          sucessora = candidata
          break
        }
      }

      // Se a apólice tiver apolice_sucessora persistida explicitamente, priorizar essa referência
      if (!sucessora && atual.apolice_sucessora) {
        sucessora = porId.get(atual.apolice_sucessora) || {
          id: atual.apolice_sucessora,
          numero_apolice: atual.expand?.apolice_sucessora?.numero_apolice,
          id_apolice: atual.expand?.apolice_sucessora?.id_apolice,
          data_inicio: atual.expand?.apolice_sucessora?.data_inicio,
          data_fim: atual.expand?.apolice_sucessora?.data_fim,
        }
      }

      // Localizar antecessora imediata (a apólice que esta renova)
      let antecessora: ApoliceMinima | undefined = undefined
      for (let j = i - 1; j >= 0; j--) {
        const candidata = sorted[j]
        const fimCandMs = parseDateMs(candidata.data_fim)
        const iniCandMs = parseDateMs(candidata.data_inicio)

        const candAnterior =
          (fimCandMs && fimAtualMs && fimCandMs < fimAtualMs) ||
          (iniCandMs && iniAtualMs && iniCandMs < iniAtualMs)

        if (candAnterior) {
          antecessora = candidata
          break
        }
      }

      // Regra 1 e 5: Verificar vigência
      let statusDerivado: StatusDerivado

      if (rawStatus === 'prospect') {
        // Preservar status de prospect se aplicável e sem vigência fechada vencida
        if (fimAtualMs && fimAtualMs < hojeMs) {
          statusDerivado = 'VENCIDA'
        } else {
          statusDerivado = 'PROSPECT'
        }
      } else if (!fimAtualMs) {
        // Apólices sem data fim conhecida (vigência em aberto): preservar status base
        if (rawStatus === 'prospect') {
          statusDerivado = 'PROSPECT'
        } else if (rawStatus === 'ativa') {
          statusDerivado = 'ATIVA'
        } else {
          statusDerivado = 'ATIVA'
        }
      } else if (
        rawStatus === 'renovada' ||
        sucessora ||
        atual.apolice_sucessora ||
        atual.renovada_em
      ) {
        // Se já foi renovada (explicitamente gravada ou inferida por sucessora posterior)
        statusDerivado = 'RENOVADA'
      } else if (fimAtualMs < hojeMs) {
        // Data fim < hoje: NUNCA exibir "ATIVA"
        if (manual === 'Perdida') {
          statusDerivado = 'PERDIDA'
        } else if (manual === 'Em Emissão') {
          statusDerivado = 'EM EMISSÃO'
        } else {
          // Sem sucessora -> Vencida
          statusDerivado = 'VENCIDA'
        }
      } else {
        // Vigência ainda válida (fimAtualMs >= hojeMs)
        if (rawStatus === 'a vencer' || fimAtualMs - hojeMs <= 30 * 24 * 60 * 60 * 1000) {
          statusDerivado = 'A VENCER'
        } else {
          statusDerivado = 'ATIVA'
        }
      }

      mapa.set(atual.id, {
        sucessora,
        antecessora,
        statusDerivado,
      })
    }
  })

  return mapa
}

/**
 * Calcula a relação e status derivado para uma única apólice no contexto de sua lista de irmãs.
 */
export function getStatusDerivadoSingle(
  apolice: ApoliceMinima,
  todasApolices: ApoliceMinima[],
): RelacaoSucessao {
  const mapa = buildMapaSucessao(todasApolices)
  const rel = mapa.get(apolice.id)
  if (rel) return rel

  // Fallback caso não esteja no mapa
  const hojeMs = getHojeMs()
  const fimMs = parseDateMs(apolice.data_fim)
  const manual = (apolice.status_manual || '').trim()

  if (!fimMs) {
    return {
      statusDerivado: (apolice.status as any) || 'ATIVA',
    }
  }

  const rawSt = (apolice.status || '').toLowerCase().trim()
  if (rawSt === 'renovada' || apolice.apolice_sucessora || apolice.renovada_em) {
    return { statusDerivado: 'RENOVADA' }
  }

  if (fimMs < hojeMs) {
    if (manual === 'Perdida') return { statusDerivado: 'PERDIDA' }
    if (manual === 'Em Emissão') return { statusDerivado: 'EM EMISSÃO' }
    return { statusDerivado: 'VENCIDA' }
  }

  return { statusDerivado: 'ATIVA' }
}

/**
 * Retorna as informações visuais de badge para qualquer status derivado ou padrão.
 */
export function getStatusDerivadoBadgeInfo(status: string | null | undefined): {
  label: string
  bg: string
  color: string
} {
  const norm = (status || '').toLowerCase().trim()
  switch (norm) {
    case 'ativa':
      return {
        label: 'Ativa',
        bg: 'bg-[#DCFCE7] text-[#16A34A] border-[#86EFAC]',
        color: '#16A34A',
      }
    case 'a vencer':
      return {
        label: 'A Vencer',
        bg: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
        color: '#D97706',
      }
    case 'vencida':
      return {
        label: 'Vencida',
        bg: 'bg-[#FEE2E2] text-[#DC2626] border-[#FCA5A5]',
        color: '#DC2626',
      }
    case 'renovada':
      return {
        label: 'Renovada',
        bg: 'bg-[#DBEAFE] text-[#1E40AF] border-[#93C5FD]',
        color: '#1E40AF',
      }
    case 'perdida':
      return {
        label: 'Perdida',
        bg: 'bg-gray-100 text-gray-700 border-gray-300',
        color: '#4B5563',
      }
    case 'em emissão':
    case 'em emissao':
      return {
        label: 'Em Emissão',
        bg: 'bg-blue-50 text-blue-700 border-blue-200',
        color: '#1D4ED8',
      }
    case 'não renovada':
    case 'nao renovada':
      return {
        label: 'Não Renovada',
        bg: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
        color: '#4B5563',
      }
    case 'prospect':
      return {
        label: 'Prospect',
        bg: 'bg-[#EDE9FE] text-[#6D28D9] border-[#DDD6FE]',
        color: '#6D28D9',
      }
    default:
      return {
        label: status || 'Desconhecido',
        bg: 'bg-gray-100 text-gray-700 border-gray-200',
        color: '#6B7280',
      }
  }
}
