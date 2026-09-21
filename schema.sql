-- Banco próprio do portal (Cloudflare D1). Nada aqui depende do Habitar.

-- Eventos, livros, artigos e ações da comunidade. Uma tabela só porque todos
-- passam pelos mesmos passos no portão. 'acao' só aparece pra quem está logada.
CREATE TABLE IF NOT EXISTS itens (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('evento', 'livro', 'artigo', 'acao')),
  titulo TEXT NOT NULL,
  resumo TEXT,
  link TEXT,
  imagem TEXT,
  autor TEXT,
  -- evento
  data_evento TEXT,      -- AAAA-MM-DD
  hora TEXT,
  local TEXT,
  -- livro
  preco TEXT,
  preco_original TEXT,
  loja TEXT,
  -- artigo
  fonte TEXT,
  publicado INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS itens_tipo_pub ON itens (tipo, publicado, criado_em);

-- Cadastro da rede. Só aparece na busca com aprovado = 1; email nunca sai.
CREATE TABLE IF NOT EXISTS profissionais (
  id TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  aprovado INTEGER NOT NULL DEFAULT 0,
  nome TEXT NOT NULL,
  area TEXT NOT NULL,
  registro TEXT,
  cidade TEXT,
  uf TEXT,
  online INTEGER NOT NULL DEFAULT 0,
  publicos TEXT NOT NULL DEFAULT '[]',  -- JSON: tentantes, gestantes, puerperas, bebes, familias
  contato TEXT NOT NULL,
  descricao TEXT,
  email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS profissionais_aprovado ON profissionais (aprovado, nome);

-- Portão de administração: uma senha só (a da Vanessa), guardada como hash.
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hash TEXT NOT NULL,
  sal TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  expira TEXT NOT NULL
);

-- Freio contra robô: tentativas de login e cadastros por IP.
CREATE TABLE IF NOT EXISTS tentativas (
  ip TEXT NOT NULL,
  acao TEXT NOT NULL,
  em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS tentativas_ip ON tentativas (ip, acao, em);

-- Sessão de quem fez o desafio e entrou na área dela. O login passa pela
-- porta do próprio desafio (desafio_entrar) e o token dele fica aqui, só no
-- servidor, pra buscar o resultado (desafio_estado).
CREATE TABLE IF NOT EXISTS sessoes_rede (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  nome TEXT,
  whatsapp TEXT,
  instagram TEXT,
  expira TEXT NOT NULL,
  desafio_token TEXT
);
