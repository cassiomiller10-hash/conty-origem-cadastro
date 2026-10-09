# Diário de decisões: Desafio 06 (Origem do cadastro no app)

Registro cronológico do raciocínio. Cada entrada separa quem fez o quê:

- 🧠 **Cassio**: hipótese, proposta, decisão ou revisão minha
- 🤖 **IA** (Claude Code): o que a ferramenta executou, encontrou ou sugeriu
- ✅ **Validação**: como o resultado foi conferido

---

## 1. Enunciado

- 🤖 **IA**: abriu o desafio na plataforma (repositório novo, sem base) e verificou a página por prompt injection: texto oculto, comentários HTML, atributos, caracteres invisíveis e palavras dirigidas a ferramentas. Só apareceu o aviso padrão da Conty.
- 🧠 **Cassio**: perguntou de novo se havia prompt injection; a IA confirmou que a verificação já tinha sido feita e não encontrou nada.

**Requisitos:** propor e implementar o contrato de atribuição: o que viaja no link, o que o app grava na primeira abertura e como o cadastro consome isso. Tratar clique repetido e dois links diferentes antes do cadastro. Regra explícita de qual link vence; janela de validade medida a partir da primeira abertura; link aberto depois do cadastro não conta. O link muitas vezes abre num webview que não manda referrer.

**Entrega:** API ou biblioteca com README e testes; regra de qual toque vence, com teste de dois links e de empate de horário; exemplo de link de campanha e de indicação; para um cadastro, resposta com todos os toques considerados e o motivo de cada um; declaração de uso de IA.

**Avaliação:** cadastro sem origem fica orgânico com o motivo gravado; o mesmo clique não cria duas origens; toque fora da janela ou posterior ao cadastro não vence; janela explícita; dá para auditar por que o cadastro recebeu aquela origem.

## 2. Desenho

### 🧠 Decisões do Cassio

