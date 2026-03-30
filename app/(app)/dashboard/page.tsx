'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { MessageCircle, Cpu, Keyboard, ArrowRight, WifiOff } from 'lucide-react'

type ARIAStatus = 'repos' | 'ecoute' | 'reflechit' | 'parle'

const STATUS_CFG: Record<ARIAStatus, { label: string; color: string; glow: string; pulse: boolean }> = {
  repos:     { label: 'En veille',   color: '#4A4A60',  glow: 'rgba(74,74,96,0.25)',    pulse: false },
  ecoute:    { label: 'Écoute…',    color: '#818CF8',  glow: 'rgba(129,140,248,0.35)', pulse: true  },
  reflechit: { label: 'Réfléchit…', color: '#FBBF24',  glow: 'rgba(251,191,36,0.30)',  pulse: true  },
  parle:     { label: 'Parle…',     color: '#34D399',  glow: 'rgba(52,211,153,0.30)',  pulse: true  },
}

const QUICK_CARDS = [
  { href: '/conversation', label: 'Parler à NEO',      sub: 'Voix ou texte',         icon: MessageCircle, color: '#818CF8' },
  { href: '/robot',        label: 'Contrôler le robot', sub: 'Expressions · Servo',  icon: Cpu,           color: '#34D399' },
  { href: '/clavier',      label: 'Clavier physique',   sub: 'Touches 4×4',           icon: Keyboard,      color: '#FBBF24' },
]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 6)  return 'Bonne nuit'
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

export default function DashboardPage() {
  const [status,       setStatus]       = useState<ARIAStatus>('repos')
  const [partial,      setPartial]      = useState('')
  const [offline,      setOffline]      = useState(false)
  const [lastMsg,      setLastMsg]      = useState<string | null>(null)
  const [modeContinue, setModeContinue] = useState(false)
  const lastCountRef = useRef(0)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/flask/status')
        if (!res.ok) { setOffline(true); return }
        const data = await res.json()
        setOffline(false)
        setPartial(data.partial ?? '')
        setModeContinue(data.mode_continu ?? false)
        setStatus(data.etat as ARIAStatus)
        const msgs: Array<{ role: string; text: string }> = data.messages ?? []
        if (msgs.length > lastCountRef.current) {
          lastCountRef.current = msgs.length
          const last = [...msgs].reverse().find(m => m.role === 'aria')
          if (last) setLastMsg(last.text)
        }
      } catch { setOffline(true) }
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => clearInterval(id)
  }, [])

  const effectiveStatus: ARIAStatus = partial ? 'parle' : status
  const cfg = STATUS_CFG[effectiveStatus]

  return (
    <div
      className="flex flex-col items-center justify-start min-h-full px-4 py-10 md:py-16 w-full"
      style={{ maxWidth: 560, margin: '0 auto' }}
    >
      {/* Greeting */}
      <motion.p
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-sm mb-12"
        style={{ color: 'var(--neo-muted)' }}
      >
        {getGreeting()}, Noakim
      </motion.p>

      {/* NEO Orb */}
      <div className="relative flex items-center justify-center mb-8 select-none">
        {/* Outer glow */}
        {cfg.pulse && (
          <>
            <motion.div
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 200, height: 200,
                background: cfg.glow,
                filter: 'blur(40px)',
              }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute rounded-full border pointer-events-none"
              style={{ width: 152, height: 152, borderColor: cfg.color + '25' }}
              animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
            />
          </>
        )}

        {/* Orb */}
        <Link href="/conversation">
          <motion.div
            className="relative w-32 h-32 rounded-full flex items-center justify-center cursor-pointer"
            style={{
              background:  `radial-gradient(circle at 38% 32%, ${cfg.color}20, ${cfg.color}06)`,
              border:      `1px solid ${cfg.color}35`,
              boxShadow:   `0 0 32px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
            }}
            animate={cfg.pulse ? { scale: [1, 1.025, 1] } : { scale: 1 }}
            transition={{ duration: 2.2, repeat: cfg.pulse ? Infinity : 0, ease: 'easeInOut' }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            <div
              className="absolute inset-5 rounded-full pointer-events-none"
              style={{ background: `radial-gradient(circle, ${cfg.color}14, transparent)` }}
            />
            <span
              className="relative text-4xl font-bold tracking-tighter"
              style={{ color: cfg.color, textShadow: `0 0 24px ${cfg.glow}` }}
            >
              N
            </span>
          </motion.div>
        </Link>
      </div>

      {/* Status text */}
      <AnimatePresence mode="wait">
        <motion.div
          key={effectiveStatus + (offline ? '-off' : '')}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.25 }}
          className="text-center mb-3"
        >
          <p className="text-base font-semibold" style={{ color: 'var(--neo-text)' }}>
            NEO
            <span style={{ color: 'var(--neo-muted)' }}>
              {' '}·{' '}{offline ? 'Hors ligne' : cfg.label}
            </span>
          </p>

          {partial && (
            <p
              className="text-sm mt-1.5 max-w-xs mx-auto leading-relaxed"
              style={{ color: 'var(--neo-muted)' }}
            >
              {partial}
              <span
                className="inline-block w-[2px] h-[13px] ml-1 align-middle rounded-sm"
                style={{ background: 'var(--neo-accent)', animation: 'blink-cursor 1s step-end infinite' }}
              />
            </p>
          )}

          {!partial && lastMsg && effectiveStatus === 'repos' && (
            <p
              className="text-sm mt-1.5 max-w-xs mx-auto leading-relaxed truncate"
              style={{ color: 'var(--neo-muted)' }}
            >
              {lastMsg}
            </p>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap justify-center mb-12">
        {offline && (
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: 'rgba(248,113,113,0.08)',
              color: 'var(--neo-red)',
              border: '1px solid rgba(248,113,113,0.18)',
            }}
          >
            <WifiOff className="w-3 h-3" />
            VPS hors ligne
          </div>
        )}
        {modeContinue && !offline && (
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: 'var(--neo-accent-dim)',
              color: 'var(--neo-accent)',
              border: '1px solid rgba(129,140,248,0.2)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--neo-accent)' }}
            />
            Écoute continue
          </div>
        )}
      </div>

      {/* Quick cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
        {QUICK_CARDS.map((card, i) => (
          <motion.div
            key={card.href}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.07, duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link href={card.href} className="block group">
              <div
                className="relative overflow-hidden rounded-2xl p-4 transition-all duration-200"
                style={{
                  background: 'var(--neo-surface)',
                  border: '1px solid var(--neo-border)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = card.color + '28'
                  ;(e.currentTarget as HTMLDivElement).style.background = 'var(--neo-surface-2)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--neo-border)'
                  ;(e.currentTarget as HTMLDivElement).style.background = 'var(--neo-surface)'
                }}
              >
                {/* Subtle corner glow */}
                <div
                  className="absolute top-0 right-0 w-20 h-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: `radial-gradient(circle at top right, ${card.color}10, transparent 70%)`,
                  }}
                />
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: card.color + '12' }}
                  >
                    <card.icon className="w-4 h-4" style={{ color: card.color }} />
                  </div>
                  <ArrowRight
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-200"
                    style={{ color: card.color }}
                  />
                </div>
                <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--neo-text)' }}>
                  {card.label}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--neo-muted)' }}>
                  {card.sub}
                </p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
