import { Prisma } from "../../generated/prisma/client";
import { HttpError } from "../../errors/http-error";
import { getPrisma } from "../../lib/prisma";
import type { AuthRepository } from "./auth.types";

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export const authRepository: AuthRepository = {
  findByEmail(email) {
    return getPrisma().user.findUnique({
      where: { email },
      select: { ...publicUserSelect, passwordHash: true },
    });
  },
  findPublicById(id) {
    return getPrisma().user.findUnique({ where: { id }, select: publicUserSelect });
  },
  async createBidder(input) {
    try {
      return await getPrisma().user.create({ data: input, select: publicUserSelect });
    } catch (error: unknown) {
      // A restrição única também protege cadastros simultâneos do mesmo e-mail.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "E-mail já cadastrado.");
      }
      throw error;
    }
  },
};
