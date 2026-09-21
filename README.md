# Estrutura da Escuta

Portal da área perinatal e parental: eventos, livros em promoção, artigos,
fresquinhos e a Rede de Profissionais (cadastro + busca).

No ar: https://estruturadaescuta.rede-profissional.workers.dev

## Como é feito

- `public/`: as páginas (HTML, CSS e JS puros, sem build).
- `src/index.js`: o servidor (Cloudflare Worker). Atende só `/api/*` e `/adm/api/*`.
- `schema.sql`: as tabelas do banco próprio (Cloudflare D1 `estruturadaescuta`).

Não depende do Habitar em nada: nem do app, nem do banco.

## Portão de administração

`/adm`. Uma senha só, guardada como hash. No primeiro acesso ela é criada com o
código de instalação (segredo `SETUP_CODE` na Cloudflare, uso único). Lá dentro:
eventos, livros, artigos e os cadastros da rede, que só aparecem na busca depois
de publicados. O e-mail das profissionais nunca sai no site.

## Publicar

Conta Cloudflare `adm.escutapsis@gmail.com`, sem GitHub.

    npx wrangler deploy

Mudou o banco? `npx wrangler d1 execute estruturadaescuta --remote --file=schema.sql`

Teste local: `.dev.vars` com `SETUP_CODE=teste-local`, depois
`npx wrangler d1 execute estruturadaescuta --local --file=schema.sql` e `npx wrangler dev --local`.
