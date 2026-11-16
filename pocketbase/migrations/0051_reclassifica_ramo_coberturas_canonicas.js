/// Reclassificação determinística do campo `ramo` das coberturas canônicas
/// (taxonomia final DM / RC / LC — v0.0.214):
///   - prefixo "RC " ou inicial "Resp. Civil"/"Responsabilidade Civil" → RC
///   - contém "Lucros Cessantes" / "Perda de Receita" / "Despesas Fixas"  → LC
///   - resto (default sem prefixo claro)                                   → DM
/// Regra do usuário: default sem prefixo claro é DM ("Empregador" futuro → DM;
/// correção eventual é renomear a canônica, não na migration). Property sai —
/// é sinônimo internacional de patrimonial/DM; Patrimonial era só o default.
/// Idempotente: recalcula o ramo pelas mesmas regras e atualiza apenas registros
/// divergentes. Em banco vazio não faz nada (no-op).
migrate(
  (app) => {
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

    let regs = []
    try {
      regs = app.findRecordsByFilter('coberturas_canonicas', '', '-created', 500, 0)
    } catch (_) {
      regs = []
    }

    let atualizadas = 0
    const contagem = { DM: 0, RC: 0, LC: 0 }
    for (const rec of regs) {
      const novo = ramoPorNome(rec.getString('nome'))
      contagem[novo] = (contagem[novo] || 0) + 1
      if (rec.getString('ramo') !== novo) {
        rec.set('ramo', novo)
        app.save(rec)
        atualizadas++
      }
    }
    console.log(
      '[0051] coberturas_canonicas reclassificadas para DM/RC/LC: ' +
        atualizadas +
        ' de ' +
        regs.length +
        ' (DM=' +
        (contagem.DM || 0) +
        ', RC=' +
        (contagem.RC || 0) +
        ', LC=' +
        (contagem.LC || 0) +
        ')',
    )
  },
  (app) => {
    // Down: reclassificação é determinística e segura para manter — no-op.
    console.log('[0051] down: no-op (reclassificação de ramo é segura para manter)')
  },
)
