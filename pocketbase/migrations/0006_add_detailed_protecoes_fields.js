migrate(
  (app) => {
    const colEmp = app.findCollectionByNameOrId('empreendimentos')
    let modified = false

    // Campos booleanos de proteções adicionais
    if (!colEmp.fields.getByName('prot_agua_exclusiva_incendio')) {
      colEmp.fields.add(new BoolField({ name: 'prot_agua_exclusiva_incendio' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_co2_fm200')) {
      colEmp.fields.add(new BoolField({ name: 'prot_co2_fm200' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_expediente_24h')) {
      colEmp.fields.add(new BoolField({ name: 'prot_expediente_24h' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_instalacoes_eletricas_protegidas')) {
      colEmp.fields.add(new BoolField({ name: 'prot_instalacoes_eletricas_protegidas' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_luminarias_protegidas')) {
      colEmp.fields.add(new BoolField({ name: 'prot_luminarias_protegidas' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_cameras_seguranca')) {
      colEmp.fields.add(new BoolField({ name: 'prot_cameras_seguranca' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_outros_incendio')) {
      colEmp.fields.add(new BoolField({ name: 'prot_outros_incendio' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_outros_roubo')) {
      colEmp.fields.add(new BoolField({ name: 'prot_outros_roubo' }))
      modified = true
    }

    // Campos de texto para detalhes, qualificadores e dados estruturados
    if (!colEmp.fields.getByName('prot_outros_incendio_texto')) {
      colEmp.fields.add(new TextField({ name: 'prot_outros_incendio_texto' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_outros_roubo_texto')) {
      colEmp.fields.add(new TextField({ name: 'prot_outros_roubo_texto' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_alarme_incendio_detalhe')) {
      colEmp.fields.add(new TextField({ name: 'prot_alarme_incendio_detalhe' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_vigilancia_detalhe')) {
      colEmp.fields.add(new TextField({ name: 'prot_vigilancia_detalhe' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_alarme_roubo_detalhe')) {
      colEmp.fields.add(new TextField({ name: 'prot_alarme_roubo_detalhe' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_cameras_seguranca_detalhe')) {
      colEmp.fields.add(new TextField({ name: 'prot_cameras_seguranca_detalhe' }))
      modified = true
    }
    if (!colEmp.fields.getByName('prot_controle_entrada_detalhe')) {
      colEmp.fields.add(new TextField({ name: 'prot_controle_entrada_detalhe' }))
      modified = true
    }
    if (!colEmp.fields.getByName('volume_agua_exclusivo_texto')) {
      colEmp.fields.add(new TextField({ name: 'volume_agua_exclusivo_texto' }))
      modified = true
    }
    if (!colEmp.fields.getByName('dist_bombeiros_texto')) {
      colEmp.fields.add(new TextField({ name: 'dist_bombeiros_texto' }))
      modified = true
    }
    if (!colEmp.fields.getByName('protecoes_raw_json')) {
      colEmp.fields.add(new JSONField({ name: 'protecoes_raw_json' }))
      modified = true
    }

    if (modified) {
      app.save(colEmp)
    }
  },
  (app) => {
    const colEmp = app.findCollectionByNameOrId('empreendimentos')
    const fieldNames = [
      'prot_agua_exclusiva_incendio',
      'prot_co2_fm200',
      'prot_expediente_24h',
      'prot_instalacoes_eletricas_protegidas',
      'prot_luminarias_protegidas',
      'prot_cameras_seguranca',
      'prot_outros_incendio',
      'prot_outros_roubo',
      'prot_outros_incendio_texto',
      'prot_outros_roubo_texto',
      'prot_alarme_incendio_detalhe',
      'prot_vigilancia_detalhe',
      'prot_alarme_roubo_detalhe',
      'prot_cameras_seguranca_detalhe',
      'prot_controle_entrada_detalhe',
      'volume_agua_exclusivo_texto',
      'dist_bombeiros_texto',
      'protecoes_raw_json',
    ]
    let mod = false
    for (const f of fieldNames) {
      const existing = colEmp.fields.getByName(f)
      if (existing) {
        colEmp.fields.remove(existing)
        mod = true
      }
    }
    if (mod) {
      app.save(colEmp)
    }
  },
)
