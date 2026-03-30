'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio, Smartphone, FileText, HelpCircle, CheckSquare,
  Send, Mic, MicOff, Plus, Trash2, Edit3,
  Check, X, ChevronDown, Wifi, WifiOff, Bot, Layers,
  DollarSign,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type MsgSource = 'text' | 'voice'
type MsgType   = 'rapport' | 'question' | 'approbation' | 'financier' | 'vocal' | 'user'

interface RawMsg {
  role: string; text: string; ts: number; source?: MsgSource
}

interface FlowMsg extends RawMsg {
  _type: MsgType
  _key: string
}

interface Session {
  id: string; name: string; created_at: number; updated_at: number
  message_count: number; last_message: string
}

// ── Projects ─────────────────────────────────────────────────────────────────

const PROJECTS = [
  { id: 'neoflow', label: 'Neoflow Agency', color: '#818CF8', icon: '🏢' },
  { id: 'bos',     label: 'NeoFlow BOS',    color: '#34D399', icon: '⚙️' },
  { id: 'horizon', label: 'Horizon Drone',  color: '#60A5FA', icon: '🚁' },
  { id: 'vie',     label: 'Vie Perso',      color: '#F472B6', icon: '🌿' },
  { id: 'global',  label: 'Général',        color: '#8B8BA0', icon: '💬' },
]

// ── Type detection ────────────────────────────────────────────────────────────

function detectType(msg: RawMsg): MsgType {
  if (msg.role === 'user') return 'user'
  if (msg.source === 'voice') return 'vocal'
  const t = msg.text
  if (t.includes('?')) return 'question'
  if (/(approuv|valid|confirm|autoris)/i.test(t)) return 'approbation'
  if (/(€|\$|budget|coût|facture|paiement|prix|tarif)/i.test(t)) return 'financier'
  return 'rapport'
}

