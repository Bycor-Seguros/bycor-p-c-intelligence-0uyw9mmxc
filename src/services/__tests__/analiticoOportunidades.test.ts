import { describe, it, expect } from 'vitest'
import {
  temSublimiteCustosDefesaOuSalvamento,
  derivarVigenciaStatusOportunidade,
  compararVrdEstagnado,
} from '../analiticoCarteiraService'

describe('Regras do Painel de Oportunidades (analiticoCarteiraService)', () => {
  it('compara VRD estagnado ano a ano sem falsos positivos (Regra 6)', () => {
    // Marca quando ambos são maiores que zero e idênticos
    expect(compararVrdEstagnado(3137400, 3137400)).toBe(true)
    expect(compararVrdEstagnado(1000000.005, 1000000.001)).toBe(true)

    // Não marca quando os valores diferem
    expect(compararVrdEstagnado(3137400, 3500000)).toBe(false)
    expect(compararVrdEstagnado(5000000, 4800000)).toBe(false)

    // Sem dados anteriores ou atuais: não marca (sem falso positivo)
    expect(compararVrdEstagnado(0, 3137400)).toBe(false)
    expect(compararVrdEstagnado(3137400, 0)).toBe(false)
    expect(compararVrdEstagnado(null, 3137400)).toBe(false)
    expect(compararVrdEstagnado(3137400, null)).toBe(false)
    expect(compararVrdEstagnado(undefined, undefined)).toBe(false)
  })
  it('identifica corretamente apólices com e sem sublimite de Custos de Defesa / Salvamento', () => {
    const mapa = new Map<string, any[]>()
    // Apólice com Custos de Defesa
    mapa.set('ap_com_defesa', [
      {
        nome_cobertura: 'Responsabilidade Civil Geral',
        categoria_normalizada: 'RCG',
        observacao: '',
      },
      {
        nome_cobertura: 'Custos de Defesa do Segurado',
        categoria_normalizada: 'Honorários e Custos',
        observacao: 'Sublimite de R$ 500.000',
      },
    ])
    // Apólice sem Custos de Defesa
    mapa.set('ap_sem_defesa', [
      {
        nome_cobertura: 'Responsabilidade Civil Geral',
        categoria_normalizada: 'RCG',
        observacao: '',
      },
      {
        nome_cobertura: 'Danos Materiais e Corporais',
        categoria_normalizada: 'Danos a Terceiros',
        observacao: '',
      },
    ])

    expect(temSublimiteCustosDefesaOuSalvamento('ap_com_defesa', mapa)).toBe(true)
    expect(temSublimiteCustosDefesaOuSalvamento('ap_sem_defesa', mapa)).toBe(false)
  })

  it('deriva vigenciaStatus: em_renovacao prioritário quando há RFQ aberto', () => {
    const res = derivarVigenciaStatusOportunidade(10, true)
    expect(res.status).toBe('em_renovacao')
    expect(res.detalhe).toContain('RFQ aberto')
  })

  it('deriva vigenciaStatus: vencida_recente para atraso até 30 dias', () => {
    const res = derivarVigenciaStatusOportunidade(-15, false)
    expect(res.status).toBe('vencida_recente')
    expect(res.detalhe).toContain('15 dias')
  })

  it('deriva vigenciaStatus: vigente para apólices ativas', () => {
    const res = derivarVigenciaStatusOportunidade(45, false)
    expect(res.status).toBe('vigente')
  })

  it('regra de ingestão C1: filtra estritamente coberturas com LMI preenchida (> 0)', () => {
    const coberturasBrutas = [
      {
        nomeOriginal: 'Básica - Incêndio / Raio / Explosão',
        isEscolhida: 42092117.12,
        isAtualizada: null,
        isAtual: null,
      },
      {
        nomeOriginal: 'Danos Elétricos',
        isEscolhida: null,
        isAtualizada: 500000,
        isAtual: null,
      },
      {
        nomeOriginal: 'Vendaval e Granizo',
        isEscolhida: null,
        isAtualizada: null,
        isAtual: 250000,
      },
      {
        nomeOriginal: 'Texto Informativo sem Cobertura / Linha Vazia',
        isEscolhida: null,
        isAtualizada: null,
        isAtual: null,
      },
      {
        nomeOriginal: 'Linha informativa com valor zero',
        isEscolhida: 0,
        isAtualizada: 0,
        isAtual: 0,
      },
      {
        nomeOriginal: 'Cláusula Adicional Texto',
        isEscolhida: undefined,
        isAtualizada: undefined,
        isAtual: undefined,
      },
    ]

    const coberturasFiltradas = coberturasBrutas.filter((c) => {
      const lmi = c.isEscolhida ?? c.isAtualizada ?? c.isAtual ?? null
      return typeof lmi === 'number' && lmi > 0
    })

    expect(coberturasFiltradas).toHaveLength(3)
    expect(coberturasFiltradas.map((c) => c.nomeOriginal)).toEqual([
      'Básica - Incêndio / Raio / Explosão',
      'Danos Elétricos',
      'Vendaval e Granizo',
    ])
  })
})
