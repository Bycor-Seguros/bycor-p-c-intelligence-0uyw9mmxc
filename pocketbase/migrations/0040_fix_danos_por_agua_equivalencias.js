/// Correção da tabela de equivalências — regra de produto "Danos por Água":
/// - AXA tem 3 coberturas DISTINTAS: Danos por Água; Derrame/Vazamento de Sprinklers; Vazamento/Rompimento de Tanques e Tubulações.
/// - Allianz e Porto EMBUTEM Danos por Água dentro de Vazamento/Rompimento de Tanques e Tubulações.
/// Estado defeituoso corrigido:
///   1. A canônica "Vazamento/Rompimento de Tanques e Tubulações" não existia em coberturas_canonicas.
///   2. Aliases de Tanques/Tubulações (Allianz "Ruptura de Tanques e Tubulações", Porto
///      "VAZAMENTO DE TANQUES E TUBULAÇÕES") ficavam com cobertura_canonica vazia.
///   3. A realocação do evento "Danos por Água" nesses aliases apontava para a canônica
///      "Danos por Água" — para Allianz/Porto o destino correto é a canônica de Tanques/Tubulações.
/// Idempotente: roda em banco vazio (nada a corrigir) e pode ser reaplicada sem duplicar.
migrate(
  (app) => {
    const NOME_TANQUES = 'Vazamento/Rompimento de Tanques e Tubulações'
    const NOME_DANOS_AGUA = 'Danos por Água'

    // 1. Garantir a canônica de Tanques/Tubulações (idempotente)
    let tanques = null
    try {
      tanques = app.findFirstRecordByFilter('coberturas_canonicas', "nome = '" + NOME_TANQUES + "'")
    } catch (_) {
      tanques = null
    }
    if (!tanques) {
      const col = app.findCollectionByNameOrId('coberturas_canonicas')
      tanques = new Record(col)
      tanques.set('nome', NOME_TANQUES)
      tanques.set('ramo', 'Patrimonial')
      tanques.set(
        'descricao',
        'Vazamento e rompimento de tanques e tubulações. Allianz/Porto embutem Danos por Água nesta cobertura; AXA mantém Danos por Água como cobertura distinta.',
      )
      tanques.set('eventos_tipicos', [
        'Vazamento de Tanques e Tubulações',
        'Rompimento de Tanques e Tubulações',
        'Danos por Água',
      ])
      tanques.set('ordem', 100)
      tanques.set('origem_matriz', 'Danos por Água / Sprinklers')
      app.save(tanques)
      console.log('[0040] canônica criada: ' + NOME_TANQUES + ' (' + tanques.get('id') + ')')
    }
    const tanquesId = tanques.get('id')

    // 2. Re-ancorar todos os aliases de Tanques/Tubulações na canônica correta
    let aliases = []
    try {
      aliases = app.findRecordsByFilter(
        'cobertura_sinonimos',
        "alias ~ 'Tanques e Tubulações' || alias ~ 'TANQUES E TUBULAÇÕES'",
        '-created',
        200,
        0,
      )
    } catch (_) {
      aliases = []
    }

    for (const rec of aliases) {
      const alias = rec.getString('alias') || ''
      const seg = rec.getString('seguradora_nome') || ''
      const antes = rec.getString('canonica_nome') || '(vazio)'

      rec.set('cobertura_canonica', tanquesId)
      rec.set('canonica_nome', NOME_TANQUES)

      // Allianz/Porto: Danos por Água está EMBUTIDO — destino da realocação é a canônica de Tanques.
      // AXA: mantém Danos por Água como cobertura DISTINTA — destino permanece "Danos por Água".
      const embutida = seg.indexOf('Allianz') !== -1 || seg.indexOf('Porto') !== -1
      const destino = embutida ? NOME_TANQUES : NOME_DANOS_AGUA

      let realoc = []
      try {
        const raw = rec.getString('realocacoes_evento')
        realoc = raw ? JSON.parse(raw) : []
      } catch (_) {
        realoc = []
      }
      if (!Array.isArray(realoc)) realoc = []
      let mudou = false
      const novo = realoc.map(function (r) {
        if (r && r.evento === NOME_DANOS_AGUA && r.cobertura_destino !== destino) {
          mudou = true
          return {
            evento: r.evento,
            cobertura_destino: destino,
            motivo:
              r.motivo ||
              'Regra de produto: Danos por Água ' +
                (embutida
                  ? 'embutido em Tanques/Tubulações (' + seg + ')'
                  : 'cobertura distinta (AXA)'),
          }
        }
        return r
      })
      if (mudou) {
        rec.set('realocacoes_evento', novo)
      }

      // eventos_excluidos: Allianz/Porto não excluem Danos por Água (está embutido);
      // AXA exclui da cobertura de Tanques/Tubulações (mantém a cobertura separada).
      if (embutida) {
        let excl = []
        try {
          const rawE = rec.getString('eventos_excluidos')
          excl = rawE ? JSON.parse(rawE) : []
        } catch (_) {
          excl = []
        }
        if (Array.isArray(excl) && excl.length > 0) {
          rec.set('eventos_excluidos', [])
        }
      }

      app.save(rec)
      console.log(
        '[0040] alias reancorado: "' + alias + '" (' + seg + '): ' + antes + ' -> ' + NOME_TANQUES,
      )
    }
  },
  (app) => {
    // Reverter: desancorar aliases de Tanques (volta a canônica vazia) e apagar a
    // canônica criada, apenas se nenhum alias/registro ainda a referenciar.
    let tanques = null
    try {
      tanques = app.findFirstRecordByFilter(
        'coberturas_canonicas',
        "nome = 'Vazamento/Rompimento de Tanques e Tubulações'",
      )
    } catch (_) {
      tanques = null
    }
    if (tanques) {
      const tanquesId = tanques.get('id')
      let aliases = []
      try {
        aliases = app.findRecordsByFilter(
          'cobertura_sinonimos',
          "cobertura_canonica = '" + tanquesId + "'",
          '-created',
          200,
          0,
        )
      } catch (_) {
        aliases = []
      }
      for (const rec of aliases) {
        rec.set('cobertura_canonica', null)
        rec.set('canonica_nome', '')
        app.save(rec)
      }
      app.delete(tanques)
    } else {
      console.log('[0040] down: canônica de Tanques/Tubulações não existe — nada a reverter')
    }
  },
)
