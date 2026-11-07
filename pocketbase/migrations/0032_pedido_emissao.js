// Migração 0032 — C4 pós-apresentação:
// 1) campo proposta_vencedora (bool) em propostas — uma vencedora por RFQ (RFQ + seguradora + Opção + Versão);
// 2) coleção pedido_emissao — documento do Pedido de Emissão gerado a partir da proposta vencedora,
//    sem redigitação (dados já cadastrados), com anexo da proposta vencedora da cia.
migrate(
  (app) => {
    // --- 1) propostas.proposta_vencedora ---
    const colPropostas = app.findCollectionByNameOrId('propostas')
    if (!colPropostas.fields.getByName('proposta_vencedora')) {
      colPropostas.fields.add(new BoolField({ name: 'proposta_vencedora' }))
      app.save(colPropostas)
    }

    // Backfill idempotente: registros sem valor explícito ficam false (no-op em banco vazio)
    app
      .db()
      .newQuery(`UPDATE propostas SET proposta_vencedora = 0 WHERE proposta_vencedora IS NULL`)
      .execute()

    // --- 2) coleção pedido_emissao ---
    let pedidoJaExiste = false
    try {
      app.findCollectionByNameOrId('pedido_emissao')
      pedidoJaExiste = true
    } catch (_) {}
    if (!pedidoJaExiste) {
      const propostasCol = app.findCollectionByNameOrId('propostas')
      const rfqsCol = app.findCollectionByNameOrId('rfq')
      const empCol = app.findCollectionByNameOrId('empreendimentos')

      const colPedido = new Collection({
        name: 'pedido_emissao',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          {
            name: 'rfq',
            type: 'relation',
            collectionId: rfqsCol.id,
            maxSelect: 1,
            cascadeDelete: true,
          },
          {
            name: 'proposta',
            type: 'relation',
            collectionId: propostasCol.id,
            maxSelect: 1,
            cascadeDelete: true,
          },
          {
            name: 'empreendimento',
            type: 'relation',
            collectionId: empCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          { name: 'data_pedido', type: 'date' },
          { name: 'corretora', type: 'text' },
          { name: 'seguro_contratado', type: 'text' },
          { name: 'segurado_nome', type: 'text' },
          { name: 'segurado_cnpj', type: 'text' },
          { name: 'local_risco', type: 'text' },
          { name: 'premio_bruto', type: 'number' },
          { name: 'premio_liquido', type: 'number' },
          { name: 'comissao_trabalhada', type: 'number' },
          { name: 'observacoes', type: 'text' },
          { name: 'arquivo_proposta', type: 'file', maxSelect: 1, maxSize: 52428800 },
          { name: 'arquivo_proposta_nome', type: 'text' },
          {
            name: 'created',
            type: 'autodate',
            onCreate: true,
            onUpdate: false,
          },
          {
            name: 'updated',
            type: 'autodate',
            onCreate: true,
            onUpdate: true,
          },
        ],
        indexes: [
          'CREATE INDEX idx_pedido_emissao_rfq ON pedido_emissao (rfq)',
          'CREATE UNIQUE INDEX idx_pedido_emissao_proposta ON pedido_emissao (proposta)',
        ],
      })
      app.save(colPedido)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('pedido_emissao')
      app.delete(col)
    } catch (_) {}
    try {
      const colPropostas = app.findCollectionByNameOrId('propostas')
      const f = colPropostas.fields.getByName('proposta_vencedora')
      if (f) {
        colPropostas.fields.remove(f)
        app.save(colPropostas)
      }
    } catch (_) {}
  },
)
