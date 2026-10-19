migrate(
  (app) => {
    // Update users collection if needed: add role field
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    try {
      if (!usersCol.fields.getByName('role')) {
        usersCol.fields.add(
          new SelectField({
            name: 'role',
            values: ['analista', 'corretor', 'admin'],
            maxSelect: 1,
            required: false,
          }),
        )
        app.save(usersCol)
      }
    } catch (e) {
      console.log('Error updating users collection:', e)
    }

    // 1. empreendimentos
    const colEmpreendimentos = new Collection({
      name: 'empreendimentos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'id_empreendimento', type: 'text', required: true },
        { name: 'nome_empreendimento', type: 'text' },
        { name: 'razao_social', type: 'text' },
        { name: 'cnpj', type: 'text' },
        { name: 'cossegurado_nome', type: 'text' },
        { name: 'cossegurado_cnpj', type: 'text' },
        { name: 'endereco', type: 'text' },
        { name: 'cidade', type: 'text' },
        { name: 'uf', type: 'text' },
        { name: 'atividade', type: 'text' },
        { name: 'atividade_exercida', type: 'text' },
        { name: 'ano_inicio_atividades', type: 'number' },
        { name: 'ano_construcao', type: 'number' },
        { name: 'area_construida_m2', type: 'number' },
        { name: 'area_terreno_m2', type: 'number' },
        { name: 'num_andares', type: 'number' },
        { name: 'num_unidades', type: 'number' },
        { name: 'possui_piscina', type: 'bool' },
        { name: 'possui_elevador', type: 'bool' },
        { name: 'num_elevadores', type: 'number' },
        { name: 'vagas_estacionamento', type: 'number' },
        { name: 'num_funcionarios', type: 'number' },
        { name: 'faturamento_12m_rs', type: 'number' },
        { name: 'tipo_construcao', type: 'text' },
        { name: 'prot_extintores', type: 'bool' },
        { name: 'prot_hidrantes', type: 'bool' },
        { name: 'prot_sprinklers', type: 'bool' },
        { name: 'prot_detector_fumaca', type: 'bool' },
        { name: 'prot_alarme_incendio', type: 'bool' },
        { name: 'prot_brigada_incendio', type: 'bool' },
        { name: 'prot_pararraios', type: 'bool' },
        { name: 'reserva_agua_incendio_m3', type: 'number' },
        { name: 'dist_bombeiros_km', type: 'number' },
        { name: 'prot_vigilancia', type: 'bool' },
        { name: 'vigilancia_armada', type: 'bool' },
        { name: 'vigilancia_24h', type: 'bool' },
        { name: 'prot_alarme_roubo', type: 'bool' },
        { name: 'prot_cftv', type: 'bool' },
        { name: 'prot_controle_entrada', type: 'bool' },
        { name: 'prot_cofres', type: 'bool' },
        { name: 'prot_cerca_eletrica', type: 'bool' },
        { name: 'prot_grade_protecao', type: 'bool' },
        { name: 'sinistros_ultimos_5anos', type: 'text' },
        { name: 'detalhe_sinistros', type: 'text' },
        { name: 'fonte_cartao_risco', type: 'text' },
        { name: 'segmento', type: 'text' },
        { name: 'fonte_documento', type: 'text' },
        { name: 'confianca', type: 'text' },
        { name: 'extraido_por_ia', type: 'bool' },
        { name: 'imported_at', type: 'text' },
        { name: 'imported_by', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_emp_id_emp ON empreendimentos (id_empreendimento)',
        'CREATE INDEX idx_emp_uf ON empreendimentos (uf)',
        'CREATE INDEX idx_emp_cnpj ON empreendimentos (cnpj)',
      ],
    })
    app.save(colEmpreendimentos)

    const empId = app.findCollectionByNameOrId('empreendimentos').id
    const usersId = '_pb_users_auth_'

    // 2. apolices
    const colApolices = new Collection({
      name: 'apolices',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'id_apolice', type: 'text', required: true },
        {
          name: 'id_empreendimento',
          type: 'relation',
          collectionId: empId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'segurado_na_apolice', type: 'text' },
        { name: 'cnpj_segurado', type: 'text' },
        { name: 'seguradora', type: 'text' },
        { name: 'numero_apolice', type: 'text' },
        { name: 'ramo', type: 'text' },
        { name: 'corretor', type: 'text' },
        { name: 'data_inicio', type: 'date' },
        { name: 'data_fim', type: 'date' },
        { name: 'premio_liquido', type: 'number' },
        { name: 'premio_total', type: 'number' },
        { name: 'valor_em_risco_dm', type: 'number' },
        { name: 'valor_em_risco_lc', type: 'number' },
        { name: 'lmga', type: 'number' },
        { name: 'lmi_incendio_basica', type: 'number' },
        { name: 'razao_lmi_vr_dm', type: 'number' },
        {
          name: 'status',
          type: 'select',
          values: ['ativa', 'a vencer', 'vencida', 'renovada', 'não renovada', 'prospect'],
          maxSelect: 1,
        },
        { name: 'prospect_retorno', type: 'date' },
        { name: 'fonte_arquivo', type: 'text' },
        { name: 'comissao', type: 'number' },
        { name: 'iof', type: 'number' },
        { name: 'endossos', type: 'text' },
        { name: 'fonte_documento', type: 'text' },
        { name: 'confianca', type: 'text' },
        { name: 'extraido_por_ia', type: 'bool' },
        { name: 'imported_at', type: 'text' },
        { name: 'imported_by', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_apolices_id_apolice ON apolices (id_apolice)',
        'CREATE INDEX idx_apolices_seguradora ON apolices (seguradora)',
        'CREATE INDEX idx_apolices_data_fim ON apolices (data_fim)',
        'CREATE INDEX idx_apolices_status ON apolices (status)',
      ],
    })
    app.save(colApolices)

    const apolicesId = app.findCollectionByNameOrId('apolices').id

    // 3. coberturas
    const colCoberturas = new Collection({
      name: 'coberturas',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'id_apolice',
          type: 'relation',
          collectionId: apolicesId,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'nome_cobertura', type: 'text' },
        { name: 'categoria_normalizada', type: 'text' },
        { name: 'lmi_rs', type: 'number' },
        { name: 'franquia_pos', type: 'text' },
        { name: 'premio_cobertura', type: 'number' },
        { name: 'fonte_documento', type: 'text' },
        { name: 'confianca', type: 'text' },
        { name: 'extraido_por_ia', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_cob_apolice ON coberturas (id_apolice)',
        'CREATE INDEX idx_cob_cat ON coberturas (categoria_normalizada)',
      ],
    })
    app.save(colCoberturas)

    // 4. sinistros
    const colSinistros = new Collection({
      name: 'sinistros',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'id_empreendimento',
          type: 'relation',
          collectionId: empId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'id_apolice',
          type: 'relation',
          collectionId: apolicesId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'origem_periodo', type: 'text' },
        { name: 'data_sinistro', type: 'date' },
        { name: 'numero_sinistro', type: 'text' },
        { name: 'cobertura_acionada', type: 'text' },
        { name: 'descricao', type: 'text' },
        { name: 'valor_indenizado_rs', type: 'number' },
        { name: 'status', type: 'text' },
        { name: 'fonte', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_sinistros_emp ON sinistros (id_empreendimento)'],
    })
    app.save(colSinistros)

    // 5. matriz
    const colMatriz = new Collection({
      name: 'matriz',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'categoria_normalizada', type: 'text' },
        {
          name: 'id_apolice',
          type: 'relation',
          collectionId: apolicesId,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'lmi', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_matriz_cat ON matriz (categoria_normalizada)',
        'CREATE INDEX idx_matriz_apolice ON matriz (id_apolice)',
      ],
    })
    app.save(colMatriz)

    // 6. rastreabilidade
    const colRastreabilidade = new Collection({
      name: 'rastreabilidade',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'tabela', type: 'text' },
        { name: 'registro', type: 'text' },
        { name: 'campos', type: 'text' },
        { name: 'valor_atual', type: 'text' },
        { name: 'documento_fonte', type: 'text' },
        { name: 'localizacao_no_documento', type: 'text' },
        { name: 'confianca', type: 'text' },
        { name: 'imported_by', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colRastreabilidade)

    // 7. divergencias
    const colDivergencias = new Collection({
      name: 'divergencias',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'id_empreendimento',
          type: 'relation',
          collectionId: empId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'campo', type: 'text' },
        { name: 'valor_cartao_risco', type: 'text' },
        { name: 'valor_final_apolice', type: 'text' },
        { name: 'apolice_referencia', type: 'text' },
        { name: 'observacao', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colDivergencias)

    // 8. notas_base
    const colNotas = new Collection({
      name: 'notas_base',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'titulo', type: 'text' },
        { name: 'conteudo', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colNotas)

    // 9. seguradoras
    const colSeguradoras = new Collection({
      name: 'seguradoras',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'nome', type: 'text', required: true },
        { name: 'contatos', type: 'json' },
        { name: 'posicionamento', type: 'text' },
        { name: 'apetite_segmentos', type: 'json' },
        { name: 'faixa_lmi', type: 'text' },
        { name: 'condicoes_tipicas', type: 'text' },
        { name: 'observacoes', type: 'text' },
        { name: 'historico_relacionamento', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_seguradoras_nome ON seguradoras (nome)'],
    })
    app.save(colSeguradoras)

    const seguradorasId = app.findCollectionByNameOrId('seguradoras').id

    // 10. rfq
    const colRfq = new Collection({
      name: 'rfq',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'conta_empreendimento',
          type: 'relation',
          collectionId: empId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'seguradoras_solicitadas',
          type: 'relation',
          collectionId: seguradorasId,
          maxSelect: 20,
          cascadeDelete: false,
        },
        { name: 'data_envio', type: 'date' },
        { name: 'prazo_limite', type: 'date' },
        {
          name: 'status',
          type: 'select',
          values: ['Aberto', 'Enviado', 'Respondido', 'Fechado'],
          maxSelect: 1,
        },
        { name: 'observacoes', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_rfq_status ON rfq (status)'],
    })
    app.save(colRfq)

    const rfqId = app.findCollectionByNameOrId('rfq').id

    // 11. propostas
    const colPropostas = new Collection({
      name: 'propostas',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'rfq', type: 'relation', collectionId: rfqId, maxSelect: 1, cascadeDelete: false },
        {
          name: 'seguradora',
          type: 'relation',
          collectionId: seguradorasId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'data_proposta', type: 'date' },
        { name: 'coberturas', type: 'json' },
        { name: 'pos_franquias', type: 'text' },
        { name: 'clausulas', type: 'text' },
        { name: 'exclusoes', type: 'text' },
        { name: 'lmi_lmg', type: 'number' },
        { name: 'premio_liquido', type: 'number' },
        { name: 'premio_bruto', type: 'number' },
        { name: 'iof', type: 'number' },
        {
          name: 'status',
          type: 'select',
          values: ['Pendente', 'Tabulada', 'Selecionada', 'Não selecionada'],
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_propostas_status ON propostas (status)'],
    })
    app.save(colPropostas)

    // 12. auditoria
    const colAuditoria = new Collection({
      name: 'auditoria',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'empreendimento',
          type: 'relation',
          collectionId: empId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'apolice',
          type: 'relation',
          collectionId: apolicesId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'pdf_apolice', type: 'file', maxSelect: 1, maxSize: 20971520 },
        {
          name: 'status',
          type: 'select',
          values: ['Em auditoria', 'Apto', 'Desvios a ajustar', 'Aprovado'],
          maxSelect: 1,
        },
        {
          name: 'analista',
          type: 'relation',
          collectionId: usersId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'data_aprovacao', type: 'date' },
        { name: 'itens', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_auditoria_status ON auditoria (status)'],
    })
    app.save(colAuditoria)

    // 13. documentos
    const colDocumentos = new Collection({
      name: 'documentos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'tipo',
          type: 'select',
          values: [
            'Cartão de Risco',
            'QAR',
            'Questionário',
            'Proposta',
            'Apólice PDF',
            'Apresentação',
            'Outro',
          ],
          maxSelect: 1,
        },
        { name: 'arquivo', type: 'file', maxSelect: 1, maxSize: 20971520 },
        { name: 'versao', type: 'text' },
        { name: 'data', type: 'date' },
        {
          name: 'vinculado_empreendimento',
          type: 'relation',
          collectionId: empId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: 'vinculado_apolice',
          type: 'relation',
          collectionId: apolicesId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'rfq', type: 'relation', collectionId: rfqId, maxSelect: 1, cascadeDelete: false },
        { name: 'extraido_por_ia', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_docs_tipo ON documentos (tipo)'],
    })
    app.save(colDocumentos)

    // 14. contratacao_versoes
    const colContratacao = new Collection({
      name: 'contratacao_versoes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'produto_cobertura', type: 'text', required: true },
        { name: 'wording', type: 'text' },
        { name: 'principais_clausulas', type: 'text' },
        { name: 'pos_franquias_padrao', type: 'text' },
        { name: 'exclusoes_usuais', type: 'text' },
        { name: 'versao', type: 'number' },
        {
          name: 'status',
          type: 'select',
          values: ['rascunho', 'publicada'],
          maxSelect: 1,
        },
        {
          name: 'autor',
          type: 'relation',
          collectionId: usersId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'log_alteracoes', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colContratacao)

    // 15. playbook
    const colPlaybook = new Collection({
      name: 'playbook',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'segmento', type: 'text', required: true },
        { name: 'mapa_riscos', type: 'json' },
        { name: 'checklist_coberturas', type: 'json' },
        { name: 'objecoes', type: 'json' },
        { name: 'crosssell', type: 'json' },
        { name: 'etapas_prospeccao', type: 'json' },
        { name: 'modelos_email', type: 'json' },
        { name: 'versao', type: 'number' },
        { name: 'autor', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colPlaybook)

    // 16. historico
    const colHistorico = new Collection({
      name: 'historico',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'registro_id', type: 'text' },
        { name: 'tabela', type: 'text' },
        { name: 'data', type: 'text' },
        { name: 'cia', type: 'text' },
        { name: 'texto', type: 'text' },
        {
          name: 'autor',
          type: 'relation',
          collectionId: usersId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'timestamp', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_hist_reg ON historico (registro_id)',
        'CREATE INDEX idx_hist_tab ON historico (tabela)',
      ],
    })
    app.save(colHistorico)

    // 17. chat_messages
    const colChat = new Collection({
      name: 'chat_messages',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'role',
          type: 'select',
          values: ['user', 'assistant', 'system'],
          maxSelect: 1,
        },
        { name: 'content', type: 'text' },
        {
          name: 'user',
          type: 'relation',
          collectionId: usersId,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colChat)

    // 18. contas
    const colContas = new Collection({
      name: 'contas',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'nome', type: 'text', required: true },
        { name: 'cnpj', type: 'text' },
        { name: 'segmento', type: 'text' },
        { name: 'contatos', type: 'json' },
        { name: 'observacoes', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(colContas)
  },
  (app) => {
    const toDelete = [
      'contas',
      'chat_messages',
      'historico',
      'playbook',
      'contratacao_versoes',
      'documentos',
      'auditoria',
      'propostas',
      'rfq',
      'seguradoras',
      'notas_base',
      'divergencias',
      'rastreabilidade',
      'matriz',
      'sinistros',
      'coberturas',
      'apolices',
      'empreendimentos',
    ]
    for (const name of toDelete) {
      try {
        const col = app.findCollectionByNameOrId(name)
        app.delete(col)
      } catch (_) {}
    }
  },
)
