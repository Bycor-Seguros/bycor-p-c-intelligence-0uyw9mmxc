import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { Shield, Lock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Token de recuperação ausente ou inválido.')
      return
    }
    if (password.length < 8) {
      setError('A nova senha deve ter no mínimo 8 caracteres.')
      return
    }
    if (password !== passwordConfirm) {
      setError('As senhas não coincidem.')
      return
    }

    try {
      setLoading(true)
      await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: unknown) {
      console.error(err)
      setError('Não foi possível redefinir a senha. O link pode ter expirado.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0F2B46] via-[#0B1D31] to-[#081524] p-4">
      <div className="w-full max-w-md z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#16578B] shadow-xl mb-3 text-white">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-white">Redefinir Senha</h1>
          <p className="text-xs text-gray-300 mt-1">BYCOR P&C Intelligence</p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-8">
          {success ? (
            <div className="text-center py-4 space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Senha alterada com sucesso!</h2>
              <p className="text-xs text-gray-600">
                Redirecionando para a tela de login em alguns segundos...
              </p>
              <Link to="/login" className="inline-block mt-3">
                <Button className="text-xs bg-[#0F2B46]">Entrar agora</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">Nova Senha</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-3 pointer-events-none" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="pl-9 text-sm h-10 border-gray-300"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">Confirmar Nova Senha</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-3 pointer-events-none" />
                  <Input
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="pl-9 text-sm h-10 border-gray-300"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-medium text-xs shadow-md mt-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Salvar nova senha
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
