# Rede de Profissionais

Site público da Rede de Profissionais da Arquitetura Materna. Estático, sem build.

- `/` apresentação da rede
- `/consulta` consulta com a comunidade

Separado do Habitar Planner de propósito: se um cair, o outro segue no ar.

## Relação com o Habitar

A única ligação é a tabela `public.rede_consulta_respostas` no banco do Habitar
(projeto Supabase `vanessa-planner`). O site usa a chave publicável, que pelas
regras da tabela só pode **inserir** ali. Não lê nada, nem as próprias respostas,
e não alcança nenhuma outra tabela. As respostas se leem pelo Habitar ou por SQL.

## Publicação

GitHub `contatoarquiteturamaterna-star/rede-profissional`, Vercel time `vanessa-0635`.
Push na `main` publica.
