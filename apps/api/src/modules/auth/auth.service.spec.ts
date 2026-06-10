import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

const mockUser = {
  id:           'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  email:        'admin@vet.ro',
  passwordHash: '',
  role:         'admin',
  isActive:     true,
  deletedAt:    null,
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeAll(async () => {
    mockUser.passwordHash = await bcrypt.hash('Password123!', 10);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail:   jest.fn(),
            findActiveById: jest.fn(),
            updateLastLogin: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(() => 'signed-token'), verify: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const cfg: Record<string, unknown> = {
                JWT_SECRET:              'test-secret-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                JWT_REFRESH_SECRET:      'test-refresh-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                JWT_EXPIRES_IN:          900,
                JWT_REFRESH_EXPIRES_IN:  604800,
              };
              return cfg[key];
            }),
            get: jest.fn((key: string, fallback: unknown) => fallback),
          },
        },
      ],
    }).compile();

    service      = module.get(AuthService);
    usersService = module.get(UsersService);
    jwtService   = module.get(JwtService);
  });

  describe('login', () => {
    it('returns tokens on valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as never);
      usersService.updateLastLogin.mockResolvedValue();

      const result = await service.login({ email: 'admin@vet.ro', password: 'Password123!' });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.expiresIn).toBe(900);
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as never);

      await expect(
        service.login({ email: 'admin@vet.ro', password: 'WrongPass!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user not found (no enumeration)', async () => {
      usersService.findByEmail.mockResolvedValue(null as never);

      await expect(
        service.login({ email: 'nobody@vet.ro', password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for inactive user', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser, isActive: false } as never);

      await expect(
        service.login({ email: 'admin@vet.ro', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('returns new tokens on valid refresh token', async () => {
      jwtService.verify.mockReturnValue({
        sub:   mockUser.id,
        email: mockUser.email,
        role:  mockUser.role,
      } as never);
      usersService.findActiveById.mockResolvedValue(mockUser as never);

      const result = await service.refresh({ refreshToken: 'valid-token' });
      expect(result).toHaveProperty('accessToken');
    });

    it('throws UnauthorizedException for invalid refresh token', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('jwt expired'); });

      await expect(
        service.refresh({ refreshToken: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
