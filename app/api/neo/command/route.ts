/**
 * POST /api/neo/command
 *
 * Endpoint dédié à l'assistant IA externe (OpenClaw / Néo) pour envoyer
 * des commandes au robot ARIA via le serveur Flask.
 *
 * Authentification : header  X-NEO-Key: <valeur de NEO_API_KEY>
 *
 * Corps JSON :
 * {
 *   "action": "speak" | "move" | "express" | "set_emotion" | "set_angle" | "set_mode" | "listen" | "keypad",
 *   "parameters": { ... }
 * }
 *
 * Exemples :
 *   { "action": "speak",      "parameters": { "text": "Bonjour !" } }
 *   { "action": "move",       "parameters": { "state": "dance" } }
 *   { "action": "express",    "parameters": { "emotion": "happy" } }
 *   { "action": "set_angle",  "parameters": { "angle": 45 } }
 *   { "action": "set_mode",   "parameters": { "mode": "ami" } }
 *   { "action": "listen",     "parameters": {} }
 *   { "action": "keypad",     "parameters": { "key": "B" } }
 */

import { NextResponse } from 'next/server'
import { flaskCall }    from '@/lib/flask'

// ── Authentification ────────────────────────────────────────────────────────
function verifyNeoKey(req: Request): boolean {
  const key = req.headers.get('x-neo-key') ?? req.headers.get('authorization')?.replace(/^bearer\s+/i, '')
  const expected = process.env.NEO_API_KEY ?? ''
  if (!expected) return false           // si NEO_API_KEY non configurée → refuser
  return key === expected
}

// ── Tables de traduction ─────────────────────────────────────────────────────
const MOVE_MAP: Record<string, string> = {
  dance:           'corps_danse',
  danse:           'corps_danse',
  hoche:           'corps_hoche',
  nod:             'corps_hoche',
  repos:           'D',
  idle:            'D',
  sleep:           '#',
  veille:          '#',
  left:            'corps_tourne_gauche',
  gauche:          'corps_tourne_gauche',
  right:           'corps_tourne_droite',
  droite:          'corps_tourne_droite',
  center:          'corps_centre',
  centre:          'corps_centre',
  continu_on:      'A',
  continu_off:     '*',
}

const EMOTION_MAP: Record<string, string> = {
  happy:           'corps_content',
  content:         'corps_content',
  joy:             'corps_content',
  sad:             'corps_triste',
  triste:          'corps_triste',
  unhappy:         'corps_triste',
  surprised:       'corps_surpris',
  surpris:         'corps_surpris',
  shocked:         'corps_surpris',
  angry:           'corps_colere',
  colere:          'corps_colere',
  anger:           'corps_colere',
  love:            'corps_amoureux',
  amoureux:        'corps_amoureux',
  neutral:         'corps_neutre',
  neutre:          'corps_neutre',
}

// ── Exécution d'une commande ─────────────────────────────────────────────────
async function execute(action: string, params: Record<string, unknown>) {
  switch (action) {

    // Faire parler le robot (TTS via Piper)
    case 'speak': {
      const text = String(params.text ?? '').trim()
      if (!text) return { ok: false, status: 400, data: { error: 'paramètre text requis' } }
      return flaskCall('/web_speak', 'POST', { text })
    }

    // Mouvements / états physiques
    case 'move': {
      const state = String(params.state ?? params.direction ?? '').toLowerCase()
      if (!state) return { ok: false, status: 400, data: { error: 'paramètre state requis' } }
      const key = MOVE_MAP[state] ?? state
      return flaskCall(`/keypad/${encodeURIComponent(key)}`, 'POST', {})
    }

    // Expression OLED
    case 'express':
    case 'set_emotion': {
      const emotion = String(params.emotion ?? '').toLowerCase()
      if (!emotion) return { ok: false, status: 400, data: { error: 'paramètre emotion requis' } }
      const key = EMOTION_MAP[emotion] ?? `corps_${emotion}`
      return flaskCall(`/keypad/${encodeURIComponent(key)}`, 'POST', {})
    }

    // Angle servo direct (0–180°)
    case 'set_angle': {
      const angle = Number(params.angle)
      if (isNaN(angle)) return { ok: false, status: 400, data: { error: 'paramètre angle invalide' } }
      const clamped = Math.max(0, Math.min(180, Math.round(angle)))
      return flaskCall('/servo', 'POST', { angle: clamped })
    }

    // Changer la personnalité d'ARIA
    case 'set_mode': {
      const mode = String(params.mode ?? '').trim()
      if (!mode) return { ok: false, status: 400, data: { error: 'paramètre mode requis' } }
      return flaskCall('/mode', 'POST', { mode })
    }

    // Déclencher une écoute one-shot (comme touche A)
    case 'listen':
    case 'wake': {
      return flaskCall('/keypad/A', 'POST', {})
    }

    // Commande directe clavier 4×4
    case 'keypad': {
      const key = String(params.key ?? '').trim()
      if (!key) return { ok: false, status: 400, data: { error: 'paramètre key requis' } }
      return flaskCall(`/keypad/${encodeURIComponent(key)}`, 'POST', {})
    }

    default:
      return {
        ok:     false,
        status: 400,
        data:   { error: `Action inconnue : "${action}". Actions disponibles : speak, move, express, set_emotion, set_angle, set_mode, listen, keypad` },
      }
  }
}

// ── Handler HTTP ─────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  if (!verifyNeoKey(request)) {
    return NextResponse.json({ error: 'Unauthorized — X-NEO-Key invalide ou absente' }, { status: 401 })
  }

  let body: { action?: unknown; parameters?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (!action) {
    return NextResponse.json({ error: 'Champ "action" requis' }, { status: 400 })
  }

  const params = (typeof body.parameters === 'object' && body.parameters !== null)
    ? body.parameters as Record<string, unknown>
    : {}

  const result = await execute(action, params)

  return NextResponse.json(
    { ok: result.ok, action, result: result.data },
    { status: result.ok ? 200 : result.status },
  )
}
