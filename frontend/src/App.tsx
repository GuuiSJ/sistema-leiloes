import { Route, Routes } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="leiloes" element={<PlaceholderPage title="Explorar leilões" description="A página de leilões está sendo preparada. Em breve, você poderá conhecer as oportunidades disponíveis por aqui." />} />
        <Route path="como-funciona" element={<PlaceholderPage title="Como funciona" description="Estamos preparando uma apresentação das etapas e regras da plataforma. As orientações estarão disponíveis aqui em breve." />} />
        <Route path="entrar" element={<PlaceholderPage title="Entrar na plataforma" description="O acesso à conta será disponibilizado em uma próxima etapa. Por enquanto, você pode conhecer a página inicial." />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
