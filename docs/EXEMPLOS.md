# Exemplos de request e response

Gerados executando a API com o relógio controlado dos testes, reproduzindo o cenário do exemplo de auditoria do desenho: indicação clicada em 20/09 (fora da janela), comunidade em 09/10, campanha em 11/10, cadastro em 12/10 e uma indicação clicada depois do cadastro. Os ids de clique são aleatórios e mudam a cada execução; contra o `npm run dev`, os horários serão os do relógio real, e cada comando usa o `clique_id` devolvido pelo anterior.

### 1. Link de campanha: https://l.conty.app/l/verao26-tiktok
```bash
curl -s -X POST localhost:3006/links \
  -H 'content-type: application/json' \
  -d '{"codigo":"verao26-tiktok","tipo":"campanha","campanha":"verão 2026","canal":"tiktok"}'
```
`201`
```json
{
  "codigo": "verao26-tiktok",
  "tipo": "campanha",
  "campanha": "verão 2026",
  "canal": "tiktok",
  "ativo": true
}
```

### 1. Link de indicacao: https://l.conty.app/l/ana-7k2p
```bash
curl -s -X POST localhost:3006/links \
  -H 'content-type: application/json' \
  -d '{"codigo":"ana-7k2p","tipo":"indicacao","indicador_id":"usr_ana"}'
```
`201`
```json
{
  "codigo": "ana-7k2p",
  "tipo": "indicacao",
  "indicador_id": "usr_ana",
  "ativo": true
}
```

### 1. Link de comunidade: https://l.conty.app/l/discord-criadores
```bash
curl -s -X POST localhost:3006/links \
  -H 'content-type: application/json' \
  -d '{"codigo":"discord-criadores","tipo":"comunidade","comunidade":"Discord de criadores"}'
```
`201`
```json
{
  "codigo": "discord-criadores",
  "tipo": "comunidade",
  "comunidade": "Discord de criadores",
  "ativo": true
}
```

### 2. Clique no redirecionador (link de indicação, 20/09)
```bash
curl -s -i localhost:3006/l/ana-7k2p
```
`302` com `Location: https://play.google.com/store/apps/details?id=app.conty&referrer=click%3Dclk_868417bd27d258da844be7c130c37cde`
```json
{
  "clique_id": "clk_868417bd27d258da844be7c130c37cde",
  "app_url": "conty://abrir?click=clk_868417bd27d258da844be7c130c37cde",
  "loja_url": "https://play.google.com/store/apps/details?id=app.conty&referrer=click%3Dclk_868417bd27d258da844be7c130c37cde"
}
```

### 3. Primeira abertura do app, com o id do clique que veio pela loja
```bash
curl -s -X POST localhost:3006/instalacoes \
  -H 'content-type: application/json' \
  -d '{"instalacao_id":"inst-bruno-aparelho-01","clique_id":"clk_868417bd27d258da844be7c130c37cde"}'
```
`201`
```json
{
  "instalacao_id": "inst-bruno-aparelho-01",
  "primeira_abertura": "2026-10-08T10:00:00.000Z",
  "ja_registrada": false,
  "toque": "aceito"
}
```

### 4. App aberto por outro link antes do cadastro
```bash
curl -s -X POST localhost:3006/instalacoes/inst-bruno-aparelho-01/toques \
  -H 'content-type: application/json' \
  -d '{"clique_id":"clk_8f781bc05ba587cc4fe6cf395a64479d"}'
```
`201`
```json
{
  "instalacao_id": "inst-bruno-aparelho-01",
  "clique_id": "clk_8f781bc05ba587cc4fe6cf395a64479d",
  "toque": "aceito"
}
```

### 5. Cadastro: a origem é decidida e congelada, com a explicação
```bash
curl -s -X POST localhost:3006/cadastros \
  -H 'content-type: application/json' \
  -d '{"usuario_id":"usr_bruno","email":"usr_bruno@exemplo.com","instalacao_id":"inst-bruno-aparelho-01"}'
```
`201`
```json
{
  "usuario_id": "usr_bruno",
  "ja_cadastrado": false,
  "origem": {
    "tipo": "campanha",
    "codigo": "verao26-tiktok",
    "detalhe": {
      "campanha": "verão 2026",
      "canal": "tiktok"
    }
  },
  "motivo": "último toque válido antes do cadastro",
  "regra": "último toque válido antes do cadastro; empate de horário: indicação > campanha > comunidade > menor id de clique",
  "janela": {
    "antes_dias": 7,
    "depois_dias": 30,
    "primeira_abertura": "2026-10-08T10:00:00.000Z",
    "inicio": "2026-10-01T10:00:00.000Z",
    "fim": "2026-11-07T10:00:00.000Z"
  },
  "cadastro_em": "2026-10-12T15:30:00.000Z",
  "toques": [
    {
      "clique_id": "clk_868417bd27d258da844be7c130c37cde",
      "codigo": "ana-7k2p",
      "tipo": "indicacao",
      "clicado_em": "2026-09-20T09:00:00.000Z",
      "compartilhado": false,
      "venceu": false,
      "motivo": "fora da janela (antes do início)"
    },
    {
      "clique_id": "clk_fc7d7d044e711e877cefea7e3c205296",
      "codigo": "discord-criadores",
      "tipo": "comunidade",
      "clicado_em": "2026-10-09T18:00:00.000Z",
      "compartilhado": false,
      "venceu": false,
      "motivo": "existe um toque mais recente"
    },
    {
      "clique_id": "clk_8f781bc05ba587cc4fe6cf395a64479d",
      "codigo": "verao26-tiktok",
      "tipo": "campanha",
      "clicado_em": "2026-10-11T20:00:00.000Z",
      "compartilhado": false,
      "venceu": true,
      "motivo": "último toque válido"
    }
  ],
  "recompensa_indicacao": {
    "elegivel": false,
    "codigo": null,
    "indicador_id": null,
    "clique_id": null,
    "motivo": "nenhuma indicação elegível: fora da janela (antes do início)",
    "regra": "recompensa: último toque de indicação válido, clicado no próprio aparelho (clique compartilhado não conta), sem autoindicação"
  }
}
```