function enrich(msgs: RawMsg[]): FlowMsg[] {
  return msgs.map((m, i) => ({ ...m, _type: detectType(m), _key: `${m.ts}-${i}` }))
}

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CFG: Record<MsgType, {
  label: string; color: string; bg: string; border: string
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
}> = {
  rapport:     { label: 'RAPPORT',     color: '#818CF8', bg: 'rgba(129,140,248,0.06)', border: 'rgba(129,140,248,0.18)', Icon: FileText },
  question:    { label: 'QUESTION',    color: '#FBBF24', bg: 'rgba(251,191,36,0.06)',  border: 'rgba(251,191,36,0.22)',  Icon: HelpCircle },
  approbation: { label: 'APPROBATION', color: '#F87171', bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.22)', Icon: CheckSquare },
  financier:   { label: 'FINANCIER',   color: '#34D399', bg: 'rgba(52,211,153,0.06)',  border: 'rgba(52,211,153,0.22)',  Icon: DollarSign },
  vocal:       { label: 'VOCAL',       color: '#A78BFA', bg: 'rgba(167,139,250,0.06)', border: 'rgba(167,139,250,0.22)', Icon: Radio },
  user:        { label: '',            color: '#5A5A78', bg: 'transparent',            border: 'rgba(255,255,255,0.06)', Icon: Smartphone },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Message card ─────────────────────────────────────────────────────────────

function MessageCard({
  msg, isLast, onQuickReply,
}: {
  msg: FlowMsg
  isLast: boolean
  onQuickReply: (text: string) => void
}) {
  const cfg = TYPE_CFG[msg._type]
  const isUser = msg._type === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`mb-3 ${isUser ? 'flex justify-end' : ''}`}
    >
      {isUser ? (
        <div
          className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm"
          style={{
            background: 'var(--neo-surface-2)',
            border: '1px solid var(--neo-border)',
            color: 'var(--neo-text)',
          }}
        >
          {msg.text}
          <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--neo-subtle)' }}>
            {msg.source === 'voice' && <span className="mr-1">🎤</span>}
            {formatTime(msg.ts)}
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
        >
          {/* Card header */}
          <div
            className="flex items-center gap-2 px-4 py-2"
            style={{ borderBottom: `1px solid ${cfg.border}` }}
          >
            <cfg.Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: cfg.color }} />
            <span
              className="text-[10px] font-bold tracking-widest uppercase"
              style={{ color: cfg.color }}
            >
              {cfg.label}
            </span>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--neo-subtle)' }}>
              {msg.source === 'voice' && <span className="mr-1.5 opacity-60">🤖</span>}
              {formatTime(msg.ts)}
            </span>
          </div>

          {/* Card body */}
          <div className="px-4 py-3">
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--neo-text)' }}>
              {msg.text}
            </p>

            {/* Quick replies — on last question/approbation only */}
            {isLast && (msg._type === 'question' || msg._type === 'approbation') && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => onQuickReply('Oui')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                  style={{ background: cfg.color + '18', border: `1px solid ${cfg.color}40`, color: cfg.color }}
                >
                  Oui
                </button>
                <button
                  onClick={() => onQuickReply('Non')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#F87171' }}
                >
                  Non
                </button>
                <button
                  onClick={() => onQuickReply('Plus tard')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
                >
                  Plus tard
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ── Partial indicator ─────────────────────────────────────────────────────────

function PartialCard({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3"
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.12)' }}
      >
        <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(129,140,248,0.12)' }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#818CF8' }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#818CF8' }}>NEO</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--neo-muted)' }}>
            {text}
            <span
              className="inline-block w-0.5 h-3.5 ml-0.5 align-middle"
              style={{ background: '#818CF8', animation: 'blink-cursor 1s step-end infinite' }}
            />
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FlowPage() {
  const [sessions,     setSessions]     = useState<Session[]>([])
  const [activeId,     setActiveId]     = useState<string | null>(null)
  const [messages,     setMessages]     = useState<FlowMsg[]>([])
  const [partial,      setPartial]      = useState('')
  const [neoStatus,    setNeoStatus]    = useState({ etat: 'repos', online: false })
  const [input,        setInput]        = useState('')
  const [sending,      setSending]      = useState(false)
  const [recording,    setRecording]    = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [project,      setProject]      = useState(PROJECTS[0])
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [editName,     setEditName]     = useState('')

  const bottomRef  = useRef<HTMLDivElement>(null)
  const textRef    = useRef<HTMLTextAreaElement>(null)
  const mediaRef   = useRef<MediaRecorder | null>(null)
  const chunksRef  = useRef<BlobPart[]>([])
  const prevLen    = useRef(0)

  // ── Fetch sessions ──────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/flask/sessions')
      if (!r.ok) return
      const d = await r.json()
      setSessions(d.sessions ?? [])
      setActiveId(prev => {
        if (prev) return prev
        return d.active ?? (d.sessions ?? [])[0]?.id ?? null
      })
    } catch {}
  }, [])

  // ── Poll status ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSessions()
    const poll = async () => {
      try {
        const r = await fetch('/api/flask/status')
        if (!r.ok) { setNeoStatus(p => ({ ...p, online: false })); return }
        const d = await r.json()
        setNeoStatus({ etat: d.etat ?? 'repos', online: true })
        if (d.partial !== undefined) setPartial(d.partial ?? '')
      } catch {
        setNeoStatus(p => ({ ...p, online: false }))
      }
    }
    poll()
    const id = setInterval(poll, 500)
    return () => clearInterval(id)
  }, [fetchSessions])

  // ── Poll messages ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeId) return
    const poll = async () => {
      try {
        const r = await fetch(`/api/flask/sessions/${activeId}`)
        if (!r.ok) return
        const d = await r.json()
        const raw: RawMsg[] = d.messages ?? []
        if (raw.length !== prevLen.current) {
          prevLen.current = raw.length
          setMessages(enrich(raw))
        }
      } catch {}
    }
    prevLen.current = 0
    poll()
    const id = setInterval(poll, 1500)
    return () => clearInterval(id)
  }, [activeId])

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, partial])

  // ── Session CRUD ────────────────────────────────────────────────────────────

  const createSession = async () => {
    try {
      const r = await fetch('/api/flask/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${project.icon} ${project.label}` }),
      })
      if (!r.ok) return
      const s = await r.json()
      await fetch('/api/flask/sessions/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      })
      setActiveId(s.id)
      setMessages([])
      prevLen.current = 0
      await fetchSessions()
      setShowSessions(false)
    } catch {}
  }

  const switchSession = async (id: string) => {
    try {
      await fetch('/api/flask/sessions/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setActiveId(id)
      setMessages([])
      prevLen.current = 0
      setShowSessions(false)
    } catch {}
  }

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/flask/sessions/${id}`, { method: 'DELETE' })
      if (activeId === id) setActiveId(null)
      await fetchSessions()
    } catch {}
  }

  const renameSession = async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return }
    try {
      await fetch(`/api/flask/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      await fetchSessions()
    } catch {}
    setEditingId(null)
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  const sendText = useCallback(async (text: string) => {
    if (!text.trim() || !activeId || sending) return
    setSending(true)
    setInput('')
    if (textRef.current) textRef.current.style.height = 'auto'
    try {
      await fetch(`/api/flask/sessions/${activeId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
    } catch {}
    setSending(false)
  }, [activeId, sending])

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendText(input) }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input) }
  }

  // ── Mic ─────────────────────────────────────────────────────────────────────

  const toggleMic = async () => {
    if (recording) { mediaRef.current?.stop(); setRecording(false); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          const r = await fetch('/api/flask/listen', {
            method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob,
          })
          const d = await r.json()
          if (d.transcription) sendText(d.transcription)
        } catch {}
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true)
    } catch {}
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const activeSession = sessions.find(s => s.id === activeId)

  const statusColor = ({
    repos: '#4A4A60', ecoute: '#818CF8', reflechit: '#FBBF24',
    parle: '#34D399', veille: '#2A2A3A',
  } as Record<string, string>)[neoStatus.etat] ?? '#4A4A60'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100dvh - var(--nav-h))' }}
    >

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0 relative"
        style={{ background: 'var(--neo-bg)', borderBottom: '1px solid var(--neo-border)' }}
      >
        {/* Project */}
        <button
          onClick={() => { setShowProjects(p => !p); setShowSessions(false) }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0"
          style={{ background: project.color + '14', border: `1px solid ${project.color}30`, color: project.color }}
        >
          <span>{project.icon}</span>
          <span className="hidden sm:inline">{project.label}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        {/* Session */}
        <button
          onClick={() => { setShowSessions(p => !p); setShowProjects(false) }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-all min-w-0 flex-1"
          style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
        >
          <Layers className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{activeSession?.name ?? 'Aucune conversation'}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60 ml-auto" />
        </button>

        {/* Status dot */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl flex-shrink-0"
          style={{ background: 'var(--neo-surface)', border: `1px solid ${statusColor}30` }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: neoStatus.online ? statusColor : '#2A2A3A',
              boxShadow: neoStatus.online ? `0 0 6px ${statusColor}80` : 'none',
            }}
          />
          {neoStatus.online
            ? <Wifi className="w-3 h-3" style={{ color: statusColor }} />
            : <WifiOff className="w-3 h-3" style={{ color: 'var(--neo-subtle)' }} />
          }
        </div>

        {/* ── Project dropdown ── */}
        <AnimatePresence>
          {showProjects && (
            <motion.div
              initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-3 mt-1 z-50 rounded-2xl overflow-hidden shadow-2xl w-52"
              style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border-2)', transformOrigin: 'top left' }}
            >
              {PROJECTS.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setProject(p); setShowProjects(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all text-left"
                  style={{
                    background: project.id === p.id ? p.color + '12' : 'transparent',
                    color: project.id === p.id ? p.color : 'var(--neo-muted)',
                  }}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                  {project.id === p.id && <Check className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Sessions dropdown ── */}
        <AnimatePresence>
          {showSessions && (
            <motion.div
              initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-3 mt-1 z-50 rounded-2xl overflow-hidden shadow-2xl w-64"
              style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border-2)', transformOrigin: 'top right' }}
            >
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--neo-border)' }}>
                <span className="text-xs font-semibold" style={{ color: 'var(--neo-muted)' }}>Conversations</span>
                <button
                  onClick={createSession}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-all"
                  style={{ background: 'var(--neo-accent-dim)', color: 'var(--neo-accent)', border: '1px solid rgba(129,140,248,0.2)' }}
                >
                  <Plus className="w-3 h-3" />
                  Nouvelle
                </button>
              </div>
              <div className="overflow-y-auto max-h-64 py-1">
                {sessions.length === 0 && (
                  <p className="px-4 py-4 text-xs text-center" style={{ color: 'var(--neo-subtle)' }}>
                    Aucune conversation
                  </p>
                )}
                {sessions.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer group"
                    style={{ background: activeId === s.id ? 'rgba(129,140,248,0.06)' : 'transparent' }}
                    onClick={() => editingId !== s.id && switchSession(s.id)}
                  >
                    {editingId === s.id ? (
                      <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') renameSession(s.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="flex-1 text-xs px-2 py-1 rounded-lg outline-none"
                          style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border-2)', color: 'var(--neo-text)' }}
                        />
                        <button onClick={() => renameSession(s.id)} style={{ color: '#34D399' }}>
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} style={{ color: 'var(--neo-subtle)' }}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: activeId === s.id ? 'var(--neo-accent)' : 'var(--neo-text)' }}>
                            {s.name}
                          </p>
                          <p className="text-[10px] truncate" style={{ color: 'var(--neo-subtle)' }}>
                            {s.message_count} messages
                          </p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name) }}
                            className="p-1 rounded"
                            style={{ color: 'var(--neo-muted)' }}
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={e => deleteSession(s.id, e)}
                            className="p-1 rounded"
                            style={{ color: 'var(--neo-red)' }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Feed ── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 min-h-0"
        onClick={() => { setShowSessions(false); setShowProjects(false) }}
      >
        {messages.length === 0 && !partial && (
          <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: project.color + '14', border: `1px solid ${project.color}30` }}
            >
              <Bot className="w-7 h-7" style={{ color: project.color }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--neo-muted)' }}>NEO est prêt</p>
              <p className="text-xs mt-1" style={{ color: 'var(--neo-subtle)' }}>
                {activeId ? 'Envoyez un message ou parlez au robot' : 'Créez une conversation pour commencer'}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageCard
            key={msg._key}
            msg={msg}
            isLast={i === messages.length - 1}
            onQuickReply={sendText}
          />
        ))}

        {partial && <PartialCard text={partial} />}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <form
        onSubmit={handleSubmit}
        className="flex-shrink-0 px-4 pb-4 pt-2"
        onClick={() => { setShowSessions(false); setShowProjects(false) }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl px-3 py-2.5"
          style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border-2)' }}
        >
          <button
            type="button"
            onClick={toggleMic}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
            style={{
              background: recording ? 'rgba(248,113,113,0.12)' : 'var(--neo-surface-2)',
              border: `1px solid ${recording ? 'rgba(248,113,113,0.3)' : 'var(--neo-border)'}`,
              color: recording ? '#F87171' : 'var(--neo-muted)',
            }}
          >
            {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <textarea
            ref={textRef}
            value={input}
            onChange={e => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={handleKeyDown}
            placeholder={activeId ? 'Écrire à NEO…' : 'Créez une conversation d\'abord…'}
            disabled={!activeId}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed disabled:opacity-40"
            style={{ color: 'var(--neo-text)', minHeight: '20px', maxHeight: '120px' }}
          />

          <button
            type="submit"
            disabled={!input.trim() || sending || !activeId}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))', color: '#fff' }}
          >
            {sending ? (
              <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {!activeId && (
          <p className="text-center text-[11px] mt-2" style={{ color: 'var(--neo-subtle)' }}>
            <button type="button" onClick={createSession} className="underline" style={{ color: 'var(--neo-accent)' }}>
              Créer une conversation
            </button>
            {' '}pour commencer
          </p>
        )}
      </form>
    </div>
  )
}
