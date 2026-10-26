// Reuse the strict Decimal(18,2), key, pagination and UUID contracts already used by the API.
export { validateCredit as validateCreate, validateKey, validateQuery, validateNoQuery } from "../wallet/wallet.validation";
export { validateId } from "../lots/lot.validation";
