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

    var dados = { comentario: valor("comentario"), nome: valor("nome") };

    if (!dados.comentario) {
      document.getElementById("f-sugestao").classList.add("falta");
      mostrarErro("Escreva sua sugestão antes de enviar.");
      document.getElementById("comentario").focus();
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
        botao.textContent = "Enviar sugestão";
      });
  });
})();