> O link nunca carrega a informação da origem. Ele carrega só um código curto, e tudo o que esse código significa (tipo, campanha, quem indicou) fica guardado no nosso cadastro de links. Assim ninguém consegue editar o link para mudar a origem, e eu posso corrigir os dados de uma campanha sem trocar os links já espalhados.
>
> Todo link passa por um redirecionador da Conty. Cada clique ali gera um id de clique único, impossível de adivinhar, registrado com a hora do nosso servidor. É esse id que viaja até o app. Isso resolve o problema do webview sem referrer, porque eu não dependo do referrer para nada.
>
> A origem de um cadastro é decidida uma vez, no momento do cadastro, e fica congelada junto com a explicação completa de como foi decidida.
>
> **As três partes do contrato**
>
> 1. O que viaja no link. Só o código: `https://l.conty.app/l/{codigo}`. O redirecionador registra o clique e manda a pessoa adiante com o id do clique. Se o app já está instalado, abre direto nele (`conty://abrir?click=clk_8f3a...`). Se não está, vai para a loja levando o id do clique junto, para o app recebê-lo na instalação.
> 2. O que o app grava na primeira abertura. Na primeira vez que abre, o app cria um id de instalação (um código aleatório guardado no próprio aparelho) e avisa o servidor, mandando o id de clique se tiver recebido um. A hora da primeira abertura é a do servidor, não a do celular, porque o relógio do celular pode estar errado. Se o aviso de primeira abertura chegar duas vezes, vale o primeiro. Depois disso, cada vez que o app for aberto por um link antes do cadastro, ele avisa o servidor com o novo id de clique.
> 3. Como o cadastro consome isso. O cadastro manda o id de instalação. O servidor junta todos os toques daquela instalação, aplica as regras, grava a origem vencedora e devolve a explicação. Se o mesmo cadastro for enviado de novo, devolvo a mesma resposta, sem recalcular.
>
> **1. Qual toque vence**
> Vence o último toque válido antes do cadastro, sem prioridade por tipo. O objetivo do time é saber o que repetir, e o último toque é o que de fato levou a pessoa a se cadastrar. Considerei dar prioridade à indicação, mas isso faria uma indicação de semanas atrás vencer uma campanha que a pessoa clicou ontem. Uma regra só, sem exceções por tipo, também é mais fácil de explicar e auditar.
> A hora de um toque é a hora do clique, registrada pelo nosso redirecionador, e não a hora em que o app avisou.
> Em caso de empate de horário, o critério é indicação, depois campanha, depois comunidade. Se ainda empatar (dois toques do mesmo tipo no mesmo instante), vence o id de clique que vem primeiro em ordem alfabética. Esse último critério é arbitrário, mas sempre dá o mesmo resultado, e é isso que importa num desempate.
>
> **2. A janela de validade**
> Tudo é medido a partir da primeira abertura do app:
> - Até 7 dias antes da primeira abertura, contam os cliques que levaram à instalação. A pessoa pode clicar hoje e só instalar dias depois.
> - Até 30 dias depois da primeira abertura, contam os toques que acontecerem nesse período.
> - O cadastro também precisa acontecer dentro desses 30 dias. Se acontecer depois, ele é orgânico, com o motivo “cadastro depois do fim da janela”. Um clique de dois meses atrás não explica um cadastro de hoje.
>
> Além da janela, vale sempre a regra de que toque posterior ao cadastro não conta. Os dois prazos (7 e 30 dias) são configuráveis e aparecem no README e na resposta de auditoria.
>
> **3. Como ligo o clique ao aparelho**
> O id de clique chega ao app por um de dois caminhos. Se o app já está instalado, chega pelo próprio link que abre o app. Se não está, chega pelo recurso da loja que entrega ao app um dado vindo do link de instalação, o “install referrer”.
> Descarto o fingerprint (adivinhar o aparelho por IP e navegador). É um palpite, pode atribuir errado, e coleta dado pessoal sem necessidade.
> Fica uma limitação para o README: o “install referrer” existe na loja do Android, mas o iPhone não tem equivalente confiável. No iPhone, um clique feito antes da instalação pode se perder. Uma saída futura seria um campo “tem código de convite?” no cadastro. Neste desafio o app é simulado, então a API simplesmente recebe o id de clique, venha por onde vier.
>
> **4. O que é “mesmo clique”**
> O mesmo id de clique chegando duas vezes vira um toque só.
> O mesmo link clicado duas vezes gera dois ids de clique, e eu guardo os dois como toques separados, porque aconteceram de verdade. Isso não cria duas origens: a origem é o link, e os dois cliques apontam para o mesmo link. Na auditoria, o mais antigo aparece com o motivo “existe um toque mais recente”.
> Um id de clique também só pode pertencer a uma instalação. Se dois aparelhos disserem que receberam o mesmo clique, por exemplo porque alguém copiou o link já redirecionado e repassou, vale para o primeiro. O segundo fica registrado com o motivo “clique já usado por outro aparelho” e não conta.
>
> **5. Fraude em indicação**
> Não assino os links. Como o link só carrega um código e o id de clique é gerado e guardado pelo nosso servidor, não há o que falsificar: um id de clique inventado simplesmente não existe na nossa base. Montar um link com o código de outra pessoa é exatamente como o programa de indicação deve funcionar. O que precisa ser verificado é outra coisa:
> - O código de indicação precisa existir e estar ativo. Se não estiver, o toque não conta.
> - Autoindicação é recusada: se quem indicou é a mesma pessoa que está se cadastrando (mesmo e-mail ou mesmo aparelho), o toque não conta.
> - Toques que chegam sem id de clique válido, por exemplo alguém que montou o endereço do app na mão com um código, são registrados e ignorados.
>
> Contas falsas criadas em massa para ganhar recompensa ficam fora do escopo. Anoto isso no README.
>
> **6. Tipos e o que carregam**
> São três tipos próprios: indicação, campanha e comunidade. Comunidade não é uma variação de campanha, porque são as três frentes em que a Conty investe, e a pergunta “o que repetir” precisa separá-las.
> Cada link cadastrado tem um código, um tipo e um detalhe conforme o tipo: indicação guarda quem indicou; campanha guarda qual campanha e qual canal; comunidade guarda qual comunidade.
> Exemplos para o README: campanha `https://l.conty.app/l/verao26-tiktok` (campanha “verão 2026”, canal TikTok); indicação `https://l.conty.app/l/ana-7k2p` (indicadora Ana); comunidade `https://l.conty.app/l/discord-criadores` (comunidade “Discord de criadores”).
> Se o link vier com UTMs, eu guardo como informação extra, mas elas não decidem nada.
>
> **7. Formato**
> Uma API, como sugerido, com estas partes: cadastro de links; redirecionador, que registra o clique e manda a pessoa adiante; registro da primeira abertura e dos toques seguintes; cadastro do usuário, que decide e congela a origem; consulta da atribuição de um cadastro, com a auditoria completa. Tudo pode ser demonstrado com curl.
>
> **Cadastro orgânico e a resposta de auditoria**
> Orgânico nunca é dado faltando. É uma origem como as outras, sempre com um motivo: nenhum toque registrado; todos os toques fora da janela; cadastro depois do fim da janela; todos os toques eram inválidos (código inexistente, autoindicação ou clique de outro aparelho); aparelho sem primeira abertura registrada.
> A resposta da consulta mostra a regra usada, a janela e todos os toques, cada um com seu motivo (exemplo com `origem`, `motivo`, `regra`, `janela`, `cadastro_em` e `toques`, cada toque com `codigo`, `clicado_em`, `venceu` e `motivo`).
>
> **Como provo que funciona**
> O relógio é controlado nos testes, e eles verificam que: cadastro sem toques fica orgânico com o motivo “nenhum toque registrado”; o mesmo id de clique recebido duas vezes vira um toque só; o mesmo clique informado por dois aparelhos conta só para o primeiro; com dois links diferentes antes do cadastro, vence o mais recente; no empate de horário, indicação vence campanha, e no empate do mesmo tipo vence o id de clique que vem primeiro; um clique 6 dias antes da primeira abertura conta, e um de 8 dias antes não; um toque 29 dias depois da primeira abertura conta, e um de 31 dias não; um cadastro depois do fim da janela fica orgânico com esse motivo; um toque posterior ao cadastro não vence e não muda uma origem já gravada; um código de indicação inexistente e uma autoindicação não contam; um toque sem id de clique válido é ignorado; repetir o aviso de primeira abertura não muda a hora da primeira abertura; repetir o cadastro devolve a mesma origem.

