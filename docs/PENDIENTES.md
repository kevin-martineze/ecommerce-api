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

- [~] **Copias de seguridad de la base.** (2026-09-19) Hecho a medias:
  `scripts/backup-db.sh` corre a diario en el servidor, comprueba que el
  volcado esté entero y conserva las últimas 7 copias **locales**. Falta lo
  de afuera: el token de R2 de las fotos no puede crear otro bucket
  (`Access Denied`), así que necesito un bucket privado de respaldos y un
  token con permiso. Hasta entonces, perder la instancia sigue siendo
  perder los datos.
- [ ] **Dominio comprado** (`globerce.store` para las tiendas, `globerce.cloud`
      para la API). Sin él no hay subdominios: ver § 4.
- [ ] **Frontend desplegado.** Hasta que no lo esté, Globerce no existe para
      nadie.
- [ ] **Correo de verdad.** El servidor tiene `MAIL_DRIVER=log`: recuperar la
      contraseña e invitar a alguien al equipo escriben en un log y nadie
      recibe nada. Necesita un SMTP y, en el servidor, `FRONTEND_URL`
      apuntando al frontend y no a la propia API.
- [x] **Cron de vencimientos.** (2026-09-19) En `/etc/cron.d/globerce`, 08:40
      UTC. De paso salió un error que nadie había visto: las dos tareas
      importaban `dotenv`, que es dependencia de desarrollo y no está en la
      imagen, así que el comando documentado para el cron nunca habría
      funcionado.
- [~] **Pasarela de pagos.** (2026-09-19) Construida entera, contra Wompi y
  con una pasarela simulada para probar sin cuenta: la tienda paga su plan
  (`/subscription/checkout` + evento firmado) y cada tienda cobra sus
  pedidos con su propia cuenta (`/payments/events/:storeId`). Falta lo que
  no puedo hacer yo: abrir la cuenta de comercio de Globerce, poner las
  cuatro llaves en el servidor y cambiar `PAYMENTS_DRIVER` a `wompi`.

## 2. El asistente de la tienda

Lo que ya está (2026-09-19): `POST /public/:storeSlug/assistant`, con
herramientas sobre el catálogo y los envíos de esa tienda, tope mensual por
plan (`plans.ai_replies_per_month`), consumo en `ai_replies` —tokens y fecha,
nunca la conversación— y el chat en la vitrina con salida a WhatsApp. Sale
apagado: `AI_DRIVER=none`.

- [ ] **Encenderlo.** Falta la clave (`ANTHROPIC_API_KEY`) y medir el costo
      real por conversación con `ai_replies`, que es para lo que se guarda.
      Recomendado: `claude-haiku-4-5`; acá el modelo no tiene que saber de la
      tienda, sino leer lo que devuelven las consultas.
- [ ] **El consumo, en el panel.** La dueña no tiene dónde ver cuántas
      respuestas lleva el mes. Los datos ya están.
- [ ] **Apagarlo por tienda.** Hoy lo decide el plan; una dueña que no lo
      quiera no tiene interruptor.
- [ ] **Más herramientas, con cuidado.** Estado de un pedido es lo que más se
      pregunta, y es justo lo que toca datos de una clienta: pide pensar qué
      se le puede contar a quien escribe sin poder probar quién es.
- [ ] **Redacción asistida de fichas en el panel.** La otra mitad de la idea:
      ataca el catálogo vacío, cuesta por prenda y no por conversación, y la
      dueña revisa antes de publicar.

## 3. Pagos: lo que falta

- [ ] **Cobro recurrente.** Hoy la dueña paga su mes a mano cada vez. Wompi lo
      permite guardando la tarjeta (`payment_source`) y cobrando desde el
      servidor; hace falta decidir cuándo se cobra y qué pasa si falla.
- [ ] **Recibos.** Ni la tienda ni la clienta reciben un correo cuando el pago
      entra. Depende del SMTP, que también falta.
- [ ] **Conciliación.** Si un evento se pierde, nadie lo nota. Con la API de
      Wompi se puede consultar una transacción y cerrar el hueco; el cron
      diario es el sitio.
- [ ] **Devoluciones.** No hay forma de devolver un pago desde el panel.

## 4. Backend

- [x] **Slugs reservados.** (2026-09-19) La lista vive en los dos repos y cada
      archivo nombra al otro.
- [ ] **Dominios propios.** `stores.custom_domain` existe y el plan Pro lo
      promete, pero nada lo resuelve. Hace falta `GET /public/by-domain/:host`
      y un certificado por dominio.
