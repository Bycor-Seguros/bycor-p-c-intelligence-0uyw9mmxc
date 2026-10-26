migrate(
  (app) => {
    const empCol = app.findCollectionByNameOrId('empreendimentos')
    const apolCol = app.findCollectionByNameOrId('apolices')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    const colAuditoriaRodadas = new Collection({
      name: 'auditoria_rodadas',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'empreendimento',
          type: 'relation',
          collectionId: empCol.id,
          maxSelect: 1,
          cascadeDelete: false,
          required: true,
        },
        {
          name: 'apolice',
          type: 'relation',
          collectionId: apolCol.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'numero_rodada',
          type: 'number',
        },
        {
          name: 'data_rodada',
          type: 'date',
        },
        {
          name: 'produto_ramo',
          type: 'text',
        },
        {
          name: 'arquivo_origem',
          type: 'text',
        },
        {
          name: 'usuario_upload',
          type: 'relation',
          collectionId: usersCol.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'usuario_email',
          type: 'text',
        },
        {
          name: 'desfecho',
          type: 'text',
        },
        {
          name: 'total_divergencias',
          type: 'number',
        },
        {
          name: 'total_ressalvas_c5',
          type: 'number',
        },
        {
          name: 'snapshot_comparativo',
          type: 'json',
        },
        {
          name: 'ressalvas_marcadas',
          type: 'json',
        },
        {
          name: 'observacoes',
          type: 'text',
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        'CREATE INDEX idx_auditoria_rodadas_emp ON auditoria_rodadas (empreendimento)',
        'CREATE INDEX idx_auditoria_rodadas_apolice ON auditoria_rodadas (apolice)',
        'CREATE INDEX idx_auditoria_rodadas_created ON auditoria_rodadas (created DESC)',
      ],
    })
    app.save(colAuditoriaRodadas)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('auditoria_rodadas')
      app.delete(col)
    } catch (_) {}
  },
)
