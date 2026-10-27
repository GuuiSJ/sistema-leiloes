
import express from "express";
import cors from "cors";
import "./config/env";
import routes from "./routes";
import { errorHandler } from "./middlewares/error-handler";
import { notFound } from "./middlewares/not-found";
import { frontendOrigin } from "./config/http";
import { temporalRepresentation } from "./middlewares/temporal-representation";

const app = express();

app.use(cors({ origin: frontendOrigin() }));
app.use(express.json());
app.use(temporalRepresentation());

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

export default app;
