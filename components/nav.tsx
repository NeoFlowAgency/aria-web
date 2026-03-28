'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

const links = [
  { href: '/dashboard', label: 'Accueil' },
  { href: '/conversation', label: 'Conversation' },
  { href: '/robot', label: 'Robot 3D' },
  { href: '/clavier', label: 'Contrôles' },
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-[#d2d2d7]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#1d1d1f] rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-semibold">A</span>
          </div>
          <span className="font-semibold text-[#1d1d1f] text-sm">ARIA</span>
        </Link>

        {/* Liens */}
        <div className="hidden sm:flex items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
                style={{ color: active ? '#1d1d1f' : '#86868b' }}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 bg-[#f5f5f7] rounded-lg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{link.label}</span>
              </Link>
            )
          })}
        </div>

        {/* Déconnexion */}
        <button
          onClick={handleLogout}
          className="text-sm text-[#86868b] hover:text-[#1d1d1f] transition-colors"
        >
          Déconnexion
        </button>
      </div>
    </nav>
  )
}
