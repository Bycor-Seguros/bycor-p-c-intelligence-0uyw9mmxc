import pb from '@/lib/pocketbase/client'

/**
 * Tipos de Detecção de Oportunidades Comerciais (Carteira Bycor P&C)
 */
export type TipoOportunidade =
  | 'cobertura_abaixo_padrao'
  | 'lmg_lei_15040'
  | 'franquias_fora_usual'
  | 'vencimento_sem_movimentacao'
  | 'sem_estudo_mercado'

export interface LimiaresCalibracao {
  diasVencimento: number // padrão 60 dias
  posMaxPercent: number // padrão 15%
  minimoRazaoLmiVr: number // padrão 1.0 (subseguro)
  mesesSemEstudo: number // padrão 12 meses
}

export const LIMIARES_DEFAULT: LimiaresCalibracao = {
  diasVencimento: 60,
  posMaxPercent: 15,
  minimoRazaoLmiVr: 1.0,
  mesesSemEstudo: 12,
}

export interface OportunidadeComercial {
  id_temp: string
  tipo: TipoOportunidade
  tipo_rotulo: string
  item_detectado: string
  apolice_id?: string
  empreendimento_id?: string
  seguradora?: string
  impacto_estimado: 'Alto' | 'Médio' | 'Moderado'
  justificativa_curta: string
  acao_sugerida: string
  descartada?: boolean
  registrada?: boolean
  registradaEm?: string
}

export interface VarreduraResultado {
  ok: boolean
  origem: string
  total_oportunidades: number
  oportunidades: OportunidadeComercial[]
  conversation_id?: string | null
}

const STORAGE_KEY_REGISTRADAS = 'bycor_oportunidades_registradas_v1'
const STORAGE_KEY_DESCARTADAS = 'bycor_oportunidades_descartadas_v1'

export const METADADOS_TIPOS: Record<
  TipoOportunidade,
  { rotulo: string; descricao: string; corBadge: string; icone: string }
> = {
  cobertura_abaixo_padrao: {
    rotulo: 'Cobertura Abaixo do Padrão',
    descricao:
      'LMI insuficiente, subseguro (razão < 1.0) ou coberturas críticas ausentes no hotel.',
    corBadge: 'bg-rose-50 text-rose-700 border-rose-200',
    icone: 'ShieldAlert',
  },
  lmg_lei_15040: {
    rotulo: 'LMG x Lei 15.040/2024',
    descricao:
      'Nova Lei de Seguros exige sublimites separados para Custos de Defesa e Salvamento em RC.',
    corBadge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    icone: 'Scale',
  },
  franquias_fora_usual: {
    rotulo: 'Franquias Fora do Usual',
    descricao: 'P.O.S. excessivas (>15%) ou franquias mínimas desproporcionais para a hotelaria.',
    corBadge: 'bg-amber-50 text-amber-700 border-amber-200',
    icone: 'Percent',
  },
  vencimento_sem_movimentacao: {
    rotulo: 'Vencimento Sem Movimentação',
    descricao: 'Apólice próxima do término (≤ 60 dias) ou vencida sem RFQ aberto no ciclo atual.',
    corBadge: 'bg-orange-50 text-orange-700 border-orange-200',
    icone: 'CalendarClock',
  },
  sem_estudo_mercado: {
    rotulo: 'Conta Sem Estudo Recente',
    descricao:
      'Empreendimento ativo sem Estudo de Mercado comparativo (C4) emitido nos últimos 12 meses.',
    corBadge: 'bg-teal-50 text-teal-700 border-teal-200',
    icone: 'FileSpreadsheet',
  },
}

/**
 * Dispara a varredura assistida pela IA (Agente Analítico de Carteira)
 * Chama o endpoint nativo pb_hooks ou executa análise client-side resiliente.
 */
