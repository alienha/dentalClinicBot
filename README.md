-----

# 🤖 Automatización de Registro de Pacientes (Self-Hosted)

Este paquete deja tu proyecto listo para levantar en cualquier servidor **Linux/ARM** con Docker. Es una arquitectura robusta para **auto-alojamiento** (`self-hosting`).

  - Backend Node (Express + Playwright)
  - Servicio de **DuckDNS** en contenedor para mantener tu IP actualizada.
  - Webhook seguro para Google Forms.

-----

## 1\) Requisitos

  - **Docker + Docker Compose**
  - **Dominio DuckDNS** y **TOKEN** (ej: `ejemplo.duckdns.org`).
  - **Configuración de Router:** Puerto **3000** abierto y reenviado (Port Forwarding) a la IP local de tu servidor.

-----

## 2\) Preparación

Copia `.env.example` a `.env` y edítalo con tus valores de login y el secreto del webhook:

```bash
cp .env.example .env
# edita .env con ISI_USER/ISI_PASS y WEBHOOK_SECRET.
# NOTA: NGROK_AUTHTOKEN ya no es necesario.
```

> Si despliegas en contenedor, Express ya está configurado para escuchar en 0.0.0.0

-----

## 3\) Levantar

Este comando construye y levanta el servicio **`backend`** junto al servicio **`duckdns`**.

```bash
sudo docker compose up -d --build
```

  - Backend: `http://localhost:3000/health` -\> `{"ok":true}`
  - **URL pública (final):** `http://ejemplo.duckdns.org:3000` (Requiere Port Forwarding en el router).

-----

## 4\) Google Forms (Apps Script)

En el editor de Apps Script del Form, debes actualizar la URL del webhook a tu dominio y puerto:

```js

El script de Google Apps Script es el encargado de enviar los datos del formulario al servidor backend.

**ATENCIÓN:** Las constantes `WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, y `TELEGRAM_CHAT_ID` deben estar definidas en la parte superior de tu script en el editor de Apps Script.

Tu `WEBHOOK_URL` debe apuntar a tu dominio de DuckDNS:

const WEBHOOK_URL = 'http://ejemplo.duckdns.org:3000/crear-paciente';

function onFormSubmit(e) {
  try {
    // 1. Extraemos los datos 
    const data = extractByTitle_(e, {
      nombre: 'Nombre',
      apellidos: 'Apellidos',
      dni: 'DNI',
      email: 'Email',
      telf: 'Teléfono',
      fdn: 'Fecha de nacimiento'
    });

    data.submissionId = e.response.getId();

    // 2. Intentamos enviar los datos al servidor
    const res = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Webhook-Secret': WEBHOOK_SECRET
      },
      muteHttpExceptions: true, 
      payload: JSON.stringify(data)
    });

    // 3. Comprobamos la respuesta del servidor
    const codigoRespuesta = res.getResponseCode();
    
    // Si el servidor responde algo que no sea "202 Aceptado"
    // (Ej: 500, 401, etc.), lo tratamos como un error.
    if (codigoRespuesta != 202) {
      enviarAlertaGoogle(
        `*¡ERROR DE API (Código ${codigoRespuesta})!* 🚨\n\n` +
        `El servidor de Docker respondió, pero con un error.\n` +
        `Datos NO encolados.\n\n` +
        `Respuesta: ${res.getContentText()}`
      );
    }

  } catch (err) {
    // 4. ¡EL FALLO CRÍTICO!
    // Si entramos aquí, es porque el servidor está APAGADO o la URL es incorrecta.
    enviarAlertaGoogle(
      `*¡ERROR CRÍTICO! El servidor NO responde.* 🚨\n\n` +
      `Google Forms NO pudo conectarse a la API. El servidor está caído.\n\n` +
      `Error: ${err.message}`
    );
  }
}

function extractByTitle_(e, map) {
  const out = {};
  const responses = e.response.getItemResponses();
  
  // Usamos Object.values() para buscar en el mapa de forma más genérica
  const formTitles = Object.values(map); 

  for (const r of responses) {
    const title = r.getItem().getTitle().trim();
    const ans = r.getResponse();

    // Buscamos el título en el mapa
    for (const key in map) {
      if (map[key] === title) {
        out[key] = ans;
        break; // Salimos del bucle interior
      }
    }
  }
  return out;
}


// --- FUNCIÓN DE ALERTA DE TELEGRAM ---
function enviarAlertaGoogle(mensaje) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Tokens de Telegram no configurados en Google Apps Script");
    return;
  }
  
  const urlTelegram = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  
  UrlFetchApp.fetch(urlTelegram, {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify({
      'chat_id': TELEGRAM_CHAT_ID,
      'text': mensaje,
      'parse_mode': 'Markdown'
    })
  });
}
```

**Activador**: `onFormSubmit` → Origen: *De un formulario* → Tipo: *Al enviar el formulario*.

-----

## 5\) Endpoints

  - `GET /health` -\> salud
  - `POST /rellenar-isiclinic` -\> crea paciente (sin secreto; para pruebas locales)
  - `POST /crear-paciente` -\> webhook protegido (requiere header `X-Webhook-Secret`)

-----

## 6\) Notas

  - **Puerto y Protocolo:** La URL pública usa **`http`** y requiere el puerto `:3000` explícitamente, ya que no se está utilizando un túnel seguro con HTTPS.
  - **Mantenimiento:** El contenedor de `duckdns` se encarga de que tu IP pública se mantenga siempre sincronizada con el dominio `ejemplo.duckdns.org`.
  - **`docker-compose.yml`:** El `TOKEN` de DuckDNS debe estar pegado directamente en el archivo `docker-compose.yml` (en la sección `duckdns` como variable de entorno).

# dental-clinic-bot
