migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')

    if (!col.fields.getByName('agravo')) {
      col.fields.add(new NumberField({ name: 'agravo' }))
    }
    if (!col.fields.getByName('premio_net_pos_agravo')) {
      col.fields.add(new NumberField({ name: 'premio_net_pos_agravo' }))
    }

    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('propostas')
      const fieldsToRemove = ['agravo', 'premio_net_pos_agravo']
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
