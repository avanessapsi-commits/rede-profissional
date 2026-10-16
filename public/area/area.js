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
      .then(function (r) {
        // Quem entrou por código não recebe nada do desafio (o servidor já corta);
        // aqui só some com as seções vazias.
        var porCodigo = r[0].modo === "codigo";
        $("secao-desafio").hidden = porCodigo;
        $("secao-acoes").hidden = porCodigo;
        $("aviso-codigo").hidden = !porCodigo;
        $("num-perfil").textContent = porCodigo ? "i." : "iii.";
        $("area-intro").textContent = porCodigo
          ? "Aqui fica o seu perfil na rede de profissionais."
          : "Aqui ficam o seu resultado do desafio, os encontros da comunidade e o seu perfil na rede.";
        if (porCodigo) desenharOla(r[0].nome); else desenharArea(r[0]);
        desenharPerfil(r[1]);
        mostrar("area");
      })
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

  // ───── entrar com código por e-mail ─────
  var kPasso = 1;
  function kErro(msg) { $("k-erro").textContent = msg; $("k-erro").hidden = !msg; }
  function pedirCodigo() {
    var botao = $("k-botao");
    kErro("");
    botao.disabled = true; botao.textContent = "Enviando…";
    return api("POST", "/api/rede/codigo", { email: $("k-email").value.trim() })
      .then(function (d) {
        kPasso = 2;
        $("k-passo2").hidden = false; $("k-outro").hidden = false;
        $("k-email").readOnly = true;
        // Só no teste local o servidor devolve o código (nunca no portal publicado).
        $("k-enviado").textContent = d.codigo_dev
          ? "Teste local: o código é " + d.codigo_dev + "."
          : "Mandamos um código pro seu e-mail. Ele vale por 10 minutos. Confira também o spam.";
        $("k-codigo").value = ""; $("k-codigo").focus();
      })
      .catch(function (e) { kErro(e.message); })
      .then(function () { botao.disabled = false; botao.textContent = kPasso === 2 ? "Entrar" : "Receber código"; });
  }
  $("form-codigo").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (kPasso === 1) { pedirCodigo(); return; }
    var botao = $("k-botao");
    kErro("");
    botao.disabled = true; botao.textContent = "Entrando…";
    api("POST", "/api/rede/codigo/entrar", { email: $("k-email").value.trim(), codigo: $("k-codigo").value.trim() })
      .then(function () {
        kPasso = 1; $("k-passo2").hidden = true; $("k-outro").hidden = true; $("k-email").readOnly = false;
        return carregar();
      })
      .catch(function (e) { kErro(e.message); })
      .then(function () { botao.disabled = false; botao.textContent = kPasso === 2 ? "Entrar" : "Receber código"; });
  });
  $("k-reenviar").addEventListener("click", pedirCodigo);

  // ───── desafio e comunidade ─────
  function desenharOla(nome) {
    var primeiro = (nome || "").split(" ")[0];
    var ola = $("ola");
    ola.textContent = "";
    ola.appendChild(document.createTextNode("Olá, "));
    ola.appendChild(el("em", { texto: primeiro || "você" }));
    ola.appendChild(document.createTextNode("."));
  }
  function desenharArea(a) {
    desenharOla(a.nome);

    var d = a.desafio;
    $("progresso").textContent = d.concluidos === d.total
      ? "Você concluiu os " + d.total + " dias."
      : d.concluidos + " de " + d.total + " dias concluídos.";
    $("barra").style.width = Math.round((d.concluidos / d.total) * 100) + "%";

    var dias = $("dias");
    dias.textContent = "";
    d.dias.forEach(function (x) {
      var feito = !!x.concluido_em;
      var classe = "dia-desafio" + (feito ? "" : x.liberado ? " dia-desafio--aberto" : " dia-desafio--fechado");
      var texto = feito
        ? (x.ideias.length ? el("ul", null, x.ideias.map(function (i) { return el("li", { texto: i }); })) : el("p", { classe: "meta", texto: "Concluído em " + dataCurta(x.concluido_em) }))
        : el("p", { classe: "meta", texto: x.liberado ? "Esperando por você no desafio." : "Ainda não liberado." });
      dias.appendChild(el("article", { classe: classe }, [
        el("img", { classe: "foto-dia", src: "/img/desafio/dia-" + x.dia + ".webp", alt: "", loading: "lazy" }),
        el("div", { classe: "corpo" }, [
          el("p", { classe: "etiqueta", texto: "Dia " + x.dia + (feito ? " · " + dataCurta(x.concluido_em) : "") }),
          texto,
        ]),
      ]));
    });

    var acoes = $("acoes");
    acoes.textContent = "";
    if (!a.acoes.length) {
      acoes.appendChild(el("p", { classe: "vazio", texto: "Nenhum encontro ou aviso agora. Quando tiver, aparece aqui." }));
    }
    a.acoes.forEach(function (i) {
      if (i.data_evento) {
        var c = window.Portal.cartaoEvento(i);
        if (!i.link) { var d2 = el("div", { classe: "evento" }); while (c.firstChild) d2.appendChild(c.firstChild); c = d2; }
        acoes.appendChild(c);
        return;
      }
      var filhos = [
        el("p", { classe: "evento-data", "aria-hidden": "true" }, [el("span", { classe: "mes", texto: "Aviso" })]),
        el("div", null, [
          el("h3", { texto: i.titulo }),
          i.local ? el("p", { classe: "meta", texto: i.local }) : null,
          i.resumo ? el("p", { classe: "resumo", texto: i.resumo }) : null,
        ]),
      ];
      acoes.appendChild(i.link
        ? el("a", { classe: "evento", href: i.link, target: "_blank", rel: "noopener" }, filhos)
        : el("div", { classe: "evento" }, filhos));
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
      ? "Você ainda não tem perfil na rede. Preencha e salve: ele aparece na busca na hora, com o seu contato."
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
