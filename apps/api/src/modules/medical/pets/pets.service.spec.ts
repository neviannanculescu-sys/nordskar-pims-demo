import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { PetsService } from './pets.service';
import { DRIZZLE_DB } from '../../../database/database.module';
import { PetGender } from './dto/create-pet.dto';

const auditCtx = { userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' };

const basePet = {
  id:        'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  ownerId:   'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name:      'Rex',
  speciesId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  gender:    'male',
  isActive:  true,
  deletedAt: null,
  createdAt: new Date(),
};

const baseOwner = { id: basePet.ownerId };

describe('PetsService', () => {
  let service: PetsService;
  let mockDb: { select: jest.Mock; insert: jest.Mock; update: jest.Mock; transaction: jest.Mock };

  function makeChain(result: unknown[] = [basePet]) {
    const c: Record<string, jest.Mock> = {};
    const methods = ['from','where','limit','offset','orderBy','values','set','returning'];
    methods.forEach(m => { c[m] = jest.fn(() => c); });
    c['returning'] = jest.fn(() => Promise.resolve(result));
    c['limit']     = jest.fn(() => Promise.resolve(result));
    return c;
  }

  beforeEach(async () => {
    mockDb = {
      select:      jest.fn(() => makeChain()),
      insert:      jest.fn(() => makeChain()),
      update:      jest.fn(() => makeChain()),
      transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PetsService,
        { provide: DRIZZLE_DB, useValue: mockDb },
      ],
    }).compile();

    service = module.get(PetsService);
  });

  describe('findOneOrFail', () => {
    it('throws NotFoundException when pet missing', async () => {
      mockDb.select.mockReturnValue(makeChain([]));
      await expect(service.findOneOrFail('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns pet when found', async () => {
      mockDb.select.mockReturnValue(makeChain([basePet]));
      const result = await service.findOneOrFail(basePet.id);
      expect(result.id).toBe(basePet.id);
    });
  });

  describe('create', () => {
    it('throws NotFoundException when owner does not exist', async () => {
      // Owner lookup returns empty
      mockDb.select.mockReturnValueOnce(makeChain([]));

      await expect(
        service.create(
          'non-existent-owner',
          { name: 'Mimi', speciesId: basePet.speciesId, gender: PetGender.FEMALE },
          auditCtx,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException for duplicate chip number', async () => {
      // Owner found, then chip conflict
      mockDb.select
        .mockReturnValueOnce(makeChain([baseOwner]))   // owner check → found
        .mockReturnValueOnce(makeChain([{ id: 'other-pet' }])); // chip check → conflict

      await expect(
        service.create(
          basePet.ownerId,
          { name: 'Rex', speciesId: basePet.speciesId, gender: PetGender.MALE, chipNumber: '123456789012345' },
          auditCtx,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
