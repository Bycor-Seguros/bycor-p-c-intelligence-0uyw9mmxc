import { COBERTURAS_ESTUDO_42, CoberturaEstudoF1 } from './estudoMercadoCanonicas'
import {
  casarCoberturaComCanonica,
  normalizarTermoEquivalencia,
  CoberturaCanonicaRecord,
  CoberturaSinonimoRecord,
} from './equivalenciaCoberturasService'
import { formatFranquiaPadrao } from './franquiaNormalizer'

export interface PropostaInputEstudo {
  id: string
  seguradoraNome: string
  opcao?: number
  versao?: number
  ativa?: boolean
  premioTotalComIof: number
  premioLiquido?: number
  parcelamentoSemJurosTexto: string // ex: "4x", "7x"
  numeroParcelasSemJuros?: number
  numeroCoberturas?: number
  vrdDm?: number
  vrdLc?: number
  coberturasOriginais: any[] // array de coberturas salvas na proposta
}

export interface CelulaCoberturaEstudo {
  valorFormatado: string // "R$ 1.000.000,00" ou "✓" ou "X" ou "Sublimite 4.000.000" ou "Inserido no Vendaval" etc.
  rawLmi: number | null
  abaixoDoSolicitado: boolean
  inseridaEmOutra?: string
  sublimiteTexto?: string
  naoIncluida: boolean
  franquiaTexto: string // texto da franquia / POS original ou normalizada
}

export interface LinhaComparativaEstudo {
  item: CoberturaEstudoF1
  celulasPorProposta: Map<string, CelulaCoberturaEstudo> // chave: proposta.id
}

/**
 * Normaliza e formata LMI de número para o formato do Estudo
 */
export function formatLmiEstudo(lmi: number | null | undefined): string {
  if (lmi === null || lmi === undefined || isNaN(Number(lmi)) || Number(lmi) <= 0) {
    return 'X'
  }
  const val = Number(lmi)
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(val)
}

/**
 * Formata franquia para a célula da tabela POS & Franquias
 */
export function formatFranquiaEstudo(rawFranquia: any): string {
  if (!rawFranquia) return 'Não há'

  let rawStr = ''
  if (typeof rawFranquia === 'string') {
    rawStr = rawFranquia.trim()
  } else if (typeof rawFranquia === 'object') {
    if (rawFranquia.textoFormatado) return String(rawFranquia.textoFormatado).trim()
    if (rawFranquia.texto_formatado) return String(rawFranquia.texto_formatado).trim()
    if (rawFranquia.textoOriginal) rawStr = String(rawFranquia.textoOriginal).trim()
    else if (rawFranquia.texto_original) rawStr = String(rawFranquia.texto_original).trim()
    else if (rawFranquia.descricao) rawStr = String(rawFranquia.descricao).trim()
    else rawStr = String(rawFranquia)
  } else {
    rawStr = String(rawFranquia).trim()
  }

  if (!rawStr || rawStr === '-' || rawStr === '--') return 'Não há'
  if (rawStr.toLowerCase() === 'não há' || rawStr.toLowerCase() === 'nao ha') return 'Não há'

  // Padronização: franquias percentuais normalizadas como "X% min R$Y";
  // demais (valor fixo, dias, "Não Há") permanecem na nomenclatura original
  return formatFranquiaPadrao(rawStr)
}

/**
 * Constrói as 42 linhas da matriz comparativa cruzando as propostas com as 42 canônicas do Estudo.
 * Usa a taxonomia canônica da C3 + sinônimos + aliases conhecidos.
 */
