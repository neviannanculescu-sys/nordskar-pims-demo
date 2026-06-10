import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthTokens } from '../../common/types/jwt.types';
import { ApiResponse } from '../../common/types/api-response.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<ApiResponse<AuthTokens>> {
    const tokens = await this.authService.login(dto);
    return { data: tokens };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<ApiResponse<AuthTokens>> {
    const tokens = await this.authService.refresh(dto);
    return { data: tokens };
  }

  /**
   * Logout is stateless for MVP — client must discard both tokens.
   * TODO Phase 2: add Redis token blacklist for access token revocation.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(): void {
    // Intentionally empty: client discards tokens, no server state to clear yet.
  }
}
