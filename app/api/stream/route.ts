import { isAuthenticated } from '@/lib/auth'

const FLASK_URL = process.env.FLASK_API_URL ?? 'http://localhost:5000'
const API_KEY = process.env.API_KEY ?? ''

export async function GET(): Promise<Response> {
  const auth = await isAuthenticated()
  if (!auth) {
    return new Response('Unauthorized', { status: 401 })
  }

  const flaskRes = await fetch(`${FLASK_URL}/stream/events`, {
    headers: { 'X-API-Key': API_KEY },
    // Pas de cache pour le SSE
    cache: 'no-store',
  })

  if (!flaskRes.ok || !flaskRes.body) {
    return new Response('Flask stream unavailable', { status: 502 })
  }

  // Proxy du stream SSE brut
  return new Response(flaskRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
