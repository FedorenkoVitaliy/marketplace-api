let seq = 0;

export function aUser(overrides: Partial<{ email: string }> = {}) {
  seq += 1;
  return { email: `buyer-${seq}@example.com`, ...overrides };
}

export function anOrder(userId: string, overrides: Partial<{ status: string }> = {}) {
  return { userId, status: 'pending', ...overrides };
}
