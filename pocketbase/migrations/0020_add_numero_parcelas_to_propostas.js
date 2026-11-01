migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')

    if (!col.fields.getByName('numero_parcelas')) {
      col.fields.add(new NumberField({ name: 'numero_parcelas' }))
    }

    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('propostas')
      const field = col.fields.getByName('numero_parcelas')
      if (field) {
        col.fields.remove(field)
      }
      app.save(col)
    } catch (_) {}
  },
)
