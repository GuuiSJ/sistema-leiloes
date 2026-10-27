import { HeroSection } from '../components/home/HeroSection'
import { FeaturedAuctions } from '../components/home/FeaturedAuctions'

export function HomePage() {
  return (
    <div className="page-container py-6 sm:py-10 lg:py-12">
      <HeroSection />
      <FeaturedAuctions />
    </div>
  )
}
