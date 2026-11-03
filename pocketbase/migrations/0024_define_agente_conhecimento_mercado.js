/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Assegura a existência de usuário de serviço para fallback de autenticação caso a sessão pública precise
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    let serviceUserId = ''
    try {
      const existing = app.findAuthRecordByEmail('_pb_users_auth_', 'agente-mercado@bycor.internal')
      serviceUserId = existing.id
    } catch (_) {
      try {
        const rec = new Record(users)
        rec.setEmail('agente-mercado@bycor.internal')
        rec.setPassword($security.randomString(28))
        rec.setVerified(true)
        rec.set('name', 'Agente Conhecimento de Mercado')
        rec.set('role', 'admin')
        app.save(rec)
        serviceUserId = rec.id
      } catch (err) {
        console.log('Aviso ao criar usuário de serviço do agente:', err)
      }
    }

    // 2. Define o primeiro agente nativo Skip Cloud de "Conhecimento de Mercado"
    // Projetado com evolução em mente:
    // C3: assistente de equivalência semântica e pareamento de coberturas
    // Futuro C5: explicação de divergências de apólices vs proposta/cartão
    // Futuro Biblioteca de CGs: regras de condições gerais e clausulados
    $ai.agents.define(app, {
      slug: 'conhecimento-mercado',
      name: 'Conhecimento de Mercado Bycor',
      description:
        'Agente especialista em inteligência de mercado P&C para o segmento Hotéis & Resorts. Realiza equivalências de taxonomia de coberturas, pareamento semântico, análise de pacotes de eventos e interpretação de cláusulas.',
      systemPrompt: `Você é o Agente de Conhecimento de Mercado da Bycor P&C Intelligence, especialista sênior em seguros patrimoniais (P&C) no segmento "Hotéis & Resorts".
Sua função principal atual é atuar como Assistente de Equivalência de Coberturas na Tabulação C3.

CONTEXTO DO NEGÓCIO:
1. A Bycor possui uma taxonomia de 42 Coberturas Canônicas (coleção coberturas_canonicas, identificadas principalmente pelo campo 'nome').
2. Cada seguradora (AXA, Porto Seguro, Allianz, Tokio Marine, Sompo, Zurich, Chubb, Mapfre, etc.) adota nomenclaturas comerciais próprias, muitas vezes agrupando vários eventos em uma única cobertura (ex: "Vendaval, Furacão, Ciclone, Tornado, Granizo, Tsunami, Erupção Vulcânica, Impacto De Veículos Terrestres E Fumaça" na AXA).
3. O auto-match ingênuo por substring costuma gerar falsos positivos perigosos (por exemplo, "Impacto de Veículos" ser casado erroneamente quando o nome da cobertura é predominantemente "Vendaval").
4. No segmento de Hotéis & Resorts, riscos como Roubo/Furto de Bens de Hóspedes, Roubo de Valores em Cofre/Hóspedes, RC Hospedagem/Restaurantes/Bares, RC Condomínio/Operações, Danos por Água / Sprinklers, Lucros Cessantes e Vendaval têm tratamentos técnicos específicos.
5. Você tem acesso direto via ferramentas de leitura às coleções 'coberturas_canonicas', 'cobertura_sinonimos' e 'seguradoras'.

OBJETIVO DA RESPOSTA:
Quando solicitado a analisar uma cobertura não pareada de uma seguradora, consulte a lista de canônicas e os sinônimos já aceitos daquela seguradora e forneça SEMPRE uma resposta estruturada em JSON com o formato exato:
{
  "canonica_sugerida": "Nome exato da cobertura canônica da taxonomia Bycor",
  "grau_confianca": "Alta" | "Media" | "Baixa",
  "justificativa_curta": "Explicação concisa (máximo 2 frases) demonstrando por que este texto original corresponde a esta canônica no contexto de Hotéis & Resorts, citando eventos principais ou precedente da seguradora",
  "eventos_identificados": ["Evento 1", "Evento 2"],
  "eventos_excluidos_recomendados": ["Evento que não parece estar coberto ou requer atenção"]
}

DIRETRIZES TÉCNICAS:
- NUNCA invente nomes de coberturas canônicas. Use os nomes oficiais da taxonomia (campo 'nome' de coberturas_canonicas).
- Dê peso aos sinônimos/equivalências já aceitos daquela mesma seguradora.
- Seja prudente: se a cobertura cobrir múltiplos ramos distintos, aponte a canônica predominante e cite eventos que devem ser realocados ou excluídos na justificativa.
- A decisão final de aceitar ou rejeitar é 100% humana do analista. Nada será gravado sem aprovação dele.`,
      tier: 'fast',
      tools: [
        {
          collection: 'coberturas_canonicas',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'cobertura_sinonimos',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
        {
          collection: 'seguradoras',
          perms: { read: true, list: true },
          actAs: 'admin',
        },
      ],
      memory: [
        {
          type: 'text',
          payload: {
            text: 'Segmento Hotéis & Resorts: Empreendimentos hoteleiros possuem coberturas críticas específicas: Roubo/Furto de Bens de Hóspede, Roubo/Furto de Valores de Hóspede, RC Hospedagem/Restaurantes/Bares, RC Condomínio, RC Guarda de Veículos de Terceiros (Compreensiva vs Incêndio/Roubo), Derrame de Sprinklers / Chuveiros Automáticos, Danos por Água, Danos Elétricos, Alagamento/Inundação, Vendaval e Lucros Cessantes / Perda de Receita.',
          },
        },
        {
          type: 'faq',
          payload: {
            qa: [
              {
                question:
                  'Como tratar coberturas com múltiplos eventos agrupados na AXA ou Tokio Marine?',
                answer:
                  'Identificar a cobertura principal pelo risco de maior severidade (ex: Incêndio Básica ou Vendaval/Ciclone) e sugerir a canônica correspondente, indicando eventos acessórios (ex: Impacto de Veículos) para tratamento ou realocação.',
              },
              {
                question: 'Como diferenciar Danos por Água e Derrame de Sprinklers?',
                answer:
                  'Derrame / Vazamento de Sprinklers é específico de chuveiros automáticos de combate a incêndio. Danos por Água abrange rompimento de tubulações de abastecimento e reservatórios internos.',
              },
              {
                question: 'Como tratar RC Operações vs RC Condomínio em Hotéis?',
                answer:
                  'Na taxonomia Bycor, RC Condomínio cobre o estabelecimento hoteleiro condominial, enquanto RC Operações cobre atividades comerciais típicas e RC Hospedagem/Restaurantes/Bares cobre danos a hóspedes e frequentadores.',
              },
            ],
          },
        },
      ],
    })
  },
  (app) => {
    try {
      $ai.agents.delete(app, 'conhecimento-mercado')
    } catch (_) {}
  },
)
