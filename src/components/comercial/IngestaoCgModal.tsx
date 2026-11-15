/**
 * Modal de Ingestão de CGs — Biblioteca de CGs (Fase 2, piloto AXA).
 *
 * Fluxo: upload do PDF da CG + seguradora + produto/versão → extração (leitor
 * cgIngestaoReader, pág/slotY padrão QAR) → casamento por similaridade via
 * motor C3 (casarComMotorC3 do cgIngestaoService) → FILA DE REVISÃO.
 *
 * Regra de ouro: NADA é gravado em cobertura_sinonimos sem confirmação humana.
 * Confirmar grava via salvarSinonimo (motor C3); rejeitar marca como candidato
 * a CG nova ou exclusão "não cobre" — nunca cria CG automaticamente.
 */

import { useState, useRef, useEffect } from 'react'
import pb from '@/lib/pocketbase/client'
import { extractTextFromPdf } from '@/services/pdfTextExtractor'
import {
  lerCondicoesGerais,
  detectarProcessoSusepCg,
  detectarProdutoVersaoCg,
  chaveGuardaCg,
  type CgIngestaoItemExtraido,
} from '@/services/cgIngestaoReader'
import {
  processarCgParaRevisao,
  salvarSessaoIngestao,
  confirmarItemIngestao,
  rejeitarItemIngestao,
  casarComMotorC3,
  LIMIAR_CONFIANCA_CG,
} from '@/services/cgIngestaoService'
import type { CoberturaCanonicaRecord } from '@/services/equivalenciaCoberturasService'
import type { SeguradoraCadastroRecord } from '@/services/seguradoraNormalizer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Upload, FileText, Check, X, AlertCircle, Loader2, CheckCircle2, Ban } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  canonicas: CoberturaCanonicaRecord[]
  seguradoras: SeguradoraCadastroRecord[]
  onIngestaoConcluida: () => void
}

interface FilaItem {
  uid: string
  extraido: CgIngestaoItemExtraido
  confianca: number
  matchType: string
  canonicaIdSelecionada: string
  canonicaNomeSelecionada: string
  status: 'pendente' | 'confirmado' | 'rejeitado'
  sinonimoId?: string
  destinoRejeicao?: 'candidato_cg_nova' | 'exclusao_nao_cobre'
}

function formatoConfianca(c: number): string {
  return `${Math.round(c * 100)}%`
}

