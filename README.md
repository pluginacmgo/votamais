# Vota Mais

Plataforma em português para enquetes informais, inscrição comercial opcional e administração de campanhas. A interface pública não vincula votos a contatos. A votação grava somente totais anônimos por opção.

## Desenvolvimento

1. Copie `.env.example` para `.env.local` e configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY` e `VITE_APP_URL`.
2. Instale dependências com `npm install`.
3. Aplique o schema com `npx supabase link --project-ref <project-ref>` e `npx supabase db push`.
4. Cadastre os secrets das funções no projeto Supabase (veja abaixo), depois publique as funções.
5. Inicie com `npm run dev`.

Sem as variáveis do Supabase, o site apresenta estados de configuração e não usa dados fictícios.

## Secrets do Supabase

Configure somente pelo painel/CLI do Supabase, nunca em variáveis `VITE_`:

```sh
supabase secrets set RESEND_API_KEY=... RESEND_WEBHOOK_SECRET=... TURNSTILE_SECRET_KEY=... INTERNAL_WORKER_SECRET=... APP_URL=https://seu-dominio.example EMAIL_FROM="Vota Mais <novidades@seu-dominio.example>" SUPABASE_ANON_KEY=...
```

Publique as Edge Functions com `supabase functions deploy submit-vote`, `subscribe-lead`, `confirm-subscription`, `unsubscribe`, `queue-campaign`, `process-email-queue` e `resend-webhook`. Configure a URL do webhook no Resend apontando para `https://<project-ref>.supabase.co/functions/v1/resend-webhook` e use o segredo gerado pelo provedor. Configure o domínio de envio e seus registros SPF, DKIM e DMARC no Resend.

Para processar a fila, habilite as extensões `pg_cron`, `pg_net` e `supabase_vault` no Supabase. Guarde no Vault a URL da Edge Function e o header `Bearer <INTERNAL_WORKER_SECRET>`, depois agende `net.http_post` a cada minuto para `process-email-queue` com um lote pequeno. O worker verifica novamente o status e o consentimento de cada contato antes de chamar o Resend. Sem esse agendamento, as campanhas ficam na fila.

Cadastre o domínio do site e chaves do Turnstile. O envio público de votos e inscrições falha de forma fechada enquanto `VITE_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` não estiverem configuradas.

## Primeiro administrador

Desative o cadastro público de usuários no Supabase Auth. Crie o usuário inicial no painel do Supabase e, pelo SQL Editor restrito do projeto, crie seu perfil:

```sql
insert into public.admin_profiles (user_id, name, role, active)
select id, 'Administrador', 'owner', true
from auth.users where email = 'admin@seu-dominio.example';
```

O frontend e as funções administrativas conferem a sessão e o perfil ativo no backend. Não compartilhe a chave `service_role`.

## Estrutura

- `src/`: SPA React, interface pública e rotas administrativas.
- `supabase/migrations/`: schema Postgres, RLS, RPC de voto anônimo e buckets.
- `supabase/functions/`: voto, double opt-in, descadastramento, preparação de fila e webhooks.
- `vercel.json`: rewrite para React Router e cabeçalhos básicos de segurança.

## Escopo atual

Incluídos: interface pública, votação anônima, inscrição comercial opcional com double opt-in, páginas institucionais, login e verificação de perfil administrativo, migrations com RLS, dashboard com contagens reais, gerenciamento de enquetes e totalizações, listagem paginada de contatos, tags comerciais e exportação CSV, rascunhos de campanha, editor Quill com upload para Storage, envio de teste ao administrador, preparação de audiência, worker de fila, sanitização de HTML, links de descadastramento e webhook idempotente do Resend.

Ainda precisam ser concluídos antes da entrega integral: edição completa de opções existentes após votos, filtros de data e tags, importação CSV com prova de consentimento, histórico de contato, templates, automações, configurações administrativas, MFA, agendamento visual, gráficos e relatórios. A agenda `pg_cron` precisa ser habilitada no projeto Supabase conectado. O worker não processa campanhas até a fila ser preparada por um administrador e a função interna ser agendada. Não foram configurados credenciais, domínio, projeto Supabase ou deploy Vercel neste workspace.
