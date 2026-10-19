import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('Token de verificação ausente.')
      setLoading(false)
      return
    }

    pb.collection('users')
      .confirmVerification(token)
      .then(() => {
        setSuccess(true)
      })
      .catch((err) => {
        console.error(err)
        setError('Não foi possível verificar o e-mail. O link pode ter expirado.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0F2B46] via-[#0B1D31] to-[#081524] p-4">
      <div className="w-full max-w-md z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#16578B] shadow-xl mb-3 text-white">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-white">Verificação de E-mail</h1>
          <p className="text-xs text-gray-300 mt-1">BYCOR P&C Intelligence</p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-8 text-center">
          {loading ? (
            <div className="py-6 flex flex-col items-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#16578B] mb-3" />
              <p className="text-xs text-gray-600">Verificando sua conta corporativa...</p>
            </div>
          ) : success ? (
            <div className="py-4 space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-gray-900">E-mail verificado com sucesso!</h2>
              <p className="text-xs text-gray-600">
                Sua conta está ativa e pronta para uso no sistema Bycor.
              </p>
              <Link to="/login" className="inline-block mt-4">
                <Button className="text-xs bg-[#0F2B46] hover:bg-[#1B3C5D]">
                  Acessar minha conta
                </Button>
              </Link>
            </div>
          ) : (
            <div className="py-4 space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Falha na verificação</h2>
              <p className="text-xs text-gray-600">{error}</p>
              <Link to="/login" className="inline-block mt-4">
                <Button variant="outline" className="text-xs">
                  Ir para Login
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
