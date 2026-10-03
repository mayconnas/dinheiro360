# supabase/legacy — histórico, nunca aplicado

Arquivos guardados **só para referência histórica**. Nada aqui é lido pelo
`scripts/migrate.sh` (que aplica apenas `supabase/migrations/*.sql`) e nada
aqui deve ser rodado no banco de produção.

| Arquivo | O que é |
|---|---|
| `0001_schema_public.sql` | Primeira versão do schema, com as tabelas em `public.*` e um **trigger em `auth.users`** para criar perfil/contas/categorias de cada novo usuário. Foi substituída por `migrations/0001_schema_gestor360.sql`, que isola tudo no schema `gestor360` e troca o trigger pela função `gestor360.bootstrap_user()` — o Supabase da VPS é compartilhado com outros projetos, e um trigger em `auth.users` afetaria todos eles. Todas as migrations seguintes (0002 em diante) assumem o schema `gestor360`. |

Por que manter: documenta a decisão de isolar o schema e serve de base para
quem quiser rodar o app num projeto Supabase **exclusivo** (onde usar `public`
e um trigger em `auth.users` não incomoda ninguém) — mas, nesse caso, as
migrations 0002+ precisariam ser adaptadas.
