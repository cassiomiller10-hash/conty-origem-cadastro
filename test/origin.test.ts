import { describe, expect, it } from "vitest";
import { at, DAY, FIRST_OPEN, withExampleLinks } from "./helpers.ts";

const INST = "inst-bruno-aparelho-01";
type Touch = { clique_id: string; codigo: string | null; venceu: boolean; motivo: string };

describe("cadastro sem origem é orgânico com motivo", () => {
  it("sem nenhum toque: orgânico, 'nenhum toque registrado'", async () => {
    const api = await withExampleLinks();
    await api.firstOpen(INST, FIRST_OPEN);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ origem: { tipo: "organico", codigo: null }, motivo: "nenhum toque registrado", toques: [] });
  });

  it("sem primeira abertura registrada: orgânico com esse motivo", async () => {
    const api = await withExampleLinks();
    const res = await api.signUp("usr_bruno", FIRST_OPEN);
    expect(res.body).toMatchObject({ origem: { tipo: "organico" }, motivo: "aparelho sem primeira abertura registrada" });
  });
});

describe("primeira abertura", () => {
  it("repetir o aviso de primeira abertura não muda a hora; o clique novo vira toque", async () => {
    const api = await withExampleLinks();
    const first = await api.firstOpen(INST, FIRST_OPEN);
    expect(first.body).toMatchObject({ primeira_abertura: FIRST_OPEN, ja_registrada: false, toque: null });
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, DAY));
    const again = await api.firstOpen(INST, at(FIRST_OPEN, 2 * DAY), click);
    expect(again.body).toMatchObject({ primeira_abertura: FIRST_OPEN, ja_registrada: true, toque: "aceito" });
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 3 * DAY), INST);
    expect(res.body.janela.primeira_abertura).toBe(FIRST_OPEN);
    expect(res.body.origem.codigo).toBe("verao26-tiktok");
  });

  it("recusa id de instalação curto ou com caracteres estranhos", async () => {
    const api = await withExampleLinks();
    expect((await api.firstOpen("curto", FIRST_OPEN)).status).toBe(400);
    expect((await api.firstOpen("tem espaço no meio 123", FIRST_OPEN)).status).toBe(400);
  });
});

describe("mesmo clique", () => {
  it("o mesmo id de clique informado duas vezes vira um toque só", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const again = await api.openByLink(INST, at(FIRST_OPEN, 3_600_000), click);
    expect(again.body.toque).toBe("repetido");
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body.toques).toHaveLength(1);
    expect(res.body.origem).toMatchObject({ tipo: "campanha", codigo: "verao26-tiktok" });
  });

  it("link repassado: o clique é do primeiro aparelho; o segundo herda a origem do link, sem recompensa", async () => {
    const api = await withExampleLinks();
    const click = await api.click("ana-7k2p", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const second = await api.firstOpen("inst-carla-aparelho-01", at(FIRST_OPEN, 60_000), click);
    expect(second.body.toque).toBe("de_outro_aparelho");

    const bruno = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(bruno.body.origem.codigo).toBe("ana-7k2p");
    expect(bruno.body.recompensa_indicacao).toMatchObject({ elegivel: true, indicador_id: "usr_ana", clique_id: click });

    const carla = await api.signUp("usr_carla", at(FIRST_OPEN, DAY), "inst-carla-aparelho-01");
    expect(carla.body.origem).toMatchObject({ tipo: "indicacao", codigo: "ana-7k2p" });
    // Sem passar pelo redirecionador, a hora do toque é a do servidor quando o app da Carla avisou.
    expect(carla.body.toques).toEqual([
      {
        clique_id: click,
        codigo: "ana-7k2p",
        tipo: "indicacao",
        clicado_em: at(FIRST_OPEN, 60_000),
        compartilhado: true,
        venceu: true,
        motivo: "último toque válido (clique compartilhado: conta para a origem, não para recompensa)",
      },
    ]);
    expect(carla.body.recompensa_indicacao).toMatchObject({ elegivel: false, motivo: "nenhuma indicação elegível: clique compartilhado" });
  });

  it("o mesmo link clicado duas vezes guarda dois toques e uma origem só", async () => {
    const api = await withExampleLinks();
    const first = await api.click("discord-criadores", at(FIRST_OPEN, -2 * DAY));
    await api.firstOpen(INST, FIRST_OPEN, first);
    const second = await api.click("discord-criadores", at(FIRST_OPEN, DAY));
    await api.openByLink(INST, at(FIRST_OPEN, DAY + 1_000), second);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 2 * DAY), INST);
    expect(res.body.origem).toMatchObject({ tipo: "comunidade", codigo: "discord-criadores" });
    expect(res.body.toques.map((touch: Touch) => [touch.clique_id, touch.venceu, touch.motivo])).toEqual([
      [first, false, "existe um toque mais recente"],
      [second, true, "último toque válido"],
    ]);
  });
});

