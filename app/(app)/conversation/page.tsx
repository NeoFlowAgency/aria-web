'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Mic, MicOff, Plus, Check, X, ChevronDown, ChevronUp,
  Wifi, WifiOff, Edit3, Trash2, Target, CalendarDays,
  FileText, HelpCircle, CheckSquare, DollarSign, Radio,
  Smartphone, Bot, Users, Zap,
} from 'lucide-react'

// ══════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════

interface Task  { id: string; text: string; done: boolean; created_at: number }
interface Plan  {
  monthly: { period: string; objectives: string[] }
  weekly:  { period: string; focus: string[]; tasks: { user: Task[]; neo: Task[] } }
  daily:   { date: string;   tasks: { user: Task[]; neo: Task[] } }
  updated_at: number
}

type MsgSource = 'text' | 'voice'
type MsgType   = 'rapport' | 'question' | 'approbation' | 'financier' | 'vocal' | 'user'

interface RawMsg  { role: string; text: string; ts: number; source?: MsgSource }
interface FlowMsg extends RawMsg { _type: MsgType; _key: string }

interface Session {
  id: string; name: string; created_at: number; updated_at: number
  message_count: number; last_message: string
}

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function detectType(m: RawMsg): MsgType {
  if (m.role === 'user') return 'user'
  if (m.source === 'voice') return 'vocal'
  if (m.text.includes('?')) return 'question'
  if (/(approuv|valid|confirm|autoris)/i.test(m.text)) return 'approbation'
  if (/(€|\$|budget|coût|facture|paiement|prix)/i.test(m.text)) return 'financier'
  return 'rapport'
}

