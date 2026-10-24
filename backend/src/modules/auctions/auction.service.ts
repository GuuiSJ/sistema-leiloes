import { HttpError } from "../../errors/http-error";
import type { Auction } from "../../generated/prisma/client";
import type { AuctionInput, AuctionPage, AuctionPatch, AuctionQuery, AuctionRepository, AuctionView } from "./auction.types";

function publicAuction(auction: Auction): AuctionView {
  // Seleção explícita: não serializar organizador ou suas informações pessoais.
  return {
    id: auction.id,
    title: auction.title,
    description: auction.description,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    status: auction.status,
    createdAt: auction.createdAt,
    updatedAt: auction.updatedAt,
  };
}

function validPeriod(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new HttpError(400, "A data de término deve ser posterior à data de início.");
  }
}

function requireOwner(auction: Auction, userId: string): void {
  if (auction.organizerId !== userId) throw new HttpError(403, "Somente o responsável pode alterar este leilão.");
}

export class AuctionService {
  constructor(private readonly repository: AuctionRepository, private readonly now: () => Date = () => new Date()) {}

  async create(input: AuctionInput, userId: string): Promise<AuctionView> {
    validPeriod(input.startsAt, input.endsAt);
    return publicAuction(await this.repository.create(input, userId));
  }

  async list(query: AuctionQuery): Promise<AuctionPage> {
    const { auctions, total } = await this.repository.list(query);
    return {
      data: auctions.map(publicAuction),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async findById(id: string): Promise<AuctionView> {
    const auction = await this.repository.findById(id);
    if (!auction) throw new HttpError(404, "Leilão não encontrado.");
    return publicAuction(auction);
  }

  async update(id: string, patch: AuctionPatch, userId: string): Promise<AuctionView> {
    return publicAuction(await this.repository.mutate(id, ({ auction }) => {
      requireOwner(auction, userId);
      if (auction.status !== "DRAFT" || auction.startsAt <= this.now()) {
        throw new HttpError(409, "Somente leilões em DRAFT e ainda não iniciados podem ser editados.");
      }
      const startsAt = patch.startsAt ?? auction.startsAt;
      const endsAt = patch.endsAt ?? auction.endsAt;
      validPeriod(startsAt, endsAt);
      if (startsAt <= this.now()) throw new HttpError(400, "A nova data de início deve estar no futuro.");
      return patch;
    }));
  }

  async cancel(id: string, userId: string): Promise<AuctionView> {
    return publicAuction(await this.repository.mutate(id, ({ auction, hasIncompatibleOperations }) => {
      requireOwner(auction, userId);
      if (!["DRAFT", "SCHEDULED"].includes(auction.status) || auction.startsAt <= this.now()) {
        throw new HttpError(409, "Somente leilões DRAFT ou SCHEDULED ainda não iniciados podem ser cancelados.");
      }
      if (hasIncompatibleOperations) {
        throw new HttpError(409, "Leilão possui lotes, lances ou operações incompatíveis com cancelamento.");
      }
      return { status: "CANCELLED" };
    }));
  }
}