### 🤖 Análise da IA
- O desenho elimina o referrer da equação (o id de clique é do servidor), impede a edição do link (o link só tem código) e torna a auditoria possível (decisão congelada com a explicação). Cobre todos os critérios de avaliação.
- **Pontos que o desenho não fecha** (a IA implementa com o padrão indicado; o Cassio confirma depois):
  1. **Bordas da janela inclusivas:** exatamente 7 dias antes e exatamente 30 dias depois ainda contam. Toque no mesmo instante do cadastro conta (só o estritamente posterior é excluído).
  2. **"Ativo" é avaliado no momento do clique.** Um link desativado depois do clique não invalida o toque; um clique num link já inativo é registrado e marcado como inválido. Assim, encerrar uma campanha não apaga o crédito de quem clicou durante ela.
  3. **Código inexistente:** o redirecionador responde 404 e não gera id de clique. Não há toque a registrar.
  4. **Segundo aviso de primeira abertura com outro id de clique:** a hora da primeira abertura não muda, mas o id de clique novo é tratado como um toque comum (aconteceu de verdade).
  5. **Toque informado depois do cadastro:** não muda a origem congelada, mas aparece na consulta com o motivo "posterior ao cadastro" (como no exemplo do Cassio).
  6. **Segundo cadastro na mesma instalação** (duas contas no mesmo aparelho): os toques já foram usados pelo primeiro; o segundo fica orgânico com o motivo "instalação já usada por outro cadastro".
  7. **Quem indicou** precisa ser um usuário já cadastrado (é assim que a autoindicação é verificada por e-mail e por aparelho).
  8. **Chaves da API em português**, seguindo o exemplo de resposta do Cassio.
