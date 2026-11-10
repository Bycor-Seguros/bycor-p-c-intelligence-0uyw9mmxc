import React, { useEffect, useMemo, useRef, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  FileText,
  Paperclip,
  Loader2,
  Printer,
  Save,
  FileDown,
  Mail,
  Upload,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { toast } from '@/hooks/use-toast'
import {
  DadosPropostaVencedora,
  PedidoEmissaoRecord,
  salvarPedidoEmissao,
} from '@/services/pedidoEmissaoService'
import { useAssinaturaImagem } from '@/hooks/useAssinaturaImagem'
import {
  baixarAnexoBase64,
  criarRascunhoPedidoEmissao,
  getEstadoOutlook,
} from '@/services/pedidoEmissaoEmailService'
import { ConnectorButton } from '@/components/skip/ConnectorButton'
import { useAuth } from '@/contexts/AuthContext'
import {
  montarAssuntoEmail,
  montarCorpoEmail,
  type ContextoEmailPedido,
} from '@/services/pedidoEmissaoEmailService'

interface Props {
  dados: DadosPropostaVencedora
  pedidoExistente: PedidoEmissaoRecord | null
  onSalvo: (rec: PedidoEmissaoRecord) => void
  onFechar: () => void
}

function formatComissaoPct(valor: number): string {
  if (!valor) return '—'
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

/** Documento editável do Pedido de Emissão — gerado a partir da proposta vencedora, sem redigitação. */
export default function PedidoEmissaoDocumento({
  dados,
  pedidoExistente,
  onSalvo,
  onFechar,
}: Props) {
  const { user: usuario } = useAuth()
  const usuarioNome = usuario?.name || usuario?.email?.split('@')[0] || ''

  const [form, setForm] = useState({
    dataPedido: dados.dataPedido,
    corretora: dados.corretora,
    seguroContratado: dados.seguroContratado,
    seguradoNome: dados.seguradoNome,
    seguradoCnpj: dados.seguradoCnpj,
    coseguradoNome: dados.coseguradoNome || '',
    coseguradoCnpj: dados.coseguradoCnpj || '',
    localRisco: dados.localRisco,
    premioBruto: dados.premioBruto,
    premioLiquido: dados.premioLiquido,
    comissaoTrabalhada: dados.comissaoTrabalhada,
    observacoes: dados.observacoes || '',
  })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)

  // E-mail (rascunho Outlook) — Para vem do cadastro da seguradora (editável na conferência);
  // CC é o próprio usuário (editável). Nada é enviado automaticamente.
  const [emailPara, setEmailPara] = useState(dados.seguradoraEmail || '')
  const [emailCc, setEmailCc] = useState(usuario?.email || '')
  const [enviandoEmail, setEnviandoEmail] = useState(false)
  const [dialogEmailAberto, setDialogEmailAberto] = useState(false)
  const [estadoOutlook, setEstadoOutlook] = useState<
    Awaited<ReturnType<typeof getEstadoOutlook>> | undefined
  >(undefined)

  const assinatura = useAssinaturaImagem()
  const inputAssinaturaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getEstadoOutlook().then(setEstadoOutlook)
  }, [])

  const outlookConectada = estadoOutlook?.status === 'connected'

  // Corpo/assunto de pré-visualização na conferência pré-envio (reflete os campos editáveis).
  const contextoEmail: ContextoEmailPedido = useMemo(
    () => ({
      dados: { ...dados, seguradoNome: form.seguradoNome, seguradoCnpj: form.seguradoCnpj },
      pedido: pedidoExistente,
      usuarioNome: usuarioNome || 'BYCOR Seguros',
      usuarioEmail: usuario?.email || '',
      vigencia: '',
      premioTotal: formatCurrency(form.premioBruto),
      parcelamento: '',
    }),
    [
      dados,
      pedidoExistente,
      usuarioNome,
      usuario?.email,
      form.seguradoNome,
      form.seguradoCnpj,
      form.premioBruto,
    ],
  )
  const assuntoEmail = useMemo(() => montarAssuntoEmail(contextoEmail.dados), [contextoEmail.dados])
  const corpoEmail = useMemo(() => montarCorpoEmail(contextoEmail), [contextoEmail])

  const abrirDialogEmail = async () => {
    setDialogEmailAberto(true)
    try {
      setEstadoOutlook(await getEstadoOutlook())
    } catch {
      // Estado fica indefinido; a conferência avisa que a conta não está conectada.
    }
  }

  const handleConfirmarEnviarEmail = async () => {
    setEnviandoEmail(true)
    try {
      const anexo = await baixarAnexoBase64(pedidoExistente, dados)
      const resultado = await criarRascunhoPedidoEmissao({
        ctx: contextoEmail,
        emailSeguradora: emailPara.trim(),
        cc: emailCc.trim(),
        anexo,
      })
      if (resultado.ok) {
        toast({ title: 'Rascunho criado no Outlook', description: resultado.mensagem })
        setDialogEmailAberto(false)
      } else {
        toast({
          title: 'Não foi possível criar o rascunho',
          description: resultado.mensagem,
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao preparar o e-mail',
        description: err?.message || 'Falha ao montar o rascunho no Outlook.',
        variant: 'destructive',
      })
    } finally {
      setEnviandoEmail(false)
    }
  }

  const handleSelecionarAssinatura = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      toast({
        title: 'Formato não suportado',
        description: 'Selecione uma imagem PNG ou JPG para a assinatura digitalizada.',
        variant: 'destructive',
      })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'A assinatura deve ter no máximo 2 MB.',
        variant: 'destructive',
      })
      return
    }
    const url = await assinatura.salvarAssinatura(file)
    if (url) {
      toast({ title: 'Assinatura salva', description: 'Imagem gravada no seu usuário.' })
    } else if (assinatura.error) {
      toast({
        title: 'Erro ao salvar a assinatura',
        description: assinatura.error,
        variant: 'destructive',
      })
    }
  }

  const handleRemoverAssinatura = async () => {
    await assinatura.removerAssinatura()
    toast({ title: 'Assinatura removida' })
  }

  useEffect(() => {
    setForm({
      dataPedido: pedidoExistente?.data_pedido || dados.dataPedido,
      corretora: pedidoExistente?.corretora || dados.corretora,
      seguroContratado: pedidoExistente?.seguro_contratado || dados.seguroContratado,
      seguradoNome: pedidoExistente?.segurado_nome || dados.seguradoNome,
      seguradoCnpj: pedidoExistente?.segurado_cnpj || dados.seguradoCnpj,
      coseguradoNome: pedidoExistente?.cosegurado_nome ?? dados.coseguradoNome ?? '',
      coseguradoCnpj: pedidoExistente?.cosegurado_cnpj ?? dados.coseguradoCnpj ?? '',
      localRisco: pedidoExistente?.local_risco || dados.localRisco,
      premioBruto: Number(pedidoExistente?.premio_bruto ?? dados.premioBruto ?? 0),
      premioLiquido: Number(pedidoExistente?.premio_liquido ?? dados.premioLiquido ?? 0),
      comissaoTrabalhada: Number(
        pedidoExistente?.comissao_trabalhada ?? dados.comissaoTrabalhada ?? 0,
      ),
      observacoes: pedidoExistente?.observacoes || dados.observacoes || '',
    })
    setArquivo(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoExistente?.id])

  // Resolve o arquivo de anexo:
  // Se o próprio registro de pedido_emissao já tiver upload próprio (arquivo_proposta), usa ele.
  // Caso contrário, usa o arquivo original da proposta vencedora (propostas.arquivo).
  const anexoInfo = useMemo(() => {
    if (pedidoExistente?.arquivo_proposta) {
      return {
        url: pb.files.getURL(pedidoExistente as any, pedidoExistente.arquivo_proposta),
        nome: pedidoExistente.arquivo_proposta_nome || pedidoExistente.arquivo_proposta,
        origem: 'pedido' as const,
      }
    }
    if (dados.arquivoProposta && dados.propostaId) {
      return {
        url: pb.files.getURL(
          { id: dados.propostaId, collectionName: 'propostas' } as any,
          dados.arquivoProposta,
        ),
        nome: dados.arquivoPropostaNome || dados.arquivoProposta,
        origem: 'proposta' as const,
      }
    }
    return null
  }, [
    pedidoExistente?.id,
    pedidoExistente?.arquivo_proposta,
    pedidoExistente?.arquivo_proposta_nome,
    dados.arquivoProposta,
    dados.arquivoPropostaNome,
    dados.propostaId,
  ])

  const handleSalvar = async () => {
    setSalvando(true)
    try {
      const rec = await salvarPedidoEmissao(
        {
          propostaId: dados.propostaId,
          rfqId: dados.rfqId,
          empreendimentoId: dados.empreendimentoId,
          dataPedido: form.dataPedido,
          corretora: form.corretora,
          seguroContratado: form.seguroContratado,
          seguradoNome: form.seguradoNome,
          seguradoCnpj: form.seguradoCnpj,
          coseguradoNome: form.coseguradoNome,
          coseguradoCnpj: form.coseguradoCnpj,
          localRisco: form.localRisco,
          premioBruto: form.premioBruto,
          premioLiquido: form.premioLiquido,
          comissaoTrabalhada: form.comissaoTrabalhada,
          observacoes: form.observacoes,
          arquivoProposta: dados.arquivoProposta,
          arquivoPropostaNome: dados.arquivoPropostaNome,
          seguradoraNome: dados.seguradoraNome,
          seguradoraEmail: dados.seguradoraEmail,
          opcao: dados.opcao,
          versao: dados.versao,
        },
        arquivo,
      )
      toast({ title: 'Pedido de Emissão salvo', description: 'Documento atualizado no sistema.' })
      onSalvo(rec)
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao salvar Pedido de Emissão',
        description: err?.message || 'Falha ao gravar o documento.',
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  const campo =
    'w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-[#16578B]'
  const label = 'text-[10px] font-semibold uppercase tracking-wide text-gray-500 block mb-0.5'

  return (
    <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm max-w-4xl mx-auto">
      {/* Cabeçalho do documento */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50/80 rounded-t-xl print:hidden">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#16578B]" />
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              Pedido de Emissão — {dados.seguradoraNome}
            </h3>
            <p className="text-[11px] text-gray-500">
              Gerado a partir da Proposta Vencedora — Opção {dados.opcao} (v{dados.versao}). Sem
              redigitação: dados vindos do cadastro.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs border-gray-300"
            onClick={() => window.print()}
          >
            <Printer className="w-3.5 h-3.5 mr-1" /> Imprimir / PDF
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs bg-[#16578B] hover:bg-[#0F2B46] text-white"
            onClick={handleSalvar}
            disabled={salvando}
          >
            {salvando ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1" />
            )}
            Salvar documento
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </div>

      {/* Barra de e-mail: estado da conta Outlook + botão Enviar por e-mail (rascunho, nunca envio automático) */}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 border-b bg-white print:hidden">
        {estadoOutlook === undefined ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando conta Outlook…
          </span>
        ) : outlookConectada ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Conta Outlook conectada
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
            <AlertCircle className="w-3.5 h-3.5" />
            Conta Outlook não conectada
          </span>
        )}
        <ConnectorButton toolkit="outlook" name="Outlook" className="inline-flex" />
        <Button
          size="sm"
          className="h-8 text-xs bg-[#16578B] hover:bg-[#0F2B46] text-white"
          onClick={abrirDialogEmail}
          disabled={enviandoEmail}
        >
          <Mail className="w-3.5 h-3.5 mr-1" />
          Enviar por e-mail
        </Button>
      </div>

      {/* Corpo A4 do documento */}
      <div className="p-6 sm:p-10 space-y-6 text-gray-900">
        <div className="flex items-start justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0F2B46] text-white flex items-center justify-center font-bold">
              BY
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-[#0F2B46]">
                PEDIDO DE EMISSÃO
              </h1>
              <p className="text-[11px] text-gray-500">Bycor Consultoria e Corretora de Seguros</p>
            </div>
          </div>
          <div className="text-right text-[11px] text-gray-500">
            <div>Documento n.º {pedidoExistente?.id?.slice(0, 8).toUpperCase() || '—'}</div>
            <div>Seguradora: {dados.seguradoraNome}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Data</label>
            <input
              type="date"
              className={campo}
              value={form.dataPedido}
              onChange={(e) => setForm((f) => ({ ...f, dataPedido: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Corretora</label>
            <input
              className={campo}
              value={form.corretora}
              onChange={(e) => setForm((f) => ({ ...f, corretora: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Seguro Contratado</label>
            <input
              className={campo}
              value={form.seguroContratado}
              onChange={(e) => setForm((f) => ({ ...f, seguroContratado: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Segurado</label>
            <input
              className={campo}
              value={form.seguradoNome}
              onChange={(e) => setForm((f) => ({ ...f, seguradoNome: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>CNPJ do Segurado</label>
            <input
              className={campo}
              value={form.seguradoCnpj}
              onChange={(e) => setForm((f) => ({ ...f, seguradoCnpj: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Co-segurado (Razão Social / Nome)</label>
            <input
              className={campo}
              placeholder="Ex: BT SÃO CAETANO HOTÉIS LTDA"
              value={form.coseguradoNome}
              onChange={(e) => setForm((f) => ({ ...f, coseguradoNome: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>CNPJ do Co-segurado</label>
            <input
              className={campo}
              placeholder="00.000.000/0000-00"
              value={form.coseguradoCnpj}
              onChange={(e) => setForm((f) => ({ ...f, coseguradoCnpj: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Local do Risco</label>
            <input
              className={campo}
              value={form.localRisco}
              onChange={(e) => setForm((f) => ({ ...f, localRisco: e.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Prêmio Bruto</label>
            <input
              type="number"
              step="0.01"
              className={campo}
              value={form.premioBruto}
              onChange={(e) => setForm((f) => ({ ...f, premioBruto: Number(e.target.value) }))}
            />
            <span className="text-[10px] text-gray-400">{formatCurrency(form.premioBruto)}</span>
          </div>
          <div>
            <label className={label}>Prêmio Líquido</label>
            <input
              type="number"
              step="0.01"
              className={campo}
              value={form.premioLiquido}
              onChange={(e) => setForm((f) => ({ ...f, premioLiquido: Number(e.target.value) }))}
            />
            <span className="text-[10px] text-gray-400">{formatCurrency(form.premioLiquido)}</span>
          </div>
          <div>
            <label className={label}>Comissão Trabalhada (%)</label>
            <input
              type="number"
              step="0.01"
              className={campo}
              value={form.comissaoTrabalhada}
              onChange={(e) =>
                setForm((f) => ({ ...f, comissaoTrabalhada: Number(e.target.value) }))
              }
            />
            <span className="text-[10px] text-gray-400">
              {formatComissaoPct(form.comissaoTrabalhada)}
            </span>
          </div>
        </div>

        {/* Anexo da proposta vencedora da cia */}
        <div className="border rounded-lg p-4 bg-gray-50/60 space-y-2">
          <label className={label}>Proposta vencedora da cia (anexo)</label>
          {anexoInfo && anexoInfo.url ? (
            <div className="flex items-center justify-between text-xs bg-white border rounded px-3 py-2">
              <span className="flex items-center gap-2 text-gray-700 truncate max-w-md">
                <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="truncate" title={anexoInfo.nome}>
                  {anexoInfo.nome}
                </span>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                  {anexoInfo.origem === 'pedido' ? 'Anexo do Pedido' : 'PDF Original da Proposta'}
                </span>
              </span>
              <a
                className="text-[#16578B] font-semibold hover:underline flex items-center gap-1 shrink-0 ml-2"
                href={anexoInfo.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileDown className="w-3.5 h-3.5" /> Abrir anexo
              </a>
            </div>
          ) : (
            <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
              <strong>Aviso:</strong> Nenhum arquivo de anexo PDF disponível para esta proposta
              vencedora. Você pode selecionar um arquivo abaixo para anexar ao documento.
            </div>
          )}
          <input
            type="file"
            className="text-xs"
            onChange={(e) => setArquivo(e.target.files?.[0] || null)}
          />
          <p className="text-[10px] text-gray-400">
            Selecione um arquivo para anexar/substituir o documento da proposta vencedora da cia
            neste pedido.
          </p>
        </div>

        <div>
          <label className={label}>Observações</label>
          <textarea
            className={campo}
            rows={3}
            value={form.observacoes}
            onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
          />
        </div>

        {/* Rodapé de assinatura (com imagem digitalizada, quando houver) */}
        <div className="pt-8 border-t text-center text-xs text-gray-600">
          {assinatura.url ? (
            <img
              src={assinatura.url}
              alt="Assinatura digitalizada"
              className="h-14 mx-auto mb-1 object-contain"
            />
          ) : (
            <div className="border-b w-56 mx-auto mb-1"></div>
          )}
          <strong>{usuarioNome || 'BYCOR Seguros'}</strong>
          <p className="text-[11px] text-gray-400">BYCOR Seguros</p>
          <p className="text-[10px] text-gray-400 italic">
            Assinatura digitalizada (imagem) — não substitui certificado digital ICP-Brasil.
          </p>

          {/* Upload/gerência da assinatura — somente tela (não sai na impressão) */}
          <div className="mt-4 flex flex-col items-center gap-1.5 print:hidden">
            <input
              ref={inputAssinaturaRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleSelecionarAssinatura}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] border-gray-300"
                onClick={() => inputAssinaturaRef.current?.click()}
                disabled={assinatura.saving}
              >
                {assinatura.saving ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                {assinatura.url ? 'Substituir assinatura' : 'Enviar assinatura (PNG/JPG)'}
              </Button>
              {assinatura.url && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={handleRemoverAssinatura}
                  disabled={assinatura.saving}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Remover
                </Button>
              )}
            </div>
            <p className="text-[10px] text-gray-400">
              A assinatura é uma imagem digitalizada (não é certificado ICP-Brasil) e aparece no
              rodapé do Pedido de Emissão e na Minuta A4.
            </p>
          </div>
        </div>

        {form.dataPedido && (
          <p className="text-[10px] text-gray-400 text-right print:hidden">
            Documento gerado em {formatDate(new Date().toISOString())} — editável e consultável na
            tela da C4.
          </p>
        )}
      </div>

      {/* Dialog de conferência pré-envio — cria um RASCUNHO no Outlook; nada é enviado automaticamente */}
      <Dialog open={dialogEmailAberto} onOpenChange={setDialogEmailAberto}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#16578B]" />
              Enviar por e-mail — conferência do rascunho
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-600">
              Ao confirmar, um <strong>rascunho</strong> é criado na sua caixa Outlook com o PDF da
              proposta anexado. Nada é enviado automaticamente — revise e envie no Outlook.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            {!outlookConectada && (
              <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-amber-800">
                <strong>Aviso:</strong> sua conta Outlook não está conectada. Use o botão de conexão
                acima e tente novamente — o rascunho é criado na SUA caixa de entrada.
              </div>
            )}
            {anexoInfo ? (
              <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50/60 p-2.5 text-emerald-800">
                <Paperclip className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate" title={anexoInfo.nome}>
                  Anexo: {anexoInfo.nome}
                </span>
              </div>
            ) : (
              <div className="rounded border border-amber-200 bg-amber-50/70 p-2.5 text-amber-800">
                Sem anexo disponível: nenhum PDF de proposta encontrado para este pedido.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Para (e-mail da seguradora)</label>
                <input
                  type="email"
                  className={campo}
                  placeholder="Cadastrar e-mail da seguradora ou informe aqui"
                  value={emailPara}
                  onChange={(e) => setEmailPara(e.target.value)}
                />
                {!dados.seguradoraEmail && (
                  <p className="text-[10px] text-amber-700 mt-0.5">
                    A seguradora não tem e-mail cadastrado — preencha o destinatário acima.
                  </p>
                )}
              </div>
              <div>
                <label className={label}>CC (cópia)</label>
                <input
                  type="email"
                  className={campo}
                  value={emailCc}
                  onChange={(e) => setEmailCc(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={label}>Assunto</label>
              <input className={campo} value={assuntoEmail} readOnly />
            </div>

            <div>
              <label className={label}>Corpo do e-mail</label>
              <Textarea
                className="min-h-[180px] font-mono text-[11px]"
                value={corpoEmail}
                readOnly
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-gray-300"
              onClick={() => setDialogEmailAberto(false)}
              disabled={enviandoEmail}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#16578B] hover:bg-[#0F2B46] text-white"
              onClick={handleConfirmarEnviarEmail}
              disabled={enviandoEmail || !outlookConectada || !emailPara.trim()}
              title={
                !outlookConectada
                  ? 'Conecte sua conta Outlook para criar o rascunho'
                  : !emailPara.trim()
                    ? 'Informe o destinatário (Para)'
                    : undefined
              }
            >
              {enviandoEmail ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Mail className="w-3.5 h-3.5 mr-1" />
              )}
              Criar rascunho no Outlook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
