// --- 1. IMPORTACIONES ---
// Carga variables de entorno (desde .env) al inicio
import "dotenv/config"; 
import express from "express";
import pino from "pino";
import { Queue, Worker } from "bullmq"; // Para el sistema de colas
import { default as IORedis } from "ioredis"; // Cliente de Redis
import { rellenarFormularioIsi, testLogin } from "./isiclinic.js"; // Lógica de negocio (Playwright)

// --- 2. CONFIGURACIÓN INICIAL ---
// Configura el logger (pino) para registrar eventos
const log = pino({ level: process.env.LOG_LEVEL || "info" });

// Crea la aplicación de servidor web (API)
const app = express();
// Middleware para entender peticiones con cuerpo JSON
app.use(express.json());
// Middleware para entender peticiones de formularios web
app.use(express.urlencoded({ extended: true }));


// --- 3. CONEXIÓN A REDIS Y CONFIGURACIÓN DE BULLMQ ---

// Configura la conexión a Redis. BullMQ la necesita para almacenar los trabajos.
const connection = new IORedis({ 
  host: process.env.REDIS_HOST || "redis", // "redis" es el nombre del servicio en docker-compose
  port: 6379,
  maxRetriesPerRequest: null // Requerido por BullMQ para resiliencia
});

// Oyentes de eventos para monitorear la salud de la conexión a Redis
connection.on('connect', () => log.info('Conectado a Redis'));
connection.on('error', (err) => log.error(err, 'Error de conexión con Redis'));

// 3a. El Productor (La Cola)
// Define la cola. La usaremos para AÑADIR trabajos desde nuestros endpoints.
const pacienteQueue = new Queue('pacientes-queue', { connection });

// 3b. El Consumidor (El Worker)
// Define el worker. Se conectará a Redis y PROCESARÁ trabajos de la cola.
const worker = new Worker('pacientes-queue', async (job) => {
  const datos = job.data;
  const inicio = Date.now();
  log.info({ datos, id: job.id }, "Iniciando procesamiento de paciente de la cola...");

  try {
    // Aquí se ejecuta la tarea "lenta" (ej. Playwright)
    const result = await rellenarFormularioIsi(datos);
    
    const ms = Date.now() - inicio;
    log.info({ ms, datos, id: job.id }, "Paciente procesado con ÉXITO");
    
    // Retorna el resultado (BullMQ lo puede guardar si se configura)
    return result;
  } catch (error) {
    const ms = Date.now() - inicio;
    log.error({ err: String(error), datos, id: job.id }, "Error procesando paciente de la cola");

    // ¡IMPORTANTE! Relanzar el error le dice a BullMQ que el trabajo FALLÓ.
    // Esto activa la lógica de reintentos (attempts: 3)
    throw error;
  }
}, { 
  connection,
  // concurrency: 1 // Opcional: Por defecto es 1 (procesa un trabajo a la vez)
});


// --- 4. EVENTOS DEL WORKER (Alertas y Monitoreo) ---

// Se dispara cuando un trabajo se completa con éxito
worker.on('completed', (job) => {
  log.info(`Job ${job.id} completado.`);
});

// Se dispara cuando un trabajo falla permanentemente (después de todos los reintentos)
worker.on('failed', async (job, err) => {
  const msg = `❌ Job ${job.id} falló permanentemente.`;
  log.error({ 
      jobId: job.id, 
      jobName: job.name, 
      datos: job.data, 
      error: err.message 
    }, 
    msg
  );
  
  // Solo envía la alerta si ha fallado el número máximo de intentos
  if (job.attemptsMade >= job.opts.attempts) {
    const datosPaciente = JSON.stringify(job.data, null, 2);
    
    // Construye el mensaje de alerta para Telegram
    await sendTelegramMessage(
`*¡ALERTA DE ERROR EN EL BOT!* 🤖

El Job \`${job.id}\` para el paciente \`${job.data.nombre || 'N/A'}\` ha fallado después de ${job.opts.attempts} intentos.

*Error:* \`${err.message}\`

*Datos enviados:*
\`\`\`
${datosPaciente}
\`\`\`
Por favor, registra al paciente manualmente.`
    );
  }
});


