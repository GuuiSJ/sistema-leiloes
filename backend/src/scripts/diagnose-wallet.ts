import { getSimulatedCreditDiagnostics } from "../config/wallet";

// This import loads backend/.env through config/wallet -> config/env first.
// Only booleans are printed; never include environment values or URL components.
console.log(JSON.stringify(getSimulatedCreditDiagnostics(), null, 2));
