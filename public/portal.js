// Desenha os cartões do portal a partir da API. Usado pela home e pelas
// páginas de eventos, livros e artigos. Tudo por textContent/createElement:
// o que vem do banco nunca vira HTML.
(function () {
  var MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var NOMES_TIPO = { evento: "Evento", livro: "Livro", artigo: "Artigo" };

  function el(tag, attrs, filhos) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === "texto") e.textContent = attrs[k];
      else if (k === "classe") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (filhos || []).forEach(function (f) { if (f) e.appendChild(f); });
    return e;
  }
  function linkExterno(href, classe, filhos, patrocinado) {
    return el("a", { href: href, classe: classe, target: "_blank", rel: patrocinado ? "sponsored noopener" : "noopener" }, filhos);
  }

  function dataLonga(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return parseInt(p[2], 10) + " de " + MESES[parseInt(p[1], 10) - 1] + " de " + p[0];
  }

  function cartaoEvento(i) {
    var dia = "", mes = "";
    if (i.data_evento) { var p = i.data_evento.split("-"); dia = String(parseInt(p[2], 10)); mes = MESES[parseInt(p[1], 10) - 1] + " " + p[0].slice(2); }
    var meta = el("p", { classe: "meta" }, [
      el("span", { texto: dataLonga(i.data_evento) + (i.hora ? ", " + i.hora : "") }),
      i.local ? el("span", { texto: i.local }) : null,
    ]);
    return linkExterno(i.link, "evento", [
      el("p", { classe: "evento-data", "aria-hidden": "true" }, [el("span", { classe: "dia", texto: dia }), el("span", { classe: "mes", texto: mes })]),
      el("div", null, [el("h3", { texto: i.titulo }), meta, i.resumo ? el("p", { classe: "resumo", texto: i.resumo }) : null]),
    ]);
  }

  function cartaoLivro(i) {
    var capa = i.imagem
      ? el("img", { classe: "livro-capa", src: i.imagem, alt: "Capa de " + i.titulo, loading: "lazy" })
      : el("div", { classe: "livro-capa livro-capa--vazia", texto: i.titulo });
    var preco = el("p", { classe: "preco", texto: i.preco }, [i.preco_original ? el("s", { texto: i.preco_original }) : null]);
    return linkExterno(i.link, "livro", [
      capa,
      el("h3", { texto: i.titulo }),
      i.autor ? el("p", { classe: "meta", texto: i.autor }) : null,
      preco,
      i.loja ? el("p", { classe: "meta", texto: "na " + i.loja }) : null,
    ], true);
  }

  function cartaoArtigo(i) {
    var fonte = [i.fonte, i.autor].filter(Boolean).join(" · ");
    return linkExterno(i.link, "artigo", [
      fonte ? el("p", { classe: "fonte", texto: fonte }) : null,
      el("h3", { texto: i.titulo }),
      i.resumo ? el("p", { classe: "resumo", texto: i.resumo }) : null,
    ]);
  }

  function cartaoFresco(i) {
    var detalhe = i.tipo === "evento" ? dataLonga(i.data_evento) + (i.local ? " · " + i.local : "")
      : i.tipo === "livro" ? [i.autor, i.preco].filter(Boolean).join(" · ")
      : [i.fonte, i.autor].filter(Boolean).join(" · ");
    return linkExterno(i.link, "fresco", [
      el("p", { classe: "etiqueta", texto: NOMES_TIPO[i.tipo] }),
      el("div", null, [el("h3", { texto: i.titulo }), detalhe ? el("p", { classe: "meta", texto: detalhe }) : null]),
    ], i.tipo === "livro");
  }

  var DESENHO = { evento: cartaoEvento, livro: cartaoLivro, artigo: cartaoArtigo, fresco: cartaoFresco };

  // Preenche um contêiner [data-lista] com os itens de um tipo.
  // data-vazio: texto quando não há nada; data-esconder: some a seção inteira.
  function preencher(alvo) {
    var tipo = alvo.getAttribute("data-lista");
    var limite = alvo.getAttribute("data-limite") || "60";
    var url = "/api/conteudo?limite=" + limite + (tipo === "fresco" ? "" : "&tipo=" + tipo);
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) {
        alvo.textContent = "";
        if (!d.itens.length) {
          var secao = alvo.getAttribute("data-esconder") && alvo.closest("section");
          if (secao) { secao.hidden = true; return 0; }
          alvo.appendChild(el("p", { classe: "vazio", texto: alvo.getAttribute("data-vazio") || "Nada por aqui ainda." }));
          return 0;
        }
        d.itens.forEach(function (i) { alvo.appendChild(DESENHO[tipo](i)); });
        return d.itens.length;
      })
      .catch(function () {
        alvo.textContent = "";
        alvo.appendChild(el("p", { classe: "vazio", texto: "Não consegui carregar agora. Atualize a página em instantes." }));
        return -1;
      });
  }

  var alvos = Array.prototype.slice.call(document.querySelectorAll("[data-lista]"));
  Promise.all(alvos.map(preencher)).then(function (totais) {
    // Home sem nenhum conteúdo publicado ainda: mostra o aviso de "em breve".
    var aviso = document.getElementById("tudo-vazio");
    if (aviso && totais.every(function (n) { return n === 0; })) aviso.hidden = false;
  });

  window.Portal = { el: el };
})();
