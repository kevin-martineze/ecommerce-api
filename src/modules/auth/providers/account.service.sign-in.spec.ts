import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Mailer } from '@shared/mail/mailer';
import { PrismaService } from '@db/prisma.service';

import { AccountService } from './account.service';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Crear la contraseña de una cuenta solo-Google y desconectar Google, sin base:
 * Prisma, las contraseñas, los tokens y el correo son dobles. Lo que toca la
 * base de verdad (la transacción, el bloqueo de la fila, el `where` real) lo
 * prueba `auth-google-account.e2e-spec.ts`.
 */

const USER_ID = '6f1c2b1e-8d4a-4c3e-9f2a-1b2c3d4e5f60';
const EMAIL = 'duena@gmail.com';
const CURRENT_SESSION = 'refresh-de-esta-sesion-con-largo-suficiente';
const NEW_PASSWORD = 'una contraseña nueva de prueba';
const NEW_HASH = 'hash-de-la-contraseña-nueva';
const FRONTEND = 'https://g.test';

interface State {
  /** La cuenta. `null` simula una que ya no existe. Por defecto: sin contraseña. */
  user?: { email: string; passwordHash: string | null } | null;
  /** Cuántas identidades de Google tiene la cuenta. */
  googleLinks?: number;
  /** Lo que devuelve el `updateMany` de `setPassword`: 0 si otra pestaña la fijó antes. */
  claimCount?: number;
  /** Un fallo del correo, que no debe cambiar la respuesta. */
  mailError?: Error;
}

function setup(state: State = {}) {
  const user = state.user === undefined ? { email: EMAIL, passwordHash: null } : state.user;

  // Lo que ve la transacción de `unlinkGoogle`. El `$queryRaw` es el bloqueo.
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    userIdentity: {
      count: jest.fn().mockResolvedValue(state.googleLinks ?? 0),
      deleteMany: jest.fn().mockResolvedValue({ count: state.googleLinks ?? 0 }),
    },
  };

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      updateMany: jest.fn().mockResolvedValue({ count: state.claimCount ?? 1 }),
    },
    withTransaction: jest.fn(<T>(work: (client: typeof tx) => Promise<T>) => work(tx)),
  };

  const passwords = { hash: jest.fn().mockResolvedValue(NEW_HASH) };
  const tokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const mailer = {
    send: jest.fn(() =>
      state.mailError ? Promise.reject(state.mailError) : Promise.resolve(undefined),
    ),
  };

  return {
    tx,
    prisma,
    passwords,
    tokens,
    mailer,
    build: async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AccountService,
          { provide: PrismaService, useValue: prisma },
          { provide: PasswordService, useValue: passwords },
          { provide: TokenService, useValue: tokens },
          { provide: AuthService, useValue: {} },
          { provide: GoogleAuthService, useValue: {} },
          { provide: Mailer, useValue: mailer },
          { provide: ConfigService, useValue: new ConfigService({ FRONTEND_URL: FRONTEND }) },
        ],
      }).compile();

      return moduleRef.get(AccountService);
    },
  };
}

/** Lo que el cliente ve de un rechazo: el estado HTTP y el cuerpo con su código. */
async function rejectionOf(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }

    throw error;
  }

  throw new Error('Se esperaba un rechazo.');
}

