const axios = require("axios");
const fs = require("fs");
const { logger } = require("./logger");
const util = require("util"); // for logging with { depth: null } to avoid circular references

const PRODUCCION_ACTIVADO = process.env.ENTORNO === "PRODUCCION";

let DAC_USER_ID;
let DAC_USER_PASS;
let DAC_WS;
if (PRODUCCION_ACTIVADO) {
  // Credenciales DAC para PRODUCCIÓN
  logger.info(`Usando servidor de producción`);
  DAC_USER_ID = process.env.DAC_VITAGE_USER_ID;
  DAC_USER_PASS = process.env.DAC_VITAGE_USER_PASS;
  DAC_WS = process.env.DAC_WS_PROD;
} else {
  // Credenciales DAC para TESTING
  logger.info(`Usando servidor de pruebas`);
  DAC_USER_ID = process.env.DAC_USER_ID_TEST;
  DAC_USER_PASS = process.env.DAC_PASSWORD_TEST;
  DAC_WS = process.env.DAC_WS_STAG;
}

const DAC_WS_LOGIN_URL = `${DAC_WS}wsLogin`;
const DAC_WS_IN_GUIA_LEVANTE = `${DAC_WS}wsInGuia_Levante`;
const DAC_WS_GET_PEGOTE = `${DAC_WS}wsGetPegote`;

const maskSessionId = (sessionId) => {
  if (!sessionId || typeof sessionId !== "string") return "n/a";
  if (sessionId.length <= 12) return "***";
  return `${sessionId.slice(0, 6)}...${sessionId.slice(-6)}`;
};

// -----------------------------------------------------------------------------
// loginToDAC
// -----------------------------------------------------------------------------
/**
 * Logs into DAC and retrieves a session ID.
 *
 * This function makes an HTTP GET request to the DAC login endpoint using the provided credentials.
 * If successful, it returns the session ID; otherwise, it returns false.
 *
 * @returns {Promise<string|boolean>} The session ID if successful, otherwise false.
 */
async function loginToDAC() {
  try {
    const start = Date.now();
    logger.info("[dac.login] Requesting DAC session");
    const response = await axios.get(DAC_WS_LOGIN_URL, {
      params: { Login: DAC_USER_ID, Contrasenia: DAC_USER_PASS },
    });
    logger.info(
      `[dac.login] Response received ${JSON.stringify({
        elapsedMs: Date.now() - start,
        result: response?.data?.result,
      })}`
    );

    const { data } = response;

    if (data.result === 0 && data.data.length > 0) {
      const dacSessionId = data.data[0].ID_Session;
      logger.info(
        `[dac.login] Session created ${JSON.stringify({
          sessionIdMasked: maskSessionId(dacSessionId),
        })}`
      );
      return dacSessionId;
    }
    logger.warn(
      `[dac.login] DAC rejected login ${JSON.stringify({
        result: data?.result,
        data: data?.data,
      })}`
    );
    return false;
  } catch (error) {
    logger.error(
      `[dac.login] Error ${JSON.stringify({
        message: error.message,
        status: error?.response?.status,
        data: error?.response?.data,
      })}`
    );
    throw error;
  }
}

// -----------------------------------------------------------------------------
// wsInGuia_Levante
// -----------------------------------------------------------------------------
/**
 * Registers a shipping request in DAC.
 *
 * This function processes the Shopify payload to extract customer billing and shipping details.
 * It then constructs the necessary parameters and makes an HTTP GET request to the DAC wsInGuia_Levante endpoint.
 * If the request is successful, it returns an object containing the billing and shipping details; otherwise, it logs an error.
 *
 * @param {string} dacSessionId - The session ID obtained from wsLogin.
 * @param {object} shopifyPayload - The payload from Shopify containing order details.
 * @returns {Promise<object>} An object containing customer billing and shipping details, along with a success flag.
 */
