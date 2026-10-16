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

## Duas portas pra área

- **Código por e-mail** (qualquer profissional, sem o desafio): `/api/rede/codigo`
  pede o código e `/api/rede/codigo/entrar` confere. São 6 dígitos, valem 10 minutos
  e só funcionam uma vez; pedir outro apaga o anterior e 5 erros matam o código.
  Freio de 3 pedidos por e-mail e 10 por IP a cada 15 min, e 20 tentativas de
  entrada por IP. O banco (`codigos_rede`) guarda só o HMAC do código, com o
  segredo `CODIGO_SEGREDO`.
- **Tetos do dia** (fuso de SP, tabela `limites`): 80 códigos enviados no total
  (abaixo dos 100/dia grátis do Resend), 10 por destinatário e 10 códigos errados
  por e-mail, que não zeram quando ela pede outro código. Cada pedido reserva a
  vaga num comando só antes de enviar ou comparar, então pedidos simultâneos não
  passam do teto; a vaga volta se o e-mail não sair ou se o código estiver certo.
  Os freios de 15 minutos (`tentativas`) são mais antigos e não são à prova de
  pedidos simultâneos: quem segura nesse caso são os tetos do dia.
- **Senha do desafio**: igual a antes, pelo Habitar.

A sessão aberta por código não tem `desafio_token`, e o servidor confere isso:
`/api/area` devolve só `{modo: "codigo"}`, sem percurso nem avisos da comunidade.
O perfil é ligado ao e-mail, então é o mesmo pelas duas portas.

**Pra ligar no portal publicado** (ainda não feito): domínio do remetente verificado
no Resend e três segredos na Cloudflare: `CODIGO_SEGREDO`, `RESEND_API_KEY` e
`EMAIL_REMETENTE` (ex.: `Estrutura da Escuta <rede@avanessapsi.com.br>`). Antes
disso, criar a tabela no banco real com o `schema.sql`. Sem esses segredos, o pedido
de código responde "ainda não disponível" e a porta do desafio segue normal.

**Teste local sem e-mail**: com `MODO_DEV_CODIGO=1` e um `CODIGO_SEGREDO` qualquer
no `.dev.vars`, o código volta na resposta em vez de ir por e-mail. Só vale com o
pedido chegando por `localhost`/`127.0.0.1`, então não funciona no endereço publicado
mesmo que a variável vá parar lá. Cuidado: um `wrangler dev` antigo que não fechou
continua respondendo na porta com as variáveis velhas.

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
