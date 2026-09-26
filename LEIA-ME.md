# Movivita Escalas

Sistema de convites e aceite voluntário de plantões da Movivita. Funciona inteiramente no Netlify (site, funções e banco de dados Netlify Database).

- Endereço das cuidadoras: a raiz do site (ex.: `https://escala.movivita.com.br/`)
- Endereço da Coordenação: `/coordenacao/`

## O que está incluído

Cuidadora: entrada por celular e PIN (com criação de PIN pessoal no primeiro acesso), convites com texto de voluntariedade e de compromisso, aceite e recusa, oferta aberta com primeiro aceite, comunicação de imprevisto, disponibilidade por turno, cobertura das famílias, lembretes, extrato mensal em PDF e avisos no celular.

Coordenação: cobertura semanal, rascunhos com sugestão, envio da distribuição em lote, cópia do padrão da semana anterior, convite direto, oferta aberta, alteração com novo aceite, cancelamento, quem pode cobrir, bloqueio de sobreposição e alerta de descanso, conferência individual e em lote, fechamento de período com ajustes registrados, extratos por cuidadora e por família em PDF, cadastros com habilitações, ajustes e acessos da Coordenação.

Toda ação relevante fica registrada no histórico do plantão, que nunca é apagado.

## Publicação (uma vez)

Todos os arquivos ficam na raiz do repositório, sem pastas. Na publicação, o Netlify executa `montar.mjs`, que reorganiza os arquivos nas pastas que ele espera (`public` e `netlify`). Por isso o envio pode ser feito pelo navegador do GitHub, arrastando os arquivos.

1. No repositório do GitHub, clique em *Add file → Upload files*, arraste **todos os arquivos** deste pacote e confirme em *Commit changes*.
2. O projeto no Netlify deve estar ligado a esse repositório. As configurações vêm do `netlify.toml`.
3. Variáveis de ambiente em *Project configuration → Environment variables*:

| Variável | Valor |
|---|---|
| `SETUP_TOKEN` | Código secreto usado só no primeiro acesso da Coordenação |
| `VAPID_PUBLIC_KEY` | Gerada pelo comando `npm run vapid` |
| `VAPID_PRIVATE_KEY` | Gerada pelo comando `npm run vapid` (marque como secreta) |
| `VAPID_SUBJECT` | Endereço do site da Movivita ou `mailto:` com o e-mail da Movivita |

4. O banco (Netlify Database) é criado automaticamente, e as tabelas são criadas na primeira vez que o sistema é usado, sem apagar dados existentes.

Sem as chaves VAPID, o sistema funciona normalmente, apenas sem os avisos no celular.

## Primeiro uso

1. Acesse `/coordenacao/`. Na tela de primeiro acesso, informe o `SETUP_TOKEN` e crie o acesso da primeira pessoa da Coordenação.
2. Em **Ajustes**, confira o descanso mínimo (padrão de 11 horas), o prazo de resposta dos convites (padrão de 48 horas) e se o valor aparece para a cuidadora. Ali também se criam os acessos das demais pessoas da Coordenação.
3. Em **Cadastros**, cadastre as famílias (com apelido operacional, como "Família R.") e as cuidadoras, marcando em quais famílias cada uma está habilitada.
4. Ao cadastrar uma cuidadora, o sistema mostra um PIN provisório de 6 números, uma única vez. Passe o PIN e o endereço do site a ela individualmente. No primeiro acesso ela cria o próprio PIN.
5. Oriente as cuidadoras a salvar o site na tela inicial do celular e a ativar os avisos. No iPhone, os avisos só funcionam depois de adicionar à tela de início e abrir pelo ícone.

## Rotina semanal

- Até segunda: cuidadoras informam indisponibilidades da semana seguinte.
- Segunda a quinta: a Coordenação monta os rascunhos (ou copia o padrão da semana anterior) e sugere as cuidadoras.
- Sexta: **Enviar convites da semana**. Sugestões em conflito ficam retidas para decisão.
- Semana seguinte: conferência dos plantões encerrados e fechamento do período em **Conferência**.

## Observações técnicas

- Fuso fixo de Goiânia (UTC−3).
- Senhas e PINs são armazenados com hash (scrypt). Sessões expiram em 30 dias (cuidadora) e 7 dias (Coordenação). Cinco tentativas erradas bloqueiam o acesso por 15 minutos.
- Os lembretes são enviados por uma função agendada a cada hora, 24 horas antes do início de cada plantão aceito.
- O Netlify cria um banco separado para cada deploy preview, com cópia dos dados de produção. Só o deploy de produção usa o banco principal.
- Cópia de segurança: recomendo exportar o banco periodicamente (por exemplo, com `pg_dump` usando a conexão exibida no painel do Netlify). Confirme no painel quais recursos de backup o seu plano oferece.
