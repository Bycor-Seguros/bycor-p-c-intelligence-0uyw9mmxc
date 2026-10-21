migrate(
  (app) => {
    // 1. apolices: add 'origem' text field if not exists
    const colApolices = app.findCollectionByNameOrId('apolices')
    if (!colApolices.fields.getByName('origem')) {
      colApolices.fields.add(new TextField({ name: 'origem' }))
      app.save(colApolices)
    }

    // 2. coberturas: add 'origem', 'is_atualizada', 'is_escolhida', 'observacao'
    const colCoberturas = app.findCollectionByNameOrId('coberturas')
    let cobModified = false
    if (!colCoberturas.fields.getByName('origem')) {
      colCoberturas.fields.add(new TextField({ name: 'origem' }))
      cobModified = true
    }
    if (!colCoberturas.fields.getByName('is_atualizada')) {
      colCoberturas.fields.add(new NumberField({ name: 'is_atualizada' }))
      cobModified = true
    }
    if (!colCoberturas.fields.getByName('is_escolhida')) {
      colCoberturas.fields.add(new NumberField({ name: 'is_escolhida' }))
      cobModified = true
    }
    if (!colCoberturas.fields.getByName('observacao')) {
      colCoberturas.fields.add(new TextField({ name: 'observacao' }))
      cobModified = true
    }
    if (cobModified) {
      app.save(colCoberturas)
    }

    // 3. sinistros: add 'origem' text field if not exists
    const colSinistros = app.findCollectionByNameOrId('sinistros')
    if (!colSinistros.fields.getByName('origem')) {
      colSinistros.fields.add(new TextField({ name: 'origem' }))
      app.save(colSinistros)
    }

    // 4. empreendimentos: add 'origem' text field if not exists
    const colEmpreendimentos = app.findCollectionByNameOrId('empreendimentos')
    if (!colEmpreendimentos.fields.getByName('origem')) {
      colEmpreendimentos.fields.add(new TextField({ name: 'origem' }))
      app.save(colEmpreendimentos)
    }
  },
  (app) => {
    const colApolices = app.findCollectionByNameOrId('apolices')
    const origemAp = colApolices.fields.getByName('origem')
    if (origemAp) {
      colApolices.fields.remove(origemAp)
      app.save(colApolices)
    }

    const colCoberturas = app.findCollectionByNameOrId('coberturas')
    let cobMod = false
    const oCob = colCoberturas.fields.getByName('origem')
    if (oCob) {
      colCoberturas.fields.remove(oCob)
      cobMod = true
    }
    const isAt = colCoberturas.fields.getByName('is_atualizada')
    if (isAt) {
      colCoberturas.fields.remove(isAt)
      cobMod = true
    }
    const isEs = colCoberturas.fields.getByName('is_escolhida')
    if (isEs) {
      colCoberturas.fields.remove(isEs)
      cobMod = true
    }
    const obs = colCoberturas.fields.getByName('observacao')
    if (obs) {
      colCoberturas.fields.remove(obs)
      cobMod = true
    }
    if (cobMod) {
      app.save(colCoberturas)
    }

    const colSinistros = app.findCollectionByNameOrId('sinistros')
    const origemSin = colSinistros.fields.getByName('origem')
    if (origemSin) {
      colSinistros.fields.remove(origemSin)
      app.save(colSinistros)
    }

    const colEmp = app.findCollectionByNameOrId('empreendimentos')
    const origemEmp = colEmp.fields.getByName('origem')
    if (origemEmp) {
      colEmp.fields.remove(origemEmp)
      app.save(colEmp)
    }
  },
)