function enrich(msgs: RawMsg[]): FlowMsg[] {
  return msgs.map((m, i) => ({ ...m, _type: detectType(m), _key: `${m.ts}-${i}` }))
}

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function todayLabel() {
  return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ══════════════════════════════════════════════════════════════
// Task Item
// ══════════════════════════════════════════════════════════════

function TaskItem({
  task, accentColor, onToggle, onDelete,
}: {
  task: Task; accentColor: string
  onToggle: (id: string, done: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex items-start gap-2 group py-1">
      <button
        onClick={() => onToggle(task.id, !task.done)}
        className="mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-all"
        style={{
          background: task.done ? accentColor + '20' : 'transparent',
          border: `1.5px solid ${task.done ? accentColor : 'var(--neo-subtle)'}`,
        }}
      >
        {task.done && <Check className="w-2.5 h-2.5" style={{ color: accentColor }} />}
      </button>
      <span
        className="text-xs flex-1 leading-relaxed"
        style={{
          color: task.done ? 'var(--neo-subtle)' : 'var(--neo-text)',
          textDecoration: task.done ? 'line-through' : 'none',
        }}
      >
        {task.text}
      </span>
      <button
        onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        style={{ color: 'var(--neo-subtle)' }}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Add Task Input
// ══════════════════════════════════════════════════════════════

function AddTaskInput({ onAdd, color }: { onAdd: (text: string) => void; color: string }) {
  const [open, setOpen] = useState(false)
  const [val,  setVal]  = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (val.trim()) { onAdd(val.trim()); setVal(''); setOpen(false) }
  }

  useEffect(() => { if (open) ref.current?.focus() }, [open])

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="flex items-center gap-1 text-[10px] mt-1 transition-all opacity-40 hover:opacity-100"
      style={{ color }}
    >
      <Plus className="w-3 h-3" /> Ajouter
    </button>
  )

  return (
    <div className="flex items-center gap-1 mt-1">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setOpen(false); setVal('') }
        }}
        placeholder="Nouvelle tâche…"
        className="flex-1 text-xs px-2 py-1 rounded-lg outline-none"
        style={{ background: 'var(--neo-surface-2)', border: `1px solid ${color}40`, color: 'var(--neo-text)' }}
      />
      <button onClick={submit} style={{ color }}><Check className="w-3.5 h-3.5" /></button>
      <button onClick={() => { setOpen(false); setVal('') }} style={{ color: 'var(--neo-subtle)' }}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Message Card
// ══════════════════════════════════════════════════════════════

function MessageCard({
  msg, isLast, onQuickReply,
}: {
  msg: FlowMsg; isLast: boolean; onQuickReply: (t: string) => void
}) {
  const cfg    = TYPE_CFG[msg._type]
  const isUser = msg._type === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`mb-2.5 ${isUser ? 'flex justify-end' : ''}`}
    >
      {isUser ? (
        <div
          className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm"
          style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border)', color: 'var(--neo-text)' }}
        >
          {msg.text}
          <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--neo-subtle)' }}>
            {msg.source === 'voice' && <span className="mr-1">🎤</span>}
            {fmt(msg.ts)}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
          <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: `1px solid ${cfg.border}` }}>
            <cfg.Icon className="w-3 h-3 flex-shrink-0" style={{ color: cfg.color }} />
            <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--neo-subtle)' }}>
              {msg.source === 'voice' && <span className="mr-1 opacity-60">🤖</span>}
              {fmt(msg.ts)}
            </span>
          </div>
          <div className="px-3.5 py-2.5">
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--neo-text)' }}>
              {msg.text}
            </p>
            {isLast && (msg._type === 'question' || msg._type === 'approbation') && (
              <div className="flex gap-2 mt-2.5 flex-wrap">
                {['Oui', 'Non', 'Plus tard'].map((label, i) => (
                  <button
                    key={label}
                    onClick={() => onQuickReply(label)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                    style={i === 0
                      ? { background: cfg.color + '18', border: `1px solid ${cfg.color}40`, color: cfg.color }
                      : i === 1
                      ? { background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#F87171' }
                      : { background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function PartialCard({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-2.5">
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.12)' }}>
        <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: '1px solid rgba(129,140,248,0.12)' }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#818CF8' }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#818CF8' }}>NEO</span>
        </div>
        <div className="px-3.5 py-2.5">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--neo-muted)' }}>
            {text}
            <span className="inline-block w-0.5 h-3.5 ml-0.5 align-middle" style={{ background: '#818CF8', animation: 'blink-cursor 1s step-end infinite' }} />
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ══════════════════════════════════════════════════════════════
// Workspace Page
// ══════════════════════════════════════════════════════════════

export default function WorkspacePage() {
  // ── Plan ──────────────────────────────────────────────────────
  const [plan,        setPlan]        = useState<Plan | null>(null)
  const [planOpen,    setPlanOpen]    = useState(true)
  const [editMonthly, setEditMonthly] = useState(false)
  const [newObjective,setNewObjective]= useState('')

  // ── Sessions / messages ───────────────────────────────────────
  const [sessions,    setSessions]    = useState<Session[]>([])
  const [activeId,    setActiveId]    = useState<string | null>(null)
  const [messages,    setMessages]    = useState<FlowMsg[]>([])
  const [partial,     setPartial]     = useState('')
  const [showSess,    setShowSess]    = useState(false)

  // ── Status ────────────────────────────────────────────────────
  const [neo,         setNeo]         = useState({ etat: 'repos', online: false })

  // ── Input ─────────────────────────────────────────────────────
  const [input,    setInput]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [recording,setRecording]= useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef   = useRef<HTMLTextAreaElement>(null)
  const mediaRef  = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const prevLen   = useRef(0)

  // ── Status color ─────────────────────────────────────────────
  const statusColor = ({
    repos: '#4A4A60', ecoute: '#818CF8', reflechit: '#FBBF24',
    parle: '#34D399', veille: '#2A2A3A',
  } as Record<string, string>)[neo.etat] ?? '#4A4A60'

  // ── Fetch plan ────────────────────────────────────────────────
  const fetchPlan = useCallback(async () => {
    try {
      const r = await fetch('/api/flask/plan')
      if (r.ok) setPlan(await r.json())
    } catch {}
  }, [])

  // ── Fetch sessions ────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/flask/sessions')
      if (!r.ok) return
      const d = await r.json()
      setSessions(d.sessions ?? [])
      setActiveId(prev => prev ?? d.active ?? (d.sessions ?? [])[0]?.id ?? null)
    } catch {}
  }, [])

  // ── Poll status & plan ────────────────────────────────────────
  useEffect(() => {
    fetchPlan()
    fetchSessions()
    const poll = async () => {
      try {
        const r = await fetch('/api/flask/status')
        if (!r.ok) { setNeo(p => ({ ...p, online: false })); return }
        const d = await r.json()
        setNeo({ etat: d.etat ?? 'repos', online: true })
        if (d.partial !== undefined) setPartial(d.partial ?? '')
      } catch { setNeo(p => ({ ...p, online: false })) }
    }
    poll()
    const id = setInterval(poll, 500)
    return () => clearInterval(id)
  }, [fetchPlan, fetchSessions])

  // ── Poll messages ─────────────────────────────────────────────
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

  // ── Auto scroll ───────────────────────────────────────────────
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, partial])

  // ── Plan mutations ────────────────────────────────────────────
  const patchPlan = async (body: object) => {
    try {
      const r = await fetch('/api/flask/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) setPlan(await r.json())
    } catch {}
  }

  const addObjective = async () => {
    if (!newObjective.trim() || !plan) return
    const updated = [...(plan.monthly.objectives ?? []), newObjective.trim()]
    await patchPlan({ monthly: { objectives: updated } })
    setNewObjective('')
    setEditMonthly(false)
  }

  const removeObjective = async (idx: number) => {
    if (!plan) return
    const updated = plan.monthly.objectives.filter((_, i) => i !== idx)
    await patchPlan({ monthly: { objectives: updated } })
  }

  const addTask = async (scope: 'daily' | 'weekly', assignee: 'user' | 'neo', text: string) => {
    try {
      const r = await fetch('/api/flask/plan/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, assignee, text }),
      })
      if (r.ok) fetchPlan()
    } catch {}
  }

  const toggleTask = async (id: string, done: boolean) => {
    try {
      await fetch(`/api/flask/plan/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      })
      fetchPlan()
    } catch {}
  }

  const deleteTask = async (id: string) => {
    try {
      await fetch(`/api/flask/plan/tasks/${id}`, { method: 'DELETE' })
      fetchPlan()
    } catch {}
  }

  // ── Sessions CRUD ─────────────────────────────────────────────
  const createSession = async (name?: string) => {
    try {
      const r = await fetch('/api/flask/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name ?? `Échange ${new Date().toLocaleDateString('fr-FR')}` }),
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
      setShowSess(false)
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
      setShowSess(false)
    } catch {}
  }

  const startMeeting = () => createSession(`🗓 Réunion — ${todayLabel()}`)

  // ── Send ──────────────────────────────────────────────────────
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

  // ── Mic ───────────────────────────────────────────────────────
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
      mr.start(); mediaRef.current = mr; setRecording(true)
    } catch {}
  }

  const activeSession = sessions.find(s => s.id === activeId)
  const dailyTasks = plan?.daily.tasks
  const doneCount  = [...(dailyTasks?.user ?? []), ...(dailyTasks?.neo ?? [])].filter(t => t.done).length
  const totalCount = (dailyTasks?.user?.length ?? 0) + (dailyTasks?.neo?.length ?? 0)

  // ══════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - var(--nav-h))' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--neo-border)' }}
      >
        {/* Meeting button */}
        <button
          onClick={startMeeting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95"
          style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.25)', color: 'var(--neo-accent)' }}
        >
          <Users className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Réunion</span>
        </button>

        {/* Session selector */}
        <button
          onClick={() => setShowSess(p => !p)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs flex-1 min-w-0 transition-all relative"
          style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)', color: 'var(--neo-muted)' }}
        >
          <span className="truncate">{activeSession?.name ?? 'Aucun échange'}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 ml-auto opacity-60" />
        </button>

        {/* Plan toggle */}
        <button
          onClick={() => setPlanOpen(p => !p)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs flex-shrink-0 transition-all"
          style={{
            background: planOpen ? 'rgba(52,211,153,0.08)' : 'var(--neo-surface)',
            border: `1px solid ${planOpen ? 'rgba(52,211,153,0.2)' : 'var(--neo-border)'}`,
            color: planOpen ? '#34D399' : 'var(--neo-muted)',
          }}
        >
          <Target className="w-3.5 h-3.5" />
          {totalCount > 0 && (
            <span className="font-semibold tabular-nums">{doneCount}/{totalCount}</span>
          )}
        </button>

        {/* Status */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl flex-shrink-0"
          style={{ background: 'var(--neo-surface)', border: `1px solid ${statusColor}30` }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: neo.online ? statusColor : '#2A2A3A', boxShadow: neo.online ? `0 0 6px ${statusColor}80` : 'none' }}
          />
          {neo.online ? <Wifi className="w-3 h-3" style={{ color: statusColor }} /> : <WifiOff className="w-3 h-3" style={{ color: 'var(--neo-subtle)' }} />}
        </div>
      </div>

      {/* ── Session dropdown ── */}
      <AnimatePresence>
        {showSess && (
          <motion.div
            initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-[49px] left-16 right-3 z-50 rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--neo-surface-2)', border: '1px solid var(--neo-border-2)', transformOrigin: 'top', maxWidth: 320 }}
          >
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--neo-border)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--neo-muted)' }}>Échanges</span>
              <button
                onClick={() => createSession()}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg"
                style={{ background: 'var(--neo-accent-dim)', color: 'var(--neo-accent)', border: '1px solid rgba(129,140,248,0.2)' }}
              >
                <Plus className="w-3 h-3" /> Nouveau
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => switchSession(s.id)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left transition-all"
                  style={{ background: activeId === s.id ? 'rgba(129,140,248,0.06)' : 'transparent' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: activeId === s.id ? 'var(--neo-accent)' : 'var(--neo-text)' }}>
                      {s.name}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--neo-subtle)' }}>{s.message_count} messages</p>
                  </div>
                  {activeId === s.id && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--neo-accent)' }} />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Plan Panel ── */}
      <AnimatePresence initial={false}>
        {planOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden flex-shrink-0"
            style={{ borderBottom: '1px solid var(--neo-border)' }}
          >
            <div className="px-4 py-3 space-y-3">

              {/* Monthly objectives */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Target className="w-3 h-3" style={{ color: '#818CF8' }} />
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#818CF8' }}>
                    {plan?.monthly.period || 'CE MOIS'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(plan?.monthly.objectives ?? []).map((obj, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs group"
                      style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.18)', color: 'var(--neo-text)' }}
                    >
                      {obj}
                      <button onClick={() => removeObjective(i)} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--neo-subtle)' }}>
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  {editMonthly ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={newObjective}
                        onChange={e => setNewObjective(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addObjective(); if (e.key === 'Escape') setEditMonthly(false) }}
                        placeholder="Objectif…"
                        className="text-xs px-2 py-0.5 rounded-full outline-none w-32"
                        style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.3)', color: 'var(--neo-text)' }}
                      />
                      <button onClick={addObjective} style={{ color: '#818CF8' }}><Check className="w-3 h-3" /></button>
                      <button onClick={() => setEditMonthly(false)} style={{ color: 'var(--neo-subtle)' }}><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditMonthly(true)}
                      className="px-2 py-0.5 rounded-full text-xs opacity-40 hover:opacity-100 transition-opacity"
                      style={{ border: '1px dashed var(--neo-subtle)', color: 'var(--neo-subtle)' }}
                    >
                      + Objectif
                    </button>
                  )}
                </div>
              </div>

              {/* Today — two columns */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <CalendarDays className="w-3 h-3" style={{ color: '#34D399' }} />
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#34D399' }}>
                    {todayLabel().toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* User column */}
                  <div
                    className="rounded-xl p-2.5"
                    style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)' }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-4 h-4 rounded-full bg-gray-600 flex items-center justify-center text-[8px] font-bold text-white">N</div>
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--neo-muted)' }}>TOI</span>
                    </div>
                    {(plan?.daily.tasks.user ?? []).map(t => (
                      <TaskItem key={t.id} task={t} accentColor="#818CF8" onToggle={toggleTask} onDelete={deleteTask} />
                    ))}
                    <AddTaskInput color="#818CF8" onAdd={t => addTask('daily', 'user', t)} />
                  </div>

                  {/* NEO column */}
                  <div
                    className="rounded-xl p-2.5"
                    style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border)' }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg, #818CF8, #A78BFA)' }}
                      >
                        <Bot className="w-2.5 h-2.5 text-white" />
                      </div>
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--neo-muted)' }}>NEO</span>
                    </div>
                    {(plan?.daily.tasks.neo ?? []).map(t => (
                      <TaskItem key={t.id} task={t} accentColor="#A78BFA" onToggle={toggleTask} onDelete={deleteTask} />
                    ))}
                    <AddTaskInput color="#A78BFA" onAdd={t => addTask('daily', 'neo', t)} />
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Exchanges feed ── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 min-h-0"
        onClick={() => setShowSess(false)}
      >
        {messages.length === 0 && !partial && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <Zap className="w-8 h-8" style={{ color: '#818CF8' }} />
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--neo-muted)' }}>
                {activeId ? 'Aucun échange pour l\'instant' : 'Lance une réunion ou un échange'}
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageCard key={msg._key} msg={msg} isLast={i === messages.length - 1} onQuickReply={sendText} />
        ))}
        {partial && <PartialCard text={partial} />}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <form
        onSubmit={e => { e.preventDefault(); sendText(input) }}
        className="flex-shrink-0 px-4 pb-4 pt-2"
        onClick={() => setShowSess(false)}
      >
        <div
          className="flex items-end gap-2 rounded-2xl px-3 py-2.5"
          style={{ background: 'var(--neo-surface)', border: '1px solid var(--neo-border-2)' }}
        >
          <button
            type="button" onClick={toggleMic}
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
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input) } }}
            placeholder={activeId ? 'Message à NEO…' : 'Lance un échange d\'abord…'}
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
            {sending
              ? <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
              : <Send className="w-3.5 h-3.5" />
            }
          </button>
        </div>

        {!activeId && (
          <p className="text-center text-[11px] mt-2" style={{ color: 'var(--neo-subtle)' }}>
            <button type="button" onClick={() => createSession()} className="underline" style={{ color: 'var(--neo-accent)' }}>
              Créer un échange
            </button>{' '}ou{' '}
            <button type="button" onClick={startMeeting} className="underline" style={{ color: '#34D399' }}>
              lancer une réunion
            </button>
          </p>
        )}
      </form>
    </div>
  )
}
