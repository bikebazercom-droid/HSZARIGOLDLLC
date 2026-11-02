import bcrypt from "bcryptjs";

export function normalizeMobile(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function isFourDigitPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export async function pinMatchesHash(pin: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}

export async function findUserByMobileAndPin<
  T extends { mobile: string; passwordHash: string },
>(
  candidates: T[],
  normalizedMobile: string,
  pin: string,
): Promise<T | undefined> {
  for (const candidate of candidates) {
    if (
      normalizeMobile(candidate.mobile) === normalizedMobile &&
      (await pinMatchesHash(pin, candidate.passwordHash))
    ) {
      return candidate;
    }
  }

  return undefined;
}

export type ExistingAdminSeedAction = "unchanged" | "preserve" | "reset";

export function decideExistingAdminSeedAction(
  bootstrapCredentialsMatch: boolean,
  resetRequested: boolean,
): ExistingAdminSeedAction {
  if (bootstrapCredentialsMatch) return "unchanged";
  return resetRequested ? "reset" : "preserve";
}
