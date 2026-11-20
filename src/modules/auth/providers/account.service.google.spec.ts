import { ForbiddenException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Mailer } from '@shared/mail/mailer';
import { PrismaService } from '@db/prisma.service';
import { NotificationsService } from '@modules/notifications/providers/notifications.service';

import { AccountService } from './account.service';
import { AuthService } from './auth.service';
import { GoogleAuthService, GoogleProfile } from './google-auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Aceptar una invitación entrando con Google, sin base: Prisma, Google, los
 * tokens y el correo son dobles. Lo que toca la base de verdad (la transacción
 * y RLS) lo prueba `auth-google-invitations.e2e-spec.ts`.
 */

const SECRET = 'un-secreto-de-pruebas-de-al-menos-32-caracteres';

const STORE_ID = '6f1c2b1e-8d4a-4c3e-9f2a-1b2c3d4e5f60';
const INVITED = 'invitada@gmail.com';

const store = { id: STORE_ID, name: 'Tienda', slug: 'tienda', status: 'ACTIVE' };

const invitation = { id: 'inv-1', storeId: STORE_ID, email: INVITED, role: 'STAFF' };

const profile: GoogleProfile = {
  subject: '1098765432101234567890',
  email: INVITED,
  fullName: 'Ayudante Google',
};

const body = {
  token: `${STORE_ID}.${'s'.repeat(24)}`,
  code: 'code',
  codeVerifier: 'v'.repeat(43),
  redirectUri: 'https://x.test/cb',
};

const INVALID_INVITATION = 'La invitación no es válida, ya se usó o venció.';

