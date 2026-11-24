import { createClient } from 'npm:@supabase/supabase-js@2'
import sanitizeHtml from 'npm:sanitize-html@2'
import { digest, json } from '../_shared/http.ts'

type Recipient = {
  recipient_id:string; campaign_id:string; lead_id:string; email:string; first_name:string|null;
  campaign_name:string; subject:string; preheader:string|null; sender_name:string; sender_email:string;
  reply_to:string|null; content_html:string; attempts:number
}
const escapeHtml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const inlineQuillStyles=(html:string)=>html.replace(/<([a-z0-9]+)([^>]*)>/gi,(whole,tag:string,attributes:string)=>{const align=attributes.match(/\bql-align-(center|right|justify)\b/)?.[1];if(!align)return whole;const existing=attributes.match(/\sstyle=["']([^"']*)["']/i)?.[1];const safeAttributes=attributes.replace(/\sclass=["'][^"']*["']/i,'').replace(/\sstyle=["'][^"']*["']/i,'');return `<${tag}${safeAttributes} style="${existing?`${existing};`:''}text-align:${align}">`})
const safeHtml=(html:string)=>sanitizeHtml(inlineQuillStyles(html),{allowedTags:['p','br','strong','b','em','i','u','s','strike','ol','ul','li','h1','h2','h3','blockquote','a','img','div','span','hr','table','thead','tbody','tr','td','th'],allowedAttributes:{a:['href','name','target','rel'],img:['src','alt','width','height'],td:['colspan','rowspan'],th:['colspan','rowspan'],span:['style'],p:['style'],div:['style'],h1:['style'],h2:['style'],h3:['style'],a:['href','name','target','rel','style']},allowedStyles:{'*':{'color':[/^#[0-9a-f]{3,8}$/i,/^rgb\(/i,/^[a-z]+$/i],'background-color':[/^#[0-9a-f]{3,8}$/i,/^rgb\(/i,/^[a-z]+$/i],'text-align':[/^(left|right|center|justify)$/],'font-size':[/^\d+(px|em|rem|%)$/],'font-weight':[/^(normal|bold|[1-9]00)$/],'font-style':[/^(normal|italic)$/],'text-decoration':[/^(none|underline|line-through)$/]}},allowedSchemes:['https','mailto'],allowProtocolRelative:false,transformTags:{a:sanitizeHtml.simpleTransform('a',{rel:'noopener noreferrer',target:'_blank'}),img:(tagName,attribs)=>({tagName,attribs:{...attribs,src:attribs.src?.startsWith('https://')?attribs.src:''}})}})

Deno.serve(async (req)=>{
  if(req.method!=='POST')return json({error:'Método não permitido.'},405)
  const secret=Deno.env.get('INTERNAL_WORKER_SECRET')
  if(!secret||req.headers.get('Authorization')!==`Bearer ${secret}`)return json({error:'Não autorizado.'},401)
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),resend=Deno.env.get('RESEND_API_KEY'),appUrl=Deno.env.get('APP_URL')
  if(!url||!service||!resend||!appUrl)return json({error:'Processador não configurado.'},503)
  const db=createClient(url,service,{auth:{persistSession:false}})
  await db.rpc('recover_stale_campaign_recipients',{p_stale_minutes:15})
  let batchSize=25
  try{const body=await req.json();if(Number.isInteger(body.batch_size))batchSize=Math.min(100,Math.max(1,body.batch_size))}catch{}
  const {data:claimed,error:claimError}=await db.rpc('claim_campaign_recipients',{p_batch_size:batchSize})
  if(claimError)return json({error:'Não foi possível consultar a fila.'},500)
  const results={processed:0,sent:0,retried:0,failed:0,cancelled:0}
  for(const recipient of (claimed??[]) as Recipient[]){
    results.processed++
    const {data:lead}=await db.from('leads').select('status,email,first_name').eq('id',recipient.lead_id).maybeSingle()
    const {data:consent}=await db.from('lead_consents').select('id').eq('lead_id',recipient.lead_id).eq('consent_type','commercial_email').is('revoked_at',null).limit(1).maybeSingle()
    if(!lead||lead.status!=='active'||!consent){await db.from('campaign_recipients').update({status:'cancelled',locked_at:null,error_message:'Contato sem consentimento ativo.'}).eq('id',recipient.recipient_id);results.cancelled++;continue}
    const email=lead.email.toLowerCase()
    const {data:suppressed}=await db.from('suppression_list').select('id').eq('email_hash',await digest(email)).maybeSingle()
    if(suppressed){await db.from('campaign_recipients').update({status:'cancelled',locked_at:null,error_message:'Contato em lista de supressão.'}).eq('id',recipient.recipient_id);results.cancelled++;continue}
    const rawToken=`${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-','')}`
    const {error:tokenError}=await db.from('signup_tokens').insert({lead_id:recipient.lead_id,token_hash:await digest(rawToken),kind:'unsubscribe',expires_at:new Date(Date.now()+10*365*24*60*60*1000).toISOString()})
    if(tokenError){await db.from('campaign_recipients').update({status:'failed',locked_at:null,error_message:'Não foi possível preparar o descadastramento.'}).eq('id',recipient.recipient_id);results.failed++;continue}
    const unsubscribeUrl=`${url}/functions/v1/unsubscribe?token=${encodeURIComponent(rawToken)}`
    const values:Record<string,string>={first_name:escapeHtml(lead.first_name?.trim()||'por aí'),email:escapeHtml(email),unsubscribe_url:escapeHtml(unsubscribeUrl),company_name:'Vota Mais'}
    const personalized=recipient.content_html.replace(/\{\{(first_name|email|unsubscribe_url|company_name)\}\}/g,(_,key:string)=>values[key])
    const content=safeHtml(personalized)
    const bodyHtml=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(recipient.subject)}</title></head><body style="margin:0;padding:0;background:#f6f7f4;font-family:Arial,sans-serif;color:#203629"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(recipient.preheader??'')}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f4"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px"><tr><td style="padding:28px 32px;font-size:15px;line-height:1.65">${content}</td></tr><tr><td style="padding:18px 32px;border-top:1px solid #e9eee7;color:#78847a;font-size:11px;line-height:1.6">Você recebe esta mensagem porque confirmou sua inscrição no Vota Mais.<br><a href="${unsubscribeUrl}" style="color:#386d43">Cancelar inscrição</a></td></tr></table></td></tr></table></body></html>`
    const from=`${recipient.sender_name.replace(/[<>\r\n]/g,'').slice(0,100)} <${recipient.sender_email}>`
    const payload={from,to:[email],subject:recipient.subject,html:bodyHtml,reply_to:recipient.reply_to||undefined,headers:{'List-Unsubscribe':`<${unsubscribeUrl}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}
    let response:Response
    try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`campaign-${recipient.campaign_id}-lead-${recipient.lead_id}`},body:JSON.stringify(payload)})}
    catch{response=new Response(null,{status:503})}
    if(response.ok){const sent=await response.json() as {id?:string};await db.from('campaign_recipients').update({status:'sent',provider_email_id:sent.id??null,sent_at:new Date().toISOString(),locked_at:null,error_message:null}).eq('id',recipient.recipient_id);results.sent++}
    else{
      const retryable=response.status===408||response.status===429||response.status>=500
      const retry=retryable&&recipient.attempts<5
      const message=`Resend respondeu com status ${response.status}.`
      await db.from('campaign_recipients').update({status:'failed',locked_at:null,error_message:message,next_attempt_at:new Date(Date.now()+(retry?Math.min(360,2**recipient.attempts)*60_000:0)).toISOString()}).eq('id',recipient.recipient_id)
      results[retry?'retried':'failed']++
    }
  }
  const campaigns=[...new Set((claimed??[]).map((r:Recipient)=>r.campaign_id))]
  for(const campaignId of campaigns){
    const {data:remaining}=await db.from('campaign_recipients').select('id,status,next_attempt_at').eq('campaign_id',campaignId).in('status',['queued','sending','failed'])
    const pending=(remaining??[]).some((r)=>r.status==='queued'||r.status==='sending'||(r.status==='failed'&&new Date(r.next_attempt_at)>new Date()))
    if(!pending){const anyFailed=(remaining??[]).some((r)=>r.status==='failed');await db.from('campaigns').update({status:anyFailed?'failed':'sent',sent_at:new Date().toISOString()}).eq('id',campaignId)}
    else await db.from('campaigns').update({status:'sending'}).eq('id',campaignId).in('status',['queued','scheduled'])
  }
  return json(results)
})
