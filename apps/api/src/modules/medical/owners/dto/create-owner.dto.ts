import {
  IsEnum,
  IsString,
  IsOptional,
  IsBoolean,
  IsEmail,
  MaxLength,
  MinLength,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';

export enum OwnerType {
  INDIVIDUAL = 'individual',
  COMPANY    = 'company',
}

export enum PreferredChannel {
  PHONE    = 'phone',
  EMAIL    = 'email',
  WHATSAPP = 'whatsapp',
  SMS      = 'sms',
}

export class CreateOwnerDto {
  @IsEnum(OwnerType)
  type!: OwnerType;

  @ValidateIf((o: CreateOwnerDto) => o.type === OwnerType.INDIVIDUAL)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ValidateIf((o: CreateOwnerDto) => o.type === OwnerType.INDIVIDUAL)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @ValidateIf((o: CreateOwnerDto) => o.type === OwnerType.INDIVIDUAL)
  @IsOptional()
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  cnp?: string;

  @ValidateIf((o: CreateOwnerDto) => o.type === OwnerType.COMPANY)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName?: string;

  @ValidateIf((o: CreateOwnerDto) => o.type === OwnerType.COMPANY)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cui?: string;

  @IsOptional()
  @IsBoolean()
  vatPayer?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressStreet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  addressZip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  addressCountry?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phonePrimary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneSecondary?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp?: string;

  @IsOptional()
  @IsEnum(PreferredChannel)
  preferredChannel?: PreferredChannel;

  @IsBoolean()
  gdprConsent!: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
