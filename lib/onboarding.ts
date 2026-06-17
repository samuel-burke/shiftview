// Pure helpers for per-employee onboarding checklists (a new hire's tasks:
// "Sign W-4", "Uniform issued", "POS training"). Managers add/check items; the
// employee can see their own progress.

export const ONBOARDING_LABEL_MAX = 120;

export type LabelResult = { valid: true; value: string } | { valid: false; error: string };

export function validateOnboardingLabel(label: unknown): LabelResult {
  if (typeof label !== "string" || !label.trim())
    return { valid: false, error: "Label is required" };
  const value = label.trim();
  if (value.length > ONBOARDING_LABEL_MAX)
    return { valid: false, error: `Label must be ${ONBOARDING_LABEL_MAX} characters or fewer` };
  return { valid: true, value };
}

export type OnboardingProgress = {
  total: number;
  done: number;
  pct: number;
  complete: boolean;
};

export function onboardingProgress(items: { done: boolean }[]): OnboardingProgress {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return {
    total,
    done,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    complete: total > 0 && done === total,
  };
}
