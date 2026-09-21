# Estrutura da Escuta

Portal da área perinatal e parental: eventos, livros em promoção, artigos,
fresquinhos, a Rede de Profissionais (busca pública) e a área de quem fez o
desafio Estrutura da Escuta (`/area`): resultado do desafio, avisos e encontros
da comunidade e o perfil dela na rede.

No ar: https://estruturadaescuta.rede-profissional.workers.dev

## Como é feito

- `public/`: as páginas (HTML, CSS e JS puros, sem build).
- `src/index.js`: o servidor (Cloudflare Worker). Atende só `/api/*` e `/adm/api/*`.
- `schema.sql`: as tabelas do banco próprio (Cloudflare D1 `estruturadaescuta`).

O conteúdo e a rede ficam no banco próprio. A única ligação com o Habitar é o
login da área: o portal chama as funções públicas do desafio (`desafio_entrar`,
`desafio_estado`) com a chave publicável, as mesmas que o `/escuta` usa. Se o
Habitar cair, o portal e a busca seguem no ar; só o login da área espera.
Efeito conhecido: entrar na área gera um token novo do desafio e desconecta o
`/escuta` em outro aparelho (e vice-versa; a área pede login de novo).

## Portão de administração

`/adm`. Uma senha só, guardada como hash. No primeiro acesso ela é criada com o
código de instalação (segredo `SETUP_CODE` na Cloudflare, uso único). Lá dentro:
eventos, livros, artigos, avisos da comunidade (só aparecem na área delas) e os
perfis da rede. Perfil montado na área entra na busca na hora; o portão pode
tirar da busca ou excluir. O e-mail das profissionais nunca sai no site.

## Publicar

Conta Cloudflare `adm.escutapsis@gmail.com`, sem GitHub.

    npx wrangler deploy

Mudou o banco? `npx wrangler d1 execute estruturadaescuta --remote --file=schema.sql`

Teste local: `.dev.vars` com `SETUP_CODE=teste-local`, depois
`npx wrangler d1 execute estruturadaescuta --local --file=schema.sql` e `npx wrangler dev --local`.
