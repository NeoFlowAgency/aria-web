'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, RotateCcw, WifiOff } from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'aria'
  text: string
  timestamp: Date
}

type ARIAStatus = 'repos' | 'ecoute' | 'reflechit' | 'parle'

const STATUS_LABELS: Record<ARIAStatus, string> = {
  repos:      'En veille',
  ecoute:     'Écoute…',
  reflechit:  'Réfléchit…',
  parle:      'Parle…',
}

const STATUS_COLORS: Record<ARIAStatus, string> = {
  repos:     '#86868b',
  ecoute:    '#0071e3',
  reflechit: '#ff9500',
  parle:     '#34c759',
}

function formatTime(d: Date) {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function ConversationPage() {
  const [messages, setMessages]         = useState<Message[]>([])
  const [status, setStatus]             = useState<ARIAStatus>('repos')
  const [modeContinue, setModeContinue] = useState(false)
  const [partial, setPartial]           = useState('')
  const [offline, setOffline]           = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Statut effectif : si partial est actif, ARIA parle forcément
  const effectiveStatus: ARIAStatus = partial ? 'parle' : status

  useEffect(() => {
    let lastMsgCount = 0

    const poll = async () => {
      try {
        const res = await fetch('/api/flask/status')
        if (!res.ok) { setOffline(true); return }
        const data = await res.json()
        setOffline(false)
        setStatus(data.etat as ARIAStatus)
        setModeContinue(data.mode_continu ?? false)
        setPartial(data.partial ?? '')

        const msgs: Array<{ role: string; text: string; ts: number }> = data.messages ?? []
        if (msgs.length > lastMsgCount) {
          const nouveaux = msgs.slice(lastMsgCount)
          lastMsgCount = msgs.length
          setMessages((prev) => [
            ...prev,
            ...nouveaux.map((m) => ({
              id:        `${m.ts}-${m.role}`,
              role:      m.role as 'user' | 'aria',
              text:      m.text,
              timestamp: new Date(m.ts * 1000),
            })),
          ])
        }
      } catch {
        setOffline(true)
      }
    }

    poll()
    const interval = setInterval(poll, 500)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, partial])

  async function toggleModeContinue() {
    await fetch('/api/flask/toggle_continu', { method: 'POST' })
  }

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">
            Conversation
          </h1>
          <div className="flex items-center gap-2 mt-1">
            {offline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-[#ff3b30]" />
                <span className="text-sm text-[#ff3b30]">Robot hors ligne</span>
              </>
            ) : (
              <>
                <motion.span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[effectiveStatus] }}
                  animate={{ scale: effectiveStatus !== 'repos' ? [1, 1.4, 1] : 1 }}
                  transition={{ repeat: effectiveStatus !== 'repos' ? Infinity : 0, duration: 1 }}
                />
                <span className="text-sm text-[#86868b]">{STATUS_LABELS[effectiveStatus]}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMessages([])}
            className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-white rounded-xl transition-all"
            title="Effacer l'historique affiché"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={toggleModeContinue}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl font-medium text-sm transition-all ${
              modeContinue
                ? 'bg-[#0071e3] text-white shadow-sm'
                : 'bg-white text-[#86868b] border border-[#d2d2d7] hover:border-[#0071e3]/40'
            }`}
          >
            {modeContinue ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            <span className="hidden sm:inline">
              {modeContinue ? 'Continu ON' : 'Mode continu'}
            </span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2">
        <AnimatePresence initial={false}>
          {messages.length === 0 && !partial && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full gap-3 text-[#86868b] text-sm select-none"
            >
              <div className="w-12 h-12 rounded-2xl bg-[#f5f5f7] border border-[#d2d2d7] flex items-center justify-center text-2xl">
                ✦
              </div>
              <p>Dis <span className="font-medium text-[#1d1d1f]">« Neo »</span> pour parler à ARIA</p>
            </motion.div>
          )}

          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'aria' && (
                  <span className="text-[10px] text-[#86868b] font-medium px-1">ARIA</span>
                )}
                <div
                  className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#0071e3] text-white rounded-br-sm'
                      : 'bg-white border border-[#d2d2d7] text-[#1d1d1f] rounded-bl-sm shadow-sm'
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[10px] text-[#adadb8] px-1">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </motion.div>
          ))}

          {/* Bulle streaming */}
          {partial && (
            <motion.div
              key="partial"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="max-w-[80%] flex flex-col gap-1 items-start">
                <span className="text-[10px] text-[#0071e3] font-medium px-1">ARIA ✦</span>
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-white border border-[#0071e3]/25 text-[#1d1d1f] shadow-sm">
                  {partial}
                  <span className="inline-block w-[3px] h-[14px] bg-[#0071e3] rounded-sm ml-1 animate-pulse align-middle" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