interface Existing {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

interface State {
  /** `null` simula una invitación que no existe, venció o ya se aceptó. */
  invitation?: typeof invitation | null;
  /** La identidad de Google que ya existe para ese `sub`, con la cuenta atada. */
  identity?: { user: { id: string; email: string } } | null;
  /** La cuenta que ya tiene ese correo. */
  existing?: Existing | null;
  /** Cuántas invitaciones reclamó el `updateMany`: 0 si otra pestaña la aceptó. */
  claimCount?: number;
  /** Lo que devuelve Google al canjear el código. */
  google?: GoogleProfile;
  /** Un rechazo de Google, para ver que llega sin tocar la base. */
  googleError?: unknown;
  storeStatus?: string;
}

async function setup(state: State = {}) {
  const tx = {
    storeInvitation: {
      findFirst: jest
        .fn()
        .mockResolvedValue(state.invitation === undefined ? invitation : state.invitation),
      updateMany: jest.fn().mockResolvedValue({ count: state.claimCount ?? 1 }),
    },
    userIdentity: {
      findUnique: jest.fn().mockResolvedValue(state.identity ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn((args: { where: { id?: string; email?: string } }) => {
        if (args.where.email !== undefined) {
          return Promise.resolve(state.existing ?? null);
        }

        // Lo que `sessionFor` lee de la cuenta, con la membresía en la tienda.
        return Promise.resolve({
          id: args.where.id,
          email: INVITED,
          fullName: 'Ayudante',
          memberships: [{ role: 'STAFF', store }],
          platformAdmin: null,
        });
      }),
      create: jest.fn().mockResolvedValue({ id: 'user-nueva' }),
      update: jest.fn().mockResolvedValue({}),
    },
    storeMember: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  // La transacción corre contra el mismo doble: lo que importa es qué se escribe.
  const prisma = {
    ...tx,
    store: {
      findUnique: jest.fn().mockResolvedValue({ ...store, status: state.storeStatus ?? 'ACTIVE' }),
    },
    setStoreContext: jest.fn().mockResolvedValue(undefined),
    withTransaction: jest.fn(<T>(work: (client: typeof tx) => Promise<T>) => work(tx)),
    forStore: jest.fn(<T>(_storeId: string, work: (client: typeof tx) => Promise<T>) => work(tx)),
  };

  const tokens = {
    issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };

  const mailer = { send: jest.fn().mockResolvedValue(undefined) };

  const notifications = {
    notifyStore: jest.fn().mockResolvedValue(undefined),
    notifyPlatform: jest.fn().mockResolvedValue(undefined),
  };

  const google = {
    profileFromCode: jest.fn(() =>
      state.googleError !== undefined
        ? Promise.reject(state.googleError)
        : Promise.resolve(state.google ?? profile),
    ),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      AccountService,
      { provide: PrismaService, useValue: prisma },
      { provide: TokenService, useValue: tokens },
      { provide: PasswordService, useValue: new PasswordService() },
      { provide: GoogleAuthService, useValue: google },
      { provide: JwtService, useValue: new JwtService({ secret: SECRET }) },
      { provide: Mailer, useValue: mailer },
      { provide: ConfigService, useValue: new ConfigService({ FRONTEND_URL: 'https://g.test' }) },
      { provide: NotificationsService, useValue: notifications },
    ],
  }).compile();

  return {
    account: moduleRef.get(AccountService),
    prisma,
    tokens,
    mailer,
    google,
    notifications,
  };
}

/** El rechazo con su estado y su cuerpo, para comparar la forma completa. */
async function rejection(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
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

describe('AccountService: aceptar la invitación con Google', () => {
  it('sin cuenta, crea el usuario sin contraseña, con el correo probado, y la membresía con el rol invitado', async () => {
    const { account, prisma, tokens, mailer } = await setup();

    const result = await account.acceptInvitationWithGoogle(body);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: INVITED,
        fullName: profile.fullName,
        passwordHash: null,
        emailVerifiedAt: expect.any(Date),
        identities: {
          create: { provider: 'google', providerSubject: profile.subject, email: profile.email },
        },
      },
    });
    expect(prisma.storeMember.upsert).toHaveBeenCalledWith({
      where: { storeId_userId: { storeId: STORE_ID, userId: 'user-nueva' } },
      create: { storeId: STORE_ID, userId: 'user-nueva', role: 'STAFF' },
      update: {},
    });
    expect(prisma.storeInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: invitation.id, storeId: STORE_ID }),
        data: { acceptedAt: expect.any(Date) },
      }),
    );
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ user: { id: 'user-nueva' }, activeStoreId: STORE_ID });
    expect(tokens.issue).toHaveBeenCalledWith('user-nueva', INVITED, STORE_ID, {});
  });

  it('una cuenta nueva avisa a la plataforma una vez, con la tienda a la que entró', async () => {
    const { account, notifications } = await setup();

    await account.acceptInvitationWithGoogle(body);

    expect(notifications.notifyPlatform).toHaveBeenCalledTimes(1);
    expect(notifications.notifyPlatform).toHaveBeenCalledWith({
      type: 'USER_REGISTERED',
      data: { userId: 'user-nueva', storeId: STORE_ID, storeName: store.name },
    });
  });

  it('una cuenta que ya existía no avisa a la plataforma', async () => {
    const { account, notifications } = await setup({
      existing: { id: 'user-1', email: INVITED, emailVerifiedAt: new Date('2026-01-01') },
    });

    await account.acceptInvitationWithGoogle(body);

    expect(notifications.notifyPlatform).not.toHaveBeenCalled();
  });

  it('con cuenta que nunca probó su correo, la vincula, borra su contraseña, cierra sus sesiones y avisa', async () => {
    const { account, prisma, tokens, mailer } = await setup({
      existing: { id: 'user-1', email: INVITED, emailVerifiedAt: null },
    });

    const result = await account.acceptInvitationWithGoogle(body);

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
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: INVITED, subject: 'Se conectó Google a tu cuenta' }),
    );
    expect(mailer.send.mock.calls[0][0].text).toContain('borramos la contraseña');
    expect(prisma.storeMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'user-1' }) }),
    );
    expect(result).toMatchObject({ activeStoreId: STORE_ID });
  });

  it('con cuenta que ya probó su correo, la vincula, conserva la contraseña y avisa sin borrarla', async () => {
    const { account, prisma, tokens, mailer } = await setup({
      existing: { id: 'user-1', email: INVITED, emailVerifiedAt: new Date('2026-01-01') },
    });

    await account.acceptInvitationWithGoogle(body);

    const passwordWrites = prisma.user.update.mock.calls.filter(
      ([args]) => 'passwordHash' in args.data,
    );

    expect(passwordWrites).toHaveLength(0);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(mailer.send.mock.calls[0][0].text).not.toContain('borramos la contraseña');
  });

  it('una identidad de Google ya vinculada a esa misma cuenta entra sin vincular ni avisar', async () => {
    const { account, prisma, tokens, mailer } = await setup({
      identity: { user: { id: 'user-1', email: INVITED } },
    });

    const result = await account.acceptInvitationWithGoogle(body);

    expect(prisma.userIdentity.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(prisma.storeMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'user-1' }) }),
    );
    expect(result).toMatchObject({ activeStoreId: STORE_ID });
  });

  it('una identidad de Google atada a otra cuenta responde 409 y no escribe nada', async () => {
    const { account, prisma, tokens, mailer } = await setup({
      identity: { user: { id: 'user-9', email: 'otra-cuenta@gmail.com' } },
    });

    const rejected = await rejection(account.acceptInvitationWithGoogle(body));

    expect(rejected).toMatchObject({
      status: 409,
      body: { error: 'google_account_linked_elsewhere' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.storeInvitation.updateMany).not.toHaveBeenCalled();
    expect(prisma.storeMember.upsert).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('un correo de Google distinto al invitado responde 403 con el correo de la invitación y no escribe nada', async () => {
    const { account, prisma, tokens } = await setup({
      google: { ...profile, email: 'otra@gmail.com' },
    });

    const rejected = await rejection(account.acceptInvitationWithGoogle(body));

    expect(rejected).toEqual({
      status: 403,
      body: {
        message: `Esta invitación es para otro correo. Entra a Google con ${INVITED}.`,
        error: 'invitation_email_mismatch',
      },
    });
    expect(prisma.withTransaction).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('compara los correos normalizados: mayúsculas y espacios no cuentan como otro correo', async () => {
    const { account } = await setup({
      invitation: { ...invitation, email: ' Invitada@Gmail.com ' },
    });

    const result = await account.acceptInvitationWithGoogle(body);

    expect(result).toMatchObject({ activeStoreId: STORE_ID });
  });

  it('una invitación que no existe, venció o ya se aceptó responde 400 sin canjear el código', async () => {
    const { account, prisma, google } = await setup({ invitation: null });

    const rejected = await rejection(account.acceptInvitationWithGoogle(body));

    expect(rejected).toMatchObject({ status: 400, body: { message: INVALID_INVITATION } });
    expect(google.profileFromCode).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.storeInvitation.updateMany).not.toHaveBeenCalled();
  });

  it('el filtro de la invitación exige no aceptada, no revocada y vigente', async () => {
    const { account, prisma } = await setup({ invitation: null });

    await rejection(account.acceptInvitationWithGoogle(body));

    expect(prisma.storeInvitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: STORE_ID,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
  });

  it('una tienda suspendida responde 400 igual que una invitación inválida', async () => {
    const { account, google } = await setup({ storeStatus: 'SUSPENDED' });

    const rejected = await rejection(account.acceptInvitationWithGoogle(body));

    expect(rejected).toMatchObject({ status: 400, body: { message: INVALID_INVITATION } });
    expect(google.profileFromCode).not.toHaveBeenCalled();
  });

  it('si otra pestaña aceptó la invitación mientras se canjeaba el código, responde 400 y no cierra sesiones ni avisa', async () => {
    const { account, prisma, tokens, mailer, notifications } = await setup({
      existing: { id: 'user-1', email: INVITED, emailVerifiedAt: null },
      claimCount: 0,
    });

    const rejected = await rejection(account.acceptInvitationWithGoogle(body));

    expect(rejected).toMatchObject({ status: 400, body: { message: INVALID_INVITATION } });
    expect(prisma.storeMember.upsert).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(notifications.notifyPlatform).not.toHaveBeenCalled();
  });

  it('si Google no confirma el correo, el rechazo llega tal cual y no escribe nada', async () => {
    const { account, prisma, tokens } = await setup({
      googleError: new ForbiddenException({
        message: 'Google no confirma tu correo.',
        error: 'google_email_unverified',
      }),
    });

    const rejected = await rejection(account.acceptInvitationWithGoogle(body));

    expect(rejected).toMatchObject({ status: 403, body: { error: 'google_email_unverified' } });
    expect(prisma.withTransaction).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});
