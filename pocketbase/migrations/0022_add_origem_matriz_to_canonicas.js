migrate(
  (app) => {
    const colCanonicas = app.findCollectionByNameOrId('coberturas_canonicas')
    if (!colCanonicas.fields.getByName('origem_matriz')) {
      colCanonicas.fields.add(
        new TextField({
          name: 'origem_matriz',
          type: 'text',
          required: false,
        }),
      )
      app.save(colCanonicas)
    }

    // Se já existirem registros vindos da matriz (ex: 'Danos por Água / Sprinklers' ou 'Danos por Água'),
    // ou se a descrição indicar "Importada da Matriz de Mercado", preenchemos origem_matriz de forma preventiva caso esteja vazio.
    try {
      const records = app.findRecordsByFilter(
        'coberturas_canonicas',
        "descricao ~ 'Matriz de Mercado'",
        '',
        100,
        0,
      )
      for (const rec of records) {
        if (!rec.getString('origem_matriz')) {
          // Para "Danos por Água", como foi criada a partir de "Danos por Água / Sprinklers",
          // ou pelo seu próprio nome, definimos origem_matriz
          rec.set('origem_matriz', rec.getString('nome'))
          app.save(rec)
        }
      }
    } catch (_) {}
  },
  (app) => {
    try {
      const colCanonicas = app.findCollectionByNameOrId('coberturas_canonicas')
      colCanonicas.fields.removeByName('origem_matriz')
      app.save(colCanonicas)
    } catch (_) {}
  },
)