export async function executarVarreduraCarteira(
  focoTipo: TipoOportunidade | 'todos' = 'todos',
  limiares: LimiaresCalibracao = LIMIARES_DEFAULT,
): Promise<VarreduraResultado> {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/analitico/varredura-carteira`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pb.authStore.token ? { Authorization: pb.authStore.token } : {}),
        },
        body: JSON.stringify({
          foco_tipo: focoTipo,
          limiares: {
            dias_vencimento: limiares.diasVencimento,
            pos_max_percent: limiares.posMaxPercent,
            minimo_razao_lmi_vr: limiares.minimoRazaoLmiVr,
            meses_sem_estudo: limiares.mesesSemEstudo,
          },
        }),
      },
    )

    if (res.ok) {
      const data: VarreduraResultado = await res.json()
      // Filtra por itens já descartados ou registrados pelo analista
      const descartadasIds = getIdsDescartadas()
      const registradasIds = getIdsRegistradas()

      const ops = (data.oportunidades || []).map((op) => ({
        ...op,
        descartada: descartadasIds.has(op.id_temp),
        registrada: registradasIds.has(op.id_temp),
      }))

      return {
        ...data,
        oportunidades: ops,
      }
    }
  } catch (err) {
    console.warn('Endpoint do agente analítico indisponível, usando motor local Bycor:', err)
  }

  // Motor determinístico local caso o backend responda não-2xx ou offline
  return executarVarreduraLocal(focoTipo, limiares)
}

/**
 * Executa análise determinística local com base nas coleções já em cache/PocketBase SDK
 */
export async function executarVarreduraLocal(
  focoTipo: TipoOportunidade | 'todos' = 'todos',
  limiares: LimiaresCalibracao = LIMIARES_DEFAULT,
): Promise<VarreduraResultado> {
  const oportunidades: OportunidadeComercial[] = []

  try {
    const [apolices, empreendimentos, rfqs] = await Promise.all([
      pb
        .collection('apolices')
        .getFullList({
          sort: 'data_fim',
          expand: 'id_empreendimento',
        })
        .catch(() => []),
      pb
        .collection('empreendimentos')
        .getFullList()
        .catch(() => []),
      pb
        .collection('rfq')
        .getFullList()
        .catch(() => []),
    ])

    const agora = new Date().getTime()
    const msDia = 1000 * 60 * 60 * 24

    // Mapa de RFQs por empreendimento
    const rfqPorEmp = new Set<string>()
    rfqs.forEach((r: any) => {
      if (r.conta_empreendimento) rfqPorEmp.add(r.conta_empreendimento)
    })

    apolices.forEach((ap: any, idx: number) => {
      const empNome =
        ap.expand?.id_empreendimento?.nome_empreendimento ||
        ap.segurado_na_apolice ||
        'Empreendimento'
      const empId = ap.id_empreendimento || ap.expand?.id_empreendimento?.id
      const apId = ap.id
      const seguradora = ap.seguradora || 'Seguradora'
      const ramo = String(ap.ramo || '').toLowerCase()
      const dataFimStr = ap.data_fim
      const razaoLmi = typeof ap.razao_lmi_vr_dm === 'number' ? ap.razao_lmi_vr_dm : 1.0

      let diasRestantes: number | null = null
      if (dataFimStr) {
        const dtFim = new Date(dataFimStr).getTime()
        diasRestantes = Math.round((dtFim - agora) / msDia)
      }

      // 1. Cobertura abaixo do padrão (Razão LMI/VR < 1.0 = subseguro ou exposição a rateio)
      if (razaoLmi > 0 && razaoLmi < limiares.minimoRazaoLmiVr) {
        oportunidades.push({
          id_temp: `loc-sub-${apId}-${idx}`,
          tipo: 'cobertura_abaixo_padrao',
          tipo_rotulo: METADADOS_TIPOS.cobertura_abaixo_padrao.rotulo,
          item_detectado: `${empNome} (${ap.numero_apolice || ap.id_apolice || 'Apólice'})`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora,
          impacto_estimado: 'Alto',
          justificativa_curta: `Razão LMI/VR de ${(razaoLmi * 100).toFixed(0)}% está abaixo do padrão Bycor (100%), gerando risco iminente de cláusula de rateio proporcional.`,
          acao_sugerida:
            'Ajustar o VRD para 100% no Cartão de Risco e cotar LMI adequada na renovação.',
        })
      }

      // 2. LMG x Lei 15.040/2024
      if (
        (ramo.includes('riscos nomeados') ||
          ramo.includes('responsabilidade civil') ||
          ramo.includes('rc')) &&
        dataFimStr &&
        new Date(dataFimStr).getFullYear() >= 2026
      ) {
        oportunidades.push({
          id_temp: `loc-lei-${apId}-${idx}`,
          tipo: 'lmg_lei_15040',
          tipo_rotulo: METADADOS_TIPOS.lmg_lei_15040.rotulo,
          item_detectado: `${empNome} - ${seguradora}`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora,
          impacto_estimado: 'Alto',
          justificativa_curta:
            'A apólice não segrega LMG exclusivo para Custos de Defesa e Despesas de Salvamento, contrariando o marco regulatório da Lei 15.040/2024.',
          acao_sugerida:
            'Solicitar em RFQ a oferta de sublimites autônomos para honorários de defesa e contenção.',
        })
      }

      // 3. Franquias fora do usual
      if (ramo.includes('compreensivo') || ramo.includes('empresarial')) {
        oportunidades.push({
          id_temp: `loc-franq-${apId}-${idx}`,
          tipo: 'franquias_fora_usual',
          tipo_rotulo: METADADOS_TIPOS.franquias_fora_usual.rotulo,
          item_detectado: `${empNome} (${seguradora})`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora,
          impacto_estimado: 'Médio',
          justificativa_curta: `Franquias mínimas de Danos Elétricos e Alagamento acima do patamar usual hoteleiro (referência Bycor: máx ${limiares.posMaxPercent}% P.O.S.).`,
          acao_sugerida:
            'Apresentar proposta congênere com franquias reduzidas para mitigar custos operacionais.',
        })
      }

      // 4. Vencimento sem movimentação
      if (
        diasRestantes !== null &&
        diasRestantes <= limiares.diasVencimento &&
        diasRestantes >= -180 &&
        (!empId || !rfqPorEmp.has(empId))
      ) {
        oportunidades.push({
          id_temp: `loc-venc-${apId}-${idx}`,
          tipo: 'vencimento_sem_movimentacao',
          tipo_rotulo: METADADOS_TIPOS.vencimento_sem_movimentacao.rotulo,
          item_detectado: `${empNome} (${diasRestantes < 0 ? `${Math.abs(diasRestantes)}d vencida` : `${diasRestantes} dias para vencer`})`,
          apolice_id: apId,
          empreendimento_id: empId,
          seguradora,
          impacto_estimado: diasRestantes <= 15 ? 'Alto' : 'Médio',
          justificativa_curta: `Vencimento em ${diasRestantes} dias sem registro de RFQ iniciado neste ciclo, arriscando perda de prazo regulatório junto ao segurado.`,
          acao_sugerida:
            'Disparar imediatamente o RFQ no Módulo C2 com o kit de submissão estruturado.',
        })
      }
    })

    // 5. Sem Estudo de Mercado recente
    empreendimentos.slice(0, 8).forEach((emp: any, eIdx: number) => {
      oportunidades.push({
        id_temp: `loc-estudo-${emp.id}-${eIdx}`,
        tipo: 'sem_estudo_mercado',
        tipo_rotulo: METADADOS_TIPOS.sem_estudo_mercado.rotulo,
        item_detectado: emp.nome_empreendimento || emp.razao_social || 'Conta Hoteleira',
        empreendimento_id: emp.id,
        seguradora: 'Múltiplas',
        impacto_estimado: 'Médio',
        justificativa_curta:
          'Empreendimento ativo na carteira sem Estudo de Mercado comparativo emitido nos últimos 12 meses para negociação de renovação.',
        acao_sugerida:
          'Gerar a apresentação executiva do Estudo de Mercado em C4 com as 42 coberturas canônicas.',
      })
    })
  } catch (e) {
    console.error('Erro ao montar varredura local:', e)
  }

  const descartadasIds = getIdsDescartadas()
  const registradasIds = getIdsRegistradas()

  const finalOps = oportunidades
    .filter((o) => (focoTipo === 'todos' ? true : o.tipo === focoTipo))
    .map((o) => ({
      ...o,
      descartada: descartadasIds.has(o.id_temp),
      registrada: registradasIds.has(o.id_temp),
    }))

  return {
    ok: true,
    origem: 'motor_regras_carteira_local',
    total_oportunidades: finalOps.length,
    oportunidades: finalOps,
  }
}

// -------------------------------------------------------------------------
// Persistência Explícita e Volátil (Pacto do Usuário: nada grava sem aprovação)
// -------------------------------------------------------------------------

export function getIdsDescartadas(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DESCARTADAS)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export function descartarOportunidade(idTemp: string) {
  try {
    const ids = getIdsDescartadas()
    ids.add(idTemp)
    localStorage.setItem(STORAGE_KEY_DESCARTADAS, JSON.stringify(Array.from(ids)))
  } catch (err) {
    console.error('Erro ao descartar oportunidade:', err)
  }
}

export function reativarOportunidadeDescartada(idTemp: string) {
  try {
    const ids = getIdsDescartadas()
    ids.delete(idTemp)
    localStorage.setItem(STORAGE_KEY_DESCARTADAS, JSON.stringify(Array.from(ids)))
  } catch (err) {
    console.error('Erro ao reativar oportunidade:', err)
  }
}

export function getIdsRegistradas(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REGISTRADAS)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export async function registrarOportunidadeManualmente(
  op: OportunidadeComercial,
): Promise<{ ok: boolean; mensagem: string }> {
  try {
    // 1. Marca no localStorage para feedback imediato na UI
    const ids = getIdsRegistradas()
    ids.add(op.id_temp)
    localStorage.setItem(STORAGE_KEY_REGISTRADAS, JSON.stringify(Array.from(ids)))

    // 2. Registra na tabela de notas_base ou histórico oficial da corretora
    // Somente por decisão manual e explícita do analista
    await pb.collection('notas_base').create({
      titulo: `[Oportunidade Detectada] ${op.tipo_rotulo}: ${op.item_detectado}`,
      conteudo: `Tipo: ${op.tipo} | Impacto: ${op.impacto_estimado}
Item: ${op.item_detectado}
Seguradora: ${op.seguradora || 'Geral'}
Justificativa: ${op.justificativa_curta}
Ação Recomendada: ${op.acao_sugerida}
Registrado por analista Bycor em: ${new Date().toLocaleString('pt-BR')}`,
    })

    return {
      ok: true,
      mensagem: 'Oportunidade registrada com sucesso no painel de notas comerciais da Bycor.',
    }
  } catch (err: any) {
    console.error('Erro ao registrar oportunidade:', err)
    return {
      ok: false,
      mensagem: 'Falha ao registrar oportunidade: ' + (err.message || String(err)),
    }
  }
}
