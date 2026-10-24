import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { AuthConfig } from "../../config/auth";
import { HttpError } from "../../errors/http-error";
import type { AuthRepository, LoginInput, PublicUser, RegisterInput } from "./auth.types";
import { signAccessToken } from "./auth.tokens";

const bcryptRounds = 12;

export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    private readonly config: () => AuthConfig,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    if (await this.repository.findByEmail(input.email)) {
      throw new HttpError(409, "E-mail já cadastrado.");
    }
    const passwordHash = await bcrypt.hash(input.password, bcryptRounds);
    return this.repository.createBidder({ name: input.name, email: input.email, passwordHash, role: "BIDDER" });
  }

  async login(input: LoginInput) {
    const config = this.config();
    const user = await this.repository.findByEmail(input.email);
    // Mesmo para usuário inexistente, executar a comparação bcrypt.
    const hash = user?.passwordHash ?? await (this.dummyHash ??= bcrypt.hash(randomBytes(32).toString("hex"), bcryptRounds));
    const passwordMatches = await bcrypt.compare(input.password, hash);
    if (!user || !passwordMatches) throw new HttpError(401, "E-mail ou senha inválidos.");

    const { passwordHash: _passwordHash, ...publicUser } = user;
    return {
      user: publicUser,
      accessToken: signAccessToken(user.id, config),
      tokenType: "Bearer",
      expiresIn: config.expiresInSeconds,
    };
  }
}