describe("qual toque vence", () => {
  it("dois links diferentes antes do cadastro: vence o mais recente", async () => {
    const api = await withExampleLinks();
    const referral = await api.click("ana-7k2p", at(FIRST_OPEN, -3 * DAY));
    await api.firstOpen(INST, FIRST_OPEN, referral);
    const campaign = await api.click("verao26-tiktok", at(FIRST_OPEN, 2 * DAY));
    await api.openByLink(INST, at(FIRST_OPEN, 2 * DAY), campaign);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 3 * DAY), INST);
    expect(res.body).toMatchObject({ origem: { tipo: "campanha", codigo: "verao26-tiktok", detalhe: { campanha: "verão 2026", canal: "tiktok" } }, motivo: "último toque válido antes do cadastro" });
    expect(res.body.toques.map((touch: Touch) => [touch.codigo, touch.venceu, touch.motivo])).toEqual([
      ["ana-7k2p", false, "existe um toque mais recente"],
      ["verao26-tiktok", true, "último toque válido"],
    ]);
  });

  it("empate de horário: indicação vence campanha", async () => {
    const api = await withExampleLinks();
    const instant = at(FIRST_OPEN, DAY);
    const campaign = await api.click("verao26-tiktok", instant);
    const referral = await api.click("ana-7k2p", instant);
    await api.firstOpen(INST, FIRST_OPEN);
    await api.openByLink(INST, at(instant, 1_000), campaign);
    await api.openByLink(INST, at(instant, 2_000), referral);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 2 * DAY), INST);
    expect(res.body.origem).toMatchObject({ tipo: "indicacao", codigo: "ana-7k2p" });
    const byCode = Object.fromEntries(res.body.toques.map((touch: Touch) => [touch.codigo, touch.motivo]));
    expect(byCode).toEqual({
      "ana-7k2p": "último toque válido (empate de horário decidido pelo tipo)",
      "verao26-tiktok": "empate de horário: perdeu para indicação ana-7k2p (tipo)",
    });
  });

  it("empate de horário no mesmo tipo: vence o menor id de clique", async () => {
    const api = await withExampleLinks();
    await api.link("inverno26-insta", "campanha", { campanha: "inverno 2026", canal: "instagram" });
    const instant = at(FIRST_OPEN, DAY);
    const a = await api.click("verao26-tiktok", instant);
    const b = await api.click("inverno26-insta", instant);
    await api.firstOpen(INST, FIRST_OPEN);
    await api.openByLink(INST, at(instant, 1_000), a);
    await api.openByLink(INST, at(instant, 2_000), b);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 2 * DAY), INST);
    const expectedWinner = a < b ? a : b;
    const winner = res.body.toques.find((touch: Touch) => touch.venceu);
    expect(winner.clique_id).toBe(expectedWinner);
    expect(winner.motivo).toBe("último toque válido (empate de horário decidido pelo id do clique)");
    expect(res.body.toques.find((touch: Touch) => !touch.venceu).motivo).toMatch(/^empate de horário: perdeu para campanha .* \(id do clique\)$/);
  });
});

