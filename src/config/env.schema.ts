import z from 'zod';

/**
 * JWT_* і pepper — зі сховища, без дефолтів. validate біжить на імпорті
 * AppModule, тобто до першого зʼєднання з БД.
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535),
  DB_URL: z.url({
    protocol: /^postgres$/,
  }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_KID: z.string().min(1),
  REFRESH_TOKEN_PEPPER: z.string().min(1),
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