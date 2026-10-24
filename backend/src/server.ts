
import "dotenv/config";
import app from "./app";

const PORT = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT deve ser um número inteiro entre 1 e 65535.");
}

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
