import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Decision, decideOrigin, type LinkType, type Person, type RejectedReport, type Touch, type WindowConfig } from "./attribution.ts";
import { transaction } from "./db.ts";

export class RequestError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Deps = { db: DatabaseSync; now: () => Date; janela: WindowConfig; appUrl: string; storeUrl: string };

type LinkRow = { codigo: string; tipo: LinkType; detalhe_json: string; indicador_id: string | null; ativo: number };
type ClickRow = { id: string; codigo: string; clicado_em: string; link_ativo: number; instalacao_id: string | null };
type SignupRow = { usuario_id: string; email: string; instalacao_id: string | null; cadastrado_em: string; decisao_json: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// ------------------------------------------------------------------------------------------
// Links
// ------------------------------------------------------------------------------------------

const DETAIL_FIELDS: Record<LinkType, string[]> = {
  indicacao: ["indicador_id"],
  campanha: ["campanha", "canal"],
  comunidade: ["comunidade"],
};

function presentLink(row: LinkRow) {
  return { codigo: row.codigo, tipo: row.tipo, ...(JSON.parse(row.detalhe_json) as Record<string, string>), ativo: row.ativo === 1 };
}

export function createLink(deps: Deps, body: Record<string, unknown>) {
  const codigo = text(body.codigo);
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(codigo)) {
    throw new RequestError(400, "codigo_invalido", "codigo: 3 a 64 caracteres, letras minúsculas, números e hífen.");
  }
  const tipo = body.tipo as LinkType;
  if (!(tipo in DETAIL_FIELDS)) throw new RequestError(400, "tipo_invalido", "tipo: indicacao, campanha ou comunidade.");
  const detalhe: Record<string, string> = {};
  for (const field of DETAIL_FIELDS[tipo]) {
    detalhe[field] = text(body[field]);
    if (!detalhe[field]) throw new RequestError(400, "detalhe_obrigatorio", `Link de ${tipo} precisa de ${field}.`);
  }
  if (tipo === "indicacao" && !deps.db.prepare("SELECT 1 FROM cadastros WHERE usuario_id = ?").get(detalhe.indicador_id)) {
    throw new RequestError(400, "indicador_desconhecido", "Quem indica precisa ser um usuário cadastrado.");
  }
  if (deps.db.prepare("SELECT 1 FROM links WHERE codigo = ?").get(codigo)) {
    throw new RequestError(409, "codigo_em_uso", "Já existe um link com esse código.");
  }
  const at = deps.now().toISOString();
  deps.db
    .prepare("INSERT INTO links (codigo, tipo, detalhe_json, indicador_id, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(codigo, tipo, JSON.stringify(detalhe), detalhe.indicador_id ?? null, body.ativo === false ? 0 : 1, at, at);
  return presentLink(deps.db.prepare("SELECT * FROM links WHERE codigo = ?").get(codigo) as LinkRow);
}

/** Corrige detalhes ou ativa/desativa o link sem trocar o endereço já espalhado. O tipo não muda. */
export function updateLink(deps: Deps, codigo: string, body: Record<string, unknown>) {
  const row = deps.db.prepare("SELECT * FROM links WHERE codigo = ?").get(codigo) as LinkRow | undefined;
  if (!row) throw new RequestError(404, "link_nao_encontrado", "Link não encontrado.");
  const detalhe = JSON.parse(row.detalhe_json) as Record<string, string>;
  for (const field of DETAIL_FIELDS[row.tipo].filter((name) => name !== "indicador_id")) {
    if (text(body[field])) detalhe[field] = text(body[field]);
  }
  const ativo = typeof body.ativo === "boolean" ? (body.ativo ? 1 : 0) : row.ativo;
  deps.db
    .prepare("UPDATE links SET detalhe_json = ?, ativo = ?, atualizado_em = ? WHERE codigo = ?")
    .run(JSON.stringify(detalhe), ativo, deps.now().toISOString(), codigo);
  return presentLink(deps.db.prepare("SELECT * FROM links WHERE codigo = ?").get(codigo) as LinkRow);
}

// ------------------------------------------------------------------------------------------
// Redirecionador
// ------------------------------------------------------------------------------------------

/** Registra o clique com a hora do servidor e um id impossível de adivinhar. UTMs são só informação extra. */
export function registerClick(deps: Deps, codigo: string, query: Record<string, string>) {
  const link = deps.db.prepare("SELECT * FROM links WHERE codigo = ?").get(codigo) as LinkRow | undefined;
  if (!link) throw new RequestError(404, "link_nao_encontrado", "Link não encontrado.");
  const utms = Object.fromEntries(Object.entries(query).filter(([key]) => key.startsWith("utm_")));
  const id = `clk_${randomBytes(16).toString("hex")}`;
  deps.db
    .prepare("INSERT INTO cliques (id, codigo, clicado_em, link_ativo, utms_json) VALUES (?, ?, ?, ?, ?)")
    .run(id, codigo, deps.now().toISOString(), link.ativo, JSON.stringify(utms));
  return {
    clique_id: id,
    app_url: `${deps.appUrl}?click=${id}`,
    loja_url: deps.storeUrl.replace("{click}", encodeURIComponent(`click=${id}`)),
  };
}

// ------------------------------------------------------------------------------------------
// App: primeira abertura e toques
// ------------------------------------------------------------------------------------------

type TouchOutcome = "aceito" | "repetido" | "desconhecido" | "de_outro_aparelho";

function recordTouch(deps: Deps, instalacaoId: string, cliqueId: string, via: "primeira_abertura" | "abertura_por_link"): TouchOutcome {
  const at = deps.now().toISOString();
  const click = deps.db.prepare("SELECT * FROM cliques WHERE id = ?").get(cliqueId) as ClickRow | undefined;
  let resultado: TouchOutcome;
  if (!click) resultado = "desconhecido";
  else if (click.instalacao_id === instalacaoId) resultado = "repetido";
  else if (click.instalacao_id !== null) resultado = "de_outro_aparelho";
  else {
    deps.db.prepare("UPDATE cliques SET instalacao_id = ?, vinculado_em = ? WHERE id = ?").run(instalacaoId, at, cliqueId);
    resultado = "aceito";
  }
  deps.db
    .prepare("INSERT INTO avisos_de_toque (instalacao_id, clique_id, via, informado_em, resultado) VALUES (?, ?, ?, ?, ?)")
    .run(instalacaoId, cliqueId, via, at, resultado);
  return resultado;
}

/** Primeira abertura. A hora é a do servidor; se o aviso repetir, vale o primeiro. */
export function registerFirstOpen(deps: Deps, body: Record<string, unknown>) {
  const instalacaoId = text(body.instalacao_id);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(instalacaoId)) {
    throw new RequestError(400, "instalacao_invalida", "instalacao_id: código aleatório de 16 a 128 caracteres gerado pelo app.");
  }
  const cliqueId = text(body.clique_id);
  return transaction(deps.db, () => {
    const existing = deps.db.prepare("SELECT primeira_abertura FROM instalacoes WHERE id = ?").get(instalacaoId) as
      | { primeira_abertura: string }
      | undefined;
    if (!existing) {
      deps.db.prepare("INSERT INTO instalacoes (id, primeira_abertura) VALUES (?, ?)").run(instalacaoId, deps.now().toISOString());
    }
    const toque = cliqueId ? recordTouch(deps, instalacaoId, cliqueId, "primeira_abertura") : null;
    const { primeira_abertura } = deps.db.prepare("SELECT primeira_abertura FROM instalacoes WHERE id = ?").get(instalacaoId) as {
      primeira_abertura: string;
    };
    return { instalacao_id: instalacaoId, primeira_abertura, ja_registrada: Boolean(existing), toque };
  });
}

