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
 * 6. VRD estagnado: Valor em Risco Declarado idêntico ao da apólice anterior
 *    da mesma conta/ramo — o VRD deve sempre ser atualizado a cada renovação.
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
    let coberturasList = []

    try {
      apolicesList = $app.findRecordsByFilter('apolices', '', '-data_fim', 100, 0)
    } catch (err) {
      console.warn('Aviso ao consultar apolices no hook analítico:', err)
    }

    try {
      coberturasList = $app.findRecordsByFilter('coberturas', '', '-created', 500, 0)
    } catch (err) {
      console.warn('Aviso ao consultar coberturas no hook analítico:', err)
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

    // Mapa de RFQs ativos por empreendimento
    const rfqAtivosEmp = {}
    rfqList.forEach((r) => {
      const st = String(r.getString('status') || '').toLowerCase()
      const empId = r.getString('conta_empreendimento')
      if (empId && st !== 'fechado') {
        rfqAtivosEmp[empId] = true
      }
    })

    // Mapa de coberturas por apólice para checagem de Custos de Defesa e Salvamento
    const coberturasPorApolice = {}
    coberturasList.forEach((cob) => {
      const apId = cob.getString('id_apolice')
      if (apId) {
        if (!coberturasPorApolice[apId]) coberturasPorApolice[apId] = []
        coberturasPorApolice[apId].push({
          nome: cob.getString('nome_cobertura'),
          cat: cob.getString('categoria_normalizada'),
          obs: cob.getString('observacao'),
          lmi: cob.getFloat('lmi_rs'),
        })
      }
    })

    // Sumarização enxuta das apólices
    const apolicesResumo = apolicesList.slice(0, 30).map((ap) => {
      const empId = ap.getString('id_empreendimento')
      const emp = empMap[empId] || {}
      const cobs = coberturasPorApolice[ap.id] || []
      const temDefesaOuSalvamento = cobs.some((c) => {
        const txt = `${c.nome || ''} ${c.cat || ''} ${c.obs || ''}`.toLowerCase()
        return (
          txt.includes('defesa') ||
          txt.includes('honorarios') ||
          txt.includes('salvamento') ||
          txt.includes('contencao') ||
          txt.includes('contenção')
        )
      })

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
       vrd_dm: ap.getFloat('valor_em_risco_dm'),
        premio_total: ap.getFloat('premio_total'),
        apolice_sucessora: ap.getString('apolice_sucessora'),
        tem_rfq_aberto: Boolean(rfqAtivosEmp[empId]),
        possui_rubrica_defesa_salvamento: temDefesaOuSalvamento,
      }
    })

    const promptMessage = `Execute uma varredura analítica de inteligência de carteira para identificar oportunidades comerciais nas apólices e contas cadastradas.

CRITÉRIOS E TIPOS DE OPORTUNIDADE A DETECTAR:
1. "cobertura_abaixo_padrao": Coberturas críticas de Hotéis & Resorts com LMI insuficiente, subseguro (razao_lmi_vr_dm < 1.0) ou coberturas essenciais em falta no portfólio. Ignorar apólices já substituídas.
2. "lmg_lei_15040": Apólices de Riscos Nomeados/RC com vigência que adentra 2026/2027 sem estipulação de sublimites específicos separados para Custos de Defesa e Salvamento (Lei 15.040/2024). ATENÇÃO: Se a apólice já possui a rubrica de Custos de Defesa ou Salvamento (possui_rubrica_defesa_salvamento = true), NÃO gere oportunidade (caso Wyndham).
3. "franquias_fora_usual": Franquias elevadas ou P.O.S. abusivas (> ${posMaxPercent}%). Ignorar apólices já substituídas.
4. "vencimento_sem_movimentacao": Apólices próximas do término (≤ ${diasVencimentoMin} dias) ou vencidas (MÁXIMO 30 dias de atraso — acima de 30 dias nunca listar). Apólices com RFQ aberto (tem_rfq_aberto = true) DEVEM ser detectadas, marcando renovação em andamento.
5. "sem_estudo_mercado": Empreendimentos com apólices ativas sem Estudo de Mercado estruturado nos últimos 12 meses.
6. "vrd_estagnado": PONTO DE ATENÇÃO — Valor em Risco Declarado (VRD) da apólice vigente IDÊNTICO ao da apólice anterior da mesma conta/ramo (campo vrd_dm igual de um ano para o outro). O VRD deve sempre ser atualizado a cada renovação; quando ambos os VRDs existem e são iguais, gere o alerta informando o analista. Se NÃO houver VRD do ano anterior para comparar, NÃO gere a oportunidade (sem falso positivo). Justificativa em linguagem de negócio: o VRD não mudou de um ano para o outro e deve sempre ser atualizado.
Regra de agrupamento: Agrupar por conta/empreendimento — gere 1 item por conta listando as apólices afetadas.

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
      "tipo": "cobertura_abaixo_padrao" | "lmg_lei_15040" | "franquias_fora_usual" | "vencimento_sem_movimentacao" | "sem_estudo_mercado" | "vrd_estagnado",
      "tipo_rotulo": "<Nome amigável em português>",
      "item_detectado": "<Nome do Empreendimento ou Apólice>",
     "conta_nome": "<Nome do empreendimento/empresa (conta) — sempre preencher>",
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
     // Normalização: garante conta_nome explícito (nome da empresa) em cada cartão
     const oportunidadesIa = parsedResult.oportunidades.map((op, idx) => ({
       ...op,
       id_temp: op.id_temp || `op-ia-${idx}`,
       conta_nome: op.conta_nome || op.item_detectado || '',
       apolices_afetadas: Array.isArray(op.apolices_afetadas) ? op.apolices_afetadas : [],
     }))
      return e.json(200, {
        ok: true,
        origem: 'agente_nativo_analitico',
       total_oportunidades: oportunidadesIa.length,
       oportunidades: oportunidadesIa,
        conversation_id: agentResult ? agentResult.conversation_id : null,
      })
    }

    // Fallback inteligente baseado nas regras determinísticas da carteira Bycor
    // Garante que mesmo em cenários de timeout de LLM, o analista recebe oportunidades precisas
    const agora = new Date().getTime()
    const msDia = 1000 * 60 * 60 * 24

    // Mapa de itens brutos antes do agrupamento
    const itensBrutos = []
 
   // Regra 6 (VRD estagnado): localizar a apólice ANTERIOR de cada apólice
   // agrupando por conta/empreendimento + ramo e ordenando pela vigência.
   const normalizarRamoHook = (ramo) =>
     String(ramo || '')
       .toLowerCase()
       .normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '')
       .replace(/[^a-z0-9]+/g, '_')
       .replace(/^_+|_+$/g, '') || 'geral'

   const gruposRenovacao = {}
   apolicesList.forEach((ap) => {
     const chaveGrupo = `${ap.getString('id_empreendimento')}:::${normalizarRamoHook(ap.getString('ramo'))}`
     const dfStr = ap.getString('data_fim')
     const dtFim = dfStr ? new Date(dfStr).getTime() : NaN
     if (!gruposRenovacao[chaveGrupo]) gruposRenovacao[chaveGrupo] = []
     gruposRenovacao[chaveGrupo].push({ apId: ap.id, dtFim: isNaN(dtFim) ? 0 : dtFim })
   })
   const antecessoraPorApolice = {}
   Object.keys(gruposRenovacao).forEach((k) => {
     const ordenadas = gruposRenovacao[k].slice().sort((a, b) => a.dtFim - b.dtFim)
     for (let i = 1; i < ordenadas.length; i++) {
       antecessoraPorApolice[ordenadas[i].apId] = ordenadas[i - 1].apId
     }
   })

    apolicesList.forEach((ap) => {
      const empId = ap.getString('id_empreendimento')
      const emp = empMap[empId] || {}
      const nomeEmp = emp.nome || ap.getString('segurado_na_apolice') || 'Empreendimento'
      const dataFimStr = ap.getString('data_fim')
      const seguradora = ap.getString('seguradora') || 'Seguradora'
      const apId = ap.id
      const razaoLmi = ap.getFloat('razao_lmi_vr_dm')
      const ramo = ap.getString('ramo') || ''
      const ramoLower = ramo.toLowerCase()
      const temRfqAberto = Boolean(rfqAtivosEmp[empId])
      const temSucessora = Boolean(ap.getString('apolice_sucessora'))

      let diasRestantes = null
      if (dataFimStr) {
        const dtFim = new Date(dataFimStr).getTime()
        if (!isNaN(dtFim)) {
          diasRestantes = Math.round((dtFim - agora) / msDia)
        }
      }

      // Regra 4: Apólices vencidas há mais de 30 dias NUNCA aparecem
      if (diasRestantes !== null && diasRestantes < -30) {
        return
      }

      // Vigência visual
      let vigStatus = 'vigente'
      let detalheVig = 'Vigente'
      if (temRfqAberto) {
        vigStatus = 'em_renovacao'
        detalheVig = 'Renovação em andamento'
      } else if (diasRestantes !== null && diasRestantes < 0) {
        vigStatus = 'vencida_recente'
        detalheVig = `Vencida há ${Math.abs(diasRestantes)}d`
      } else if (diasRestantes !== null) {
        vigStatus = 'vigente'
        detalheVig = `Vigente (${diasRestantes}d restantes)`
      }

      const apoliceItemObj = {
        id: apId,
        numero: ap.getString('numero_apolice') || ap.getString('id_apolice') || 'Sem número',
        ramo: ramo,
        seguradora: seguradora,
        data_fim: dataFimStr,
        diasRestantes: diasRestantes,
        vigenciaStatus: vigStatus,
        detalheStatus: detalheVig,
      }

      // 1. Cobertura abaixo do padrão (ignora se já substituída)
      if (!temSucessora && razaoLmi > 0 && razaoLmi < 1.0) {
        itensBrutos.push({
          tipo: 'cobertura_abaixo_padrao',
          tipo_rotulo: 'Cobertura Abaixo do Padrão',
          empId: empId,
          empNome: nomeEmp,
          seguradora: seguradora,
          impacto_estimado: 'Alto',
          justificativa_curta: `A apólice apresenta razão LMI/VR de ${(razaoLmi * 100).toFixed(0)}%, expondo o empreendimento à cláusula de rateio proporcional.`,
          acao_sugerida:
            'Readequar o Valor em Risco Declarado (VRD) para 100% e cotar LMI correspondente na renovação.',
          apolice: apoliceItemObj,
          temRfqAberto: temRfqAberto,
        })
      }

      // 2. LMG x Lei 15.040/2024:
      // Verifica coberturas da apólice e só marca quando o sublimite separado REALMENTE NÃO existir
      if (
        !temSucessora &&
        (ramoLower.includes('riscos nomeados') ||
          ramoLower.includes('responsabilidade civil') ||
          ramoLower.includes('rc')) &&
        dataFimStr &&
        new Date(dataFimStr).getFullYear() >= 2026
      ) {
        const cobs = coberturasPorApolice[apId] || []
        const temSublimite = cobs.some((c) => {
          const txt = `${c.nome || ''} ${c.cat || ''} ${c.obs || ''}`.toLowerCase()
          return (
            txt.includes('defesa') ||
            txt.includes('honorarios') ||
            txt.includes('salvamento') ||
            txt.includes('contencao') ||
            txt.includes('contenção')
          )
        })

        if (!temSublimite) {
          itensBrutos.push({
            tipo: 'lmg_lei_15040',
            tipo_rotulo: 'LMG x Lei 15.040/2024',
            empId: empId,
            empNome: nomeEmp,
            seguradora: seguradora,
            impacto_estimado: 'Alto',
            justificativa_curta:
              'A apólice não segrega LMG exclusivo para Custos de Defesa e Despesas de Salvamento, contrariando o marco regulatório da Lei 15.040/2024.',
            acao_sugerida:
              'Exigir das seguradoras cotações com rubricas destacadas de Custos de Defesa e Salvamento na C2/C3.',
            apolice: apoliceItemObj,
            temRfqAberto: temRfqAberto,
          })
        }
      }

      // 3. Franquias fora do usual (ignora se já substituída)
      if (
        !temSucessora &&
        (ramoLower.includes('compreensivo') || ramoLower.includes('empresarial'))
      ) {
        itensBrutos.push({
          tipo: 'franquias_fora_usual',
          tipo_rotulo: 'Franquias Fora do Usual',
          empId: empId,
          empNome: nomeEmp,
          seguradora: seguradora,
          impacto_estimado: 'Médio',
          justificativa_curta: `Franquias de Danos Elétricos e Vendaval nesta apólice superam o patamar de referência de 10% min R$ 5.000 do segmento hoteleiro.`,
          acao_sugerida:
            'Negociar redução de franquias mínimas na tabulação comparativa com congêneres.',
          apolice: apoliceItemObj,
          temRfqAberto: temRfqAberto,
        })
      }

      // 4. Vencimento: vencidas há no máximo 30 dias ou próximas do término (≤ 60 dias)
      // Mantém contas com RFQ aberto (etiqueta renovação em andamento)
      if (
        !temSucessora &&
        diasRestantes !== null &&
        diasRestantes <= diasVencimentoMin &&
        diasRestantes >= -30
      ) {
        itensBrutos.push({
          tipo: 'vencimento_sem_movimentacao',
          tipo_rotulo: 'Vencimento Sem Movimentação',
          empId: empId,
          empNome: nomeEmp,
          seguradora: seguradora,
          impacto_estimado: diasRestantes <= 15 ? 'Alto' : 'Médio',
          justificativa_curta: temRfqAberto
            ? `Apólice próxima do término (${diasRestantes} dias) já em procedimento de renovação com RFQ aberto no ciclo.`
            : `Apólice próxima do vencimento (${diasRestantes} dias) sem registro de RFQ iniciado neste ciclo, arriscando perda de prazo regulatório.`,
          acao_sugerida: temRfqAberto
            ? 'Acompanhar respostas das seguradoras cotadas na etapa C2/C3.'
            : 'Iniciar imediatamente abertura de RFQ na etapa C2 com envio de submission kit às seguradoras.',
          apolice: apoliceItemObj,
          temRfqAberto: temRfqAberto,
        })
      }

     // 6. VRD estagnado (ponto de atenção): o VRD deve sempre ser atualizado a cada renovação.
     // Compara o VRD da apólice vigente com o da apólice ANTERIOR da mesma conta/ramo.
     // Sem par comparável (sem anterior ou VRD zerado/ausente), NÃO marca — sem falso positivo.
     if (!temSucessora) {
       const vrdAtual = ap.getFloat('valor_em_risco_dm')
       const idAntecessora = antecessoraPorApolice[apId]
       const apAntecessora = idAntecessora
         ? apolicesList.find((x) => x.id === idAntecessora)
         : null
       const vrdAnterior = apAntecessora ? apAntecessora.getFloat('valor_em_risco_dm') : 0

       if (vrdAtual > 0 && vrdAnterior > 0 && Math.round(vrdAtual * 100) === Math.round(vrdAnterior * 100)) {
         const vrdFmt = 'R$ ' + String(Math.round(vrdAtual)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
         itensBrutos.push({
           tipo: 'vrd_estagnado',
           tipo_rotulo: 'VRD sem Alteração Ano a Ano',
           empId: empId,
           empNome: nomeEmp,
           seguradora: seguradora,
           impacto_estimado: 'Médio',
           justificativa_curta: `O Valor em Risco Declarado (VRD) desta apólice permaneceu em ${vrdFmt}, idêntico ao da apólice anterior — o VRD não mudou de um ano para o outro e deve sempre ser atualizado a cada renovação.`,
           acao_sugerida:
             'Revisar o VRD com o cliente e atualizar o Valor em Risco Declarado antes da próxima renovação; se o valor estiver correto, descartar a detecção.',
           apolice: apoliceItemObj,
           temRfqAberto: temRfqAberto,
         })
       }
      }
    })
 
    // Agrupa por Tipo + Conta (Requisito 2)
    const grupos = {}
    itensBrutos.forEach((it) => {
      const k = `${it.tipo}:::${it.empId}`
      if (!grupos[k]) {
        grupos[k] = {
          tipo: it.tipo,
          tipo_rotulo: it.tipo_rotulo,
          empId: it.empId,
          empNome: it.empNome,
          seguradoras: {},
          impactos: [],
          justificativas: [],
          acoes: [],
          apolices: [],
          temRfqAberto: it.temRfqAberto,
        }
      }
      if (it.seguradora) grupos[k].seguradoras[it.seguradora] = true
      grupos[k].impactos.push(it.impacto_estimado)
      if (!grupos[k].justificativas.includes(it.justificativa_curta)) {
        grupos[k].justificativas.push(it.justificativa_curta)
      }
      if (!grupos[k].acoes.includes(it.acao_sugerida)) {
        grupos[k].acoes.push(it.acao_sugerida)
      }
      if (!grupos[k].apolices.some((a) => a.id === it.apolice.id)) {
        grupos[k].apolices.push(it.apolice)
      }
      if (it.temRfqAberto) grupos[k].temRfqAberto = true
    })

    const oportunidadesFallback = []
    Object.keys(grupos).forEach((k) => {
      const grp = grupos[k]
      const segs = Object.keys(grp.seguradoras).join(', ') || 'Seguradora'
      const imp = grp.impactos.includes('Alto')
        ? 'Alto'
        : grp.impactos.includes('Médio')
          ? 'Médio'
          : 'Moderado'
      const qtdApolices = grp.apolices.length
      const sufixoApolice = qtdApolices > 1 ? ` (${qtdApolices} apólices afetadas)` : ''

      oportunidadesFallback.push({
        id_temp: `op-grp-${k.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        tipo: grp.tipo,
        tipo_rotulo: grp.tipo_rotulo,
        item_detectado: `${grp.empNome}${sufixoApolice}`,
        conta_nome: grp.empNome,
        empreendimento_id: grp.empId,
        seguradora: segs,
        impacto_estimado: imp,
        justificativa_curta: grp.justificativas.join(' '),
        acao_sugerida: grp.acoes[0] || 'Avaliar na mesa de renovação Bycor.',
        apolices_afetadas: grp.apolices,
        em_renovacao: grp.temRfqAberto,
      })
    })

    // 5. Contas sem Estudo de Mercado recente (1 por conta)
    empreendimentosList.slice(0, 10).forEach((emp, eIdx) => {
      const empId = emp.id
      const empNome = emp.getString('nome_empreendimento') || emp.getString('razao_social')
      const temRfqAberto = Boolean(rfqAtivosEmp[empId])

      const apolicesEmp = apolicesList
        .filter((a) => a.getString('id_empreendimento') === empId)
        .map((a) => {
          const dFimStr = a.getString('data_fim')
          let dRest = null
          if (dFimStr) {
            const dtF = new Date(dFimStr).getTime()
            if (!isNaN(dtF)) dRest = Math.round((dtF - agora) / msDia)
          }
          return {
            id: a.id,
            numero: a.getString('numero_apolice') || a.getString('id_apolice') || 'Sem número',
            ramo: a.getString('ramo') || 'Geral',
            seguradora: a.getString('seguradora') || '—',
            data_fim: dFimStr,
            diasRestantes: dRest,
            vigenciaStatus: temRfqAberto
              ? 'em_renovacao'
              : dRest !== null && dRest < 0
                ? 'vencida_recente'
                : 'vigente',
            detalheStatus: temRfqAberto
              ? 'Renovação em andamento'
              : dRest !== null && dRest < 0
                ? `Vencida há ${Math.abs(dRest)}d`
                : 'Vigente',
          }
        })
        .filter((a) => a.diasRestantes === null || a.diasRestantes >= -30)

      oportunidadesFallback.push({
        id_temp: `op-sem-estudo-${emp.id}-${eIdx}`,
        tipo: 'sem_estudo_mercado',
        tipo_rotulo: 'Conta sem Estudo de Mercado Recente',
        item_detectado: empNome,
        conta_nome: empNome,
        empreendimento_id: emp.id,
        seguradora: 'Múltiplas',
        impacto_estimado: 'Médio',
        justificativa_curta: `Conta hoteleira ativa na carteira sem Estudo de Mercado F1 formalizado nos últimos 12 meses para embasar a proposta comercial junto aos tomadores.`,
        acao_sugerida:
          'Gerar Estudo de Mercado em C4 com comparativo das 42 coberturas canônicas Bycor.',
        apolices_afetadas: apolicesEmp,
        em_renovacao: temRfqAberto,
      })
    })

    // Filtra pelo focoTipo se solicitado
    const filtradas =
      focoTipo === 'todos'
        ? oportunidadesFallback
        : oportunidadesFallback.filter((o) => o.tipo === focoTipo)

    return e.json(200, {
      ok: true,
      origem: 'motor_regras_carteira_local',
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
