# Rede de Profissionais

Site da Estrutura da Escuta. Por enquanto só a Rede de Profissionais. Estático, sem build.

- `/rede` apresentação da rede (a raiz redireciona pra cá)
- `/rede/consulta` consulta com a comunidade

Separado do Habitar Planner de propósito: se um cair, o outro segue no ar.

## Relação com o Habitar

A única ligação é a tabela `public.rede_consulta_respostas` no banco do Habitar
(projeto Supabase `vanessa-planner`). O site usa a chave publicável, que pelas
regras da tabela só pode **inserir** ali. Não lê nada, nem as próprias respostas,
e não alcança nenhuma outra tabela. As respostas se leem pelo Habitar ou por SQL.

## Publicação

Cloudflare Workers (assets estáticos), conta adm.escutapsis, projeto `estruturadaescuta`
(estruturadaescuta.<conta>.workers.dev). Sem GitHub: publica com
`npx wrangler deploy` (config em `wrangler.jsonc`, arquivos em `public/`).
Cabeçalhos de segurança em `public/_headers`.
