/**
 * ModalPortalDuploC1.tsx
 *
 * Portal Duplo de Entrada da C1 (Recebimento):
 * 1. Escolha explícita entre "Conta Nova" e "Renovação" registrada no processo (tipo_porta).
 * 2. Porta Renovação:
 *    - Ponto de partida: UPLOAD do Cartão de Risco do ano anterior (PDF/XLSX arquivado na corretora).
 *      O upload não bloqueia: o analista pode subir agora ou prosseguir depois.
 *    - Quando não houver cartão: apólice antecessora atua como fallback ("derivado da apólice"),
 *      com indicação clara da fonte usada.
 *    - Sem apólice nem cartão: oferece fallback direto para "Conta Nova".
 * 3. Badge clicável "Oportunidades Registradas":
 *    - Lê exclusivamente de `notas_base` com marca `[Oportunidade Detectada]`.
 *    - Mostra tipo, justificativa e data de cada item registrado da conta.
 *    - Modo somente leitura: nada grava automaticamente.
 * 4. Ao confirmar, cria/registra o processo em `documentos` e/ou `rfq` com `tipo_porta`.
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import {
  Building2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  Info,
  CheckCircle2,
  UploadCloud,
  ChevronRight,
  HelpCircle,
  ExternalLink,
  Layers,
  Calendar,
  X,
  BadgeAlert,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TipoPortaEntrada,
  ContextoRenovacaoConta,
  OportunidadeRegistradaNota,
  carregarContextoRenovacaoConta,
} from '@/services/portalC1Service'
import { formatCurrency, formatDate } from '@/lib/formatters'

interface ContaOption {
  id: string
  nome_empreendimento: string
  razao_social?: string
  cnpj?: string
}

interface ModalPortalDuploC1Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectContaNova: () => void
  onSelectRenovacaoComCartao: (file: File, contaId: string) => void
  onProcessoIniciado?: (tipoPorta: TipoPortaEntrada, contaId?: string) => void
}

export function ModalPortalDuploC1({
  open,
  onOpenChange,
  onSelectContaNova,
  onSelectRenovacaoComCartao,
  onProcessoIniciado,
}: ModalPortalDuploC1Props) {
  const navigate = useNavigate()

  // Passo interno: 'escolha' | 'renovacao_config'
  const [etapa, setEtapa] = useState<'escolha' | 'renovacao_config'>('escolha')

  // Lista de contas disponíveis para renovação
  const [contas, setContas] = useState<ContaOption[]>([])
  const [loadingContas, setLoadingContas] = useState(false)
  const [selectedContaId, setSelectedContaId] = useState<string>('')

  // Ramo selecionado na conta (para contas multi-ramo)
  const [selectedRamo, setSelectedRamo] = useState<string>('')

  // Contexto da conta de renovação
  const [contexto, setContexto] = useState<ContextoRenovacaoConta | null>(null)
  const [loadingContexto, setLoadingContexto] = useState(false)

  // Upload do Cartão de Risco do ano anterior
  const [cartaoAnteriorFile, setCartaoAnteriorFile] = useState<File | null>(null)
  const [uploadCartaoNaoBloqueante, setUploadCartaoNaoBloqueante] = useState(false)

  // Modal secundário do Badge Oportunidades Registradas
  const [modalOportunidadesOpen, setModalOportunidadesOpen] = useState(false)

  // Submissão do início do processo
  const [iniciandoProcesso, setIniciandoProcesso] = useState(false)

  // Reseta ao fechar/abrir
  useEffect(() => {
    if (open) {
      setEtapa('escolha')
      setSelectedContaId('')
      setSelectedRamo('')
      setContexto(null)
      setCartaoAnteriorFile(null)
      setUploadCartaoNaoBloqueante(false)
      carregarContas()
    }
  }, [open])

  const carregarContas = async () => {
    try {
      setLoadingContas(true)
      const list = await pb.collection('empreendimentos').getFullList<ContaOption>({
        fields: 'id,nome_empreendimento,razao_social,cnpj',
        sort: 'nome_empreendimento',
      })
      setContas(list)
    } catch (err) {
      console.warn('Erro ao carregar lista de contas:', err)
    } finally {
      setLoadingContas(false)
    }
  }

  // Quando o analista escolhe a conta no passo de Renovação
  useEffect(() => {
    if (selectedContaId) {
      carregarContexto(selectedContaId, selectedRamo || null)
    } else {
      setContexto(null)
    }
  }, [selectedContaId, selectedRamo])

  const carregarContexto = async (contaId: string, ramo: string | null) => {
    try {
      setLoadingContexto(true)
      const ctx = await carregarContextoRenovacaoConta(contaId, ramo)
      setContexto(ctx)
      if (ctx?.apoliceAntecessora && !selectedRamo) {
        setSelectedRamo(ctx.apoliceAntecessora.ramo)
      }
    } catch (err) {
      console.warn('Erro ao carregar contexto de renovação:', err)
    } finally {
      setLoadingContexto(false)
    }
  }

  // Ação 1: Escolheu Conta Nova
  const handleEscolherContaNova = async () => {
    try {
      setIniciandoProcesso(true)
      // Registra documento marco ou avisa o ciclo
      onSelectContaNova()
      onProcessoIniciado?.('conta_nova')
      onOpenChange(false)
    } finally {
      setIniciandoProcesso(false)
    }
  }

  // Ação 2: Avançar para tela de configuração de Renovação
  const handleAvancarRenovacao = () => {
    setEtapa('renovacao_config')
  }

  // Ação 3: Confirmar Renovação
  const handleConfirmarRenovacao = async () => {
    if (!selectedContaId) return
    try {
      setIniciandoProcesso(true)

      // Se o analista subiu o arquivo do cartão de risco anterior, delegar para o leitor
      if (cartaoAnteriorFile) {
        onSelectRenovacaoComCartao(cartaoAnteriorFile, selectedContaId)
      }

      // Registra processo na coleção documentos como marco C1 com tipo_porta: 'renovacao'
      try {
        const formData = new FormData()
        formData.append('tipo', 'Cartão de Risco')
        formData.append(
          'versao',
          cartaoAnteriorFile ? cartaoAnteriorFile.name : 'Renovação (Ano Anterior)',
        )
        formData.append('data', new Date().toISOString().slice(0, 10))
        formData.append('vinculado_empreendimento', selectedContaId)
        if (contexto?.apoliceAntecessora?.id) {
          formData.append('vinculado_apolice', contexto.apoliceAntecessora.id)
        }
        formData.append('tipo_porta', 'renovacao')
        if (cartaoAnteriorFile) {
          formData.append('arquivo', cartaoAnteriorFile)
        }
        await pb.collection('documentos').create(formData)
      } catch (docErr) {
        console.warn('Aviso ao registrar marco de documento tipo_porta:', docErr)
      }

      onProcessoIniciado?.('renovacao', selectedContaId)
      onOpenChange(false)
    } catch (err) {
      console.error('Erro ao iniciar processo de renovação:', err)
    } finally {
      setIniciandoProcesso(false)
    }
  }

  // Oportunidades registradas para a conta selecionada
  const oportunidades = contexto?.oportunidadesRegistradas || []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto animate-scale-in">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-[#16578B]">
                Portal Duplo C1
              </span>
              <DialogTitle className="text-lg font-bold text-gray-900">
                Iniciar Novo Processo de Cotação
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-gray-500">
              Escolha explicitamente a porta de entrada deste ciclo. O método selecionado fica
              registrado em rastreabilidade técnica e no processo.
            </DialogDescription>
          </DialogHeader>

          {/* ========================================================
              ETAPA 1: ESCOLHA EXPLÍCITA ENTRE CONTA NOVA E RENOVAÇÃO
              ======================================================== */}
          {etapa === 'escolha' && (
            <div className="py-2 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* CARD 1: CONTA NOVA */}
                <button
                  type="button"
                  onClick={handleEscolherContaNova}
                  className="group relative text-left p-5 rounded-xl border-2 border-slate-200 hover:border-[#16578B] bg-white hover:bg-blue-50/40 transition-all shadow-xs flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#16578B] group-hover:bg-[#16578B] group-hover:text-white transition-colors flex items-center justify-center">
                      <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-gray-900 group-hover:text-[#16578B] transition-colors">
                          Conta Nova
                        </h4>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Prospecção
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        Recebimento e ingestão de novo cliente ou empreendimento. Inicia com o
                        preenchimento do Cartão de Risco ou importação de dados brutos.
                      </p>
                    </div>

                    <div className="space-y-1 pt-1 text-[11px] text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Sem apólice antecessora no sistema</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Cadastro direto e criação do Kit de Cotação</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-[#16578B]">
                    <span>Iniciar como Conta Nova</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>

                {/* CARD 2: RENOVAÇÃO */}
                <button
                  type="button"
                  onClick={handleAvancarRenovacao}
                  className="group relative text-left p-5 rounded-xl border-2 border-slate-200 hover:border-[#0F2B46] bg-white hover:bg-slate-50 transition-all shadow-xs flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="w-11 h-11 rounded-xl bg-slate-100 text-[#0F2B46] group-hover:bg-[#0F2B46] group-hover:text-white transition-colors flex items-center justify-center">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-gray-900 group-hover:text-[#0F2B46] transition-colors">
                          Renovação
                        </h4>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 text-[#16578B]">
                          Carteira
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        Parte do <strong>Cartão de Risco do ano anterior</strong> (upload do PDF
                        arquivado na corretora). Na ausência do cartão, usa a apólice antecessora
                        como fallback derivado.
                      </p>
                    </div>

                    <div className="space-y-1 pt-1 text-[11px] text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Qualitativo preservado para evitar declínio no Bid</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Sucessão técnica e identificação de apólice</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-[#0F2B46]">
                    <span>Configurar Renovação</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>

              {/* Box explicativo dos critérios Bycor */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-gray-600 leading-relaxed flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#16578B] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-gray-900">Critério técnico Bycor:</strong> A porta
                  Renovação sempre parte preferencialmente do Cartão de Risco do ano anterior
                  (evitando que seguradoras declinem cotações por falta de detalhes qualitativos).
                  Quando não houver cartão salvo na base, o sistema utiliza a apólice antecessora
                  como fallback imediato.
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              ETAPA 2: CONFIGURAÇÃO DA PORTA DE RENOVAÇÃO
              ======================================================== */}
          {etapa === 'renovacao_config' && (
            <div className="py-2 space-y-4">
              {/* Seletor de Conta */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-gray-700">
                    Selecione a Conta / Empreendimento em Renovação:
                  </Label>
                  <button
                    type="button"
                    onClick={() => setEtapa('escolha')}
                    className="text-[11px] text-[#16578B] hover:underline"
                  >
                    ← Voltar à seleção de porta
                  </button>
                </div>

                <Select value={selectedContaId} onValueChange={setSelectedContaId}>
                  <SelectTrigger className="text-xs h-10 bg-white">
                    <SelectValue
                      placeholder={loadingContas ? 'Carregando contas...' : 'Escolha a conta...'}
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {contas.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.nome_empreendimento} {c.cnpj ? `— CNPJ: ${c.cnpj}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* LOADING DO CONTEXTO */}
              {loadingContexto && (
                <div className="p-6 text-center text-gray-500 bg-gray-50 rounded-xl border border-gray-200">
                  <p className="text-xs font-semibold">
                    Identificando histórico e apólice antecessora...
                  </p>
                </div>
              )}

              {/* DETALHES DA CONTA SELECIONADA */}
              {selectedContaId && !loadingContexto && contexto && (
                <div className="space-y-3.5">
                  {/* HEADER DA CONTA + BADGE DE OPORTUNIDADES REGISTRADAS */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-gray-900">
                        {contexto.empreendimento.nome}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        CNPJ: {contexto.empreendimento.cnpj || 'Não informado'} |{' '}
                        {contexto.todasApolicesConta.length} apólice(s) no histórico
                      </div>
                    </div>

                    {/* BADGE CLICÁVEL: Oportunidades Registradas (somente leitura) */}
                    <div>
                      {oportunidades.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setModalOportunidadesOpen(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors border border-amber-300 shadow-2xs"
                        >
                          <BadgeAlert className="w-3.5 h-3.5 text-amber-700" />
                          <span>{oportunidades.length} Oportunidade(s) Registrada(s)</span>
                          <ExternalLink className="w-3 h-3 text-amber-700" />
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                          <CheckCircle2 className="w-3 h-3 text-gray-400" />
                          <span>Sem oportunidades registradas</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* SELETOR DE RAMO SE HOUVER MAIS DE UM */}
                  {contexto.ramosDisponiveis.length > 1 && (
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-gray-700">
                        Ramo do produto a renovar:
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {contexto.ramosDisponiveis.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setSelectedRamo(r)}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                              selectedRamo === r
                                ? 'bg-[#0F2B46] text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PONTO DE PARTIDA PRINCIPAL: UPLOAD DO CARTÃO DE RISCO DO ANO ANTERIOR */}
                  <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-[#16578B]" />
                        <h5 className="text-xs font-bold text-gray-900">
                          Ponto de Partida: Cartão de Risco do Ano Anterior
                        </h5>
                      </div>
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-blue-100 text-[#16578B]">
                        Qualitativo Bycor
                      </span>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed">
                      Faça o upload do <strong>Cartão de Risco arquivado</strong> (PDF ou XLSX da
                      última contratação). O qualitativo detalhado (proteções, construção e
                      histórico) evita que seguradoras declinem no Bid por ausência de dados.
                    </p>

                    {/* DROPZONE / SELEÇÃO DO CARTÃO ANTERIOR */}
                    <div className="space-y-2">
                      <label className="flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-blue-300 rounded-lg bg-white hover:bg-blue-50/50 cursor-pointer transition-colors text-center">
                        <UploadCloud className="w-6 h-6 text-[#16578B] mb-1" />
                        <span className="text-xs font-semibold text-gray-800">
                          {cartaoAnteriorFile
                            ? cartaoAnteriorFile.name
                            : 'Selecionar PDF ou XLSX do Cartão de Risco anterior'}
                        </span>
                        <span className="text-[11px] text-gray-500 mt-0.5">
                          {cartaoAnteriorFile
                            ? `${(cartaoAnteriorFile.size / 1024).toFixed(1)} KB — pronto para extração`
                            : 'Upload não-bloqueante: você pode prosseguir mesmo sem subir agora'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setCartaoAnteriorFile(e.target.files[0])
                            }
                          }}
                        />
                      </label>

                      {cartaoAnteriorFile && (
                        <div className="flex items-center justify-between text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                          <span className="font-semibold flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Fonte qualitativa: Cartão de Risco anexado
                          </span>
                          <button
                            type="button"
                            onClick={() => setCartaoAnteriorFile(null)}
                            className="text-gray-500 hover:text-red-600 font-bold"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CASO 1: TEM APÓLICE ANTECESSORA VÁLIDA (FALLBACK OU COMPLEMENTO) */}
                  {contexto.apoliceAntecessora ? (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-slate-700" />
                          <span className="text-xs font-bold text-gray-900">
                            Apólice Antecessora Identificada
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {cartaoAnteriorFile
                            ? 'Referência Financeira Sucessora'
                            : 'Fonte ativa: Derivado da Apólice'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] pt-1">
                        <div>
                          <span className="text-gray-500">Nº Apólice:</span>
                          <div className="font-semibold text-gray-900">
                            {contexto.apoliceAntecessora.numeroApolice}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">Seguradora:</span>
                          <div className="font-semibold text-gray-900">
                            {contexto.apoliceAntecessora.seguradora}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">Ramo:</span>
                          <div className="font-semibold text-gray-900">
                            {contexto.apoliceAntecessora.ramo}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">Vigência:</span>
                          <div className="font-semibold text-gray-900">
                            {formatDate(contexto.apoliceAntecessora.dataFim)}
                          </div>
                        </div>
                      </div>

                      {/* Valores referenciais da antecessora */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-[11px]">
                        <div>
                          <span className="text-gray-500">VRD Material Atual:</span>{' '}
                          <strong className="text-gray-800">
                            {contexto.apoliceAntecessora.vrdDm
                              ? formatCurrency(contexto.apoliceAntecessora.vrdDm)
                              : 'Não informado'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-gray-500">LMI Básica Incêndio:</span>{' '}
                          <strong className="text-gray-800">
                            {contexto.apoliceAntecessora.lmiBasica
                              ? formatCurrency(contexto.apoliceAntecessora.lmiBasica)
                              : 'Não informado'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* CASO 2: SEM APÓLICE ANTECESSORA NEM CARTÃO NO SISTEMA */
                    <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <h5 className="text-xs font-bold text-amber-900">
                            Nenhuma apólice antecessora encontrada para esta conta
                          </h5>
                          <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                            Não encontramos registros de apólices anteriores vinculadas a este
                            empreendimento. Para evitar inconsistências no encadeamento de
                            renovação, recomendamos iniciar o processo pela porta de{' '}
                            <strong>Conta Nova</strong>.
                          </p>
                        </div>
                      </div>

                      <div className="pt-1 flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={handleEscolherContaNova}
                          className="bg-amber-800 hover:bg-amber-900 text-white text-xs h-8 px-3"
                        >
                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                          <span>Prosseguir como Conta Nova (Fallback)</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* BOTÕES DE AÇÃO */}
              <div className="pt-4 border-t border-gray-200 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEtapa('escolha')}
                  className="text-xs h-9"
                >
                  Voltar
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    className="text-xs h-9"
                  >
                    Cancelar
                  </Button>

                  <Button
                    type="button"
                    disabled={!selectedContaId || iniciandoProcesso}
                    onClick={handleConfirmarRenovacao}
                    className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-white text-xs font-semibold h-9 px-4 shadow-sm"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    <span>Iniciar Renovação (Registrar tipo_porta)</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ========================================================
          MODAL SECUNDÁRIO: OPORTUNIDADES REGISTRADAS DA CONTA
          Somente leitura — lê exclusivamente de notas_base [Oportunidade Detectada]
          ======================================================== */}
      <Dialog open={modalOportunidadesOpen} onOpenChange={setModalOportunidadesOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto animate-scale-in">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <BadgeAlert className="w-5 h-5 text-amber-600" />
              <DialogTitle className="text-base font-bold text-gray-900">
                Oportunidades Registradas — {contexto?.empreendimento.nome}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-gray-500">
              Itens registrados na auditoria comercial da carteira gravados na base de notas.
              Exibição somente leitura.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            {oportunidades.length === 0 ? (
              <div className="p-6 text-center text-gray-500 bg-gray-50 rounded-xl">
                Nenhuma oportunidade registrada para esta conta.
              </div>
            ) : (
              oportunidades.map((op) => (
                <div
                  key={op.id}
                  className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-200 text-amber-900">
                        {op.tipoRotulo || op.tipo}
                      </span>
                      <h5 className="font-bold text-gray-900 mt-1">{op.item || op.titulo}</h5>
                    </div>
                    <span className="text-[11px] text-gray-500 shrink-0 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {op.registradoEm}
                    </span>
                  </div>

                  <div className="text-gray-700 leading-relaxed bg-white/70 p-2.5 rounded-lg border border-amber-100">
                    <span className="font-semibold text-gray-800">Justificativa:</span>{' '}
                    {op.justificativa}
                  </div>

                  {op.acaoRecomendada && (
                    <div className="text-[11px] text-gray-600">
                      <strong>Ação Recomendada:</strong> {op.acaoRecomendada}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1 border-t border-amber-200/60">
                    <span>Seguradora: {op.seguradora}</span>
                    <span>Impacto: {op.impacto}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setModalOportunidadesOpen(false)}
              className="text-xs h-8"
            >
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
