'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { MessageSquare, Cpu, Keyboard, WifiOff } from 'lucide-react'

type ARIAStatus = 'repos' | 'ecoute' | 'reflechit' | 'parle'

const STATUS_LABELS: Record<ARIAStatus, string> = {
  repos:     'En veille',
  ecoute:    'Écoute…',
  reflechit: 'Réfléchit…',
  parle:     'Parle…',
}
const STATUS_COLORS: Record<ARIAStatus, string> = {
  repos:     '#86868b',
  ecoute:    '#0071e3',
  reflechit: '#ff9500',
  parle:     '#34c759',
}

const cards = [
  { href: '/conversation', icon: MessageSquare, title: 'Conversation', description: 'Écouter ARIA en temps réel', color: '#0071e3' },
  { href: '/robot',        icon: Cpu,           title: 'Robot 3D',     description: 'Visualisation interactive',   color: '#34c759' },
  { href: '/clavier',      icon: Keyboard,      title: 'Contrôles',    description: 'Clavier virtuel 4×4',         color: '#ff9500' },
]

export default function DashboardPage() {
  const [status, setStatus]           = useState<ARIAStatus | null>(null)
  const [partial, setPartial]         = useState('')
  const [modeContinue, setModeContinue] = useState(false)
  const [offline, setOffline]         = useState(false)
  const [lastMsg, setLastMsg]         = useState<string | null>(null)

  useEffect(() => {
    let lastCount = 0
    const poll = async () => {
      try {
        const res = await fetch('/api/flask/status')
        if (!res.ok) { setOffline(true); return }
        const data = await res.json()
        setOffline(false)
        setPartial(data.partial ?? '')
        setModeContinue(data.mode_continu ?? false)
        const s = data.etat as ARIAStatus
        setStatus(partial ? 'parle' : s)
        const msgs: Array<{ role: string; text: string }> = data.messages ?? []
        if (msgs.length > lastCount) {
          lastCount = msgs.length
          const last = msgs[msgs.length - 1]
          setLastMsg(last.text)
        }
      } catch { setOffline(true) }
    }
    poll()
    const id = setInterval(poll, 1000)
    return () => clearInterval(id)
  }, [partial])

  const effectiveStatus: ARIAStatus = partial ? 'parle' : (status ?? 'repos')

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-[#1d1d1f] tracking-tight">Bonjour</h1>
        <p className="text-[#86868b] mt-1 text-sm">Panneau de contrôle du robot ARIA</p>

        {/* Statut en temps réel */}
        <div className="mt-4 flex items-center gap-3 p-3 bg-white rounded-2xl border border-[#d2d2d7] max-w-xs">
          {offline ? (
            <>
              <WifiOff className="w-4 h-4 text-[#ff3b30] flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#ff3b30]">Robot hors ligne</p>
                <p className="text-[11px] text-[#86868b]">Vérifie le tunnel Cloudflare</p>
              </div>
            </>
          ) : (
            <>
              <motion.span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: STATUS_COLORS[effectiveStatus] }}
                animate={{ scale: effectiveStatus !== 'repos' ? [1, 1.4, 1] : 1 }}
                transition={{ repeat: effectiveStatus !== 'repos' ? Infinity : 0, duration: 1 }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#1d1d1f]">
                  ARIA — {STATUS_LABELS[effectiveStatus]}
                  {modeContinue && (
                    <span className="ml-2 text-[10px] font-semibold text-[#0071e3] bg-[#0071e3]/10 px-1.5 py-0.5 rounded-full">
                      CONTINU
                    </span>
                  )}
                </p>
                {lastMsg && (
                  <p className="text-[11px] text-[#86868b] truncate mt-0.5">{lastMsg}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((card, i) => (
          <motion.div
            key={card.href}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link href={card.href}>
              <div className="bg-white rounded-2xl p-6 border border-[#d2d2d7] hover:border-[#0071e3]/40 hover:shadow-md transition-all group cursor-pointer">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: card.color + '18' }}
                >
                  <card.icon className="w-5 h-5" style={{ color: card.color }} />
                </div>
                <h2 className="font-semibold text-[#1d1d1f] mb-1 group-hover:text-[#0071e3] transition-colors">
                  {card.title}
                </h2>
                <p className="text-sm text-[#86868b]">{card.description}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
