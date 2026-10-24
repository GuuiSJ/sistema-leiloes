import { resolve } from "node:path";
import { config } from "dotenv";

// O mesmo caminho funciona em src/config e dist/config, independentemente do cwd.
// Variáveis já definidas no processo têm prioridade sobre o arquivo local.
config({ path: resolve(__dirname, "../../.env"), quiet: true });
