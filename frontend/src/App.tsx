import { Route, Routes } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { AuctionsPage } from './pages/AuctionsPage'
import { AuctionDetailsPage } from './pages/AuctionDetailsPage'
import { AuthPage } from './pages/AuthPage'
import { AccountPage } from './pages/AccountPage'
import { ProtectedRoute } from './components/auth/ProtectedRoute'

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="leiloes" element={<AuctionsPage />} />
        <Route path="leiloes/:id" element={<AuctionDetailsPage />} />
        <Route path="como-funciona" element={<PlaceholderPage title="Como funciona" description="Estamos preparando uma apresentação das etapas e regras da plataforma. As orientações estarão disponíveis aqui em breve." />} />
        <Route path="entrar" element={<AuthPage />} />
        <Route path="cadastro" element={<AuthPage register />} />
        <Route element={<ProtectedRoute />}>
          <Route path="minha-conta" element={<AccountPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={['AUCTIONEER']} />}>
          <Route path="area-leiloeiro" element={<PlaceholderPage title="Área do leiloeiro" description="Seu perfil de leiloeiro foi confirmado. Os recursos operacionais desta área serão disponibilizados em uma próxima etapa." />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
