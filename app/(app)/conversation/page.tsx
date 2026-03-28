'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, RotateCcw } from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'aria'
  text: string
  timestamp: Date
}

type ARIAStatus = 'repos' | 'ecoute' | 'reflechit' | 'parle'

const STATUS_LABELS: Record<ARIAStatus, string> = {
  repos: 'En veille',
  ecoute: 'Écoute…',
  reflechit: 'Réfléchit…',
  parle: 'Parle…',
}

const STATUS_COLORS: Record<ARIAStatus, string> = {
  repos: '#86868b',
  ecoute: '#0071e3',
  reflechit: '#ff9500',
  parle: '#34c759',
}

export default function ConversationPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<ARIAStatus>('repos')
  const [modeContinue, setModeContinue] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Polling toutes les 2s (SSE incompatible avec Cloudflare Tunnel quick)
    let lastMsgCount = 0

    const poll = async () => {
      try {
        const res = await fetch('/api/flask/status')
        if (!res.ok) return
        const data = await res.json()
        setStatus(data.etat as ARIAStatus)
        setModeContinue(data.mode_continu ?? false)

        // Ajouter seulement les nouveaux messages
        const msgs: Array<{ role: string; text: string; ts: number }> = data.messages ?? []
        if (msgs.length > lastMsgCount) {
          const nouveaux = msgs.slice(lastMsgCount)
          lastMsgCount = msgs.length
          setMessages((prev) => [
            ...prev,
            ...nouveaux.map((m) => ({
              id: `${m.ts}-${m.role}`,
              role: m.role as 'user' | 'aria',
              text: m.text,
              timestamp: new Date(m.ts * 1000),
            })),
          ])
        }
      } catch {
        // Flask hors ligne — on réessaie au prochain tick
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function toggleModeContinue() {
    await fetch('/api/flask/toggle_continu', { method: 'POST' })
  }

  function clearMessages() {
    setMessages([])
  }

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">
            Conversation
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <motion.span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[status] }}
              animate={{ scale: status !== 'repos' ? [1, 1.3, 1] : 1 }}
              transition={{ repeat: status !== 'repos' ? Infinity : 0, duration: 1.2 }}
            />
            <span className="text-sm text-[#86868b]">{STATUS_LABELS[status]}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearMessages}
            className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-white rounded-xl transition-all"
            title="Effacer la conversation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={toggleModeContinue}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all ${
              modeContinue
                ? 'bg-[#0071e3] text-white'
                : 'bg-white text-[#86868b] border border-[#d2d2d7] hover:border-[#0071e3]/40'
            }`}
          >
            {modeContinue ? (
              <Mic className="w-4 h-4" />
            ) : (
              <MicOff className="w-4 h-4" />
            )}
            {modeContinue ? 'Mode continu ON' : 'Mode continu'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        <AnimatePresence initial={false}>
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center h-full text-[#86868b] text-sm"
            >
              La conversation apparaîtra ici…
            </motion.div>
          )}

          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#0071e3] text-white rounded-br-sm'
                    : 'bg-white border border-[#d2d2d7] text-[#1d1d1f] rounded-bl-sm'
                }`}
              >
                {msg.role === 'aria' && (
                  <span className="block text-xs text-[#86868b] mb-1 font-medium">ARIA</span>
                )}
                {msg.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
