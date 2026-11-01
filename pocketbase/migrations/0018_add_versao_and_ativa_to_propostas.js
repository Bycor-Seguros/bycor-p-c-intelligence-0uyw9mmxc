migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')

    if (!col.fields.getByName('versao')) {
      col.fields.add(new NumberField({ name: 'versao' }))
    }
    if (!col.fields.getByName('ativa')) {
      col.fields.add(new BoolField({ name: 'ativa' }))
    }

    app.save(col)

    // Backfill idempotente: registros sem versão recebem versão = 1 e ativa = true
    // Sem inventar registros; no-op em banco vazio
    app
      .db()
      .newQuery(`
      UPDATE propostas 
      SET versao = 1 
      WHERE versao IS NULL OR versao = 0
    `)
      .execute()

    app
      .db()
      .newQuery(`
      UPDATE propostas 
      SET ativa = 1 
      WHERE ativa IS NULL OR ativa = 0
    `)
      .execute()
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('propostas')
      const fieldsToRemove = ['versao', 'ativa']
      for (const f of fieldsToRemove) {
        const field = col.fields.getByName(f)
        if (field) {
          col.fields.remove(field)
        }
      }
      app.save(col)
    } catch (_) {}
  },
)
