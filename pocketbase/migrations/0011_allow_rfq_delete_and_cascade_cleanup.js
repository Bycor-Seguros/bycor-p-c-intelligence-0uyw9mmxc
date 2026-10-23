migrate(
  (app) => {
    // 1. Atualizar deleteRule de rfq, propostas, rfq_seguradoras e documentos
    // Permitir exclusão para usuários autenticados (ou admin)
    const colRfq = app.findCollectionByNameOrId('rfq')
    colRfq.deleteRule = "@request.auth.id != ''"
    app.save(colRfq)

    const colPropostas = app.findCollectionByNameOrId('propostas')
    colPropostas.deleteRule = "@request.auth.id != ''"
    app.save(colPropostas)

    const colRfqSeg = app.findCollectionByNameOrId('rfq_seguradoras')
    colRfqSeg.deleteRule = "@request.auth.id != ''"
    app.save(colRfqSeg)

    const colDocs = app.findCollectionByNameOrId('documentos')
    colDocs.deleteRule = "@request.auth.id != ''"
    app.save(colDocs)
  },
  (app) => {
    try {
      const colRfq = app.findCollectionByNameOrId('rfq')
      colRfq.deleteRule = "@request.auth.role = 'admin'"
      app.save(colRfq)

      const colPropostas = app.findCollectionByNameOrId('propostas')
      colPropostas.deleteRule = "@request.auth.role = 'admin'"
      app.save(colPropostas)

      const colRfqSeg = app.findCollectionByNameOrId('rfq_seguradoras')
      colRfqSeg.deleteRule = "@request.auth.role = 'admin'"
      app.save(colRfqSeg)

      const colDocs = app.findCollectionByNameOrId('documentos')
      colDocs.deleteRule = "@request.auth.role = 'admin'"
      app.save(colDocs)
    } catch (_) {}
  },
)
