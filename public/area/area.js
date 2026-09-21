// Área de quem fez o desafio: resultado, ações da comunidade e perfil na rede.
(function () {
  var el = window.Portal.el;
  var $ = function (id) { return document.getElementById(id); };
  var MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function api(metodo, caminho, dados) {
    return fetch(caminho, {
      method: metodo,
      headers: dados ? { "Content-Type": "application/json" } : {},
      body: dados ? JSON.stringify(dados) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.erro || "Não deu certo. Tente de novo."); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  function mostrar(tela) {
    $("carregando").hidden = true;
    $("tela-entrar").hidden = tela !== "entrar";
    $("tela-area").hidden = tela !== "area";
  }

  function dataCurta(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.getDate() + " " + MESES[d.getMonth()];
  }
  function dataEvento(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return parseInt(p[2], 10) + " de " + MESES[parseInt(p[1], 10) - 1];
  }

  function carregar() {
    return Promise.all([api("GET", "/api/area"), api("GET", "/api/rede/eu")])
      .then(function (r) { desenharArea(r[0]); desenharPerfil(r[1]); mostrar("area"); })
      .catch(function (e) {
        if (e.status === 401) {
          if (e.message.indexOf("outro lugar") >= 0) { $("e-erro").textContent = e.message; $("e-erro").hidden = false; }
          mostrar("entrar");
        } else { $("carregando").textContent = e.message; }
      });
  }

  // ───── entrar / sair ─────
  $("form-entrar").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var botao = $("e-botao");
    $("e-erro").hidden = true;
    botao.disabled = true; botao.textContent = "Entrando…";
    api("POST", "/api/rede/entrar", { email: $("e-email").value.trim(), senha: $("e-senha").value })
      .then(function () { $("e-senha").value = ""; return carregar(); })
      .catch(function (e) { $("e-erro").textContent = e.message; $("e-erro").hidden = false; })
      .then(function () { botao.disabled = false; botao.textContent = "Entrar"; });
  });
  $("sair").addEventListener("click", function () { api("POST", "/api/rede/sair", {}).then(function () { mostrar("entrar"); }); });

  // ───── desafio e comunidade ─────
  function desenharArea(a) {
    var primeiro = (a.nome || "").split(" ")[0];
    $("ola").textContent = primeiro ? "Olá, " + primeiro + "." : "Olá.";

    var d = a.desafio;
    $("progresso").textContent = d.concluidos === d.total
      ? "Você concluiu os " + d.total + " dias."
      : d.concluidos + " de " + d.total + " dias concluídos.";
    var dias = $("dias");
    dias.textContent = "";
    d.dias.forEach(function (x) {
      var estado = x.concluido_em ? "Dia " + x.dia : x.liberado ? "Dia " + x.dia : "Dia " + x.dia;
      var corpo = x.concluido_em
        ? (x.ideias.length ? el("ul", null, x.ideias.map(function (i) { return el("li", { texto: i }); })) : el("p", { classe: "meta", texto: "Concluído em " + dataCurta(x.concluido_em) }))
        : el("p", { classe: "meta", texto: x.liberado ? "Esperando por você no desafio." : "Ainda não liberado." });
      dias.appendChild(el("div", { classe: "dia" + (x.concluido_em ? "" : x.liberado ? " dia--aberto" : " dia--fechado") }, [
        el("p", { classe: "etiqueta", texto: estado }),
        corpo,
      ]));
    });

    var acoes = $("acoes");
    acoes.textContent = "";
    if (!a.acoes.length) {
      acoes.appendChild(el("p", { classe: "vazio", texto: "Nenhum encontro ou aviso agora. Quando tiver, aparece aqui." }));
    }
    a.acoes.forEach(function (i) {
      var meta = [i.data_evento ? dataEvento(i.data_evento) + (i.hora ? ", " + i.hora : "") : "", i.local].filter(Boolean).join(" · ");
      var filhos = [
        el("h3", { texto: i.titulo }),
        meta ? el("p", { classe: "meta", texto: meta }) : null,
        i.resumo ? el("p", { classe: "resumo", texto: i.resumo }) : null,
      ];
      acoes.appendChild(i.link
        ? el("a", { classe: "artigo", href: i.link, target: "_blank", rel: "noopener" }, filhos)
        : el("div", { classe: "artigo" }, filhos));
    });
  }

  // ───── perfil na rede ─────
  var temPerfil = false;
  function desenharPerfil(r) {
    temPerfil = r.existe;
    var p = r.perfil;
    $("c-nome").value = p.nome || "";
    $("c-area").value = p.area || "";
    $("c-cidade").value = p.cidade || "";
    $("c-uf").value = p.uf || "";
    $("c-online").checked = !!p.online;
    $("c-contato").value = p.contato || "";
    $("c-registro").value = p.registro || "";
    $("c-descricao").value = p.descricao || "";
    document.querySelectorAll('input[name="publicos"]').forEach(function (c) { c.checked = (p.publicos || []).indexOf(c.value) >= 0; });

    $("perfil-estado").textContent = !r.existe
      ? "Você ainda não tem perfil na rede. Preencha e salve: ele aparece na busca na hora."
      : r.publicado ? "Seu perfil está na busca. Pode editar quando quiser."
      : "Seu perfil está salvo, mas fora da busca no momento. Se tiver dúvida, fale com a Vanessa.";
    $("c-enviar").textContent = r.existe ? "Salvar alterações" : "Salvar e aparecer na busca";
    $("tirar").hidden = !r.existe;
    $("ver-busca").hidden = !(r.existe && r.publicado);
  }

  function v(id) { return $(id).value.trim(); }
  $("form-perfil").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var erro = $("c-erro"), botao = $("c-enviar");
    erro.hidden = true;
    var falta = [];
    if (!v("c-nome")) falta.push("nome");
    if (!v("c-area")) falta.push("área");
    if (!v("c-contato")) falta.push("como as famílias falam com você");
    if (falta.length) { erro.textContent = "Falta preencher: " + falta.join(", ") + "."; erro.hidden = false; return; }
    var texto = botao.textContent;
    botao.disabled = true; botao.textContent = "Salvando…";
    api("PUT", "/api/rede/eu", {
      nome: v("c-nome"), area: v("c-area"), cidade: v("c-cidade"), uf: v("c-uf"), online: $("c-online").checked,
      publicos: Array.prototype.map.call(document.querySelectorAll('input[name="publicos"]:checked'), function (c) { return c.value; }),
      contato: v("c-contato"), registro: v("c-registro"), descricao: v("c-descricao"),
    })
      .then(function () { return api("GET", "/api/rede/eu"); })
      .then(function (r) { desenharPerfil(r); $("perfil-estado").textContent = temPerfil && r.publicado ? "Salvo. Seu perfil está na busca." : "Salvo."; })
      .catch(function (e) { erro.textContent = e.message; erro.hidden = false; if (e.status === 401) mostrar("entrar"); })
      .then(function () { botao.disabled = false; if (botao.textContent === "Salvando…") botao.textContent = texto; });
  });

  $("tirar").addEventListener("click", function () {
    if (!confirm("Tirar o seu perfil da rede? Ele some da busca. Você pode montar de novo depois.")) return;
    api("DELETE", "/api/rede/eu").then(function () { return api("GET", "/api/rede/eu"); })
      .then(function (r) { desenharPerfil(r); $("perfil-estado").textContent = "Pronto, seu perfil saiu da rede."; })
      .catch(function (e) { $("c-erro").textContent = e.message; $("c-erro").hidden = false; });
  });

  carregar();
})();