### 6. Auditoria depois de um toque posterior ao cadastro (a origem não muda)
```bash
curl -s localhost:3006/cadastros/usr_bruno/origem
```
`200`
```json
{
  "usuario_id": "usr_bruno",
  "origem": {
    "tipo": "campanha",
    "codigo": "verao26-tiktok",
    "detalhe": {
      "campanha": "verão 2026",
      "canal": "tiktok"
    }
  },
  "motivo": "último toque válido antes do cadastro",
  "regra": "último toque válido antes do cadastro; empate de horário: indicação > campanha > comunidade > menor id de clique",
  "janela": {
    "antes_dias": 7,
    "depois_dias": 30,
    "primeira_abertura": "2026-10-08T10:00:00.000Z",
    "inicio": "2026-10-01T10:00:00.000Z",
    "fim": "2026-11-07T10:00:00.000Z"
  },
  "cadastro_em": "2026-10-12T15:30:00.000Z",
  "toques": [
    {
      "clique_id": "clk_868417bd27d258da844be7c130c37cde",
      "codigo": "ana-7k2p",
      "tipo": "indicacao",
      "clicado_em": "2026-09-20T09:00:00.000Z",
      "compartilhado": false,
      "venceu": false,
      "motivo": "fora da janela (antes do início)"
    },
    {
      "clique_id": "clk_fc7d7d044e711e877cefea7e3c205296",
      "codigo": "discord-criadores",
      "tipo": "comunidade",
      "clicado_em": "2026-10-09T18:00:00.000Z",
      "compartilhado": false,
      "venceu": false,
      "motivo": "existe um toque mais recente"
    },
    {
      "clique_id": "clk_8f781bc05ba587cc4fe6cf395a64479d",
      "codigo": "verao26-tiktok",
      "tipo": "campanha",
      "clicado_em": "2026-10-11T20:00:00.000Z",
      "compartilhado": false,
      "venceu": true,
      "motivo": "último toque válido"
    },
    {
      "clique_id": "clk_f715f186ac82a2e96a077299f190fae7",
      "codigo": "ana-7k2p",
      "tipo": "indicacao",
      "clicado_em": "2026-10-13T08:00:00.000Z",
      "compartilhado": false,
      "venceu": false,
      "motivo": "posterior ao cadastro"
    }
  ],
  "recompensa_indicacao": {
    "elegivel": false,
    "codigo": null,
    "indicador_id": null,
    "clique_id": null,
    "motivo": "nenhuma indicação elegível: fora da janela (antes do início)",
    "regra": "recompensa: último toque de indicação válido, clicado no próprio aparelho (clique compartilhado não conta), sem autoindicação"
  }
}
```

### 7. Cadastro sem nenhum toque: orgânico com motivo
```bash
curl -s -X POST localhost:3006/cadastros \
  -H 'content-type: application/json' \
  -d '{"usuario_id":"usr_carla","email":"usr_carla@exemplo.com","instalacao_id":"inst-carla-aparelho-01"}'
```
`201`
```json
{
  "usuario_id": "usr_carla",
  "ja_cadastrado": false,
  "origem": {
    "tipo": "organico",
    "codigo": null,
    "detalhe": null
  },
  "motivo": "nenhum toque registrado",
  "regra": "último toque válido antes do cadastro; empate de horário: indicação > campanha > comunidade > menor id de clique",
  "janela": {
    "antes_dias": 7,
    "depois_dias": 30,
    "primeira_abertura": "2026-10-10T09:00:00.000Z",
    "inicio": "2026-10-03T09:00:00.000Z",
    "fim": "2026-11-09T09:00:00.000Z"
  },
  "cadastro_em": "2026-10-11T10:00:00.000Z",
  "toques": [],
  "recompensa_indicacao": {
    "elegivel": false,
    "codigo": null,
    "indicador_id": null,
    "clique_id": null,
    "motivo": "nenhum toque de indicação",
    "regra": "recompensa: último toque de indicação válido, clicado no próprio aparelho (clique compartilhado não conta), sem autoindicação"
  }
}
```
