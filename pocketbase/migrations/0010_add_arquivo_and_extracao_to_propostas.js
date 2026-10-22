migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')

    // Adicionar campo de arquivo PDF/documento
    if (!col.fields.getByName('arquivo')) {
      col.fields.add(
        new FileField({
          name: 'arquivo',
          maxSelect: 1,
          maxSize: 52428800, // 50MB
          mimeTypes: ['application/pdf', 'application/x-pdf', 'application/octet-stream'],
        }),
      )
    }

    // Nome original do arquivo enviado
    if (!col.fields.getByName('arquivo_nome')) {
      col.fields.add(
        new TextField({
          name: 'arquivo_nome',
        }),
      )
    }

    // Tipo / extensão do arquivo
    if (!col.fields.getByName('arquivo_tipo')) {
      col.fields.add(
        new TextField({
          name: 'arquivo_tipo',
        }),
      )
    }

    // Metadados estruturados e JSON de extração automática
    if (!col.fields.getByName('arquivo_extracao')) {
      col.fields.add(
        new JSONField({
          name: 'arquivo_extracao',
          maxSize: 5242880, // 5MB
        }),
      )
    }

    // Número da cotação / proposta
    if (!col.fields.getByName('numero_cotacao')) {
      col.fields.add(
        new TextField({
          name: 'numero_cotacao',
        }),
      )
    }

    // Início e fim de vigência
    if (!col.fields.getByName('vigencia_inicio')) {
      col.fields.add(
        new DateField({
          name: 'vigencia_inicio',
        }),
      )
    }

    if (!col.fields.getByName('vigencia_fim')) {
      col.fields.add(
        new DateField({
          name: 'vigencia_fim',
        }),
      )
    }

    // Validade da cotação
    if (!col.fields.getByName('validade_cotacao')) {
      col.fields.add(
        new DateField({
          name: 'validade_cotacao',
        }),
      )
    }

    // Forma de pagamento
    if (!col.fields.getByName('forma_pagamento')) {
      col.fields.add(
        new TextField({
          name: 'forma_pagamento',
        }),
      )
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')
    const fieldsToRemove = [
      'arquivo',
      'arquivo_nome',
      'arquivo_tipo',
      'arquivo_extracao',
      'numero_cotacao',
      'vigencia_inicio',
      'vigencia_fim',
      'validade_cotacao',
      'forma_pagamento',
    ]
    for (const name of fieldsToRemove) {
      const f = col.fields.getByName(name)
      if (f) {
        col.fields.removeByName(name)
      }
    }
    app.save(col)
  },
)
