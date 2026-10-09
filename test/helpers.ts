import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

export const DAY = 86_400_000;
/** Primeira abertura padrão dos testes. */
export const FIRST_OPEN = "2026-10-08T10:00:00.000Z";
export const at = (base: string, deltaMs: number) => new Date(Date.parse(base) + deltaMs).toISOString();

/** App com banco em memória e relógio controlado. */
export function setup() {
  let now = new Date("2026-10-01T09:00:00.000Z");
  const db = openDatabase(":memory:");
  const app = createApp(db, { now: () => now });

  async function call(method: string, path: string, payload?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    // biome-ignore lint: corpo genérico nos testes
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  }

  const api = {
    db,
    setNow(iso: string) {
      now = new Date(iso);
    },
    get: (path: string) => call("GET", path),
    post: (path: string, payload?: unknown) => call("POST", path, payload),
    patch: (path: string, payload?: unknown) => call("PATCH", path, payload),
    link: (codigo: string, tipo: string, extra: Record<string, unknown> = {}) => call("POST", "/links", { codigo, tipo, ...extra }),
    /** Clique no redirecionador na hora `iso`; devolve o id do clique. */
    async click(codigo: string, iso: string, query = "") {
      api.setNow(iso);
      const res = await call("GET", `/l/${codigo}${query}`);
      if (res.status !== 302) throw new Error(`clique falhou: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.clique_id as string;
    },
    firstOpen(instalacao: string, iso: string, cliqueId?: string) {
      api.setNow(iso);
      return call("POST", "/instalacoes", { instalacao_id: instalacao, ...(cliqueId ? { clique_id: cliqueId } : {}) });
    },
    openByLink(instalacao: string, iso: string, cliqueId: string) {
      api.setNow(iso);
      return call("POST", `/instalacoes/${instalacao}/toques`, { clique_id: cliqueId });
    },
    signUp(usuario: string, iso: string, instalacao?: string, email = `${usuario}@exemplo.com`) {
      api.setNow(iso);
      return call("POST", "/cadastros", { usuario_id: usuario, email, ...(instalacao ? { instalacao_id: instalacao } : {}) });
    },
    origin: (usuario: string) => call("GET", `/cadastros/${usuario}/origem`),
  };
  return api;
}

/** Links de exemplo do README e uma indicadora já cadastrada (a Ana). */
export async function withExampleLinks() {
  const api = setup();
  await api.firstOpen("inst-ana-aparelho-0001", "2026-09-01T12:00:00.000Z");
  await api.signUp("usr_ana", "2026-09-01T12:30:00.000Z", "inst-ana-aparelho-0001", "ana@exemplo.com");
  await api.link("verao26-tiktok", "campanha", { campanha: "verão 2026", canal: "tiktok" });
  await api.link("ana-7k2p", "indicacao", { indicador_id: "usr_ana" });
  await api.link("discord-criadores", "comunidade", { comunidade: "Discord de criadores" });
  return api;
}
