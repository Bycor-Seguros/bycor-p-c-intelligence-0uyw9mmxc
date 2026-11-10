migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('pedido_emissao')
    if (!col.fields.getByName('cosegurado_nome')) {
      col.fields.add(new TextField({ name: 'cosegurado_nome' }))
    }
    if (!col.fields.getByName('cosegurado_cnpj')) {
      col.fields.add(new TextField({ name: 'cosegurado_cnpj' }))
    }
    if (!col.fields.getByName('cosegurado_participacao')) {
      col.fields.add(new TextField({ name: 'cosegurado_participacao' }))
    }
    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('pedido_emissao')
      const f1 = col.fields.getByName('cosegurado_nome')
      if (f1) col.fields.remove(f1)
      const f2 = col.fields.getByName('cosegurado_cnpj')
      if (f2) col.fields.remove(f2)
      const f3 = col.fields.getByName('cosegurado_participacao')
      if (f3) col.fields.remove(f3)
      app.save(col)
    } catch (_) {}
  },
)
