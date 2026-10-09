// A decisão de origem inteira mora aqui. Função pura: recebe a primeira abertura, o cadastro,
// os toques e a janela, e devolve a origem com o motivo de cada toque ter vencido ou não.

export type LinkType = "indicacao" | "campanha" | "comunidade";
export type OriginType = LinkType | "organico";

export type WindowConfig = { antesDias: number; depoisDias: number };

export const DEFAULT_WINDOW: WindowConfig = { antesDias: 7, depoisDias: 30 };

export const RULE =
  "último toque válido antes do cadastro; empate de horário: indicação > campanha > comunidade > menor id de clique";

export const REWARD_RULE =
  "recompensa: último toque de indicação válido, clicado no próprio aparelho (clique compartilhado não conta), sem autoindicação";

/**
 * Toque de uma instalação. Normalmente é um clique do redirecionador que esta instalação informou
 * primeiro. `compartilhado` = o clique já era de outro aparelho (link repassado): conta para a
 * origem, porque a pessoa veio daquele link, mas não para recompensa. Como esse clique não passou
 * pelo redirecionador para esta pessoa, a hora do toque é a do servidor quando o app avisou.
 */
export type Touch = {
  cliqueId: string;
  codigo: string;
  tipo: LinkType;
  detalhe: Record<string, string>;
  clicadoEm: string;
  linkAtivoNoClique: boolean;
  indicadorId: string | null;
  compartilhado: boolean;
};

/** Toque informado pelo app que não vale como toque (o motivo já vem decidido). */
export type RejectedReport = { cliqueId: string; informadoEm: string; motivo: string };

export type Person = { usuarioId: string; email: string; instalacaoId: string | null };

export type DecisionInput = {
  primeiraAbertura: string | null;
  cadastroEm: string;
  cadastro: Person;
  toques: Touch[];
  rejeitados: RejectedReport[];
  /** Quem indicou, por id de usuário: para recusar autoindicação. */
  indicadores: Map<string, Person>;
  instalacaoJaUsada: boolean;
  janela: WindowConfig;
};

export type EvaluatedTouch = {
  clique_id: string;
  codigo: string | null;
  tipo: LinkType | null;
  clicado_em: string | null;
  compartilhado: boolean;
  venceu: boolean;
  motivo: string;
};

/** Responde "quem recebe pela indicação", separado de "de onde veio o cadastro". */
export type ReferralReward = {
  elegivel: boolean;
  codigo: string | null;
  indicador_id: string | null;
  clique_id: string | null;
  motivo: string;
  regra: string;
};

export type Decision = {
  origem: { tipo: OriginType; codigo: string | null; detalhe: Record<string, string> | null };
  motivo: string;
  regra: string;
  janela: {
    antes_dias: number;
    depois_dias: number;
    primeira_abertura: string | null;
    inicio: string | null;
    fim: string | null;
  };
  cadastro_em: string;
  toques: EvaluatedTouch[];
  recompensa_indicacao: ReferralReward;
};

const DAY_MS = 86_400_000;
const TYPE_PRIORITY: Record<LinkType, number> = { indicacao: 0, campanha: 1, comunidade: 2 };
const TYPE_LABEL: Record<LinkType, string> = { indicacao: "indicação", campanha: "campanha", comunidade: "comunidade" };

const sameEmail = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

function isSelfReferral(touch: Touch, input: DecisionInput): boolean {
  if (touch.tipo !== "indicacao" || touch.indicadorId === null) return false;
  if (touch.indicadorId === input.cadastro.usuarioId) return true;
  const referrer = input.indicadores.get(touch.indicadorId);
  if (!referrer) return false;
  const sameDevice = referrer.instalacaoId !== null && referrer.instalacaoId === input.cadastro.instalacaoId;
  return sameEmail(referrer.email, input.cadastro.email) || sameDevice;
}

/** Ordem de vitória: mais recente; no empate, tipo; depois menor id de clique. */
function compareForWin(left: Touch, right: Touch): number {
  if (left.clicadoEm !== right.clicadoEm) return left.clicadoEm > right.clicadoEm ? -1 : 1;
  if (left.tipo !== right.tipo) return TYPE_PRIORITY[left.tipo] - TYPE_PRIORITY[right.tipo];
  return left.cliqueId < right.cliqueId ? -1 : left.cliqueId > right.cliqueId ? 1 : 0;
}

const organic = (motivo: string) => ({ origem: { tipo: "organico" as const, codigo: null, detalhe: null }, motivo });

