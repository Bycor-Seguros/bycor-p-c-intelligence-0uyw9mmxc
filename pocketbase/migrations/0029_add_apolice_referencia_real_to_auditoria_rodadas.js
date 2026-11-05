migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('auditoria_rodadas')
    if (!col.fields.getByName('apolice_referencia_real')) {
      col.fields.add(
        new RelationField({
          name: 'apolice_referencia_real',
          collectionId: app.findCollectionByNameOrId('apolices').id,
          required: false,
          maxSelect: 1,
          cascadeDelete: false,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('auditoria_rodadas')
    if (col.fields.getByName('apolice_referencia_real')) {
      col.fields.removeByName('apolice_referencia_real')
      app.save(col)
    }
  },
)
