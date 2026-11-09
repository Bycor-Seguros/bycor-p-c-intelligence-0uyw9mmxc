import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'
import { Toaster } from '@/components/ui/toaster'

// Auth Pages
import LoginPage from '@/pages/auth/LoginPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import VerifyEmailPage from '@/pages/auth/VerifyEmailPage'

// App Pages
import DashboardHome from '@/pages/Index'
import CarteiraPage from '@/pages/carteira/CarteiraPage'
import FichaApolicePage from '@/pages/carteira/FichaApolicePage'
import RecebimentoPage from '@/pages/ciclo/RecebimentoPage'
import RfqPage from '@/pages/ciclo/RfqPage'
import TabulacaoPage from '@/pages/ciclo/TabulacaoPage'
import ApresentacaoPage from '@/pages/ciclo/ApresentacaoPage'
import AuditoriaPage from '@/pages/ciclo/AuditoriaPage'
import AuditoriaCartaoApolicePage from '@/pages/ciclo/AuditoriaCartaoApolicePage'
import AprovacaoPage from '@/pages/ciclo/AprovacaoPage'
import MercadoPage from '@/pages/mercado/MercadoPage'
import VersaoContratacaoPage from '@/pages/mercado/VersaoContratacaoPage'
import PlaybookPage from '@/pages/mercado/PlaybookPage'
import ChatPage from '@/pages/chat/ChatPage'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />

          {/* Protected Routes in Main Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* Início (Dashboard de Renovações) */}
            <Route path="/" element={<DashboardHome />} />

            {/* Carteira */}
            <Route path="/carteira" element={<CarteiraPage />} />
            <Route path="/carteira/apolice/:id" element={<FichaApolicePage />} />

            {/* Ciclo de Cotação C1 - C6 */}
            <Route path="/c1-recebimento" element={<RecebimentoPage />} />
            <Route path="/c2-rfq" element={<RfqPage />} />
            <Route path="/c3-tabulacao" element={<TabulacaoPage />} />
            <Route path="/c4-apresentacao" element={<ApresentacaoPage />} />
            <Route path="/c5-auditoria" element={<AuditoriaPage />} />
            <Route path="/auditoria-cartao-apolice" element={<AuditoriaCartaoApolicePage />} />
            <Route path="/c6-aprovacao" element={<AprovacaoPage />} />
            {/* Gestão Comercial */}
            <Route path="/mercado" element={<MercadoPage />} />
            <Route path="/versao-contratacao" element={<VersaoContratacaoPage />} />
            <Route path="/playbook" element={<PlaybookPage />} />

            {/* Chat IA */}
            <Route path="/chat" element={<ChatPage />} />
          </Route>

          {/* 404 Catch-All */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  )
}
