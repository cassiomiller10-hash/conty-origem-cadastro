# Origem do cadastro no app

Contrato de atribuição de origem para cadastros no app da Conty (indicação, campanha ou comunidade), feito para funcionar mesmo quando o link abre num webview que não manda referrer. A origem de cada cadastro é decidida uma vez, congelada e auditável: a resposta mostra todos os toques considerados e o motivo de cada um ter vencido ou não.

## Como rodar

Node 22.

```bash
npm install
npm test
npm run dev   # http://127.0.0.1:3006, banco em data/origem.sqlite
```

Exemplos completos de request e response: [`docs/EXEMPLOS.md`](docs/EXEMPLOS.md).

## O contrato, em três partes

**1. O que viaja no link: só um código.** `https://l.conty.app/l/{codigo}`. O significado do código (tipo, campanha, quem indicou) fica no cadastro de links, no servidor. Ninguém consegue editar o link para mudar a origem, e os dados de uma campanha podem ser corrigidos (`PATCH /links/:codigo`) sem trocar links já espalhados.

| Exemplo | Tipo | Detalhe guardado no servidor |
|---|---|---|
| `https://l.conty.app/l/verao26-tiktok` | campanha | campanha "verão 2026", canal TikTok |
| `https://l.conty.app/l/ana-7k2p` | indicação | indicadora: usuária `usr_ana` |
| `https://l.conty.app/l/discord-criadores` | comunidade | "Discord de criadores" |

Todo link passa pelo **redirecionador** (`GET /l/:codigo`). Cada passagem gera um **id de clique** aleatório (`clk_` + 128 bits), registrado com a **hora do servidor**, e segue para o app (`conty://abrir?click=…`) ou para a loja, com o id no *install referrer*. O referrer do navegador nunca é usado. UTMs que vierem no link são guardadas no clique como informação extra e não decidem nada.

**2. O que o app grava na primeira abertura.** O app cria um id de instalação (aleatório, guardado no aparelho) e chama `POST /instalacoes`, com o id de clique se o tiver recebido. A hora da primeira abertura é a do servidor. Se o aviso repetir, vale o primeiro (um id de clique novo nesse aviso vira toque comum). Depois, cada vez que o app abrir por um link antes do cadastro, ele chama `POST /instalacoes/:id/toques`.

**3. Como o cadastro consome isso.** `POST /cadastros` com o id de instalação. O servidor junta os toques daquela instalação, aplica a regra, **grava a origem e a explicação** e devolve as duas. O mesmo cadastro enviado de novo recebe a mesma resposta, sem recalcular.

## Qual toque vence

> **Último toque válido antes do cadastro.** Empate de horário: indicação > campanha > comunidade > menor id de clique.

- Não há prioridade por tipo: uma indicação de semanas atrás não deve vencer a campanha que a pessoa clicou ontem. O tipo só desempata horários iguais. O último critério (menor id) é arbitrário, mas determinístico.
- A hora de um toque é a do clique no redirecionador, não a hora em que o app avisou.

A regra inteira está numa função pura, [`src/attribution.ts`](src/attribution.ts) (`decideOrigin`).

### Janela de validade (a partir da primeira abertura)

| | Padrão (configurável) |
|---|---|
| Cliques que levaram à instalação | até **7 dias antes** da primeira abertura |
| Toques depois da primeira abertura | até **30 dias depois** |
| Cadastro | também até **30 dias depois** da primeira abertura |

As bordas são inclusivas (exatamente 7 dias antes e exatamente 30 dias depois contam). Toque posterior ao cadastro nunca conta. A janela usada vai em toda resposta (`janela.inicio`, `janela.fim`).

### Quando um toque não conta

