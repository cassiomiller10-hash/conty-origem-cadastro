import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
-- O link só carrega o código; o significado (tipo, campanha, quem indicou) fica aqui.
CREATE TABLE IF NOT EXISTS links (
  codigo TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('indicacao', 'campanha', 'comunidade')),
  detalhe_json TEXT NOT NULL,
  indicador_id TEXT,
  ativo INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Cada passagem pelo redirecionador. A hora é a do servidor. Um clique pertence a no máximo
-- uma instalação: a primeira que o informar.
CREATE TABLE IF NOT EXISTS cliques (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL REFERENCES links(codigo),
  clicado_em TEXT NOT NULL,
  link_ativo INTEGER NOT NULL,
  utms_json TEXT NOT NULL,
  instalacao_id TEXT,
  vinculado_em TEXT
);

CREATE TABLE IF NOT EXISTS instalacoes (
  id TEXT PRIMARY KEY,
  primeira_abertura TEXT NOT NULL
);

-- Tudo o que o app informou, aceito ou não: é a trilha de auditoria dos toques.
CREATE TABLE IF NOT EXISTS avisos_de_toque (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  instalacao_id TEXT NOT NULL REFERENCES instalacoes(id),
  clique_id TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('primeira_abertura', 'abertura_por_link')),
  informado_em TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('aceito', 'repetido', 'desconhecido', 'de_outro_aparelho'))
);

-- A origem é decidida uma vez e congelada junto com a explicação completa.
CREATE TABLE IF NOT EXISTS cadastros (
  usuario_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  instalacao_id TEXT,
  cadastrado_em TEXT NOT NULL,
  origem_tipo TEXT NOT NULL,
  origem_codigo TEXT,
  decisao_json TEXT NOT NULL
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
