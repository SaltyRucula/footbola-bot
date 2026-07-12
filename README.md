# footbola-bot

GitHub Action com Playwright para tentar reservar o Campo Relvado Sintético de Odivelas à hora configurada da próxima sexta-feira, assim que a janela abrir ao domingo à meia-noite em `Europe/Lisbon`.

## Secrets necessários

No GitHub: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`.

- `SCL_USERNAME`: email de login em `https://odivelas.scl.pt/login.php`
- `SCL_PASSWORD`: password desse login

Opcional em `Variables`:

- `SCL_PLAYERS`: número de jogadores; por omissão usa `14`.
- `SCL_TARGET_HOUR`: hora a reservar, em formato `HH:MM`; por omissão usa `20:00`.

## Execução

A workflow corre automaticamente aos sábados à noite em UTC para estar autenticada antes de domingo `00:00 Europe/Lisbon`, incluindo horário de verão/inverno. Depois do login, o script espera até `00:00:01 Europe/Lisbon` e só aí abre a página de reservas.

Também pode ser executada manualmente via `workflow_dispatch`. Por segurança, `dry_run` vem como `true` nas execuções manuais; nesse modo o script faz login, abre o modal e pára antes do clique final em `Reservar`.

Se usares `target_date` manualmente, confirma que é a sexta-feira pretendida. Uma data fora da sexta-feira ou fora da janela disponível pode não mostrar o botão da hora alvo.

Os screenshots/HTML autenticados não são guardados nem enviados por defeito. Só ativa `upload_artifacts=true` numa execução manual de debug, porque esses ficheiros podem conter dados da conta ou da reserva.
