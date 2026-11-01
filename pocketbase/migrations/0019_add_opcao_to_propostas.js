migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')

    if (!col.fields.getByName('opcao')) {
      col.fields.add(new NumberField({ name: 'opcao' }))
    }

    app.save(col)

    // Backfill idempotente: registros sem opcao recebem opcao = 1
    // Mantém versao / ativa e cobre todos os registros existentes (inclusive AXA)
    // No-op em banco vazio
    app
      .db()
      .newQuery(`
      UPDATE propostas 
      SET opcao = 1 
      WHERE opcao IS NULL OR opcao = 0
    `)
      .execute()
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('propostas')
      const field = col.fields.getByName('opcao')
      if (field) {
        col.fields.remove(field)
      }
      app.save(col)
    } catch (_) {}
  },
)
