import { describe, it, expect } from 'vitest'
import {
  temSublimiteCustosDefesaOuSalvamento,
  derivarVigenciaStatusOportunidade,
} from '../analiticoCarteiraService'

describe('Regras do Painel de Oportunidades (analiticoCarteiraService)', () => {
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
})