async function wsInGuia_Levante(dacSessionId, shopifyPayload) {
  try {
    // logger.info(`shopifyPayload: ${JSON.stringify(shopifyPayload, null, 2)}`);

    const datosEntrega = shopifyPayload.shipping_address;

    const cliente = {
      ["Nombre"]: `${datosEntrega.first_name}`,
      ["Nombre Completo"]: `${datosEntrega.first_name} ${datosEntrega.last_name}`,
      ["Dirección"]: `${datosEntrega.address1}, ${datosEntrega.address2}, ${datosEntrega.province}, ${datosEntrega.city} Código Postal: ${datosEntrega.zip}`,
      ["Teléfono"]: datosEntrega.phone,
      ["Correo"]: shopifyPayload.contact_email,
      ["Id Pedido Shopify"]: shopifyPayload.id,
    };

    // Set up parameters for the wsInGuia_Levante request
    const inGuiaLevanteParams = {
      ID_Sesion: dacSessionId,
      k_Tipo_guia: 2, // Pago a cargo de VitAge
      K_tipo_Envio: 1, // Paquetes
      F_Recoleccion: "", // VitAge lleva el paquete a una sucursal de DAC
      K_Domicilio_Recoleccion: "", // Vacío debido a F_Recoleccion
      D_cliente_remitente: "VitAge, Kalavinka",
      Telefono_Remitente: "091 505 073",
      K_Cliente_Destinatario: 5, // Es cliente público
      Cliente_Destinatario: cliente["Nombre Completo"],
      Direccion_Destinatario: cliente["Dirección"],
      Telefono: cliente["Teléfono"],
      Rut: "",
      K_Oficina_Destino: 0, // Vacío porque siempre mandamos a Direccion_Destinatario
      Entrega: 2, // 2 es "Entrega en domicilio". Siempre mandamos a Direccion_Destinatario. Aún si es a una agencia DAC.
      Paquetes_Ampara: 1, // Siempre será un paquete/etiqueta
      Detalle_Paquetes: JSON.stringify([{ Cantidad: 1, Tipo: 1 }]),
      Observaciones: "Sin comentarios",
      CostoMercaderia: 0,
      Referencia_Pago: "",
      CodigoPedido: "",
      Serv_DDF: "",
      Serv_Cita: "",
      Latitud_Destino: "",
      Longitud_Destino: "",
    };

    // logger.info(`#1. inGuiaLevanteParams: ${JSON.stringify(inGuiaLevanteParams, null, 2)}`);

    logger.info(
      `[dac.wsInGuia_Levante] Request ${JSON.stringify({
        orderId: shopifyPayload?.id,
        hasSessionId: Boolean(dacSessionId),
      })}`
    );

    const start = Date.now();
    const response = await axios.get(DAC_WS_IN_GUIA_LEVANTE, {
      params: inGuiaLevanteParams,
    });
    logger.info(
      `[dac.wsInGuia_Levante] Response ${JSON.stringify({
        orderId: shopifyPayload?.id,
        elapsedMs: Date.now() - start,
        result: response?.data?.result,
      })}`
    );

    const wsInGuiaResponseData = util.inspect(response.data, { depth: null });
    logger.info(
      `#2. Repuesta de wsInGuia_Levante(). response.data: ${wsInGuiaResponseData}`
    );

    const responseOk = response.data.result === 0;

    if (responseOk) {
      logger.info("#3. Éxito en wsInGuia_Levante()");

      // K_Guia retorna un número similar al siguiente:
      // "170-3052882"
      // El K_Oficina proviente de la parte previa al guión (170)
      // El K_Guia proviente de la parte posterior al guión (3052882)
      const K_Parts = response.data.data.K_Guia.split("-");
      const K_Oficina = K_Parts[0];
      const K_Guia = K_Parts[1];

      return {
        ok: true,
        codigoRastreo: response.data.data.Codigo_Rastreo,
        getPegoteParams: {
          K_Oficina: K_Oficina, // Destino
          K_Guia: K_Guia,
          CodigoPedido: "", // custom Id. Dejar vacío si queremos el que genera DAC.
          ID_Sesion: dacSessionId,
        },
        datosCliente: cliente,
      };
    }

    return { ok: false, response: response };
  } catch (error) {
    logger.error(
      `[dac.wsInGuia_Levante] Error ${JSON.stringify({
        orderId: shopifyPayload?.id,
        message: error.message,
        status: error?.response?.status,
        data: error?.response?.data,
      })}`
    );
    throw error;
  }
}

async function wsGetpegote(pegoteParams) {
  let pegoteResponse = false;
  try {
    logger.info(
      `[dac.wsGetpegote] Request ${JSON.stringify({
        kOficina: pegoteParams?.K_Oficina,
        kGuia: pegoteParams?.K_Guia,
      })}`
    );
    const start = Date.now();
    pegoteResponse = await axios.get(DAC_WS_GET_PEGOTE, {
      params: pegoteParams,
    });
    logger.info(
      `[dac.wsGetpegote] Response ${JSON.stringify({
        elapsedMs: Date.now() - start,
        result: pegoteResponse?.data?.result,
      })}`
    );

    const resultOk = pegoteResponse.data.result === 0;

    if (resultOk) {
      try {
        const pegoteResponseData = pegoteResponse.data.data;
        const base64_pegote_PDF = pegoteResponseData.Pegote;
        const pegote_buffer = Buffer.from(base64_pegote_PDF, "base64");
        const etiquetaPath = "etiqueta.pdf";
        fs.writeFileSync(etiquetaPath, pegote_buffer);
        logger.info(`Éxito creando etiqueta (wsGetPegote)`);
        return {
          resultOk: true,
          pdf: etiquetaPath,
        };
      } catch (error) {
        logger.error(
          `[dac.wsGetpegote] Error procesando PDF ${JSON.stringify({
            message: error.message,
          })}`
        );
        return {
          resultOk: false,
          pdf: null,
        };
      }
    } else {
      logger.error(`Resultado fallido de wsGetPegote`);
      return {
        resultOk: false,
        pdf: null,
      };
    }

  } catch (error) {
    logger.error(
      `[dac.wsGetpegote] Error ${JSON.stringify({
        message: error.message,
        status: error?.response?.status,
        data: error?.response?.data,
      })}`
    );
    throw error;
  }
}

// -----------------------------------------------------------------------------
// Module Exports
// -----------------------------------------------------------------------------
module.exports = {
  loginToDAC,
  wsInGuia_Levante,
  wsGetpegote,
};
