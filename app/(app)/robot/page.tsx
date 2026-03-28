'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import dynamic from 'next/dynamic'

// Three.js doit être chargé côté client uniquement
const RobotViewer = dynamic(() => import('@/components/robot-viewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

type Expression = 'content' | 'triste' | 'surpris' | 'colere' | 'amoureux' | 'neutre'
type RobotState = 'repos' | 'ecoute' | 'reflechit' | 'parle' | 'danse'

const EXPRESSIONS: { value: Expression; label: string; emoji: string }[] = [
  { value: 'content', label: 'Content', emoji: '😊' },
  { value: 'triste', label: 'Triste', emoji: '😢' },
  { value: 'surpris', label: 'Surpris', emoji: '😮' },
  { value: 'colere', label: 'Colère', emoji: '😠' },
  { value: 'amoureux', label: 'Amoureux', emoji: '🥰' },
  { value: 'neutre', label: 'Neutre', emoji: '😐' },
]

export default function RobotPage() {
  const [expression, setExpression] = useState<Expression>('neutre')
  const [robotState, setRobotState] = useState<RobotState>('repos')
  const [servoAngle, setServoAngle] = useState(90)

  // Sync avec SSE Flask
  useEffect(() => {
    const es = new EventSource('/api/stream')

    es.addEventListener('status', (e) => {
      const data = JSON.parse(e.data)
      const etat = data.etat as string
      if (['repos', 'ecoute', 'reflechit', 'parle'].includes(etat)) {
        setRobotState(etat as RobotState)
      }
    })

    es.addEventListener('expression', (e) => {
      const data = JSON.parse(e.data)
      if (data.expr) setExpression(data.expr as Expression)
    })

    es.addEventListener('servo', (e) => {
      const data = JSON.parse(e.data)
      if (typeof data.angle === 'number') setServoAngle(data.angle)
    })

    return () => es.close()
  }, [])

  async function sendExpression(expr: Expression) {
    setExpression(expr)
    await fetch('/api/flask/keypad/corps_' + expr, { method: 'POST' })
  }

  async function sendDance() {
    setRobotState('danse')
    await fetch('/api/flask/keypad/corps_danse', { method: 'POST' })
    setTimeout(() => setRobotState('repos'), 5000)
  }

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight mb-6">
        Robot 3D
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Viewer 3D */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-2 bg-white rounded-2xl border border-[#d2d2d7] overflow-hidden"
          style={{ height: '480px' }}
        >
          <RobotViewer
            expression={expression}
            state={robotState}
            servoAngle={servoAngle}
            className="w-full h-full"
          />
        </motion.div>

        {/* Panneau de contrôle */}
        <div className="space-y-4">
          {/* Expressions */}
          <div className="bg-white rounded-2xl border border-[#d2d2d7] p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-3">Expression</h2>
            <div className="grid grid-cols-3 gap-2">
              {EXPRESSIONS.map((expr) => (
                <button
                  key={expr.value}
                  onClick={() => sendExpression(expr.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl text-xs font-medium transition-all ${
                    expression === expr.value
                      ? 'bg-[#0071e3] text-white'
                      : 'bg-[#f5f5f7] text-[#86868b] hover:bg-[#e8e8ed]'
                  }`}
                >
                  <span className="text-lg">{expr.emoji}</span>
                  {expr.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white rounded-2xl border border-[#d2d2d7] p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-3">Actions</h2>
            <div className="space-y-2">
              <button
                onClick={sendDance}
                className="w-full py-2.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] text-sm font-medium rounded-xl transition-colors"
              >
                💃 Danser
              </button>
              <button
                onClick={() => fetch('/api/flask/keypad/corps_hoche', { method: 'POST' })}
                className="w-full py-2.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] text-sm font-medium rounded-xl transition-colors"
              >
                👆 Hocher la tête
              </button>
            </div>
          </div>

          {/* Servo */}
          <div className="bg-white rounded-2xl border border-[#d2d2d7] p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">
              Tête — {servoAngle}°
            </h2>
            <p className="text-xs text-[#86868b] mb-3">Angle du servo (0°–180°)</p>
            <div className="flex gap-2">
              <button
                onClick={() => fetch('/api/flask/keypad/corps_tourne_gauche', { method: 'POST' })}
                className="flex-1 py-2 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-sm rounded-xl transition-colors"
              >
                ← Gauche
              </button>
              <button
                onClick={() => fetch('/api/flask/keypad/corps_centre', { method: 'POST' })}
                className="flex-1 py-2 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-sm rounded-xl transition-colors"
              >
                Centre
              </button>
              <button
                onClick={() => fetch('/api/flask/keypad/corps_tourne_droite', { method: 'POST' })}
                className="flex-1 py-2 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-sm rounded-xl transition-colors"
              >
                Droite →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
