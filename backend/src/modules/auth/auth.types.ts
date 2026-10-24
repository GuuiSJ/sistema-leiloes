import type { User, UserRole } from "../../generated/prisma/client";

export type PublicUser = Pick<User, "id" | "name" | "email" | "role" | "createdAt">;
export type LoginUser = PublicUser & Pick<User, "passwordHash">;

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: "BIDDER";
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthRepository {
  findByEmail(email: string): Promise<LoginUser | null>;
  findPublicById(id: string): Promise<PublicUser | null>;
  createBidder(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: "BIDDER";
  }): Promise<PublicUser>;
}

export type Role = UserRole;

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicUser;
    }
  }
}
