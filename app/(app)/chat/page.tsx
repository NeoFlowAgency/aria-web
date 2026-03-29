'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Check, X, MessageSquare, Bot, MoreHorizontal, Cpu } from 'lucide-react'

type SessionSummary = {
  id: string
  name: string
  created_at: number
  updated_at: number
  message_count: number
  last_message: string
}

type Message = {
  role: 'user' | 'aria'
  text: string
  ts: number
}

function formatDate(ts: number) {
  const d = new Date(ts * 1000)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000)    return 'À l\'instant'
  if (diff < 3_600_000) return `Il y a ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPage() {
  const [sessions, setSessions]           = useState<SessionSummary[]>([])
  const [activeId, setActiveId]           = useState<string | null>(null)
  const [messages, setMessages]           = useState<Message[]>([])
  const [input, setInput]                 = useState('')
  const [sending, setSending]             = useState(false)
  const [loadingMsgs, setLoadingMsgs]     = useState(false)
  const [robotEmotions, setRobotEmotions] = useState(true)
  const [sidebarOpen, setSidebarOpen]     = useState(true)
  const [renaming, setRenaming]           = useState<string | null>(null)
  const [renameName, setRenameName]       = useState('')
  const [menuOpen, setMenuOpen]           = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // ── Charger la liste des sessions ────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/flask/sessions')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch {}
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // ── Ouvrir une session ────────────────────────────────────
  const openSession = useCallback(async (sid: string) => {
    setLoadingMsgs(true)
    setMenuOpen(null)
    try {
      const res = await fetch(`/api/flask/sessions/${sid}`)
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages ?? [])
      setActiveId(sid)
      // Marquer comme session active (reçoit les messages vocaux)
      await fetch('/api/flask/sessions/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid }),
      })
    } catch {}
    finally {
      setLoadingMsgs(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [])

  // Auto-scroll en bas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // ── Créer une session ─────────────────────────────────────
  async function createSession() {
    try {
      const res = await fetch('/api/flask/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) return
      const session: SessionSummary = await res.json()
      setSessions(prev => [session, ...prev])
      await openSession(session.id)
    } catch {}
  }

  // ── Supprimer une session ─────────────────────────────────
  async function deleteSession(sid: string) {
    setMenuOpen(null)
    try {
      await fetch(`/api/flask/sessions/${sid}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== sid))
      if (activeId === sid) { setActiveId(null); setMessages([]) }
    } catch {}
  }

  // ── Renommer une session ──────────────────────────────────
  async function confirmRename(sid: string) {
    if (!renameName.trim()) { setRenaming(null); return }
    try {
      const res = await fetch(`/api/flask/sessions/${sid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameName.trim() }),
      })
      if (res.ok) {
        const updated: SessionSummary = await res.json()
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, name: updated.name } : s))
      }
    } catch {}
    setRenaming(null)
  }

  // ── Envoyer un message texte ──────────────────────────────
  async function sendMessage() {
    if (!input.trim() || !activeId || sending) return
    const text = input.trim()
    setInput('')
    // Reset hauteur textarea
    if (inputRef.current) { inputRef.current.style.height = 'auto' }
    setSending(true)

    const ts = Date.now() / 1000
    setMessages(prev => [...prev, { role: 'user', text, ts }])

    try {
      const res = await fetch(`/api/flask/sessions/${activeId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, robot_emotions: robotEmotions }),
        signal: AbortSignal.timeout(35_000),
      })
      const data = await res.json()
      if (data.reply) {
        const replyTs = data.ts ?? (Date.now() / 1000 + 1)
        setMessages(prev => [...prev, { role: 'aria', text: data.reply, ts: replyTs }])
        setSessions(prev =>
          prev.map(s => s.id === activeId
            ? { ...s, last_message: data.reply.slice(0, 80), updated_at: replyTs, message_count: s.message_count + 2 }
            : s
          ).sort((a, b) => b.updated_at - a.updated_at)
        )
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'aria', text: `⚠️ Erreur : ${data.error}`, ts: Date.now() / 1000 }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'aria', text: '⚠️ Impossible de contacter NEO.', ts: Date.now() / 1000 }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const activeSession = sessions.find(s => s.id === activeId)

  return (
    <div
      className="flex h-[calc(100vh-8rem)] -mx-4 overflow-hidden rounded-2xl border border-[#d2d2d7] bg-white"
      onClick={() => setMenuOpen(null)}
    >
      {/* ══════════════ SIDEBAR ══════════════ */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 256, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col border-r border-[#d2d2d7] overflow-hidden flex-shrink-0 bg-[#fafafa]"
          >
            {/* Header */}
            <div className="px-3 py-3 border-b border-[#d2d2d7] flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold text-[#1d1d1f] uppercase tracking-wider">Sessions</span>
              <button
                onClick={createSession}
                className="w-7 h-7 rounded-lg bg-[#0071e3] flex items-center justify-center hover:bg-[#0077ed] transition-colors"
                title="Nouvelle session"
              >
                <Plus className="w-3.5 h-3.5 text-white" />
              </button>
            </div>

            {/* Liste */}
            <div className="flex-1 overflow-y-auto py-1">
              {sessions.length === 0 ? (
                <div className="p-6 text-center text-[#86868b]">
                  <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Aucune session</p>
                  <p className="text-[10px] mt-1 opacity-60">Clique sur + pour commencer</p>
                </div>
              ) : sessions.map(session => (
                <div
                  key={session.id}
                  className={`group relative mx-1 my-0.5 rounded-xl transition-colors cursor-pointer ${
                    activeId === session.id ? 'bg-white shadow-sm border border-[#d2d2d7]' : 'hover:bg-white/70'
                  }`}
                  onClick={() => openSession(session.id)}
                >
                  {renaming === session.id ? (
                    <div className="flex items-center gap-1 p-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={renameName}
                        onChange={e => setRenameName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmRename(session.id)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="flex-1 text-xs bg-white border border-[#0071e3] rounded-lg px-2 py-1 outline-none"
                      />
                      <button onClick={() => confirmRename(session.id)} className="p-1 text-[#34c759]">
                        <Check className="w-3 h-3" />
                      </button>
                      <button onClick={() => setRenaming(null)} className="p-1 text-[#86868b]">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 pr-8">
                      <p className="text-xs font-medium text-[#1d1d1f] truncate">{session.name}</p>
                      {session.last_message && (
                        <p className="text-[10px] text-[#86868b] truncate mt-0.5">{session.last_message}</p>
                      )}
                      <p className="text-[10px] text-[#adadb8] mt-0.5">
                        {formatDate(session.updated_at)} · {session.message_count} msg
                      </p>
                    </div>
                  )}

                  {/* Bouton menu */}
                  {renaming !== session.id && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === session.id ? null : session.id) }}
                        className="w-6 h-6 rounded-md hover:bg-[#d2d2d7] flex items-center justify-center"
                      >
                        <MoreHorizontal className="w-3 h-3 text-[#86868b]" />
                      </button>

                      {menuOpen === session.id && (
                        <div
                          className="absolute right-0 top-7 bg-white border border-[#d2d2d7] rounded-xl shadow-lg py-1 z-50 min-w-[130px]"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setRenameName(session.name); setRenaming(session.id); setMenuOpen(null) }}
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1d1d1f] hover:bg-[#f5f5f7] flex items-center gap-2"
                          >
                            <Edit2 className="w-3 h-3" /> Renommer
                          </button>
                          <button
                            onClick={() => deleteSession(session.id)}
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

      {/* ══════════════ ZONE PRINCIPALE ══════════════ */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#d2d2d7] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-[#86868b] transition-colors flex-shrink-0"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-[#1d1d1f] truncate">
                {activeSession?.name ?? 'Chat avec NEO'}
              </h1>
              {activeSession && (
                <p className="text-[10px] text-[#86868b]">
                  {activeSession.message_count} messages · sauvegardé
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setRobotEmotions(!robotEmotions)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all border flex-shrink-0 ${
              robotEmotions
                ? 'bg-[#34c759]/10 text-[#34c759] border-[#34c759]/20'
                : 'bg-[#f5f5f7] text-[#86868b] border-[#d2d2d7]'
            }`}
            title="Activer/désactiver les réactions du robot"
          >
            <Cpu className="w-3 h-3" />
            <span className="hidden sm:inline">{robotEmotions ? 'Robot ON' : 'Robot OFF'}</span>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {!activeId ? (
            // État vide — aucune session sélectionnée
            <div className="h-full flex flex-col items-center justify-center gap-4 text-[#86868b]">
              <div className="w-14 h-14 rounded-2xl bg-[#f5f5f7] border border-[#d2d2d7] flex items-center justify-center">
                <Bot className="w-7 h-7 opacity-30" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-[#1d1d1f]">Sélectionne ou crée une session</p>
                <p className="text-xs mt-1 text-[#86868b]">Les conversations sont sauvegardées sans limite de messages</p>
              </div>
              <button
                onClick={createSession}
                className="flex items-center gap-2 px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nouvelle conversation
              </button>
            </div>
          ) : loadingMsgs ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-[#d2d2d7] border-t-[#0071e3] rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {messages.length === 0 && !sending && (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-[#86868b] text-sm select-none">
                  <p>Écris un message pour commencer !</p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <motion.div
                    key={`${msg.ts}-${i}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[75%] flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {msg.role === 'aria' && (
                        <span className="text-[10px] text-[#86868b] font-medium px-1">NEO</span>
                      )}
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-[#0071e3] text-white rounded-br-sm'
                          : 'bg-[#f5f5f7] text-[#1d1d1f] rounded-bl-sm'
                      }`}>
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-[#adadb8] px-1">{formatTime(msg.ts)}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Indicateur "NEO réfléchit" */}
              {sending && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-start"
                >
                  <div className="flex flex-col gap-1 items-start">
                    <span className="text-[10px] text-[#86868b] font-medium px-1">NEO</span>
                    <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-[#f5f5f7] flex items-center gap-1">
                      {[0, 1, 2].map(i => (
                        <motion.span
                          key={i}
                          className="w-2 h-2 rounded-full bg-[#86868b]"
                          animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
                          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Zone de saisie */}
        {activeId && (
          <div className="flex-shrink-0 p-3 border-t border-[#d2d2d7]">
            <div className="flex items-end gap-2 bg-[#f5f5f7] rounded-2xl px-3 py-2.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'
                  t.style.height = Math.min(t.scrollHeight, 128) + 'px'
                }}
                placeholder="Écris ton message… (Entrée pour envoyer)"
                rows={1}
                disabled={sending}
                className="flex-1 bg-transparent text-sm text-[#1d1d1f] placeholder-[#86868b] resize-none outline-none leading-relaxed"
                style={{ maxHeight: '128px', minHeight: '24px' }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="flex-shrink-0 w-8 h-8 rounded-xl bg-[#0071e3] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#0077ed] transition-colors"
              >
                {sending ? (
                  <div className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-[#adadb8] text-center mt-1.5">
              Entrée pour envoyer · Maj+Entrée pour nouvelle ligne · {robotEmotions ? '🤖 Robot réagit' : '🔇 Robot silencieux'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
