migrate(
  (app) => {
    const colDocumentos = app.findCollectionByNameOrId('documentos')
    const tipoField = colDocumentos.fields.getByName('tipo')

    if (tipoField) {
      const currentValues = tipoField.values || []
      if (!currentValues.includes('Base de Apólices')) {
        tipoField.values = [...currentValues, 'Base de Apólices']
        tipoField.maxSelect = 1
        app.save(colDocumentos)
      }
    }

    // Atualização idempotente dos registros existentes gerados por importação
    // Conforme pedido: documentos cuja versão = 'Importação Base Hotéis e Resorts' (ou legados 'Importação Guardia')
    // e tipo = 'Cartão de Risco' passam para tipo = 'Base de Apólices'
    app
      .db()
      .newQuery(`
      UPDATE documentos
      SET tipo = 'Base de Apólices'
      WHERE tipo = 'Cartão de Risco'
        AND (versao = 'Importação Base Hotéis e Resorts' OR versao = 'Importação Guardia')
    `)
      .execute()
  },
  (app) => {
    const colDocumentos = app.findCollectionByNameOrId('documentos')
    const tipoField = colDocumentos.fields.getByName('tipo')
    if (tipoField) {
      const currentValues = tipoField.values || []
      tipoField.values = currentValues.filter((v) => v !== 'Base de Apólices')
      app.save(colDocumentos)
    }
  },
)
