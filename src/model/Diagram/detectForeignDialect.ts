// #373: a PlantUML source pasted into a ZenUML sequence macro parses without
// error but renders nonsense (PlantUML keywords become their own lifelines,
// alias declarations duplicate lifelines, activate/deactivate become blank
// self-messages). There is no parser error to hook into, so detection has to
// look at the raw source text before it ever reaches the ZenUML renderer.
//
// Detection is deliberately narrow: `@startuml` (optionally followed by a
// diagram name, e.g. `@startuml MyDiagram`) is PlantUML's own required fence
// opener — https://plantuml.com/sequence-diagram — and is not valid ZenUML
// syntax in any position, so it cannot fire on real ZenUML source. A false
// positive that nags a user writing valid ZenUML is worse than a missed
// detection (see issue #373 "Scope"), so no keyword-density heuristic
// (autonumber/actor/participant/activate — all of which double as ordinary
// English words a user might type in a message body) is used.
export type ForeignDialect = "plantuml";

const PLANTUML_FENCE = /^\s*@startuml\b/im;

export function detectForeignDialect(code: string | null | undefined): ForeignDialect | null {
  if (!code) return null;
  if (PLANTUML_FENCE.test(code)) return "plantuml";
  return null;
}
