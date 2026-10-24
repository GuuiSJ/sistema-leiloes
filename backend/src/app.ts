
import express from "express";
import cors from "cors";
import "./config/env";
import routes from "./routes";
import { errorHandler } from "./middlewares/error-handler";
import { notFound } from "./middlewares/not-found";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }));
app.use(express.json());

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

export default app;