export function decideOrigin(input: DecisionInput): Decision {
  const { primeiraAbertura, cadastroEm, janela } = input;
  const inicio = primeiraAbertura ? new Date(Date.parse(primeiraAbertura) - janela.antesDias * DAY_MS).toISOString() : null;
  const fim = primeiraAbertura ? new Date(Date.parse(primeiraAbertura) + janela.depoisDias * DAY_MS).toISOString() : null;
  const base = {
    regra: RULE,
    janela: { antes_dias: janela.antesDias, depois_dias: janela.depoisDias, primeira_abertura: primeiraAbertura, inicio, fim },
    cadastro_em: cadastroEm,
  };
  const rejected: EvaluatedTouch[] = input.rejeitados.map((report) => ({
    clique_id: report.cliqueId,
    codigo: null,
    tipo: null,
    clicado_em: null,
    compartilhado: false,
    venceu: false,
    motivo: report.motivo,
  }));

  if (primeiraAbertura === null || inicio === null || fim === null) {
    return {
      ...organic("aparelho sem primeira abertura registrada"),
      ...base,
      toques: rejected,
      recompensa_indicacao: noReward("aparelho sem primeira abertura registrada"),
    };
  }

  const signupLate = cadastroEm > fim;
  const reasons = new Map<string, string>();
  const valid: Touch[] = [];
  for (const touch of input.toques) {
    let reason: string | null = null;
    if (input.instalacaoJaUsada) reason = "instalação já usada por outro cadastro";
    else if (touch.clicadoEm > cadastroEm) reason = "posterior ao cadastro";
    else if (touch.clicadoEm < inicio) reason = "fora da janela (antes do início)";
    else if (touch.clicadoEm > fim) reason = "fora da janela (depois do fim)";
    else if (!touch.linkAtivoNoClique) reason = "link inativo no momento do clique";
    else if (isSelfReferral(touch, input)) reason = "autoindicação";
    else if (signupLate) reason = "cadastro depois do fim da janela";
    if (reason === null) valid.push(touch);
    else reasons.set(touch.cliqueId, reason);
  }

  const [winner, ...losers] = [...valid].sort(compareForWin);
  if (winner) {
    const tiedWith = losers.filter((touch) => touch.clicadoEm === winner.clicadoEm);
    const tieNote = tiedWith.length === 0
      ? ""
      : tiedWith.every((touch) => touch.tipo !== winner.tipo)
        ? " (empate de horário decidido pelo tipo)"
        : " (empate de horário decidido pelo id do clique)";
    const sharedNote = winner.compartilhado ? " (clique compartilhado: conta para a origem, não para recompensa)" : "";
    reasons.set(winner.cliqueId, `último toque válido${tieNote}${sharedNote}`);
    for (const touch of losers) {
      reasons.set(
        touch.cliqueId,
        touch.clicadoEm === winner.clicadoEm
          ? `empate de horário: perdeu para ${TYPE_LABEL[winner.tipo]} ${winner.codigo} (${touch.tipo === winner.tipo ? "id do clique" : "tipo"})`
          : "existe um toque mais recente",
      );
    }
  }

  const toques: EvaluatedTouch[] = [
    ...[...input.toques]
      .sort((left, right) => left.clicadoEm.localeCompare(right.clicadoEm) || left.cliqueId.localeCompare(right.cliqueId))
      .map((touch) => ({
        clique_id: touch.cliqueId,
        codigo: touch.codigo,
        tipo: touch.tipo,
        clicado_em: touch.clicadoEm,
        compartilhado: touch.compartilhado,
        venceu: touch === winner,
        motivo: reasons.get(touch.cliqueId) as string,
      })),
    ...rejected,
  ];

  const recompensa_indicacao = decideReward(input.toques, valid, reasons);
  if (winner) {
    return {
      origem: { tipo: winner.tipo, codigo: winner.codigo, detalhe: winner.detalhe },
      motivo: "último toque válido antes do cadastro",
      ...base,
      toques,
      recompensa_indicacao,
    };
  }
  return { ...organic(organicReason(input, signupLate, toques)), ...base, toques, recompensa_indicacao };
}

function noReward(motivo: string): ReferralReward {
  return { elegivel: false, codigo: null, indicador_id: null, clique_id: null, motivo, regra: REWARD_RULE };
}

/**
 * Quem recebe pela indicação: o último toque de indicação válido para a origem e clicado no
 * próprio aparelho. Independe de qual toque venceu a origem: uma campanha clicada depois não
 * tira a recompensa de quem indicou.
 */
function decideReward(all: Touch[], valid: Touch[], reasons: Map<string, string>): ReferralReward {
  const referrals = all.filter((touch) => touch.tipo === "indicacao");
  if (referrals.length === 0) return noReward("nenhum toque de indicação");
  const eligible = valid.filter((touch) => touch.tipo === "indicacao" && !touch.compartilhado).sort(compareForWin);
  const chosen = eligible[0];
  if (chosen) {
    return {
      elegivel: true,
      codigo: chosen.codigo,
      indicador_id: chosen.indicadorId,
      clique_id: chosen.cliqueId,
      motivo: "toque de indicação válido, clicado no próprio aparelho",
      regra: REWARD_RULE,
    };
  }
  const why = referrals.map((touch) =>
    valid.includes(touch) && touch.compartilhado ? "clique compartilhado" : (reasons.get(touch.cliqueId) as string),
  );
  return noReward(`nenhuma indicação elegível: ${[...new Set(why)].join("; ")}`);
}

function organicReason(input: DecisionInput, signupLate: boolean, toques: EvaluatedTouch[]): string {
  if (toques.length === 0) return "nenhum toque registrado";
  if (input.instalacaoJaUsada) return "instalação já usada por outro cadastro";
  if (signupLate) return "cadastro depois do fim da janela";
  const groups = { janela: 0, posterior: 0, invalido: 0 };
  for (const touch of toques) {
    if (touch.motivo.startsWith("fora da janela")) groups.janela += 1;
    else if (touch.motivo === "posterior ao cadastro") groups.posterior += 1;
    else groups.invalido += 1;
  }
  if (groups.janela === toques.length) return "todos os toques fora da janela";
  if (groups.posterior === toques.length) return "todos os toques são posteriores ao cadastro";
  if (groups.invalido === toques.length) return "todos os toques eram inválidos";
  return `nenhum toque válido (${groups.janela} fora da janela, ${groups.posterior} posteriores ao cadastro, ${groups.invalido} inválidos)`;
}
