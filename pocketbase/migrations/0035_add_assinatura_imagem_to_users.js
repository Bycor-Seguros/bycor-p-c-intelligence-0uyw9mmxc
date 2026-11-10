// Adiciona campo de assinatura digitalizada (imagem) ao perfil do usuário.
// Usada no rodapé do Pedido de Emissão e no bloco de assinaturas da Minuta A4.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('users')
    if (!col.fields.getByName('assinatura_imagem')) {
      col.fields.add(
        new FileField({
          name: 'assinatura_imagem',
          maxSelect: 1,
          maxSize: 2097152,
          mimeTypes: ['image/png', 'image/jpeg'],
        }),
      )
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('users')
    col.fields.remove('assinatura_imagem')
    app.save(col)
  },
)
