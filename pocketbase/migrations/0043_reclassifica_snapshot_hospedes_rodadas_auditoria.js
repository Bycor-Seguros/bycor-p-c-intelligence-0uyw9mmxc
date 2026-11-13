/// Correção de dados (idempotente) — snapshot_comparativo das rodadas de auditoria:
/// itens de ROUBO/FURTO DE BENS DE HÓSPEDES podem ainda carregar a categoria errada
/// 'Roubo/Furto de Bens do Segurado' gravada no snapshot antes da correção de ordem
/// do leitor (matchCanonicalCategory testava "qualificado de bens" antes de
/// "hóspedes"). Sem isso, o item do cartão entra no grupo errado e pode casar com
/// "Roubo de Valores (Interior/Trânsito)" — falso positivo do caso BTT Anália Franco.
/// Reclassifica pelo NOME da cobertura (cartão > apólice), nas três listas
/// (casadas / soNaApolice / soNoCartao). Contagens não mudam (só categoria).
/// Em banco vazio não há rodadas a corrigir — no-op.
migrate(
  (app) => {
    var LEGADA = 'Roubo/Furto de Bens do Segurado'
    var CAT_HOSPEDES = 'Roubo/Furto de Bens/Valores de Hóspedes'

    function categoriaPorNome(nome) {
      var n = (nome || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
      if (n.indexOf('HOSPEDE') === -1) return null
      if (n.indexOf('ROUBO') === -1 && n.indexOf('FURTO') === -1) return null
      return CAT_HOSPEDES
    }

    function reclassificarLista(lista) {
      var mudou = false
      if (!lista || !lista.length) return mudou
      for (var i = 0; i < lista.length; i++) {
        var item = lista[i]
        if (!item || item.categoriaNormalizada !== LEGADA) continue
        var nova = categoriaPorNome(item.nomeCartao) || categoriaPorNome(item.nomeApolice)
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
    console.log('[0043] rodadas de auditoria com snapshot reclassificado (Hóspedes): ' + corrigidas)
  },
  (app) => {
    // Down: no-op — a reclassificação de categoria é segura para manter.
    console.log('[0043] down: no-op')
  },
)
