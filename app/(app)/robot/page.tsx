'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wifi, WifiOff, RotateCcw, Zap } from 'lucide-react'

// ── Données ─────────────────────────────────────────────────────────────────
const EXPRESSIONS = [
  { id: 'content',  label: 'Content',  emoji: '😊', color: '#34D399' },
  { id: 'triste',   label: 'Triste',   emoji: '😢', color: '#818CF8' },
  { id: 'surpris',  label: 'Surpris',  emoji: '😲', color: '#FBBF24' },
  { id: 'colere',   label: 'Colère',   emoji: '😠', color: '#F87171' },
  { id: 'amoureux', label: 'Amoureux', emoji: '🥰', color: '#F472B6' },
  { id: 'neutre',   label: 'Neutre',   emoji: '😐', color: '#8B8BA0' },
] as const

const SERVO_PRESETS = [0, 45, 90, 135, 180] as const

// ── Composant ────────────────────────────────────────────────────────────────
export default function RobotPage() {
  const [online,     setOnline]     = useState(false)
  const [activeExpr, setActiveExpr] = useState<string>('neutre')
  const [servoAngle, setServoAngle] = useState(90)
  const [feedback,   setFeedback]   = useState<string | null>(null)
  const [loading,    setLoading]    = useState<string | null>(null)

  // Polling statut robot
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/flask/status')
        setOnline(res.ok)
      } catch { setOnline(false) }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [])

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 2000)
  }

  // Envoyer commande keypad
  const sendKeypad = useCallback(async (cmd: string, label: string) => {
    if (!online) { showFeedback('✗ Robot hors ligne'); return }
    setLoading(cmd)
    try {
      const res = await fetch(`/api/flask/keypad/${cmd}`, { method: 'POST' })
      showFeedback(res.ok ? `✓ ${label}` : '✗ Erreur commande')
    } catch { showFeedback('✗ Connexion perdue') }
    finally { setLoading(null) }
  }, [online])

  const sendExpression = (id: string) => {
    setActiveExpr(id)
    sendKeypad(`corps_${id}`, id)
  }

  const centerServo = () => {
    setServoAngle(90)
    sendKeypad('corps_centre', 'Centrer')
  }

  const servoLeft = () => {
    const next = Math.max(0, servoAngle - 30)
    setServoAngle(next)
    sendKeypad('corps_tourne_gauche', 'Gauche')
  }

  const servoRight = () => {
    const next = Math.min(180, servoAngle + 30)
    setServoAngle(next)
    sendKeypad('corps_tourne_droite', 'Droite')
  }

  const servoPreset = (v: number) => {
    setServoAngle(v)
    if (v < 90)       sendKeypad('corps_tourne_gauche', `${v}°`)
    else if (v > 90)  sendKeypad('corps_tourne_droite', `${v}°`)
    else              sendKeypad('corps_centre', 'Centre')
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto w-full px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--neo-text)' }}>
            Robot NEO
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--neo-muted)' }}>
            Télécommande physique
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
          style={{
            background: online ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
            color:      online ? 'var(--neo-green)'       : 'var(--neo-red)',
            border:     `1px solid ${online ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
          }}
        >
          {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {online ? 'Connecté' : 'Hors ligne'}
        </div>
      </div>

      {/* Toast feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-2xl"
            style={{
              background: 'var(--neo-surface-3)',
              border: '1px solid var(--neo-border-2)',
              color: 'var(--neo-text)',
            }}
          >
            {feedback}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Expressions OLED ── */}
      <section className="mb-6">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'var(--neo-subtle)' }}
        >
          Expressions OLED
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {EXPRESSIONS.map(expr => {
            const active = activeExpr === expr.id
            return (
              <button
                key={expr.id}
                onClick={() => sendExpression(expr.id)}
                disabled={loading === `corps_${expr.id}`}
                className="flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all disabled:opacity-50"
                style={{
                  background: active ? expr.color + '12' : 'var(--neo-surface)',
                  border:     `1px solid ${active ? expr.color + '35' : 'var(--neo-border)'}`,
                }}
              >
                <span className="text-2xl leading-none">{expr.emoji}</span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: active ? expr.color : 'var(--neo-muted)' }}
                >
                  {expr.label}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Actions rapides ── */}
      <section className="mb-6">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'var(--neo-subtle)' }}
        >
          Actions
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => sendKeypad('corps_danse', 'Danse !')}
            disabled={!online || loading === 'corps_danse'}
            className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all disabled:opacity-40"
            style={{
              background: 'rgba(244,114,182,0.08)',
              border:     '1px solid rgba(244,114,182,0.18)',
              color:      'var(--neo-pink)',
            }}
          >
            <Zap className="w-4 h-4" />
            Danser
          </button>
          <button
            onClick={() => sendKeypad('corps_hoche', 'Hoche !')}
            disabled={!online || loading === 'corps_hoche'}
            className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all disabled:opacity-40"
            style={{
              background: 'rgba(96,165,250,0.08)',
              border:     '1px solid rgba(96,165,250,0.18)',
              color:      '#60A5FA',
            }}
          >
            👆 Hocher
          </button>
        </div>
      </section>

      {/* ── Servo tête ── */}
      <section
        className="rounded-2xl p-5"
        style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--neo-subtle)' }}
            >
              Orientation tête
            </p>
            <p className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color: 'var(--neo-accent)' }}>
              {servoAngle}°
            </p>
          </div>
          <button
            onClick={centerServo}
            disabled={!online}
            className="p-2.5 rounded-xl transition-all disabled:opacity-40"
            style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
            title="Centrer (90°)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Contrôles directionnels */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={servoLeft}
            disabled={!online || servoAngle <= 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
            style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
          >
            ← Gauche
          </button>
          <button
            onClick={centerServo}
            disabled={!online}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
            style={{ background: 'var(--neo-accent-dim)', border: '1px solid rgba(129,140,248,0.2)', color: 'var(--neo-accent)' }}
          >
            Centre
          </button>
          <button
            onClick={servoRight}
            disabled={!online || servoAngle >= 180}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
            style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
          >
            Droite →
          </button>
        </div>

        {/* Presets angles */}
        <div className="flex justify-between gap-1">
          {SERVO_PRESETS.map(v => (
            <button
              key={v}
              onClick={() => servoPreset(v)}
              disabled={!online}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all disabled:opacity-40"
              style={{
                background: servoAngle === v ? 'var(--neo-accent-dim)'  : 'var(--neo-surface-2)',
                border:     servoAngle === v ? '1px solid rgba(129,140,248,0.25)' : '1px solid var(--neo-border)',
                color:      servoAngle === v ? 'var(--neo-accent)' : 'var(--neo-subtle)',
              }}
            >
              {v}°
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
