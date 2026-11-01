// Why a training night's off, in words (#186, ADR 0122): its own file, as only the night's page says it, so Home's
// first paint doesn't carry it (ADR 0120).

/**
 * Why a night's off, as Manage's It's back on says it (#186): "off for The Cougars Kumite", "called off", or both. It
 * goes on whatever kept it off.
 */
export function offWhy(night: { offByHand?: boolean; offFor?: number[] }, names: (id: number) => string | undefined) {
  const kumites = [...new Set((night.offFor ?? []).map((id) => names(id) ?? "a tournament"))];
  const reasons = [
    ...(night.offByHand || !kumites.length ? ["called off"] : []),
    ...(kumites.length ? [`off for ${kumites.join(" and ")}`] : []),
  ];
  return reasons.join(", and ");
}
