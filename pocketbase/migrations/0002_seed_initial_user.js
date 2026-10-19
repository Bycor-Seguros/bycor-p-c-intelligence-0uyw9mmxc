migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    // Seed initial admin user: marcos@bycor.com.br (also accepted admin@bycor.com.br)
    try {
      app.findAuthRecordByEmail('_pb_users_auth_', 'marcos@bycor.com.br')
    } catch (_) {
      const record = new Record(users)
      record.setEmail('marcos@bycor.com.br')
      record.setPassword('Skip@Pass')
      record.setVerified(true)
      record.set('name', 'Marcos (Admin Bycor)')
      try {
        record.set('role', 'admin')
      } catch (_) {}
      app.save(record)
    }

    try {
      app.findAuthRecordByEmail('_pb_users_auth_', 'admin@bycor.com.br')
    } catch (_) {
      const record2 = new Record(users)
      record2.setEmail('admin@bycor.com.br')
      record2.setPassword('Skip@Pass')
      record2.setVerified(true)
      record2.set('name', 'Administrador Bycor')
      try {
        record2.set('role', 'admin')
      } catch (_) {}
      app.save(record2)
    }
  },
  (app) => {
    try {
      const r1 = app.findAuthRecordByEmail('_pb_users_auth_', 'marcos@bycor.com.br')
      app.delete(r1)
    } catch (_) {}
    try {
      const r2 = app.findAuthRecordByEmail('_pb_users_auth_', 'admin@bycor.com.br')
      app.delete(r2)
    } catch (_) {}
  },
)
