import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthTokens, JwtPayload } from '../../common/types/jwt.types';
import { UserRole } from '../../common/constants/roles.constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || !user.isActive) {
      // Constant-time response to prevent user enumeration
      await bcrypt.compare(dto.password, '$2b$10$placeholderHashForTimingAttack');
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.usersService.updateLastLogin(user.id);
    this.logger.log(`User ${user.id} logged in`);

    return this.issueTokens(user.id, user.email, user.role as UserRole);
  }

  async refresh(dto: RefreshTokenDto): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findActiveById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return this.issueTokens(user.id, user.email, user.role as UserRole);
  }

  private issueTokens(id: string, email: string, role: UserRole): AuthTokens {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = { sub: id, email, role };
    // parseInt ensures env strings like "900" are treated as seconds (not ms by jsonwebtoken)
    const accessExpiresIn  = parseInt(this.config.get('JWT_EXPIRES_IN',  '900'),   10);
    const refreshExpiresIn = parseInt(this.config.get('JWT_REFRESH_EXPIRES_IN', '604800'), 10);

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: accessExpiresIn,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresIn,
    };
  }
}
