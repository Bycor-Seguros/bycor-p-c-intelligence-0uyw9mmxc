migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('propostas')

    // VRD por seção
    if (!col.fields.getByName('vrd_dm')) {
      col.fields.add(new NumberField({ name: 'vrd_dm' }))
    }
    if (!col.fields.getByName('vrd_mmu')) {
      col.fields.add(new NumberField({ name: 'vrd_mmu' }))
    }
    if (!col.fields.getByName('vrd_mmp')) {
      col.fields.add(new NumberField({ name: 'vrd_mmp' }))
    }
    if (!col.fields.getByName('vrd_lc')) {
      col.fields.add(new NumberField({ name: 'vrd_lc' }))
    }
    if (!col.fields.getByName('vrd_lc_base')) {
      col.fields.add(
        new SelectField({
          name: 'vrd_lc_base',
          values: ['Lucro Bruto', 'Despesas Fixas', 'Lucro Líquido (LL)'],
          maxSelect: 1,
        }),
      )
    }

    // Comissão e Base do Prêmio
    if (!col.fields.getByName('comissao_trabalhada')) {
      col.fields.add(new NumberField({ name: 'comissao_trabalhada' }))
    }
    if (!col.fields.getByName('base_premio')) {
      col.fields.add(
        new SelectField({
          name: 'base_premio',
          values: ['Prêmio Líquido (já com comissão)', 'Prêmio Net (sem comissão)'],
          maxSelect: 1,
        }),
      )
    }
    if (!col.fields.getByName('premio_net')) {
      col.fields.add(new NumberField({ name: 'premio_net' }))
    }

    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('propostas')
      const fieldsToRemove = [
        'vrd_dm',
        'vrd_mmu',
        'vrd_mmp',
        'vrd_lc',
        'vrd_lc_base',
        'comissao_trabalhada',
        'base_premio',
        'premio_net',
      ]
      for (const f of fieldsToRemove) {
        const field = col.fields.getByName(f)
        if (field) {
          col.fields.remove(field)
        }
      }
      app.save(col)
    } catch (_) {}
  },
)
