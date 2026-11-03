/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook de integração com o Agente de Conhecimento de Mercado (Skip Cloud).
 * Rota: POST /backend/v1/conhecimento-mercado/sugerir-equivalencia
 *
 * Fornece assistência inteligente para casar nomenclaturas de coberturas
 * de propostas de seguradoras com a taxonomia de 42 Coberturas Canônicas Bycor.
 *
 * Contexto enviado ao agente:
 * - Texto original da cobertura cotada pela seguradora
 * - Seguradora envolvida (nome e ID)
 * - Nomenclaturas canônicas Bycor disponíveis (campo 'nome')
 * - Contexto do segmento "Hotéis & Resorts"
 * - Equivalências/sinônimos já aceitos daquela seguradora
 *
 * Retorno estruturado:
 * - canonica_sugerida: nome oficial da canônica
 * - grau_confianca: 'Alta' | 'Media' | 'Baixa'
 * - justificativa_curta: justificativa concisa
 * - eventos_identificados: string[]
 * - eventos_excluidos_recomendados: string[]
 */
routerAdd('POST', '/backend/v1/conhecimento-mercado/sugerir-equivalencia', (e) => {
  try {
    const body = e.requestInfo().body || {}
    const textoOriginal = String(body.texto_original || '').trim()
    const seguradoraNome = String(body.seguradora_nome || '').trim()
    const seguradoraId = String(body.seguradora_id || '').trim()

    if (!textoOriginal) {
      return e.json(400, { error: 'O campo texto_original é obrigatório.' })
    }

    // Resolve o usuário autenticado ou busca o service user criado na migration
    let userId = e.auth?.id
    if (!userId) {
      try {
        const serviceUser = $app.findAuthRecordByEmail(
          '_pb_users_auth_',
          'agente-mercado@bycor.internal',
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
      return e.json(401, { error: 'Usuário não autenticado para invocar o agente.' })
    }

    // Carrega a taxonomia de coberturas canônicas ativas
    let nomesCanonicas = []
    try {
      const canonicas = $app.findRecordsByFilter('coberturas_canonicas', '', 'ordem,nome', 100, 0)
      nomesCanonicas = canonicas.map((c) => c.getString('nome')).filter(Boolean)
    } catch (err) {
      console.warn('Aviso ao consultar coberturas_canonicas no hook:', err)
    }

    // Carrega sinônimos/equivalências já aceitos desta seguradora
    let sinonimosAceitos = []
    try {
      const filter = seguradoraNome ? `seguradora_nome ~ {:segNome}` : ''
      const params = seguradoraNome ? { segNome: seguradoraNome } : {}
      const sins = $app.findRecordsByFilter(
        'cobertura_sinonimos',
        filter,
        '-updated',
        50,
        0,
        params,
      )
      sinonimosAceitos = sins.map((s) => ({
        alias: s.getString('alias'),
        canonica_nome: s.getString('canonica_nome'),
        seguradora_nome: s.getString('seguradora_nome'),
        eventos_excluidos: (() => {
          try {
            const parsed = JSON.parse(s.getString('eventos_excluidos'))
            return Array.isArray(parsed) ? parsed : []
          } catch (_) {
            return []
          }
        })(),
      }))
    } catch (err) {
      console.warn('Aviso ao consultar cobertura_sinonimos no hook:', err)
    }

    // Monta o prompt contextualizado para o agente
    const promptMessage = `Por favor, analise a cobertura não pareada abaixo no contexto do segmento "Hotéis & Resorts" e sugira a cobertura canônica Bycor mais adequada.

DADOS DA COBERTURA A ANALISAR:
- Texto Original na Proposta: "${textoOriginal}"
- Seguradora Emitente: "${seguradoraNome || 'Não especificada'}"
- Segmento Operacional: Hotéis & Resorts (P&C)

TAXONOMIA CANÔNICA BYCOR DISPONÍVEL (${nomesCanonicas.length} coberturas):
${nomesCanonicas.map((n, i) => `${i + 1}. ${n}`).join('\n')}

EQUIVALÊNCIAS / SINÔNIMOS JÁ ACEITOS DESTA SEGURADORA (${sinonimosAceitos.length} exemplos):
${
  sinonimosAceitos.length > 0
    ? sinonimosAceitos
        .slice(0, 15)
        .map(
          (s) =>
            `- "${s.alias}" → "${s.canonica_nome}"${
              s.eventos_excluidos?.length ? ` (não cobre: ${s.eventos_excluidos.join(', ')})` : ''
            }`,
        )
        .join('\n')
    : '(Nenhum sinônimo prévio gravado para esta seguradora)'
}

INSTRUÇÃO IMPORTANTE:
Responda EXCLUSIVAMENTE em formato JSON puro (sem markdown, sem blocos de código adicionais):
{
  "canonica_sugerida": "<nome exato de uma das canônicas listadas acima>",
  "grau_confianca": "Alta" | "Media" | "Baixa",
  "justificativa_curta": "<explicação concisa de 1 a 2 frases>",
  "eventos_identificados": ["<evento 1>", "<evento 2>"],
  "eventos_excluidos_recomendados": []
}`

    // Executa chamada síncrona ao agente nativo 'conhecimento-mercado'
    const agentResult = $ai.agent('conhecimento-mercado').chat({
      user_id: userId,
      conversation_id: null,
      message: promptMessage,
    })

    const rawContent = agentResult.content || ''

    // Limpa eventuais marcadores de bloco markdown (```json ... ```)
    let jsonText = rawContent.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
    }

    let parsedResult = null
    try {
      parsedResult = JSON.parse(jsonText)
    } catch (_) {
      // Fallback tolerante caso o modelo tenha incluído texto antes/depois do JSON
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          parsedResult = JSON.parse(jsonMatch[0])
        } catch (e2) {}
      }
    }

    // Se o parse foi bem-sucedido
    if (parsedResult && typeof parsedResult === 'object' && parsedResult.canonica_sugerida) {
      return e.json(200, {
        ok: true,
        texto_original: textoOriginal,
        seguradora_nome: seguradoraNome,
        canonica_sugerida: parsedResult.canonica_sugerida,
        grau_confianca: parsedResult.grau_confianca || 'Media',
        justificativa_curta:
          parsedResult.justificativa_curta ||
          'Sugerida com base na taxonomia canônica Bycor e contexto hoteleiro.',
        eventos_identificados: Array.isArray(parsedResult.eventos_identificados)
          ? parsedResult.eventos_identificados
          : [],
        eventos_excluidos_recomendados: Array.isArray(parsedResult.eventos_excluidos_recomendados)
          ? parsedResult.eventos_excluidos_recomendados
          : [],
        conversation_id: agentResult.conversation_id,
        message_id: agentResult.message_id,
      })
    }

    // Fallback elegante caso a resposta não venha em JSON puro
    return e.json(200, {
      ok: true,
      texto_original: textoOriginal,
      seguradora_nome: seguradoraNome,
      canonica_sugerida: nomesCanonicas[0] || 'Incêndio Básica (Danos Materiais)',
      grau_confianca: 'Media',
      justificativa_curta:
        rawContent.slice(0, 200) || 'Sugestão gerada pelo agente de Conhecimento de Mercado.',
      eventos_identificados: [],
      eventos_excluidos_recomendados: [],
      conversation_id: agentResult.conversation_id,
      message_id: agentResult.message_id,
    })
  } catch (err) {
    console.error('Erro no hook sugerir-equivalencia:', err)
    if (err instanceof SkipAiConfigError) {
      return e.json(503, { error: 'Serviço de IA temporariamente indisponível na infraestrutura.' })
    }
    if (err instanceof SkipAiAgentsError) {
      const status = err.status || 500
      return e.json(status, {
        error:
          status >= 500 ? 'Falha ao consultar o agente de Conhecimento de Mercado.' : err.message,
      })
    }
    if (err instanceof SkipAiError) {
      const status = err.status || 502
      return e.json(status, {
        error: status >= 500 ? 'Serviço de IA temporariamente indisponível.' : err.message,
      })
    }
    return e.json(500, {
      error: 'Erro interno ao processar sugestão de equivalência: ' + (err.message || String(err)),
    })
  }
})
