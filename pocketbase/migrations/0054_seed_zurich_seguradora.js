/**
 * 0054 — Seed da Zurich no cadastro de seguradoras (ingestão de CGs).
 *
 * A tela de nova ingestão de CG (/biblioteca-cgs → IngestaoCgModal) lista as
 * seguradoras DO BANCO (coleção 'seguradoras' via getSeguradorasCadastro) —
 * não há lista hardcoded de cias no fluxo. Zurich existia apenas no gabarito
 * estático em memória (SEGURADORAS_CANONICAS_DEFAULT, alinhado à migration
 * 0014) e por isso não aparecia no seletor, embora o leitor
 * (cgIngestaoReader) e o casamento pelo motor C3 sejam genéricos.
 *
 * Idempotente: só cria quando NÃO existe registro com o nome canônico.
 * Grafia canônica idêntica à do dicionário estático, para o casamento por
 * normalização (casarSeguradoraComLista) continuar funcionando igual.
 *
 * down: no-op — remover a seguradora com o app no ar apagaria em cascata
 * referências (rfq_seguradoras, cobertura_sinonimos.seguradora, sessões de
 * ingestão cg_ingestoes.seguradora); reverter um seed é mais arriscado que
 * mantê-lo.
 */
migrate(
  (app) => {
    const segCol = app.findCollectionByNameOrId('seguradoras')

    const dados = {
      nome: 'Zurich Minas Brasil Seguros S.A.',
      cnpj: '17.197.385/0001-21',
      posicionamento: 'Seguradora global de P&C corporativo e riscos empresariais',
      faixa_lmi: 'Sob consulta',
      condicoes_tipicas: 'Cadastro originado do gabarito canônico Bycor (habilita ingestão de CG).',
      apetite_segmentos: { 'Hotéis & Resorts': 'Médio' },
      contatos: { email: '', telefone: '' },
      observacoes: 'CNPJ: 17.197.385/0001-21 | SUSEP: 05495',
    }

    try {
      // Já existe (com esta ou outra grafia)? Nada a fazer — nunca duplica.
      app.findFirstRecordByData('seguradoras', 'nome', dados.nome)
      return
    } catch (_) {
      // segue para o create
    }

    const rec = new Record(segCol)
    rec.set('nome', dados.nome)
    rec.set('cnpj', dados.cnpj)
    rec.set('posicionamento', dados.posicionamento)
    rec.set('faixa_lmi', dados.faixa_lmi)
    rec.set('condicoes_tipicas', dados.condicoes_tipicas)
    rec.set('apetite_segmentos', dados.apetite_segmentos)
    rec.set('contatos', dados.contatos)
    rec.set('observacoes', dados.observacoes)
    rec.set('historico_relacionamento', [
      {
        data: new Date().toISOString().slice(0, 10),
        fonte: 'Cadastro Oficial Bycor',
        observacao: 'Seguradora habilitada para ciclo de RFQ P&C e ingestão de CGs.',
      },
    ])
    app.save(rec)
  },
  (app) => {
    // down: no-op (ver cabeçalho)
  },
)
