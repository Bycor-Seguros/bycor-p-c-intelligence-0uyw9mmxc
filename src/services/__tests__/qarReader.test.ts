import { describe, it, expect } from 'vitest'
import {
  parseQar21,
  parseValorQar,
  parsePercentualQar,
  isCoberturaPropertyQar,
  QAR_COBERTURAS_PROPERTY,
  QAR_LMGS_PADRAO,
  QAR_TIPOVALOR,
} from '../qarReader'

// FIXTURE SINTÉTICO no layout padrão do formulário Bycor (fixo) — nenhum dado
// de documento real do usuário é embutido aqui (regra estrita do projeto).
// A validação com o PDF real do caso Anália ocorre no Mac do usuário.
const LINHAS = [
  'QAR - Questionário de Avaliação de Risco RCG',
  'Segurado: Hotel Exemplo Ltda',
  'CNPJ: 00.000.000/0001-00',
  'Importância Segurada Pretendida: 20.000.000,00',
  '',
  '21. LIMITE MÁXIMO DE GARANTIA (LMG) POR COBERTURA - marcar e informar',
  'Indicar LMG pretendido por cobertura de RC (em % da IS pretendida ou valor)',
  'RC Operações (Estabelecimentos Comerciais/Industriais)   5%                    1.000.000,00',
  'RC Danos Morais                                          2%                    400.000,00',
  'RC Empregador                                            1%                    200.000,00',
  'RC Produtos e Trabalhos Concluídos                       3%                    600.000,00',
  'Poluição Súbita e Acidental                              0,5%                  100.000,00',
  'Percurso estabelecimento-garagem           1 km          X                     2.000.000,00',
  'Alagamento/Inundação                                     2%',
  'Danos por Água                                           1%',
  'Despesas de Salvamento e Contenção                       1%',
  'Colisão de Veículos de Terceiros Compreensiva            X                     2.000.000,00',
  'Portões Automáticos                                      X                     100.000,00',
  'RC Guarda de Veículos de Terceiros                       (sugestão)',
  'RC Síndico                                               (sugestão)',
  'Perda/Pagamento de Aluguel                               (sugestão)',
  '22. Observações',
  'Nada a observar',
]

const extrair = () => parseQar21(LINHAS)

