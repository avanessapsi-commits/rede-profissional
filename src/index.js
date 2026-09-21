// Servidor do portal da Estrutura da Escuta.
// /api/*      público: conteúdo publicado, busca da rede, área de quem fez o desafio
// /adm/api/*  portão de administração (sessão por cookie)
// Todo o resto são os arquivos de public/, servidos direto pela Cloudflare.

const TIPOS = ["evento", "livro", "artigo"];       // públicos
const TIPOS_ADM = [...TIPOS, "acao"];             // "acao" só aparece na área delas
const PUBLICOS = ["tentantes", "gestantes", "puerperas", "bebes", "familias"];
const SESSAO_DIAS = 30;
const COOKIE = "adm_sessao";
const COOKIE_REDE = "rede_sessao";

// Campos que o portão pode gravar em cada tipo, com o tamanho máximo.
const CAMPOS_ITEM = {
  titulo: 200, resumo: 1200, link: 600, imagem: 600, autor: 160,
  data_evento: 10, hora: 20, local: 160,
  preco: 30, preco_original: 30, loja: 80,
  fonte: 160,
};
const OBRIGATORIOS = {
  evento: ["titulo", "link", "data_evento"],
  livro: ["titulo", "link", "preco"],
  artigo: ["titulo", "link"],
  acao: ["titulo"],
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/adm/api/")) return await adm(req, env, url);
      if (url.pathname.startsWith("/api/")) return await publico(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof Recusa) return json({ erro: e.message }, e.status);
      console.error(e);
      return json({ erro: "Algo deu errado. Tente de novo em instantes." }, 500);
    }
  },
};

class Recusa extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ───────────── público ─────────────

