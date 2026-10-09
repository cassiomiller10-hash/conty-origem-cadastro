import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW, decideOrigin, type DecisionInput, type Touch } from "../src/attribution.ts";
import { at, DAY, FIRST_OPEN, withExampleLinks } from "./helpers.ts";

// A decisão é uma função pura: aqui ela recebe casos que o fluxo HTTP não consegue montar.

const touch = (cliqueId: string, clicadoEm: string, overrides: Partial<Touch> = {}): Touch => ({
  cliqueId,
  codigo: "verao26-tiktok",
  tipo: "campanha",
  detalhe: {},
  clicadoEm,
  linkAtivoNoClique: true,
  indicadorId: null,
  compartilhado: false,
  ...overrides,
});

const input = (toques: Touch[], cadastroEm = "2026-10-12T15:30:00.000Z"): DecisionInput => ({
  primeiraAbertura: "2026-10-08T10:00:00.000Z",
  cadastroEm,
  cadastro: { usuarioId: "usr_bruno", email: "bruno@exemplo.com", instalacaoId: "inst-bruno-aparelho-01" },
  toques,
  rejeitados: [],
  indicadores: new Map(),
  instalacaoJaUsada: false,
  janela: DEFAULT_WINDOW,
});

describe("toque posterior ao cadastro (regra na função pura)", () => {
  it("não vence, mesmo sendo o mais recente e dentro da janela", () => {
    const decision = decideOrigin(
      input([
        touch("clk_a", "2026-10-11T20:00:00.000Z"),
        touch("clk_b", "2026-10-13T08:00:00.000Z", { codigo: "ana-7k2p", tipo: "indicacao" }),
      ]),
    );
    expect(decision.origem).toMatchObject({ tipo: "campanha", codigo: "verao26-tiktok" });
    expect(decision.toques.map((item) => [item.clique_id, item.venceu, item.motivo])).toEqual([
      ["clk_a", true, "último toque válido"],
      ["clk_b", false, "posterior ao cadastro"],
    ]);
  });

  it("se todos são posteriores, o cadastro é orgânico com esse motivo", () => {
    const decision = decideOrigin(input([touch("clk_b", "2026-10-13T08:00:00.000Z")]));
    expect(decision).toMatchObject({ origem: { tipo: "organico" }, motivo: "todos os toques são posteriores ao cadastro" });
  });

  it("toque no mesmo instante do cadastro conta", () => {
    const decision = decideOrigin(input([touch("clk_a", "2026-10-12T15:30:00.000Z")]));
    expect(decision.origem.tipo).toBe("campanha");
  });
});

describe("UTMs no link", () => {
  it("são guardadas no clique como informação extra e não decidem nada", async () => {
    const api = await withExampleLinks();
    const click = await api.click("verao26-tiktok", at(FIRST_OPEN, -DAY), "?utm_source=tiktok&utm_content=video-3&outro=x");
    const row = api.db.prepare("SELECT utms_json FROM cliques WHERE id = ?").get(click) as { utms_json: string };
    expect(JSON.parse(row.utms_json)).toEqual({ utm_source: "tiktok", utm_content: "video-3" });
    await api.firstOpen("inst-bruno-aparelho-01", FIRST_OPEN, click);
    const res = await api.signUp("usr_bruno", at(FIRST_OPEN, DAY), "inst-bruno-aparelho-01");
    expect(res.body.origem).toMatchObject({ tipo: "campanha", codigo: "verao26-tiktok", detalhe: { campanha: "verão 2026", canal: "tiktok" } });
  });
});
