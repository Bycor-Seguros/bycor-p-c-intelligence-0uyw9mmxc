/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Assegura a existência de usuário de serviço para fallback de autenticação caso a sessão pública precise
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    let serviceUserId = ''
    try {
      const existing = app.findAuthRecordByEmail(
        '_pb_users_auth_',
        'agente-analitico@bycor.internal',
      )
      serviceUserId = existing.id
    } catch (_) {
      try {
        const rec = new Record(users)
        rec.setEmail('agente-analitico@bycor.internal')
        rec.setPassword($security.randomString(28))
        rec.setVerified(true)
        rec.set('name', 'Agente Analítico de Carteira')
        rec.set('role', 'admin')
        app.save(rec)
        serviceUserId = rec.id
      } catch (err) {
        console.log('Aviso ao criar usuário de serviço do agente analítico:', err)
      }
    }

    // 2. Define o segundo agente nativo Skip Cloud: "Analítico" (slug: "analitico-carteira")
    // Acesso às coleções de apólices, propostas, empreendimentos e sinistros
    // Responsável por varredura assistida de oportunidades comerciais na carteira Bycor
    $ai.agents.define(app, {
      slug: 'analitico-carteira',
      name: 'Analítico de Carteira Bycor',
      description:
        'Agente analítico de inteligência de carteira P&C especializado no segmento Hotéis & Resorts. Analisa apólices, propostas, empreendimentos e sinistros para detectar oportunidades comerciais, defasagens de cobertura, desvios da Lei 15.040/2024, franquias anômalas, vencimentos estagnados e ausência de Estudo de Mercado.',
      systemPrompt: `Você é o Agente Analítico de Carteira da BYCOR Seguros, corretora de seguros especializada em riscos corporativos (P&C) no segmento "Hotéis & Resorts" (Riscos Nomeados e Operacionais - RN/RO, Compreensivo Empresarial e RCG).

SUA MISSÃO:
Analisar os dados estruturados da carteira (apólices vigentes e anteriores, coberturas contratadas, propostas tabuladas, sinistros históricos e cadastros de empreendimentos hoteleiros) e gerar SUGESTÕES de Oportunidades Comerciais para o analista Bycor.

IMPORTANTE: As oportunidades geradas são estritamente SUGESTÕES voláteis. Nenhuma alteração é gravada no banco de dados sem a decisão expressa e manual do analista.

TIPOS DE DETECÇÃO (5 Categorias de Oportunidades):
1. "cobertura_abaixo_padrao": Coberturas críticas do segmento Hotéis & Resorts ausentes ou com LMI substancialmente inferior à média/benchmark da carteira (ex.: Roubo de Bens de Hóspedes, Roubo de Valores em Cofre, RC Hospedagem/Restaurantes/Bares, Danos por Água / Sprinklers, Alagamento, Lucros Cessantes, Danos Elétricos).
2. "lmg_lei_15040": LMG e coberturas de Responsabilidade Civil desalinhadas com a Nova Lei de Seguros (Lei nº 15.040/2024, em vigor a partir de 11/12/2025), que exige limites específicos/separados para Custos de Defesa, Indenizações e Despesas de Salvamento, sem consumir 100% da capacidade comum.
3. "franquias_fora_usual": Franquias ou P.O.S. fora do usual de mercado no segmento (ex.: P.O.S. excessiva acima de 15%-20% ou valores mínimos desproporcionais que oneram o segurado hoteleiro).
4. "vencimento_sem_movimentacao": Apólices com término de vigência próximo (≤ 60 dias) ou já vencidas sem RFQ aberto, sem proposta tabulada ou sem movimentação de renovação iniciada.
5. "sem_estudo_mercado": Empreendimentos ou contas com apólice vigente mas sem Estudo de Mercado recente gerado (C4) para balizar a renovação com as seguradoras congêneres.

DIRETRIZES DE COMUNICAÇÃO:
- Use linguagem estritamente de negócio de seguros (P&C corporativo).
- Justificativa concisa, clara e orientada à ação comercial (máximo 2 a 3 frases por oportunidade).
- Cite os valores de LMI, vigência, prêmio ou histórico de sinistros relevantes quando cabível.
- Toda resposta de varredura automatizada deve ser formatada em JSON estruturado com os itens identificados.`,
      tier: 'fast',
      tools: [
        {
          collection: 'apolices',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'propostas',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'empreendimentos',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'sinistros',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'coberturas',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'rfq',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
      ],
      memory: [
        {
          type: 'text',
          payload: {
            text: 'Nova Lei de Seguros nº 15.040/2024: A partir de 11/12/2025, os contratos de Responsabilidade Civil devem estipular sublimite específico e separado para Custos de Defesa, Indenizações a terceiros e Despesas de Salvamento e Contenção, não podendo mais utilizar 100% da capacidade indistinta sob um único limite global.',
          },
        },
        {
          type: 'text',
          payload: {
            text: 'Padrão Hotéis & Resorts Bycor: Coberturas recomendadas no benchmark Bycor: Incêndio Básica com VRD atualizado (razão LMI/VRD ≥ 1.0 para afastar rateio), Danos Elétricos (mínimo 5% do VRD ou R$ 500k), Vendaval, Danos por Água / Sprinklers, Roubo/Furto de Bens de Hóspedes, Roubo de Valores em Cofre, RC Hospedagem e Guarda de Veículos, e Lucros Cessantes por período indenitário mínimo de 12 meses.',
          },
        },
        {
          type: 'faq',
          payload: {
            qa: [
              {
                question: 'Quando uma franquia é considerada fora do usual no segmento hoteleiro?',
                answer:
                  'Franquias percentuais acima de 15% a 20% com mínimos elevados (acima de R$ 30.000 ou R$ 50.000) em Danos Elétricos, Danos por Água ou Vendaval são atípicas e representam oportunidade de renegociação comercial com congêneres.',
              },
              {
                question: 'Como identificar apólice próxima do vencimento sem movimentação?',
                answer:
                  'Apólices com vigência final nos próximos 60 dias (ou vencidas) que não possuem registro de RFQ correspondente no ano corrente nem propostas tabuladas na coleção propostas.',
              },
              {
                question: 'O que caracteriza uma conta sem Estudo de Mercado recente?',
                answer:
                  'Empreendimento ativo na carteira sem RFQ tabulado ou sem estudo comparativo de mercado estruturado nas etapas C3/C4 nos últimos 12 meses.',
              },
            ],
          },
        },
      ],
    })
  },
  (app) => {
    try {
      $ai.agents.delete(app, 'analitico-carteira')
    } catch (_) {}
  },
)
