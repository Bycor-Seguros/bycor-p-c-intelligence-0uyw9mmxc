import pb from '@/lib/pocketbase/client'

/** Chave de identidade de uma proposta dentro do RFQ: seguradora + Opção + Versão. */
export function chaveProposta(p: { seguradora: string; opcao?: number; versao?: number }): string {
  return `${p.seguradora}__opcao${Number(p.opcao || 1)}__versao${Number(p.versao || 1)}`
}

/** Lista de Pedidos de Emissão de um RFQ (mais recentes primeiro). */
export async function listarPedidosEmissao(rfqId: string): Promise<PedidoEmissaoRecord[]> {
  if (!rfqId) return []
  return pb.collection('pedido_emissao').getFullList<PedidoEmissaoRecord>({
    filter: `rfq = "${rfqId}"`,
    sort: '-created',
    expand: 'proposta',
  })
}

export interface PedidoEmissaoRecord {
  id: string
  rfq: string
  proposta: string
  empreendimento: string
  data_pedido: string
  corretora: string
  seguro_contratado: string
  segurado_nome: string
  segurado_cnpj: string
  cosegurado_nome?: string
  cosegurado_cnpj?: string
  cosegurado_participacao?: string
  local_risco: string
  premio_bruto: number
  premio_liquido: number
  comissao_trabalhada: number
  observacoes: string
  arquivo_proposta: string
  arquivo_proposta_nome: string
  created?: string
  updated?: string
  expand?: any
}

/** Campos que vêm direto do cadastro da proposta vencedora (sem redigitação). */
export interface DadosPropostaVencedora {
  propostaId: string
  rfqId: string
  empreendimentoId: string
  dataPedido: string
  corretora: string
  seguroContratado: string
  seguradoNome: string
  seguradoCnpj: string
  coseguradoNome: string
  coseguradoCnpj: string
  coseguradoParticipacao: string
  localRisco: string
  premioBruto: number
  premioLiquido: number
  comissaoTrabalhada: number
  observacoes: string
  arquivoProposta: string
  arquivoPropostaNome: string
  seguradoraNome: string
  /** E-mail da seguradora no cadastro (vazio quando não cadastrado). */
  seguradoraEmail: string
  opcao: number
  versao: number
}

type PropostaExpandida = {
  id: string
  rfq: string
  seguradora: string
  opcao?: number
  versao?: number
  premio_bruto?: number
  premio_liquido?: number
  comissao_trabalhada?: number
  data_proposta?: string
  vigencia_inicio?: string
  vigencia_fim?: string
  arquivo?: string
  arquivo_nome?: string
  arquivo_tipo?: string
  status?: string
  expand?: {
    seguradora?: { id?: string; nome?: string; contatos?: unknown }
    rfq?: { conta_empreendimento?: string }
  }
}

/** Monta os dados do Pedido de Emissão a partir da proposta vencedora (dados já cadastrados). */
export function montarDadosPedidoEmissao(
  prop: PropostaExpandida,
  emp?: {
    id?: string
    nome_empreendimento?: string
    razao_social?: string
    cnpj?: string
    cossegurado_nome?: string
    cossegurado_cnpj?: string
    cidade?: string
    uf?: string
    endereco?: string
  },
): DadosPropostaVencedora {
  const segNome = prop.expand?.seguradora?.nome || 'Seguradora'
  const opNum = Number(prop.opcao || 1)
  const vNum = Number(prop.versao || 1)

  const localRisco = [emp?.endereco, emp?.cidade, emp?.uf].filter(Boolean).join(' • ')

  return {
    propostaId: prop.id,
    rfqId: prop.rfq || '',
    empreendimentoId: emp?.id || prop.expand?.rfq?.conta_empreendimento || '',
    dataPedido: new Date().toISOString().slice(0, 10),
    corretora: 'BYCOR CONSULTORIA E CORRETORA DE SEGUROS',
    seguroContratado: `Ramo Patrimonial — ${segNome} — Opção ${opNum} (v${vNum})`,
    seguradoNome: emp?.razao_social || emp?.nome_empreendimento || 'Segurado',
    seguradoCnpj: emp?.cnpj || '',
    coseguradoNome: emp?.cossegurado_nome || '',
    coseguradoCnpj: emp?.cossegurado_cnpj || '',
    coseguradoParticipacao: emp?.cossegurado_nome ? '100%' : '',
    localRisco: localRisco || '—',
    premioBruto: Number(prop.premio_bruto || 0),
    premioLiquido: Number(prop.premio_liquido || 0),
    comissaoTrabalhada: Number(prop.comissao_trabalhada || 0),
    observacoes: '',
    arquivoProposta: prop.arquivo || '',
    arquivoPropostaNome: prop.arquivo_nome || '',
    seguradoraNome: segNome,
    seguradoraEmail: extrairEmailSeguradora(prop.expand?.seguradora?.contatos),
    opcao: opNum,
    versao: vNum,
  }
}