// --- 5. ENDPOINTS DE LA API (Rutas) ---

/**
 * Endpoint de 'Health Check'.
 * Responde 200 OK si el servidor está vivo.
 */
app.get("/health", (_, res) => {
  res.json({ ok: true, queue: "ready" });
});

/**
 * Endpoint de DEBUG: /test-login
 * Permite probar la función de login de isiclinic por separado.
 */
app.get("/test-login", async (req, res) => {
  try {
    const info = await testLogin();
    res.json({ ok: true, ...info });
  } catch (e) {
    log.error(e, "Error en /test-login");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * Endpoint de DEBUG: /rellenar-isiclinic
 * Ejecuta la tarea de forma SÍNCRONA (lenta).
 * Útil para probar la función 'rellenarFormularioIsi' directamente sin colas.
 */
app.post("/rellenar-isiclinic", async (req, res) => {
  const datos = req.body;
  const inicio = Date.now();
  try {
    const result = await rellenarFormularioIsi(datos);
    const ms = Date.now() - inicio;
    log.info({ ms, datos }, "Formulario completado (síncrono)");
    res.json({ ok: true, ms, result });
  } catch (error) {
    const ms = Date.now() - inicio;
    log.error({ err: String(error), datos, ms }, "Error (síncrono)");
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * Endpoint PRINCIPAL: /crear-paciente (Webhook)
 * Recibe datos (ej. de Google Forms) y los AÑADE A LA COLA.
 * Responde inmediatamente con 202 "Aceptado".
 */
app.post("/crear-paciente", async (req, res) => {
  // 1. Validación de Seguridad (Secreto de Webhook)
  const secret = req.header("X-Webhook-Secret") || "";
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    log.warn("Intento de webhook con secreto incorrecto");
    return res.status(401).json({ ok: false, error: "Invalid secret" });
  }

  try {
    const datos = req.body;

    // Valida que 'datos' no esté vacío (mejora)
    if (!datos || Object.keys(datos).length === 0) {
      log.warn("Webhook recibido sin datos (body vacío)");
      return res.status(400).json({ ok: false, error: "Empty body" });
    }
    
    // 2. Encolar el Trabajo
    // Añade el trabajo a la cola 'pacientes-queue' con el nombre 'nuevo-paciente'
    const job = await pacienteQueue.add('nuevo-paciente', datos, {
      attempts: 3, // Lo reintentará 3 veces si el Worker lanza un error
      backoff: { // Estrategia de espera entre reintentos
        type: 'exponential', // 5s, 10s, 20s...
        delay: 5000, 
      },
      removeOnComplete: true, // Borra el trabajo de Redis si se completa
      removeOnFail: 50      // Mantiene los últimos 50 trabajos fallidos en Redis
    });

    log.info({ datos, id: job.id }, "Paciente ENCOLADO con éxito");

    // 3. Responder al Webhook
    // Responde 202 (Aceptado) para que el webhook (Google Forms)
    // sepa que recibimos el dato, aunque no lo hayamos procesado aún.
    res.status(202).json({ ok: true, message: "Tarea encolada", id: job.id });

  } catch (error) {
    log.error({ err: String(error) }, "Error al ENCOLAR el trabajo");
    res.status(500).json({ ok: false, error: "Error al encolar la tarea" });
  }
});


// --- 6. FUNCIONES AUXILIARES (Ej. Telegram) ---

/**
 * Envía un mensaje a un chat de Telegram.
 * Lee el TOKEN y CHAT_ID desde las variables de entorno.
 */
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    log.warn("No se configuró el bot de Telegram (TOKEN o CHAT_ID), no se enviará mensaje.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown' // Permite usar *, _, ` en el texto
      })
    });
    log.info("Notificación de error enviada a Telegram.");
  } catch (err) {
    log.error(err, "Error al enviar mensaje de Telegram");
  }
}


// --- 7. INICIO DEL SERVIDOR ---
const port = process.env.PORT || 3000;

// Escucha en 0.0.0.0 para ser accesible dentro de Docker
app.listen(port, "0.0.0.0", () => {
  log.info(`Servidor API escuchando en http://0.0.0.0:${port}`);
  log.info(`Worker de BullMQ conectado y procesando trabajos...`);
});