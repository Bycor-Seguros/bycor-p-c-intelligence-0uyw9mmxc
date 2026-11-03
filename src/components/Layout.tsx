import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import pb from '@/lib/pocketbase/client'
import {
  Shield,
  Home,
  Briefcase,
  FileCheck,
  Send,
  GitCompare,
  FileText,
  ClipboardCheck,
  CheckCircle,
  Building2,
  FileSpreadsheet,
  BookOpen,
  Bot,
  Sparkles,
  Search,
  Bell,
  LogOut,
  User,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getDaysRemaining } from '@/lib/formatters'
import { ApoliceMinima, buildMapaSucessao } from '@/services/apoliceStatusService'

interface NavGroup {
  title?: string
  items: {
    label: string
    path: string
    icon: React.ElementType
    badge?: number
  }[]
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [alertCount, setAlertCount] = useState<number>(0)

  // Fetch count of renewals for the notification badge
  useEffect(() => {
    let active = true
    const fetchRenewalsCount = async () => {
      try {
        const records = await pb.collection('apolices').getFullList<ApoliceMinima>({
          fields:
            'id,id_apolice,numero_apolice,id_empreendimento,segurado_na_apolice,cnpj_segurado,ramo,data_inicio,data_fim,status,status_manual',
        })
        if (!active) return
        const mapa = buildMapaSucessao(records)
        let urgent = 0
        records.forEach((ap) => {
          const rel = mapa.get(ap.id)
          const statusEfetivo = (rel?.statusDerivado || ap.status || '').toUpperCase().trim()
          const rawStatus = (ap.status || '').toLowerCase().trim()
          const days = getDaysRemaining(ap.data_fim)

          // Apólices já renovadas (statusDerivado RENOVADA, status renovada, ou com sucessora/renovada_em) não geram alerta
          if (
            statusEfetivo === 'RENOVADA' ||
            rawStatus === 'renovada' ||
            Boolean(rel?.sucessora) ||
            Boolean(ap.apolice_sucessora) ||
            Boolean(ap.renovada_em) ||
            statusEfetivo === 'PERDIDA'
          ) {
            return
          }
          if (statusEfetivo === 'VENCIDA' || statusEfetivo === 'EM EMISSÃO') {
            urgent++
          } else if (days !== null && days <= 60 && days >= 0) {
            urgent++
          }
        })
        setAlertCount(urgent)
      } catch {
        // ignore
      }
    }
    fetchRenewalsCount()

    // Subscribe to realtime changes on apolices
    pb.collection('apolices')
      .subscribe('*', () => {
        fetchRenewalsCount()
      })
      .catch(() => {})

    return () => {
      active = false
      pb.collection('apolices')
        .unsubscribe('*')
        .catch(() => {})
    }
  }, [])

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!globalSearch.trim()) return
    navigate(`/carteira?q=${encodeURIComponent(globalSearch.trim())}`)
  }

  const navGroups: NavGroup[] = [
    {
      items: [{ label: 'Início (Renovações)', path: '/', icon: Home }],
    },
    {
      title: 'CARTEIRA',
      items: [{ label: 'Portfólio Atual', path: '/carteira', icon: Briefcase }],
    },
    {
      title: 'CICLO DE COTAÇÃO',
      items: [
        { label: 'C1 Recebimento', path: '/c1-recebimento', icon: FileSpreadsheet },
        { label: 'C2 RFQ Cotações', path: '/c2-rfq', icon: Send },
        { label: 'C3 Tabulação', path: '/c3-tabulacao', icon: GitCompare },
        { label: 'C4 Apresentação', path: '/c4-apresentacao', icon: FileText },
        { label: 'C5 Auditoria', path: '/c5-auditoria', icon: ClipboardCheck },
        { label: 'Auditoria Cartão × Apólice', path: '/auditoria-cartao-apolice', icon: FileCheck },
        { label: 'C6 Aprovação', path: '/c6-aprovacao', icon: CheckCircle },
      ],
    },
    {
      title: 'GESTÃO COMERCIAL',
      items: [
        { label: 'Mapa de Mercado', path: '/mercado', icon: Building2 },
        { label: 'Versão Contratação', path: '/versao-contratacao', icon: FileCheck },
        { label: 'Playbook Prospecção', path: '/playbook', icon: BookOpen },
      ],
    },
    {
      title: 'INTELIGÊNCIA',
      items: [
        { label: 'Oportunidades Carteira', path: '/', icon: Sparkles },
        { label: 'Chat IA (Fase 0)', path: '/chat', icon: Bot },
      ],
    },
  ]

  const getModuleTitle = () => {
    const p = location.pathname
    if (p === '/') return 'Dashboard de Renovações'
    if (p.startsWith('/carteira/apolice')) return 'Ficha da Apólice'
    if (p.startsWith('/carteira')) return 'Portfólio de Apólices'
    if (p.startsWith('/c1-recebimento')) return 'C1 · Recebimento de Documentos & Importação'
    if (p.startsWith('/c2-rfq')) return 'C2 · Pedidos de Cotação (RFQ)'
    if (p.startsWith('/c3-tabulacao')) return 'C3 · Tabulação e Comparação de Propostas'
    if (p.startsWith('/c4-apresentacao')) return 'C4 · Apresentação Comercial'
    if (p.startsWith('/c5-auditoria')) return 'C5 · Auditoria Técnica de Apólices'
    if (p.startsWith('/auditoria-cartao-apolice'))
      return 'Auditoria Cartão × Apólice (Relatório Comparativo)'
    if (p.startsWith('/c6-aprovacao')) return 'C6 · Fila de Aprovação Humana'
    if (p.startsWith('/mercado')) return 'Mapa de Mercado & Seguradoras'
    if (p.startsWith('/versao-contratacao')) return 'Versão Padrão de Contratação'
    if (p.startsWith('/playbook')) return 'Playbook de Prospecção'
    if (p.startsWith('/chat')) return 'Assistente IA Bycor (Fase 0)'
    return 'Bycor P&C Intelligence'
  }

  const renderNavContent = () => (
    <div className="flex flex-col h-full text-white">
      {/* Brand Header */}
      <div className="p-5 border-b border-white/10 flex items-center justify-between">
        <NavLink to="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#16578B] to-blue-400 flex items-center justify-center shadow-md">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-extrabold tracking-tight text-white flex items-center gap-1">
              BYCOR <span className="text-blue-300 font-normal text-xs">P&C</span>
            </div>
            <div className="text-[10px] text-gray-300 tracking-wider uppercase font-semibold">
              Hotéis & Resorts
            </div>
          </div>
        </NavLink>
        {mobileMenuOpen && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-1 rounded text-gray-300 hover:text-white lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {navGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            {group.title && (
              <div className="px-3 pb-1 text-[10px] font-bold tracking-wider text-gray-300 uppercase">
                {group.title}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive: active }) =>
                      `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group relative ${
                        active
                          ? 'bg-[#16578B] text-white shadow-sm font-semibold'
                          : 'text-gray-200 hover:bg-[#1B3C5D] hover:text-white'
                      }`
                    }
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-200' : 'text-gray-300 group-hover:text-white'}`}
                      />
                      <span>{item.label}</span>
                    </div>
                    {item.path === '/' && alertCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                        {alertCount}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* User profile footer */}
      <div className="p-3 border-t border-white/10 bg-[#0B1D31]/80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#16578B] flex items-center justify-center text-xs font-bold text-white uppercase shrink-0 border border-blue-300/30">
              {user?.name ? user.name.slice(0, 2) : user?.email?.slice(0, 2) || 'BY'}
            </div>
            <div className="truncate text-left">
              <div className="text-xs font-semibold text-white truncate">
                {user?.name || 'Usuário Bycor'}
              </div>
              <div className="text-[10px] text-blue-200 truncate capitalize">
                {user?.role || 'analista'}
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            title="Sair do sistema"
            aria-label="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex bg-[#F5F7FA]">
      {/* Desktop Fixed Sidebar (248px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[248px] lg:fixed lg:inset-y-0 bg-[#0F2B46] border-r border-[#0B1D31] z-30 shadow-lg print:hidden">
        {renderNavContent()}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm transition-opacity print:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer (248px) */}
      <div
        className={`fixed inset-y-0 left-0 w-[248px] bg-[#0F2B46] z-50 transform lg:hidden transition-transform duration-200 ease-in-out shadow-2xl print:hidden ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderNavContent()}
      </div>

      {/* Main Layout Area */}
      <div className="flex-1 lg:pl-[248px] flex flex-col min-w-0 print:pl-0">
        {/* Topbar (60px) */}
        <header className="h-[60px] bg-white border-b border-[#E4E9F0] sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between shadow-sm print:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -ml-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 lg:hidden"
              aria-label="Abrir menu lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight truncate">
              {getModuleTitle()}
            </h1>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Global Search */}
            <form onSubmit={handleGlobalSearch} className="relative hidden md:block w-64 lg:w-80">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
              <Input
                type="text"
                placeholder="Buscar apólice, segurado, CNPJ..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-gray-50 border-gray-200 focus:bg-white rounded-lg focus:border-[#16578B]"
              />
            </form>

            {/* Notification Bell */}
            <NavLink
              to="/"
              className="relative p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              title="Alertas de renovação"
            >
              <Bell className="w-5 h-5" />
              {alertCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </NavLink>

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 p-1 rounded-full hover:bg-gray-100 transition-colors focus:outline-none">
                  <div className="w-8 h-8 rounded-full bg-[#0F2B46] text-white flex items-center justify-center text-xs font-bold uppercase shadow-sm">
                    {user?.name ? user.name.slice(0, 2) : user?.email?.slice(0, 2) || 'AD'}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500 hidden sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 text-xs">
                <DropdownMenuLabel className="font-normal">
                  <div className="font-semibold text-gray-900">{user?.name || 'Usuário Bycor'}</div>
                  <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
                  <div className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-blue-50 text-[#16578B]">
                    Perfil: {user?.role || 'analista'}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/carteira')}>
                  <Briefcase className="w-3.5 h-3.5 mr-2" />
                  Minha Carteira
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/c1-recebimento')}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-2" />
                  Importador Base Hotéis e Resorts
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600">
                  <LogOut className="w-3.5 h-3.5 mr-2" />
                  Sair da sessão
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto animate-fade-in-up print:p-0 print:m-0 print:max-w-none print:w-full">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="h-10 bg-[#0F2B46] text-gray-300 text-[11px] px-6 flex items-center justify-between border-t border-[#0B1D31] print:hidden">
          <span>BYCOR Seguros — Sistema Interno P&C · MVP Fase 0</span>
          <span className="hidden sm:inline text-gray-400">
            São Paulo · Contas Médias & Segmento Hotéis & Resorts
          </span>
        </footer>
      </div>
    </div>
  )
}
