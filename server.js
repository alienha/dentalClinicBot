import "dotenv/config";
import express from "express";
import pino from "pino";
import { rellenarFormularioIsi, testLogin } from "./isiclinic.js";

// --- Importar BullMQ y Redis ---
import { Queue, Worker } from "bullmq";
import { default as IORedis } from "ioredis";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

// --- Función de Alerta de Telegram ---
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
        parse_mode: 'Markdown'
      })
    });
    log.info("Notificación de error enviada a Telegram.");
  } catch (err) {
    log.error(err, "Error al enviar mensaje de Telegram");
  }
}
// --- Fin de la Función de Telegram ---


const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Configuración de la Cola ---
// Usamos "redis" como host porque así se llama el servicio en docker-compose.yml
const connection = new IORedis({ 
  host: "redis", // El nombre del servicio de Docker
  port: 6379,
  maxRetriesPerRequest: null // Necesario para BullMQ
});

connection.on('connect', () => log.info('Conectado a Redis'));
connection.on('error', (err) => log.error(err, 'Error de conexión con Redis'));

// 1. LA COLA (Productor: añade trabajos)
// Esta es la cola donde tu endpoint pondrá las tareas
const pacienteQueue = new Queue('pacientes-queue', { connection });

// 2. EL WORKER (Consumidor: procesa trabajos)
// Esto procesará los trabajos de la cola, UNO POR UNO.
const worker = new Worker('pacientes-queue', async (job) => {
  const datos = job.data;
  const inicio = Date.now();
  log.info({ datos, id: job.id }, "Iniciando procesamiento de paciente de la cola...");

  try {
    // Aquí es donde realmente se ejecuta tu código de Playwright
    const result = await rellenarFormularioIsi(datos);
    
    const ms = Date.now() - inicio;
    log.info({ ms, datos, id: job.id }, "Paciente procesado con ÉXITO");
    return result; // El resultado se guarda
  } catch (error) {
    const ms = Date.now() - inicio;
    log.error({ err: String(error), datos, id: job.id }, "Error procesando paciente de la cola");
    // Lanza el error para que BullMQ sepa que falló y pueda reintentarlo
    throw error;
  }
}, { connection });

/// --- Eventos del Worker (Logs y Alertas) ---
worker.on('completed', (job) => log.info(`Job ${job.id} completado.`));

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
  
  if (job.attemptsMade >= job.opts.attempts) {
    const datosPaciente = JSON.stringify(job.data, null, 2);
    
    await sendTelegramMessage(
`*¡ALERTA DE ERROR EN EL BOT!* 🤖

El Job \`${job.id}\` para el paciente \`${job.data.nombre}\` ha fallado después de 3 intentos.

*Error:* \`${err.message}\`

*Datos enviados:*
\`\`\`
${datosPaciente}
\`\`\`
Por favor, registra al paciente manualmente.`
    );
  }
});

app.get("/health", (_, res) => res.json({ ok: true, queue: "ready" }));

// (Tu endpoint /test-login no cambia)
app.get("/test-login", async (req, res) => {
  try {
    const info = await testLogin();
    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// (Tu endpoint /rellenar-isiclinic no cambia)
app.post("/rellenar-isiclinic", async (req, res) => {
  const datos = req.body;
  const inicio = Date.now();
  try {
    const result = await rellenarFormularioIsi(datos);
    const ms = Date.now() - inicio;
    log.info({ ms, datos }, "Formulario completado");
    res.json({ ok: true, ms, result });
  } catch (error) {
    const ms = Date.now() - inicio;
    log.error({ err: String(error), datos, ms }, "Error");
    res.status(500).json({ ok: false, error: String(error) });
  }
});


// --- Webhook Google Forms (AHORA USA LA COLA) ---
app.post("/crear-paciente", async (req, res) => {
  // 1. Validación (igual que antes)
  const secret = req.header("X-Webhook-Secret") || "";
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    log.warn("Intento de webhook con secreto incorrecto");
    return res.status(401).json({ ok: false, error: "Invalid secret" });
  }

  try {
    const datos = req.body;
    
    // 2. ¡NUEVO! Añade el trabajo a la cola (en lugar de ejecutarlo)
    const job = await pacienteQueue.add('nuevo-paciente', datos, {
      // Opciones de BullMQ (reintentos automáticos si falla)
      attempts: 3, // Lo reintentará 3 veces si falla (ej. login)
      backoff: {
        type: 'exponential', // Espera más tiempo entre cada reintento
        delay: 5000,       // 5seg, luego 10seg, luego 20seg
      },
      removeOnComplete: true, // Limpia el job si se completa
      removeOnFail: 50      // Mantiene los últimos 50 jobs fallidos para verlos
    });

    log.info({ datos, id: job.id }, "Paciente ENCOLADO con éxito");

    // 3. Responde INMEDIATAMENTE al webhook
    // Código 202 = "Aceptado" (Tu petición ha sido aceptada y se procesará)
    res.status(202).json({ ok: true, message: "Tarea encolada", id: job.id });

  } catch (error) {
    log.error({ err: String(error) }, "Error al ENCOLAR el trabajo");
    res.status(500).json({ ok: false, error: "Error al encolar la tarea" });
  }
});

// --- Inicia el servidor ---
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  log.info(`Servidor backend (API) escuchando en http://0.0.0.0:${port}`);
  log.info(`Worker de BullMQ conectado a Redis y listo para procesar trabajos.`);
});