import z from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535),
  DB_URL: z.url({
    protocol: /^postgres$/,
  }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
})

export type Env = z.infer<typeof envSchema>

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  
  if(!parsed.success){
    const errors = parsed.error.issues.reduce((acc, item) => {
      const error = item.path.join('.') + ':' + item.message;
      acc = acc + error + '\n';
      return acc;
    }, '')
    throw new Error(errors);
  }

  return parsed.data;
}