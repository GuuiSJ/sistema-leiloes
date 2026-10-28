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
import { AdminLayout } from './components/auctioneer/AdminLayout'
import { AuctioneerOverviewPage } from './pages/AuctioneerOverviewPage'
import { AuctioneerAuctionsPage, AuctioneerLotsPage, AuctioneerVehiclesPage } from './pages/AuctioneerListsPage'
import { AuctioneerVehiclePage } from './pages/AuctioneerVehiclePage'
import { AuctioneerAuctionPage } from './pages/AuctioneerAuctionPage'
import { AuctioneerLotPage } from './pages/AuctioneerLotPage'
import { MyAcquisitionsPage } from './pages/MyAcquisitionsPage'
import { PublicAuditPage } from './pages/PublicAuditPage'
import { PublicReceiptPage } from './pages/PublicReceiptPage'
import { AuctioneerResultsPage } from './pages/AuctioneerResultsPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="leiloes" element={<AuctionsPage />} />
        <Route path="leiloes/:id" element={<AuctionDetailsPage />} />
        <Route path="auditoria" element={<PublicAuditPage />} />
        <Route path="auditoria/:lotId" element={<PublicAuditPage />} />
        <Route path="comprovantes/:publicId" element={<PublicReceiptPage />} />
        <Route path="como-funciona" element={<PlaceholderPage title="Como funciona" description="Estamos preparando uma apresentação das etapas e regras da plataforma. As orientações estarão disponíveis aqui em breve." />} />
        <Route path="entrar" element={<AuthPage />} />
        <Route path="cadastro" element={<AuthPage register />} />
        <Route element={<ProtectedRoute />}>
          <Route path="minha-conta" element={<AccountPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={['BIDDER']} />}>
          <Route path="minha-conta/arremates" element={<MyAcquisitionsPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={['AUCTIONEER']} />}>
          <Route path="area-leiloeiro" element={<AdminLayout />}>
            <Route index element={<AuctioneerOverviewPage />} />
            <Route path="resultados" element={<AuctioneerResultsPage />} />
            <Route path="veiculos" element={<AuctioneerVehiclesPage />} />
            <Route path="veiculos/novo" element={<AuctioneerVehiclePage create />} />
            <Route path="veiculos/:vehicleId/editar" element={<AuctioneerVehiclePage />} />
            <Route path="leiloes" element={<AuctioneerAuctionsPage />} />
            <Route path="leiloes/novo" element={<AuctioneerAuctionPage create />} />
            <Route path="leiloes/:auctionId/editar" element={<AuctioneerAuctionPage />} />
            <Route path="lotes" element={<AuctioneerAuctionsPage selectLot />} />
            <Route path="lotes/:auctionId" element={<AuctioneerLotsPage />} />
            <Route path="lotes/:auctionId/novo" element={<AuctioneerLotPage create />} />
            <Route path="lotes/:auctionId/:lotId/editar" element={<AuctioneerLotPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
