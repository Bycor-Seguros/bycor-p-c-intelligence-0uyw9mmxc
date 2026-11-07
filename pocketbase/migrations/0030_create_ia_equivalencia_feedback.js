/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const seguradorasId = app.findCollectionByNameOrId('seguradoras').id
    const canonicasId = app.findCollectionByNameOrId('coberturas_canonicas').id
    const usersId = '_pb_users_auth_'

    // Coleção de log/feedback das decisões do analista sobre sugestões de IA
    // (Agente de Conhecimento de Mercado) no ciclo C3 — Tabulação.
    // Registra confirmações E rejeições, sempre com o par (alias x canônica)
    // e o agente usado. A decisão humana é a verdade final; a IA só sugere.
    const col = new Collection({
      name: 'ia_equivalencia_feedback',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: '',
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        // 'confirmada' = analista aceitou o pareamento sugerido
        // 'rejeitada'  = analista rejeitou a sugestão
        { name: 'decisao', type: 'select', required: true, values: ['confirmada', 'rejeitada'] },
        { name: 'alias', type: 'text', required: true },
        {
          name: 'seguradora',
          type: 'relation',
          collectionId: seguradorasId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'seguradora_nome', type: 'text' },
        {
          name: 'cobertura_canonica',
          type: 'relation',
          collectionId: canonicasId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'canonica_sugerida', type: 'text', required: true },
        { name: 'grau_confianca', type: 'select', values: ['Alta', 'Media', 'Baixa'] },
        { name: 'justificativa', type: 'text' },
        { name: 'eventos_identificados', type: 'json' },
        { name: 'eventos_excluidos_recomendados', type: 'json' },
        { name: 'conversation_id', type: 'text' },
        { name: 'message_id', type: 'text' },
        { name: 'agente_slug', type: 'text', required: true },
        {
          name: 'rfq',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('rfq').id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'analista',
          type: 'relation',
          collectionId: usersId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      ],
      indexes: [
        'CREATE INDEX idx_ia_eq_fb_alias ON ia_equivalencia_feedback (alias)',
        'CREATE INDEX idx_ia_eq_fb_seg ON ia_equivalencia_feedback (seguradora)',
        'CREATE INDEX idx_ia_eq_fb_can ON ia_equivalencia_feedback (cobertura_canonica)',
        'CREATE INDEX idx_ia_eq_fb_agente ON ia_equivalencia_feedback (agente_slug)',
      ],
    })
    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('ia_equivalencia_feedback')
      app.delete(col)
    } catch (_) {}
  },
)
