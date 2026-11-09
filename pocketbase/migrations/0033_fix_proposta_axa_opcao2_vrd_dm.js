migrate(
  (app) => {
    try {
      const proposta = app.findRecordById('propostas', 'yjm4fqdeu3c7asl')
      if (proposta) {
        proposta.set('vrd_dm', 60000000)
        app.save(proposta)
      }
    } catch (_) {
      // Se não existir o registro (ex: banco vazio), no-op
    }
  },
  (app) => {
    try {
      const proposta = app.findRecordById('propostas', 'yjm4fqdeu3c7asl')
      if (proposta) {
        proposta.set('vrd_dm', 80000000)
        app.save(proposta)
      }
    } catch (_) {
      // no-op
    }
  },
)
