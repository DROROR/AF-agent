import { z } from "zod";

/**
 * Dashboard user auth is a separate system from Windows worker token auth
 * (CLAUDE.md: "Dashboard user auth and Worker token auth are separate
 * systems") - nothing here is shared with worker.ts's bearer-token model.
 */
export const USER_ROLES = ["ADMIN", "OPERATOR"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const userRoleSchema = z.enum(USER_ROLES);

/** Never includes passwordHash - this is the only shape a user is ever returned in over the wire. */
export const userDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable()
});
export type UserDto = z.infer<typeof userDtoSchema>;

const nameSchema = z.string().trim().min(1, "Name is required").max(200);
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
/** Minimum length only - a policy beyond that belongs to a dedicated password-strength library, not this MVP. */
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);

export const signUpRequestSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const logInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false)
});
export type LogInRequest = z.infer<typeof logInRequestSchema>;

/**
 * Server-to-server shape only (apps/api -> apps/web's route handlers over
 * loopback). sessionToken is set as an HttpOnly cookie by the Next.js route
 * handler and must never reach the browser in a JSON body - see
 * userFacingAuthResponseSchema below for what the browser actually gets.
 */
export const authSessionResponseSchema = z.object({
  user: userDtoSchema,
  sessionToken: z.string().min(1),
  expiresAt: z.string().datetime()
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

/** What the browser receives from /api/auth/signup, /login, /me - user only, never a token. */
export const userFacingAuthResponseSchema = z.object({ user: userDtoSchema });
export type UserFacingAuthResponse = z.infer<typeof userFacingAuthResponseSchema>;