export function resolverGradeEstudo42(params: {
  propostas: PropostaInputEstudo[]
  canonicasC3: CoberturaCanonicaRecord[]
  sinonimosC3: CoberturaSinonimoRecord[]
}): LinhaComparativaEstudo[] {
  const { propostas, canonicasC3, sinonimosC3 } = params

  return COBERTURAS_ESTUDO_42.map((cobEstudo) => {
    const celulasPorProposta = new Map<string, CelulaCoberturaEstudo>()

    propostas.forEach((prop) => {
      // 1. Procura cobertura na proposta que corresponda a esta linha
      let matchEncontrado: any = null
      let matchLmi: number | null = null
      let matchFranquia: string = 'Não há'
      let matchSublimite: string | undefined = undefined
      let matchInseridaEm: string | undefined = undefined

      // Percorre as coberturas da proposta
      for (const cob of prop.coberturasOriginais || []) {
        const rawNome =
          cob.nome || cob.cobertura || cob.categoria_normalizada || cob.categoriaNormalizada || ''
        if (!rawNome) continue

        const normNome = normalizarTermoEquivalencia(rawNome)

        // Casamento 1: Casamento direto com os aliases da cobEstudo
        const bateAlias = cobEstudo.aliasesCanonicos.some((alias) => {
          const normAlias = normalizarTermoEquivalencia(alias)
          return (
            normNome === normAlias || normNome.includes(normAlias) || normAlias.includes(normNome)
          )
        })

        // Casamento 2: Resolução via C3 (casarCoberturaComCanonica)
        let bateC3 = false
        if (!bateAlias && canonicasC3.length > 0) {
          const matchC3 = casarCoberturaComCanonica(
            rawNome,
            prop.seguradoraNome,
            canonicasC3,
            sinonimosC3,
          )
          const normC3 = normalizarTermoEquivalencia(matchC3.canonica || '')
          bateC3 = cobEstudo.aliasesCanonicos.some((alias) => {
            const normAlias = normalizarTermoEquivalencia(alias)
            return normC3 === normAlias || normC3.includes(normAlias) || normAlias.includes(normC3)
          })
          if (matchC3.realocacoes && matchC3.realocacoes.length > 0) {
            for (const r of matchC3.realocacoes) {
              const normDest = normalizarTermoEquivalencia(r.cobertura_destino || '')
              if (
                cobEstudo.aliasesCanonicos.some((a) => normalizarTermoEquivalencia(a) === normDest)
              ) {
                bateC3 = true
                matchInseridaEm = `Inserido no ${rawNome}`
              }
            }
          }
        }

        if (bateAlias || bateC3) {
          matchEncontrado = cob
          const numLmi =
            cob.lmi !== undefined && cob.lmi !== null && cob.lmi !== ''
              ? Number(cob.lmi)
              : cob.is !== undefined && cob.is !== null && cob.is !== ''
                ? Number(cob.is)
                : null
          matchLmi = numLmi
          matchFranquia = formatFranquiaEstudo(cob.franquia || cob.pos || cob.pos_franquia)
          if (cob.sublimite || cob.observacao?.toLowerCase().includes('sublimite')) {
            matchSublimite = cob.sublimite || cob.observacao
          }
          break
        }
      }

      // Se não encontrou cobertura, verifica se tem realocação registrada
      if (!matchEncontrado) {
        // Verifica se em sinonimos da seguradora há realocação para esta canônica
        for (const cob of prop.coberturasOriginais || []) {
          const rawNome = cob.nome || cob.cobertura || cob.categoriaNormalizada || ''
          const sinDaCia = sinonimosC3.find(
            (s) =>
              normalizarTermoEquivalencia(s.alias) === normalizarTermoEquivalencia(rawNome) &&
              (!s.seguradora_nome ||
                normalizarTermoEquivalencia(s.seguradora_nome) ===
                  normalizarTermoEquivalencia(prop.seguradoraNome)),
          )
          if (sinDaCia?.realocacoes_evento) {
            for (const r of sinDaCia.realocacoes_evento) {
              const normDest = normalizarTermoEquivalencia(r.cobertura_destino || '')
              if (
                cobEstudo.aliasesCanonicos.some((a) => normalizarTermoEquivalencia(a) === normDest)
              ) {
                matchInseridaEm = `Inserido no ${rawNome}`
                matchFranquia = formatFranquiaEstudo(cob.franquia || cob.pos)
                break
              }
            }
          }
          if (matchInseridaEm) break
        }
      }

      // Monta célula
      let valorFormatado = 'X'
      let abaixoDoSolicitado = false
      const naoIncluida = !matchEncontrado && !matchInseridaEm

      if (matchInseridaEm) {
        valorFormatado = matchInseridaEm
      } else if (matchEncontrado) {
        if (matchLmi !== null && !isNaN(matchLmi) && matchLmi > 0) {
          const lmiStr = formatLmiEstudo(matchLmi)
          // Compara com solicitado
          const lmiSolNum =
            typeof cobEstudo.lmiSolicitado === 'number' ? cobEstudo.lmiSolicitado : null
          if (lmiSolNum !== null && matchLmi < lmiSolNum) {
            abaixoDoSolicitado = true
            valorFormatado = `${lmiStr} (↓)`
          } else {
            valorFormatado = lmiStr
          }
        } else if (matchSublimite) {
          valorFormatado = matchSublimite
        } else {
          valorFormatado = '✓'
        }
      }

      celulasPorProposta.set(prop.id, {
        valorFormatado,
        rawLmi: matchLmi,
        abaixoDoSolicitado,
        inseridaEmOutra: matchInseridaEm,
        sublimiteTexto: matchSublimite,
        naoIncluida,
        franquiaTexto: matchEncontrado || matchInseridaEm ? matchFranquia : 'X',
      })
    })

    return {
      item: cobEstudo,
      celulasPorProposta,
    }
  })
}
