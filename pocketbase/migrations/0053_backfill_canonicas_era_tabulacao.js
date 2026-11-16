/// Backfill da era da tabulação C3 (complemento determinístico da 0052):
///   (1) cria cobertura canônica para cada valor distinto de `canonica_nome`
///       em cobertura_sinonimos que NÃO case com canônica existente (nome ou
///       origem_matriz) por igualdade exata da chave normalizada do motor C3
///       (normalizeMatchText + normalizarTermoC3 replicados fielmente —
///       mesma normalização de src/services/equivalenciaCoberturasService.ts;
///       "Resp. Civil"/"rc" → "responsabilidade civil"; SEM fuzzy);
///       ramo pela regra da 0051 (prefixo 'RC '/'Resp. Civil' → RC; contém
///       'Lucros Cessantes'/'Perda de Receita'/'Despesas Fixas' → LC; resto → DM);
///       descricao = "Criada por backfill da era da tabulação".
///   (2) preenche `cobertura_canonica` dos sinônimos ainda vazios casando
///       canonica_nome com a canônica criada/existente.
/// Regras:
///   - NÃO altera nomes de sinônimos nem de canônicas existentes;
///     NÃO deleta registro algum; sinônimos já vinculados não são tocados;
///   - idempotente: canônicas só são criadas se a chave normalizada não existir;
///     sinônimos só via WHERE cobertura_canonica = '' (2ª execução = no-op);
///   - em banco vazio é no-op (nenhum sinônimo pendente, nada a criar).
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
    // Regra de ramo da 0051 (mesma do usuário, v0.0.214).
    function ramoPorNome(nome) {
      const n = String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
      if (!n) return 'DM'
      const comecaComRc = /^rc[\s\-_/]/.test(n) || n.startsWith('rc ')
      const comecaComRespCivil = /^(resp\.?\s*|responsabilidade\s+)civil/.test(n)
      if (comecaComRc || comecaComRespCivil) return 'RC'
      if (
        n.includes('lucros cessantes') ||
        n.includes('perda de receita') ||
        n.includes('despesas fixas')
      )
        return 'LC'
      return 'DM'
    }

    // 1. Carrega as canônicas existentes (chave normalizada → registro)
    let canonicas = []
    try {
      canonicas = app.findRecordsByFilter('coberturas_canonicas', '', '-created', 500, 0)
    } catch (_) {
      canonicas = []
    }
    const mapaCanonicas = new Map()
    for (const can of canonicas) {
      const chaveNome = normalizarTermoEquivalencia(can.getString('nome'))
      if (chaveNome && !mapaCanonicas.has(chaveNome)) mapaCanonicas.set(chaveNome, can)
      const origem = can.getString('origem_matriz')
      const chaveOrigem = normalizarTermoEquivalencia(origem)
      if (chaveOrigem && !mapaCanonicas.has(chaveOrigem)) mapaCanonicas.set(chaveOrigem, can)
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

    // 3. Valores distintos de canonica_nome sem canônica correspondente:
    //    cria a canônica (uma por chave normalizada) e registra o id.
    let criadas = 0
    for (const sin of pendentes) {
      const chave = normalizarTermoEquivalencia(sin.getString('canonica_nome'))
      if (!chave || mapaCanonicas.has(chave)) continue
      const nova = new Record(app.findCollectionByNameOrId('coberturas_canonicas'))
      nova.set('nome', sin.getString('canonica_nome'))
      nova.set('ramo', ramoPorNome(sin.getString('canonica_nome')))
      nova.set('descricao', 'Criada por backfill da era da tabulação')
      app.save(nova)
      mapaCanonicas.set(chave, nova)
      criadas++
      console.log(
        '[0053] canônica criada: "' +
          nova.getString('nome') +
          '" (ramo=' +
          nova.getString('ramo') +
          ')',
      )
    }

    // 4. Vincula os sinônimos ainda vazios (WHERE cobertura_canonica = '')
    let vinculados = 0
    let semCasamento = 0
    for (const sin of pendentes) {
      const chave = normalizarTermoEquivalencia(sin.getString('canonica_nome'))
      const can = chave ? mapaCanonicas.get(chave) : null
      if (!can) {
        semCasamento++
        console.log(
          '[0053] sem casamento exato: id=' +
            sin.id +
            ' canonica_nome="' +
            sin.getString('canonica_nome') +
            '"',
        )
        continue
      }
      sin.set('cobertura_canonica', can.id)
      app.save(sin)
      vinculados++
    }
    console.log(
      '[0053] sinonimos pendentes=' +
        pendentes.length +
        ', canonicas criadas=' +
        criadas +
        ', vinculados=' +
        vinculados +
        ', sem casamento=' +
        semCasamento,
    )
  },
  (app) => {
    // Down: no-op — backfill de dados (canônicas + vínculos) é seguro manter;
    // reverter relações criadas seria arriscado (poderia desvincular sinônimos
    // confirmados depois pelo analista).
    console.log('[0053] down: no-op (backfill de canônicas/vínculos é seguro para manter)')
  },
)