describe("janela de validade a partir da primeira abertura", () => {
  it.each([
    ["6 dias antes conta", -6 * DAY, true],
    ["exatamente 7 dias antes conta", -7 * DAY, true],
    ["8 dias antes não conta", -8 * DAY, false],
  ])("clique que levou à instalação: %s", async (_, delta, counts) => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, delta));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body.origem.tipo).toBe(counts ? "campanha" : "organico");
    if (!counts) expect(res.body).toMatchObject({ motivo: "todos os toques fora da janela", toques: [expect.objectContaining({ motivo: "fora da janela (antes do início)" })] });
  });

  it.each([
    ["29 dias depois conta", 29 * DAY, true],
    ["exatamente 30 dias depois conta", 30 * DAY, true],
  ])("toque depois da primeira abertura: %s", async (_, delta, counts) => {
    const api = await withExampleLinks();
    await api.firstOpen(INST, FIRST_OPEN);
    const click = await api.click("discord-criadores", at(FIRST_OPEN, delta));
    await api.openByLink(INST, at(FIRST_OPEN, delta), click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, delta), INST);
    expect(res.body.origem.tipo).toBe(counts ? "comunidade" : "organico");
  });

  it("toque 31 dias depois não conta (e o cadastro nesse dia também está fora da janela)", async () => {
    const api = await withExampleLinks();
    await api.firstOpen(INST, FIRST_OPEN);
    const click = await api.click("discord-criadores", at(FIRST_OPEN, 31 * DAY));
    await api.openByLink(INST, at(FIRST_OPEN, 31 * DAY), click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 31 * DAY + 60_000), INST);
    expect(res.body).toMatchObject({ origem: { tipo: "organico" }, motivo: "cadastro depois do fim da janela" });
    expect(res.body.toques[0]).toMatchObject({ venceu: false, motivo: "fora da janela (depois do fim)" });
  });

  it("cadastro depois do fim da janela é orgânico mesmo com toque válido no começo", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 45 * DAY), INST);
    expect(res.body).toMatchObject({ origem: { tipo: "organico" }, motivo: "cadastro depois do fim da janela" });
    expect(res.body.toques[0].motivo).toBe("cadastro depois do fim da janela");
  });

  it("a janela usada vai na resposta", async () => {
    const api = await withExampleLinks();
    await api.firstOpen(INST, FIRST_OPEN);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body.janela).toEqual({
      antes_dias: 7,
      depois_dias: 30,
      primeira_abertura: FIRST_OPEN,
      inicio: "2026-10-01T10:00:00.000Z",
      fim: "2026-11-07T10:00:00.000Z",
    });
    expect(res.body.regra).toBe("último toque válido antes do cadastro; empate de horário: indicação > campanha > comunidade > menor id de clique");
  });
});

describe("depois do cadastro", () => {
  it("toque posterior ao cadastro não vence, não muda a origem gravada e aparece na auditoria", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    await api.signUp("usr_bruno", at(FIRST_OPEN, 4 * DAY), INST);
    const later = await api.click("ana-7k2p", at(FIRST_OPEN, 5 * DAY));
    await api.openByLink(INST, at(FIRST_OPEN, 5 * DAY), later);

    const res = await api.origin("usr_bruno");
    expect(res.body.origem).toMatchObject({ tipo: "campanha", codigo: "verao26-tiktok" });
    expect(res.body.toques.at(-1)).toEqual({ clique_id: later, codigo: "ana-7k2p", tipo: "indicacao", clicado_em: at(FIRST_OPEN, 5 * DAY), compartilhado: false, venceu: false, motivo: "posterior ao cadastro" });
  });

  it("repetir o cadastro devolve a mesma origem, sem recalcular", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const first = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    const later = await api.click("ana-7k2p", at(FIRST_OPEN, 2 * DAY));
    await api.openByLink(INST, at(FIRST_OPEN, 2 * DAY), later);
    const again = await api.signUp("usr_bruno", at(FIRST_OPEN, 3 * DAY), INST);
    expect(again.status).toBe(200);
    const { ja_cadastrado: _a, ...firstDecision } = first.body;
    const { ja_cadastrado: _b, ...againDecision } = again.body;
    expect(againDecision).toEqual(firstDecision);
  });

  it("segundo cadastro na mesma instalação não reaproveita os toques", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    const res = await api.signUp("usr_bruno2", at(FIRST_OPEN, 2 * DAY), INST);
    expect(res.body).toMatchObject({ origem: { tipo: "organico" }, motivo: "instalação já usada por outro cadastro" });
  });
});

