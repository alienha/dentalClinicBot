/**
 * isiclinic.js
 * * Este módulo contiene toda la lógica de automatización con Playwright 
 * para interactuar con la plataforma IsiClinic.
 */

import { chromium } from "playwright";
import path from "path"; // Para construir rutas de archivo
import fs from "fs";     // Para gestionar el sistema de archivos (crear carpetas)

// --- Constantes y Configuración ---

// Directorio donde se guardarán las capturas de pantalla
const SCREENSHOT_DIR = path.join(process.cwd(), "capturas");

// URL de la página para crear un nuevo paciente
const NEW_PATIENT_URL = "https://app.esiclinic.com/pacientes.php?autoclose=1&new=1";

// --- Funciones "Helper" Internas (No exportadas) ---

/**
 * Lanza una nueva instancia del navegador y una página.
 * Centraliza la configuración de headless.
 * @returns {Promise<{browser: Browser, page: Page}>}
 */
async function launchBrowser() {
  const headless = String(process.env.HEADLESS || "true") === "true";
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  return { browser, page };
}

/**
 * Toma una captura de pantalla con un nombre de archivo único y timestamp.
 * Crea el directorio de capturas si no existe.
 * @param {Page} page - La instancia de la página de Playwright.
 * @param {string} prefix - Prefijo del archivo (ej. "error", "paciente_guardado").
 */
async function takeScreenshot(page, prefix) {
  try {
    // Asegura que el directorio de capturas exista
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Crea un timestamp (ej: 2025-11-13T01-15-00)
    const timestamp = new Date().toISOString()
                                .replace(/:/g, '-') // Reemplaza : por -
                                .slice(0, -5);      // Quita milisegundos y Z
    
    const screenshotPath = path.join(SCREENSHOT_DIR, `${prefix}_${timestamp}.png`);
    
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Captura guardada en: ${screenshotPath}`);
  } catch (ssError) {
    console.error("Error al tomar la captura de pantalla:", ssError.message);
    // No relanzamos el error aquí para no ocultar el error original
  }
}

/**
 * Lógica centralizada de Login en IsiClinic.
 * @param {Page} page - La instancia de la página de Playwright.
 */
async function loginToIsiClinic(page) {
  // 1. Ir a la URL de login
  await page.goto(process.env.ISI_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  // 2. Rellenar credenciales
  await page.fill('#esi_user', process.env.ISI_USER);
  await page.fill('#esi_pass', process.env.ISI_PASS);
  await page.click('button[type="submit"]');

  // 3. Espera Robusta de Post-Login
  // Usamos Promise.race para ver qué ocurre primero:
  // (A) Aparece el logo de la app (¡Éxito!)
  // (B) Sigue apareciendo el formulario de login (¡Fallo!)
  await Promise.race([
    page.waitForSelector('img[src*="logo_generico"]', { // Selector simplificado
      state: "visible",
      timeout: 30000
    }),
    page.waitForSelector('input[name="esi_user"]', {
      state: "visible",
      timeout: 30000
    }).then(() => { 
      // Si esto se cumple, el login falló (aún vemos el input de usuario)
      throw new Error("Login falló: Sigue visible el formulario de login."); 
    })
  ]);

  // 4. Esperar a que la red se calme
  // Esto asegura que cualquier script o llamada AJAX post-login termine.
  await page.waitForLoadState("networkidle");
  console.log("✅ Login en IsiClinic correcto.");
}


// --- Funciones Exportadas (Usadas por el Worker) ---

/**
 * Función de TEST: Loguea y rellena un formulario con datos de prueba.
 * Es usada por el endpoint /test-login para verificar que todo funciona.
 */
export async function testLogin() {
  const { browser, page } = await launchBrowser();

  try {
    // 1. Ejecutar el login
    await loginToIsiClinic(page);

    // 2. Ir a la página de nuevo paciente
    await page.goto(NEW_PATIENT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('#Tnombre', { timeout: 20000 });

    // 3. Rellenar con datos de prueba
    await page.fill('#Tnombre', "Test-Alía");
    await page.fill('#Tapellidos', "Test-Buchar");

    // 4. Captura de éxito
    await takeScreenshot(page, "test_login_success");

    return { ok: true, message: "Test de login y formulario OK" };

  } catch (error) {
    console.error("❌ Error en testLogin:", error.message);
    await takeScreenshot(page, "test_login_error");
    throw error; // Relanzar el error
  } finally {
    // ¡MUY IMPORTANTE!
    // El bloque 'finally' se ejecuta siempre, haya éxito o error.
    // Esto asegura que el navegador SIEMPRE se cierre.
    await browser.close();
  }
}

/**
 * Función PRINCIPAL: Rellena el formulario de nuevo paciente con datos dinámicos.
 * Esta es la función que llama el Worker de BullMQ.
 * @param {object} datos - Objeto con los datos del paciente (nombre, apellidos, etc.)
 */
export async function rellenarFormularioIsi(datos = {}) {
  const { browser, page } = await launchBrowser();

  try {
    // 1. Ejecutar el login
    await loginToIsiClinic(page);

    // 2. Ir a la página de nuevo paciente
    await page.goto(NEW_PATIENT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 3. Esperar a que el primer campo (nombre) esté listo
    await page.waitForSelector("#Tnombre", { timeout: 30000 });

    // 4. Rellenar campos (solo si existen en el objeto 'datos')
    // Esta estructura es flexible y evita errores si un dato no viene.
    if (datos.nombre)     await page.fill("#Tnombre", datos.nombre);
    if (datos.apellidos)  await page.fill("#Tapellidos", datos.apellidos);
    if (datos.telefono)   await page.fill("#Tmovil", datos.telefono); // Corregido: Tmovil
    if (datos.email)      await page.fill("#Temail", datos.email);
    if (datos.comentario) await page.fill("#Tcomentario", datos.comentario);
    if (datos.tratamiento) await page.fill("#Ttratamiento", datos.tratamiento);
    if (datos.fuente)     await page.fill("#Tfuente", datos.fuente);
    if (datos.dni)        await page.fill("#TCIF", datos.dni);
    if (datos.fdn)        await page.fill("#Tfechadenacimiento", datos.fdn);
    if (datos.sexo)       await page.selectOption("#Tsexo", String(datos.sexo));
    if (datos.direccion)  await page.fill("#Tdireccion", datos.direccion);
    if (datos.cp)         await page.fill("#Tcp", datos.cp);
    if (datos.poblacion)  await page.fill("#Tpoblacion", datos.poblacion);
    if (datos.provincia)  await page.fill("#Tprovincia", datos.provincia);
    if (datos.pais)       await page.fill("#Tpais", datos.pais);

    // 5. GUARDAR REGISTRO (Comentado como en tu original)
    // Descomenta la siguiente línea cuando quieras guardar activamente:
    // await page.click("#guardarRegistro");
    // console.log("Formulario guardado (click en #guardarRegistro).");

    // 6. Tomar captura de éxito
    // Muestra el formulario rellenado justo antes de cerrar.
    await takeScreenshot(page, "paciente_rellenado");
    
    return { ok: true, datos_enviados: datos };

  } catch (error) { 
    console.error("❌ Error en rellenarFormularioIsi:", error.message);
    
    // Tomar captura del estado en el momento del error
    await takeScreenshot(page, "formulario_error");
    
    // Relanzar el error para que BullMQ sepa que el job falló
    throw error;
  } finally {
    // Asegurar que el navegador se cierre siempre
    await browser.close();
  }
}