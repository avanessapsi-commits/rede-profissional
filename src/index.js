// Servidor do portal da Estrutura da Escuta.
// /api/*      público: conteúdo publicado, busca da rede, área de quem fez o desafio
// /adm/api/*  portão de administração (sessão por cookie)
// Todo o resto são os arquivos de public/, servidos direto pela Cloudflare.

const TIPOS = ["evento", "livro", "artigo"];       // públicos
const TIPOS_ADM = [...TIPOS, "acao"];             // "acao" só aparece na área delas
const PUBLICOS = ["tentantes", "gestantes", "puerperas", "bebes", "familias"];
const SESSAO_DIAS = 30;
const CODIGO_MINUTOS = 10;     // validade do código de entrada por e-mail
const CODIGO_TENTATIVAS = 5;   // erros antes de o código morrer
// Tetos do dia (fuso de SP). O total fica abaixo da cota grátis do Resend (100/dia).
const ENVIOS_DIA_TOTAL = 80;   // códigos enviados no portal inteiro
const ENVIOS_DIA_EMAIL = 10;   // códigos enviados pro mesmo destinatário
const ERROS_DIA_EMAIL = 10;    // códigos errados por e-mail; não zera ao pedir outro código
const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TEMPO_MS = 10000; // tempo-limite do envio; passou disso, o envio fica "incerto"
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

  // ───── entrada por código de e-mail (qualquer profissional) ─────
  // Não passa pelo desafio nem pelo Habitar. A sessão sai sem desafio_token,
  // e é isso que o servidor confere antes de entregar qualquer dado do desafio.
  if (rota === "/api/rede/codigo" && req.method === "POST") {
    exigirMesmaOrigem(req, url);
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    const b = await corpo(req);
    const email = lerEmail(b.email);
    const dev = modoDevCodigo(env, url);
    if (!env.CODIGO_SEGREDO || (!dev && !(env.RESEND_API_KEY && env.EMAIL_REMETENTE))) {
      throw new Recusa("A entrada por código ainda não está disponível. Se você fez o desafio, entre com a senha dele.", 503);
    }
    // Freio por IP e por e-mail (o e-mail entra como hash, nunca em texto).
    const chaveEmail = "email:" + (await hmac(env.CODIGO_SEGREDO, "freio:" + email));
    await freio(env, ip, "codigo_pedir", 10, 15);
    await freio(env, chaveEmail, "codigo_pedir", 3, 15);
    await registrar(env, ip, "codigo_pedir");
    await registrar(env, chaveEmail, "codigo_pedir");

    // Tetos do dia, com a vaga reservada antes de enviar (seguro com pedidos simultâneos).
    const envioEmail = "envio:" + chaveEmail.slice("email:".length);
    const dia = diaSP(agora(env, req, url));
    const diaEmail = await reservar(env, envioEmail, ENVIOS_DIA_EMAIL, dia);
    if (!diaEmail) {
      throw new Recusa("Já mandamos muitos códigos pra este e-mail hoje. Tente de novo amanhã.", 429);
    }
    const diaTotal = await reservar(env, "envio:total", ENVIOS_DIA_TOTAL, dia);
    if (!diaTotal) {
      await devolver(env, envioEmail, diaEmail);
      throw new Recusa("A entrada por código atingiu o limite de hoje. Tente de novo amanhã ou, se fez o desafio, entre com a senha dele.", 429);
    }

    const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    await env.DB.prepare("DELETE FROM codigos_rede WHERE expira < strftime('%Y-%m-%dT%H:%M:%SZ', 'now')").run();
    await env.DB.prepare("DELETE FROM limites WHERE dia < ?").bind(dia).run();
    // Um código vivo por e-mail: pedir outro substitui o anterior.
    await env.DB.prepare(
      `INSERT INTO codigos_rede (email, hash, expira, tentativas)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+${CODIGO_MINUTOS} minutes'), 0)
       ON CONFLICT(email) DO UPDATE SET hash = excluded.hash, expira = excluded.expira, tentativas = 0,
         criado_em = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    ).bind(email, await hashCodigo(env, email, codigo)).run();

    // Teste local sem e-mail: o código volta na tela. Com RESEND_URL_TESTE (um
    // Resend falso em localhost), passa pelo envio de verdade antes de voltar.
    const urlTeste = dev ? urlResendTeste(env) : null;
    if (dev && !urlTeste) return json({ ok: true, codigo_dev: codigo });

    const envio = await enviarCodigo(env, email, codigo, urlTeste || RESEND_URL);
    if (envio === "recusado") {
      // O Resend disse que não mandou: o código morre e as vagas voltam pro dia em que foram reservadas.
      await env.DB.prepare("DELETE FROM codigos_rede WHERE email = ?").bind(email).run();
      await devolver(env, envioEmail, diaEmail);
      await devolver(env, "envio:total", diaTotal);
      throw new Recusa("Não consegui mandar o código agora. Tente de novo em alguns minutos.", 503);
    }
    if (envio === "incerto") {
      // Estourou o tempo ou caiu a conexão: o e-mail pode ter saído. O código
      // continua valendo e as vagas ficam contadas (não dá pra saber se gastou).
      throw new Recusa("Não deu pra confirmar o envio. Confira o seu e-mail em alguns minutos; se o código não chegar, peça outro.", 503);
    }
    if (urlTeste) return json({ ok: true, codigo_dev: codigo });
    // Mesma resposta pra qualquer e-mail: não diz se ela já tem perfil.
    return json({ ok: true });
  }

  if (rota === "/api/rede/codigo/entrar" && req.method === "POST") {
    exigirMesmaOrigem(req, url);
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    await freio(env, ip, "codigo_entrar", 20, 15);
    if (!env.CODIGO_SEGREDO) throw new Recusa("A entrada por código ainda não está disponível.", 503);
    const b = await corpo(req);
    const email = lerEmail(b.email);
    const codigo = String(b.codigo || "").replace(/\D/g, "");
    const vencido = "Código inválido ou vencido. Peça um novo.";

    // Teto de erros do dia por e-mail. Toda tentativa reserva uma vaga ANTES de
    // comparar (assim pedidos simultâneos não passam do teto) e a vaga volta se
    // o código estiver certo ou se nem houver código vivo. Pedir outro código não zera.
    const chaveErro = "erro:" + (await hmac(env.CODIGO_SEGREDO, "freio:" + email));
    const diaErro = await reservar(env, chaveErro, ERROS_DIA_EMAIL, diaSP(agora(env, req, url)));
    if (!diaErro) {
      await registrar(env, ip, "codigo_entrar");
      await env.DB.prepare("DELETE FROM codigos_rede WHERE email = ?").bind(email).run();
      throw new Recusa("Muitos códigos errados pra este e-mail hoje. Tente de novo amanhã.", 429);
    }

    // Mesma ideia por código: a tentativa é reservada no código antes de comparar,
    // e acima de 5 o código nem é lido.
    const c = await env.DB.prepare(
      `UPDATE codigos_rede SET tentativas = tentativas + 1
        WHERE email = ? AND expira > strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AND tentativas < ?
        RETURNING hash, tentativas`
    ).bind(email, CODIGO_TENTATIVAS).first();
    if (!c) {
      await devolver(env, chaveErro, diaErro);
      await registrar(env, ip, "codigo_entrar");
      throw new Recusa(vencido, 401);
    }

    const hash = await hashCodigo(env, email, codigo);
    if (codigo.length !== 6 || !igual(hash, c.hash)) {
      await registrar(env, ip, "codigo_entrar");
      if (c.tentativas >= CODIGO_TENTATIVAS) {
        await env.DB.prepare("DELETE FROM codigos_rede WHERE email = ?").bind(email).run();
        throw new Recusa("Código errado muitas vezes. Peça um novo.", 401);
      }
      throw new Recusa("Esse código não confere. Confira no e-mail e tente de novo.", 401);
    }
    // Uso único: só entra quem conseguir apagar o código (dois pedidos juntos, só um passa).
    const usado = await env.DB.prepare("DELETE FROM codigos_rede WHERE email = ? AND hash = ?").bind(email, hash).run();
    if (!usado.meta || !usado.meta.changes) throw new Recusa(vencido, 401);
    await devolver(env, chaveErro, diaErro);

    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("DELETE FROM sessoes_rede WHERE expira < strftime('%Y-%m-%dT%H:%M:%SZ', 'now')").run();
    await env.DB.prepare(
      `INSERT INTO sessoes_rede (token, email, nome, desafio_token, expira)
       VALUES (?, ?, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+${SESSAO_DIAS} days'))`
    ).bind(token, email).run();
    return json({ ok: true }, 200, 0, {
      "Set-Cookie": `${COOKIE_REDE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_DIAS * 86400}`,
    });
  }

  if (rota === "/api/area" && req.method === "GET") {
    const sessao = await sessaoRede(req, env);
    if (!sessao) throw new Recusa("Entre na sua área para continuar.", 401);
    // Entrou por código: só a rede. Percurso e avisos da comunidade são do desafio.
    if (!sessao.desafio_token) return json({ modo: "codigo", nome: sessao.nome || null });
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
      modo: "desafio",
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
    if (!sessao) throw new Recusa("Entre na sua área para continuar.", 401);
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

function lerEmail(v) {
  const email = texto(v, 200, "seu e-mail").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Recusa("Confira o e-mail: parece incompleto.");
  return email;
}

// Teste local: o código volta na resposta em vez de ir por e-mail. Precisa das
// duas travas juntas: a variável (só no .dev.vars, que não sobe no deploy) e o
// pedido chegando por localhost. No endereço publicado a segunda nunca vale.
function modoDevCodigo(env, url) {
  return env.MODO_DEV_CODIGO === "1" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

async function hmac(segredo, mensagem) {
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(mensagem))));
}
// Relógio do pedido. No teste local (as mesmas duas travas do código na tela)
// pode ser trocado pelo cabeçalho X-Relogio-Teste, pra simular a virada do dia.
function agora(env, req, url) {
  if (modoDevCodigo(env, url)) {
    const t = new Date(req.headers.get("X-Relogio-Teste") || "");
    if (!isNaN(t.getTime())) return t;
  }
  return new Date();
}
// Dia no fuso de SP (UTC-3, sem horário de verão desde 2019), como AAAA-MM-DD.
function diaSP(data) { return new Date(data.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10); }

