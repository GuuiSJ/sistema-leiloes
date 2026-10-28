import { HttpError } from "../../errors/http-error";
import type { ReceiptRepository } from "./receipt.repository";
import type { AuctionReceipt } from "../../generated/prisma/client";

export function publicReceipt(r: AuctionReceipt) {
  return { publicId: r.publicId, lotId: r.lotId, winningBidId: r.winningBidId, finalAmount: r.finalAmount.toFixed(2), issuedAt: r.issuedAt, auctionTitle: r.auctionTitle, lotNumber: r.lotNumber, vehicleBrand: r.vehicleBrand, vehicleModel: r.vehicleModel, vehicleYear: r.vehicleYear, vehicleVersion: r.vehicleVersion };
}

export class ReceiptService {
  constructor(private readonly repository: ReceiptRepository) {}
  async get(lotId: string, userId: string) {
    const lot = await this.repository.find(lotId);
    if (!lot) throw new HttpError(404, "Lote não encontrado.");
    const r = lot.receipt;
    if (lot.auction.organizerId !== userId && r?.winnerId !== userId) throw new HttpError(403, "Acesso ao comprovante não permitido.");
    if (!r) throw new HttpError(404, "Comprovante não disponível para este lote.");
    return publicReceipt(r);
  }
}
