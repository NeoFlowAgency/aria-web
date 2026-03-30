'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

type Key = { label: string; key: string; description: string; color?: string }

const KEYS: Key[] = [
  { label: '1', key: '1', description: 'Action 1' },
  { label: '2', key: '2', description: 'Action 2' },
  { label: '3', key: '3', description: 'Action 3' },
  { label: 'A', key: 'A', description: 'Interagir avec IA',    color: '#818CF8' },
  { label: '4', key: '4', description: 'Action 4' },
  { label: '5', key: '5', description: 'Action 5' },
  { label: '6', key: '6', description: 'Action 6' },
  { label: 'B', key: 'B', description: 'Action B',             color: '#34D399' },
  { label: '7', key: '7', description: 'Action 7' },
  { label: '8', key: '8', description: 'Action 8' },
  { label: '9', key: '9', description: 'Action 9' },
  { label: 'C', key: 'C', description: 'Action C',             color: '#FBBF24' },
  { label: '*', key: '*', description: 'Mode continu ON/OFF',  color: '#A78BFA' },
  { label: '0', key: '0', description: 'Action 0' },
  { label: '#', key: '#', description: 'Veille',               color: '#8B8BA0' },
  { label: 'D', key: 'D', description: 'Action D',             color: '#F87171' },
]

export default function ClavierPage() {
  const [lastPressed, setLastPressed] = useState<string | null>(null)
  const [sending,     setSending]     = useState<string | null>(null)

  async function pressKey(key: string) {
    if (sending) return
    setSending(key)
    setLastPressed(key)
    try {
      await fetch(`/api/flask/keypad/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } catch {}
    finally { setSending(null) }
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-8 w-full">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--neo-text)' }}>
          Contrôles
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--neo-muted)' }}>
          Clavier virtuel 4×4
        </p>
      </div>

      {/* Dernière touche */}
      <div className="mb-6 flex justify-center">
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm"
          style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)' }}
        >
          <span style={{ color: 'var(--neo-muted)' }}>Dernière touche</span>
          <span
            className="font-semibold font-mono min-w-[1.5rem] text-center"
            style={{ color: 'var(--neo-accent)' }}
          >
            {lastPressed ?? '—'}
          </span>
        </div>
      </div>

      {/* Grille 4×4 */}
      <div className="grid grid-cols-4 gap-2.5">
        {KEYS.map(k => (
          <motion.button
            key={k.key}
            whileTap={{ scale: 0.9 }}
            onClick={() => pressKey(k.key)}
            disabled={!!sending}
            title={k.description}
            className="relative aspect-square flex items-center justify-center rounded-2xl font-semibold text-lg transition-all disabled:opacity-50"
            style={{
              background:  k.color ? k.color + '10' : 'var(--neo-surface)',
              border:      `1px solid ${k.color ? k.color + '30' : 'var(--neo-border)'}`,
              color:       k.color ?? 'var(--neo-muted)',
            }}
          >
            {sending === k.key ? (
              <div
                className="w-4 h-4 border-2 rounded-full animate-spin"
                style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'currentColor' }}
              />
            ) : k.label}
          </motion.button>
        ))}
      </div>

      {/* Légende */}
      <div className="mt-8 space-y-2">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'var(--neo-subtle)' }}
        >
          Légende
        </p>
        {KEYS.filter(k => k.color).map(k => (
          <div key={k.key} className="flex items-center gap-3">
            <span
              className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: k.color + '12', color: k.color }}
            >
              {k.label}
            </span>
            <span className="text-sm" style={{ color: 'var(--neo-muted)' }}>{k.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
