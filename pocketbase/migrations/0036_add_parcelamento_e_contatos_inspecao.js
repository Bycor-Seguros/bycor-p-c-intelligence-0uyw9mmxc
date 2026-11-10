// Pedido de Emissão: parcelamento (texto editável, ex.: "4x sem juros") derivado
// da proposta vencedora + contatos do segurado para Inspeção/Vistoria
// (preenchidos a partir do Bloco 11 — Opção de Contratação da C4).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('pedido_emissao')
    if (!col.fields.getByName('parcelamento')) {
      col.fields.add(new TextField({ name: 'parcelamento' }))
    }
    if (!col.fields.getByName('inspecao_responsavel')) {
      col.fields.add(new TextField({ name: 'inspecao_responsavel' }))
    }
    if (!col.fields.getByName('inspecao_telefone')) {
      col.fields.add(new TextField({ name: 'inspecao_telefone' }))
    }
    if (!col.fields.getByName('inspecao_email')) {
      col.fields.add(new TextField({ name: 'inspecao_email' }))
    }
    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('pedido_emissao')
      for (const nome of [
        'parcelamento',
        'inspecao_responsavel',
        'inspecao_telefone',
        'inspecao_email',
      ]) {
        const f = col.fields.getByName(nome)
        if (f) col.fields.remove(f)
      }
      app.save(col)
    } catch (_) {}
  },
)
