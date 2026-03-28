/**
 * Utilitaire d'appel Flask interne (server-side uniquement).
 * Utilisé par les routes /api/neo/* pour communiquer avec le serveur local.
 */

const FLASK_URL = process.env.FLASK_API_URL ?? 'http://localhost:5000'
const FLASK_KEY  = process.env.API_KEY ?? ''

export interface FlaskResult {
  ok:     boolean
  status: number
  data:   unknown
}

export async function flaskCall(
  path:    string,
  method:  'GET' | 'POST' | 'DELETE' = 'GET',
  body?:   unknown,
  timeoutMs = 8000,
): Promise<FlaskResult> {
  const url = `${FLASK_URL}${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key':    FLASK_KEY,
  }

  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) }
  if (body !== undefined) init.body = JSON.stringify(body)

  try {
    const res  = await fetch(url, init)
    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { ok: false, status: 502, data: { error: `Flask unreachable: ${msg}` } }
  }
}
