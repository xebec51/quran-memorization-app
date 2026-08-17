import bcrypt from "bcryptjs";
import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(10).max(200),
  name: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).max(80).optional()
  )
});

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
