import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { DEFAULT_WINDOW, type WindowConfig } from "./attribution.ts";
import {
  createLink,
  type Deps,
  getOrigin,
  registerAppOpenByLink,
  registerClick,
  registerFirstOpen,
  RequestError,
  signUp,
  updateLink,
} from "./service.ts";

type Options = { now?: () => Date; janela?: WindowConfig };

export function createApp(db: DatabaseSync, options: Options = {}) {
  const deps: Deps = {
    db,
    now: options.now ?? (() => new Date()),
    janela: options.janela ?? DEFAULT_WINDOW,
    appUrl: "conty://abrir",
    // O id do clique vai no "referrer" da loja: o app o recebe na primeira abertura (install referrer).
    storeUrl: "https://play.google.com/store/apps/details?id=app.conty&referrer={click}",
  };
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof RequestError) return c.json({ erro: error.code, mensagem: error.message }, error.status);
    console.error(error);
    return c.json({ erro: "erro_interno", mensagem: "Erro inesperado." }, 500);
  });

  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    const parsed = await c.req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestError(400, "corpo_invalido", "Envie um objeto JSON.");
    return parsed as Record<string, unknown>;
  };

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/links", async (c) => c.json(createLink(deps, await body(c)), 201));
  app.patch("/links/:codigo", async (c) => c.json(updateLink(deps, c.req.param("codigo"), await body(c))));

  // Redirecionador: https://l.conty.app/l/{codigo}. Registra o clique e manda para a loja com o id
  // do clique. Um redirecionador de verdade tentaria antes o app (app_url) e cairia na loja se ele
  // não estivesse instalado; aqui as duas saídas vão no corpo para a demonstração.
  app.get("/l/:codigo", (c) => {
    const click = registerClick(deps, c.req.param("codigo"), c.req.query());
    c.header("location", click.loja_url);
    return c.json(click, 302);
  });

  app.post("/instalacoes", async (c) => c.json(registerFirstOpen(deps, await body(c)), 201));
  app.post("/instalacoes/:id/toques", async (c) => c.json(registerAppOpenByLink(deps, c.req.param("id"), await body(c)), 201));

  app.post("/cadastros", async (c) => {
    const result = signUp(deps, await body(c));
    return c.json(result, result.ja_cadastrado ? 200 : 201);
  });
  app.get("/cadastros/:usuarioId/origem", (c) => c.json(getOrigin(deps, c.req.param("usuarioId"))));

  return app;
}
