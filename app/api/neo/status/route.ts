/**
 * GET /api/neo/status
 *
 * Retourne l'état complet du robot ARIA en temps réel.
 * Authentification : header  X-NEO-Key: <NEO_API_KEY>
 *
 * Réponse :
 * {
 *   "online": true,
 *   "etat": "repos" | "ecoute" | "reflechit" | "parle",
 *   "mode_continu": false,
 *   "partial": "",           // réponse en cours de génération (si parle)
 *   "last_messages": [...],  // 5 derniers messages {role, text, ts}
 *   "timestamp": 1711622400
 * }
 */

import { NextResponse } from 'next/server'
import { flaskCall }    from '@/lib/flask'

function verifyNeoKey(req: Request): boolean {
  const key = req.headers.get('x-neo-key') ?? req.headers.get('authorization')?.replace(/^bearer\s+/i, '')
  const expected = process.env.NEO_API_KEY ?? ''
  if (!expected) return false
  return key === expected
}

export async function GET(request: Request) {
  if (!verifyNeoKey(request)) {
    return NextResponse.json({ error: 'Unauthorized — X-NEO-Key invalide ou absente' }, { status: 401 })
  }

  const result = await flaskCall('/status', 'GET')

  if (!result.ok) {
    return NextResponse.json(
      { online: false, error: 'Flask inaccessible', details: result.data },
      { status: 502 },
    )
  }

  const data = result.data as Record<string, unknown>

  // Ne renvoyer que les 5 derniers messages pour alléger la réponse
  const allMessages = (Array.isArray(data.messages) ? data.messages : []) as Array<{role: string; text: string; ts: number}>
  const lastMessages = allMessages.slice(-5)

  return NextResponse.json({
    online:        true,
    etat:          data.etat          ?? 'repos',
    mode_continu:  data.mode_continu  ?? false,
    partial:       data.partial       ?? '',
    last_messages: lastMessages,
    timestamp:     Math.floor(Date.now() / 1000),
  })
}