async function publico(req, env, url) {
  const rota = url.pathname;

  if (rota === "/api/conteudo" && req.method === "GET") {
    const tipo = url.searchParams.get("tipo");
    const limite = Math.min(Math.max(parseInt(url.searchParams.get("limite") || "60", 10) || 60, 1), 200);
    let r;
    if (tipo === "evento") {
      // Eventos que ainda vão acontecer, do mais próximo pro mais distante.
      r = await env.DB.prepare(
        `SELECT * FROM itens WHERE tipo = 'evento' AND publicado = 1
           AND (data_evento IS NULL OR data_evento >= date('now', '-3 hours'))
         ORDER BY data_evento ASC LIMIT ?`
      ).bind(limite).all();
    } else if (TIPOS.includes(tipo)) {
      r = await env.DB.prepare(
        `SELECT * FROM itens WHERE tipo = ? AND publicado = 1 ORDER BY criado_em DESC LIMIT ?`
      ).bind(tipo, limite).all();
    } else {
      // Fresquinhos: o que entrou por último, de qualquer tipo.
      r = await env.DB.prepare(
        `SELECT * FROM itens WHERE publicado = 1 AND tipo != 'acao'
           AND NOT (tipo = 'evento' AND data_evento < date('now', '-3 hours'))
         ORDER BY criado_em DESC LIMIT ?`
      ).bind(limite).all();
    }
    return json({ itens: r.results.map(itemPublico) }, 200, 60);
  }

  if (rota === "/api/rede" && req.method === "GET") {
    const r = await env.DB.prepare(
      `SELECT id, nome, area, registro, cidade, uf, online, publicos, contato, descricao
         FROM profissionais WHERE aprovado = 1 ORDER BY nome COLLATE NOCASE`
    ).all();
    return json({ profissionais: r.results.map((p) => ({ ...p, online: !!p.online, publicos: lerLista(p.publicos) })) }, 200, 60);
  }

  // ───── área de quem fez o desafio ─────
  // Login com o mesmo e-mail e senha do desafio, pela porta que o próprio
  // desafio usa (desafio_entrar, chave pública). O token que ela devolve fica
  // guardado só aqui no servidor e busca o resultado (desafio_estado).
  // Efeito conhecido: entrar aqui desconecta o /escuta em outro aparelho.
  if (rota === "/api/rede/entrar" && req.method === "POST") {
    exigirMesmaOrigem(req, url);
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    await freio(env, ip, "login_rede", 10, 15);
    const b = await corpo(req);
    const email = texto(b.email, 200, "seu e-mail").toLowerCase();
    const r = await desafio(env, "desafio_entrar", { p_email: email, p_senha: String(b.senha || "") });
    if (r.erro === "muitas_tentativas") throw new Recusa("Muitas tentativas seguidas. Espere uns minutos.", 429);
    if (!r.token) { await registrar(env, ip, "login_rede"); throw new Recusa("E-mail ou senha não conferem com o cadastro do desafio.", 401); }
    const estado = await desafio(env, "desafio_estado", { p_token: r.token });

    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("DELETE FROM sessoes_rede WHERE expira < strftime('%Y-%m-%dT%H:%M:%SZ', 'now')").run();
    await env.DB.prepare(
      `INSERT INTO sessoes_rede (token, email, nome, desafio_token, expira)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+${SESSAO_DIAS} days'))`
    ).bind(token, email, estado.nome || null, r.token).run();
    return json({ ok: true }, 200, 0, {
      "Set-Cookie": `${COOKIE_REDE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_DIAS * 86400}`,
    });
  }

  if (rota === "/api/area" && req.method === "GET") {
    const sessao = await sessaoRede(req, env);
    if (!sessao) throw new Recusa("Entre com o e-mail e a senha do desafio.", 401);
    let estado;
    try {
      estado = await desafio(env, "desafio_estado", { p_token: sessao.desafio_token });
    } catch (e) {
      if (e instanceof Recusa && e.status === 409) {
        // Ela entrou no /escuta depois e o token do desafio mudou: pede login de novo.
        await env.DB.prepare("DELETE FROM sessoes_rede WHERE token = ?").bind(lerCookie(req, COOKIE_REDE)).run();
        throw new Recusa("Você entrou no desafio em outro lugar. Entre de novo aqui.", 401);
      }
      throw e;
    }
    const dias = [];
    for (let d = 1; d <= (estado.total_dias || 7); d++) {
      const resp = (estado.respostas || {})[String(d)];
      dias.push({
        dia: d,
        liberado: d <= (estado.dias_liberados || 0),
        concluido_em: resp && resp.concluido_em ? resp.concluido_em : null,
        ideias: resp && resp.concluido_em ? ideiasDoDia(resp.conteudo) : [],
      });
    }
    const acoes = await env.DB.prepare(
      `SELECT id, titulo, resumo, link, data_evento, hora, local FROM itens
        WHERE tipo = 'acao' AND publicado = 1
          AND (data_evento IS NULL OR data_evento >= date('now', '-3 hours'))
        ORDER BY data_evento IS NULL, data_evento ASC, criado_em DESC`
    ).all();
    return json({
      nome: estado.nome || sessao.nome,
      desafio: { total: estado.total_dias || 7, concluidos: dias.filter((x) => x.concluido_em).length, dias },
      acoes: acoes.results,
    });
  }

  if (rota === "/api/rede/sair" && req.method === "POST") {
    exigirMesmaOrigem(req, url);
    const t = lerCookie(req, COOKIE_REDE);
    if (t) await env.DB.prepare("DELETE FROM sessoes_rede WHERE token = ?").bind(t).run();
    return json({ ok: true }, 200, 0, { "Set-Cookie": `${COOKIE_REDE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  if (rota === "/api/rede/eu") {
    if (req.method !== "GET") exigirMesmaOrigem(req, url);
    const sessao = await sessaoRede(req, env);
    if (!sessao) throw new Recusa("Entre com o e-mail e a senha do desafio.", 401);
    const atual = await env.DB.prepare("SELECT * FROM profissionais WHERE email = ?").bind(sessao.email).first();

    if (req.method === "GET") {
      if (atual) {
        return json({ existe: true, publicado: !!atual.aprovado, perfil: { ...atual, online: !!atual.online, publicos: lerLista(atual.publicos) } });
      }
      // Primeira vez: começa com o nome que ela deu no desafio.
      return json({ existe: false, perfil: { nome: sessao.nome, contato: "", publicos: [], online: false } });
    }

    if (req.method === "PUT") {
      const b = await corpo(req);
      const p = {
        nome: texto(b.nome, 160, "seu nome"),
        area: texto(b.area, 120, "sua área"),
        registro: texto(b.registro, 60),
        cidade: texto(b.cidade, 120),
        uf: b.uf ? String(b.uf).trim().toUpperCase() : null,
        online: b.online ? 1 : 0,
        publicos: JSON.stringify((Array.isArray(b.publicos) ? b.publicos : []).filter((x) => PUBLICOS.includes(x))),
        contato: texto(b.contato, 200, "como as famílias falam com você"),
        descricao: texto(b.descricao, 600),
      };
      if (p.uf && !/^[A-Z]{2}$/.test(p.uf)) throw new Recusa("Estado: use a sigla, como SP ou RJ.");
      if (atual) {
        // Se a Vanessa tirou o perfil da busca, editar não põe de volta.
        await env.DB.prepare(
          `UPDATE profissionais SET nome = ?, area = ?, registro = ?, cidade = ?, uf = ?, online = ?, publicos = ?, contato = ?, descricao = ? WHERE id = ?`
        ).bind(p.nome, p.area, p.registro, p.cidade, p.uf, p.online, p.publicos, p.contato, p.descricao, atual.id).run();
      } else {
        // Quem fez o desafio já é conhecida: entra direto na busca.
        await env.DB.prepare(
          `INSERT INTO profissionais (id, aprovado, nome, area, registro, cidade, uf, online, publicos, contato, descricao, email)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), p.nome, p.area, p.registro, p.cidade, p.uf, p.online, p.publicos, p.contato, p.descricao, sessao.email).run();
      }
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM profissionais WHERE email = ?").bind(sessao.email).run();
      return json({ ok: true });
    }
  }

  return json({ erro: "Não encontrado." }, 404);
}

