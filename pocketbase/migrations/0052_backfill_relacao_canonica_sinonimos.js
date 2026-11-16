/// Backfill do vínculo (relação) `cobertura_canonica` dos sinônimos de cobertura
/// que estão com esse campo vazio (era da tabulação C3 — v0.0.202 gravava só o
/// texto `canonica_nome`). Casamento determinístico: normaliza `canonica_nome`
/// de cada sinônimo com a MESMA normalização do motor C3
/// (normalizeMatchText + normalizarTermoC3, de
/// src/services/equivalenciaCoberturasService.ts / guardiaImporter.ts) e compara
/// com o nome (e origem_matriz) de cada cobertura canônica. Casamento por
/// igualdade exata da chave normalizada — sem fuzzy, sem similaridade — para
/// não vincular nada de forma incerta.
/// Regras:
///   - NÃO cria nem deleta registros; NÃO altera `alias`, `canonica_nome`,
///     `seguradora*`, `eventos_excluidos` ou `realocacoes_evento`;
///   - sinônimos que já têm vínculo por id NÃO são tocados;
///   - sinônimo sem casamento exato fica como está (sempre revisável no fluxo);
///   - idempotente: WHERE cobertura_canonica = '' garante no-op na 2ª execução;
///   - em banco vazio é no-op (nenhuma canônica, nenhum sinônimo).
migrate(
  (app) => {
    // === normalização FIEL ao motor C3 (replicada — migrations não importam de src/) ===
    // normalizeMatchText (guardiaImporter.ts): minúsculas, sem acentos,
    // pontuação/parênteses → espaço, espaços condensados.
    function normalizeMatchText(val) {
      return String(val || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[()[\]{}|\\/\-_:;.,+~^`"'*?!]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    // normalizarTermoC3 (equivalenciaCoberturasService.ts): expande abreviações
    // de PDF e recondensa espaços.
    function normalizarTermoC3(norm) {
      return String(norm || '')
        .replace(/\bresp\.?\s*civ(?:il|al)?\b/g, 'responsabilidade civil')
        .replace(/\brc\b/g, 'responsabilidade civil')
        .replace(/\s+/g, ' ')
        .trim()
    }
    function normalizarTermoEquivalencia(str) {
      return normalizarTermoC3(normalizeMatchText(str))
    }

    // 1. Carrega as canônicas (chave normalizada → id)
    let canonicas = []
    try {
      canonicas = app.findRecordsByFilter('coberturas_canonicas', '', '-created', 500, 0)
    } catch (_) {
      canonicas = []
    }
    const mapaCanonicas = new Map()
    for (const can of canonicas) {
      const nome = can.getString('nome')
      const chave = normalizarTermoEquivalencia(nome)
      if (chave && !mapaCanonicas.has(chave)) mapaCanonicas.set(chave, can.id)
      // origem_matriz também é reconhecida pelo motor C3 (nomesExistentes)
      const origem = can.getString('origem_matriz')
      const chaveOrigem = normalizarTermoEquivalencia(origem)
      if (chaveOrigem && !mapaCanonicas.has(chaveOrigem)) mapaCanonicas.set(chaveOrigem, can.id)
    }

    if (mapaCanonicas.size === 0) {
      console.log('[0052] no-op: nenhuma cobertura canônica (banco vazio?)')
      return
    }

    // 2. Sinônimos SEM vínculo (filtro nativo — só o que falta vincular)
    let pendentes = []
    try {
      pendentes = app.findRecordsByFilter(
        'cobertura_sinonimos',
        "cobertura_canonica = ''",
        '-created',
        500,
        0,
      )
    } catch (_) {
      pendentes = []
    }

    let vinculados = 0
    let semCasamento = 0
    for (const sin of pendentes) {
      const chave = normalizarTermoEquivalencia(sin.getString('canonica_nome'))
      const idCanonica = mapaCanonicas.get(chave)
      if (!idCanonica) {
        semCasamento++
        console.log(
          '[0052] sem casamento exato: id=' +
            sin.id +
            ' canonica_nome="' +
            sin.getString('canonica_nome') +
            '"',
        )
        continue
      }
      sin.set('cobertura_canonica', idCanonica)
      app.save(sin)
      vinculados++
    }
    console.log(
      '[0052] sinonimos pendentes=' +
        pendentes.length +
        ', vinculados=' +
        vinculados +
        ', sem casamento=' +
        semCasamento,
    )
  },
  (app) => {
    // Down: backfill de dados é seguro para manter — no-op (não desvincula).
    console.log('[0052] down: no-op (backfill de vínculo é seguro para manter)')
  },
)
