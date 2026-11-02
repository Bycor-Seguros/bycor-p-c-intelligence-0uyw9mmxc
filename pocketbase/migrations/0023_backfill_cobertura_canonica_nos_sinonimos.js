migrate(
  (app) => {
    // Backfill idempotente: para todo cobertura_sinonimos com cobertura_canonica vazio,
    // preencher com o ID da coberturas_canonicas cujo nome = canonica_nome (case/trim tolerante).
    // PocketBase roda em SQLite.
    try {
      app
        .db()
        .newQuery(`
        UPDATE cobertura_sinonimos
        SET cobertura_canonica = (
          SELECT cc.id
          FROM coberturas_canonicas cc
          WHERE TRIM(LOWER(cc.nome)) = TRIM(LOWER(cobertura_sinonimos.canonica_nome))
          LIMIT 1
        )
        WHERE (cobertura_canonica IS NULL OR cobertura_canonica = '')
          AND canonica_nome IS NOT NULL
          AND canonica_nome != ''
          AND EXISTS (
            SELECT 1
            FROM coberturas_canonicas cc
            WHERE TRIM(LOWER(cc.nome)) = TRIM(LOWER(cobertura_sinonimos.canonica_nome))
          );
      `)
        .execute()
    } catch (err) {
      console.log('Aviso ao executar backfill de cobertura_canonica:', err)
    }
  },
  (app) => {
    // Reversão no-op para preservar integridade
  },
)
