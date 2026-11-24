const configuredOrigins = [
  Deno.env.get('APP_URL'),
  ...(Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '').split(','),
  'https://votamais-murex.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].flatMap((value) => {
  if (!value?.trim()) return []
  try { return [new URL(value.trim()).origin] } catch { return [] }
})
const allowedOrigins = new Set(configuredOrigins)

export function corsHeadersFor(req?: Request) {
  const origin = req?.headers.get('origin') ?? ''
  return {
    ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export const corsHeaders = corsHeadersFor()

export function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret || typeof token !== 'string' || !token) return false
  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const result = await response.json() as { success?: boolean }
    return result.success === true
  } catch { return false }
}

export async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
