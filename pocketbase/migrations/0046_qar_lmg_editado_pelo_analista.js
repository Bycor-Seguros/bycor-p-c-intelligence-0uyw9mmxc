// Migration 0046 — flag de correção do analista em qar_declarados.
//
// Eixo QAR × Apólice (Auditoria C5, Etapa 2 — Item 2): quando o analista edita
// o LMG declarado / a IS pretendida na aba "QAR × Apólice", a linha recebe
// lmg_editado_pelo_analista = true. Numa re-entrada do MESMO QAR (re-upload),
// salvarQarDeclarado NÃO sobrescreve linhas com essa flag — a correção do
// analista prevalece sobre o que o leitor releu.
//
// Bool opcional (nunca required — regra PocketBase: bool required só aceita true).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('qar_declarados')
    if (!col.fields.getByName('lmg_editado_pelo_analista')) {
      col.fields.add(new BoolField({ name: 'lmg_editado_pelo_analista' }))
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('qar_declarados')
    if (col.fields.getByName('lmg_editado_pelo_analista')) {
      col.fields.removeByName('lmg_editado_pelo_analista')
    }
    app.save(col)
  },
)
