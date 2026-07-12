# footbola-bot

GitHub Action com Playwright para tentar reservar o Campo Relvado Sintético de Odivelas às 21:00 da próxima sexta-feira, assim que a janela abrir ao domingo à meia-noite em `Europe/Lisbon`.

## Secrets necessários

No GitHub: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`.

- `SCL_USERNAME`: email de login em `https://odivelas.scl.pt/login.php`
- `SCL_PASSWORD`: password desse login

Opcional em `Variables`:

- `SCL_PLAYERS`: número de jogadores; por omissão usa `14`.

## Execução

A workflow corre automaticamente aos sábados à noite em UTC para apanhar domingo `00:00 Europe/Lisbon`, incluindo horário de verão/inverno. O script só tenta reservar quando está dentro da janela correta.

Também pode ser executada manualmente via `workflow_dispatch`. Por segurança, `dry_run` vem como `true` nas execuções manuais; nesse modo o script faz login, abre o modal e pára antes do clique final em `Reservar`.

Os screenshots/HTML autenticados não são guardados nem enviados por defeito. Só ativa `upload_artifacts=true` numa execução manual de debug, porque esses ficheiros podem conter dados da conta ou da reserva.
