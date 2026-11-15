/// 0049 — Armazena o PDF da sessão de ingestão de CGs.
///
/// A sessão (cg_ingestoes) gravava apenas o NOME do arquivo (fonte_arquivo:
/// texto). O arquivo em si não ficava guardado, então não havia como abrir o
/// PDF de origem depois — nem para retomar uma sessão pendente, nem para
/// visualizar a página exata de um item da fila.
///
/// Este migration adiciona o campo `arquivo` (file, 1 arquivo, PDF) em
/// cg_ingestoes. Idempotente: em base onde o campo já exista, é no-op. As
/// sessões antigas (ex. AXA em andamento) continuam sem arquivo — o app trata
/// campo vazio como "sessão sem PDF anexado", sem re-extrair nada.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('cg_ingestoes')

    if (!col.fields.getByName('arquivo')) {
      col.fields.add(
        new FileField({
          name: 'arquivo',
          maxSelect: 1,
          maxSize: 52428800, // 50 MB — CGs podem passar de 100 páginas
          mimeTypes: ['application/pdf'],
        }),
      )
      app.save(col)
      console.log('[0049] campo arquivo (file/pdf) adicionado em cg_ingestoes')
    } else {
      console.log('[0049] campo arquivo já existe em cg_ingestoes — no-op')
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('cg_ingestoes')
    if (col.fields.getByName('arquivo')) {
      col.fields.removeByName('arquivo')
      app.save(col)
    }
  },
)
