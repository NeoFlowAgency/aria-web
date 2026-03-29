import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

const FLASK_URL = process.env.FLASK_API_URL ?? 'http://localhost:5050'
const API_KEY   = process.env.NEO_API_KEY   ?? ''

type Params = { path: string[] }

async function proxyToFlask(
  request: Request,
  params: Params,
  method: string
): Promise<Response> {
  const auth = await isAuthenticated()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const flaskPath = '/' + params.path.join('/')
  const url = new URL(request.url)
  const queryString = url.search
  const targetUrl = `${FLASK_URL}${flaskPath}${queryString}`

  const headers: Record<string, string> = {
    'X-NEO-Key': API_KEY,
    'Content-Type': 'application/json',
  }

  const init: RequestInit = { method, headers }

  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const body = await request.text()
      if (body) init.body = body
    } catch {
      // body vide
    }
  }

  try {
    const res = await fetch(targetUrl, init)
    const data = await res.text()
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Flask unreachable', detail: msg }, { status: 502 })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  return proxyToFlask(request, await params, 'GET')
}

export async function POST(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  return proxyToFlask(request, await params, 'POST')
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  return proxyToFlask(request, await params, 'PUT')
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  return proxyToFlask(request, await params, 'DELETE')
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  return proxyToFlask(request, await params, 'PATCH')
}
