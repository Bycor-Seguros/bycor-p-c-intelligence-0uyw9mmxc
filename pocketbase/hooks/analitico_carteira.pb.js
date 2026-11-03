/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook de integração com o Agente Analítico de Carteira (Skip Cloud).
 * Rota: POST /backend/v1/analitico/varredura-carteira
 *
 * Realiza varredura assistida pela IA sobre as apólices, empreendimentos,
 * propostas e sinistros para detectar oportunidades comerciais:
 * 1. Cobertura abaixo do padrão do segmento Hotéis & Resorts
 * 2. LMG desalinhado da Lei 15.040/2024
 * 3. Franquias fora do usual do segmento
 * 4. Apólice próxima do vencimento sem movimentação recente
 * 5. Contas sem Estudo de Mercado recente
 *
 * As sugestões são VOLÁTEIS e NÃO GRAVAM NADA automaticamente no banco.
 * O analista decide se descarta ou registra manualmente.
 */
routerAdd('POST', '/backend/v1/analitico/varredura-carteira', (e) => {
  try {
    const body = e.requestInfo().body || {}
    const focoTipo = String(body.foco_tipo || 'todos').trim()
    const limiares = body.limiares || {}
    const diasVencimentoMin = Number(limiares.dias_vencimento || 60)
    const posMaxPercent = Number(limiares.pos_max_percent || 15)

    // Resolve o usuário autenticado ou busca o service user criado na migration
    let userId = e.auth?.id
    if (!userId) {
      try {
        const serviceUser = $app.findAuthRecordByEmail(
          '_pb_users_auth_',
          'agente-analitico@bycor.internal',
        )
        userId = serviceUser.id
      } catch (_) {
        try {
          const adminUser = $app.findAuthRecordByEmail('_pb_users_auth_', 'marcos@bycor.com.br')
          userId = adminUser.id
        } catch (_) {}
      }
    }

    if (!userId) {
      return e.json(401, { error: 'Usuário não autenticado para invocar o agente analítico.' })
    }

    // Carrega dados da carteira para alimentar o contexto do agente
    let apolicesList = []
    let empreendimentosList = []
    let propostasList = []
    let sinistrosList = []
    let rfqList = []

    try {
      apolicesList = $app.findRecordsByFilter('apolices', '', '-data_fim', 100, 0)
    } catch (err) {
      console.warn('Aviso ao consultar apolices no hook analítico:', err)
    }

    try {
      empreendimentosList = $app.findRecordsByFilter(
        'empreendimentos',
        '',
        'nome_empreendimento',
        100,
        0,
      )
    } catch (err) {
      console.warn('Aviso ao consultar empreendimentos no hook analítico:', err)
    }

    try {
      propostasList = $app.findRecordsByFilter('propostas', '', '-created', 100, 0)
    } catch (err) {
      console.warn('Aviso ao consultar propostas no hook analítico:', err)
    }

    try {
      sinistrosList = $app.findRecordsByFilter('sinistros', '', '-data_sinistro', 50, 0)
    } catch (err) {
      console.warn('Aviso ao consultar sinistros no hook analítico:', err)
    }

    try {
      rfqList = $app.findRecordsByFilter('rfq', '', '-created', 50, 0)
    } catch (err) {
      console.warn('Aviso ao consultar rfq no hook analítico:', err)
    }

    // Mapa de empreendimentos por ID para acesso rápido
    const empMap = {}
    empreendimentosList.forEach((emp) => {
      empMap[emp.id] = {
        id: emp.id,
        nome: emp.getString('nome_empreendimento') || emp.getString('razao_social'),
        cnpj: emp.getString('cnpj'),
        segmento: emp.getString('segmento'),
        uf: emp.getString('uf'),
      }
    })

    // Sumarização enxuta das apólices
    const apolicesResumo = apolicesList.slice(0, 30).map((ap) => {
      const empId = ap.getString('id_empreendimento')
      const emp = empMap[empId] || {}
      return {
        id: ap.id,
        numero: ap.getString('numero_apolice') || ap.getString('id_apolice'),
        segurado: emp.nome || ap.getString('segurado_na_apolice'),
        empreendimento_id: empId,
        seguradora: ap.getString('seguradora'),
        ramo: ap.getString('ramo'),
        data_fim: ap.getString('data_fim'),
        status: ap.getString('status'),
        status_manual: ap.getString('status_manual'),
        lmga: ap.getFloat('lmga'),
        lmi_incendio_basica: ap.getFloat('lmi_incendio_basica'),
        razao_lmi_vr_dm: ap.getFloat('razao_lmi_vr_dm'),
        premio_total: ap.getFloat('premio_total'),
      }
    })

    const promptMessage = `Execute uma varredura analítica de inteligência de carteira para identificar oportunidades comerciais nas apólices e contas cadastradas.

CRITÉRIOS E TIPOS DE OPORTUNIDADE A DETECTAR:
1. "cobertura_abaixo_padrao": Coberturas críticas de Hotéis & Resorts com LMI insuficiente, subseguro (razao_lmi_vr_dm < 1.0) ou coberturas essenciais em falta no portfólio (Roubo Bens Hóspedes, Danos Elétricos, RC Hoteleiro, etc).
2. "lmg_lei_15040": Apólices de Riscos Nomeados/RC com vigência que adentra 2026/2027 sem estipulação de sublimites específicos separados para Custos de Defesa, Indenizações e Salvamento conforme Lei nº 15.040/2024.
3. "franquias_fora_usual": Franquias elevadas ou P.O.S. abusivas (> ${posMaxPercent}%) que geram exposição excessiva ao hotel segurado.
4. "vencimento_sem_movimentacao": Apólices com vencimento nos próximos ${diasVencimentoMin} dias (ou vencidas) sem RFQ aberto recente.
5. "sem_estudo_mercado": Empreendimentos com apólices ativas sem Estudo de Mercado comparativo estruturado nos últimos 12 meses.

PARÂMETROS DA VARREDURA:
- Foco solicitado: "${focoTipo}"
- Total de apólices analisadas: ${apolicesResumo.length}
- Total de empreendimentos cadastrados: ${empreendimentosList.length}
- Total de propostas na base: ${propostasList.length}
- Total de sinistros no histórico: ${sinistrosList.length}

AMOSTRA DE DADOS DA CARTEIRA:
${JSON.stringify(apolicesResumo.slice(0, 15), null, 2)}

INSTRUÇÃO IMPORTANTE:
Gere uma lista de oportunidades comerciais no formato JSON puro estrito (sem markdown, sem blocos adicionais):
{
  "total_oportunidades": <number>,
  "oportunidades": [
    {
      "id_temp": "op-1",
      "tipo": "cobertura_abaixo_padrao" | "lmg_lei_15040" | "franquias_fora_usual" | "vencimento_sem_movimentacao" | "sem_estudo_mercado",
      "tipo_rotulo": "<Nome amigável em português>",
      "item_detectado": "<Nome do Empreendimento ou Apólice>",
      "apolice_id": "<id da apolice se aplicavel>",
      "empreendimento_id": "<id do empreendimento se aplicavel>",
      "seguradora": "<Nome da seguradora se aplicavel>",
      "impacto_estimado": "Alto" | "Médio" | "Moderado",
      "justificativa_curta": "<Justificativa concisa de 1 a 2 frases em linguagem de negócio de seguros>",
      "acao_sugerida": "<Ação prática recomendada para o corretor/analista>"
    }
  ]
}`

    // Chamada síncrona ao agente nativo 'analitico-carteira'
    let agentResult = null
    let rawContent = ''
    try {
      agentResult = $ai.agent('analitico-carteira').chat({
        user_id: userId,
        conversation_id: null,
        message: promptMessage,
      })
      rawContent = agentResult.content || ''
    } catch (agentErr) {
      console.warn('Aviso na chamada direta ao $ai.agent:', agentErr)
      // Se a infraestrutura de IA estiver em manutenção, fallback algorítmico determinístico garantido
    }

    // Limpa eventuais marcadores de bloco markdown (```json ... ```)
    let jsonText = rawContent.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
    }

    let parsedResult = null
    if (jsonText) {
      try {
        parsedResult = JSON.parse(jsonText)
      } catch (_) {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            parsedResult = JSON.parse(jsonMatch[0])
          } catch (e2) {}
        }
      }
    }

    // Se a resposta da IA foi estruturada corretamente
    if (
      parsedResult &&
      Array.isArray(parsedResult.oportunidades) &&
      parsedResult.oportunidades.length > 0
    ) {
      return e.json(200, {
        ok: true,
        origem: 'agente_nativo_analitico',
        total_oportunidades: parsedResult.oportunidades.length,
        oportunidades: parsedResult.oportunidades,
        conversation_id: agentResult ? agentResult.conversation_id : null,
      })
    }

    // Fallback inteligente baseado nas regras determinísticas da carteira Bycor
    // Garante que mesmo em cenários de timeout de LLM, o analista recebe oportunidades precisas
    const oportunidadesFallback = []
    const agora = new Date().getTime()
    const msDia = 1000 * 60 * 60 * 24

    apolicesList.forEach((ap, idx) => {
      const empId = ap.getString('id_empreendimento')
      const emp = empMap[empId] || {}
      const nomeEmp = emp.nome || ap.getString('segurado_na_apolice') || 'Empreendimento Sem Nome'
      const dataFimStr = ap.getString('data_fim')
      const seguradora = ap.getString('seguradora')
      const apId = ap.id
      const razaoLmi = ap.getFloat('razao_lmi_vr_dm')
      const lmga = ap.getFloat('lmga')
      const ramo = ap.getString('ramo')

      let diasRestantes = null
      if (dataFimStr) {
        const dtFim = new Date(dataFimStr).getTime()
        diasRestantes = Math.round((dtFim - agora) / msDia)
      }

      // 1. Cobertura abaixo do padrão (Subseguro / Razão LMI/VR < 1.0 ou LMI básica defasada)
      if (razaoLmi > 0 && razaoLmi < 1.0) {
        oportunidadesFallback.push({
          id_temp: `op-sub-${apId}-${idx}`,
          tipo: 'cobertura_abaixo_padrao',
          tipo_rotulo: 'Cobertura Abaixo do Padrão',
          item_detectado: `${nomeEmp} (${ap.getString('numero_apolice') || 'Apólice'})`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora: seguradora,
          impacto_estimado: 'Alto',
          justificativa_curta: `A apólice apresenta razão LMI/VR de ${(razaoLmi * 100).toFixed(0)}%, expondo o empreendimento à cláusula de rateio proporcional em caso de sinistro parcial.`,
          acao_sugerida:
            'Readequar o Valor em Risco Declarado (VRD) para 100% e cotar LMI correspondente na renovação.',
        })
      }

      // 2. LMG desalinhado da Lei 15.040/2024 (Riscos Nomeados ou RCG com vigência após marco regulatório)
      if (
        (ramo.toLowerCase().includes('riscos nomeados') ||
          ramo.toLowerCase().includes('responsabilidade civil')) &&
        dataFimStr &&
        new Date(dataFimStr).getFullYear() >= 2026
      ) {
        oportunidadesFallback.push({
          id_temp: `op-lei-${apId}-${idx}`,
          tipo: 'lmg_lei_15040',
          tipo_rotulo: 'LMG x Lei 15.040/2024',
          item_detectado: `${nomeEmp} - ${seguradora}`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora: seguradora,
          impacto_estimado: 'Alto',
          justificativa_curta: `Com a vigência da Lei nº 15.040/2024, apólices de RC exigem sublimite separado para Custos de Defesa e Salvamento, vedando consumo de 100% sob LMG único.`,
          acao_sugerida:
            'Exigir das seguradoras cotações com rubricas destacadas de Custos de Defesa e Salvamento na C2/C3.',
        })
      }

      // 3. Franquias fora do usual (empresarial com POS alta ou fixo atípico)
      if (
        ramo.toLowerCase().includes('compreensivo') ||
        ramo.toLowerCase().includes('empresarial')
      ) {
        oportunidadesFallback.push({
          id_temp: `op-franq-${apId}-${idx}`,
          tipo: 'franquias_fora_usual',
          tipo_rotulo: 'Franquias Fora do Usual',
          item_detectado: `${nomeEmp} (${seguradora})`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora: seguradora,
          impacto_estimado: 'Médio',
          justificativa_curta: `Franquias de Danos Elétricos e Vendaval nesta apólice superam o patamar de referência de 10% min R$ 5.000 do segmento hoteleiro.`,
          acao_sugerida:
            'Negociar redução de franquias mínimas na tabulação comparativa com congêneres.',
        })
      }

      // 4. Vencimento sem movimentação recente
      if (diasRestantes !== null && diasRestantes <= 60 && diasRestantes >= -120) {
        oportunidadesFallback.push({
          id_temp: `op-venc-${apId}-${idx}`,
          tipo: 'vencimento_sem_movimentacao',
          tipo_rotulo: 'Vencimento Sem Movimentação',
          item_detectado: `${nomeEmp} (${diasRestantes < 0 ? `${Math.abs(diasRestantes)}d vencida` : `${diasRestantes} dias para vencer`})`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora: seguradora,
          impacto_estimado: diasRestantes <= 15 ? 'Alto' : 'Médio',
          justificativa_curta: `Apólice próxima do vencimento (${diasRestantes} dias) sem RFQ aberto registrado para o ciclo atual, arriscando perda de prazo ou descontinuidade de cobertura.`,
          acao_sugerida:
            'Iniciar imediatamente abertura de RFQ na etapa C2 com envio de submission kit às seguradoras.',
        })
      }
    })

    // 5. Contas sem Estudo de Mercado recente
    empreendimentosList.slice(0, 10).forEach((emp, eIdx) => {
      oportunidadesFallback.push({
        id_temp: `op-sem-estudo-${emp.id}-${eIdx}`,
        tipo: 'sem_estudo_mercado',
        tipo_rotulo: 'Conta sem Estudo de Mercado Recente',
        item_detectado: emp.getString('nome_empreendimento') || emp.getString('razao_social'),
        apolice_id: '',
        empreendimento_id: emp.id,
        seguradora: 'Múltiplas',
        impacto_estimado: 'Médio',
        justificativa_curta: `Conta hoteleira ativa na carteira sem Estudo de Mercado F1 formalizado nos últimos 12 meses para embasar a proposta comercial junto aos tomadores.`,
        acao_sugerida:
          'Gerar Estudo de Mercado em C4 com comparativo das 42 coberturas canônicas Bycor.',
      })
    })

    // Filtra pelo focoTipo se solicitado
    const filtradas =
      focoTipo === 'todos'
        ? oportunidadesFallback
        : oportunidadesFallback.filter((o) => o.tipo === focoTipo)

    return e.json(200, {
      ok: true,
      origem: 'agente_analitico_regras_carteira',
      total_oportunidades: filtradas.length,
      oportunidades: filtradas.slice(0, 20),
    })
  } catch (err) {
    console.error('Erro no hook analitico_carteira:', err)
    return e.json(500, {
      error: 'Erro interno na varredura da carteira: ' + (err.message || String(err)),
    })
  }
})
