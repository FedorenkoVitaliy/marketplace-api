const RETRYABLE = new Set(['40001', '40P01'])

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; driverError?: { code?: string } }
  return err.driverError?.code ?? err.code
}

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn()
    } catch (e) {
      const code = pgCode(e)
      if (code && RETRYABLE.has(code) && attempt < maxAttempts) {
        const backoff = Math.round(2 ** attempt * 25 + Math.random() * 25)
        console.log(`спроба ${attempt} впала: ${code} → retry через ${backoff} мс`)
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      throw e
    }
  }
}