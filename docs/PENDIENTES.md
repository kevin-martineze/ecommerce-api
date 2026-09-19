# Pendientes de Globerce

Lo que falta para que esto sea un producto vivo, en los dos repos
(`ecommerce-api` y `shopping-sas`). Se marca `[x]` al terminar, con la fecha
entre paréntesis, y se deja la línea: saber cuándo se cerró algo vale más que
una lista corta.

Lo que ya está hecho y por qué se hizo así vive en `ARCHITECTURE.md`; esto es
solo lo que falta. Si un punto se cierra con una decisión en vez de con código,
se anota la decisión.

Estado al 2026-09-19: la API corre en EC2 con HTTPS y las fotos en R2; el
frontend no está desplegado en ninguna parte y no hay dominio comprado.

---

## 1. Bloqueantes: sin esto no hay producto

- [ ] **Copias de seguridad de la base.** Hoy la base vive en un volumen de la
      instancia y nada la respalda. Es lo único irreversible de toda la lista.
- [ ] **Dominio comprado** (`globerce.store` para las tiendas, `globerce.cloud`
      para la API). Sin él no hay subdominios: ver § 4.
- [ ] **Frontend desplegado.** Hasta que no lo esté, Globerce no existe para
      nadie.
- [ ] **Correo de verdad.** El servidor tiene `MAIL_DRIVER=log`: recuperar la
      contraseña e invitar a alguien al equipo escriben en un log y nadie
      recibe nada. Necesita un SMTP y, en el servidor, `FRONTEND_URL`
      apuntando al frontend y no a la propia API.
- [ ] **Cron de vencimientos.** Sin `platform:reconcile` diario, una prueba que
      termina o un mes que vence se quedan como si estuvieran al día.
- [ ] **Pasarela de pagos.** Hoy los pagos los registra la plataforma a mano
      (`BILLING_DRIVER=manual`) o los simula la tienda. Es lo que convierte
      esto en negocio.

## 2. Backend

- [ ] **Slugs reservados.** La API deja registrar `www`, `api` o `admin` como
      tienda; el frontend nunca los resuelve como subdominio, así que esa
      tienda nacería inalcanzable.
- [ ] **Dominios propios.** `stores.custom_domain` existe y el plan Pro lo
      promete, pero nada lo resuelve. Hace falta `GET /public/by-domain/:host`
      y un certificado por dominio.
- [ ] **El access token sobrevive a su sesión.** Cambiar la contraseña cierra
      los refresh tokens, pero un access token ya emitido vale hasta 15
      minutos más. Cerrarlo antes cuesta una consulta por petición.
- [ ] **Red privada para la API.** El límite por IP confía en el
      `X-Forwarded-For` del frontend. Hoy la protege el secreto compartido;
      con IP pública conviene además que no sea alcanzable de frente.

## 3. Frontend

- [ ] **README obsoleto.** Explica cómo montar Supabase, que se abandonó hace
      tiempo, y la carpeta `supabase/` sigue en el repo como peso muerto.
- [ ] **Favicon e imagen social.** No hay ni carpeta `static/`: la pestaña sale
      en blanco y un enlace compartido por WhatsApp no muestra nada.
- [ ] **Páginas legales y contacto.** El sitio comercial es una sola página.
      Términos y privacidad no son decoración si se van a cobrar
      suscripciones.
- [ ] **Tienda de demostración** a la que apuntar desde la página de precios.
- [ ] **Cambiar de tienda.** El panel ya sabe si la cuenta tiene varias, pero
      no hay selector: hoy se cambia navegando al otro subdominio.
- [ ] **Pruebas de navegador.** 73 unitarias y nada que recorra comprar →
      pedido → panel. Se ha verificado a mano en cada cambio, que no es lo
      mismo.

## 4. Subdominios: lo que falta decidir

- [ ] **DNS y certificado comodín.** `*.globerce.store` apuntando al frontend.
      La decisión pendiente está en `DEPLOY.md` § 2: Vercel pide manejar los
      nameservers para emitir el comodín, y eso choca con tener el dominio en
      Cloudflare para las fotos.
- [ ] **Alcance de la cookie de sesión.** Hoy es host-only: una sesión abierta
      en `globerce.store` no viaja a `boutique.globerce.store`, así que el
      panel solo funciona en el host donde se entró. O el panel vive siempre
      en el dominio raíz, o la cookie se emite para `.globerce.store`.

## 5. Operación

- [ ] **CI.** Ninguno de los dos repos tiene workflows: los gates se corren a
      mano.
- [ ] **Alertas.** Nadie avisa si la API se cae; el `/health` existe pero no lo
      mira nadie.

---

## Lo que necesito de ti

Estos no los puedo cerrar yo solo:

- **Dominio:** comprarlo (o decidir dónde) para poder configurar DNS y
  certificados.
- **SMTP:** una cuenta de envío (Resend, SES, el que sea) y su clave.
- **Pasarela:** con qué se va a cobrar en Colombia (Wompi, Mercado Pago…) y la
  cuenta de comercio.
- **Datos de la empresa:** razón social, NIT y un correo de contacto, para las
  páginas legales.
