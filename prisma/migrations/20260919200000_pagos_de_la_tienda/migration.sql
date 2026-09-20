-- ============================================================================
-- Que cada tienda cobre sus pedidos en su propia cuenta.
--
-- La plata de una venta es de la tienda, no de Globerce: cada dueña conecta su
-- cuenta de comercio y el cobro sale con SUS llaves. Así no somos agregador
-- —no manejamos dinero ajeno— y no hace falta figura ni licencia para eso.
--
-- Las llaves secretas se guardan cifradas (ver shared/payments/secret-box.ts).
-- Son secretos ajenos: quien los tenga puede mover la plata de esa tienda, y
-- un volcado robado no puede ser también el robo de todas las cuentas.
-- La pública no: es pública, viaja en cada enlace de pago.
--
-- El pedido gana estado de pago propio. No se mezcla con `status`, que dice
-- cómo va el pedido (confirmado, enviado): una venta contra entrega está
-- confirmada y sin pagar, y una pagada puede terminar cancelada.
-- ============================================================================

create type order_payment_status as enum ('UNPAID', 'PENDING', 'PAID', 'FAILED');

alter table orders
	add column payment_status order_payment_status not null default 'UNPAID',
	add column payment_reference text,
	add column paid_at timestamptz;

-- Una transacción no se aplica dos veces, aunque la pasarela reintente.
create unique index orders_payment_reference_key on orders (payment_reference)
	where payment_reference is not null;

create table store_payment_accounts (
	store_id uuid primary key references stores (id) on delete cascade,
	provider text not null default 'wompi',
	public_key text not null,
	private_key_sealed text not null,
	integrity_secret_sealed text not null,
	events_secret_sealed text not null,
	active boolean not null default true,
	updated_at timestamptz not null default now()
);

alter table store_payment_accounts enable row level security;
alter table store_payment_accounts force row level security;

create policy store_payment_accounts_tenant_isolation on store_payment_accounts for all to tienda_app
	using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
	with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);

grant select, insert, update, delete on store_payment_accounts to tienda_app;
