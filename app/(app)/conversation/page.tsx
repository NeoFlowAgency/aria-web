'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Edit2, Check, X, MoreHorizontal,
  Mic, MicOff, Square, WifiOff, PanelLeft, Send,
  Smartphone, Radio,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────
type Session   = { id: string; name: string; created_at: number; updated_at: number; message_count: number; last_message: string }
type Message   = { id: string; role: 'user' | 'aria'; text: string; ts: number; source?: 'text' | 'voice' }
type ARIAStatus = 'repos' | 'ecoute' | 'reflechit' | 'parle'
type MicState  = 'idle' | 'recording' | 'processing'

const STATUS_COLOR: Record<ARIAStatus, string> = {
  repos: '#4A4A60', ecoute: '#818CF8', reflechit: '#FBBF24', parle: '#34D399',
}
const STATUS_LABEL: Record<ARIAStatus, string> = {
  repos: 'En veille', ecoute: 'Écoute…', reflechit: 'Réfléchit…', parle: 'Parle…',
}
const SUGGESTIONS = [
  'Comment tu vas ?', 'Qu\'est-ce que je dois faire aujourd\'hui ?',
  'Fais-moi danser !', 'Résume ma semaine.',
]

function fmtDate(ts: number) {
  const d = new Date(ts * 1000), diff = Date.now() - d.getTime()
  if (diff < 60_000)     return 'À l\'instant'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Composant ──────────────────────────────────────────────────────────────
export default function ConversationPage() {
  // Sessions
  const [sessions,      setSessions]      = useState<Session[]>([])
  const [activeId,      setActiveId]      = useState<string | null>(null)
  const [messages,      setMessages]      = useState<Message[]>([])
  const [sidebarOpen,   setSidebarOpen]   = useState(true)
  const [renaming,      setRenaming]      = useState<string | null>(null)
  const [renameName,    setRenameName]    = useState('')
  const [menuOpen,      setMenuOpen]      = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)

  // ARIA
  const [ariaStatus,    setAriaStatus]    = useState<ARIAStatus>('repos')
  const [partial,       setPartial]       = useState('')
  const [offline,       setOffline]       = useState(false)
  const [modeContinue,  setModeContinue]  = useState(false)

  // Input
  const [input,         setInput]         = useState('')
  const [sending,       setSending]       = useState(false)
  const [micState,      setMicState]      = useState<MicState>('idle')
  const [micError,      setMicError]      = useState<string | null>(null)
  const [robotEmotions, setRobotEmotions] = useState(true)

  // Refs
  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const msgCountRef  = useRef(0)
  const activeIdRef  = useRef<string | null>(null)

  const effectiveStatus: ARIAStatus = partial ? 'parle' : ariaStatus
  activeIdRef.current = activeId

  // ── Sessions ──────────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/flask/sessions')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch {}
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // ── Polling ARIA status ───────────────────────────────────────────────────
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

  // ── Polling messages de la session active ────────────────────────────────
  useEffect(() => {
    if (!activeId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/flask/sessions/${activeId}`)
        if (!res.ok) return
        const data = await res.json()
        const raw: Array<{ role: string; text: string; ts: number; source?: string }> = data.messages ?? []
        if (raw.length !== msgCountRef.current) {
          msgCountRef.current = raw.length
          setMessages(raw.map((m, i) => ({
            id: `${m.ts}-${i}`, role: m.role as 'user' | 'aria',
            text: m.text, ts: m.ts, source: m.source as 'text' | 'voice' | undefined,
          })))
        }
      } catch {}
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => clearInterval(id)
  }, [activeId])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, partial, sending])

  // ── Ouvrir session ────────────────────────────────────────────────────────
  const openSession = useCallback(async (sid: string) => {
    setLoadingSession(true)
    setMenuOpen(null)
    setMessages([])
    msgCountRef.current = 0
    try {
      const res = await fetch(`/api/flask/sessions/${sid}`)
      if (!res.ok) return
      const data = await res.json()
      const raw: Array<{ role: string; text: string; ts: number; source?: string }> = data.messages ?? []
      msgCountRef.current = raw.length
      setMessages(raw.map((m, i) => ({ id: `${m.ts}-${i}`, role: m.role as 'user' | 'aria', text: m.text, ts: m.ts, source: m.source as 'text' | 'voice' | undefined })))
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

  // ── Créer session ─────────────────────────────────────────────────────────
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

  // ── Supprimer session ─────────────────────────────────────────────────────
  async function deleteSession(sid: string) {
    setMenuOpen(null)
    try {
      await fetch(`/api/flask/sessions/${sid}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== sid))
      if (activeId === sid) { setActiveId(null); setMessages([]) }
    } catch {}
  }

  // ── Renommer session ──────────────────────────────────────────────────────
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

  // ── Envoyer message texte ─────────────────────────────────────────────────
  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || !activeId || sending) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setSending(true)

    const ts = Date.now() / 1000
    setMessages(prev => [...prev, { id: `${ts}-u`, role: 'user', text, ts, source: 'text' }])
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

  // ── Microphone ────────────────────────────────────────────────────────────
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
          await fetch('/api/listen', { method: 'POST', body: blob, headers: { 'Content-Type': ft }, signal: AbortSignal.timeout(35_000) })
        } catch (err) {
          setMicError(`Erreur : ${err instanceof Error ? err.message : String(err)}`)
        } finally { setMicState('idle') }
      }
      recorderRef.current = recorder
      recorder.start(200)
      setMicState('recording')
    } catch { setMicError('Micro inaccessible — autorisez l\'accès dans le navigateur.') }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const activeSession = sessions.find(s => s.id === activeId)
  const isThinking    = sending || (!partial && effectiveStatus === 'reflechit')

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-1 min-h-0 overflow-hidden"
      style={{ height: 'calc(100dvh - var(--nav-h-desktop) - 0px)' }}
      onClick={() => setMenuOpen(null)}
    >
      {/* ════ SIDEBAR ════ */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 224, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col flex-shrink-0 overflow-hidden"
            style={{ borderRight: '1px solid var(--neo-border)', background: 'var(--neo-surface)' }}
          >
            {/* Header sidebar */}
            <div className="px-3 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
              <span
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--neo-subtle)' }}
              >
                Conversations
              </span>
              <button
                onClick={createSession}
                className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors"
                style={{ background: 'var(--neo-accent-dim)', color: 'var(--neo-accent)' }}
                title="Nouvelle conversation"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Liste */}
            <div className="flex-1 overflow-y-auto px-1.5 pb-3 space-y-px">
              {sessions.length === 0 ? (
                <div className="p-5 text-center space-y-2">
                  <p className="text-xs" style={{ color: 'var(--neo-subtle)' }}>Aucune conversation</p>
                  <button
                    onClick={createSession}
                    className="text-xs transition-colors hover:underline"
                    style={{ color: 'var(--neo-accent)' }}
                  >
                    Commencer →
                  </button>
                </div>
              ) : sessions.map(s => (
                <div
                  key={s.id}
                  className="group relative rounded-xl cursor-pointer transition-all"
                  style={{
                    background: activeId === s.id ? 'var(--neo-surface-2)' : 'transparent',
                    border: `1px solid ${activeId === s.id ? 'var(--neo-border-2)' : 'transparent'}`,
                  }}
                  onClick={() => openSession(s.id)}
                  onMouseEnter={e => {
                    if (activeId !== s.id)
                      (e.currentTarget as HTMLDivElement).style.background = 'var(--neo-surface-2)'
                  }}
                  onMouseLeave={e => {
                    if (activeId !== s.id)
                      (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  }}
                >
                  {renaming === s.id ? (
                    <div className="flex items-center gap-1 p-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus value={renameName}
                        onChange={e => setRenameName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') confirmRename(s.id); if (e.key === 'Escape') setRenaming(null) }}
                        className="flex-1 text-xs px-2 py-1 outline-none rounded-lg"
                        style={{ background: 'var(--neo-surface-3)', border: '1px solid var(--neo-accent)', color: 'var(--neo-text)' }}
                      />
                      <button onClick={() => confirmRename(s.id)} className="p-0.5" style={{ color: 'var(--neo-green)' }}><Check className="w-3 h-3" /></button>
                      <button onClick={() => setRenaming(null)} className="p-0.5" style={{ color: 'var(--neo-muted)' }}><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <div className="p-2.5 pr-8">
                      <p className="text-xs font-medium truncate" style={{ color: activeId === s.id ? 'var(--neo-text)' : 'var(--neo-muted)' }}>{s.name}</p>
                      {s.last_message && (
                        <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--neo-subtle)' }}>{s.last_message}</p>
                      )}
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--neo-subtle)' }}>{fmtDate(s.updated_at)}</p>
                    </div>
                  )}

                  {renaming !== s.id && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === s.id ? null : s.id) }}
                        className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                        style={{ color: 'var(--neo-subtle)' }}
                      >
                        <MoreHorizontal className="w-3 h-3" />
                      </button>
                      {menuOpen === s.id && (
                        <div
                          className="absolute right-0 top-6 rounded-xl shadow-2xl py-1 z-50 min-w-[120px]"
                          style={{ background: 'var(--neo-surface-3)', border: '1px solid var(--neo-border-2)' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setRenameName(s.name); setRenaming(s.id); setMenuOpen(null) }}
                            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                            style={{ color: 'var(--neo-muted)' }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--neo-text)'}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--neo-muted)'}
                          >
                            <Edit2 className="w-3 h-3" /> Renommer
                          </button>
                          <button
                            onClick={() => deleteSession(s.id)}
                            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                            style={{ color: 'var(--neo-red)' }}
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

      {/* ════ ZONE PRINCIPALE ════ */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0 gap-3"
          style={{ borderBottom: '1px solid var(--neo-border)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Toggle sidebar */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="p-1.5 rounded-lg transition-colors flex-shrink-0"
              style={{ color: 'var(--neo-muted)' }}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            {offline ? (
              <div className="flex items-center gap-1.5">
                <WifiOff className="w-3.5 h-3.5" style={{ color: 'var(--neo-red)' }} />
                <span className="text-sm" style={{ color: 'var(--neo-red)' }}>Hors ligne</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <motion.span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: STATUS_COLOR[effectiveStatus] }}
                  animate={{ scale: effectiveStatus !== 'repos' ? [1, 1.4, 1] : 1 }}
                  transition={{ repeat: effectiveStatus !== 'repos' ? Infinity : 0, duration: 1.2 }}
                />
                <span className="text-sm truncate">
                  <span className="font-semibold" style={{ color: 'var(--neo-text)' }}>
                    {activeSession?.name ?? 'NEO'}
                  </span>
                  <span style={{ color: 'var(--neo-muted)' }}> · {STATUS_LABEL[effectiveStatus]}</span>
                </span>
              </div>
            )}
          </div>

          {/* Contrôles */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Robot emotions toggle */}
            <button
              onClick={() => setRobotEmotions(v => !v)}
              title="Réactions physiques du robot"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: robotEmotions ? 'rgba(52,211,153,0.1)' : 'var(--neo-surface)',
                color:      robotEmotions ? 'var(--neo-green)' : 'var(--neo-muted)',
                border:     `1px solid ${robotEmotions ? 'rgba(52,211,153,0.2)' : 'var(--neo-border)'}`,
              }}
            >
              <Radio className="w-3 h-3" />
              <span className="hidden sm:inline">Robot</span>
            </button>

            {/* Mode continu toggle */}
            <button
              onClick={async () => { await fetch('/api/flask/toggle_continu', { method: 'POST' }) }}
              title="Mode écoute continue"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: modeContinue ? 'var(--neo-accent-dim)' : 'var(--neo-surface)',
                color:      modeContinue ? 'var(--neo-accent)' : 'var(--neo-muted)',
                border:     `1px solid ${modeContinue ? 'rgba(129,140,248,0.25)' : 'var(--neo-border)'}`,
              }}
            >
              {modeContinue ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
              <span className="hidden sm:inline">{modeContinue ? 'Continu' : 'Manuel'}</span>
            </button>
          </div>
        </div>

        {/* Zone messages */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!activeId ? (
            /* ── État vide ── */
            <div className="h-full flex flex-col items-center justify-center gap-6 p-8 text-center">
              <div>
                <div
                  className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4 text-3xl select-none"
                  style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)' }}
                >
                  ✦
                </div>
                <h2 className="text-xl font-semibold" style={{ color: 'var(--neo-text)' }}>
                  Parle à NEO
                </h2>
                <p className="text-sm mt-1 max-w-xs mx-auto" style={{ color: 'var(--neo-muted)' }}>
                  Même conversation — voix depuis le robot ou texte depuis l'appli
                </p>
              </div>
              <button
                onClick={createSession}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all"
                style={{ background: 'var(--neo-accent-dim)', color: 'var(--neo-accent)', border: '1px solid rgba(129,140,248,0.25)' }}
              >
                <Plus className="w-4 h-4" />
                Nouvelle conversation
              </button>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={createSession}
                    className="px-3 py-1.5 rounded-full text-xs transition-all"
                    style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(129,140,248,0.3)'
                      ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--neo-accent)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--neo-border)'
                      ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--neo-muted)'
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : loadingSession ? (
            <div className="h-full flex items-center justify-center">
              <div
                className="w-5 h-5 border-2 rounded-full animate-spin"
                style={{ borderColor: 'var(--neo-border-2)', borderTopColor: 'var(--neo-accent)' }}
              />
            </div>
          ) : (
            <div className="px-5 py-6 space-y-6">
              {messages.length === 0 && !isThinking && !partial && (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--neo-subtle)' }}>
                    Commence à écrire ou utilise le micro
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-xs">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="px-3 py-1.5 rounded-full text-xs transition-all"
                        style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(129,140,248,0.3)'
                          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--neo-accent)'
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--neo-border)'
                          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--neo-muted)'
                        }}
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
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'aria' ? (
                      /* NEO message — left aligned, clean text */
                      <div className="max-w-[86%] space-y-1.5">
                        <div className="flex items-center gap-2">
                          {/* NEO avatar */}
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))' }}
                          >
                            <span className="text-white text-[7px] font-bold">N</span>
                          </div>
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--neo-text)' }}>NEO</span>
                          {/* Channel badge */}
                          {msg.source === 'voice' && (
                            <span
                              className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}
                              title="Depuis le robot"
                            >
                              <Radio className="w-2.5 h-2.5" />
                              robot
                            </span>
                          )}
                          <span className="text-[10px]" style={{ color: 'var(--neo-subtle)' }}>{fmtTime(msg.ts)}</span>
                        </div>
                        <div
                          className="ml-7 text-sm leading-relaxed whitespace-pre-wrap"
                          style={{ color: 'var(--neo-text)' }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ) : (
                      /* User message — right bubble */
                      <div className="max-w-[72%] space-y-1">
                        <div
                          className="px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap"
                          style={{ background: 'var(--neo-accent-dim)', color: 'var(--neo-text)', border: '1px solid rgba(129,140,248,0.2)' }}
                        >
                          {msg.text}
                        </div>
                        <div className="flex justify-end items-center gap-1.5">
                          {msg.source === 'voice' && (
                            <span className="text-[9px]" style={{ color: 'var(--neo-subtle)' }}>
                              <Radio className="w-2.5 h-2.5 inline" />
                            </span>
                          )}
                          {msg.source === 'text' && (
                            <Smartphone className="w-2.5 h-2.5" style={{ color: 'var(--neo-subtle)' }} />
                          )}
                          <span className="text-[10px]" style={{ color: 'var(--neo-subtle)' }}>{fmtTime(msg.ts)}</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Thinking indicator */}
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
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))' }}
                        >
                          <span className="text-white text-[7px] font-bold">N</span>
                        </div>
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--neo-orange)' }}>NEO ◎</span>
                      </div>
                      <div className="ml-7 flex items-center gap-1.5 py-1">
                        {[0, 1, 2].map(i => (
                          <motion.span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: 'var(--neo-orange)' }}
                            animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Streaming partiel (voix robot) */}
              <AnimatePresence>
                {partial && (
                  <motion.div
                    key="partial"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-start"
                  >
                    <div className="max-w-[86%] space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))' }}
                        >
                          <span className="text-white text-[7px] font-bold">N</span>
                        </div>
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--neo-green)' }}>NEO ✦</span>
                        <span
                          className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}
                        >
                          <Radio className="w-2.5 h-2.5" />
                          robot
                        </span>
                      </div>
                      <div
                        className="ml-7 text-sm leading-relaxed whitespace-pre-wrap"
                        style={{ color: 'var(--neo-text)' }}
                      >
                        {partial}
                        <span
                          className="inline-block w-[2px] h-[13px] ml-1 rounded-sm align-middle animate-cursor"
                          style={{ background: 'var(--neo-accent)' }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Zone de saisie */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ borderTop: '1px solid var(--neo-border)' }}
        >
          {micError && (
            <p className="text-xs text-center mb-2" style={{ color: 'var(--neo-red)' }}>{micError}</p>
          )}

          <div
            className={`flex items-end gap-2 rounded-2xl px-3 py-2 transition-opacity ${!activeId ? 'opacity-40 pointer-events-none' : ''}`}
            style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border-2)' }}
          >
            {/* Mic */}
            <div className="relative flex-shrink-0">
              {micState === 'recording' && (
                <span className="absolute inset-0 rounded-full bg-red-400 opacity-20 animate-ping scale-125" />
              )}
              <button
                onClick={toggleMic}
                disabled={micState === 'processing' || offline}
                title={micState === 'recording' ? 'Arrêter' : 'Parler à NEO'}
                className="relative z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: micState === 'recording'
                    ? 'rgba(248,113,113,0.15)'
                    : 'var(--neo-surface-2)',
                  border: `1px solid ${micState === 'recording' ? 'rgba(248,113,113,0.3)' : 'var(--neo-border)'}`,
                  color: micState === 'recording' ? 'var(--neo-red)' : 'var(--neo-muted)',
                }}
              >
                {micState === 'processing' ? (
                  <div
                    className="w-4 h-4 border-[1.5px] rounded-full animate-spin"
                    style={{ borderColor: 'var(--neo-border-2)', borderTopColor: 'var(--neo-muted)' }}
                  />
                ) : micState === 'recording' ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Textarea */}
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
              placeholder={activeId ? 'Envoyer un message à NEO…' : 'Sélectionne une conversation'}
              rows={1}
              disabled={sending || !activeId}
              className="flex-1 bg-transparent text-sm resize-none outline-none leading-relaxed py-1.5 disabled:opacity-50"
              style={{ color: 'var(--neo-text)', maxHeight: '120px', minHeight: '22px' }}
            />

            {/* Send */}
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending || !activeId}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
              style={{ background: 'var(--neo-accent-dim)', color: 'var(--neo-accent)', border: '1px solid rgba(129,140,248,0.25)' }}
            >
              {sending ? (
                <div
                  className="w-3.5 h-3.5 border-[1.5px] rounded-full animate-spin"
                  style={{ borderColor: 'rgba(129,140,248,0.25)', borderTopColor: 'var(--neo-accent)' }}
                />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>

          <p className="text-[10px] text-center mt-1.5 select-none" style={{ color: 'var(--neo-subtle)' }}>
            Entrée pour envoyer · Maj+Entrée pour nouvelle ligne ·{' '}
            {micState === 'recording' ? '🔴 Enregistrement' : micState === 'processing' ? '⏳ Traitement…' : '🎤 Micro dispo'}
          </p>
        </div>
      </div>
    </div>
  )
}
