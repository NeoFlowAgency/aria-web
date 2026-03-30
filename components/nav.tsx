'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sparkles, MessageCircle, Cpu, Keyboard, LogOut } from 'lucide-react'

const links = [
  { href: '/dashboard',    label: 'Surface',   icon: Sparkles      },
  { href: '/conversation', label: 'NEO',        icon: MessageCircle },
  { href: '/robot',        label: 'Robot',      icon: Cpu           },
  { href: '/clavier',      label: 'Contrôles', icon: Keyboard      },
]

export default function Nav() {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/')
  }

  return (
    <>
      {/* ── Desktop top nav ───────────────────────────────────── */}
      <nav
        className="hidden md:flex sticky top-0 z-50 items-center justify-between px-6 h-14 flex-shrink-0"
        style={{
          background:    'rgba(7, 7, 10, 0.88)',
          backdropFilter:'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom:  '1px solid var(--neo-border)',
        }}
      >
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2.5 select-none">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))' }}
          >
            <span className="text-white text-xs font-bold">N</span>
          </div>
          <span className="font-semibold text-sm" style={{ color: 'var(--neo-text)' }}>
            NEO
          </span>
        </Link>

        {/* Links */}
        <div className="flex items-center gap-0.5">
          {links.map(link => {
            const active = pathname === link.href
            const Icon   = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: active ? 'var(--neo-text)' : 'var(--neo-muted)' }}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill-desktop"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background:  'var(--neo-surface-2)',
                      border:      '1px solid var(--neo-border-2)',
                    }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{link.label}</span>
              </Link>
            )
          })}
        </div>

        {/* Déconnexion */}
        <button
          onClick={handleLogout}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--neo-muted)' }}
          title="Déconnexion"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </nav>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch h-16"
        style={{
          background:    'rgba(7, 7, 10, 0.95)',
          backdropFilter:'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderTop:     '1px solid var(--neo-border)',
        }}
      >
        {links.map(link => {
          const active = pathname === link.href
          const Icon   = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 mx-1 my-1.5 rounded-xl transition-colors"
              style={{ color: active ? 'var(--neo-accent)' : 'var(--neo-muted)' }}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill-mobile"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: 'var(--neo-accent-dim)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className="w-5 h-5 relative z-10" />
              <span className="text-[10px] font-medium relative z-10 leading-none">
                {link.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