function corConfianca(c: number): string {
  if (c >= LIMIAR_CONFIANCA_CG) return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (c >= 0.5) return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

export default function IngestaoCgModal({
  open,
  onOpenChange,
  canonicas,
  seguradoras,
  onIngestaoConcluida,
}: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [seguradoraId, setSeguradoraId] = useState('')
  const [seguradoraNome, setSeguradoraNome] = useState('')
  const [produtoVersao, setProdutoVersao] = useState('')
  const [processoSusep, setProcessoSusep] = useState('')
  const [extraindo, setExtraindo] = useState(false)
  const [salvandoSessao, setSalvandoSessao] = useState(false)
  const [fila, setFila] = useState<FilaItem[]>([])
  const [ingestaoId, setIngestaoId] = useState('')
  const [resumo, setResumo] = useState<{ confirmados: number; rejeitados: number } | null>(null)
  const [erro, setErro] = useState('')
  const [processandoUid, setProcessandoUid] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setArquivo(null)
    setSeguradoraId('')
    setSeguradoraNome('')
    setProdutoVersao('')
    setProcessoSusep('')
    setExtraindo(false)
    setSalvandoSessao(false)
    setFila([])
    setIngestaoId('')
    setResumo(null)
    setErro('')
    setProcessandoUid(null)
  }

  useEffect(() => {
    if (!open) reset()
  }, [open])

  const handleSelecionarArquivo = async (f: File | null) => {
    if (!f) return
    setArquivo(f)
    setErro('')
    setFila([])
    setIngestaoId('')
    setResumo(null)
    setExtraindo(true)
    try {
      const pages = await extractTextFromPdf(f, 350)
      if (!pages.length) throw new Error('Nenhum texto extraído do PDF.')

      const textoCompleto = pages.map((p) => p.text).join('\n')
      const p = detectarProcessoSusepCg(textoCompleto)
      if (p) setProcessoSusep(p)
      const v = detectarProdutoVersaoCg(textoCompleto)
      if (v && !produtoVersao.trim()) setProdutoVersao(v)

      const leitura = lerCondicoesGerais(pages)
      const itensCobertura = leitura.itens.filter((i) => i.tipoItem === 'cobertura')
      if (!itensCobertura.length) {
        throw new Error(
          'Nenhuma seção candidata a cobertura encontrada. Verifique se o PDF é uma CG válida.',
        )
      }

      const filaMontada: FilaItem[] = itensCobertura.map((it, idx) => ({
        uid: `cg_${idx}_${it.pagina}_${Math.round(it.slotY)}`,
        extraido: it,
        confianca: 0,
        matchType: 'sem_sugestao',
        canonicaIdSelecionada: '',
        canonicaNomeSelecionada: '',
        status: 'pendente',
      }))
      setFila(filaMontada)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e))
      setFila([])
    } finally {
      setExtraindo(false)
    }
  }

  /** Monta a fila de revisão: motor C3 sugere a CG canônica de cada item extraído. */
  const montarSugestoes = () => {
    setFila((prev) =>
      prev.map((f) => {
        const casamento = casarComMotorC3(f.extraido.nomeExtraido, canonicas)
        return {
          ...f,
          confianca: casamento.confianca,
          matchType: casamento.matchType,
          canonicaIdSelecionada: casamento.canonicaId,
          canonicaNomeSelecionada: casamento.canonicaNome,
        }
      }),
    )
  }

  /** Grava a sessão (cg_ingestoes) e os itens como pendentes — 1x por upload. */
  const iniciarSessao = async (): Promise<string> => {
    if (ingestaoId) return ingestaoId
    if (!arquivo || !seguradoraId) throw new Error('Seguradora e PDF são obrigatórios.')
    setSalvandoSessao(true)
    try {
      const itens = fila.map((f) => ({
        tipoItem: 'cobertura' as const,
        nomeExtraido: f.extraido.nomeExtraido,
        secaoOrigem: f.extraido.secaoOrigem,
        pagina: f.extraido.pagina,
        slotY: f.extraido.slotY,
        exclusoes: f.extraido.exclusoes.map((e) => e.texto),
        sugestaoCanonicaId: f.canonicaIdSelecionada,
        sugestaoCanonicaNome: f.canonicaNomeSelecionada,
        confianca: f.confianca,
        matchType: f.matchType,
        status: 'pendente' as const,
      }))
      const id = await salvarSessaoIngestao({
        seguradoraId,
        seguradoraNome: seguradoraNome.trim(),
        produtoVersao: produtoVersao.trim(),
        processoSusep: processoSusep.trim(),
        fonteArquivo: arquivo.name,
        totalItens: itens.length,
        totalExclusoes: itens.reduce((acc, i) => acc + i.exclusoes.length, 0),
        itens,
      })
      setIngestaoId(id)
      return id
    } finally {
      setSalvandoSessao(false)
    }
  }

  const handleConfirmar = async (f: FilaItem) => {
    if (!f.canonicaIdSelecionada) {
      setErro('Selecione a CG canônica de destino antes de confirmar.')
      return
    }
    try {
      setProcessandoUid(f.uid)
      setErro('')
      const id = await iniciarSessao()
      const usuarioId = pb.authStore.record?.id as string | undefined
      // Encontra o registro persistido do item para atualizar seu status.
      const chave = chaveGuardaCg(f.extraido.nomeExtraido)
      const itemRecord = await pb
        .collection('cg_ingestao_itens')
        .getFirstListItem(`ingestao="${id}" && chave_normalizada="${chave}"`)
      const resultado = await confirmarItemIngestao({
        itemRecordId: itemRecord.id,
        item: {
          tipoItem: 'cobertura',
          nomeExtraido: f.extraido.nomeExtraido,
          secaoOrigem: f.extraido.secaoOrigem,
          pagina: f.extraido.pagina,
          slotY: f.extraido.slotY,
          exclusoes: f.extraido.exclusoes.map((e) => e.texto),
          sugestaoCanonicaId: f.canonicaIdSelecionada,
          sugestaoCanonicaNome: f.canonicaNomeSelecionada,
          confianca: f.confianca,
          matchType: f.matchType,
          status: 'pendente',
        },
        seguradoraId,
        seguradoraNome: seguradoraNome.trim(),
        canonicaId: f.canonicaIdSelecionada,
        canonicaNome: f.canonicaNomeSelecionada,
        usuarioId,
      })
      setFila((prev) =>
        prev.map((x) =>
          x.uid === f.uid ? { ...x, status: 'confirmado', sinonimoId: resultado.sinonimoId } : x,
        ),
      )
      setResumo((prev) => ({
        confirmados: (prev?.confirmados ?? 0) + 1,
        rejeitados: prev?.rejeitados ?? 0,
      }))
      onIngestaoConcluida()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setProcessandoUid(null)
    }
  }

  const handleRejeitar = async (
    f: FilaItem,
    destino: 'candidato_cg_nova' | 'exclusao_nao_cobre',
  ) => {
    try {
      setProcessandoUid(f.uid)
      setErro('')
      const id = await iniciarSessao()
      const usuarioId = pb.authStore.record?.id as string | undefined
      const chave = chaveGuardaCg(f.extraido.nomeExtraido)
      const itemRecord = await pb
        .collection('cg_ingestao_itens')
        .getFirstListItem(`ingestao="${id}" && chave_normalizada="${chave}"`)
      await rejeitarItemIngestao({ itemRecordId: itemRecord.id, destino, usuarioId })
      setFila((prev) =>
        prev.map((x) =>
          x.uid === f.uid ? { ...x, status: 'rejeitado', destinoRejeicao: destino } : x,
        ),
      )
      setResumo((prev) => ({
        confirmados: prev?.confirmados ?? 0,
        rejeitados: (prev?.rejeitados ?? 0) + 1,
      }))
      onIngestaoConcluida()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setProcessandoUid(null)
    }
  }

  const pendentes = fila.filter((f) => f.status === 'pendente')
  const processados = fila.length - pendentes.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#16578B]" />
            Ingerir CG da seguradora
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Sistema sugere, analista confirma. Nada é gravado sem sua revisão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Etapa 1: upload e metadados */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">PDF da Condição Geral</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => handleSelecionarArquivo(e.target.files?.[0] ?? null)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                disabled={extraindo || !!fila.length}
              />
              {arquivo && (
                <p className="text-[11px] text-gray-500 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> {arquivo.name}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Seguradora</Label>
              <select
                value={seguradoraId}
                onChange={(e) => {
                  setSeguradoraId(e.target.value)
                  const s = seguradoras.find((x) => x.id === e.target.value)
                  setSeguradoraNome(s?.nome || '')
                }}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                disabled={extraindo || !!fila.length}
              >
                <option value="">Selecione…</option>
                {seguradoras.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Produto / versão da CG</Label>
              <Input
                value={produtoVersao}
                onChange={(e) => setProdutoVersao(e.target.value)}
                placeholder="ex.: AXA Empresarial 2024"
                className="text-xs"
                disabled={extraindo || !!fila.length}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Processo SUSEP (detectado)</Label>
              <Input
                value={processoSusep}
                onChange={(e) => setProcessoSusep(e.target.value)}
                placeholder="—"
                className="text-xs"
                disabled={extraindo || !!fila.length}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={montarSugestoes}
              disabled={!fila.length || extraindo || !seguradoraId || salvandoSessao}
              className="text-xs"
            >
              Gerar sugestões (motor C3)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFila([])}
              disabled={extraindo || !fila.length}
              className="text-xs"
            >
              Descartar leitura
            </Button>
          </div>

          {erro && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {extraindo && (
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Extraindo texto do PDF…
            </p>
          )}

          {/* Etapa 2: fila de revisão */}
          {fila.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">
                  Fila de revisão — {pendentes.length} pendente(s) / {fila.length} item(ns)
                </p>
                {resumo && (
                  <p className="text-[11px] text-gray-500">
                    {resumo.confirmados} confirmado(s), {resumo.rejeitados} rejeitado(s)
                  </p>
                )}
              </div>

              {fila.map((f) => (
                <div key={f.uid} className="border rounded p-3 space-y-2 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">
                        {f.extraido.nomeExtraido}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        pág. {f.extraido.pagina} · slotY {Math.round(f.extraido.slotY)} ·{' '}
                        {f.extraido.secaoOrigem}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${corConfianca(f.confianca)}`}
                    >
                      {formatoConfianca(f.confianca)}
                    </span>
                  </div>

                  {f.extraido.exclusoes.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase">
                        Exclusões extraídas ({f.extraido.exclusoes.length})
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {f.extraido.exclusoes.slice(0, 3).map((e, i) => (
                          <li key={i} className="text-[11px] text-gray-600 leading-snug">
                            • {e.texto}
                          </li>
                        ))}
                        {f.extraido.exclusoes.length > 3 && (
                          <li className="text-[10px] text-gray-400">
                            + {f.extraido.exclusoes.length - 3} exclusão(ões)…
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {f.status === 'pendente' && (
                    <div className="space-y-2">
                      <Label className="text-[11px]">CG canônica de destino</Label>
                      <select
                        value={f.canonicaIdSelecionada}
                        onChange={(e) => {
                          const v = e.target.value
                          setFila((prev) =>
                            prev.map((x) =>
                              x.uid === f.uid
                                ? {
                                    ...x,
                                    canonicaIdSelecionada: v,
                                    canonicaNomeSelecionada:
                                      canonicas.find((c) => c.id === v)?.nome || '',
                                  }
                                : x,
                            ),
                          )
                        }}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                      >
                        <option value="">
                          {f.confianca >= LIMIAR_CONFIANCA_CG
                            ? f.canonicaNomeSelecionada
                            : 'Sem sugestão firme — escolha manual'}
                        </option>
                        {canonicas
                          .filter((c) => c.id !== f.canonicaIdSelecionada)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                      </select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleConfirmar(f)}
                          disabled={!f.canonicaIdSelecionada || processandoUid === f.uid}
                          className="text-xs"
                        >
                          {processandoUid === f.uid ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejeitar(f, 'candidato_cg_nova')}
                          disabled={processandoUid === f.uid}
                          className="text-xs"
                        >
                          <Ban className="w-3 h-3" /> Candidato a CG nova
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejeitar(f, 'exclusao_nao_cobre')}
                          disabled={processandoUid === f.uid}
                          className="text-xs"
                        >
                          <X className="w-3 h-3" /> Exclusão "não cobre"
                        </Button>
                      </div>
                    </div>
                  )}

                  {f.status === 'confirmado' && (
                    <p className="text-[11px] text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Confirmado — sinônimo gravado
                      {f.sinonimoId ? ` (${f.sinonimoId})` : ''}
                    </p>
                  )}
                  {f.status === 'rejeitado' && (
                    <p className="text-[11px] text-gray-500 flex items-center gap-1">
                      <Ban className="w-3 h-3" /> Rejeitado —{' '}
                      {f.destinoRejeicao === 'candidato_cg_nova'
                        ? 'candidato a CG nova'
                        : 'exclusão "não cobre"'}
                    </p>
                  )}
                </div>
              ))}

              {processados === fila.length && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                  Todos os itens desta leitura foram revisados.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
