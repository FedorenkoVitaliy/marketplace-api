import { readFileSync } from "node:fs"
import { parse } from "dotenv"
import { envSchema } from "../dist/src/config/env.schema.js"

const fileEnv = parse(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
const schemaKeys = Object.keys(envSchema.shape).sort();
const fileKeys = Object.keys(fileEnv).sort();
const missing = schemaKeys.filter((k) => !fileKeys.includes(k));
const extra = fileKeys.filter((k) => !schemaKeys.includes(k));

if(missing.length || extra.length){
  console.error(...missing, extra);
  process.exit(1)
} else {
  console.log('sync');
}