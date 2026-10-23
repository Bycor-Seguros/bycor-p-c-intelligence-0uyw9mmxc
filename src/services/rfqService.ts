import pb from '@/lib/pocketbase/client'

export type RfqStatus = 'Aberto' | 'Enviado' | 'Respondido' | 'Fechado'

export interface RfqRecord {
  id: string
  conta_empreendimento: string
  seguradoras_solicitadas: string[]
  data_envio: string
  prazo_limite: string
  status: RfqStatus
  observacoes: string
  kit_gerado?: boolean
  kit_gerado_em?: string
  created: string
  updated?: string
  expand?: {
    conta_empreendimento?: {
      nome_empreendimento: string
      razao_social: string
    }
  }
}

/**
 * Atualiza o status do RFQ para "Enviado", opcionalmente gravando ou atualizando a data de envio
 */
export async function marcarRfqComoEnviado(rfqId: string, dataEnvio?: string): Promise<RfqRecord> {
  const payload: Record<string, any> = {
    status: 'Enviado',
  }
  if (dataEnvio) {
    payload.data_envio = dataEnvio
  }

  return await pb.collection('rfq').update<RfqRecord>(rfqId, payload, {
    expand: 'conta_empreendimento',
  })
}

/**
 * Encerra o RFQ movendo seu status para "Fechado"
 * RFQs fechados continuam disponíveis para consulta histórica e rastreabilidade
 */
export async function encerrarRfq(rfqId: string): Promise<RfqRecord> {
  return await pb.collection('rfq').update<RfqRecord>(
    rfqId,
    {
      status: 'Fechado',
    },
    {
      expand: 'conta_empreendimento',
    },
  )
}

/**
 * Reabre um RFQ fechado ou atualiza status para qualquer estado válido
 */
export async function atualizarStatusRfq(rfqId: string, status: RfqStatus): Promise<RfqRecord> {
  return await pb.collection('rfq').update<RfqRecord>(
    rfqId,
    {
      status,
    },
    {
      expand: 'conta_empreendimento',
    },
  )
}

/**
 * Exclui completamente um RFQ e tudo que está vinculado a ele:
 * - Registros do painel de acompanhamento por seguradora (rfq_seguradoras)
 * - Propostas registradas vinculadas ao RFQ (propostas)
 * - Documentos vinculados ao RFQ (documentos - Kit de Submissão XLSX/PDF e uploads)
 * - Histórico de eventos associado
 *
 * Realiza a limpeza explícita tanto no frontend quanto apoiada pelo hook de banco.
 * Embarcações, seguradoras do Mapa de Mercado, empreendimentos e contas NÃO são afetados.
 */
export async function deletarRfqCompleto(rfqId: string): Promise<void> {
  if (!rfqId) return

  // 1. Limpeza defensiva de registros em rfq_seguradoras
  try {
    const rfqSegs = await pb.collection('rfq_seguradoras').getFullList({
      filter: `rfq = "${rfqId}"`,
    })
    for (const item of rfqSegs) {
      try {
        await pb.collection('rfq_seguradoras').delete(item.id)
      } catch (err) {
        console.warn(`Aviso: falha ao remover rfq_seguradoras ${item.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('Aviso na limpeza prévia de rfq_seguradoras:', err)
  }

  // 2. Limpeza defensiva de propostas vinculadas
  try {
    const props = await pb.collection('propostas').getFullList({
      filter: `rfq = "${rfqId}"`,
    })
    for (const prop of props) {
      try {
        await pb.collection('propostas').delete(prop.id)
      } catch (err) {
        console.warn(`Aviso: falha ao remover proposta ${prop.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('Aviso na limpeza prévia de propostas:', err)
  }

  // 3. Limpeza defensiva de documentos vinculados ao RFQ
  try {
    const docs = await pb.collection('documentos').getFullList({
      filter: `rfq = "${rfqId}"`,
    })
    for (const doc of docs) {
      try {
        await pb.collection('documentos').delete(doc.id)
      } catch (err) {
        console.warn(`Aviso: falha ao remover documento ${doc.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('Aviso na limpeza prévia de documentos do RFQ:', err)
  }

  // 4. Limpeza defensiva de histórico
  try {
    const histList = await pb.collection('historico').getFullList({
      filter: `registro_id = "${rfqId}" || (tabela = "rfq" && registro_id = "${rfqId}")`,
    })
    for (const h of histList) {
      try {
        await pb.collection('historico').delete(h.id)
      } catch (err) {
        console.warn(`Aviso: falha ao remover historico ${h.id}:`, err)
      }
    }
  } catch (err) {
    console.warn('Aviso na limpeza prévia de historico do RFQ:', err)
  }

  // 5. Exclui o registro mestre do RFQ
  await pb.collection('rfq').delete(rfqId)
}
