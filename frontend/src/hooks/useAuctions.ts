import { useEffect, useState } from 'react'
import { ApiError } from '../services/api'
import { loadAuctionPage, loadFeatured, type AuctionPreview, type Pagination } from '../services/auctions'

type State = { loading: boolean; error: string | null; items: AuctionPreview[]; pagination: Pagination | null }
export function useAuctions(featured: boolean, page = 1) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ loading: true, error: null, items: [], pagination: null })
  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, error: null, items: [], pagination: null })
    const request = featured ? loadFeatured(controller.signal) : loadAuctionPage(page, controller.signal)
    request.then(result => {
      if (!controller.signal.aborted) setState({ ...result, loading: false, error: null })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ loading: false, items: [], pagination: null,
        error: error instanceof ApiError ? error.message : 'Não foi possível carregar os leilões. Tente novamente.' })
    })
    return () => controller.abort()
  }, [featured, page, attempt])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}
