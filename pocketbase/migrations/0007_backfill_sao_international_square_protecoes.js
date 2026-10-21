migrate(
  (app) => {
    // Busca empreendimento Condomínio São International Square
    let empRecord = null
    try {
      empRecord = app.findFirstRecordByFilter(
        'empreendimentos',
        "nome_empreendimento ~ 'São International Square' || razao_social ~ 'São International Square'",
      )
    } catch {
      // not found
    }

    if (empRecord) {
      // Atualiza com os valores das proteções e qualificadores reais identificados
      empRecord.set('prot_extintores', true)
      empRecord.set('prot_hidrantes', true)
      empRecord.set('prot_sprinklers', true)
      empRecord.set('prot_detector_fumaca', true)
      empRecord.set('prot_alarme_incendio', true)
      empRecord.set(
        'prot_alarme_incendio_detalhe',
        '( x ) Monitorada    (  ) Não Monitorada  (  ) Manual',
      )
      empRecord.set('prot_brigada_incendio', true)
      empRecord.set('prot_pararraios', true)
      empRecord.set('prot_agua_exclusiva_incendio', true)
      empRecord.set('prot_co2_fm200', false)
      empRecord.set('prot_expediente_24h', true)
      empRecord.set('prot_instalacoes_eletricas_protegidas', true)
      empRecord.set('prot_luminarias_protegidas', true)
      empRecord.set('prot_outros_incendio', true)
      empRecord.set(
        'prot_outros_incendio_texto',
        'Dispositivos de sinalização audiovisuais em caso de incêndio',
      )

      empRecord.set('prot_vigilancia', true)
      empRecord.set(
        'prot_vigilancia_detalhe',
        '(x  ) Monitorada    (  ) Não Monitorada; (  )  Armada   ( x) Desarmada; ( x  ) 24hrs   (  ) Diurno  (  ) Noturno',
      )
      empRecord.set('vigilancia_armada', false)
      empRecord.set('vigilancia_24h', true)
      empRecord.set('prot_alarme_roubo', true)
      empRecord.set('prot_alarme_roubo_detalhe', '(x  ) Monitorado    (  ) Não Monitorado')
      empRecord.set('prot_cameras_seguranca', true)
      empRecord.set('prot_cameras_seguranca_detalhe', '(x  ) Monitorado    (  ) Não Monitorado')
      empRecord.set('prot_cftv', true)
      empRecord.set('prot_controle_entrada', true)
      empRecord.set('prot_controle_entrada_detalhe', 'Obs : Veículos')
      empRecord.set('prot_grade_protecao', false)
      empRecord.set('prot_cerca_eletrica', false)
      empRecord.set('prot_cofres', false)
      empRecord.set('prot_outros_roubo', false)

      // Dados de construção corretos
      empRecord.set('possui_piscina', false)
      empRecord.set('possui_elevador', true)
      empRecord.set('num_elevadores', 6)
      empRecord.set('vagas_estacionamento', 250)
      empRecord.set('num_andares', 15)
      empRecord.set('num_unidades', 298)
      empRecord.set('area_construida_m2', 14013)
      empRecord.set('ano_construcao', 2016)
      empRecord.set('tipo_construcao', 'Superior')

      app.save(empRecord)
    }
  },
  () => {
    // No-op rollback
  },
)