| Motivo na auditoria | Situação |
|---|---|
| `fora da janela (antes do início)` / `(depois do fim)` | Fora dos 7 dias antes ou dos 30 depois |
| `posterior ao cadastro` | Clicado depois do cadastro (não muda a origem já gravada) |
| `cadastro depois do fim da janela` | O toque estava na janela, mas o cadastro não |
| `link inativo no momento do clique` | O link estava desativado quando foi clicado (desativar depois não tira o crédito) |
| `autoindicação` | Quem indicou tem o mesmo e-mail ou o mesmo aparelho de quem se cadastra |
| `id de clique desconhecido` | O app informou um id que o redirecionador nunca gerou |
| `existe um toque mais recente` / `empate de horário: perdeu para …` | Válido, mas não venceu |

**Cadastro sem origem é `organico`, sempre com motivo:** `nenhum toque registrado`, `todos os toques fora da janela`, `cadastro depois do fim da janela`, `todos os toques eram inválidos`, `todos os toques são posteriores ao cadastro`, `aparelho sem primeira abertura registrada` ou `instalação já usada por outro cadastro`.

## Mesmo clique, link repassado e recompensa de indicação

- **Mesmo id de clique informado duas vezes** pela mesma instalação: um toque só.
- **Mesmo link clicado duas vezes:** dois ids de clique, dois toques, uma origem (o link). Na auditoria, o mais antigo aparece como "existe um toque mais recente".
- **Um id de clique pertence à primeira instalação que o informar.** Se outro aparelho informar o mesmo id (o link da loja foi repassado num grupo, por exemplo), esse aparelho **herda a origem do link**, marcada como `compartilhado: true`. A pessoa veio daquele link, e o time precisa saber disso. A hora desse toque é a do servidor quando o app avisou, porque ele não passou pelo redirecionador.
- **Origem e recompensa são perguntas separadas.** "De onde veio o cadastro" responde o que repetir (último toque). "Quem recebe pela indicação" mexe com dinheiro e vai em `recompensa_indicacao`:
  > Último toque de **indicação** válido, clicado **no próprio aparelho** (clique compartilhado não conta), sem autoindicação.

  Por isso uma campanha de remarketing clicada depois **vence a origem, mas não tira a recompensa de quem indicou**, e um link repassado **dá origem, mas não recompensa**.

## Endpoints

| Endpoint | O que faz |
|---|---|
| `POST /links` `{ codigo, tipo, … }` | Cadastra link (`campanha` + `canal`; `indicador_id`; `comunidade`) |
| `PATCH /links/:codigo` | Corrige detalhes ou ativa/desativa (o tipo não muda) |
| `GET /l/:codigo` | Redirecionador: registra o clique e responde 302 para a loja; o corpo traz `clique_id`, `app_url` e `loja_url` |
| `POST /instalacoes` `{ instalacao_id, clique_id? }` | Primeira abertura do app |
| `POST /instalacoes/:id/toques` `{ clique_id }` | App aberto por um link depois da primeira abertura |
| `POST /cadastros` `{ usuario_id, email, instalacao_id }` | Decide e congela a origem; devolve a auditoria |
| `GET /cadastros/:usuarioId/origem` | Auditoria: a decisão congelada mais os toques informados depois do cadastro |

## Testes

`npm test` roda 36 testes com relógio controlado:

- Os 13 casos do desenho: sem toques, mesmo id duas vezes, clique em dois aparelhos, dois links, empate por tipo e por id, 6 × 8 dias antes, 29 × 31 dias depois, cadastro fora da janela, toque posterior, indicação inexistente e autoindicação, id de clique inventado, primeira abertura repetida e cadastro repetido.
- Recompensa separada da origem: campanha posterior não tira a recompensa, link repassado sem recompensa, autoindicação, fora da janela, duas indicações.
- A regra como função pura ([`test/rules.test.ts`](test/rules.test.ts)), com casos que o fluxo HTTP não consegue montar (toque posterior ao cadastro dentro da decisão).

