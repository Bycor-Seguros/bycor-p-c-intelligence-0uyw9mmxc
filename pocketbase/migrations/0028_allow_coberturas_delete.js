migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('coberturas')
    col.deleteRule = "@request.auth.id != ''"
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('coberturas')
    col.deleteRule = "@request.auth.role = 'admin'"
    app.save(col)
  },
)
