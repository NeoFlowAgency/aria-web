'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

type Key = {
  label: string
  key: string
  description: string
  color?: string
}

const KEYS: Key[] = [
  { label: '1', key: '1', description: 'Action 1' },
  { label: '2', key: '2', description: 'Action 2' },
  { label: '3', key: '3', description: 'Action 3' },
  { label: 'A', key: 'A', description: 'Interagir avec IA', color: '#0071e3' },
  { label: '4', key: '4', description: 'Action 4' },
  { label: '5', key: '5', description: 'Action 5' },
  { label: '6', key: '6', description: 'Action 6' },
  { label: 'B', key: 'B', description: 'Action B', color: '#34c759' },
  { label: '7', key: '7', description: 'Action 7' },
  { label: '8', key: '8', description: 'Action 8' },
  { label: '9', key: '9', description: 'Action 9' },
  { label: 'C', key: 'C', description: 'Action C', color: '#ff9500' },
  { label: '*', key: '*', description: 'Mode continu ON/OFF', color: '#8e44ad' },
  { label: '0', key: '0', description: 'Action 0' },
  { label: '#', key: '#', description: 'Veille', color: '#86868b' },
  { label: 'D', key: 'D', description: 'Action D', color: '#ff3b30' },
]

export default function ClavierPage() {
  const [lastPressed, setLastPressed] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  async function pressKey(key: string) {
    if (sending) return
    setSending(key)
    setLastPressed(key)

    try {
      await fetch(`/api/flask/keypad/${encodeURIComponent(key)}`, {
        method: 'POST',
      })
    } catch {
      // Erreur silencieuse
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">
          Contrôles
        </h1>
        <p className="text-[#86868b] mt-1 text-sm">
          Clavier virtuel — équivalent du clavier 4×4 physique
        </p>
      </div>

      <div className="max-w-sm mx-auto">
        {/* Indicateur dernière touche */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-[#d2d2d7] text-sm">
            <span className="text-[#86868b]">Dernière touche :</span>
            <span className="font-semibold text-[#1d1d1f] font-mono min-w-[1.5rem] text-center">
              {lastPressed ?? '—'}
            </span>
          </div>
        </div>

        {/* Grille 4×4 */}
        <div className="grid grid-cols-4 gap-3">
          {KEYS.map((k) => (
            <motion.button
              key={k.key}
              whileTap={{ scale: 0.92 }}
              onClick={() => pressKey(k.key)}
              disabled={!!sending}
              title={k.description}
              className="relative aspect-square flex flex-col items-center justify-center rounded-2xl font-semibold text-lg transition-colors disabled:opacity-60"
              style={{
                backgroundColor: k.color ? k.color + '18' : '#ffffff',
                border: `1.5px solid ${k.color ? k.color + '40' : '#d2d2d7'}`,
                color: k.color ?? '#1d1d1f',
              }}
            >
              {sending === k.key && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60" />
                </span>
              )}
              <span className={sending === k.key ? 'opacity-0' : ''}>{k.label}</span>
            </motion.button>
          ))}
        </div>

        {/* Légende */}
        <div className="mt-8 space-y-2">
          <p className="text-xs font-semibold text-[#86868b] uppercase tracking-wide mb-3">
            Légende
          </p>
          {KEYS.filter((k) => k.color).map((k) => (
            <div key={k.key} className="flex items-center gap-3 text-sm">
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: k.color + '20', color: k.color }}
              >
                {k.label}
              </span>
              <span className="text-[#86868b]">{k.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
