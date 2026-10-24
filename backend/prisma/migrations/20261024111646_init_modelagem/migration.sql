-- CreateSchema


-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AUCTIONEER', 'BIDDER');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('PENDING', 'OPEN', 'SOLD', 'UNSOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'RESERVE', 'RELEASE', 'DEBIT');

-- CreateEnum
CREATE TYPE "BidReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CAPTURED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('AUCTION_CREATED', 'AUCTION_UPDATED', 'AUCTION_OPENED', 'AUCTION_CLOSED', 'AUCTION_CANCELLED', 'LOT_CREATED', 'LOT_OPENED', 'LOT_CLOSED', 'LOT_CANCELLED', 'BID_PLACED', 'WALLET_CREDITED', 'FUNDS_RESERVED', 'FUNDS_RELEASED', 'FUNDS_DEBITED', 'RECEIPT_ISSUED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "model" VARCHAR(150) NOT NULL,
    "year" INTEGER NOT NULL,
    "version" VARCHAR(150),
    "description" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fipeCode" VARCHAR(30),
    "fipeBrandCode" VARCHAR(30),
    "fipeModelCode" VARCHAR(30),
    "fipeYearCode" VARCHAR(30),
    "fipeReferenceMonth" VARCHAR(50),
    "fipeReferencePrice" DECIMAL(18,2),
    "fipeConsultedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "startingPrice" DECIMAL(18,2) NOT NULL,
    "minimumIncrement" DECIMAL(18,2) NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'PENDING',
    "winnerId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "reservationId" UUID,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidReservation" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "bidId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "BidReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BidReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionReceipt" (
    "id" UUID NOT NULL,
    "publicId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "winnerId" UUID NOT NULL,
    "winningBidId" UUID NOT NULL,
    "finalAmount" DECIMAL(18,2) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auctionTitle" VARCHAR(150) NOT NULL,
    "lotNumber" INTEGER NOT NULL,
    "vehicleBrand" VARCHAR(100) NOT NULL,
    "vehicleModel" VARCHAR(150) NOT NULL,
    "vehicleYear" INTEGER NOT NULL,
    "vehicleVersion" VARCHAR(150),

    CONSTRAINT "AuctionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "authorId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicData" JSONB NOT NULL DEFAULT '{}',
    "previousHash" CHAR(64),
    "currentHash" CHAR(64) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Vehicle_brand_model_year_idx" ON "Vehicle"("brand", "model", "year");

-- CreateIndex
CREATE INDEX "Vehicle_fipeCode_idx" ON "Vehicle"("fipeCode");

-- CreateIndex
CREATE INDEX "Auction_organizerId_createdAt_idx" ON "Auction"("organizerId", "createdAt");

-- CreateIndex
CREATE INDEX "Auction_status_startsAt_idx" ON "Auction"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Auction_status_endsAt_idx" ON "Auction"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Lot_auctionId_status_idx" ON "Lot"("auctionId", "status");

-- CreateIndex
CREATE INDEX "Lot_vehicleId_idx" ON "Lot"("vehicleId");

-- CreateIndex
CREATE INDEX "Lot_winnerId_idx" ON "Lot"("winnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_auctionId_number_key" ON "Lot"("auctionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_auctionId_vehicleId_key" ON "Lot"("auctionId", "vehicleId");

-- CreateIndex
CREATE INDEX "Bid_lotId_amount_createdAt_idx" ON "Bid"("lotId", "amount" DESC, "createdAt");

-- CreateIndex
CREATE INDEX "Bid_userId_createdAt_idx" ON "Bid"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_id_lotId_userId_key" ON "Bid"("id", "lotId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_lotId_sequence_key" ON "Bid"("lotId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_id_userId_key" ON "Wallet"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_reservationId_walletId_idx" ON "WalletTransaction"("reservationId", "walletId");

-- CreateIndex
CREATE UNIQUE INDEX "BidReservation_bidId_key" ON "BidReservation"("bidId");

-- CreateIndex
CREATE INDEX "BidReservation_walletId_status_idx" ON "BidReservation"("walletId", "status");

-- CreateIndex
CREATE INDEX "BidReservation_lotId_status_idx" ON "BidReservation"("lotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BidReservation_walletId_lotId_key" ON "BidReservation"("walletId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "BidReservation_id_walletId_key" ON "BidReservation"("id", "walletId");

-- CreateIndex
CREATE UNIQUE INDEX "BidReservation_bidId_lotId_userId_key" ON "BidReservation"("bidId", "lotId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionReceipt_publicId_key" ON "AuctionReceipt"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionReceipt_lotId_key" ON "AuctionReceipt"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionReceipt_winningBidId_key" ON "AuctionReceipt"("winningBidId");

-- CreateIndex
CREATE INDEX "AuctionReceipt_winnerId_issuedAt_idx" ON "AuctionReceipt"("winnerId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionReceipt_winningBidId_lotId_winnerId_key" ON "AuctionReceipt"("winningBidId", "lotId", "winnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "AuditEvent"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_previousHash_key" ON "AuditEvent"("previousHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_currentHash_key" ON "AuditEvent"("currentHash");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_authorId_occurredAt_idx" ON "AuditEvent"("authorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_occurredAt_idx" ON "AuditEvent"("action", "occurredAt");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_reservationId_walletId_fkey" FOREIGN KEY ("reservationId", "walletId") REFERENCES "BidReservation"("id", "walletId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidReservation" ADD CONSTRAINT "BidReservation_walletId_userId_fkey" FOREIGN KEY ("walletId", "userId") REFERENCES "Wallet"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidReservation" ADD CONSTRAINT "BidReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidReservation" ADD CONSTRAINT "BidReservation_bidId_lotId_userId_fkey" FOREIGN KEY ("bidId", "lotId", "userId") REFERENCES "Bid"("id", "lotId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionReceipt" ADD CONSTRAINT "AuctionReceipt_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionReceipt" ADD CONSTRAINT "AuctionReceipt_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionReceipt" ADD CONSTRAINT "AuctionReceipt_winningBidId_lotId_winnerId_fkey" FOREIGN KEY ("winningBidId", "lotId", "winnerId") REFERENCES "Bid"("id", "lotId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
