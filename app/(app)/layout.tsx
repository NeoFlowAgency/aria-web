import Nav from '@/components/nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--neo-bg)' }}>
      <Nav />
      {/* pb-16 = espace pour la bottom nav sur mobile */}
      <main className="flex-1 flex flex-col pb-16 md:pb-0">
        {children}
      </main>
    </div>
  )
}
