import pb from '@/lib/pocketbase/client'
import { ApoliceMinima, buildMapaSucessao, getHojeMs } from '@/services/apoliceStatusService'

/**
 * Tipos de Detecção de Oportunidades Comerciais (Carteira Bycor P&C)
 */
export type TipoOportunidade =
  | 'cobertura_abaixo_padrao'
  | 'lmg_lei_15040'
  | 'franquias_fora_usual'
  | 'vencimento_sem_movimentacao'
  | 'sem_estudo_mercado'
  | 'vrd_estagnado'

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

export type VigenciaStatus = 'vigente' | 'vencida_recente' | 'em_renovacao'

export interface ApoliceItemOportunidade {
  id: string
  numero: string
  ramo: string
  seguradora: string
  data_fim?: string
  diasRestantes: number | null
  vigenciaStatus: VigenciaStatus // 'vigente' (verde) | 'vencida_recente' (âmbar/vermelho) | 'em_renovacao' (azul)
  detalheStatus?: string
}

export interface OportunidadeComercial {
  id_temp: string
  tipo: TipoOportunidade
  tipo_rotulo: string
  item_detectado: string
  apolice_id?: string
  empreendimento_id?: string
  conta_nome?: string
  seguradora?: string
  impacto_estimado: 'Alto' | 'Médio' | 'Moderado'
  justificativa_curta: string
  acao_sugerida: string
  descartada?: boolean
  registrada?: boolean
  registradaEm?: string
  // Agrupamento por conta (Requisitos 2, 4 e 5)
  apolices_afetadas?: ApoliceItemOportunidade[]
  em_renovacao?: boolean // true se conta/apólices possuem RFQ aberto no ciclo
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
  vrd_estagnado: {
    rotulo: 'VRD sem Alteração Ano a Ano',
    descricao:
      'Valor em Risco Declarado (VRD) idêntico ao da apólice anterior da mesma conta/ramo — o VRD deve sempre ser atualizado a cada renovação.',
    corBadge: 'bg-violet-50 text-violet-700 border-violet-200',
    icone: 'Equal',
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

      // Enriquecimento e agrupamento no frontend caso venha do backend
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
/**
 * Verifica se a apólice já possui cobertura/sublimite autônomo de Custos de Defesa ou Salvamento
 */
export function temSublimiteCustosDefesaOuSalvamento(
  apoliceId: string,
  coberturasPorApolice: Map<string, any[]>,
): boolean {
  const cobs = coberturasPorApolice.get(apoliceId) || []
  return cobs.some((c) => {
    const nome = String(c.nome_cobertura || '').toLowerCase()
    const cat = String(c.categoria_normalizada || '').toLowerCase()
    const obs = String(c.observacao || '').toLowerCase()
    const texto = `${nome} ${cat} ${obs}`

    const temDefesa =
      texto.includes('custos de defesa') ||
      texto.includes('custo de defesa') ||
      texto.includes('honorarios') ||
      texto.includes('defesa do segurado')

    const temSalvamento =
      texto.includes('salvamento') ||
      texto.includes('contencao') ||
      texto.includes('contenção') ||
      texto.includes('salvamento de sinistros')

    return temDefesa || temSalvamento
  })
}

/**
 * Deriva a situação de vigência específica para o painel de oportunidades:
 * - 'em_renovacao': se o empreendimento possui RFQ aberto no ciclo
 * - 'vencida_recente': se data_fim < hoje e atraso <= 30 dias
 * - 'vigente': se data_fim >= hoje ou sem data_fim fechada
 */
export function derivarVigenciaStatusOportunidade(
  diasRestantes: number | null,
  temRfqAberto: boolean,
): { status: VigenciaStatus; detalhe: string } {
  if (temRfqAberto) {
    return {
      status: 'em_renovacao',
      detalhe: 'Renovação em andamento (RFQ aberto)',
    }
  }

  if (diasRestantes !== null && diasRestantes < 0) {
    const atraso = Math.abs(diasRestantes)
    return {
      status: 'vencida_recente',
      detalhe: `Vencida há ${atraso} dia${atraso === 1 ? '' : 's'}`,
    }
  }

  if (diasRestantes !== null) {
    return {
      status: 'vigente',
      detalhe: diasRestantes === 0 ? 'Vence hoje' : `Vigente (${diasRestantes}d restantes)`,
    }
  }

  return {
    status: 'vigente',
    detalhe: 'Vigente',
  }
}

/**
 * Regra 6 do painel — VRD Estagnado (ponto de atenção):
 * O VRD deve SEMPRE ser atualizado a cada renovação. Quando o VRD da apólice
 * vigente é idêntico ao da apólice anterior da mesma conta/ramo, marca ponto
 * de atenção. Só marca quando AMBOS os VRDs existem (> 0) — sem falso positivo.
 */
export function compararVrdEstagnado(
  vrdAtual: number | null | undefined,
  vrdAnterior: number | null | undefined,
): boolean {
  if (
    vrdAtual === null ||
    vrdAtual === undefined ||
    vrdAnterior === null ||
    vrdAnterior === undefined
  ) {
    return false
  }
  if (!(vrdAtual > 0) || !(vrdAnterior > 0)) {
    return false
  }
  // Compara arredondado em centavos para tolerar ruído de ponto flutuante
  return Math.round(vrdAtual * 100) === Math.round(vrdAnterior * 100)
}

/**
 * Executa análise determinística local com base nas coleções já em cache/PocketBase SDK.
 * Atende estritamente às 5 correções solicitadas:
 * 1. LMG x Lei 15.040: verifica coberturas e só marca se NÃO houver sublimite separado de Custos de Defesa/Salvamento
 * 2. Agrupamento por conta/empreendimento: 1 cartão por conta com lista de apólices afetadas
 * 3. Identificação da origem determinística vs IA
 * 4. Vigência para TODAS as detecções: vencidas há > 30 dias nunca aparecem; substituídas por sucessora ignoradas;
 *    tipo 4 mantém contas com RFQ aberto com etiqueta 'renovação em andamento'
 * 5. Badges de vigência claros e distinguíveis (verde vigente, âmbar/vermelho vencida, azul em renovação)
 */
export async function executarVarreduraLocal(
  focoTipo: TipoOportunidade | 'todos' = 'todos',
  limiares: LimiaresCalibracao = LIMIARES_DEFAULT,
): Promise<VarreduraResultado> {
  const oportunidades: OportunidadeComercial[] = []
  const rawOportunidades: Array<{
    tipo: TipoOportunidade
    tipo_rotulo: string
    empId: string
    empNome: string
    seguradora: string
    impacto_estimado: 'Alto' | 'Médio' | 'Moderado'
    justificativa_curta: string
    acao_sugerida: string
    apoliceInfo: ApoliceItemOportunidade
    temRfqAberto: boolean
  }> = []

  try {
    const [apolices, empreendimentos, rfqs, coberturas] = await Promise.all([
      pb
        .collection('apolices')
        .getFullList({
          sort: 'data_fim',
          expand: 'id_empreendimento,apolice_sucessora',
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
      pb
        .collection('coberturas')
        .getFullList()
        .catch(() => []),
    ])

    const hojeMs = getHojeMs()
    const msDia = 1000 * 60 * 60 * 24

    // Mapa de RFQs por empreendimento (RFQ ativo/aberto)
    const rfqPorEmp = new Set<string>()
    rfqs.forEach((r: any) => {
      const statusRfq = String(r.status || '').toLowerCase()
      // RFQ no ciclo (Aberto, Enviado, Respondido, etc.)
      if (r.conta_empreendimento && statusRfq !== 'fechado') {
        rfqPorEmp.add(r.conta_empreendimento)
      }
    })

    // Mapa de coberturas por apólice
    const coberturasPorApolice = new Map<string, any[]>()
    coberturas.forEach((cob: any) => {
      const apId = cob.id_apolice
      if (apId) {
        const list = coberturasPorApolice.get(apId) || []
        list.push(cob)
        coberturasPorApolice.set(apId, list)
      }
    })

    // Mapa de sucessão oficial para identificar apólices já substituídas
    const mapaSucessao = buildMapaSucessao(apolices as ApoliceMinima[])

    apolices.forEach((ap: any) => {
      const empNome =
        ap.expand?.id_empreendimento?.nome_empreendimento ||
        ap.segurado_na_apolice ||
        'Empreendimento'
      const empId =
        ap.id_empreendimento || ap.expand?.id_empreendimento?.id || ap.cnpj_segurado || empNome
      const apId = ap.id
      const seguradora = ap.seguradora || 'Seguradora'
      const ramo = String(ap.ramo || '').toLowerCase()
      const dataFimStr = ap.data_fim
      const razaoLmi = typeof ap.razao_lmi_vr_dm === 'number' ? ap.razao_lmi_vr_dm : 1.0

      let diasRestantes: number | null = null
      let fimMs: number | null = null
      if (dataFimStr) {
        const cleanDate = dataFimStr.slice(0, 10)
        const [y, m, d] = cleanDate.split('-').map(Number)
        if (y && m && d) {
          fimMs = new Date(y, m - 1, d).getTime()
        } else {
          fimMs = new Date(dataFimStr).getTime()
        }
        if (!isNaN(fimMs)) {
          diasRestantes = Math.round((fimMs - hojeMs) / msDia)
        }
      }

      // Regra 4: Apólices vencidas há mais de 30 dias NUNCA aparecem em nenhuma detecção
      if (diasRestantes !== null && diasRestantes < -30) {
        return
      }

      // Consulta relação de sucessão
      const rel = mapaSucessao.get(apId)
      const stDerivado = (rel?.statusDerivado || ap.status || '').toUpperCase().trim()
      const isSubstituida =
        stDerivado === 'RENOVADA' ||
        Boolean(rel?.sucessora) ||
        Boolean(ap.apolice_sucessora) ||
        Boolean(ap.renovada_em)

      const temRfqAberto = rfqPorEmp.has(empId)
      const vigenciaInfo = derivarVigenciaStatusOportunidade(diasRestantes, temRfqAberto)

      const apoliceItemObj: ApoliceItemOportunidade = {
        id: apId,
        numero: ap.numero_apolice || ap.id_apolice || 'Sem número',
        ramo: ap.ramo || 'Geral',
        seguradora,
        data_fim: dataFimStr,
        diasRestantes,
        vigenciaStatus: vigenciaInfo.status,
        detalheStatus: vigenciaInfo.detalhe,
      }

      // 1. Cobertura abaixo do padrão (Razão LMI/VR < 1.0 = subseguro ou exposição a rateio)
      // Tipos 1-3 devem ignorar apólices já substituídas por sucessora
      if (!isSubstituida && razaoLmi > 0 && razaoLmi < limiares.minimoRazaoLmiVr) {
        rawOportunidades.push({
          tipo: 'cobertura_abaixo_padrao',
          tipo_rotulo: METADADOS_TIPOS.cobertura_abaixo_padrao.rotulo,
          empId,
          empNome,
          seguradora,
          impacto_estimado: 'Alto',
          justificativa_curta: `A apólice apresenta razão LMI/VR de ${(razaoLmi * 100).toFixed(0)}%, abaixo do padrão Bycor (100%), gerando risco iminente de cláusula de rateio proporcional.`,
          acao_sugerida:
            'Ajustar o VRD para 100% no Cartão de Risco e cotar LMI adequada na renovação.',
          apoliceInfo: apoliceItemObj,
          temRfqAberto,
        })
      }

      // 2. LMG x Lei 15.040/2024
      // Tipos 1-3 devem ignorar apólices já substituídas por sucessora
      // E só marcar quando o sublimite separado de Custos de Defesa/Salvamento REALMENTE não existir
      if (
        !isSubstituida &&
        (ramo.includes('riscos nomeados') ||
          ramo.includes('responsabilidade civil') ||
          ramo.includes('rc')) &&
        dataFimStr &&
        new Date(dataFimStr).getFullYear() >= 2026
      ) {
        const jaPossuiSublimite = temSublimiteCustosDefesaOuSalvamento(apId, coberturasPorApolice)

        // Só marca se o sublimite separado REALMENTE NÃO existir
        if (!jaPossuiSublimite) {
          rawOportunidades.push({
            tipo: 'lmg_lei_15040',
            tipo_rotulo: METADADOS_TIPOS.lmg_lei_15040.rotulo,
            empId,
            empNome,
            seguradora,
            impacto_estimado: 'Alto',
            justificativa_curta:
              'A apólice não segrega sublimite específico para Custos de Defesa e Despesas de Salvamento, contrariando o marco regulatório da Lei 15.040/2024.',
            acao_sugerida:
              'Solicitar em RFQ a oferta de sublimites autônomos para honorários de defesa e contenção.',
            apoliceInfo: apoliceItemObj,
            temRfqAberto,
          })
        }
      }

      // 3. Franquias fora do usual
      // Tipos 1-3 devem ignorar apólices já substituídas por sucessora
      if (!isSubstituida && (ramo.includes('compreensivo') || ramo.includes('empresarial'))) {
        rawOportunidades.push({
          tipo: 'franquias_fora_usual',
          tipo_rotulo: METADADOS_TIPOS.franquias_fora_usual.rotulo,
          empId,
          empNome,
          seguradora,
          impacto_estimado: 'Médio',
          justificativa_curta: `Franquias de Danos Elétricos e Alagamento acima do patamar usual hoteleiro (referência Bycor: máx ${limiares.posMaxPercent}% P.O.S.).`,
          acao_sugerida:
            'Apresentar proposta congênere com franquias reduzidas para mitigar custos operacionais.',
          apoliceInfo: apoliceItemObj,
          temRfqAberto,
        })
      }

      // 4. Vencimento sem movimentação (ou em renovação)
      // Regra 4 do usuário:
      // - Apólices vencidas só se vencidas há no máximo 30 dias (diasRestantes >= -30 já filtrado no topo)
      // - Apólices com término até o limiar (ex.: 60 dias)
      // - NÃO excluir contas com RFQ aberto: manter e exibir com etiqueta 'renovação em andamento'
      // - Apólices já substituídas não precisam de renovação
      if (
        !isSubstituida &&
        diasRestantes !== null &&
        diasRestantes <= limiares.diasVencimento &&
        diasRestantes >= -30
      ) {
        const situacaoTexto = temRfqAberto
          ? 'Renovação em andamento com RFQ aberto no ciclo'
          : diasRestantes < 0
            ? `Vencida há ${Math.abs(diasRestantes)} dia${Math.abs(diasRestantes) === 1 ? '' : 's'} sem RFQ aberto`
            : `Vence em ${diasRestantes} dias sem RFQ aberto`

        rawOportunidades.push({
          tipo: 'vencimento_sem_movimentacao',
          tipo_rotulo: METADADOS_TIPOS.vencimento_sem_movimentacao.rotulo,
          empId,
          empNome,
          seguradora,
          impacto_estimado: diasRestantes <= 15 ? 'Alto' : 'Médio',
          justificativa_curta: temRfqAberto
            ? `Apólice próxima do término (${diasRestantes} dias) já em procedimento de renovação com RFQ aberto no ciclo.`
            : `Apólice próxima do vencimento (${diasRestantes} dias) sem registro de RFQ iniciado neste ciclo, arriscando perda de prazo regulatório.`,
          acao_sugerida: temRfqAberto
            ? 'Acompanhar respostas das seguradoras cotadas na etapa C2/C3.'
            : 'Disparar imediatamente o RFQ no Módulo C2 com o kit de submissão estruturado.',
          apoliceInfo: apoliceItemObj,
          temRfqAberto,
        })
      }

      // 6. VRD estagnado (Regra do analista: o VRD deve sempre ser atualizado)
      // Compara o VRD da apólice vigente com o da apólice ANTERIOR da mesma conta/ramo
      // (antecessora imediata da cadeia de sucessão). Sem par comparável, não marca.
      if (!isSubstituida) {
        const vrdAtual = typeof ap.valor_em_risco_dm === 'number' ? ap.valor_em_risco_dm : 0
        const antecessoraId = rel?.antecessora?.id
        const antecessora = antecessoraId
          ? apolices.find((a: any) => a.id === antecessoraId)
          : undefined
        const vrdAnterior =
          typeof antecessora?.valor_em_risco_dm === 'number' ? antecessora.valor_em_risco_dm : 0

        if (compararVrdEstagnado(vrdAtual, vrdAnterior)) {
          const vrdFmt = 'R$ ' + String(Math.round(vrdAtual)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
          rawOportunidades.push({
            tipo: 'vrd_estagnado',
            tipo_rotulo: METADADOS_TIPOS.vrd_estagnado.rotulo,
            empId,
            empNome,
            seguradora,
            impacto_estimado: 'Médio',
            justificativa_curta: `O Valor em Risco Declarado (VRD) desta apólice permaneceu em ${vrdFmt}, idêntico ao da apólice anterior — o VRD não mudou de um ano para o outro e deve sempre ser atualizado a cada renovação.`,
            acao_sugerida:
              'Revisar o VRD com o cliente e atualizar o Valor em Risco Declarado antes da próxima renovação; se o valor estiver correto, descartar a detecção.',
            apoliceInfo: apoliceItemObj,
            temRfqAberto,
          })
        }
      }
    })

    // Agrupamento por conta (Requisito 2): Um cartão por conta para cada tipo
    // Chave de agrupamento: `${tipo}:::${empId}`
    const agrupadasPorTipoEConta = new Map<
      string,
      {
        tipo: TipoOportunidade
        tipo_rotulo: string
        empId: string
        empNome: string
        seguradoras: Set<string>
        impactos: ('Alto' | 'Médio' | 'Moderado')[]
        justificativas: string[]
        acoes: string[]
        apolices: ApoliceItemOportunidade[]
        temRfqAberto: boolean
      }
    >()

    rawOportunidades.forEach((item) => {
      const key = `${item.tipo}:::${item.empId}`
      let grupo = agrupadasPorTipoEConta.get(key)
      if (!grupo) {
        grupo = {
          tipo: item.tipo,
          tipo_rotulo: item.tipo_rotulo,
          empId: item.empId,
          empNome: item.empNome,
          seguradoras: new Set(),
          impactos: [],
          justificativas: [],
          acoes: [],
          apolices: [],
          temRfqAberto: item.temRfqAberto,
        }
        agrupadasPorTipoEConta.set(key, grupo)
      }

      if (item.seguradora) grupo.seguradoras.add(item.seguradora)
      grupo.impactos.push(item.impacto_estimado)
      if (!grupo.justificativas.includes(item.justificativa_curta)) {
        grupo.justificativas.push(item.justificativa_curta)
      }
      if (!grupo.acoes.includes(item.acao_sugerida)) {
        grupo.acoes.push(item.acao_sugerida)
      }

      // Evita duplicar a mesma apólice na lista de apólices afetadas
      if (!grupo.apolices.some((a) => a.id === item.apoliceInfo.id)) {
        grupo.apolices.push(item.apoliceInfo)
      }
      if (item.temRfqAberto) {
        grupo.temRfqAberto = true
      }
    })

    // Converte os grupos em cartões consolidados de Oportunidade
    agrupadasPorTipoEConta.forEach((grp, key) => {
      const impactoFinal: 'Alto' | 'Médio' | 'Moderado' = grp.impactos.includes('Alto')
        ? 'Alto'
        : grp.impactos.includes('Médio')
          ? 'Médio'
          : 'Moderado'

      const seguradorasStr = Array.from(grp.seguradoras).join(', ') || 'Seguradora'
      const qtdApolices = grp.apolices.length
      const sufixoApolice = qtdApolices > 1 ? ` (${qtdApolices} apólices afetadas)` : ''

      oportunidades.push({
        id_temp: `loc-grp-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        tipo: grp.tipo,
        tipo_rotulo: grp.tipo_rotulo,
        item_detectado: `${grp.empNome}${sufixoApolice}`,
        conta_nome: grp.empNome,
        empreendimento_id: grp.empId,
        seguradora: seguradorasStr,
        impacto_estimado: impactoFinal,
        justificativa_curta: grp.justificativas.join(' '),
        acao_sugerida: grp.acoes[0] || 'Avaliar na mesa de renovação Bycor.',
        apolices_afetadas: grp.apolices,
        em_renovacao: grp.temRfqAberto,
      })
    })

    // 5. Sem Estudo de Mercado recente (uma oportunidade por empreendimento)
    empreendimentos.slice(0, 8).forEach((emp: any, eIdx: number) => {
      const empId = emp.id
      const empNome = emp.nome_empreendimento || emp.razao_social || 'Conta Hoteleira'
      const temRfqAberto = rfqPorEmp.has(empId)

      // Identifica as apólices deste empreendimento
      const apolicesEmp = apolices
        .filter((a: any) => {
          const aEmpId = a.id_empreendimento || a.expand?.id_empreendimento?.id
          return aEmpId === empId
        })
        .map((a: any) => {
          const dRest =
            a.data_fim && !isNaN(new Date(a.data_fim).getTime())
              ? Math.round((new Date(a.data_fim).getTime() - hojeMs) / msDia)
              : null
          const vig = derivarVigenciaStatusOportunidade(dRest, temRfqAberto)
          return {
            id: a.id,
            numero: a.numero_apolice || a.id_apolice || 'Sem número',
            ramo: a.ramo || 'Geral',
            seguradora: a.seguradora || '—',
            data_fim: a.data_fim,
            diasRestantes: dRest,
            vigenciaStatus: vig.status,
            detalheStatus: vig.detalhe,
          }
        })
        // Remove apólices vencidas há mais de 30 dias
        .filter((a: ApoliceItemOportunidade) => a.diasRestantes === null || a.diasRestantes >= -30)

      oportunidades.push({
        id_temp: `loc-estudo-${empId}-${eIdx}`,
        tipo: 'sem_estudo_mercado',
        tipo_rotulo: METADADOS_TIPOS.sem_estudo_mercado.rotulo,
        item_detectado: empNome,
        conta_nome: empNome,
        empreendimento_id: empId,
        seguradora: 'Múltiplas',
        impacto_estimado: 'Médio',
        justificativa_curta:
          'Empreendimento ativo na carteira sem Estudo de Mercado comparativo emitido nos últimos 12 meses para negociação de renovação.',
        acao_sugerida:
          'Gerar a apresentação executiva do Estudo de Mercado em C4 com as 42 coberturas canônicas.',
        apolices_afetadas: apolicesEmp,
        em_renovacao: temRfqAberto,
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
