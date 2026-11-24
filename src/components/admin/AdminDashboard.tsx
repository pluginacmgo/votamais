import { useEffect, useState } from 'react'
import { LayoutDashboard, Settings } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

type Metrics = Record<string, number>
const count = (table: string, status?: string) => {
  let query = supabase!.from(table).select('id', { count: 'exact', head: true })
  if (status) query = query.eq('status', status)
  return query
}

export function AdminDashboard() {
  const [stats, setStats] = useState<Metrics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) { setLoading(false); return }
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const month = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const results = await Promise.all([
        supabase.from('poll_totals').select('total'), count('leads'), count('leads', 'active'), count('leads', 'pending'), count('leads', 'unsubscribed'),
        supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
        supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', week),
        supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', month), count('campaigns'),
        count('campaign_recipients', 'sent'), count('campaign_recipients', 'delivered'), count('campaign_recipients', 'bounced'), count('campaign_recipients', 'complained'),
        supabase.from('email_events').select('id', { count: 'exact', head: true }).eq('event_type', 'opened'),
        supabase.from('email_events').select('id', { count: 'exact', head: true }).eq('event_type', 'clicked'),
      ])
      if (!active) return
      const failed = results.find((result) => result.error)
      if (failed) { setError('Não foi possível carregar os indicadores. Verifique as migrations e as permissões administrativas.'); setLoading(false); return }
      const [votes, leads, confirmed, pending, unsubscribed, newToday, last7, last30, campaigns, sent, delivered, bounced, complained, opened, clicked] = results
      setStats({
        votes: (votes.data ?? []).reduce((sum, row) => sum + Number(row.total), 0), leads: leads.count ?? 0,
        active: confirmed.count ?? 0, pending: pending.count ?? 0, unsubscribed: unsubscribed.count ?? 0,
        today: newToday.count ?? 0, last7: last7.count ?? 0, last30: last30.count ?? 0,
        campaigns: campaigns.count ?? 0, sent: (sent.count ?? 0) + (delivered.count ?? 0) + (bounced.count ?? 0) + (complained.count ?? 0), delivered: delivered.count ?? 0,
        bounced: (bounced.count ?? 0) + (complained.count ?? 0), opened: opened.count ?? 0, clicked: clicked.count ?? 0, recipients: (sent.count ?? 0) + (delivered.count ?? 0) + (bounced.count ?? 0) + (complained.count ?? 0),
      })
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [])
  if (!isSupabaseConfigured) return <div className="admin-not-configured"><div className="setup-icon"><Settings size={23}/></div><div><h2>Conecte seu projeto Supabase</h2><p>Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, aplique as migrations e cadastre perfis administrativos. Os indicadores desta página usam dados reais.</p></div></div>
  if (loading) return <div className="loading-state"><span className="spinner"/> Carregando indicadores…</div>
  if (error || !stats) return <p className="error-message">{error || 'Não foi possível carregar os indicadores.'}</p>
  const cards: [string, number][] = [
    ['Total de votos anônimos', stats.votes], ['Contatos', stats.leads], ['Confirmados', stats.active], ['Pendentes', stats.pending],
    ['Novos hoje', stats.today], ['Novos nos últimos 7 dias', stats.last7], ['Novos nos últimos 30 dias', stats.last30], ['Descadastrados', stats.unsubscribed],
    ['Campanhas', stats.campaigns], ['E-mails enviados', stats.sent], ['E-mails entregues', stats.delivered], ['Rejeitados', stats.bounced],
    ['Aberturas estimadas', stats.opened], ['Cliques estimados', stats.clicked],
  ]
  const rate = (n: number) => stats.recipients ? `${(n / stats.recipients * 100).toFixed(1).replace('.', ',')}%` : '—'
  return <><div className="admin-page-heading"><div><div className="eyebrow">VISÃO GERAL</div><h1>Dashboard</h1><p>Indicadores reais da sua operação, sem cruzar votos e contatos.</p></div><div className="admin-page-icon"><LayoutDashboard size={23}/></div></div><div className="metric-grid">{cards.map(([label,value])=><article className="metric-card" key={label}><span>{label}</span><strong>{value.toLocaleString('pt-BR')}</strong>{label.includes('estimadas')&&<small>Métrica estimada pelo provedor</small>}</article>)}</div><div className="metric-footnote">Taxa de entrega: {rate(stats.delivered)} · Taxa de rejeição: {rate(stats.bounced)}</div></>
}
