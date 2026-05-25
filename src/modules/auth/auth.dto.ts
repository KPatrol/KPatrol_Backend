import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

// All upper-bound caps below are defensive — class-validator rejects bodies
// that exceed them before the service touches the DB. Without MaxLength, a
// caller could submit a multi-megabyte string and balloon the user row.

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
