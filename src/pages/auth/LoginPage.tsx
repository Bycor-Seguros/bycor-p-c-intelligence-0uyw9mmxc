import React, { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Shield, Lock, Mail, AlertCircle, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('E-mail obrigatório.')
      return
    }
    if (!password) {
      setError('Senha obrigatória.')
      return
    }

    try {
      setLoading(true)
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      console.error('Login error:', err)
      setError('Credenciais inválidas. Verifique seu e-mail e senha.')
    } finally {
      setLoading(false)
    }
  }

  const fillQuickLogin = (quickEmail: string) => {
    setEmail(quickEmail)
    setPassword('Skip@Pass')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0F2B46] via-[#0B1D31] to-[#081524] p-4 relative overflow-hidden">
      {/* Radial glow */}
      <div className="absolute top-0 right-0 w-[550px] h-[550px] bg-[#16578B]/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#0D9488]/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md z-10 animate-fade-in-up">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#16578B] to-[#0F2B46] border border-blue-400/30 shadow-xl mb-4 text-white">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            BYCOR <span className="text-blue-400 font-light">P&C Intelligence</span>
          </h1>
          <p className="text-sm text-gray-300 mt-1">Sistema de Operações e Gestão de Seguros P&C</p>
          <div className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wider uppercase bg-blue-500/15 text-blue-300 border border-blue-400/20">
            São Paulo · Hotéis & Resorts
          </div>
        </div>

        {/* Card Form */}
        <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Acesse sua conta</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Informe suas credenciais corporativas para entrar
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">E-mail corporativo</Label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-3 pointer-events-none" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.nome@bycor.com.br"
                  className="pl-9 text-sm h-10 border-gray-300 focus:border-[#16578B] focus:ring-[#16578B]"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-gray-700">Senha de acesso</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-[#16578B] hover:text-[#0E4268] hover:underline font-medium"
                >
                  Esqueci minha senha
                </Link>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-3 pointer-events-none" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 text-sm h-10 border-gray-300 focus:border-[#16578B] focus:ring-[#16578B]"
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-medium text-sm transition-all shadow-md mt-2 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Validando...</span>
                </>
              ) : (
                <>
                  <span>Entrar no sistema</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Quick Access Helper for admin */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <p className="text-[11px] text-gray-500 font-medium mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              Acesso rápido inicial (ambiente seguro):
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => fillQuickLogin('marcos@bycor.com.br')}
                className="text-left px-2.5 py-1.5 rounded border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <div className="font-semibold text-gray-800 text-[11px]">Marcos (Admin)</div>
                <div className="text-[10px] text-gray-500">marcos@bycor.com.br</div>
              </button>
              <button
                type="button"
                onClick={() => fillQuickLogin('admin@bycor.com.br')}
                className="text-left px-2.5 py-1.5 rounded border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
              >
                <div className="font-semibold text-gray-800 text-[11px]">Admin Padrão</div>
                <div className="text-[10px] text-gray-500">admin@bycor.com.br</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-gray-400">
          BYCOR Seguros — São Paulo · P&C Intelligence MVP Fase 0
        </div>
      </div>
    </div>
  )
}
