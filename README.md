# Dental Clinic — Portable (Backend + Ngrok + Google Forms)

Este paquete deja tu proyecto listo para levantar en cualquier ordenador con Docker:
- Backend Node (Express + Playwright)
- Ngrok en contenedor con dominio fijo (ajústalo si usas otro)
- Webhook seguro para Google Forms

## 1) Requisitos
- Docker + Docker Compose
- Un authtoken de ngrok (gratis): https://dashboard.ngrok.com/get-started/your-authtoken

## 2) Preparación
Copia `.env.example` a `.env` y edítalo con tus valores:

```bash
cp .env.example .env
# edita .env con ISI_USER/ISI_PASS, WEBHOOK_SECRET y NGROK_AUTHTOKEN
```

> Si despliegas en contenedor, Express ya está configurado para escuchar en 0.0.0.0

## 3) Levantar
```bash
docker compose up -d --build
```

- Backend: http://localhost:3000/health  -> {"ok":true}
- Panel ngrok: http://localhost:4040
- URL pública (ajustada en docker-compose): https://eun-recondite-rosella.ngrok-free.dev

## 4) Google Forms (Apps Script)
En el editor de Apps Script del Form:

```js
const WEBHOOK_URL = 'https://eun-recondite-rosella.ngrok-free.dev/crear-paciente';
const WEBHOOK_SECRET = '12345'; // el mismo que en tu .env

function onFormSubmit(e) {
  try {
    const data = extractByTitle_(e, {
      nombre: 'Nombre',
      apellidos: 'Apellidos',
      // teléfono: 'Teléfono', // añade los que uses
      // email: 'Email',
    });
    data.submissionId = e?.response?.getId?.() || undefined;

    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
      muteHttpExceptions: true,
      payload: JSON.stringify(data)
    });
  } catch (err) {
    console.error(err);
  }
}

function extractByTitle_(e, map) {
  const out = {};
  const responses = e?.response?.getItemResponses?.() || [];
  for (const r of responses) {
    const title = (r.getItem().getTitle() || '').trim();
    const ans = r.getResponse();
    for (const [key, expected] of Object.entries(map)) {
      if (title === expected && ans != null && ans !== '') out[key] = ans;
    }
  }
  return out;
}
```

**Activador**: `onFormSubmit` → Origen: *De un formulario* → Tipo: *Al enviar el formulario*.

## 5) Endpoints
- `GET /health` -> salud
- `POST /rellenar-isiclinic` -> crea paciente (sin secreto; para pruebas locales)
- `POST /crear-paciente` -> webhook protegido (requiere header `X-Webhook-Secret`)

## 6) Notas
- Si cambias el dominio de ngrok, modifica `docker-compose.yml` (flag `--domain=`) y también en Apps Script (`WEBHOOK_URL`).
- Si no tienes dominio reservado, puedes quitar `--domain=...` y ngrok asignará uno aleatorio cada vez.
# dental-clinic-bot
