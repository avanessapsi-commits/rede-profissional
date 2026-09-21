// Portão de administração do portal.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // Campos de cada tipo, na ordem em que aparecem no formulário.
  var CAMPOS = {
    evento: [
      ["titulo", "Nome do evento", "text", true],
      ["data_evento", "Data", "date", true],
      ["hora", "Horário", "text", false, "Ex.: 19h"],
      ["local", "Onde", "text", false, "Cidade ou Online"],
      ["link", "Link do evento", "url", true, "https://"],
      ["resumo", "Resumo", "textarea", false],
    ],
    livro: [
      ["titulo", "Título", "text", true],
      ["autor", "Autora ou autor", "text", false],
      ["preco", "Preço na promoção", "text", true, "Ex.: R$ 39,90"],
      ["preco_original", "Preço normal", "text", false, "Ex.: R$ 69,90"],
      ["loja", "Loja", "text", false, "Ex.: Amazon"],
      ["link", "Link de compra (o de afiliada, se tiver)", "url", true, "https://"],
      ["imagem", "Link da imagem da capa", "url", false, "https://"],
      ["resumo", "Por que vale a leitura", "textarea", false],
    ],
    acao: [
      ["titulo", "Título", "text", true, "Ex.: Encontro ao vivo de outubro"],
      ["data_evento", "Data", "date", false],
      ["hora", "Horário", "text", false, "Ex.: 20h"],
      ["local", "Onde", "text", false, "Ex.: Zoom, Instagram, presencial em SP"],
      ["link", "Link", "url", false, "https://"],
      ["resumo", "Recado", "textarea", false],
    ],
    artigo: [
      ["titulo", "Título", "text", true],
      ["fonte", "Onde foi publicado", "text", false, "Revista, site ou periódico"],
      ["autor", "Autoria", "text", false],
      ["link", "Link do artigo", "url", true, "https://"],
      ["resumo", "Resumo curto", "textarea", false],
    ],
  };
  var NOMES = { evento: ["evento", "Novo evento"], livro: ["livro", "Novo livro"], artigo: ["artigo", "Novo artigo"], acao: ["aviso", "Novo aviso ou encontro"] };
  var DICAS = {
    evento: "Eventos passados somem do portal sozinhos no dia seguinte.",
    livro: "Preço muda rápido. Quando a promoção acabar, tire do ar ou exclua.",
    artigo: "O resumo aparece embaixo do título no portal.",
    acao: "Só quem fez o desafio vê, na área dela. Com data, some sozinho depois que passa.",
  };
  var NOMES_PUBLICO = { tentantes: "Tentantes", gestantes: "Gestantes", puerperas: "Puérperas", bebes: "Bebês e crianças", familias: "Famílias" };

  var aba = "evento", itens = [], editando = null;

  function el(tag, attrs, filhos) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === "texto") e.textContent = attrs[k];
      else if (k === "classe") e.className = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (filhos || []).forEach(function (f) { if (f) e.appendChild(typeof f === "string" ? document.createTextNode(f) : f); });
    return e;
  }

  function api(metodo, caminho, dados) {
    return fetch("/adm/api" + caminho, {
      method: metodo,
      headers: dados ? { "Content-Type": "application/json" } : {},
      body: dados ? JSON.stringify(dados) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && caminho !== "/entrar") { mostrar("entrar"); throw new Error(d.erro || "Entre de novo."); }
        if (!r.ok) throw new Error(d.erro || "Não deu certo. Tente de novo.");
        return d;
      });
    });
  }

  var timerAviso;
  function avisar(msg) {
    var a = $("aviso");
    a.textContent = msg; a.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () { a.hidden = true; }, 2600);
  }

  function mostrar(tela) {
    $("carregando").hidden = true;
    ["criar", "entrar", "painel"].forEach(function (t) { $("tela-" + t).hidden = t !== tela; });
    $("sair").hidden = tela !== "painel";
    if (tela === "painel") carregarTudo();
    if (tela === "entrar") setTimeout(function () { $("entrar-senha").focus(); }, 0);
  }

  // ───── entrada ─────
  api("GET", "/estado").then(function (e) { mostrar(e.logada ? "painel" : e.temSenha ? "entrar" : "criar"); })
    .catch(function (e) { $("carregando").textContent = e.message; });

  $("form-criar").addEventListener("submit", function (ev) {
    ev.preventDefault();
    api("POST", "/criar-senha", { codigo: $("criar-codigo").value.trim(), senha: $("criar-senha").value })
      .then(function () { mostrar("painel"); avisar("Senha criada. Guarde bem."); })
      .catch(function (e) { $("criar-erro").textContent = e.message; $("criar-erro").hidden = false; });
  });
  $("form-entrar").addEventListener("submit", function (ev) {
    ev.preventDefault();
    api("POST", "/entrar", { senha: $("entrar-senha").value })
      .then(function () { $("entrar-senha").value = ""; $("entrar-erro").hidden = true; mostrar("painel"); })
      .catch(function (e) { $("entrar-erro").textContent = e.message; $("entrar-erro").hidden = false; });
  });
  $("sair").addEventListener("click", function () { api("POST", "/sair", {}).then(function () { mostrar("entrar"); }); });

  // ───── abas ─────
  document.querySelectorAll(".abas button").forEach(function (b) {
    b.addEventListener("click", function () {
      aba = b.getAttribute("data-aba");
      document.querySelectorAll(".abas button").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
      fecharForm();
      desenhar();
    });
  });

  function carregarTudo() {
    return Promise.all([api("GET", "/itens"), api("GET", "/profissionais")]).then(function (r) {
      itens = r[0].itens;
      profissionais = r[1].profissionais;
      var pend = profissionais.filter(function (p) { return !p.aprovado; }).length;
      $("pendentes").textContent = pend; $("pendentes").hidden = !pend;
      desenhar();
    }).catch(function (e) { avisar(e.message); });
  }
  var profissionais = [];

  function desenhar() {
    var ehRede = aba === "rede";
    $("painel-conteudo").hidden = ehRede;
    $("painel-rede").hidden = !ehRede;
    if (ehRede) return desenharRede();
    $("novo").textContent = NOMES[aba][1];
    $("dica-aba").textContent = DICAS[aba];
    var lista = $("lista-itens");
    lista.textContent = "";
    var doTipo = itens.filter(function (i) { return i.tipo === aba; });
    if (!doTipo.length) {
      lista.appendChild(el("p", { classe: "vazio", texto: "Nenhum " + NOMES[aba][0] + " ainda. Clique em “" + NOMES[aba][1] + "” pra começar." }));
      return;
    }
    doTipo.forEach(function (i) {
      var sub = aba === "evento" || aba === "acao" ? [dataBr(i.data_evento), i.local].filter(Boolean).join(" · ")
        : aba === "livro" ? [i.autor, i.preco].filter(Boolean).join(" · ")
        : [i.fonte, i.autor].filter(Boolean).join(" · ");
      var passou = (aba === "evento" || aba === "acao") && i.data_evento && i.data_evento < hoje();
      lista.appendChild(el("div", { classe: "linha-adm" }, [
        el("div", null, [
          el("span", { classe: "estado " + (i.publicado && !passou ? "estado--no-ar" : "estado--fora"), texto: passou ? "Já passou" : i.publicado ? "No ar" : "Fora do ar" }),
          el("h3", { texto: i.titulo }),
          sub ? el("p", { classe: "meta", texto: sub }) : null,
        ]),
        el("div", { classe: "botoes-linha" }, [
          el("button", { type: "button", classe: "botao-leve", texto: "Editar", onclick: function () { abrirForm(i); } }),
          el("button", { type: "button", classe: "botao-leve", texto: i.publicado ? "Tirar do ar" : "Pôr no ar", onclick: function () { alternar(i); } }),
          el("button", { type: "button", classe: "botao-leve botao-perigo", texto: "Excluir", onclick: function () { excluir(i); } }),
        ]),
      ]));
    });
  }

  // ───── formulário de item ─────
  $("novo").addEventListener("click", function () { abrirForm(null); });

  function abrirForm(item) {
    editando = item;
    var f = $("form-item");
    f.textContent = "";
    f.appendChild(el("h2", { texto: item ? "Editar " + NOMES[aba][0] : NOMES[aba][1] }));
    CAMPOS[aba].forEach(function (c) {
      var nome = c[0], rotulo = c[1], tipo = c[2], obrig = c[3], dica = c[4];
      var campo = tipo === "textarea"
        ? el("textarea", { id: "i-" + nome, maxlength: "1200" })
        : el("input", { id: "i-" + nome, type: tipo, placeholder: dica || null, required: obrig || null });
      campo.value = item && item[nome] ? item[nome] : "";
      f.appendChild(el("label", { classe: "campo" }, [rotulo, obrig ? null : el("span", { classe: "opcional", texto: " (opcional)" }), campo]));
    });
    var pub = el("input", { type: "checkbox", id: "i-publicado" });
    pub.checked = item ? !!item.publicado : true;
    f.appendChild(el("label", { classe: "escolha" }, [pub, " No ar (aparece no portal)"]));
    f.appendChild(el("p", { classe: "aviso-erro", id: "i-erro", role: "alert", hidden: true }));
    f.appendChild(el("div", { classe: "acoes-form" }, [
      el("button", { type: "submit", classe: "enviar", texto: item ? "Salvar" : "Adicionar" }),
      el("button", { type: "button", classe: "botao-leve", texto: "Cancelar", onclick: fecharForm }),
    ]));
    f.hidden = false;
    $("novo").hidden = true;
    f.scrollIntoView({ block: "start", behavior: "smooth" });
    setTimeout(function () { $("i-titulo").focus(); }, 0);
  }
  function fecharForm() { $("form-item").hidden = true; $("novo").hidden = false; editando = null; }

  $("form-item").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var dados = { tipo: aba, publicado: $("i-publicado").checked };
    CAMPOS[aba].forEach(function (c) { dados[c[0]] = $("i-" + c[0]).value.trim(); });
    var feito = editando ? api("PUT", "/itens/" + editando.id, dados) : api("POST", "/itens", dados);
    var eraNovo = !editando;
    feito.then(function () { fecharForm(); avisar(eraNovo ? "Adicionado." : "Salvo."); return carregarTudo(); })
      .catch(function (e) { $("i-erro").textContent = e.message; $("i-erro").hidden = false; });
  });

  function alternar(i) {
    var dados = Object.assign({}, i, { publicado: !i.publicado });
    api("PUT", "/itens/" + i.id, dados).then(function () { avisar(dados.publicado ? "Está no ar." : "Saiu do ar."); return carregarTudo(); })
      .catch(function (e) { avisar(e.message); });
  }
  function excluir(i) {
    if (!confirm("Excluir “" + i.titulo + "”? Não dá pra desfazer.")) return;
    api("DELETE", "/itens/" + i.id).then(function () { avisar("Excluído."); return carregarTudo(); })
      .catch(function (e) { avisar(e.message); });
  }

  // ───── cadastros da rede ─────
  function desenharRede() {
    var lista = $("lista-rede");
    lista.textContent = "";
    if (!profissionais.length) {
      lista.appendChild(el("p", { classe: "vazio", texto: "Nenhum perfil ainda. Quando uma participante do desafio montar o dela em /area, aparece aqui." }));
      return;
    }
    profissionais.forEach(function (p) {
      var onde = [p.cidade, p.uf].filter(Boolean).join(" · ");
      var publicos = p.publicos.map(function (x) { return NOMES_PUBLICO[x]; }).join(", ");
      lista.appendChild(el("div", { classe: "linha-adm" }, [
        el("div", null, [
          el("span", { classe: "estado " + (p.aprovado ? "estado--no-ar" : "estado--novo"), texto: p.aprovado ? "Publicado" : "Novo" }),
          el("h3", { texto: p.nome }),
          el("div", { classe: "detalhes-rede" }, [
            el("span", { texto: [p.area, p.registro].filter(Boolean).join(" · ") }),
            onde || p.online ? el("span", { classe: "meta", texto: [onde, p.online ? "Atende online" : ""].filter(Boolean).join(" · ") }) : null,
            publicos ? el("span", { classe: "meta", texto: "Atende: " + publicos }) : null,
            p.descricao ? el("span", { texto: p.descricao }) : null,
            el("span", { classe: "meta", texto: "Contato público: " + p.contato }),
            el("span", { classe: "meta", texto: "E-mail (só você vê): " + p.email + " · chegou em " + dataBr(p.criado_em.slice(0, 10)) }),
          ]),
        ]),
        el("div", { classe: "botoes-linha" }, [
          el("button", { type: "button", classe: "botao-leve", texto: p.aprovado ? "Tirar da busca" : "Publicar", onclick: function () { aprovar(p); } }),
          el("button", { type: "button", classe: "botao-leve botao-perigo", texto: "Excluir", onclick: function () { excluirProf(p); } }),
        ]),
      ]));
    });
  }
  function aprovar(p) {
    api("PUT", "/profissionais/" + p.id, { aprovado: !p.aprovado })
      .then(function () { avisar(p.aprovado ? "Saiu da busca." : "Publicado na busca."); return carregarTudo(); })
      .catch(function (e) { avisar(e.message); });
  }
  function excluirProf(p) {
    if (!confirm("Excluir o cadastro de " + p.nome + "? Não dá pra desfazer.")) return;
    api("DELETE", "/profissionais/" + p.id).then(function () { avisar("Excluído."); return carregarTudo(); })
      .catch(function (e) { avisar(e.message); });
  }

  function hoje() {
    var d = new Date(Date.now() - 3 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function dataBr(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
})();
