migrate(
  (app) => {
    const colRfq = app.findCollectionByNameOrId('rfq')

    if (!colRfq.fields.getByName('kit_gerado')) {
      colRfq.fields.add(
        new BoolField({
          name: 'kit_gerado',
          required: false,
        }),
      )
    }

    if (!colRfq.fields.getByName('kit_gerado_em')) {
      colRfq.fields.add(
        new TextField({
          name: 'kit_gerado_em',
          required: false,
        }),
      )
    }

    app.save(colRfq)
  },
  (app) => {
    const colRfq = app.findCollectionByNameOrId('rfq')
    const kitGerado = colRfq.fields.getByName('kit_gerado')
    if (kitGerado) {
      colRfq.fields.removeByName('kit_gerado')
    }
    const kitGeradoEm = colRfq.fields.getByName('kit_gerado_em')
    if (kitGeradoEm) {
      colRfq.fields.removeByName('kit_gerado_em')
    }
    app.save(colRfq)
  },
)
