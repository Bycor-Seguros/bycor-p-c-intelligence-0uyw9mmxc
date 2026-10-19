import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { Shield, Mail, ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('Por favor, informe o seu e-mail corporativo.')
      return
    }

    try {
      setLoading(true)
      await pb.collection('users').requestPasswordReset(email.trim())
      setSubmitted(true)
    } catch (err: unknown) {
      console.error(err)
      // Even if user not found, show standard confirmation to avoid user enumeration
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0F2B46] via-[#0B1D31] to-[#081524] p-4 relative overflow-hidden">
      <div className="w-full max-w-md z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#16578B] shadow-xl mb-3 text-white">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-white">Recuperação de Acesso</h1>
          <p className="text-xs text-gray-300 mt-1">BYCOR P&C Intelligence</p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-8">
          {submitted ? (
            <div className="text-center py-4 space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-2">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-gray-900">E-mail de recuperação enviado</h2>
              <p className="text-xs text-gray-600 leading-relaxed">
                Enviamos um link de recuperação para o e-mail informado. Por favor, verifique sua
                caixa de entrada e spam.
              </p>
              <Link to="/login" className="inline-block mt-4">
                <Button variant="outline" className="text-xs">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Voltar ao Login
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-600 mb-6 leading-relaxed">
                Informe o seu e-mail corporativo cadastrado para receber instruções de redefinição
                de senha.
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
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
                      className="pl-9 text-sm h-10 border-gray-300"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-10 bg-[#0F2B46] hover:bg-[#1B3C5D] text-white font-medium text-xs shadow-md"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Enviar link de recuperação
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/login"
                  className="text-xs text-[#16578B] hover:text-[#0E4268] hover:underline font-medium inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Voltar para o login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
