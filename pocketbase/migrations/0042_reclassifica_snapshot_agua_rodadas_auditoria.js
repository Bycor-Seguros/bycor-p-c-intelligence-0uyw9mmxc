/// Correção de dados (idempotente) — snapshot_comparativo das rodadas de auditoria:
/// itens cujo nome já identifica uma das três coberturas de água distintas (regra de
/// produto AXA) podem ainda carregar a categoria agregada legada
/// 'Danos por Água / Sprinklers' gravada no snapshot antes das migrations 0040/0041.
/// Sem isso, a Auditoria Cartão × Apólice exibe as coberturas AXA agrupadas em uma
/// linha só. Reclassifica pelo NOME da cobertura (apolice > cartão), nas três listas
/// (casadas / soNaApolice / soNoCartao). Contagens não mudam (só categoria).
/// Em banco vazio não há rodadas a corrigir — no-op.
migrate(
  (app) => {
    var LEGADA = 'Danos por Água / Sprinklers'
    var CAT_AGUA = 'Danos por Água'
    var CAT_SPRINKLERS = 'Derrame/Vazamento de Sprinklers'
    var CAT_TANQUES = 'Vazamento/Rompimento de Tanques e Tubulações'

    function categoriaPorNome(nome) {
      var n = (nome || '').toUpperCase()
      if (n.indexOf('TANQUE') !== -1 && n.indexOf('TUBULA') !== -1) return CAT_TANQUES
      if (n.indexOf('SPRINKLER') !== -1 || n.indexOf('CHUVEIROS AUTOM') !== -1)
        return CAT_SPRINKLERS
      if (n.indexOf('DANOS POR ÁGUA') !== -1 || n.indexOf('DANOS POR AGUA') !== -1) return CAT_AGUA
      return null
    }

    function reclassificarLista(lista) {
      var mudou = false
      if (!lista || !lista.length) return mudou
      for (var i = 0; i < lista.length; i++) {
        var item = lista[i]
        if (!item || item.categoriaNormalizada !== LEGADA) continue
        var nova =
          categoriaPorNome(item.nomeApolice) ||
          categoriaPorNome(item.nomeCartao) ||
          categoriaPorNome(item.nome_cobertura)
        if (nova && nova !== LEGADA) {
          item.categoriaNormalizada = nova
          mudou = true
        }
      }
      return mudou
    }

    var rodadas = []
    try {
      rodadas = app.findRecordsByFilter(
        'auditoria_rodadas',
        "snapshot_comparativo ~ '" + LEGADA + "'",
        '-updated',
        100,
        0,
      )
    } catch (_) {
      rodadas = []
    }

    var corrigidas = 0
    for (var r = 0; r < rodadas.length; r++) {
      var rec = rodadas[r]
      var snap = {}
      try {
        snap = JSON.parse(rec.getString('snapshot_comparativo') || '{}')
      } catch (_) {
        snap = {}
      }
      var cob = snap && snap.coberturas ? snap.coberturas : {}
      var mudou = false
      mudou = reclassificarLista(cob.casadas) || mudou
      mudou = reclassificarLista(cob.soNaApolice) || mudou
      mudou = reclassificarLista(cob.soNoCartao) || mudou
      if (mudou) {
        rec.set('snapshot_comparativo', JSON.stringify(snap))
        app.save(rec)
        corrigidas++
      }
    }
    console.log('[0042] rodadas de auditoria com snapshot reclassificado: ' + corrigidas)
  },
  (app) => {
    // Down: no-op — a reclassificação de categoria é segura para manter.
    console.log('[0042] down: no-op')
  },
)