Para conferir que os testes pegam erros de verdade, foram introduzidos erros de propósito: primeiro toque vencendo, desempate invertido, janelas de 8 e 31 dias, toque posterior contando, sem autoindicação, clique compartilhado gerando recompensa, recompensa presa à origem, cadastro repetido recalculando, primeira abertura sobrescrita e clique tomado por outro aparelho. Cada um derrubou pelo menos um teste. Na primeira rodada, dois desses erros passaram despercebidos e revelaram testes que faltavam; os testes foram escritos e os dois erros passaram a ser pegos.

## Limitações conhecidas

- **Instalação antiga ignora clique novo.** A janela é medida a partir da primeira abertura, como pede o enunciado. Então quem instalou há 35 dias, esqueceu do app e hoje clica numa indicação e se cadastra dez minutos depois fica `organico` ("cadastro depois do fim da janela"), mesmo com um clique recente e confiável. Com mais tempo, toques depois da primeira abertura (reengajamento) teriam janela própria, contada a partir do clique.
- **Robôs de pré-visualização geram cliques.** Quando o link é colado no WhatsApp ou no Instagram, o robô que monta a prévia acessa `/l/{codigo}` e cria um clique. Isso **não afeta a origem**: esse clique nunca é informado por um app, então nunca vira toque. Mas qualquer métrica de "cliques por link" ficaria inflada. Se essa métrica existir, ela deve contar só cliques vinculados a uma instalação (ou filtrar user agents conhecidos de robôs).
- **iPhone.** O *install referrer* existe na Play Store; o iPhone não tem equivalente confiável, e um clique feito antes da instalação pode se perder lá. Uma saída futura é um campo "tem código de convite?" no cadastro. Aqui o app é simulado: a API recebe o id de clique, venha por onde vier.
- **Contas falsas em massa** para ganhar recompensa de indicação ficam fora do escopo. A verificação cobre autoindicação por e-mail e por aparelho, e cliques repassados não geram recompensa.
- **Sem fingerprint** (IP + navegador) por decisão: é palpite, pode atribuir errado e coleta dado pessoal sem necessidade.
- **Autenticação da API** (quem pode criar links, quem pode registrar cadastros) fora do escopo.

## Uso de IA

Ferramenta: Claude Code (Claude Opus 5.5).

- **Decisões minhas:** link só com código e significado no servidor; redirecionador com id de clique e hora do servidor, sem depender de referrer; as três partes do contrato; último toque válido, com desempate por tipo e por id de clique; janela de 7 dias antes e 30 depois da primeira abertura, com o cadastro também dentro dela; id de clique por *install referrer* ou deep link, sem fingerprint; mesmo id = um toque, mesmo link clicado duas vezes = dois toques e uma origem, um clique por aparelho; sem assinatura de link, com indicação ativa e sem autoindicação; três tipos próprios; orgânico sempre com motivo; a resposta de auditoria; a lista do que os testes precisam provar. Depois da análise crítica da IA, decidi separar a recompensa da origem, fazer o link repassado herdar a origem sem recompensa e documentar as duas limitações seguintes.
- **Feito pela IA:** a verificação de prompt injection na página; os padrões para os pontos que o desenho não fechava, confirmados por mim (bordas inclusivas, "ativo" avaliado no clique, código inexistente sem clique, aviso repetido de primeira abertura, toque informado depois do cadastro, segunda conta na mesma instalação, indicador precisa ser usuário cadastrado); a análise crítica com três cenários executados (remarketing tirando crédito da indicação, link repassado virando orgânico, instalação antiga) e a sugestão de separar origem de recompensa; toda a implementação, os testes e os testes de mutação; os exemplos, gerados executando a API; o rascunho deste README.
- **O que revisei:** a revisão foi feita ao longo do processo, junto com a ferramenta. Cada decisão foi discutida comigo antes de virar código, e acompanhei os testes, os cenários e as validações.

O raciocínio passo a passo, separando o que foi meu e o que foi da IA, está em [`DECISOES.md`](DECISOES.md).
