/// 0044 — Leitor de QAR: armazenamento do que é EXCLUSIVO do QAR
/// (Questionário de Avaliação de Risco RCG, formulário padrão Bycor).
///
/// Estratégia anti-duplicação: reutiliza coleções existentes sempre que possível —
/// empreendimentos ganha os campos de cabeçalho do formulário (IS pretendida e
/// os 4 LMGs marcados, que pertencem ao QAR e não a uma cobertura). A coleção
/// nova `qar_declarados` guarda 1 linha por cobertura declarada no item 21 com o
/// que `coberturas` não tem: % da IS pretendida, valor pretendido (R$), distância
/// (km, quando declarada) e vínculo opcional com o processo `rfq` do ciclo.
///
/// Idempotente: re-run não duplica campos nem coleção; down remove só a coleção
/// nova (histórico de QARs já vinculados é preservado nos campos do empreendimento).
migrate(
  (app) => {
    const empCol = app.findCollectionByNameOrId('empreendimentos')
    const rfqCol = app.findCollectionByNameOrId('rfq')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // ---- 1. Campos de cabeçalho do QAR no empreendimento (se faltarem) ----
    let empDirty = false
    const camposEmp = [
      { nome: 'qar_is_pretendida', tipo: 'number' },
      { nome: 'qar_lmgs', tipo: 'json' },
      { nome: 'qar_fonte_arquivo', tipo: 'text' },
      { nome: 'qar_imported_at', tipo: 'text' },
      { nome: 'qar_imported_by', tipo: 'text' },
    ]
    for (const c of camposEmp) {
      if (empCol.fields.getByName(c.nome)) continue
      empCol.fields.add(
        new Field({
          name: c.nome,
          type: c.tipo,
          ...(c.tipo === 'json' ? { maxSize: 2000000 } : {}),
        }),
      )
      empDirty = true
    }
    if (empDirty) app.save(empCol)

    // ---- 2. Coleção qar_declarados (1 linha por cobertura declarada no item 21) ----
    let col = null
    try {
      col = app.findCollectionByNameOrId('qar_declarados')
    } catch (_) {
      col = null
    }

    if (!col) {
      col = new Collection({
        name: 'qar_declarados',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          {
            name: 'empreendimento',
            type: 'relation',
            collectionId: empCol.id,
            maxSelect: 1,
            cascadeDelete: false,
            required: true,
          },
          {
            name: 'rfq',
            type: 'relation',
            collectionId: rfqCol.id,
            maxSelect: 1,
            cascadeDelete: false,
          },
          {
            name: 'cobertura',
            type: 'text',
            required: true,
          },
          {
            name: 'cobertura_normalizada',
            type: 'text',
          },
          {
            name: 'percentual_is_pretendida',
            type: 'number',
          },
          {
            name: 'valor_pretendido_rs',
            type: 'number',
          },
          {
            name: 'distancia_km',
            type: 'number',
          },
          {
            name: 'lmg_marcado',
            type: 'bool',
          },
          {
            name: 'lmg_index',
            type: 'number',
          },
          {
            name: 'linha_original',
            type: 'text',
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
          'CREATE INDEX idx_qar_declarados_emp ON qar_declarados (empreendimento)',
          'CREATE INDEX idx_qar_declarados_rfq ON qar_declarados (rfq)',
          'CREATE UNIQUE INDEX idx_qar_declarados_emp_cob ON qar_declarados (empreendimento, cobertura)',
        ],
      })
      app.save(col)
      console.log('[0044] coleção qar_declarados criada')
    } else {
      console.log('[0044] coleção qar_declarados já existe — no-op')
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('qar_declarados')
      app.delete(col)
      console.log('[0044] down: coleção qar_declarados removida')
    } catch (_) {}
  },
)
