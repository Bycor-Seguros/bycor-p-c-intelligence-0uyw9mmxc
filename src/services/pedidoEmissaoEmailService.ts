// Serviço do botão "Enviar por e-mail" do Pedido de Emissão:
// cria um RASCUNHO na caixa Outlook do usuário conectado (via conector Skip)
// com o PDF da proposta vencedora anexado. Nada é enviado automaticamente —
// o usuário revisa o rascunho no Outlook e envia por conta própria.
import type RecordModel from 'pocketbase'
import pb from '@/lib/pocketbase/client'
import { execute, listConnectors, type ConnectorState } from '@/lib/skipConnectors'
import type { DadosPropostaVencedora, PedidoEmissaoRecord } from './pedidoEmissaoService'

export { extrairEmailSeguradora } from './pedidoEmissaoService'

const OUTLOOK_TOOLKIT = 'outlook'

export interface ContextoEmailPedido {
  dados: DadosPropostaVencedora
  pedido: PedidoEmissaoRecord | null
  /** Nome para exibição do usuário logado (assina o e-mail). */
  usuarioNome: string
  /** E-mail do usuário logado (vai em CC, editável na tela). */
  usuarioEmail: string
  /** Vigência da proposta (texto formatado, ex.: "01/01/2026 a 31/12/2026"). */
  vigencia: string
  /** Prêmio total (bruto) e parcelamento (texto formatado). */
  premioTotal: string
  parcelamento: string
}

export interface ResultadoEmailPedido {
  ok: boolean
  mensagem: string
  anexoOk: boolean
}

const TOOL_STATUS = 'OUTLOOK_CREATE_DRAFT'
const TOOL_ANEXO = 'OUTLOOK_CREATE_MESSAGE_ATTACHMENT'