/** Extrai o e-mail da seguradora do campo `contatos` (JSON string ou objeto). */
export function extrairEmailSeguradora(contatos: unknown): string {
  let rec: Record<string, unknown> | null = null
  if (typeof contatos === 'string' && contatos.trim()) {
    try {
      rec = JSON.parse(contatos) as Record<string, unknown>
    } catch {
      rec = null
    }
  } else if (typeof contatos === 'object' && contatos !== null) {
    rec = contatos as Record<string, unknown>
  }
  if (!rec) return ''
  const email = typeof rec.email === 'string' ? rec.email.trim() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

/** Salva (cria ou atualiza) o Pedido de Emissão da proposta vencedora. */
export async function salvarPedidoEmissao(
  dados: DadosPropostaVencedora,
  arquivoNovo?: File | null,
): Promise<PedidoEmissaoRecord> {
  // Um pedido de emissão por proposta vencedora.
  const existentes = await pb.collection('pedido_emissao').getFullList<PedidoEmissaoRecord>({
    filter: `proposta = "${dados.propostaId}"`,
    sort: '-created',
  })

  const formData = new FormData()
  formData.append('rfq', dados.rfqId)
  formData.append('proposta', dados.propostaId)
  if (dados.empreendimentoId) formData.append('empreendimento', dados.empreendimentoId)
  formData.append('data_pedido', dados.dataPedido)
  formData.append('corretora', dados.corretora)
  formData.append('seguro_contratado', dados.seguroContratado)
  formData.append('segurado_nome', dados.seguradoNome)
  formData.append('segurado_cnpj', dados.seguradoCnpj)
  formData.append('cosegurado_nome', dados.coseguradoNome || '')
  formData.append('cosegurado_cnpj', dados.coseguradoCnpj || '')
  formData.append('cosegurado_participacao', dados.coseguradoParticipacao || '')
  formData.append('local_risco', dados.localRisco)
  formData.append('premio_bruto', String(dados.premioBruto ?? 0))
  formData.append('premio_liquido', String(dados.premioLiquido ?? 0))
  formData.append('comissao_trabalhada', String(dados.comissaoTrabalhada ?? 0))
  formData.append('observacoes', dados.observacoes || '')
  if (arquivoNovo) formData.append('arquivo_proposta', arquivoNovo)

  if (existentes.length > 0) {
    return pb.collection('pedido_emissao').update(existentes[0].id, formData)
  }
  return pb.collection('pedido_emissao').create(formData)
}

/** Exclui o Pedido de Emissão vinculado à proposta (usado ao desmarcar a vencedora). */
export async function deletarPedidoEmissaoDaProposta(propostaId: string): Promise<void> {
  try {
    const existentes = await pb.collection('pedido_emissao').getFullList({
      filter: `proposta = "${propostaId}"`,
    })
    for (const p of existentes) {
      await pb.collection('pedido_emissao').delete(p.id)
    }
  } catch {
    // Se falhar, não bloqueia o fluxo da vencedora.
  }
}
