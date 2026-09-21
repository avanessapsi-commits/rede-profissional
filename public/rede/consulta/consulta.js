// Grava a resposta direto na tabela public.rede_consulta_respostas do banco do
// Habitar. A chave abaixo é a publicável: pelas regras da tabela ela só consegue
// INSERIR ali, não lê nada nem alcança outra tabela. Por isso o Prefer
// return=minimal: pedir a linha de volta exigiria permissão de leitura.
(function () {
  var SUPABASE_URL = "https://xecshgdpzrxoyerlhicf.supabase.co";
  var CHAVE_PUBLICA = "sb_publishable_BwjQdU7LU_zFmuPpUx3qAw_tvfJ8lxz";

  var form = document.getElementById("consulta");
  var erro = document.getElementById("erro");
  var botao = document.getElementById("enviar");
  var obrigado = document.getElementById("obrigado");

  function valor(id) {
    var v = document.getElementById(id).value.trim();
    return v === "" ? null : v;
  }
  function marcado(nome) {
    var el = form.querySelector('input[name="' + nome + '"]:checked');
    return el ? el.value : null;
  }
  function mostrarErro(msg) {
    erro.textContent = msg;
    erro.hidden = false;
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    erro.hidden = true;
    form.querySelectorAll(".falta").forEach(function (el) { el.classList.remove("falta"); });

    // Robô preencheu a isca: finge que deu certo e não grava.
    if (valor("site")) { form.hidden = true; obrigado.hidden = false; return; }

    var dados = {
      nome: valor("nome"),
      area: valor("area"),
      email: valor("email"),
      toparia: marcado("toparia"),
      criterio_justo: marcado("criterio_justo"),
      criterio_comentario: valor("criterio_comentario"),
      expectativas: Array.prototype.map.call(
        form.querySelectorAll('input[name="expectativas"]:checked'),
        function (el) { return el.value; }
      ),
      perfil_diretorio: valor("perfil_diretorio"),
      comentario: valor("comentario"),
    };

    var faltando = [];
    if (!dados.nome) faltando.push(["nome", "seu nome"]);
    if (!dados.area) faltando.push(["area", "sua área de atuação"]);
    if (!dados.toparia) faltando.push(["f-toparia", "se você toparia fazer parte"]);
    if (!dados.criterio_justo) faltando.push(["f-criterio", "o que achou dos critérios"]);
    if (faltando.length) {
      faltando.forEach(function (f) {
        var el = document.getElementById(f[0]);
        (el.tagName === "FIELDSET" ? el : el.parentElement).classList.add("falta");
      });
      mostrarErro("Falta responder: " + faltando.map(function (f) { return f[1]; }).join(", ") + ".");
      document.getElementById(faltando[0][0]).scrollIntoView({ block: "center" });
      return;
    }

    botao.disabled = true;
    botao.textContent = "Enviando…";

    fetch(SUPABASE_URL + "/rest/v1/rede_consulta_respostas", {
      method: "POST",
      headers: {
        apikey: CHAVE_PUBLICA,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(dados),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        form.hidden = true;
        obrigado.hidden = false;
        obrigado.focus();
        window.scrollTo({ top: 0 });
      })
      .catch(function () {
        mostrarErro("Não conseguimos enviar agora. Confira sua internet e tente de novo. Se continuar, escreva para avanessapsi@gmail.com.");
        botao.disabled = false;
        botao.textContent = "Enviar respostas";
      });
  });
})();