/** App aberto por um link depois da primeira abertura. */
export function registerAppOpenByLink(deps: Deps, instalacaoId: string, body: Record<string, unknown>) {
  const cliqueId = text(body.clique_id);
  if (!cliqueId) throw new RequestError(400, "clique_obrigatorio", "Informe clique_id.");
  return transaction(deps.db, () => {
    if (!deps.db.prepare("SELECT 1 FROM instalacoes WHERE id = ?").get(instalacaoId)) {
      throw new RequestError(404, "instalacao_desconhecida", "Instalação sem primeira abertura registrada.");
    }
    return { instalacao_id: instalacaoId, clique_id: cliqueId, toque: recordTouch(deps, instalacaoId, cliqueId, "abertura_por_link") };
  });
}

// ------------------------------------------------------------------------------------------
// Cadastro: decide e congela a origem
// ------------------------------------------------------------------------------------------

function touchesOf(deps: Deps, instalacaoId: string): { toques: Touch[]; rejeitados: RejectedReport[] } {
  type Row = ClickRow & LinkRow & { informado_em: string | null };
  const toTouch = (row: Row, compartilhado: boolean): Touch => ({
    cliqueId: row.id,
    codigo: row.codigo,
    tipo: row.tipo,
    detalhe: JSON.parse(row.detalhe_json) as Record<string, string>,
    clicadoEm: compartilhado ? (row.informado_em as string) : row.clicado_em,
    linkAtivoNoClique: row.link_ativo === 1,
    indicadorId: row.indicador_id,
    compartilhado,
  });
  // Cliques que esta instalação informou primeiro.
  const own = deps.db
    .prepare(
      `SELECT c.*, l.tipo, l.detalhe_json, l.indicador_id, NULL AS informado_em
       FROM cliques c JOIN links l ON l.codigo = c.codigo WHERE c.instalacao_id = ?`,
    )
    .all(instalacaoId) as Row[];
  // Cliques que já eram de outro aparelho (link repassado): o primeiro aviso desta instalação.
  const shared = deps.db
    .prepare(
      `SELECT c.*, l.tipo, l.detalhe_json, l.indicador_id, MIN(a.informado_em) AS informado_em
       FROM avisos_de_toque a JOIN cliques c ON c.id = a.clique_id JOIN links l ON l.codigo = c.codigo
       WHERE a.instalacao_id = ? AND a.resultado = 'de_outro_aparelho' GROUP BY c.id`,
    )
    .all(instalacaoId) as Row[];
  const unknown = deps.db
    .prepare(
      `SELECT clique_id, MIN(informado_em) AS informado_em FROM avisos_de_toque
       WHERE instalacao_id = ? AND resultado = 'desconhecido' GROUP BY clique_id ORDER BY MIN(seq)`,
    )
    .all(instalacaoId) as Array<{ clique_id: string; informado_em: string }>;
  return {
    toques: [...own.map((row) => toTouch(row, false)), ...shared.map((row) => toTouch(row, true))],
    rejeitados: unknown.map((row) => ({ cliqueId: row.clique_id, informadoEm: row.informado_em, motivo: "id de clique desconhecido" })),
  };
}

