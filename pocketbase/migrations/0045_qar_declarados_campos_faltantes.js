/// 0045 — Complementa o Leitor de QAR (migration 0044) com os campos que a
/// interface de gravação (qarPersistencia.ts) escreve e que faltavam no schema:
/// - qar_declarados.tipo_valor (text) — "percentual" | "valor" (corte de valor declarado)
/// - qar_declarados.importancia_segurada_pretendida (number) — IS pretendida do QAR na linha
/// - empreendimentos.qar_is_pretendida_json (json) — cabeçalho idempotente do QAR
///
/// Idempotente: só adiciona o campo se ele não existir. Re-executar não duplica.
migrate(
  (app) => {
    const qarCol = app.findCollectionByNameOrId('qar_declarados')
    let qarDirty = false
    if (!qarCol.fields.getByName('tipo_valor')) {
      qarCol.fields.add(new TextField({ name: 'tipo_valor' }))
      qarDirty = true
    }
    if (!qarCol.fields.getByName('importancia_segurada_pretendida')) {
      qarCol.fields.add(new NumberField({ name: 'importancia_segurada_pretendida' }))
      qarDirty = true
    }
    if (qarDirty) {
      app.save(qarCol)
      console.log(
        '[0045] campos tipo_valor / importancia_segurada_pretendida garantidos em qar_declarados',
      )
    }

    const empCol = app.findCollectionByNameOrId('empreendimentos')
    if (!empCol.fields.getByName('qar_is_pretendida_json')) {
      empCol.fields.add(new JSONField({ name: 'qar_is_pretendida_json', maxSize: 2000000 }))
      app.save(empCol)
      console.log('[0045] campo qar_is_pretendida_json garantido em empreendimentos')
    }
  },
  (app) => {
    const qarCol = app.findCollectionByNameOrId('qar_declarados')
    for (const f of ['tipo_valor', 'importancia_segurada_pretendida']) {
      try {
        qarCol.fields.removeByName(f)
      } catch (_) {}
    }
    app.save(qarCol)
    const empCol = app.findCollectionByNameOrId('empreendimentos')
    try {
      empCol.fields.removeByName('qar_is_pretendida_json')
      app.save(empCol)
    } catch (_) {}
  },
)
