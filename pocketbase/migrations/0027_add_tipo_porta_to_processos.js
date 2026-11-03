migrate(
  (app) => {
    const addTipoPorta = (collectionName) => {
      try {
        const col = app.findCollectionByNameOrId(collectionName)
        if (!col.fields.getByName('tipo_porta')) {
          col.fields.add(
            new TextField({
              name: 'tipo_porta',
              required: false,
            }),
          )
          app.save(col)
        }
      } catch (e) {
        console.log('Aviso ao adicionar tipo_porta em ' + collectionName + ': ' + e)
      }
    }

    addTipoPorta('documentos')
    addTipoPorta('apolices')
    addTipoPorta('rfq')
  },
  (app) => {
    const removeTipoPorta = (collectionName) => {
      try {
        const col = app.findCollectionByNameOrId(collectionName)
        if (col.fields.getByName('tipo_porta')) {
          col.fields.removeByName('tipo_porta')
          app.save(col)
        }
      } catch (e) {}
    }

    removeTipoPorta('documentos')
    removeTipoPorta('apolices')
    removeTipoPorta('rfq')
  },
)
