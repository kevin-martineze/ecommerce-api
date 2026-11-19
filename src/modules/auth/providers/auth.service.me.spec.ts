import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Mailer } from '@shared/mail/mailer';
import { PrismaService } from '@db/prisma.service';

import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * `GET /auth/me` y el bloque `signIn`, sin base: Prisma es un doble. Lo que
 * lee de verdad la tabla de identidades lo prueba `auth-google-account.e2e-spec.ts`.
 */

const SECRET = 'un-secreto-de-pruebas-de-al-menos-32-caracteres';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$hash-que-no-debe-salir';
const GOOGLE_SUB = '1098765432101234567890';
const LINKED_AT = new Date('2026-11-19T12:00:00.000Z');

const store = { id: 'store-1', name: 'Tienda', slug: 'tienda' };

interface State {
  /** Si la cuenta tiene contraseña. Por defecto, sí. */
  hasPassword?: boolean;
  /** `false` simula una cuenta que ya no existe. */
  exists?: boolean;
  /** La identidad de Google más antigua de la cuenta, o null si no hay ninguna. */
  google?: { email: string; createdAt: Date } | null;
}

async function setup(state: State = {}) {
  const user =
    state.exists === false
      ? null
      : {
          id: 'user-1',
          email: 'duena@tienda.test',
          fullName: 'María',
          passwordHash: state.hasPassword === false ? null : HASH,
          memberships: [{ role: 'OWNER', store }],
          platformAdmin: null,
        };

  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    userIdentity: { findFirst: jest.fn().mockResolvedValue(state.google ?? null) },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: TokenService, useValue: {} },
      { provide: PasswordService, useValue: {} },
      { provide: GoogleAuthService, useValue: {} },
      { provide: JwtService, useValue: new JwtService({ secret: SECRET }) },
      { provide: Mailer, useValue: {} },
      { provide: ConfigService, useValue: new ConfigService({ FRONTEND_URL: 'https://g.test' }) },
    ],
  }).compile();

  return { auth: moduleRef.get(AuthService), prisma };
}

describe('AuthService.me: cómo entra la cuenta', () => {
  it('con contraseña y sin Google: hasPassword true y google null', async () => {
    const { auth } = await setup({ google: null });

    const me = await auth.me('user-1');

    expect(me.signIn).toEqual({ hasPassword: true, google: null });
  });

  it('solo con Google: hasPassword false, y el correo y la fecha del vínculo', async () => {
    const { auth } = await setup({
      hasPassword: false,
      google: { email: 'maria@gmail.com', createdAt: LINKED_AT },
    });

    const me = await auth.me('user-1');

    expect(me.signIn).toEqual({
      hasPassword: false,
      google: { email: 'maria@gmail.com', linkedAt: '2026-11-19T12:00:00.000Z' },
    });
  });

  it('busca la identidad de Google de esta cuenta y toma la más antigua', async () => {
    const { auth, prisma } = await setup({
      google: { email: 'x@gmail.com', createdAt: LINKED_AT },
    });

    await auth.me('user-1');

    expect(prisma.userIdentity.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', provider: 'google' },
      orderBy: { createdAt: 'asc' },
      select: { email: true, createdAt: true },
    });
  });

  it('nunca serializa el hash de la contraseña ni el sub de Google', async () => {
    const { auth } = await setup({ google: { email: 'maria@gmail.com', createdAt: LINKED_AT } });

    const me = await auth.me('user-1');
    const json = JSON.stringify(me);

    expect(json).not.toContain(HASH);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain(GOOGLE_SUB);
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('una cuenta que ya no existe responde 401 y no consulta identidades', async () => {
    const { auth, prisma } = await setup({ exists: false });

    await expect(auth.me('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.userIdentity.findFirst).not.toHaveBeenCalled();
  });

  it('el 401 de cuenta inexistente es una HttpException con su estado', async () => {
    const { auth } = await setup({ exists: false });

    const failure: unknown = await auth.me('user-1').catch((error: unknown) => error);

    if (!(failure instanceof HttpException)) {
      throw new Error('Se esperaba una HttpException.');
    }

    expect(failure.getStatus()).toBe(401);
  });
});
