'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Edit2, Check, X, MoreHorizontal,
  Cpu, Mic, MicOff, Square, WifiOff, PanelLeft,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────
type Session = {
  id: string; name: string
  created_at: number; updated_at: number
  message_count: number; last_message: string
}
type Message = { id: string; role: 'user' | 'aria'; text: string; ts: number }
type ARIAStatus = 'repos' | 'ecoute' | 'reflechit' | 'parle'
type MicState   = 'idle' | 'recording' | 'processing'

const STATUS_COLORS: Record<ARIAStatus, string> = {
  repos: '#86868b', ecoute: '#0071e3', reflechit: '#ff9500', parle: '#34c759',
}
const STATUS_LABELS: Record<ARIAStatus, string> = {
  repos: 'En veille', ecoute: 'Écoute…', reflechit: 'Réfléchit…', parle: 'Parle…',
}
const SUGGESTIONS = [
  'Comment tu vas ?', 'Raconte-moi quelque chose', 'Fais-moi danser !', 'Quelle heure est-il ?',
]

function fmtDate(ts: number) {
  const d = new Date(ts * 1000), diff = Date.now() - d.getTime()
  if (diff < 60_000)     return 'À l\'instant'
  if (diff < 3_600_000)  return `Il y a ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Composant ──────────────────────────────────────────────────
export default function ConversationPage() {
  // Sessions
  const [sessions, setSessions]     = useState<Session[]>([])
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [messages, setMessages]     = useState<Message[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [renaming, setRenaming]     = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [menuOpen, setMenuOpen]     = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)

  // ARIA
  const [ariaStatus, setAriaStatus]     = useState<ARIAStatus>('repos')
  const [partial, setPartial]           = useState('')
  const [offline, setOffline]           = useState(false)
  const [modeContinue, setModeContinue] = useState(false)

  // Input
  const [input, setInput]               = useState('')
  const [sending, setSending]           = useState(false)
  const [micState, setMicState]         = useState<MicState>('idle')
  const [micError, setMicError]         = useState<string | null>(null)
  const [robotEmotions, setRobotEmotions] = useState(true)

  // Refs
  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const msgCountRef  = useRef(0)    // nb messages connus côté serveur
  const activeIdRef  = useRef<string | null>(null)

  const effectiveStatus: ARIAStatus = partial ? 'parle' : ariaStatus
  activeIdRef.current = activeId

  // ── Charger sessions ─────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/flask/sessions')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch {}
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // ── Polling ARIA status ───────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/flask/status')
        if (!res.ok) { setOffline(true); return }
        const data = await res.json()
        setOffline(false)
        setAriaStatus(data.etat as ARIAStatus)
        setModeContinue(data.mode_continu ?? false)
        setPartial(data.partial ?? '')
      } catch { setOffline(true) }
    }
    poll()
    const id = setInterval(poll, 500)
    return () => clearInterval(id)
  }, [])

  // ── Polling session messages (voix + texte) ──────────────────
  useEffect(() => {
    if (!activeId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/flask/sessions/${activeId}`)
        if (!res.ok) return
        const data = await res.json()
        const raw: Array<{ role: string; text: string; ts: number }> = data.messages ?? []
        if (raw.length !== msgCountRef.current) {
          msgCountRef.current = raw.length
          setMessages(raw.map((m, i) => ({
            id:   `${m.ts}-${i}`,
            role: m.role as 'user' | 'aria',
            text: m.text,
            ts:   m.ts,
          })))
        }
      } catch {}
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => clearInterval(id)
  }, [activeId])

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, partial, sending])

  // ── Ouvrir session ────────────────────────────────────────────
  const openSession = useCallback(async (sid: string) => {
    setLoadingSession(true)
    setMenuOpen(null)
    setMessages([])
    msgCountRef.current = 0
    try {
      const res = await fetch(`/api/flask/sessions/${sid}`)
      if (!res.ok) return
      const data = await res.json()
      const raw: Array<{ role: string; text: string; ts: number }> = data.messages ?? []
      msgCountRef.current = raw.length
      setMessages(raw.map((m, i) => ({ id: `${m.ts}-${i}`, role: m.role as 'user' | 'aria', text: m.text, ts: m.ts })))
      setActiveId(sid)
      await fetch('/api/flask/sessions/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid }),
      })
    } catch {} finally {
      setLoadingSession(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [])

  // ── Créer session ─────────────────────────────────────────────
  async function createSession() {
    try {
      const res = await fetch('/api/flask/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) return
      const s: Session = await res.json()
      setSessions(prev => [s, ...prev])
      await openSession(s.id)
    } catch {}
  }

  // ── Supprimer session ─────────────────────────────────────────
  async function deleteSession(sid: string) {
    setMenuOpen(null)
    try {
      await fetch(`/api/flask/sessions/${sid}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== sid))
      if (activeId === sid) { setActiveId(null); setMessages([]) }
    } catch {}
  }

  // ── Renommer session ──────────────────────────────────────────
  async function confirmRename(sid: string) {
    if (!renameName.trim()) { setRenaming(null); return }
    try {
      const res = await fetch(`/api/flask/sessions/${sid}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameName.trim() }),
      })
      if (res.ok) {
        const updated: Session = await res.json()
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, name: updated.name } : s))
      }
    } catch {}
    setRenaming(null)
  }

  // ── Envoyer message texte ─────────────────────────────────────
  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || !activeId || sending) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setSending(true)

    const ts = Date.now() / 1000
    setMessages(prev => [...prev, { id: `${ts}-u`, role: 'user', text, ts }])
    msgCountRef.current += 1

    try {
      const res = await fetch(`/api/flask/sessions/${activeId}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, robot_emotions: robotEmotions }),
        signal: AbortSignal.timeout(35_000),
      })
      const data = await res.json()
      if (data.reply) {
        const rts = data.ts ?? (Date.now() / 1000 + 1)
        setMessages(prev => [...prev, { id: `${rts}-a`, role: 'aria', text: data.reply, ts: rts }])
        msgCountRef.current += 1
        setSessions(prev =>
          prev.map(s => s.id === activeId
            ? { ...s, last_message: data.reply.slice(0, 80), updated_at: rts, message_count: s.message_count + 2 }
            : s
          ).sort((a, b) => b.updated_at - a.updated_at)
        )
      } else if (data.error) {
        const ets = Date.now() / 1000
        setMessages(prev => [...prev, { id: `${ets}-e`, role: 'aria', text: `⚠️ ${data.error}`, ts: ets }])
      }
    } catch {
      const ets = Date.now() / 1000
      setMessages(prev => [...prev, { id: `${ets}-e`, role: 'aria', text: '⚠️ Impossible de contacter NEO.', ts: ets }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // ── Microphone ────────────────────────────────────────────────
  async function toggleMic() {
    setMicError(null)
    if (micState === 'recording') { recorderRef.current?.stop(); return }
    if (micState === 'processing') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', '']
        .find(t => !t || MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setMicState('processing')
        const ft = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: ft })
        try {
          await fetch('/api/listen', {
            method: 'POST', body: blob, headers: { 'Content-Type': ft },
            signal: AbortSignal.timeout(35_000),
          })
        } catch (err) {
          setMicError(`Erreur : ${err instanceof Error ? err.message : String(err)}`)
        } finally { setMicState('idle') }
      }
      recorderRef.current = recorder
      recorder.start(200)
      setMicState('recording')
    } catch { setMicError('Microphone inaccessible — autorisez l\'accès dans le navigateur.') }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const activeSession = sessions.find(s => s.id === activeId)
  const isThinking    = sending || (!partial && effectiveStatus === 'reflechit')

  // ── Rendu ──────────────────────────────────────────────────────
  return (
    <div
      className="animate-fade-in flex h-[calc(100vh-8rem)] -mx-4 bg-white rounded-2xl overflow-hidden border border-[#e5e5e7]"
      onClick={() => setMenuOpen(null)}
    >

      {/* ════════════════ SIDEBAR ════════════════ */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 240, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col border-r border-[#e5e5e7] overflow-hidden flex-shrink-0 bg-[#f9f9fb]"
          >
            {/* Titre + bouton new */}
            <div className="px-3 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
              <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Conversations</span>
              <button
                onClick={createSession}
                className="w-6 h-6 rounded-md bg-[#0071e3] flex items-center justify-center hover:bg-[#0077ed] transition-colors"
                title="Nouvelle conversation"
              >
                <Plus className="w-3 h-3 text-white" />
              </button>
            </div>

            {/* Liste */}
            <div className="flex-1 overflow-y-auto px-1.5 pb-3 space-y-0.5">
              {sessions.length === 0 ? (
                <div className="p-5 text-center space-y-2">
                  <p className="text-xs text-[#86868b]">Aucune conversation</p>
                  <button onClick={createSession} className="text-xs text-[#0071e3] hover:underline">
                    Commencer →
                  </button>
                </div>
              ) : sessions.map(s => (
                <div
                  key={s.id}
                  className={`group relative rounded-lg cursor-pointer transition-all ${
                    activeId === s.id ? 'bg-white shadow-sm border border-[#e5e5e7]' : 'hover:bg-white/60'
                  }`}
                  onClick={() => openSession(s.id)}
                >
                  {renaming === s.id ? (
                    <div className="flex items-center gap-1 p-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus value={renameName}
                        onChange={e => setRenameName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmRename(s.id)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="flex-1 text-xs bg-white border border-[#0071e3] rounded-md px-2 py-1 outline-none"
                      />
                      <button onClick={() => confirmRename(s.id)} className="p-0.5 text-[#34c759]"><Check className="w-3 h-3" /></button>
                      <button onClick={() => setRenaming(null)} className="p-0.5 text-[#86868b]"><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <div className="p-2.5 pr-8">
                      <p className="text-xs font-medium text-[#1d1d1f] truncate">{s.name}</p>
                      {s.last_message && (
                        <p className="text-[10px] text-[#86868b] truncate mt-0.5">{s.last_message}</p>
                      )}
                      <p className="text-[10px] text-[#adadb8] mt-0.5">{fmtDate(s.updated_at)}</p>
                    </div>
                  )}

                  {renaming !== s.id && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === s.id ? null : s.id) }}
                        className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#e5e5e7]"
                      >
                        <MoreHorizontal className="w-3 h-3 text-[#86868b]" />
                      </button>
                      {menuOpen === s.id && (
                        <div
                          className="absolute right-0 top-6 bg-white border border-[#e5e5e7] rounded-xl shadow-lg py-1 z-50 min-w-[120px]"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setRenameName(s.name); setRenaming(s.id); setMenuOpen(null) }}
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1d1d1f] hover:bg-[#f5f5f7] flex items-center gap-2"
                          >
                            <Edit2 className="w-3 h-3" /> Renommer
                          </button>
                          <button
                            onClick={() => deleteSession(s.id)}
                            className="w-full text-left px-3 py-1.5 text-xs text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center gap-2"
                          >
                            <Trash2 className="w-3 h-3" /> Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ════════════════ ZONE PRINCIPALE ════════════════ */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e7] flex-shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-[#86868b] transition-colors flex-shrink-0"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            {offline ? (
              <div className="flex items-center gap-1.5">
                <WifiOff className="w-3.5 h-3.5 text-[#ff3b30]" />
                <span className="text-sm text-[#ff3b30]">Hors ligne</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <motion.span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[effectiveStatus] }}
                  animate={{ scale: effectiveStatus !== 'repos' ? [1, 1.35, 1] : 1 }}
                  transition={{ repeat: effectiveStatus !== 'repos' ? Infinity : 0, duration: 1 }}
                />
                <span className="text-sm truncate">
                  <span className="font-semibold text-[#1d1d1f]">
                    {activeSession?.name ?? 'NEO'}
                  </span>
                  <span className="text-[#86868b]"> · {STATUS_LABELS[effectiveStatus]}</span>
                </span>
              </div>
            )}
          </div>

          {/* Contrôles header */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setRobotEmotions(v => !v)}
              title="Réactions physiques du robot"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                robotEmotions
                  ? 'bg-[#34c759]/10 text-[#34c759] border-[#34c759]/20'
                  : 'bg-[#f5f5f7] text-[#86868b] border-[#e5e5e7] hover:border-[#d2d2d7]'
              }`}
            >
              <Cpu className="w-3 h-3" />
              <span className="hidden sm:inline">{robotEmotions ? 'Robot ON' : 'Robot OFF'}</span>
            </button>
            <button
              onClick={async () => { await fetch('/api/flask/toggle_continu', { method: 'POST' }) }}
              title="Mode écoute continue"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                modeContinue
                  ? 'bg-[#0071e3] text-white border-[#0071e3]'
                  : 'bg-[#f5f5f7] text-[#86868b] border-[#e5e5e7] hover:border-[#d2d2d7]'
              }`}
            >
              {modeContinue ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
              <span className="hidden sm:inline">{modeContinue ? 'Continu' : 'Manuel'}</span>
            </button>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!activeId ? (
            /* État vide — aucune session */
            <div className="h-full flex flex-col items-center justify-center gap-6 p-8 text-center">
              <div>
                <div className="w-16 h-16 rounded-3xl bg-[#f5f5f7] border border-[#e5e5e7] flex items-center justify-center mx-auto mb-4 text-3xl select-none">
                  ✦
                </div>
                <h2 className="text-xl font-semibold text-[#1d1d1f]">Parle à NEO</h2>
                <p className="text-sm text-[#86868b] mt-1 max-w-xs mx-auto">
                  Conversations illimitées, historique persistant, voix ou texte
                </p>
              </div>
              <button
                onClick={createSession}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#0071e3] text-white rounded-full text-sm font-medium hover:bg-[#0077ed] transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Nouvelle conversation
              </button>
              {/* Suggestions */}
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={async () => { await createSession(); }}
                    className="px-3 py-1.5 rounded-full border border-[#e5e5e7] text-xs text-[#86868b] hover:border-[#0071e3]/40 hover:text-[#0071e3] transition-colors bg-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : loadingSession ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-[#e5e5e7] border-t-[#0071e3] rounded-full animate-spin" />
            </div>
          ) : (
            <div className="px-5 py-5 space-y-5">
              {messages.length === 0 && !isThinking && !partial && (
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                  <p className="text-sm text-[#86868b]">Commence à écrire ou utilise le micro</p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-xs">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="px-3 py-1.5 rounded-full border border-[#e5e5e7] text-xs text-[#86868b] hover:border-[#0071e3]/40 hover:text-[#0071e3] transition-colors bg-white"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <AnimatePresence initial={false}>
                {messages.map(msg => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'aria' ? (
                      /* NEO — Perplexity style : gauche, texte proéminent */
                      <div className="max-w-[85%] space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-[#1d1d1f] flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[8px] font-bold">N</span>
                          </div>
                          <span className="text-[11px] font-semibold text-[#1d1d1f]">NEO</span>
                          <span className="text-[10px] text-[#adadb8]">{fmtTime(msg.ts)}</span>
                        </div>
                        <div className="ml-[28px] text-sm leading-relaxed text-[#1d1d1f] whitespace-pre-wrap">
                          {msg.text}
                        </div>
                      </div>
                    ) : (
                      /* Utilisateur — bulle droite */
                      <div className="max-w-[72%] space-y-1">
                        <div className="px-4 py-2.5 bg-[#0071e3] text-white rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.text}
                        </div>
                        <div className="flex justify-end">
                          <span className="text-[10px] text-[#adadb8]">{fmtTime(msg.ts)}</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Indicateur "réfléchit" */}
              <AnimatePresence>
                {isThinking && !partial && (
                  <motion.div
                    key="thinking"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-start"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-[#1d1d1f] flex items-center justify-center">
                          <span className="text-white text-[8px] font-bold">N</span>
                        </div>
                        <span className="text-[11px] font-semibold text-[#ff9500]">NEO ◎</span>
                      </div>
                      <div className="ml-[28px] flex items-center gap-1.5 py-1">
                        {[0, 1, 2].map(i => (
                          <motion.span
                            key={i}
                            className="w-2 h-2 rounded-full bg-[#ff9500]"
                            animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Streaming partiel (voix) */}
              <AnimatePresence>
                {partial && (
                  <motion.div
                    key="partial"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-start"
                  >
                    <div className="max-w-[85%] space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-[#1d1d1f] flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-[8px] font-bold">N</span>
                        </div>
                        <span className="text-[11px] font-semibold text-[#0071e3]">NEO ✦</span>
                      </div>
                      <div className="ml-[28px] text-sm leading-relaxed text-[#1d1d1f] whitespace-pre-wrap">
                        {partial}
                        <span className="inline-block w-[3px] h-[14px] bg-[#0071e3] rounded-sm ml-1 animate-pulse align-middle" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Zone de saisie ── */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-[#e5e5e7]">
          {micError && (
            <p className="text-xs text-[#ff3b30] text-center mb-2">{micError}</p>
          )}

          <div className={`flex items-end gap-2 bg-[#f5f5f7] rounded-2xl border border-[#e5e5e7] px-3 py-2 transition-opacity ${
            !activeId ? 'opacity-40 pointer-events-none' : ''
          }`}>
            {/* Bouton micro */}
            <div className="relative flex-shrink-0">
              {micState === 'recording' && (
                <span className="absolute inset-0 rounded-full bg-red-400 opacity-25 animate-ping scale-125" />
              )}
              <button
                onClick={toggleMic}
                disabled={micState === 'processing' || offline}
                title={micState === 'recording' ? 'Arrêter' : 'Parler à NEO'}
                className={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  micState === 'recording'
                    ? 'bg-[#ff3b30] scale-105'
                    : 'bg-white border border-[#e5e5e7] hover:border-[#0071e3]/30 hover:bg-[#f0f6ff]'
                }`}
              >
                {micState === 'processing' ? (
                  <div className="w-4 h-4 border-[1.5px] border-[#86868b]/30 border-t-[#86868b] rounded-full animate-spin" />
                ) : micState === 'recording' ? (
                  <Square className="w-3.5 h-3.5 text-white fill-white" />
                ) : (
                  <Mic className="w-4 h-4 text-[#86868b]" />
                )}
              </button>
            </div>

            {/* Champ texte */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 120) + 'px'
              }}
              placeholder={activeId ? 'Écris ton message à NEO…' : 'Sélectionne une conversation'}
              rows={1}
              disabled={sending || !activeId}
              className="flex-1 bg-transparent text-sm text-[#1d1d1f] placeholder-[#adadb8] resize-none outline-none leading-relaxed py-1.5 disabled:opacity-50"
              style={{ maxHeight: '120px', minHeight: '22px' }}
            />

            {/* Bouton envoyer */}
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending || !activeId}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0071e3] flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed hover:bg-[#0077ed] transition-all active:scale-95"
            >
              {sending ? (
                <div className="w-3.5 h-3.5 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>

          <p className="text-[10px] text-[#adadb8] text-center mt-1.5 select-none">
            Entrée pour envoyer · Maj+Entrée pour nouvelle ligne ·{' '}
            {micState === 'recording' ? '🔴 Enregistrement' : micState === 'processing' ? '⏳ Traitement…' : '🎤 Micro disponible'}
          </p>
        </div>
      </div>
    </div>
  )
}
