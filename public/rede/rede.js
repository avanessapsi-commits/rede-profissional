// Busca e cadastro da rede. A busca baixa todos os perfis publicados de uma vez
// e filtra aqui mesmo: a rede é pequena, e assim o filtro responde na hora.
(function () {
  var el = window.Portal.el;
  var NOMES_PUBLICO = { tentantes: "Tentantes", gestantes: "Gestantes", puerperas: "Puérperas", bebes: "Bebês e crianças", familias: "Famílias" };
  var todos = [];

  var $ = function (id) { return document.getElementById(id); };
  var resultados = $("resultados"), contagem = $("contagem");

  function semAcento(s) { return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  function perfil(p) {
    var onde = [p.cidade, p.uf].filter(Boolean).join(" · ");
    var chips = (p.online ? ["Online"] : []).concat(p.publicos.map(function (x) { return NOMES_PUBLICO[x]; }));
    return el("article", { classe: "perfil" }, [
      el("p", { classe: "area", texto: p.area }),
      el("h3", { texto: p.nome }),
      onde || p.registro ? el("p", { classe: "meta" }, [onde ? el("span", { texto: onde }) : null, p.registro ? el("span", { texto: p.registro }) : null]) : null,
      p.descricao ? el("p", { classe: "descricao", texto: p.descricao }) : null,
      chips.length ? el("div", { classe: "chips" }, chips.map(function (c) { return el("span", { classe: "chip", texto: c }); })) : null,
      el("p", { classe: "contato", texto: p.contato }),
    ]);
  }

  function filtrar() {
    var texto = semAcento($("f-texto").value.trim());
    var area = $("f-area").value, uf = $("f-uf").value, publico = $("f-publico").value, online = $("f-online").checked;
    var lista = todos.filter(function (p) {
      if (area && p.area !== area) return false;
      if (uf && p.uf !== uf) return false;
      if (publico && p.publicos.indexOf(publico) < 0) return false;
      if (online && !p.online) return false;
      if (texto && semAcento(p.nome + " " + (p.cidade || "")).indexOf(texto) < 0) return false;
      return true;
    });
    resultados.textContent = "";
    if (!todos.length) {
      contagem.textContent = "";
      resultados.appendChild(el("p", { classe: "vazio", texto: "A rede está começando. Cadastre o seu trabalho e seja um dos primeiros nomes aqui." }));
      return;
    }
    contagem.textContent = lista.length === 1 ? "1 profissional" : lista.length + " profissionais";
    if (!lista.length) {
      resultados.appendChild(el("p", { classe: "vazio", texto: "Ninguém com esses filtros ainda. Tente tirar algum." }));
      return;
    }
    lista.forEach(function (p) { resultados.appendChild(perfil(p)); });
  }

  fetch("/api/rede")
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (d) { todos = d.profissionais; filtrar(); })
    .catch(function () {
      resultados.textContent = "";
      resultados.appendChild(el("p", { classe: "vazio", texto: "Não consegui carregar a rede agora. Atualize a página em instantes." }));
    });
  ["f-texto", "f-area", "f-uf", "f-publico", "f-online"].forEach(function (id) {
    $(id).addEventListener(id === "f-texto" ? "input" : "change", filtrar);
  });

  // ───── cadastro ─────
  var form = $("form-cadastro"), erro = $("c-erro"), botao = $("c-enviar");
  function v(id) { return $(id).value.trim(); }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    erro.hidden = true;
    var falta = [];
    if (!v("c-nome")) falta.push("nome");
    if (!v("c-area")) falta.push("área");
    if (!v("c-contato")) falta.push("como as famílias falam com você");
    if (!v("c-email")) falta.push("e-mail");
    if (falta.length) { erro.textContent = "Falta preencher: " + falta.join(", ") + "."; erro.hidden = false; return; }

    botao.disabled = true;
    botao.textContent = "Enviando…";
    fetch("/api/cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: v("c-nome"), area: v("c-area"), cidade: v("c-cidade"), uf: v("c-uf"),
        online: $("c-online").checked,
        publicos: Array.prototype.map.call(form.querySelectorAll('input[name="publicos"]:checked'), function (c) { return c.value; }),
        contato: v("c-contato"), registro: v("c-registro"), descricao: v("c-descricao"), email: v("c-email"),
        site: v("c-site"),
      }),
    })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.erro || "erro"); }); })
      .then(function () { form.hidden = true; $("c-ok").hidden = false; $("c-ok").focus(); })
      .catch(function (e) {
        erro.textContent = e.message && e.message !== "erro" && e.message !== "Failed to fetch"
          ? e.message
          : "Não consegui enviar agora. Confira sua internet e tente de novo.";
        erro.hidden = false;
        botao.disabled = false;
        botao.textContent = "Enviar cadastro";
      });
  });
})();
