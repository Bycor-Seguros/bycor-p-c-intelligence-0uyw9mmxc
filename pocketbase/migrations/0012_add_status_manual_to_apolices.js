migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('apolices')
    if (!col.fields.getByName('status_manual')) {
      col.fields.add(
        new SelectField({
          name: 'status_manual',
          values: ['Perdida', 'Em Emissão'],
          maxSelect: 1,
          required: false,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('apolices')
    const field = col.fields.getByName('status_manual')
    if (field) {
      col.fields.removeByName('status_manual')
      app.save(col)
    }
  },
)
