import { IsOptional, IsUUID, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryPetsDto {
  @IsOptional()
  @IsUUID()
  speciesId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }: { value: string }) => value === 'true')
  @IsBoolean()
  activeOnly?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