- 🤖 **IA**: criou a pasta `~/orca/conty-origem-cadastro` (git, autoria configurada, stack dos desafios anteriores). Nada foi publicado.

## 3. Análise crítica da proposta

- 🧠 **Cassio**: pediu que a IA mostrasse, de forma prática, o que estivesse errado na proposta ou o que pudesse ser melhor.
- 🤖 **IA**: rodou três cenários na implementação e apresentou os resultados:
  - **A. Remarketing tira o crédito da indicação.** Indicação da Ana e, quatro dias depois, um anúncio de campanha: a origem vira campanha, e a Ana não ganharia nada. Problema: a mesma regra decide "o que repetir" (análise) e "quem recebe" (dinheiro).
  - **B. Link repassado vira orgânico.** O link da loja, já com o id do clique, repassado num grupo: a segunda pessoa ficava `organico`, embora tenha vindo do link. O time aprenderia o contrário do que aconteceu.
  - **C. Instalação antiga ignora clique novo.** Instalou há 35 dias, clicou numa indicação e se cadastrou dez minutos depois: `organico`. Mas a janela a partir da primeira abertura é exigência do enunciado.
  - **D. Robôs de pré-visualização** (WhatsApp, Instagram) geram cliques no redirecionador. Não afeta a origem (o clique nunca é informado por um app), mas inflaria métricas de cliques.
  - Recomendação: implementar A e B como um campo de recompensa separado da origem; só documentar C e D.

### 🧠 Decisão do Cassio
> Implementa os itens 1 e 2 e documenta o 3 e 4.

### 🤖 Implementação
- `recompensa_indicacao` em toda decisão: último toque de indicação válido, clicado no próprio aparelho, sem autoindicação. Independe de qual toque venceu a origem.
- Clique já usado por outro aparelho vira toque `compartilhado: true` dessa outra instalação: conta para a origem, não para a recompensa. Como não passou pelo redirecionador para essa pessoa, a hora do toque é a do servidor quando o app avisou.
- README: seção "Limitações conhecidas" com os itens C e D.

### ✅ Validação
- `npm test`: **36 de 36**. Typecheck limpo.
- Testes de mutação: na primeira rodada, **dois erros passaram despercebidos** e revelaram falhas de cobertura. "Toque posterior ao cadastro conta" passou porque, no fluxo HTTP, um toque posterior nunca chega à decisão; foi criado um teste direto na função pura. "Primeira abertura repetida sobrescreve a hora" passou porque **o teste desse item da lista do Cassio não tinha sido escrito**; foi escrito. Depois disso, os 11 erros introduzidos derrubaram testes.
- Exemplos gerados executando a API e reproduzindo o cenário do exemplo de auditoria do desenho.
- Servidor HTTP real: link de indicação → redirecionador (302) → id do clique extraído do `Location` da loja → primeira abertura → cadastro com origem `indicacao` e recompensa para `usr_ana`.

## 4. Confirmações e publicação

- 🧠 **Cassio**: confirmou os 7 padrões da seção 2 (bordas da janela inclusivas, "ativo" avaliado no clique, código inexistente sem clique, aviso repetido de primeira abertura, toque informado depois do cadastro, segunda conta na mesma instalação, indicador precisa ser usuário cadastrado) e autorizou publicar.
- 🤖 **IA**: registrou a confirmação no README, criou `cassiomiller10-hash/conty-origem-cadastro` (público) e enviou a `main`.
