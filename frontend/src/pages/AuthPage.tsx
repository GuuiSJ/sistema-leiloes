import { CarFront } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { AuthForm } from '../components/auth/AuthForm'
import { SessionFeedback } from '../components/auth/SessionFeedback'
import { safeReturnPath } from '../services/auth-session'

export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth(), location = useLocation()
  const from: unknown = location.state?.from
  if (auth.status === 'restoring' || auth.status === 'unavailable') return <SessionFeedback />
  if (auth.status === 'authenticated') return <Navigate to={safeReturnPath(from)} replace />
  return <div className="page-container py-8 sm:py-12">
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="flex flex-col justify-between bg-navy p-7 text-white sm:p-10">
        <div><CarFront size={34} strokeWidth={1.5} aria-hidden="true" /><p className="mt-7 text-xs font-medium tracking-[0.2em] text-blue-200 uppercase">Leilões de automóveis</p><h2 className="mt-4 text-3xl leading-tight font-semibold tracking-tight">Sua próxima oportunidade começa aqui.</h2></div>
        <p className="mt-8 text-sm leading-7 text-slate-300">{register ? 'O cadastro público cria um perfil de participante. O perfil de leiloeiro é administrado pela plataforma.' : 'Acesse sua conta para consultar seu perfil. Você também pode explorar os leilões sem entrar.'}</p>
      </aside>
      <section className="p-6 sm:p-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{register ? 'Crie sua conta' : 'Bem-vindo de volta'}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{register ? 'Preencha seus dados para se cadastrar como participante.' : 'Entre com seu e-mail e senha.'}</p>
        {!register && location.state?.registered === true && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Cadastro concluído. Entre com seu e-mail e senha.</p>}
        {!register && auth.message && <p role="status" className="mt-4 text-sm text-muted">{auth.message}</p>}
        <AuthForm key={register ? 'register' : 'login'} register={register} destination={from} />
      </section>
    </div>
  </div>
}
