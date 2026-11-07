import React, { useEffect, useMemo, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { FileText, Paperclip, Loader2, Printer, Save, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { toast } from '@/hooks/use-toast'
import {
  DadosPropostaVencedora,
  PedidoEmissaoRecord,
  salvarPedidoEmissao,
} from '@/services/pedidoEmissaoService'

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
  const [form, setForm] = useState({
    dataPedido: dados.dataPedido,
    corretora: dados.corretora,
    seguroContratado: dados.seguroContratado,
    seguradoNome: dados.seguradoNome,
    seguradoCnpj: dados.seguradoCnpj,
    localRisco: dados.localRisco,
    premioBruto: dados.premioBruto,
    premioLiquido: dados.premioLiquido,
    comissaoTrabalhada: dados.comissaoTrabalhada,
    observacoes: dados.observacoes || '',
  })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    setForm({
      dataPedido: pedidoExistente?.data_pedido || dados.dataPedido,
      corretora: pedidoExistente?.corretora || dados.corretora,
      seguroContratado: pedidoExistente?.seguro_contratado || dados.seguroContratado,
      seguradoNome: pedidoExistente?.segurado_nome || dados.seguradoNome,
      seguradoCnpj: pedidoExistente?.segurado_cnpj || dados.seguradoCnpj,
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

  const arquivoAtual = pedidoExistente?.arquivo_proposta || dados.arquivoProposta || ''
  const nomeArquivoAtual = pedidoExistente?.arquivo_proposta_nome || dados.arquivoPropostaNome || ''

  const baseUrl = useMemo(
    () => ((pb as any).buildURL ? (pb as any).buildURL('') : (pb as any).baseUrl),
    [],
  )

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
          localRisco: form.localRisco,
          premioBruto: form.premioBruto,
          premioLiquido: form.premioLiquido,
          comissaoTrabalhada: form.comissaoTrabalhada,
          observacoes: form.observacoes,
          arquivoProposta: arquivoAtual,
          arquivoPropostaNome: nomeArquivoAtual,
          seguradoraNome: dados.seguradoraNome,
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
          {arquivoAtual ? (
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-gray-700">
                <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                {nomeArquivoAtual || arquivoAtual}
              </span>
              <a
                className="text-[#16578B] font-semibold hover:underline flex items-center gap-1"
                href={`${baseUrl}/api/files/pedido_emissao/${pedidoExistente?.id}/${arquivoAtual}`}
                target="_blank"
                rel="noreferrer"
              >
                <FileDown className="w-3.5 h-3.5" /> Abrir anexo
              </a>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              Nenhum arquivo anexado ainda à proposta vencedora.
            </p>
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

        {/* Campo para assinatura da Bycor */}
        <div className="pt-8 border-t text-center text-xs text-gray-600">
          <div className="border-b w-56 mx-auto mb-1"></div>
          <strong>BYCOR Seguros</strong>
          <p className="text-[11px] text-gray-400">Assinatura da Corretora — Bycor</p>
        </div>

        {form.dataPedido && (
          <p className="text-[10px] text-gray-400 text-right print:hidden">
            Documento gerado em {formatDate(new Date().toISOString())} — editável e consultável na
            tela da C4.
          </p>
        )}
      </div>
    </div>
  )
}
