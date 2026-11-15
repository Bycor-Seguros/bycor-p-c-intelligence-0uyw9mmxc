/// 0047 — Ingestão de CGs (Condições Gerais) na Biblioteca de CGs.
///
/// Guarda o resultado da extração automática (leitor de CG) e a fila de revisão
/// do analista. NADA aqui escreve em cobertura_sinonimos — isso acontece
/// exclusivamente via salvarSinonimo do motor C3 quando o analista CONFIRMA um
/// item na fila (regra de ouro: sistema sugere, analista confirma).
///
/// cg_ingestoes   : 1 linha por PDF ingerido (seguradora, produto/versão, arquivo).
/// cg_ingestao_itens: 1 linha por item EXTRAÍDO da CG, com status do analista:
///                    pendente | confirmado | rejeitado.
/// Guarda de re-ingestão: (seguradora, produto_versao, chave_normalizada) único
/// entre itens CONFIRMADOS — reenviar o PDF da mesma cia/produto não duplica.
///
/// Idempotente: re-run não duplica coleções; down remove as duas novas.
migrate(
  (app) => {
    const seguradorasCol = app.findCollectionByNameOrId('seguradoras')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // ---- 1. cg_ingestoes (1 linha por PDF ingerido) ----
    let ingestoes = null
    try {
      ingestoes = app.findCollectionByNameOrId('cg_ingestoes')
    } catch (_) {
      ingestoes = null
    }
    if (!ingestoes) {
      ingestoes = new Collection({
        name: 'cg_ingestoes',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          {
            name: 'seguradora',
            type: 'relation',
            collectionId: seguradorasCol.id,
            maxSelect: 1,
            cascadeDelete: false,
            required: true,
          },
          {
            name: 'seguradora_nome',
            type: 'text',
          },
          {
            name: 'produto_versao',
            type: 'text',
          },
          {
            name: 'processo_susep',
            type: 'text',
          },
          {
            name: 'total_itens',
            type: 'number',
          },
          {
            name: 'total_exclusoes',
            type: 'number',
          },
          {
            name: 'fonte_arquivo',
            type: 'text',
          },
          {
            name: 'usuario_upload',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'usuario_email',
            type: 'text',
          },
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
          'CREATE INDEX idx_cg_ingestoes_seg ON cg_ingestoes (seguradora)',
          'CREATE INDEX idx_cg_ingestoes_prod ON cg_ingestoes (produto_versao)',
        ],
      })
      app.save(ingestoes)
      console.log('[0047] coleção cg_ingestoes criada')
    } else {
      console.log('[0047] coleção cg_ingestoes já existe — no-op')
    }

    // ---- 2. cg_ingestao_itens (1 linha por item extraído, fila de revisão) ----
    let itens = null
    try {
      itens = app.findCollectionByNameOrId('cg_ingestao_itens')
    } catch (_) {
      itens = null
    }
    if (!itens) {
      itens = new Collection({
        name: 'cg_ingestao_itens',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          {
            name: 'ingestao',
            type: 'relation',
            collectionId: ingestoes.id,
            maxSelect: 1,
            cascadeDelete: true,
            required: true,
          },
          {
            name: 'tipo_item',
            type: 'select',
            values: ['cobertura', 'exclusao'],
            maxSelect: 1,
            required: true,
          },
          {
            name: 'chave_normalizada',
            type: 'text',
            required: true,
          },
          {
            name: 'nome_extraido',
            type: 'text',
            required: true,
          },
          {
            name: 'secao_origem',
            type: 'text',
          },
          {
            name: 'pagina',
            type: 'number',
          },
          {
            name: 'slot_y',
            type: 'number',
          },
          {
            name: 'sugestao_canonica_id',
            type: 'text',
          },
          {
            name: 'sugestao_canonica_nome',
            type: 'text',
          },
          {
            name: 'confianca',
            type: 'number',
          },
          {
            name: 'match_type',
            type: 'text',
          },
          {
            name: 'exclusoes',
            type: 'json',
            maxSize: 2000000,
          },
          {
            name: 'status',
            type: 'select',
            values: ['pendente', 'confirmado', 'rejeitado'],
            maxSelect: 1,
            required: true,
          },
          {
            name: 'destino_rejeicao',
            type: 'select',
            values: ['candidato_cg_nova', 'exclusao_nao_cobre'],
            maxSelect: 1,
          },
          {
            name: 'sinonimo_gravado_id',
            type: 'text',
          },
          {
            name: 'revisado_por',
            type: 'relation',
            collectionId: usersCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'revisado_em',
            type: 'text',
          },
          {
            name: 'observacao',
            type: 'text',
          },
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
          'CREATE INDEX idx_cg_itens_ing ON cg_ingestao_itens (ingestao)',
          'CREATE INDEX idx_cg_itens_status ON cg_ingestao_itens (status)',
          'CREATE INDEX idx_cg_itens_ing_status ON cg_ingestao_itens (ingestao, status)',
        ],
      })
      app.save(itens)
      console.log('[0047] coleção cg_ingestao_itens criada')
    } else {
      console.log('[0047] coleção cg_ingestao_itens já existe — no-op')
    }
  },
  (app) => {
    try {
      const itens = app.findCollectionByNameOrId('cg_ingestao_itens')
      app.delete(itens)
      console.log('[0047] down: cg_ingestao_itens removida')
    } catch (_) {}
    try {
      const ingestoes = app.findCollectionByNameOrId('cg_ingestoes')
      app.delete(ingestoes)
      console.log('[0047] down: cg_ingestoes removida')
    } catch (_) {}
  },
)
