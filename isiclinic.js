import { chromium } from "playwright";

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export async function testLogin() {
  const headless = String(process.env.HEADLESS || "true") === "true";
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    await page.goto(process.env.ISI_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Login
    await page.fill('#esi_user', process.env.ISI_USER);
    await page.fill('#esi_pass', process.env.ISI_PASS);
    await page.click('button[type="submit"]');

    // Espera robusta
    await Promise.race([
      page.waitForSelector('img[src$="logo_generico.png"], img[src*="logo_generico"]', {
        state: "visible",
        timeout: 30000
      }),
      page.waitForSelector('input[name="esi_user"]', {
        state: "visible",
        timeout: 30000
      }).then(() => { throw new Error("Login falló: sigue visible el formulario."); })
    ]);

    console.log("✅ Login correcto (logo detectado).");
    await page.waitForLoadState("networkidle");

    // Ir a Pacientes (nuevo)
    const pacientesURL = "https://app.esiclinic.com/pacientes.php?autoclose=1&new=1";
    await page.goto(pacientesURL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Esperar formulario
    await page.waitForSelector('#Tnombre', { timeout: 20000 });

    // Rellenar demo
    const nombre = "Alía";
    const apellidos = "Buchar";
    await page.fill('#Tnombre', nombre);
    await page.fill('#Tapellidos', apellidos);

    // Captura
    await page.screenshot({ path: "capturas/paciente-guardado.png", fullPage: true });

    await browser.close();
    return { ok: true };
  } catch (error) {
    console.error("❌ Error en testLogin:", error);
    await page.screenshot({ path: "capturas/error.png", fullPage: true }).catch(() => {});
    await browser.close();
    throw error;
  }
}

export async function rellenarFormularioIsi(datos = {}) {
  const headless = String(process.env.HEADLESS || "true") === "true";
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();

  try {
    // LOGIN
    await page.goto(process.env.ISI_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.fill("#esi_user", process.env.ISI_USER);
    await page.fill("#esi_pass", process.env.ISI_PASS);
    await page.click('button[type="submit"]');

    // Esperar login OK
    await Promise.race([
      page.waitForSelector('img[src$="logo_generico.png"]', { timeout: 30000 }),
      page.waitForSelector('input[name="esi_user"]', { timeout: 30000 }).then(() => {
        throw new Error("❌ Login incorrecto");
      })
    ]);

    // ENTRAR A NUEVO PACIENTE
    await page.goto("https://app.esiclinic.com/pacientes.php?autoclose=1&new=1", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // RELLENAR CAMPOS EXACTOS QUE DECIDAS
    if (datos.nombre)      await page.fill("#Tnombre", datos.nombre);
    if (datos.apellidos)   await page.fill("#Tapellidos", datos.apellidos);
    if (datos.telefono)    await page.fill("Tmovil", datos.telefono);
    if (datos.email)       await page.fill("#Temail", datos.email);
    if (datos.comentario)  await page.fill("#Tcomentario", datos.comentario);
    if (datos.tratamiento) await page.fill("#Ttratamiento", datos.tratamiento);
    if (datos.fuente)      await page.fill("#Tfuente", datos.fuente);
    if (datos.dni)         await page.fill("#TCIF", datos.dni);
    if (datos.fdn) await page.fill("Tfechadenacimiento", datos.fdn);
    if (datos.sexo)        await page.selectOption("#Tsexo", String(datos.sexo));
    if (datos.direccion)   await page.fill("#Tdireccion", datos.direccion);
    if (datos.cp)          await page.fill("#Tcp", datos.cp);
    if (datos.poblacion)   await page.fill("#Tpoblacion", datos.poblacion);
    if (datos.provincia)   await page.fill("#Tprovincia", datos.provincia);
    if (datos.pais)        await page.fill("#Tpais", datos.pais);

    // GUARDAR REGISTRO
    //await page.click("#guardarRegistro");

    // 1. Esperamos 5 segundos (puedes cambiar el 5000)
    console.log("Esperando 5 segundos antes de la captura...");
    await wait(5000); // 5000 milisegundos = 5 segundos

    // 2. Creamos el nombre de archivo con fecha y hora
    const now = new Date();
    // Esto crea un formato seguro para archivos, ej: 2025-11-09T18-40-00
    const timestamp = now.toISOString()
                         .replace(/:/g, '-') // Reemplaza : por -
                         .slice(0, -5);      // Quita los milisegundos y la 'Z'

    const screenshotPath = `capturas/paciente_${timestamp}.png`;
    console.log(`Guardando captura en: ${screenshotPath}`);
    
    // 3. Hacemos la captura con el nuevo nombre
    await page.screenshot({ path: screenshotPath });    
    
    await browser.close();

    return { ok: true, datos_enviados: datos };

  } catch (error) { 
    console.error("Error en rellenarFormularioIsi:", error.message);
    
    console.log("Error detectado. Esperando 5 segundos antes de la captura de error...");
    await wait(5000); // 1. Esperamos 5 segundos

    // 2. Creamos el nombre de archivo con fecha y hora
    const now = new Date();
    const timestamp = now.toISOString()
                          .replace(/:/g, '-') // Reemplaza : por -
                          .slice(0, -5);      // Quita los milisegundos y la 'Z'
    
    const errorPath = `capturas/error_${timestamp}.png`;
    console.log(`Guardando captura de error en: ${errorPath}`);
    
    // 3. Hacemos la captura con el nuevo nombre
    await page.screenshot({ path: errorPath });
    
    // Re-lanza el error para que el worker de BullMQ lo sepa
    throw error;
  }
}