// Reserva uma vaga no contador do dia. Soma e lê num comando só, e só soma se
// ainda houver vaga: recusa não infla o contador, e dois pedidos juntos nunca
// recebem a mesma vaga. Devolve o dia em que a vaga ficou (pra devolver nele
// mesmo) ou null se não coube. Dia novo (fuso de SP) recomeça do 1; pedido que
// chega com um dia mais velho que o do contador (virada no meio) conta no mais novo.
async function reservar(env, chave, max, dia) {
  const r = await env.DB.prepare(
    `INSERT INTO limites (chave, dia, n) VALUES (?1, ?2, 1)
     ON CONFLICT(chave) DO UPDATE SET
       n = CASE WHEN excluded.dia > limites.dia THEN 1 ELSE limites.n + 1 END,
       dia = MAX(limites.dia, excluded.dia)
     WHERE excluded.dia > limites.dia OR limites.n < ?3
     RETURNING dia`
  ).bind(chave, dia, max).first();
  return r ? r.dia : null;
}
// Devolve a vaga no dia em que ela foi reservada. Se o contador já virou pro
// dia seguinte, não mexe em nada: a vaga era do dia que acabou.
function devolver(env, chave, dia) {
  return env.DB.prepare(
    "UPDATE limites SET n = n - 1 WHERE chave = ? AND dia = ? AND n > 0"
  ).bind(chave, dia).run();
}

