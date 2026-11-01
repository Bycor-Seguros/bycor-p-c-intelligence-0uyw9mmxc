migrate(
  (app) => {
    // 1. coberturas_canonicas
    // Representa a taxonomia canônica Bycor (cada uma declarando os eventos típicos que contém).
    const colCanonicas = new Collection({
      name: 'coberturas_canonicas',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'nome', type: 'text', required: true },
        { name: 'ramo', type: 'text' },
        { name: 'descricao', type: 'text' },
        { name: 'eventos_tipicos', type: 'json' }, // Array de strings, ex: ["Incêndio", "Queda de Raio", "Explosão", "Implosão", "Queda de Aeronave", "Tumultos"]
        { name: 'ordem', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_cob_canonicas_nome ON coberturas_canonicas (nome)'],
    })
    app.save(colCanonicas)

    const canonicaId = app.findCollectionByNameOrId('coberturas_canonicas').id
    const seguradorasId = app.findCollectionByNameOrId('seguradoras').id

    // 2. cobertura_sinonimos
    // Coleção de sinônimos: alias-de-cia -> cobertura canônica
    // com exceções por evento:
    // - eventos_excluidos: ex.: ["Queda de Aeronave"] ("cobertura da cia não inclui evento Y")
    // - realocacoes_evento: ex.: [{ evento: "Queda de Aeronave", cobertura_destino: "Outros Riscos", motivo: "..." }]
    const colSinonimos = new Collection({
      name: 'cobertura_sinonimos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
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
          collectionId: canonicaId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'canonica_nome', type: 'text' },
        { name: 'eventos_excluidos', type: 'json' }, // string[]
        { name: 'realocacoes_evento', type: 'json' }, // Array<{ evento: string, cobertura_destino: string, motivo?: string }>
        { name: 'observacao', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_cob_sinonimos_alias ON cobertura_sinonimos (alias)',
        'CREATE INDEX idx_cob_sinonimos_seg ON cobertura_sinonimos (seguradora)',
        'CREATE INDEX idx_cob_sinonimos_can ON cobertura_sinonimos (cobertura_canonica)',
      ],
    })
    app.save(colSinonimos)
  },
  (app) => {
    try {
      const colSin = app.findCollectionByNameOrId('cobertura_sinonimos')
      app.delete(colSin)
    } catch (_) {}
    try {
      const colCan = app.findCollectionByNameOrId('coberturas_canonicas')
      app.delete(colCan)
    } catch (_) {}
  },
)
