import { z } from "zod";

// Shared email field with normalization. Postgres @unique is case-sensitive,
// so a raw store would let john@x.com and John@x.com create two accounts.
// Lowercasing here — in the single shared validation gate — makes lookups and
// inserts consistent across every flow (signup, signin, verify, reset).
const emailField = () =>
  z
    .string()
    .email("Enter a valid email address")
    .transform((v) => v.toLowerCase());

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(100, "Full name must be at most 100 characters"),
  email: emailField(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const signinSchema = z.object({
  email: emailField(),
  password: z.string().min(1, "Password is required"),
});

export const codeSchema = z
  .string()
  .length(6, "Code must be 6 digits")
  .regex(/^\d+$/, "Code must contain only digits");

export const verifySchema = z.object({
  email: emailField(),
  code: codeSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailField(),
});

export const resetPasswordSchema = z.object({
  email: emailField(),
  code: codeSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
