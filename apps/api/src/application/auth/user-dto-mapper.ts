import type { UserDto } from "@dyo/schemas";
import type { User } from "../../domain/auth/types.js";

/** Translates the internal domain entity into the versioned public contract. passwordHash never leaves this boundary. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null
  };
}
