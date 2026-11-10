// 0037: Bloco 11 — persistência dos contatos de inspeção POR EMPREENDIMENTO.
// Bug: os campos Contato/Telefone/E-mail de inspeção viviam só em useState na
// ApresentacaoPage e eram zerados a cada troca de empreendimento/F5.
// Guardamos os valores no cadastro do empreendimento (fonte por risco).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('empreendimentos')
    if (!col.fields.getByName('contato_inspecao_nome')) {
      col.fields.add(new TextField({ name: 'contato_inspecao_nome', max: 300 }))
    }
    if (!col.fields.getByName('contato_inspecao_telefone')) {
      col.fields.add(new TextField({ name: 'contato_inspecao_telefone', max: 100 }))
    }
    if (!col.fields.getByName('contato_inspecao_email')) {
      col.fields.add(new TextField({ name: 'contato_inspecao_email', max: 300 }))
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('empreendimentos')
    for (const f of [
      'contato_inspecao_nome',
      'contato_inspecao_telefone',
      'contato_inspecao_email',
    ]) {
      const field = col.fields.getByName(f)
      if (field) col.fields.removeByName(f)
    }
    app.save(col)
  },
)
