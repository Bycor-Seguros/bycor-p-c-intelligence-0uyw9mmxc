/// 0050 — Idempotência e progresso da gravação em cg_ingestoes.
///
/// Bug real (RN da AXA, ~1.300 itens): a criação em lote de
/// cg_ingestao_itens estourava o rate-limit do PocketBase (429) — nenhuma
/// sessão ficava com a fila completa e as duas tentativas criaram sessões
/// "fantasma" sem nenhum item.
///
/// Este migration dá ao serviço (salvarSessaoIngestao) os dois alicerces da
/// gravação resiliente:
/// 1. chave_ingestao   — chave de idempotência da sessão. Retentar o
///    salvamento (mesmo após fechar o modal e perder a fila da memória)
///    REAPROVEITA a sessão existente em vez de criar outra: índice UNIQUE
///    parcial só quando preenchida, para não restringir sessões antigas.
/// 2. Progresso por item — itens_gravados, total falso "cheio" e
///    ingestao_incompleta deixam o painel distinguir "sessão completa aguardando
///    revisão" de "gravação falhou no meio — regravar itens faltantes".
///
/// Idempotente: campos só são adicionados se ainda não existirem.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('cg_ingestoes')

    let mudou = false
    if (!col.fields.getByName('chave_ingestao')) {
      col.fields.add(new TextField({ name: 'chave_ingestao' }))
      mudou = true
    }
    if (!col.fields.getByName('itens_gravados')) {
      col.fields.add(new NumberField({ name: 'itens_gravados', onlyInt: true }))
      mudou = true
    }
    // JAMAIS required: PocketBase trata false como vazio em bool required.
    if (!col.fields.getByName('ingestao_incompleta')) {
      col.fields.add(new BoolField({ name: 'ingestao_incompleta' }))
      mudou = true
    }

    if (mudou) app.save(col)

    // Índice único parcial: uma única sessão por chave de idempotência — mas
    // apenas quando a chave está preenchida (sessões antigas, vazias, ilibadas).
    const indexes = col.indexes ? col.indexes : []
    const temIndice = indexes.some((ix) => ix.includes('idx_cg_ingestoes_chave_ing'))
    if (!temIndice) {
      col.indexes = [
        ...indexes,
        "CREATE UNIQUE INDEX idx_cg_ingestoes_chave_ing ON cg_ingestoes (chave_ingestao) WHERE chave_ingestao != ''",
      ]
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('cg_ingestoes')
    col.indexes = (col.indexes || []).filter((ix) => !ix.includes('idx_cg_ingestoes_chave_ing'))
    col.fields.removeByName('chave_ingestao')
    col.fields.removeByName('itens_gravados')
    col.fields.removeByName('ingestao_incompleta')
    app.save(col)
  },
)
