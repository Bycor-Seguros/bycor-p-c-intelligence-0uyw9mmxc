/**
 * 0039 — Pró-Memória contínua por cliente (coleção historico)
 *
 * Reancora a coleção `historico` no EMPREENDIMENTO (o "cliente") como âncora
 * principal. A vínculação à apólice/proposta do ciclo (registro_id + tabela)
 * passa a ser OPCIONAL (rastreabilidade), nunca obrigatória.
 *
 * - Novos campos: empreendimento (relation→empreendimentos), assunto (text),
 *   categoria (select), data_fato (date), apolice (relation→apolices, opcional).
 * - registro_id/tabela permanecem (texto legado, opcional) — nada é apagado.
 * - Backfill idempotente: cada nota existente aponta para o empreendimento da
 *   apólice (tabela="apolices") ou da auditoria (tabela auditoria/auditoria_aprovacao)
 *   correspondente; notas órfãs ficam sem âncora, mas nunca são removidas.
 * - Deriva assunto e categoria dos textos legados (emitida/renovação/cancelada/
 *   aprovação/auditoria) para a linha do tempo já nascer povoada.
 */
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('historico')
    const empId = app.findCollectionByNameOrId('empreendimentos').id
    const apolicesId = app.findCollectionByNameOrId('apolices').id

    if (!col.fields.getByName('empreendimento')) {
      col.fields.add(
        new RelationField({
          name: 'empreendimento',
          collectionId: empId,
          maxSelect: 1,
          minSelect: 0,
          required: false,
          cascadeDelete: false,
        }),
      )
    }

    if (!col.fields.getByName('apolice')) {
      col.fields.add(
        new RelationField({
          name: 'apolice',
          collectionId: apolicesId,
          maxSelect: 1,
          minSelect: 0,
          required: false,
          cascadeDelete: false,
        }),
      )
    }

    if (!col.fields.getByName('assunto')) {
      col.fields.add(new TextField({ name: 'assunto', max: 200 }))
    }

    if (!col.fields.getByName('categoria')) {
      col.fields.add(
        new SelectField({
          name: 'categoria',
          values: ['Negociação', 'Sinistro', 'Endosso', 'Renovação', 'Decisão de Cobertura'],
          maxSelect: 1,
        }),
      )
    }

    if (!col.fields.getByName('data_fato')) {
      col.fields.add(new DateField({ name: 'data_fato' }))
    }

    // Índices para a linha do tempo por cliente
    col.addIndex('idx_hist_empreendimento', false, 'empreendimento', '')
    col.addIndex('idx_hist_apolice', false, 'apolice', '')

    app.save(col)

    // ---------- Backfill idempotente ----------
    // 1) Notas já ancoradas em apolices: derivar empreendimento/apolice/assunto/categoria/data_fato
    const notasApolices = app.findRecordsByFilter(
      'historico',
      "tabela = 'apolices' && empreendimento = ''",
      '-created',
      0,
      0,
    )
    for (const nota of notasApolices) {
      let apoliceRec = null
      try {
        apoliceRec = app.findRecordById('apolices', nota.getString('registro_id'))
      } catch (_) {
        apoliceRec = null
      }
      if (!apoliceRec) continue

      const texto = nota.getString('texto')
      const categorizado = derivarCategoria(texto)
      nota.set('empreendimento', apoliceRec.getString('id_empreendimento'))
      nota.set('apolice', apoliceRec.id)
      nota.set('assunto', derivarAssunto(texto, nota.getString('cia')))
      if (!nota.getString('categoria')) nota.set('categoria', categorizado)
      if (!nota.getString('data_fato')) nota.set('data_fato', nota.getString('data'))
      app.save(nota)
    }

    // 2) Notas de auditoria (tabela="auditoria" | "auditoria_aprovacao")
    const tabelasAuditoria = ['auditoria', 'auditoria_aprovacao']
    for (const tabela of tabelasAuditoria) {
      const notasAud = app.findRecordsByFilter(
        'historico',
        `tabela = '${tabela}' && empreendimento = ''`,
        '-created',
        0,
        0,
      )
      for (const nota of notasAud) {
        let audRec = null
        try {
          audRec = app.findRecordById('auditoria', nota.getString('registro_id'))
        } catch (_) {
          audRec = null
        }
        if (!audRec) continue

        const emp = audRec.getString('empreendimento')
        const apolice = audRec.getString('apolice')
        const texto = nota.getString('texto')
        nota.set('empreendimento', emp)
        if (apolice) nota.set('apolice', apolice)
        nota.set('assunto', derivarAssunto(texto, nota.getString('cia')))
        if (!nota.getString('categoria')) nota.set('categoria', derivarCategoria(texto))
        if (!nota.getString('data_fato')) nota.set('data_fato', nota.getString('data'))
        app.save(nota)
      }
    }

    console.log(
      `0039 backfill historico: ${notasApolices.length} nota(s) de apolices + auditorias reancoradas no empreendimento`,
    )
  },
  (app) => {
    const col = app.findCollectionByNameOrId('historico')
    col.removeIndex('idx_hist_empreendimento')
    col.removeIndex('idx_hist_apolice')
    for (const f of ['empreendimento', 'apolice', 'assunto', 'categoria', 'data_fato']) {
      const field = col.fields.getByName(f)
      if (field) col.fields.removeByName(f)
    }
    app.save(col)
  },
)

// ---------- Helpers (definidos no escopo do módulo, chamados dentro do up) ----------

function derivarCategoria(texto) {
  const t = (texto || '').toLowerCase()
  if (t.includes('renovação') || t.includes('renovada') || t.includes('sucessora')) {
    return 'Renovação'
  }
  if (t.includes('aprovação') || t.includes('aprovada') || t.includes('homologada')) {
    return 'Decisão de Cobertura'
  }
  if (t.includes('cancelada') || t.includes('cancelamento')) {
    return 'Endosso'
  }
  if (t.includes('sinistro') || t.includes('sinistralidade')) {
    return 'Sinistro'
  }
  if (t.includes('endosso')) {
    return 'Endosso'
  }
  return 'Negociação'
}

function derivarAssunto(texto, cia) {
  const t = (texto || '').toLowerCase()
  let assunto = 'Registro operacional'
  if (t.includes('apólice emitida')) assunto = 'Apólice emitida'
  else if (t.includes('renovação concluída')) assunto = 'Renovação concluída'
  else if (t.includes('renovação homologada')) assunto = 'Renovação homologada'
  else if (t.includes('cancelada por falta de pagamento'))
    assunto = 'Cancelamento por falta de pagamento'
  else if (t.includes('aprovação técnica')) assunto = 'Aprovação técnica'
  else if (t.includes('aprovação rejeitada')) assunto = 'Aprovação rejeitada'
  else if (t.includes('auditoria técnica')) assunto = 'Auditoria técnica'
  else if (t.includes('sinistro')) assunto = 'Sinistro'
  else if (t.includes('endosso')) assunto = 'Endosso'

  const ciaCurta = (cia || '')
    .replace(/\s*(seguradora|s\.a\.|s\/a)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return ciaCurta ? `${assunto} — ${ciaCurta}`.slice(0, 200) : assunto
}
