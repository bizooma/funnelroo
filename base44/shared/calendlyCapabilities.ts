// False/missing flags are not evidence of an account plan restriction.
export function calendlyPlanRestriction(status, responseBody) {
  const text = String(responseBody || "");
  if (![402, 403].includes(status)) return "unknown";
  if (/\bfree plan\b/i.test(text) && /upgrade|not available|not supported|requires|cannot|can't/i.test(text)) return "free_plan";
  if (/subscription upgrade required|requires? (?:a )?(?:paid|premium|professional|standard|teams) (?:plan|subscription)|upgrade (?:your|the) (?:plan|subscription)/i.test(text)) return "plan_restriction";
  return "unknown";
}