/** Busca, via conector, o PDF da proposta vencedora em base64. */
async function baixarAnexoBase64(
  pedido: PedidoEmissaoRecord | null,
  dados: DadosPropostaVencedora,
): Promise<{ nome: string; base64: string } | null> {
  // O anexo é o mesmo arquivo usado no "Abrir anexo": o upload próprio do
  // pedido, ou o arquivo da proposta quando o pedido ainda não tem upload.
  const arquivo = pedido?.arquivo_proposta || dados.arquivoProposta
  const nome = pedido?.arquivo_proposta_nome || dados.arquivoPropostaNome || 'proposta.pdf'
  if (!arquivo) return null

  const url = pedido?.arquivo_proposta
    ? pb.files.getURL(pedido as unknown as RecordModel, arquivo)
    : pb.files.getURL(
        { id: dados.propostaId, collectionName: 'propostas' } as unknown as RecordModel,
        arquivo,
      )
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar o anexo (HTTP ${res.status}).`)
  const blob = await res.blob()
  if (blob.size === 0) return null
  const base64 = await blobToBase64(blob)
  return { nome, base64 }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const resultado = String(reader.result ?? '')
      const virgula = resultado.indexOf(',')
      resolve(virgula >= 0 ? resultado.slice(virgula + 1) : '')
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo do anexo.'))
    reader.readAsDataURL(blob)
  })
}

/** Monta o assunto do e-mail: "Pedido de Emissão — [Segurado] — [Ramo]". */
export function montarAssuntoEmail(dados: DadosPropostaVencedora): string {
  const ramo = dados.seguroContratado.split('—')[0]?.trim() || 'Seguro Patrimonial'
  return `Pedido de Emissão — ${dados.seguradoNome} — ${ramo}`
}

/** Corpo formal do pedido de emissão. */
export function montarCorpoEmail(ctx: ContextoEmailPedido): string {
  const { dados, usuarioNome } = ctx
  const cossegurado = dados.coseguradoNome
    ? `\n• Co-segurado: ${dados.coseguradoNome}${
        dados.coseguradoCnpj ? ` (CNPJ ${dados.coseguradoCnpj})` : ''
      }`
    : ''

  return [
    `Prezados,`,
    ``,
    `Identificação: ${dados.corretora}.`,
    `Vimos, por meio deste, formalizar o pedido de emissão da apólice abaixo indicada.`,
    ``,
    `Dados-chave:`,
    `• Segurado: ${dados.seguradoNome}${dados.seguradoCnpj ? ` (CNPJ ${dados.seguradoCnpj})` : ''}${cossegurado}`,
    `• Seguradora: ${dados.seguradoraNome}`,
    `• Proposta: Opção ${dados.opcao} (v${dados.versao})`,
    `• Prêmio total: ${ctx.premioTotal}`,
    `• Parcelamento: ${ctx.parcelamento || '—'}`,
    `• Vigência: ${ctx.vigencia || '—'}`,
    ``,
    `Solicitamos, gentilmente, a emissão da apólice conforme as condições aprovadas, permanecemos à disposição para os encaminhamentos necessários.`,
    ``,
    `Atenciosamente,`,
    ``,
    `${usuarioNome}`,
    `BYCOR CONSULTORIA E CORRETORA DE SEGUROS`,
  ].join('\n')
}

/** Estado da conta Outlook do usuário conectado (para exibir perto do botão). */
export async function getEstadoOutlook(): Promise<ConnectorState | undefined> {
  const all = await listConnectors()
  return all.find((c) => c.toolkit === OUTLOOK_TOOLKIT)
}

/** Cria o rascunho na caixa do usuário. Nunca envia automaticamente. */
export async function criarRascunhoPedidoEmissao(params: {
  ctx: ContextoEmailPedido
  emailSeguradora: string
  cc: string
  anexo: { nome: string; base64: string } | null
}): Promise<ResultadoEmailPedido> {
  const { ctx, emailSeguradora, cc, anexo } = params
  const estado = await getEstadoOutlook()
  if (!estado || estado.status !== 'connected') {
    return {
      ok: false,
      mensagem: 'Conta Outlook não conectada. Conecte-a para criar o rascunho.',
      anexoOk: false,
    }
  }

  const assunto = montarAssuntoEmail(ctx.dados)
  const corpo = montarCorpoEmail(ctx)

  // "Para": seguradora da proposta eleita; se não houver e-mail cadastrado, avisa.
  if (!emailSeguradora) {
    return {
      ok: false,
      mensagem:
        'A seguradora da proposta eleita não tem e-mail cadastrado no sistema. Preencha o destinatário manualmente ou cadastre o e-mail da seguradora.',
      anexoOk: false,
    }
  }

  const resposta = await execute(TOOL_STATUS, {
    subject: assunto,
    body: corpo,
    is_html: false,
    to_recipients: [emailSeguradora],
    cc_recipients: cc ? [cc] : undefined,
  })
  if (!resposta.successful) {
    return {
      ok: false,
      mensagem: resposta.error || 'Erro ao criar o rascunho no Outlook.',
      anexoOk: false,
    }
  }

  // O rascunho é criado primeiro, e o anexo é adicionado na sequência
  // (Graph API: message_id devolvido pelo create, attachment via contentBytes).
  let anexoOk = false
  if (anexo) {
    try {
      const record = resposta.data as Record<string, unknown> | undefined
      const messageId =
        typeof record?.id === 'string'
          ? record.id
          : typeof record === 'object' && record !== null && 'id' in record
            ? String((record as Record<string, unknown>).id)
            : ''
      if (messageId) {
        const resAnexo = await execute(TOOL_ANEXO, {
          message_id: messageId,
          name: anexo.nome,
          odata_type: '#microsoft.graph.fileAttachment',
          content_bytes: anexo.base64,
          content_type: 'application/pdf',
        })
        anexoOk = resAnexo.successful
      }
    } catch {
      anexoOk = false
    }
  }

  const avisoAnexo = anexo
    ? anexoOk
      ? ''
      : ' (atenção: o anexo não pôde ser adicionado — insira-o manualmente no Outlook)'
    : ' (sem anexo disponível para o PDF da proposta)'
  return {
    ok: true,
    mensagem: `Rascunho criado na sua caixa Outlook${avisoAnexo}. Revise-o e envie manualmente.`,
    anexoOk,
  }
}

// Fim do serviço de e-mail do Pedido de Emissão.
