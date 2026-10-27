import type { RequestHandler } from "express";
import { temporalRuntime } from "../modules/temporal/temporal-runtime";

// UTC transport exposes stored instants, never guesses the intended instant of legacy data.
// Keep this explicit in the response contract, including historical lots/bids/receipts.
export function temporalRepresentation(active: () => boolean = () => temporalRuntime.utcActive): RequestHandler {
  return (_req, res, next) => {
    const json = res.json.bind(res);
    res.json = body => {
      if (active() && body && typeof body === "object" && !Array.isArray(body) && res.statusCode < 400) {
        return json({ ...body, temporal: {
          representation: "STORED_UTC_INSTANT",
          legacyCanonicalMeaning: "UNKNOWN",
          historicalNormalization: "NONE",
        } });
      }
      return json(body);
    };
    next();
  };
}
