migrate(
  (app) => {
    // 1. Seed das seguradoras parceiras caso estejam vazias
    const segCol = app.findCollectionByNameOrId('seguradoras')
    const initialSeguradoras = [
      {
        nome: 'AXA Seguros S.A.',
        posicionamento: 'Líder em P&C corporativo e Riscos Nomeados para hospitalidade',
        faixa_lmi: 'Até R$ 150M',
        condicoes_tipicas: 'Cláusulas amplas de danos por água, alagamento e vendaval',
        apetite_segmentos: { 'Hotéis & Resorts': 'Alto' },
        contatos: { email: 'corporate.pc@axa.com.br', telefone: '(11) 3000-1000' },
      },
      {
        nome: 'Chubb Seguros Brasil S.A.',
        posicionamento: 'Forte apetite para Compreensivo Empresarial e RCG em condo-hotéis',
        faixa_lmi: 'Até R$ 200M',
        condicoes_tipicas: 'Sublimites negociados de lucros cessantes e desmoronamento',
        apetite_segmentos: { 'Hotéis & Resorts': 'Alto' },
        contatos: { email: 'subscricao.hospitality@chubb.com', telefone: '(11) 4000-2000' },
      },
      {
        nome: 'Porto Seguro Cia. de Seguros Gerais',
        posicionamento: 'Capacidade expressiva para riscos patrimoniais médios e redes hoteleiras',
        faixa_lmi: 'Até R$ 100M',
        condicoes_tipicas: 'Pacote de coberturas acessórias com POS padronizada',
        apetite_segmentos: { 'Hotéis & Resorts': 'Alto' },
        contatos: { email: 'grandesriscos@portoseguro.com.br', telefone: '(11) 3366-3000' },
      },
      {
        nome: 'Tokio Marine Seguradora S.A.',
        posicionamento: 'Especialista em Responsabilidade Civil Geral e Riscos Nomeados',
        faixa_lmi: 'Até R$ 120M',
        condicoes_tipicas: 'Franquias atrativas para vendaval e impacto de veículos',
        apetite_segmentos: { 'Hotéis & Resorts': 'Alto' },
        contatos: { email: 'comercial.pc@tokiomarine.com.br', telefone: '(11) 3500-4000' },
      },
      {
        nome: 'Mitsui Sumitomo Seguros S.A.',
        posicionamento: 'Subscrição técnica rigorosa, parceira de longo prazo em grandes riscos',
        faixa_lmi: 'Até R$ 100M',
        condicoes_tipicas: 'Exigência de inspeção prévia de proteções contra incêndio',
        apetite_segmentos: { 'Hotéis & Resorts': 'Médio' },
        contatos: { email: 'subscricao@msig.com.br', telefone: '(11) 3100-5000' },
      },
      {
        nome: 'Ezze Seguros S.A.',
        posicionamento: 'Agilidade em emissão e apetite em riscos empresariais customizados',
        faixa_lmi: 'Até R$ 80M',
        condicoes_tipicas: 'Condições flexíveis para condomínios e apart-hotéis',
        apetite_segmentos: { 'Hotéis & Resorts': 'Alto' },
        contatos: { email: 'cotacoes@ezzeseguros.com.br', telefone: '(11) 3200-6000' },
      },
    ]

    for (const seg of initialSeguradoras) {
      try {
        app.findFirstRecordByData('seguradoras', 'nome', seg.nome)
      } catch (_) {
        const rec = new Record(segCol)
        rec.set('nome', seg.nome)
        rec.set('posicionamento', seg.posicionamento)
        rec.set('faixa_lmi', seg.faixa_lmi)
        rec.set('condicoes_tipicas', seg.condicoes_tipicas)
        rec.set('apetite_segmentos', seg.apetite_segmentos)
        rec.set('contatos', seg.contatos)
        rec.set('historico_relacionamento', [
          {
            data: new Date().toISOString().slice(0, 10),
            fonte: 'Cadastro Oficial Bycor',
            observacao: 'Seguradora habilitada para ciclo de RFQ P&C.',
          },
        ])
        app.save(rec)
      }
    }

    // 2. Criação da coleção rfq_seguradoras (tracking do status por RFQ + Seguradora)
    const rfqId = app.findCollectionByNameOrId('rfq').id
    const seguradorasId = app.findCollectionByNameOrId('seguradoras').id
    const propostasId = app.findCollectionByNameOrId('propostas').id

    try {
      app.findCollectionByNameOrId('rfq_seguradoras')
    } catch (_) {
      const colRfqSeg = new Collection({
        name: 'rfq_seguradoras',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: 'rfq',
            type: 'relation',
            collectionId: rfqId,
            maxSelect: 1,
            cascadeDelete: true,
            required: true,
          },
          {
            name: 'seguradora',
            type: 'relation',
            collectionId: seguradorasId,
            maxSelect: 1,
            cascadeDelete: false,
            required: true,
          },
          {
            name: 'status',
            type: 'select',
            values: ['Convidada', 'Kit entregue', 'Proposta recebida', 'Declinou'],
            maxSelect: 1,
            required: true,
          },
          {
            name: 'kit_entregue',
            type: 'bool',
            required: false,
          },
          {
            name: 'kit_entregue_em',
            type: 'text',
            required: false,
          },
          {
            name: 'declinou_motivo',
            type: 'text',
            required: false,
          },
          {
            name: 'declinou_em',
            type: 'text',
            required: false,
          },
          {
            name: 'proposta',
            type: 'relation',
            collectionId: propostasId,
            maxSelect: 1,
            cascadeDelete: false,
            required: false,
          },
          {
            name: 'data_resposta',
            type: 'text',
            required: false,
          },
          {
            name: 'created',
            type: 'autodate',
            onCreate: true,
            onUpdate: false,
          },
          {
            name: 'updated',
            type: 'autodate',
            onCreate: true,
            onUpdate: true,
          },
        ],
        indexes: [
          'CREATE INDEX idx_rfq_seg_rfq ON rfq_seguradoras (rfq)',
          'CREATE INDEX idx_rfq_seg_seg ON rfq_seguradoras (seguradora)',
          'CREATE INDEX idx_rfq_seg_status ON rfq_seguradoras (status)',
        ],
      })
      app.save(colRfqSeg)
    }
  },
  (app) => {
    try {
      const colRfqSeg = app.findCollectionByNameOrId('rfq_seguradoras')
      app.delete(colRfqSeg)
    } catch (_) {}
  },
)
