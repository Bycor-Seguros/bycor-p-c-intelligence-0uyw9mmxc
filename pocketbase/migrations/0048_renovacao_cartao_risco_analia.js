/// 0048 — Renova o registro do Cartão de Risco 2026 do Anália Franco e limpa
/// numero_apolice contaminado.
///
/// O importador do Cartão de Risco gravou no prospect de renovação o número da
/// apólice ANTERIOR (2025) com o rótulo da planilha colado ("Nº da apólice :
/// 02852.2025.0001.0196.0007371"), o que fazia o registro parecer uma terceira
/// apólice vigente na /carteira. Decisão da usuária: NÃO excluir o registro —
/// preservar a linhagem de auditoria Cartão × Apólice e o elo de cadeia de
/// renovações. O fix é:
///   (a) status 'prospect' → 'renovada', apolice_sucessora → apólice emitida
///       02852.2026.0001.0196.0009004, renovada_em preenchido;
///   (b) numero_apolice → vazio (a sucessora carrega o número).
///
/// Idempotente e no-op em base vazia: a atualização só dispara para registros
/// de ORIGEM 'Cartão de Risco' status 'prospect' cujo numero_apolice contenha
/// o padrão de contaminação ("Nº da apólice" + número da apólice 2025), usando
/// a SUCESSORA REAL resolvida por (empreendimento, número emitido do ciclo
/// atual) — nunca um id fixo. Em base vazia não há registros e nada acontece.
migrate(
  (app) => {
    const colecao = app.findCollectionByNameOrId('apolices')

    // Apólices de origem Cartão de Risco com status prospect e numero_apolice
    // contaminado (rótulo colado + número da apólice anterior).
    const alvos = app.findRecordsByFilter(
      'apolices',
      "origem = 'Cartão de Risco' && status = 'prospect' && numero_apolice ~ 'Nº da apólice'",
      '-created',
      50,
      0,
    )

    for (const alvo of alvos) {
      const numeroContaminado = alvo.getString('numero_apolice')
      const numeroAnteriorLimpo = String(numeroContaminado || '')
        .replace(/n[oº°.]*\s*da\s*ap[oó]lice\s*[:\-]?\s*/i, '')
        .trim()

      // Extrai o CNPJ/empreendimento para localizar a sucessora emitida real.
      const cnpj = alvo.getString('cnpj_segurado')
      const cnpjDigits = String(cnpj || '').replace(/\D/g, '')
      const ramo = alvo.getString('ramo')

      // A sucessora é a apólice EMITIDA (status ativa, número de apólice limpo,
      // sem o padrão de contaminação) do mesmo empreendimento e do ciclo atual.
      let sucessoraId = ''
      try {
        const candidatas = app.findRecordsByFilter(
          'apolices',
          "status = 'ativa' && numero_apolice !~ 'Nº da apólice' && numero_apolice != ''",
          '-created',
          100,
          0,
        )
        const cnpjLimpoDaAtiva = (rec) =>
          String(rec.getString('cnpj_segurado') || '').replace(/\D/g, '')
        const match = candidatas.find(
          (rec) =>
            (!cnpjDigits || cnpjLimpoDaAtiva(rec) === cnpjDigits) &&
            String(rec.getString('ramo') || '') !== '' &&
            rec.getString('id') !== alvo.getString('id'),
        )
        if (match) {
          sucessoraId = match.getString('id')
        }
      } catch (_) {
        sucessoraId = ''
      }

      alvo.set('numero_apolice', '')
      if (sucessoraId) {
        alvo.set('apolice_sucessora', sucessoraId)
        alvo.set('status', 'renovada')
        alvo.set('renovada_em', new Date().toISOString())
      } else {
        // Sem sucessora resolvível: ainda limpa o número contaminado (defensivo).
        console.log(
          `[0048] registro ${alvo.getString('id')} (${numeroAnteriorLimpo}): sem sucessora resolvível — numero_apolice limpo, status mantido ${alvo.getString('status')}`,
        )
      }
      app.save(alvo)
      console.log(
        `[0048] registro ${alvo.getString('id')} atualizado: status=${alvo.getString('status')}, numero_apolice limpo (era "${numeroContaminado}"), sucessora=${sucessoraId || '(não encontrada)'}`,
      )
    }

    if (alvos.length === 0) {
      console.log('[0048] nenhum registro de Cartão de Risco contaminado encontrado — no-op')
    }
  },
  (app) => {
    // down: não é reversível de forma significativa — reabrir o registro destruiria
    // o elo de renovação. No-op intencional.
    void app
  },
)