describe("indicação e validade do toque", () => {
  it("código inexistente não gera clique (404) e o cadastro fica orgânico", async () => {
    const api = await withExampleLinks();
    expect((await api.get("/l/nao-existe")).status).toBe(404);
    await api.firstOpen(INST, FIRST_OPEN);
    expect((await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST)).body.motivo).toBe("nenhum toque registrado");
  });

  it("autoindicação pelo mesmo e-mail não conta", async () => {
    const api = await withExampleLinks();
    const click = await api.click("ana-7k2p", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_ana_nova", at(FIRST_OPEN, DAY), INST, " ANA@exemplo.com ");
    expect(res.body).toMatchObject({ origem: { tipo: "organico" }, motivo: "todos os toques eram inválidos" });
    expect(res.body.toques[0].motivo).toBe("autoindicação");
  });

  it("autoindicação pelo mesmo aparelho não conta", async () => {
    const api = await withExampleLinks();
    const click = await api.click("ana-7k2p", at(FIRST_OPEN, -DAY));
    // A Ana instala de novo no próprio aparelho e tenta uma segunda conta com outro e-mail.
    await api.openByLink("inst-ana-aparelho-0001", at(FIRST_OPEN, 1_000), click);
    const res = await api.signUp("usr_ana2", at(FIRST_OPEN, DAY), "inst-ana-aparelho-0001", "outra@exemplo.com");
    expect(res.body.origem.tipo).toBe("organico");
  });

  it("toque com id de clique inventado é registrado e ignorado", async () => {
    const api = await withExampleLinks();
    const reply = await api.firstOpen(INST, FIRST_OPEN, "clk_inventado_na_mao");
    expect(reply.body.toque).toBe("desconhecido");
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body).toMatchObject({ origem: { tipo: "organico" }, motivo: "todos os toques eram inválidos" });
    expect(res.body.toques).toEqual([{ clique_id: "clk_inventado_na_mao", codigo: null, tipo: null, clicado_em: null, compartilhado: false, venceu: false, motivo: "id de clique desconhecido" }]);
  });

  it("clique num link já inativo não conta; desativar depois do clique não tira o crédito", async () => {
    const api = await withExampleLinks();
    const before = await api.click("verao26-tiktok", at(FIRST_OPEN, -2 * DAY));
    api.setNow(at(FIRST_OPEN, -DAY));
    const disabled = await api.patch("/links/verao26-tiktok", { ativo: false });
    expect(disabled.body).toMatchObject({ codigo: "verao26-tiktok", ativo: false });
    const after = await api.click("verao26-tiktok", at(FIRST_OPEN, -1_000));
    await api.firstOpen(INST, FIRST_OPEN, before);
    await api.openByLink(INST, at(FIRST_OPEN, 1_000), after);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body.origem).toMatchObject({ tipo: "campanha", codigo: "verao26-tiktok" });
    expect(res.body.toques.map((touch: Touch) => [touch.clique_id, touch.venceu, touch.motivo])).toEqual([
      [before, true, "último toque válido"],
      [after, false, "link inativo no momento do clique"],
    ]);
  });
});