- [ ] **El access token sobrevive a su sesión.** Cambiar la contraseña cierra
      los refresh tokens, pero un access token ya emitido vale hasta 15
      minutos más. Cerrarlo antes cuesta una consulta por petición.
- [ ] **Red privada para la API.** El límite por IP confía en el
      `X-Forwarded-For` del frontend. Hoy la protege el secreto compartido;
      con IP pública conviene además que no sea alcanzable de frente.

## 5. Frontend

- [x] **README obsoleto.** (2026-09-19) Reescrito, y `supabase/` borrado: queda
      en la historia de git, que es donde tiene que estar.
- [x] **Favicon e imagen social.** (2026-09-19) La marca es un trazo, sin
      depender de ninguna fuente, y la tarjeta social se dibuja con el mismo
      texto del sitio.
- [~] **Páginas legales y contacto.** (2026-09-19) Términos, privacidad y
  contacto escritos y enlazados desde el pie. Los datos de la empresa
  —razón social, NIT, correo— están en `$lib/config/empresa.ts` en `null`:
  lo que falta no se pinta, porque un NIT inventado es peor que ninguno.
  Falta llenarlos y que un abogado los lea.
- [x] **Tienda de demostración.** (2026-09-19) El botón del hero apunta a
      `PUBLIC_DEMO_STORE_SLUG`; sin esa variable no se ofrece, porque un enlace
      a una demo que no existe es peor que no tener demo. Falta elegir cuál
      cuando haya despliegue.
- [x] **Cambiar de tienda.** (2026-09-19) Selector en la barra del panel, con
      POST: cambiar de tienda cambia el estado de la sesión, no es navegar.
- [~] **Pruebas de navegador.** (2026-09-19) Cinco con Playwright, en
  `shopping-sas/e2e`: la prenda que llega al carrito y sobrevive al
  recargue, el registro completo con su onboarding, la validación campo por
  campo sin llamar al servidor y el ojo de la contraseña. Corren en local
  (`pnpm test:browser`) contra el sitio y la API de verdad. Falta meterlas
  en CI, que necesita la API y su Postgres al lado, y una forma de borrar
  las tiendas que crean: hoy se limpian a mano con psql porque la API no
  tiene endpoint para cerrar una tienda.

## 6. Subdominios: lo que falta decidir

- [ ] **DNS y certificado comodín.** `*.globerce.store` apuntando al frontend.
      La decisión pendiente está en `DEPLOY.md` § 2: Vercel pide manejar los
      nameservers para emitir el comodín, y eso choca con tener el dominio en
      Cloudflare para las fotos.
- [x] **Alcance de la cookie de sesión.** (2026-09-19) Decidido: se emite para
      todo el dominio raíz. Solo se comparte entre subdominios nuestros, que
      sirven nuestro propio código, y sigue cifrada y `httpOnly`. En desarrollo
      no cambia nada: `localhost:5173` no es un dominio válido para una
      cookie.

## 7. Operación

- [x] **CI.** (2026-09-19) Workflows en los dos repos, con los mismos gates
      que se corren en local. Los de la API levantan Postgres y el rol
      restringido: RLS no se puede probar con dobles. Se activan en el próximo
      push.
- [ ] **Alertas.** Nadie avisa si la API se cae; el `/health` existe pero no lo
      mira nadie.
- [ ] **Acceso al servidor sin puerto 22.** Hoy el SSH está abierto solo para
      una IP fija, y la de casa es dinámica: cada vez que el router se
      reconecta hay que editar el Security Group a mano, y el síntoma es un
      `ssh` que se cuelga sin error. Con SSM Session Manager se entra por la
      API de AWS, sin puerto 22 abierto y sin depender de la IP. (2026-09-20)

---

## Lo que necesito de ti

Estos no los puedo cerrar yo solo:

- **Dominio:** ~~comprarlo~~ hecho (`globerce.store` para las tiendas,
  `globerce.cloud` para la API). Falta un registro en Hostinger: `CNAME *` →
  `cname.vercel-dns.com`, sin el cual ninguna tienda resuelve en su subdominio.
- **SMTP:** una cuenta de envío (Resend, SES, el que sea) y su clave.
- **Pasarela:** la cuenta de comercio de Globerce en Wompi y sus cuatro llaves
  (`WOMPI_*`), más `PAYMENTS_SECRET` y `PUBLIC_API_URL` en el servidor. Cada
  tienda abre la suya y la conecta desde su panel.
- **Clave del asistente:** una de console.anthropic.com en
  `ecommerce-api/.env` (`ANTHROPIC_API_KEY`). Sin ella el chat no se ofrece.
- **Datos de la empresa:** razón social, NIT y un correo de contacto, para las
  páginas legales.