describe('AccountService.setPassword', () => {
  it('sin contraseña: fija el hash, cierra las demás sesiones y avisa por correo', async () => {
    const env = setup();
    const account = await env.build();

    await account.setPassword(USER_ID, {
      newPassword: NEW_PASSWORD,
      refreshToken: CURRENT_SESSION,
    });

    expect(env.passwords.hash).toHaveBeenCalledWith(NEW_PASSWORD);
    expect(env.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, passwordHash: null },
      data: { passwordHash: NEW_HASH },
    });
    expect(env.mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: EMAIL,
        subject: 'Se creó una contraseña para tu cuenta',
        text: expect.stringContaining(`${FRONTEND}/admin/forgot-password`),
      }),
    );
  });

  it('conserva la sesión que lo hace: revoca las demás con el refresh token actual', async () => {
    const env = setup();
    const account = await env.build();

    await account.setPassword(USER_ID, {
      newPassword: NEW_PASSWORD,
      refreshToken: CURRENT_SESSION,
    });

    expect(env.tokens.revokeAllForUser).toHaveBeenCalledTimes(1);
    expect(env.tokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, CURRENT_SESSION);
  });

  it('con contraseña ya fijada: 409 password_already_set, sin tocar nada', async () => {
    const env = setup({ user: { email: EMAIL, passwordHash: 'hash-viejo' } });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.setPassword(USER_ID, { newPassword: NEW_PASSWORD, refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toEqual({
      status: 409,
      body: {
        message: 'Tu cuenta ya tiene contraseña. Para cambiarla, usa cambiar contraseña.',
        error: 'password_already_set',
      },
    });
    expect(env.passwords.hash).not.toHaveBeenCalled();
    expect(env.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(env.tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(env.mailer.send).not.toHaveBeenCalled();
  });

  it('carrera: otra pestaña la fijó entre la lectura y el UPDATE → 409, sin sesiones cerradas ni correo', async () => {
    const env = setup({ claimCount: 0 });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.setPassword(USER_ID, { newPassword: NEW_PASSWORD, refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toMatchObject({ status: 409, body: { error: 'password_already_set' } });
    expect(env.tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(env.mailer.send).not.toHaveBeenCalled();
  });

  it('cuenta que ya no existe: 401, sin hashear', async () => {
    const env = setup({ user: null });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.setPassword(USER_ID, { newPassword: NEW_PASSWORD, refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toMatchObject({ status: 401 });
    expect(env.passwords.hash).not.toHaveBeenCalled();
  });

  it('si el correo falla, la respuesta sigue siendo éxito y la sesión queda cerrada igual', async () => {
    const env = setup({ mailError: new Error('SMTP caído') });
    const account = await env.build();

    await expect(
      account.setPassword(USER_ID, { newPassword: NEW_PASSWORD, refreshToken: CURRENT_SESSION }),
    ).resolves.toBeUndefined();
    expect(env.tokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, CURRENT_SESSION);
  });
});

describe('AccountService.unlinkGoogle', () => {
  it('con contraseña y Google: borra el vínculo, cierra las demás sesiones y avisa', async () => {
    const env = setup({ user: { email: EMAIL, passwordHash: 'hash' }, googleLinks: 1 });
    const account = await env.build();

    await account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION });

    expect(env.tx.userIdentity.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, provider: 'google' },
    });
    expect(env.tokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, CURRENT_SESSION);
    expect(env.mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: EMAIL,
        subject: 'Se desconectó Google de tu cuenta',
      }),
    );
  });

  it('la comprobación y el borrado van en una transacción, con la cuenta bloqueada antes de leerla', async () => {
    const env = setup({ user: { email: EMAIL, passwordHash: 'hash' }, googleLinks: 1 });
    const account = await env.build();

    await account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION });

    expect(env.prisma.withTransaction).toHaveBeenCalledTimes(1);

    // NaN si nunca se llamó: la comparación falla en vez de pasar en silencio.
    const firstCall = (calls: number[]): number => calls[0] ?? Number.NaN;
    const lock = firstCall(env.tx.$queryRaw.mock.invocationCallOrder);
    const read = firstCall(env.tx.user.findUnique.mock.invocationCallOrder);
    const remove = firstCall(env.tx.userIdentity.deleteMany.mock.invocationCallOrder);

    expect(lock).toBeLessThan(read);
    expect(read).toBeLessThan(remove);
  });

  it('sin contraseña: 409 password_required, y no borra ni cierra nada', async () => {
    const env = setup({ user: { email: EMAIL, passwordHash: null }, googleLinks: 1 });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toEqual({
      status: 409,
      body: {
        message: 'Crea una contraseña antes de desconectar Google: si no, no podrías entrar.',
        error: 'password_required',
      },
    });
    expect(env.tx.userIdentity.deleteMany).not.toHaveBeenCalled();
    expect(env.tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(env.mailer.send).not.toHaveBeenCalled();
  });

  it('sin Google vinculado: 404 google_not_linked, y no borra nada', async () => {
    const env = setup({ user: { email: EMAIL, passwordHash: 'hash' }, googleLinks: 0 });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toEqual({
      status: 404,
      body: { message: 'Esta cuenta no tiene Google conectado.', error: 'google_not_linked' },
    });
    expect(env.tx.userIdentity.deleteMany).not.toHaveBeenCalled();
    expect(env.tokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('sin Google y sin contraseña: 404, porque lo primero es que haya algo que desconectar', async () => {
    const env = setup({ user: { email: EMAIL, passwordHash: null }, googleLinks: 0 });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toMatchObject({ status: 404, body: { error: 'google_not_linked' } });
  });

  it('cuenta que ya no existe: 401, y no borra nada', async () => {
    const env = setup({ user: null, googleLinks: 1 });
    const account = await env.build();

    const rejection = await rejectionOf(
      account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION }),
    );

    expect(rejection).toMatchObject({ status: 401 });
    expect(env.tx.userIdentity.deleteMany).not.toHaveBeenCalled();
  });

  it('si el correo falla, la respuesta sigue siendo éxito y el vínculo ya quedó borrado', async () => {
    const env = setup({
      user: { email: EMAIL, passwordHash: 'hash' },
      googleLinks: 1,
      mailError: new Error('SMTP caído'),
    });
    const account = await env.build();

    await expect(
      account.unlinkGoogle(USER_ID, { refreshToken: CURRENT_SESSION }),
    ).resolves.toBeUndefined();
    expect(env.tx.userIdentity.deleteMany).toHaveBeenCalledTimes(1);
  });
});
