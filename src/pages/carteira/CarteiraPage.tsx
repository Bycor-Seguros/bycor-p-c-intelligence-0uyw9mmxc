import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import {
  Search,
  Filter,
  Download,
  FileSpreadsheet,
  Building,
  ArrowRight,
  ChevronDown,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate, formatCnpj, getStatusBadgeInfo } from '@/lib/formatters'
import {
  ApoliceMinima,
  buildMapaSucessao,
  getStatusDerivadoBadgeInfo,
  StatusDerivado,
} from '@/services/apoliceStatusService'

interface ApolicePortfolioItem {
  id: string
  id_apolice: string
  id_empreendimento?: string
  segurado_na_apolice: string
  cnpj_segurado: string
  seguradora: string
  numero_apolice: string
  ramo: string
  corretor: string
  data_inicio: string
  data_fim: string
  premio_liquido: number
  premio_total: number
  lmga: number
  valor_em_risco_dm: number
  razao_lmi_vr_dm: number
  status: string
  status_manual?: 'Perdida' | 'Em Emissão' | string | null
  expand?: {
    id_empreendimento?: {
      id?: string
      id_empreendimento?: string
      nome_empreendimento: string
      uf: string
      segmento: string
    }
  }
}

export default function CarteiraPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''

  const [apolices, setApolices] = useState<ApolicePortfolioItem[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState(initialQuery)
  const [filterSeguradora, setFilterSeguradora] = useState('todas')
  const [filterStatus, setFilterStatus] = useState('todos')
  const [filterSegmento, setFilterSegmento] = useState('todos')

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [sortField, setSortField] = useState<keyof ApolicePortfolioItem>('data_fim')
  const [sortAsc, setSortAsc] = useState(true)

  const fetchApolices = async () => {
    try {
      setLoading(true)
      const res = await pb.collection('apolices').getFullList<ApolicePortfolioItem>({
        sort: 'data_fim',
        expand: 'id_empreendimento',
      })
      setApolices(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApolices()
  }, [])

  // Unique lists for dropdowns
  const seguradorasList = useMemo(() => {
    const set = new Set<string>()
    apolices.forEach((a) => {
      if (a.seguradora) set.add(a.seguradora.trim())
    })
    return Array.from(set).sort()
  }, [apolices])

  // Mapa de status derivados e sucessão calculado sobre toda a carteira
  const mapaSucessao = useMemo(() => {
    return buildMapaSucessao(apolices as ApoliceMinima[])
  }, [apolices])

  // Contadores analíticos por status derivado
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      todos: apolices.length,
      ativa: 0,
      'a vencer': 0,
      vencida: 0,
      renovada: 0,
      perdida: 0,
      'em emissão': 0,
      prospect: 0,
    }
    apolices.forEach((ap) => {
      const rel = mapaSucessao.get(ap.id)
      const st = (rel?.statusDerivado || ap.status || '').toLowerCase().trim()
      if (st === 'em emissao') {
        counts['em emissão'] = (counts['em emissão'] || 0) + 1
      } else if (counts[st] !== undefined) {
        counts[st]++
      }
    })
    return counts
  }, [apolices, mapaSucessao])

  // Filtered list
  const filteredRows = useMemo(() => {
    return apolices.filter((item) => {
      // Text search
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = (item.expand?.id_empreendimento?.nome_empreendimento || '')
          .toLowerCase()
          .includes(q)
        const matchSegurado = (item.segurado_na_apolice || '').toLowerCase().includes(q)
        const matchCnpj = (item.cnpj_segurado || '').toLowerCase().includes(q)
        const matchNumero = (item.numero_apolice || '').toLowerCase().includes(q)
        const matchSeguradora = (item.seguradora || '').toLowerCase().includes(q)
        if (!matchName && !matchSegurado && !matchCnpj && !matchNumero && !matchSeguradora) {
          return false
        }
      }

      // Seguradora
      if (filterSeguradora !== 'todas' && item.seguradora !== filterSeguradora) {
        return false
      }

      // Status derivado da vigência + sucessão + status manual
      if (filterStatus !== 'todos') {
        const rel = mapaSucessao.get(item.id)
        const statusEfetivo = (rel?.statusDerivado || item.status || '').toLowerCase().trim()
        const target = filterStatus.toLowerCase().trim()
        if (target === 'em emissão' || target === 'em emissao') {
          if (statusEfetivo !== 'em emissão' && statusEfetivo !== 'em emissao') return false
        } else if (statusEfetivo !== target) {
          return false
        }
      }

      // Segmento
      if (filterSegmento !== 'todos') {
        const seg = item.expand?.id_empreendimento?.segmento || 'Hotéis & Resorts'
        if (seg !== filterSegmento) return false
      }

      return true
    })
  }, [apolices, search, filterSeguradora, filterStatus, filterSegmento, mapaSucessao])

  // Sorted list
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      let valA: any = a[sortField]
      let valB: any = b[sortField]

      if (valA === undefined || valA === null) valA = ''
      if (valB === undefined || valB === null) valB = ''

      if (typeof valA === 'string') {
        const res = valA.localeCompare(String(valB))
        return sortAsc ? res : -res
      }
      return sortAsc ? valA - valB : valB - valA
    })
  }, [filteredRows, sortField, sortAsc])

  // Paginated rows
  const totalPages = Math.ceil(sortedRows.length / pageSize) || 1
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedRows.slice(start, start + pageSize)
  }, [sortedRows, currentPage, pageSize])

  const handleSort = (field: keyof ApolicePortfolioItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  // Export CSV of filtered rows
  const handleExportCsv = () => {
    if (filteredRows.length === 0) return

    const headers = [
      'Segurado',
      'Empreendimento',
      'CNPJ',
      'Seguradora',
      'Ramo',
      'Numero_Apolice',
      'Vigencia_Inicio',
      'Vigencia_Fim',
      'LMI_LMG',
      'Premio_Liquido',
      'Premio_Total',
      'Status',
      'Corretor',
    ]

    const csvLines = [headers.join(';')]

    filteredRows.forEach((r) => {
      const rel = mapaSucessao.get(r.id)
      const statusEfetivo = rel?.statusDerivado || r.status || ''
      const line = [
        `"${r.segurado_na_apolice || ''}"`,
        `"${r.expand?.id_empreendimento?.nome_empreendimento || ''}"`,
        `"${r.cnpj_segurado || ''}"`,
        `"${r.seguradora || ''}"`,
        `"${r.ramo || ''}"`,
        `"${r.numero_apolice || ''}"`,
        `"${r.data_inicio || ''}"`,
        `"${r.data_fim || ''}"`,
        r.lmga || 0,
        r.premio_liquido || 0,
        r.premio_total || 0,
        `"${statusEfetivo}"`,
        `"${r.corretor || ''}"`,
      ]
      csvLines.push(line.join(';'))
    })
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `bycor_portfolio_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* Header and Toolbar */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">
            Portfólio de Apólices Vigentes & Históricas
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Gestão unificada da carteira de seguros corporativos com filtros analíticos e exportação
            em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            variant="outline"
            className="text-xs h-9 border-gray-300 hover:bg-gray-50 flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5 text-gray-600" />
            <span>Exportar CSV ({filteredRows.length})</span>
          </Button>
          <Button
            onClick={() => navigate('/c1-recebimento')}
            className="bg-[#0F2B46] hover:bg-[#1B3C5D] text-xs h-9 font-semibold text-white flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Importar Base Hotéis e Resorts</span>
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
            <Input
              type="text"
              placeholder="Buscar segurado, CNPJ, apólice..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 h-9 text-xs"
            />
          </div>

          {/* Seguradora Filter */}
          <select
            value={filterSeguradora}
            onChange={(e) => {
              setFilterSeguradora(e.target.value)
              setCurrentPage(1)
            }}
            className="h-9 text-xs rounded-md border border-gray-200 bg-white px-3 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
          >
            <option value="todas">Todas as Seguradoras</option>
            {seguradorasList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value)
              setCurrentPage(1)
            }}
            className="h-9 text-xs rounded-md border border-gray-200 bg-white px-3 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
          >
            <option value="todos">Todos os Status ({statusCounts.todos})</option>
            <option value="ativa">Ativa ({statusCounts.ativa})</option>
            <option value="a vencer">A Vencer ({statusCounts['a vencer']})</option>
            <option value="renovada">Renovada ({statusCounts.renovada})</option>
            <option value="vencida">Vencida ({statusCounts.vencida})</option>
            <option value="perdida">Perdida ({statusCounts.perdida})</option>
            <option value="em emissão">Em Emissão ({statusCounts['em emissão']})</option>
            <option value="prospect">Prospect ({statusCounts.prospect})</option>
          </select>

          {/* Segmento Filter */}
          <select
            value={filterSegmento}
            onChange={(e) => {
              setFilterSegmento(e.target.value)
              setCurrentPage(1)
            }}
            className="h-9 text-xs rounded-md border border-gray-200 bg-white px-3 focus:outline-none focus:ring-1 focus:ring-[#16578B]"
          >
            <option value="todos">Todos os Segmentos</option>
            <option value="Hotéis & Resorts">Hotéis & Resorts</option>
            <option value="Condomínios Comerciais">Condomínios Comerciais</option>
            <option value="Outros">Outros</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-gray-400">
            Carregando carteira de apólices...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Building className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-gray-800">Nenhuma apólice registrada</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              {apolices.length === 0
                ? 'Nenhum dado importado — use o importador para carregar a Base Hotéis e Resorts (.xlsx).'
                : 'Nenhum resultado corresponde aos filtros aplicados.'}
            </p>
            {apolices.length === 0 && (
              <Link to="/c1-recebimento">
                <Button className="mt-4 bg-[#0F2B46] text-xs h-9">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Ir para Importador Base Hotéis e Resorts
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50/75 text-gray-600 font-semibold border-b border-[#E4E9F0]">
                  <tr>
                    <th
                      onClick={() => handleSort('segurado_na_apolice')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100"
                    >
                      Segurado / Empreendimento
                    </th>
                    <th
                      onClick={() => handleSort('seguradora')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100"
                    >
                      Seguradora
                    </th>
                    <th className="py-3 px-4">Ramo</th>
                    <th className="py-3 px-4">Nº Apólice</th>
                    <th
                      onClick={() => handleSort('data_fim')}
                      className="py-3 px-4 cursor-pointer hover:bg-gray-100"
                    >
                      Vigência
                    </th>
                    <th className="py-3 px-4 text-right">LMI / LMG</th>
                    <th className="py-3 px-4 text-right">Prêmio Líquido</th>
                    <th
                      onClick={() => handleSort('premio_total')}
                      className="py-3 px-4 text-right cursor-pointer hover:bg-gray-100"
                    >
                      Prêmio Total
                    </th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Corretor</th>
                    <th className="py-3 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedRows.map((row) => {
                    const rel = mapaSucessao.get(row.id)
                    const statusEfetivo = rel?.statusDerivado || row.status
                    const badge = getStatusDerivadoBadgeInfo(statusEfetivo)
                    const nomeEmp =
                      row.expand?.id_empreendimento?.nome_empreendimento || row.segurado_na_apolice

                    return (
                      <tr
                        key={row.id}
                        onClick={() => navigate(`/carteira/apolice/${row.id}`)}
                        className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-gray-900">
                          <div>{nomeEmp}</div>
                          {row.cnpj_segurado && (
                            <div className="text-[10px] text-gray-400 font-normal">
                              {formatCnpj(row.cnpj_segurado)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-700 font-medium">
                          {row.seguradora || '—'}
                        </td>
                        <td
                          className="py-3 px-4 text-gray-600 max-w-[140px] truncate"
                          title={row.ramo}
                        >
                          {row.ramo || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-600">
                          {row.numero_apolice || row.id_apolice}
                        </td>
                        <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                          {formatDate(row.data_inicio)} → {formatDate(row.data_fim)}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-gray-700 tabular-nums">
                          {formatCurrency(row.lmga)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700 tabular-nums">
                          {formatCurrency(row.premio_liquido)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">
                          {formatCurrency(row.premio_total)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badge.bg}`}
                          >
                            {badge.label.toUpperCase()}
                          </span>
                          {rel?.sucessora && (
                            <div className="text-[10px] text-[#16578B] mt-0.5 font-medium whitespace-nowrap">
                              ↳ Sucedida
                            </div>
                          )}
                          {rel?.antecessora && (
                            <div className="text-[10px] text-gray-500 mt-0.5 font-medium whitespace-nowrap">
                              ↳ Renova
                            </div>
                          )}
                        </td>
                        <td
                          className="py-3 px-4 text-gray-500 max-w-[120px] truncate"
                          title={row.corretor}
                        >
                          {row.corretor || 'Bycor Seguros'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/carteira/apolice/${row.id}`)
                            }}
                            className="h-7 text-xs text-[#16578B] hover:text-[#0E4268]"
                          >
                            <span>Ficha</span>
                            <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="p-4 border-t border-[#E4E9F0] flex items-center justify-between text-xs text-gray-500">
              <div>
                Mostrando {(currentPage - 1) * pageSize + 1} a{' '}
                {Math.min(currentPage * pageSize, sortedRows.length)} de {sortedRows.length}{' '}
                apólices
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="h-8 text-xs"
                >
                  Anterior
                </Button>
                <span className="px-2 font-medium text-gray-700">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 text-xs"
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
