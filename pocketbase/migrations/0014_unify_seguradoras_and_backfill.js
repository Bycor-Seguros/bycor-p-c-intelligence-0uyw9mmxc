migrate(
  (app) => {
    // 1. Garantir campo cnpj na coleção seguradoras
    const segCol = app.findCollectionByNameOrId('seguradoras')
    if (!segCol.fields.getByName('cnpj')) {
      segCol.fields.add(
        new TextField({
          name: 'cnpj',
          required: false,
        }),
      )
      app.save(segCol)
    }

    // 2. Gravar CNPJ e dados cadastrais no dicionário canônico seguradoras
    // Chavear AXA (19.323.190/0001-06) e MSIG (33.016.221/0001-07)
    const dadosSeguradoras = [
      {
        nome: 'AXA Seguros S.A.',
        cnpj: '19.323.190/0001-06',
        posicionamento: 'Líder em P&C corporativo e Riscos Nomeados para hospitalidade',
        faixa_lmi: 'Até R$ 150M',
        condicoes_tipicas: 'Cláusulas amplas de danos por água, alagamento e vendaval',
        observacoes: 'CNPJ: 19.323.190/0001-06 | SUSEP: 0285-2',
        contatos: { email: 'corporate.pc@axa.com.br', telefone: '(11) 3000-1000' },
      },
      {
        nome: 'Mitsui Sumitomo Seguros S.A.',
        cnpj: '33.016.221/0001-07',
        posicionamento: 'Subscrição técnica rigorosa, parceira de longo prazo em grandes riscos',
        faixa_lmi: 'Até R$ 100M',
        condicoes_tipicas: 'Exigência de inspeção prévia de proteções contra incêndio',
        observacoes: 'CNPJ: 33.016.221/0001-07 | MSIG | SUSEP: 06602 / 05266',
        contatos: { email: 'subscricao@msig.com.br', telefone: '(11) 3100-5000' },
      },
      {
        nome: 'Porto Seguro Cia. de Seguros Gerais',
        cnpj: '61.198.164/0001-60',
        observacoes: 'CNPJ: 61.198.164/0001-60 | SUSEP: 05886',
      },
      {
        nome: 'Tokio Marine Seguradora S.A.',
        cnpj: '33.164.021/0001-00',
        observacoes: 'CNPJ: 33.164.021/0001-00 | SUSEP: 06157',
      },
      {
        nome: 'Chubb Seguros Brasil S.A.',
        cnpj: '03.502.099/0001-18',
        observacoes: 'CNPJ: 03.502.099/0001-18 | SUSEP: 06513',
      },
      {
        nome: 'Ezze Seguros S.A.',
        cnpj: '31.534.848/0001-24',
        observacoes: 'CNPJ: 31.534.848/0001-24 | SUSEP: 03158',
      },
      {
        nome: 'Allianz Seguros S.A.',
        cnpj: '061.573.796/0001-66',
        observacoes: 'CNPJ: 061.573.796/0001-66 | SUSEP: 15414.900340/2018-85',
      },
    ]

    for (const item of dadosSeguradoras) {
      try {
        const rec = app.findFirstRecordByData('seguradoras', 'nome', item.nome)
        let changed = false
        if (!rec.getString('cnpj') || rec.getString('cnpj') !== item.cnpj) {
          rec.set('cnpj', item.cnpj)
          changed = true
        }
        const currentObs = rec.getString('observacoes')
        if (item.observacoes && (!currentObs || !currentObs.includes(item.cnpj))) {
          rec.set(
            'observacoes',
            currentObs ? `${currentObs} | ${item.observacoes}` : item.observacoes,
          )
          changed = true
        }
        if (changed) {
          app.save(rec)
        }
      } catch (_) {
        // Se ainda não existir no cadastro (banco limpo), cadastra
        try {
          const newRec = new Record(segCol)
          newRec.set('nome', item.nome)
          newRec.set('cnpj', item.cnpj)
          if (item.posicionamento) newRec.set('posicionamento', item.posicionamento)
          if (item.faixa_lmi) newRec.set('faixa_lmi', item.faixa_lmi)
          if (item.condicoes_tipicas) newRec.set('condicoes_tipicas', item.condicoes_tipicas)
          if (item.observacoes) newRec.set('observacoes', item.observacoes)
          if (item.contatos) newRec.set('contatos', item.contatos)
          newRec.set('historico_relacionamento', [
            {
              data: new Date().toISOString().slice(0, 10),
              fonte: 'Cadastro Oficial Bycor',
              observacao: 'Seguradora com grafia canônica e CNPJ oficial.',
            },
          ])
          app.save(newRec)
        } catch (_) {}
      }
    }

    // 3. Backfill idempotente reescrevendo variantes nas coleções existentes
    // Apólices:
    // 'AXA Seguros S/A' -> 'AXA Seguros S.A.'
    app
      .db()
      .newQuery(`
      UPDATE apolices
      SET seguradora = 'AXA Seguros S.A.'
      WHERE seguradora = 'AXA Seguros S/A'
         OR seguradora = 'AXA Seguros SA'
         OR seguradora = 'AXA'
         OR (seguradora LIKE '%AXA%' AND seguradora != 'AXA Seguros S.A.')
    `)
      .execute()

    // 'Mitsui Sumitomo Seguros S.A. (MSIG)' -> 'Mitsui Sumitomo Seguros S.A.'
    app
      .db()
      .newQuery(`
      UPDATE apolices
      SET seguradora = 'Mitsui Sumitomo Seguros S.A.'
      WHERE seguradora = 'Mitsui Sumitomo Seguros S.A. (MSIG)'
         OR seguradora = 'Mitsui Sumitomo Seguros S/A'
         OR seguradora = 'Mitsui Sumitomo Seguros SA'
         OR seguradora = 'Mitsui'
         OR seguradora = 'MSIG'
         OR (seguradora LIKE '%Mitsui%' AND seguradora != 'Mitsui Sumitomo Seguros S.A.')
         OR (seguradora LIKE '%MSIG%' AND seguradora != 'Mitsui Sumitomo Seguros S.A.')
    `)
      .execute()

    // Histórico de alterações operacionais:
    app
      .db()
      .newQuery(`
      UPDATE historico
      SET cia = 'AXA Seguros S.A.'
      WHERE cia = 'AXA Seguros S/A'
         OR cia = 'AXA Seguros SA'
         OR (cia LIKE '%AXA%' AND cia != 'AXA Seguros S.A.')
    `)
      .execute()

    app
      .db()
      .newQuery(`
      UPDATE historico
      SET cia = 'Mitsui Sumitomo Seguros S.A.'
      WHERE cia = 'Mitsui Sumitomo Seguros S.A. (MSIG)'
         OR cia = 'Mitsui Sumitomo Seguros S/A'
         OR (cia LIKE '%Mitsui%' AND cia != 'Mitsui Sumitomo Seguros S.A.')
         OR (cia LIKE '%MSIG%' AND cia != 'Mitsui Sumitomo Seguros S.A.')
    `)
      .execute()
  },
  (app) => {
    // Reversão
  },
)
