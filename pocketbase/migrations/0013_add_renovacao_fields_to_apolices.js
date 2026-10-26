migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('apolices')

    // Adiciona campo 'renovada_em' (date) se não existir
    if (!collection.fields.getByName('renovada_em')) {
      collection.fields.add(
        new DateField({
          name: 'renovada_em',
          required: false,
        }),
      )
    }

    // Adiciona campo 'apolice_sucessora' (relation para a própria coleção apolices) se não existir
    if (!collection.fields.getByName('apolice_sucessora')) {
      collection.fields.add(
        new RelationField({
          name: 'apolice_sucessora',
          required: false,
          collectionId: collection.id,
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
    }

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('apolices')

    if (collection.fields.getByName('renovada_em')) {
      collection.fields.removeByName('renovada_em')
    }
    if (collection.fields.getByName('apolice_sucessora')) {
      collection.fields.removeByName('apolice_sucessora')
    }

    app.save(collection)
  },
)
