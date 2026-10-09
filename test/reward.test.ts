import { describe, expect, it } from "vitest";
import { at, DAY, FIRST_OPEN, withExampleLinks } from "./helpers.ts";

const INST = "inst-bruno-aparelho-01";

describe("recompensa de indicação, separada da origem", () => {
  it("campanha clicada depois vence a origem, mas não tira a recompensa de quem indicou", async () => {
    const api = await withExampleLinks();
    const referral = await api.click("ana-7k2p", at(FIRST_OPEN, -2 * DAY));
    await api.firstOpen(INST, FIRST_OPEN, referral);
    const ad = await api.click("verao26-tiktok", at(FIRST_OPEN, 3 * DAY));
    await api.openByLink(INST, at(FIRST_OPEN, 3 * DAY), ad);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 4 * DAY), INST);
    expect(res.body.origem).toMatchObject({ tipo: "campanha", codigo: "verao26-tiktok" });
    expect(res.body.recompensa_indicacao).toEqual({
      elegivel: true,
      codigo: "ana-7k2p",
      indicador_id: "usr_ana",
      clique_id: referral,
      motivo: "toque de indicação válido, clicado no próprio aparelho",
      regra: "recompensa: último toque de indicação válido, clicado no próprio aparelho (clique compartilhado não conta), sem autoindicação",
    });
  });

  it("sem toque de indicação: não elegível, com motivo", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body.recompensa_indicacao).toMatchObject({ elegivel: false, codigo: null, motivo: "nenhum toque de indicação" });
  });

  it("autoindicação não gera recompensa", async () => {
    const api = await withExampleLinks();
    const click = await api.click("ana-7k2p", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_ana_nova", at(FIRST_OPEN, DAY), INST, "ana@exemplo.com");
    expect(res.body.recompensa_indicacao).toMatchObject({ elegivel: false, motivo: "nenhuma indicação elegível: autoindicação" });
  });

  it("indicação fora da janela não gera recompensa", async () => {
    const api = await withExampleLinks();
    const click = await api.click("ana-7k2p", at(FIRST_OPEN, -10 * DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), INST);
    expect(res.body.recompensa_indicacao).toMatchObject({ elegivel: false, motivo: "nenhuma indicação elegível: fora da janela (antes do início)" });
  });

  it("duas indicações válidas: recebe quem indicou por último", async () => {
    const api = await withExampleLinks();
    await api.firstOpen("inst-dani-aparelho-001", "2026-09-02T12:00:00.000Z");
    await api.signUp("usr_dani", "2026-09-02T12:30:00.000Z", "inst-dani-aparelho-001", "dani@exemplo.com");
    await api.link("dani-9x1q", "indicacao", { indicador_id: "usr_dani" });
    const first = await api.click("ana-7k2p", at(FIRST_OPEN, -3 * DAY));
    await api.firstOpen(INST, FIRST_OPEN, first);
    const second = await api.click("dani-9x1q", at(FIRST_OPEN, DAY));
    await api.openByLink(INST, at(FIRST_OPEN, DAY), second);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 2 * DAY), INST);
    expect(res.body.recompensa_indicacao).toMatchObject({ elegivel: true, indicador_id: "usr_dani", clique_id: second });
  });

  it("cadastro depois do fim da janela: nem origem nem recompensa", async () => {
    const api = await withExampleLinks();
    const click = await api.click("ana-7k2p", at(FIRST_OPEN, -DAY));
    await api.firstOpen(INST, FIRST_OPEN, click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, 40 * DAY), INST);
    expect(res.body.origem.tipo).toBe("organico");
    expect(res.body.recompensa_indicacao).toMatchObject({ elegivel: false, motivo: "nenhuma indicação elegível: cadastro depois do fim da janela" });
  });
});