function hashCodigo(env, email, codigo) { return hmac(env.CODIGO_SEGREDO, "codigo:" + email + ":" + codigo); }

// Resend falso pros testes locais: só com as travas do modo de teste e só em localhost.
function urlResendTeste(env) {
  const u = env.RESEND_URL_TESTE || "";
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) ? u : null;
}

// Manda o código. Devolve "ok", "recusado" (o Resend respondeu que não mandou)
// ou "incerto" (estourou o tempo ou caiu a conexão: pode ter saído ou não).
async function enviarCodigo(env, email, codigo, endereco) {
  let resp;
  try {
    resp = await fetch(endereco, {
      signal: AbortSignal.timeout(RESEND_TEMPO_MS),
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE,
        to: [email],
        subject: `${codigo} é o seu código da Estrutura da Escuta`,
        text: `Seu código para entrar na rede da Estrutura da Escuta: ${codigo}\n\n` +
          `Ele vale por ${CODIGO_MINUTOS} minutos e só funciona uma vez.\n` +
          `Se não foi você que pediu, pode ignorar este e-mail.`,
      }),
    });
  } catch (e) {
    // Nunca registra o código: só o tipo do erro.
    console.error("resend", e && e.name);
    return "incerto";
  }
  if (!resp.ok) {
    console.error("resend", resp.status);
    // 5xx do lado deles também pode ter saído; só 4xx é recusa certa.
    return resp.status >= 400 && resp.status < 500 ? "recusado" : "incerto";
  }
  return "ok";
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
