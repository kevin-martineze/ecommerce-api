import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Mailer } from '@shared/mail/mailer';
import { PrismaService } from '@db/prisma.service';

import { AuthService } from './auth.service';
import { GoogleAuthService, GoogleProfile } from './google-auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Los caminos de `signInWithGoogle` y el `signupToken`, sin base: Prisma, los
 * tokens, Google y el correo son dobles. Lo que toca la base de verdad (crear
 * la tienda, la transacción) lo prueba `auth-google.e2e-spec.ts`.
 */

const SECRET = 'un-secreto-de-pruebas-de-al-menos-32-caracteres';

const profile: GoogleProfile = {
  subject: '1098765432101234567890',
  email: 'duena@gmail.com',
  fullName: 'María Restrepo',
};

const signIn = { code: 'code', codeVerifier: 'v'.repeat(43), redirectUri: 'https://x.test/cb' };

const store = { id: 'store-1', name: 'Tienda', slug: 'tienda' };

const userWithStores = {
  id: 'user-1',
  email: profile.email,
  fullName: 'María',
  memberships: [{ role: 'OWNER', store }],
  platformAdmin: null,
};

interface Existing {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

async function setup(state: { identityUserId?: string; existing?: Existing } = {}) {
  const tx = {
    userIdentity: {
      findUnique: jest
        .fn()
        .mockResolvedValue(state.identityUserId ? { userId: state.identityUserId } : null),
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn((args: { where: { email?: string; id?: string } }) =>
        Promise.resolve(args.where.email !== undefined ? (state.existing ?? null) : userWithStores),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  // La transacción corre contra el mismo doble: lo que importa es qué se escribe.
  const prisma = {
    ...tx,
    withTransaction: jest.fn(<T>(work: (client: typeof tx) => Promise<T>) => work(tx)),
  };
  const tokens = {
    issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const mailer = { send: jest.fn().mockResolvedValue(undefined) };
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });

  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: TokenService, useValue: tokens },
      { provide: PasswordService, useValue: new PasswordService() },
      { provide: GoogleAuthService, useValue: { profileFromCode: () => Promise.resolve(profile) } },
      { provide: JwtService, useValue: jwt },
      { provide: Mailer, useValue: mailer },
      { provide: ConfigService, useValue: new ConfigService({ FRONTEND_URL: 'https://g.test' }) },
    ],
  }).compile();

  return { auth: moduleRef.get(AuthService), prisma, tokens, mailer, jwt };
}

async function errorCode(promise: Promise<unknown>): Promise<{ status: number; error: unknown }> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof HttpException) {
      const body = error.getResponse();

      return {
        status: error.getStatus(),
        error: typeof body === 'object' && body !== null && 'error' in body ? body.error : null,
      };
    }

    throw error;
  }

  throw new Error('Se esperaba un rechazo.');
}

const storeData = { storeName: 'Tienda', storeSlug: 'tienda-nueva', whatsappPhone: '573001234567' };

describe('AuthService con Google', () => {
  it('una cuenta de Google ya vinculada entra en su primera tienda, sin tocar nada', async () => {
    const { auth, prisma, tokens, mailer } = await setup({ identityUserId: 'user-1' });

    const result = await auth.signInWithGoogle(signIn);

    expect(result).toMatchObject({ status: 'session', session: { activeStoreId: store.id } });
    expect(tokens.issue).toHaveBeenCalledWith('user-1', profile.email, store.id, {});
    expect(prisma.userIdentity.create).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('una cuenta con ese correo que nunca lo probó se vincula y pierde la contraseña', async () => {
    const { auth, prisma, tokens, mailer } = await setup({
      existing: { id: 'user-1', email: profile.email, emailVerifiedAt: null },
    });

    const result = await auth.signInWithGoogle(signIn);

    expect(result.status).toBe('session');
    expect(prisma.userIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        provider: 'google',
        providerSubject: profile.subject,
        email: profile.email,
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerifiedAt: expect.any(Date), passwordHash: null },
    });
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: profile.email, subject: 'Se conectó Google a tu cuenta' }),
    );
    expect(mailer.send.mock.calls[0][0].text).toContain('borramos la contraseña');
  });

  it('una cuenta con el correo ya probado se vincula y conserva la contraseña', async () => {
    const { auth, prisma, tokens, mailer } = await setup({
      existing: { id: 'user-1', email: profile.email, emailVerifiedAt: new Date('2026-01-01') },
    });

    await auth.signInWithGoogle(signIn);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(mailer.send.mock.calls[0][0].text).not.toContain('borramos la contraseña');
  });

  it('sin cuenta, devuelve un signupToken de 15 minutos con lo que dio Google', async () => {
    const { auth, tokens, jwt } = await setup();

    const result = await auth.signInWithGoogle(signIn);

    if (result.status !== 'signup_required') {
      throw new Error('Se esperaba signup_required.');
    }

    expect(result).toMatchObject({ email: profile.email, fullName: profile.fullName });
    expect(tokens.issue).not.toHaveBeenCalled();

    const claims = await jwt.verifyAsync<Record<string, unknown>>(result.signupToken, {
      audience: 'google-signup',
    });

    expect(claims).toMatchObject({ sub: profile.subject, email: profile.email });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(15 * 60);
  });

  it('un signupToken vencido es signup_token_invalid', async () => {
    const { auth, jwt } = await setup();
    const expired = await jwt.signAsync(
      { sub: profile.subject, email: profile.email, fullName: null },
      { audience: 'google-signup', expiresIn: -60 },
    );

    await expect(
      errorCode(auth.registerWithGoogle({ ...storeData, signupToken: expired })),
    ).resolves.toEqual({ status: 401, error: 'signup_token_invalid' });
  });

  it('un access token no sirve de signupToken', async () => {
    const { auth, jwt } = await setup();
    const accessToken = await jwt.signAsync({ sub: 'user-1', email: profile.email, storeId: null });

    await expect(
      errorCode(auth.registerWithGoogle({ ...storeData, signupToken: accessToken })),
    ).resolves.toEqual({ status: 401, error: 'signup_token_invalid' });
  });

  it('un signupToken firmado con otro secreto es signup_token_invalid', async () => {
    const { auth } = await setup();
    const forged = await new JwtService({ secret: 'otro'.repeat(10) }).signAsync(
      { sub: profile.subject, email: profile.email, fullName: null },
      { audience: 'google-signup', expiresIn: '15m' },
    );

    await expect(
      errorCode(auth.registerWithGoogle({ ...storeData, signupToken: forged })),
    ).resolves.toEqual({ status: 401, error: 'signup_token_invalid' });
  });
});