describe('qarReader — item 21 (formulário padrão, fixture sintético)', () => {
  const res = extrair()

  it('extrai a IS pretendida do formulário', () => {
    expect(res.importanciaSeguradaPretendida).toBe(20_000_000)
  })

  it('extrai coberturas com % ou valor declarado e ignora sugestões', () => {
    const nomes = res.coberturas.map((c) => c.cobertura)
    expect(nomes).toContain('Poluição Súbita e Acidental')
    expect(nomes).toContain('Percurso estabelecimento-garagem')
    expect(nomes).toContain('Alagamento/Inundação')
    expect(nomes).toContain('Colisão de Veículos de Terceiros Compreensiva')
    expect(nomes).toContain('Portões Automáticos')
    // Sugestões do formulário nunca viram coberturas
    expect(nomes).not.toContain('RC Guarda de Veículos de Terceiros')
    expect(nomes).not.toContain('RC Síndico')
    expect(nomes).not.toContain('Perda/Pagamento de Aluguel')
    expect(res.sugestoesIgnoradas.length).toBe(3)
  })

  it('valores exatos do caso inaugural (Colisão 2.000.000; Portões 100.000)', () => {
    const colisao = res.coberturas.find((c) => /Colis/.test(c.cobertura))
    expect(colisao?.valorPretendido).toBe(2_000_000)
    expect(colisao?.tipoValor).toBe(QAR_TIPOVALOR.FIXO)
    const portoes = res.coberturas.find((c) => /Port.es Autom/.test(c.cobertura))
    expect(portoes?.valorPretendido).toBe(100_000)
  })

  it('Percurso extraído como declarado, com o detalhe de distância', () => {
    const percurso = res.coberturas.find((c) => /Percurso/.test(c.cobertura))
    expect(percurso).toBeDefined()
    expect(percurso?.valorPretendido).toBe(2_000_000)
    expect(percurso?.detalheKm).toBe('1 km')
  })

  it('Poluição e Alagamento extraídos como declarados (percentual da IS)', () => {
    const poluicao = res.coberturas.find((c) => /Polui/.test(c.cobertura))
    expect(poluicao?.percentual).toBe(0.5)
    expect(poluicao?.tipoValor).toBe(QAR_TIPOVALOR.PERCENTUAL)
    const alagamento = res.coberturas.find((c) => /Alagamento/.test(c.cobertura))
    expect(alagamento?.percentual).toBe(2)
    expect(alagamento?.valorPretendido).toBeNull()
  })

  it('cobre os 4 LMGs padrão marcados', () => {
    expect(res.lmgsMarcados.sort()).toEqual([...QAR_LMGS_PADRAO].sort())
    for (const lmg of QAR_LMGS_PADRAO) {
      const cob = res.coberturas.find((c) => c.cobertura === lmg)
      expect(cob?.lmgMarcado).toBe(true)
      expect(cob?.lmgIndex).toBeGreaterThan(0)
    }
  })

  it('coberturas de PROPERTY não aparecem na extração (fora do leitor)', () => {
    const nomes = res.coberturas.map((c) => c.cobertura)
    for (const p of QAR_COBERTURAS_PROPERTY) {
      expect(nomes).not.toContain(p)
      expect(isCoberturaPropertyQar(p)).toBe(true)
    }
    // A linha "Danos por Água 1%" existe no formulário mas é descartada
    expect(isCoberturaPropertyQar('Danos por Água')).toBe(true)
    expect(isCoberturaPropertyQar('Despesas de Salvamento e Contenção')).toBe(true)
    expect(isCoberturaPropertyQar('RC Operações')).toBe(false)
  })

  it('não marca LMG em cobertura fora da lista padrão', () => {
    const poluicao = res.coberturas.find((c) => /Polui/.test(c.cobertura))
    expect(poluicao?.lmgMarcado).toBe(false)
    expect(poluicao?.lmgIndex).toBeNull()
  })

  it('helpers de valor pt-BR', () => {
    expect(parseValorQar('R$ 2.000.000,00')).toBe(2_000_000)
    expect(parseValorQar('2.000.000')).toBe(2_000_000)
    expect(parsePercentualQar('0,5%')).toBe(0.5)
    expect(parsePercentualQar('5%')).toBe(5)
  })

  it('milhar sem R$ é corte de valor, X gruda no nome é removido e km vai no detalhe', () => {
    const brutas = parseQar21([
      '21. LIMITE MÁXIMO DE GARANTIA (LMG) POR COBERTURA - marcar e informar',
      'Colisão de Veículos de Terceiros Compreensiva 2.000.000',
      'Portões Automáticos 100.000',
      'Percurso entre o estabelecimento e a garagem 2.000.000 (1 KM)',
      'Guarda de Veículos de Terceiros Parcial',
      'Transporte de pessoas em veículos terrestres de terceiros',
      '22. Observações',
    ])
    const pega = (p: RegExp) => brutas.coberturas.find((c) => p.test(c.cobertura))
    const colisao = pega(/Colis/i)
    expect(colisao?.cobertura).toBe('Colisão de Veículos de Terceiros Compreensiva')
    expect(colisao?.valorPretendido).toBe(2_000_000)
    const portoes = pega(/Port.es Autom/i)
    expect(portoes?.cobertura).toBe('Portões Automáticos')
    expect(portoes?.valorPretendido).toBe(100_000)
    const percurso = pega(/Percurso/i)
    expect(percurso?.cobertura).toBe('Percurso entre o estabelecimento e a garagem')
    expect(percurso?.valorPretendido).toBe(2_000_000)
    expect(percurso?.detalheKm).toBe('1 km')
    // Sem marcação nem valor do formulário: continua sugestão (ignorada)
    expect(brutas.sugestoesIgnoradas).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Guarda de Ve/),
        expect.stringMatching(/Transporte de pessoas/),
      ]),
    )
    expect(brutas.coberturas.every((c) => !/Guarda de Ve/.test(c.cobertura))).toBe(true)
    expect(brutas.coberturas.every((c) => !/Transporte de pessoas/.test(c.cobertura))).toBe(true)
  })

  it('item 21 ausente => extração vazia (sem throw)', () => {
    const vazio = parseQar21(['texto qualquer', 'sem item 21'])
    expect(vazio.coberturas).toHaveLength(0)
    expect(vazio.lmgsMarcados).toHaveLength(0)
  })
})
