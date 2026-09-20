-- ============================================================================
-- Cuentas y equipo: recuperar contraseña e invitar personal.
--
-- `password_reset_tokens` va SIN RLS, igual que `refresh_tokens`: pertenece a
-- una cuenta y se busca antes de saber de qué tienda se habla.
--
-- `store_invitations` va CON RLS: pertenece a una tienda. El enlace lleva el
-- `store_id` delante del secreto para poder fijar el contexto antes de
-- buscarla (ver StoreInvitation en schema.prisma).
--
-- Los permisos de `tienda_app` los heredan por el `alter default privileges`
-- de 20260906215000.
-- ============================================================================

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_invitations" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'STAFF',
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_invitations_pkey" PRIMARY KEY ("id"),
    -- El correo se guarda normalizado: compararlo con el de la cuenta que acepta
    -- no puede depender de cómo lo escribió quien invitó.
    CONSTRAINT "store_invitations_email_lower" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "store_invitations_token_hash_key" ON "store_invitations"("token_hash");
CREATE INDEX "store_invitations_store_id_email_idx" ON "store_invitations"("store_id", "email");

ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_invitations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "store_invitations_tenant_isolation" ON "store_invitations" FOR ALL TO public
    USING (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = nullif(current_setting('app.store_id', true), '')::uuid);
