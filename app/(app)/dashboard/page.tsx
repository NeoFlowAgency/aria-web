'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { MessageSquare, Cpu, Keyboard, Wifi, WifiOff } from 'lucide-react'

const cards = [
  {
    href: '/conversation',
    icon: MessageSquare,
    title: 'Conversation',
    description: 'Écouter et parler à ARIA en temps réel',
    color: '#0071e3',
  },
  {
    href: '/robot',
    icon: Cpu,
    title: 'Robot 3D',
    description: 'Visualisation interactive du robot',
    color: '#34c759',
  },
  {
    href: '/clavier',
    icon: Keyboard,
    title: 'Contrôles',
    description: 'Clavier virtuel et actions directes',
    color: '#ff9500',
  },
]

export default function DashboardPage() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/flask/ping')
      .then((r) => setConnected(r.ok))
      .catch(() => setConnected(false))
  }, [])

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">
          Bonjour 👋
        </h1>
        <p className="text-[#86868b] mt-2">
          Panneau de contrôle du robot ARIA
        </p>

        {/* Status robot */}
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-[#d2d2d7] text-sm">
          {connected === null ? (
            <span className="w-2 h-2 bg-[#d2d2d7] rounded-full animate-pulse" />
          ) : connected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-[#34c759]" />
              <span className="text-[#34c759] font-medium">Robot connecté</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-[#ff3b30]" />
              <span className="text-[#ff3b30] font-medium">Robot hors ligne</span>
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
            transition={{ delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link href={card.href}>
              <div className="bg-white rounded-2xl p-6 border border-[#d2d2d7] hover:border-[#0071e3]/40 hover:shadow-lg transition-all group cursor-pointer">
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
