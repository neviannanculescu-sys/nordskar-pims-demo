import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { OwnersService } from './owners.service';
import { DRIZZLE_DB } from '../../../database/database.module';
import { OwnerType } from './dto/create-owner.dto';

const auditCtx = { userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', ip: '127.0.0.1' };

const baseOwner = {
  id:           'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  type:         'individual',
  firstName:    'Ion',
  lastName:     'Popescu',
  phonePrimary: '0700000001',
  isActive:     true,
  deletedAt:    null,
  createdAt:    new Date(),
};

describe('OwnersService', () => {
  let service: OwnersService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    // Chainable query builder mock
    const chain = () => {
      const obj: Record<string, jest.Mock> = {};
      const methods = ['from','where','limit','offset','orderBy','values','set','returning'];
      methods.forEach(m => { obj[m] = jest.fn(() => obj); });
      obj['returning'] = jest.fn(() => Promise.resolve([baseOwner]));
      return obj;
    };

    mockDb = {
      select:      jest.fn(() => chain()),
      insert:      jest.fn(() => chain()),
      update:      jest.fn(() => chain()),
      transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OwnersService,
        { provide: DRIZZLE_DB, useValue: mockDb },
      ],
    }).compile();

    service = module.get(OwnersService);
  });

  describe('findOneOrFail', () => {
    it('returns owner when found', async () => {
      const chain = { from: jest.fn(), where: jest.fn(), limit: jest.fn() };
      chain.from.mockReturnValue(chain);
      chain.where.mockReturnValue(chain);
      chain.limit.mockResolvedValue([baseOwner]);
      mockDb.select.mockReturnValue(chain);

      const result = await service.findOneOrFail(baseOwner.id);
      expect(result.id).toBe(baseOwner.id);
    });

    it('throws NotFoundException when owner not found', async () => {
      const chain = { from: jest.fn(), where: jest.fn(), limit: jest.fn() };
      chain.from.mockReturnValue(chain);
      chain.where.mockReturnValue(chain);
      chain.limit.mockResolvedValue([]);
      mockDb.select.mockReturnValue(chain);

      await expect(service.findOneOrFail('non-existent-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('throws ConflictException for duplicate phone', async () => {
      // First select (duplicate check) returns existing owner
      const chain = { from: jest.fn(), where: jest.fn(), limit: jest.fn() };
      chain.from.mockReturnValue(chain);
      chain.where.mockReturnValue(chain);
      chain.limit.mockResolvedValue([{ id: baseOwner.id }]);
      mockDb.select.mockReturnValue(chain);

      await expect(
        service.create(
          {
            type:         OwnerType.INDIVIDUAL,
            firstName:    'Alt',
            lastName:     'Popescu',
            phonePrimary: '0700000001',
            gdprConsent:  true,
          },
          auditCtx,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
