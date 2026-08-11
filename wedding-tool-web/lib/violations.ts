import type { Assignment, Rule } from "./types";

// Leichtgewichtige Portierung von computeRuleViolations() aus dem alten
// Tool, reduziert auf das, was diese Phase braucht: welche Sitze bekommen
// einen roten Rahmen. Die volle Warnungen-Seitenleiste (aufklappbare Liste,
// Klick-zum-Zentrieren, Nachnamen-/Kapazitäts-Hinweise) ist kein Teil der
// Migrationsanleitung und wurde hier bewusst nicht mit migriert.
export function computeViolatedSeatIds(
  assignments: Assignment[],
  rules: Rule[],
  tableIdBySeatId: Map<string, string>
): Set<string> {
  const seatByGuest = new Map(assignments.map((a) => [a.guest_id, a.seat_id]));
  const violated = new Set<string>();

  for (const rule of rules) {
    const seatA = seatByGuest.get(rule.guest_a);
    const seatB = seatByGuest.get(rule.guest_b);
    if (!seatA || !seatB) continue;

    const sameTable = tableIdBySeatId.get(seatA) === tableIdBySeatId.get(seatB);
    if ((rule.type === "apart" && sameTable) || (rule.type === "together" && !sameTable)) {
      violated.add(seatA);
      violated.add(seatB);
    }
  }
  return violated;
}