async function desafio(env, fn, args) {
  let resp;
  try {
    resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_CHAVE, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (e) {
    console.error(fn, e);
    throw new Recusa("Não consegui falar com o desafio agora. Tente de novo em alguns minutos.", 503);
  }
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (String(d.message || "").includes("token_invalido")) throw new Recusa("token_invalido", 409);
    console.error(fn, resp.status, d);
    throw new Recusa("Não consegui falar com o desafio agora. Tente de novo em alguns minutos.", 503);
  }
  return d;
}

// Cada dia do desafio guarda exercícios (ex1, ex2...) com a "ideia" central.
function ideiasDoDia(conteudo) {
  const ideias = [];
  const visitar = (v) => {
    if (!v || typeof v !== "object") return;
    if (typeof v.ideia === "string" && v.ideia.trim()) ideias.push(v.ideia.trim());
    for (const k of Object.keys(v)) if (v[k] && typeof v[k] === "object") visitar(v[k]);
  };
  visitar(conteudo);
  return ideias;
}

function itemPublico(i) {
  const { publicado, atualizado_em, ...resto } = i;
  return resto;
}

// ───────────── portão de administração ─────────────

async function adm(req, env, url) {
  const rota = url.pathname.slice("/adm/api".length);
  if (req.method !== "GET") exigirMesmaOrigem(req, url);
  const ip = req.headers.get("CF-Connecting-IP") || "?";

  if (rota === "/estado" && req.method === "GET") {
    const temSenha = !!(await env.DB.prepare("SELECT 1 FROM admin WHERE id = 1").first());
    return json({ temSenha, logada: await sessaoValida(req, env) });
  }

  // Primeira vez: cria a senha com o código de instalação (uso único).
  if (rota === "/criar-senha" && req.method === "POST") {
    await freio(env, ip, "login", 10, 15);
    const b = await corpo(req);
    if (await env.DB.prepare("SELECT 1 FROM admin WHERE id = 1").first()) throw new Recusa("A senha já foi criada. Use Entrar.", 409);
    if (!env.SETUP_CODE || b.codigo !== env.SETUP_CODE) {
      await registrar(env, ip, "login");
      throw new Recusa("Código de instalação incorreto.", 403);
    }
    const senha = String(b.senha || "");
    if (senha.length < 10) throw new Recusa("A senha precisa ter pelo menos 10 caracteres.");
    const sal = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare("INSERT INTO admin (id, hash, sal) VALUES (1, ?, ?)").bind(await hashSenha(senha, sal), sal).run();
    return await abrirSessao(env);
  }

  if (rota === "/entrar" && req.method === "POST") {
    await freio(env, ip, "login", 10, 15);
    const b = await corpo(req);
    const a = await env.DB.prepare("SELECT hash, sal FROM admin WHERE id = 1").first();
    if (!a || !igual(await hashSenha(String(b.senha || ""), a.sal), a.hash)) {
      await registrar(env, ip, "login");
      throw new Recusa("Senha incorreta.", 401);
    }
    return await abrirSessao(env);
  }

  if (rota === "/sair" && req.method === "POST") {
    const t = lerCookie(req);
    if (t) await env.DB.prepare("DELETE FROM sessoes WHERE token = ?").bind(t).run();
    return json({ ok: true }, 200, 0, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  // Daqui pra baixo, só logada.
  if (!(await sessaoValida(req, env))) throw new Recusa("Sua sessão expirou. Entre de novo.", 401);

  if (rota === "/itens" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM itens ORDER BY criado_em DESC").all();
    return json({ itens: r.results });
  }

  if (rota === "/itens" && req.method === "POST") {
    const b = await corpo(req);
    if (!TIPOS_ADM.includes(b.tipo)) throw new Recusa("Tipo inválido.");
    const d = dadosItem(b);
    const id = crypto.randomUUID();
    const cols = Object.keys(d);
    await env.DB.prepare(
      `INSERT INTO itens (id, tipo, publicado, ${cols.join(", ")}) VALUES (?, ?, ?, ${cols.map(() => "?").join(", ")})`
    ).bind(id, b.tipo, b.publicado === false ? 0 : 1, ...cols.map((c) => d[c])).run();
    return json({ ok: true, id }, 201);
  }

  const mItem = rota.match(/^\/itens\/([0-9a-f-]{36})$/);
  if (mItem && req.method === "PUT") {
    const atual = await env.DB.prepare("SELECT tipo FROM itens WHERE id = ?").bind(mItem[1]).first();
    if (!atual) throw new Recusa("Item não encontrado.", 404);
    const b = await corpo(req);
    const d = dadosItem({ ...b, tipo: atual.tipo });
    const cols = Object.keys(d);
    await env.DB.prepare(
      `UPDATE itens SET ${cols.map((c) => `${c} = ?`).join(", ")}, publicado = ?,
         atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).bind(...cols.map((c) => d[c]), b.publicado === false ? 0 : 1, mItem[1]).run();
    return json({ ok: true });
  }
  if (mItem && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM itens WHERE id = ?").bind(mItem[1]).run();
    return json({ ok: true });
  }

  if (rota === "/profissionais" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM profissionais ORDER BY aprovado ASC, criado_em DESC").all();
    return json({ profissionais: r.results.map((p) => ({ ...p, online: !!p.online, aprovado: !!p.aprovado, publicos: lerLista(p.publicos) })) });
  }
  const mProf = rota.match(/^\/profissionais\/([0-9a-f-]{36})$/);
  if (mProf && req.method === "PUT") {
    const b = await corpo(req);
    await env.DB.prepare("UPDATE profissionais SET aprovado = ? WHERE id = ?").bind(b.aprovado ? 1 : 0, mProf[1]).run();
    return json({ ok: true });
  }
  if (mProf && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM profissionais WHERE id = ?").bind(mProf[1]).run();
    return json({ ok: true });
  }

  return json({ erro: "Não encontrado." }, 404);
}

function dadosItem(b) {
  const d = {};
  for (const [campo, max] of Object.entries(CAMPOS_ITEM)) d[campo] = texto(b[campo], max);
  for (const campo of OBRIGATORIOS[b.tipo]) {
    if (!d[campo]) throw new Recusa(`Preencha: ${ROTULOS[campo]}.`);
  }
  for (const campo of ["link", "imagem"]) {
    if (d[campo] && !/^https?:\/\//i.test(d[campo])) throw new Recusa(`${campo === "link" ? "O link" : "O link da imagem"} precisa começar com https://`);
  }
  if (d.data_evento && !/^\d{4}-\d{2}-\d{2}$/.test(d.data_evento)) throw new Recusa("Data do evento inválida.");
  return d;
}
const ROTULOS = { titulo: "título", link: "link", data_evento: "data do evento", preco: "preço", imagem: "Imagem" };

async function abrirSessao(env) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("DELETE FROM sessoes WHERE expira < strftime('%Y-%m-%dT%H:%M:%SZ', 'now')").run();
  await env.DB.prepare(
    `INSERT INTO sessoes (token, expira) VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+${SESSAO_DIAS} days'))`
  ).bind(token).run();
  return json({ ok: true }, 200, 0, {
    "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_DIAS * 86400}`,
  });
}

function sessaoRede(req, env) {
  const t = lerCookie(req, COOKIE_REDE);
  if (!t) return null;
  return env.DB.prepare(
    "SELECT email, nome, desafio_token FROM sessoes_rede WHERE token = ? AND expira > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
  ).bind(t).first();
}

async function sessaoValida(req, env) {
  const t = lerCookie(req);
  if (!t) return false;
  return !!(await env.DB.prepare(
    "SELECT 1 FROM sessoes WHERE token = ? AND expira > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
  ).bind(t).first());
}

function lerCookie(req, nome = COOKIE) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${nome}=([0-9a-f]{64})`));
  return m ? m[1] : null;
}

async function hashSenha(senha, sal) {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(sal), iterations: 100000 }, chave, 256
  );
  return hex(new Uint8Array(bits));
}

// ───────────── utilidades ─────────────

// Barra pedido que não veio do próprio site (outro site tentando usar a sessão dela).
function exigirMesmaOrigem(req, url) {
  const origem = req.headers.get("Origin");
  if (origem && origem !== url.origin) throw new Recusa("Origem não permitida.", 403);
  if (!(req.headers.get("Content-Type") || "").includes("application/json") && req.method !== "DELETE") {
    throw new Recusa("Formato inválido.", 415);
  }
}

async function freio(env, ip, acao, max, minutos) {
  await env.DB.prepare(`DELETE FROM tentativas WHERE em < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')`).run();
  const r = await env.DB.prepare(
    `SELECT COUNT(*) n FROM tentativas WHERE ip = ? AND acao = ? AND em > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`
  ).bind(ip, acao, `-${minutos} minutes`).first();
  if (r.n >= max) throw new Recusa("Muitas tentativas seguidas. Espere um pouco e tente de novo.", 429);
}
function registrar(env, ip, acao) {
  return env.DB.prepare("INSERT INTO tentativas (ip, acao) VALUES (?, ?)").bind(ip, acao).run();
}

async function corpo(req) {
  try { return await req.json(); } catch { throw new Recusa("Não consegui ler o que foi enviado."); }
}

function texto(v, max, obrigatorio) {
  const s = v == null ? "" : String(v).trim();
  if (!s) {
    if (obrigatorio) throw new Recusa(`Preencha ${obrigatorio}.`);
    return null;
  }
  if (s.length > max) throw new Recusa(`Texto longo demais (máximo ${max} caracteres).`);
  return s;
}

function lerLista(s) { try { return JSON.parse(s); } catch { return []; } }
function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function igual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json(dados, status = 200, cacheSeg = 0, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeg ? `public, max-age=${cacheSeg}` : "no-store",
      ...extra,
    },
  });
}
