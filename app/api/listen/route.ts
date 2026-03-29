/**
 * POST /api/listen
 *
 * Reçoit un blob audio (audio/webm) depuis le navigateur,
 * le transfère au VPS pour STT → OpenClaw → TTS → ESP32.
 *
 * Auth : cookie aria-auth (géré par middleware.ts)
 * Réponse : { heard: string, reply: string }
 */

import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

const VPS_URL    = process.env.FLASK_API_URL ?? 'http://localhost:5050'
const NEO_KEY    = process.env.NEO_API_KEY   ?? ''

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const audioBuffer = await request.arrayBuffer()
  if (!audioBuffer.byteLength) {
    return NextResponse.json({ error: 'Aucune donnée audio' }, { status: 400 })
  }

  const contentType = request.headers.get('content-type') ?? 'audio/webm'

  try {
    const res = await fetch(`${VPS_URL}/listen`, {
      method:  'POST',
      body:    audioBuffer,
      headers: {
        'Content-Type': contentType,
        'X-NEO-Key':    NEO_KEY,
      },
      signal: AbortSignal.timeout(35_000),
    })

    const data = await res.json().catch(() => ({ error: 'Réponse invalide du VPS' }))
    return NextResponse.json(data, { status: res.status })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'inconnu'
    return NextResponse.json({ error: `VPS inaccessible: ${msg}` }, { status: 502 })
  }
}
