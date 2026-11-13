/// Correção de dados (idempotente): coberturas cujo nome já identifica uma das três
/// coberturas de água distintas (regra de produto AXA) ainda carregam a categoria
/// agregada legada 'Danos por Água / Sprinklers' em categoria_normalizada. Sem isso,
/// a auditoria Cartão × Apólice não consegue exibir as 3 coberturas AXA em linhas
/// distintas mesmo após a migration 0040 (canônica de Tanques + sinônimos religados).
/// Em banco vazio não há registros a corrigir — no-op.
migrate(
  (app) => {
    const LEGADA = 'Danos por Água / Sprinklers'
    const CAT_AGUA = 'Danos por Água'
    const CAT_SPRINKLERS = 'Derrame/Vazamento de Sprinklers'
    const CAT_TANQUES = 'Vazamento/Rompimento de Tanques e Tubulações'

    function categoriaPorNome(nome) {
      const n = (nome || '').toUpperCase()
      if (n.indexOf('TANQUE') !== -1 && n.indexOf('TUBULA') !== -1) return CAT_TANQUES
      if (n.indexOf('SPRINKLER') !== -1 || n.indexOf('CHUVEIROS AUTOM') !== -1)
        return CAT_SPRINKLERS
      if (n.indexOf('DERRAME') !== -1 && n.indexOf('ÁGUA') !== -1) return CAT_SPRINKLERS
      if (n.indexOf('DERRAME') !== -1 && n.indexOf("D'AGUA") !== -1) return CAT_SPRINKLERS
      if (n.indexOf('DANOS POR ÁGUA') !== -1 || n.indexOf('DANOS POR AGUA') !== -1) return CAT_AGUA
      return null
    }

    let regs = []
    try {
      regs = app.findRecordsByFilter(
        'coberturas',
        "categoria_normalizada = '" + LEGADA + "'",
        '-updated',
        500,
        0,
      )
    } catch (_) {
      regs = []
    }

    let corrigidas = 0
    for (const rec of regs) {
      const nova = categoriaPorNome(rec.getString('nome_cobertura'))
      if (!nova || nova === LEGADA) continue
      rec.set('categoria_normalizada', nova)
      app.save(rec)
      corrigidas++
    }
    console.log(
      '[0041] coberturas reclassificadas da categoria legada "' +
        LEGADA +
        '": ' +
        corrigidas +
        ' de ' +
        regs.length,
    )
  },
  (app) => {
    // Down: não é possível reconstituir a categoria legada sem perder a correção — no-op.
    console.log('[0041] down: no-op (reclassificação de categoria é segura para manter)')
  },
)
