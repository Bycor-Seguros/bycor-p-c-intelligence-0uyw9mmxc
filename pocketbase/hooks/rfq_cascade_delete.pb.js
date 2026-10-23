/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook de exclusão em cascata do RFQ.
 * Quando um registro da coleção `rfq` for excluído:
 * 1. Remove todos os registros de `rfq_seguradoras` vinculados ao RFQ;
 * 2. Remove todas as `propostas` vinculadas ao RFQ (e seus arquivos anexos);
 * 3. Remove todos os `documentos` vinculados ao RFQ (Kit XLSX/PDF, propostas salvas);
 * 4. Remove registros da tabela `historico` que apontam para o RFQ ou tabela rfq.
 *
 * Registros de empreendimentos, seguradoras, apólices e contas permanecem 100% preservados.
 */
onRecordDelete((e) => {
  e.next()

  const rfqId = e.record.id
  if (!rfqId) return

  // 1. Deletar rfq_seguradoras vinculados
  try {
    const rfqSegRecords = $app.findRecordsByFilter(
      'rfq_seguradoras',
      'rfq = {:rfqId}',
      '-created',
      1000,
      0,
      { rfqId: rfqId },
    )
    for (let i = 0; i < rfqSegRecords.length; i++) {
      try {
        $app.delete(rfqSegRecords[i])
      } catch (err) {
        console.warn('Erro ao deletar rfq_seguradoras no hook cascade:', err)
      }
    }
  } catch (err) {
    console.warn('Erro ao consultar rfq_seguradoras no hook cascade:', err)
  }

  // 2. Deletar propostas vinculadas
  try {
    const propRecords = $app.findRecordsByFilter(
      'propostas',
      'rfq = {:rfqId}',
      '-created',
      1000,
      0,
      { rfqId: rfqId },
    )
    for (let i = 0; i < propRecords.length; i++) {
      try {
        $app.delete(propRecords[i])
      } catch (err) {
        console.warn('Erro ao deletar proposta no hook cascade:', err)
      }
    }
  } catch (err) {
    console.warn('Erro ao consultar propostas no hook cascade:', err)
  }

  // 3. Deletar documentos vinculados ao RFQ
  try {
    const docRecords = $app.findRecordsByFilter(
      'documentos',
      'rfq = {:rfqId}',
      '-created',
      1000,
      0,
      { rfqId: rfqId },
    )
    for (let i = 0; i < docRecords.length; i++) {
      try {
        $app.delete(docRecords[i])
      } catch (err) {
        console.warn('Erro ao deletar documento no hook cascade:', err)
      }
    }
  } catch (err) {
    console.warn('Erro ao consultar documentos no hook cascade:', err)
  }

  // 4. Limpar histórico vinculado a este RFQ se houver
  try {
    const histRecords = $app.findRecordsByFilter(
      'historico',
      'registro_id = {:rfqId} || (tabela = "rfq" && registro_id = {:rfqId})',
      '-created',
      500,
      0,
      { rfqId: rfqId },
    )
    for (let i = 0; i < histRecords.length; i++) {
      try {
        $app.delete(histRecords[i])
      } catch (err) {
        console.warn('Erro ao deletar historico no hook cascade:', err)
      }
    }
  } catch (err) {
    console.warn('Erro ao consultar historico no hook cascade:', err)
  }
}, 'rfq')