export function signUp(deps: Deps, body: Record<string, unknown>) {
  const usuarioId = text(body.usuario_id);
  const email = text(body.email);
  const instalacaoId = text(body.instalacao_id) || null;
  if (!usuarioId || !email) throw new RequestError(400, "dados_obrigatorios", "Informe usuario_id e email.");

  return transaction(deps.db, () => {
    // Mesmo cadastro de novo: a mesma resposta, sem recalcular.
    const existing = deps.db.prepare("SELECT * FROM cadastros WHERE usuario_id = ?").get(usuarioId) as SignupRow | undefined;
    if (existing) return { usuario_id: usuarioId, ja_cadastrado: true, ...(JSON.parse(existing.decisao_json) as Decision) };

    const cadastroEm = deps.now().toISOString();
    const install = instalacaoId
      ? (deps.db.prepare("SELECT primeira_abertura FROM instalacoes WHERE id = ?").get(instalacaoId) as
          | { primeira_abertura: string }
          | undefined)
      : undefined;
    const { toques, rejeitados } = install && instalacaoId ? touchesOf(deps, instalacaoId) : { toques: [], rejeitados: [] };
    const referrerIds = [...new Set(toques.flatMap((touch) => (touch.indicadorId ? [touch.indicadorId] : [])))];
    const indicadores = new Map<string, Person>(
      referrerIds.flatMap((id) => {
        const row = deps.db.prepare("SELECT usuario_id, email, instalacao_id FROM cadastros WHERE usuario_id = ?").get(id) as
          | { usuario_id: string; email: string; instalacao_id: string | null }
          | undefined;
        return row ? [[id, { usuarioId: row.usuario_id, email: row.email, instalacaoId: row.instalacao_id }] as const] : [];
      }),
    );
    const instalacaoJaUsada = instalacaoId !== null && Boolean(deps.db.prepare("SELECT 1 FROM cadastros WHERE instalacao_id = ?").get(instalacaoId));

    const decision = decideOrigin({
      primeiraAbertura: install?.primeira_abertura ?? null,
      cadastroEm,
      cadastro: { usuarioId, email, instalacaoId },
      toques,
      rejeitados,
      indicadores,
      instalacaoJaUsada,
      janela: deps.janela,
    });
    deps.db
      .prepare(
        "INSERT INTO cadastros (usuario_id, email, instalacao_id, cadastrado_em, origem_tipo, origem_codigo, decisao_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(usuarioId, email, instalacaoId, cadastroEm, decision.origem.tipo, decision.origem.codigo, JSON.stringify(decision));
    return { usuario_id: usuarioId, ja_cadastrado: false, ...decision };
  });
}

/**
 * Auditoria: a decisão congelada no cadastro, mais os toques que o app informou depois dele.
 * Esses aparecem com o motivo, mas não mudam a origem.
 */
export function getOrigin(deps: Deps, usuarioId: string) {
  const signup = deps.db.prepare("SELECT * FROM cadastros WHERE usuario_id = ?").get(usuarioId) as SignupRow | undefined;
  if (!signup) throw new RequestError(404, "cadastro_nao_encontrado", "Cadastro não encontrado.");
  const decision = JSON.parse(signup.decisao_json) as Decision;
  if (!signup.instalacao_id) return { usuario_id: usuarioId, ...decision };

  const known = new Set(decision.toques.map((touch) => touch.clique_id));
  const { toques, rejeitados } = touchesOf(deps, signup.instalacao_id);
  const later = [
    ...toques
      .filter((touch) => !known.has(touch.cliqueId))
      .map((touch) => ({
        clique_id: touch.cliqueId,
        codigo: touch.codigo,
        tipo: touch.tipo,
        clicado_em: touch.clicadoEm,
        compartilhado: touch.compartilhado,
        venceu: false,
        motivo: touch.clicadoEm > signup.cadastrado_em ? "posterior ao cadastro" : "informado depois do cadastro (origem já congelada)",
      })),
    ...rejeitados.filter((report) => !known.has(report.cliqueId)).map((report) => ({
      clique_id: report.cliqueId,
      codigo: null,
      tipo: null,
      clicado_em: null,
      compartilhado: false,
      venceu: false,
      motivo: report.motivo,
    })),
  ];
  return { usuario_id: usuarioId, ...decision, toques: [...decision.toques, ...later] };
}
