const crypto = require("crypto");
const express = require("express");
const app = express();
const NodeCache = require("node-cache");
const util = require("util");

const PRODUCCION_ACTIVADO = process.env.ENTORNO === "PRODUCCION" ? true : false;

const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || "2026-04-22-debug-v1";
const eventCache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
}); // Store for 5 min

const { logger } = require("./logger");
const { loginToDAC, wsInGuia_Levante, wsGetpegote } = require("./dac");
const {
  setEnvValue,
  generateClientTableInfo,
  enviarLogsPorCorreo,
  enviarEmailACliente,
  apiResponse,
} = require("./helpers");

if (!PRODUCCION_ACTIVADO) {
  // console log del momento para validar que el commit llegó.
  const ahora = new Date();
  const horas = ahora.getHours().toString().padStart(2, "0");
  const minutos = ahora.getMinutes().toString().padStart(2, "0");
  console.log(`Time: ${horas}:${minutos}`);
}

console.log(`Running on environment: ${process.env.ENTORNO}`);
logger.info(
  `[startup] Webhook service booted ${JSON.stringify({
    environment: process.env.ENTORNO,
    production: PRODUCCION_ACTIVADO,
    port: PORT,
    appVersion: APP_VERSION,
  })}`
);

// Middleware to capture raw body
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

/**
 * Webhook handler endpoint for processing Shopify events.
 */
app.post("/webhook", async (req, res) => {
  const webhookData = req.body;
  const eventId = req.get("X-Shopify-Event-Id") || "missing-event-id";
  const eventContext = {
    eventId,
    topic: req.get("X-Shopify-Topic"),
    shopDomain: req.get("X-Shopify-Shop-Domain"),
    orderId: webhookData?.id,
    orderName: webhookData?.name,
  };
  logger.info(`[webhook] Received ${JSON.stringify(eventContext)}`);

  // Check if the order is for local pickup
  const isLocalPickup = webhookData.shipping_address === null;

  if (isLocalPickup) {
    logger.info(
      `[webhook] Ignored local pickup order ${JSON.stringify(eventContext)}`
    );
    // Ignore local pickup orders
    return res.status(200).send("Ignored local pickup order");
  }

  let infoParaEmail = {};
  let getPegoteResponse;

  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_SECRET)
    .update(req.rawBody, "utf8")
    .digest("base64");

  if (hmacHeader !== generatedHmac) {
    logger.error(
      `[webhook] HMAC Unauthorized ${JSON.stringify({
        ...eventContext,
        hmacPresent: Boolean(hmacHeader),
      })}`
    );
    return res.status(401).send("Unauthorized"); // Ensures exit on failure
  }

  if (eventCache.has(eventId)) {
    logger.info(
      `[webhook] Duplicate event ignored ${JSON.stringify(eventContext)}`
    );
    return res.status(200).send("Duplicate webhook ignored.");
  } else {
    logger.info(`[webhook] Event accepted ${JSON.stringify(eventContext)}`);
  }

  eventCache.set(eventId, true); // Store event ID

  // Respond to Shopify immediately ro prevent a duplicate webhook
  res.status(200).send("Webhook received and processing started.");

  // Continue processing in the background
  setImmediate(async () => {
    try {
      logger.info(`[workflow] Processing started ${JSON.stringify(eventContext)}`);
      let dacSessionId = process.env.DAC_SESSION_ID;
      logger.info(
        `[workflow] Calling wsInGuia_Levante ${JSON.stringify({
          ...eventContext,
          hasSessionId: Boolean(dacSessionId),
        })}`
      );
      let wsInGuia_Levante_Response = await wsInGuia_Levante(
        dacSessionId,
        webhookData
      );
      logger.info(
        `[workflow] wsInGuia_Levante response ${JSON.stringify({
          ...eventContext,
          ok: wsInGuia_Levante_Response?.ok,
        })}`
      );

      if (!wsInGuia_Levante_Response.ok) {
        logger.info(
          `[workflow] Session retry required ${JSON.stringify(eventContext)}`
        );
        dacSessionId = await loginToDAC();
        if (dacSessionId) {
          logger.info(
            `[workflow] DAC session renewed ${JSON.stringify(eventContext)}`
          );
          setEnvValue("DAC_SESSION_ID", dacSessionId);
          wsInGuia_Levante_Response = await wsInGuia_Levante(
            dacSessionId,
            webhookData
          );
          logger.info(
            `[workflow] Retry wsInGuia_Levante response ${JSON.stringify({
              ...eventContext,
              ok: wsInGuia_Levante_Response?.ok,
            })}`
          );
        } else {
          logger.error(
            `[workflow] DAC login retry failed ${JSON.stringify(eventContext)}`
          );
        }
      }

      if (!wsInGuia_Levante_Response.ok) {
        logger.error(
          `[workflow] wsInGuia_Levante failed ${JSON.stringify({
            ...eventContext,
            response: util.inspect(wsInGuia_Levante_Response, { depth: 3 }),
          })}`
        );
      } else {
        // Success case
        const datosCliente = wsInGuia_Levante_Response.datosCliente;
        infoParaEmail.tablaDatosCliente = generateClientTableInfo(datosCliente);
        infoParaEmail.codigoRastreo = wsInGuia_Levante_Response.codigoRastreo;
        infoParaEmail.datosCliente = datosCliente;

        if (PRODUCCION_ACTIVADO) {
          void enviarEmailACliente(infoParaEmail);
        }

        const getPegoteParams = wsInGuia_Levante_Response.getPegoteParams;
        logger.info(
          `[workflow] Calling wsGetpegote ${JSON.stringify(eventContext)}`
        );
        getPegoteResponse = await wsGetpegote(getPegoteParams);
        logger.info(
          `[workflow] wsGetpegote response ${JSON.stringify({
            ...eventContext,
            resultOk: getPegoteResponse?.resultOk ?? false,
          })}`
        );
      }
    } catch (error) {
      logger.error(
        `[workflow] Error processing webhook ${JSON.stringify({
          ...eventContext,
          message: error.message,
        })}`
      );
    } finally {
      logger.info(`[workflow] Sending summary logs by email ${JSON.stringify(eventContext)}`);
      void enviarLogsPorCorreo(
        infoParaEmail.tablaDatosCliente,
        infoParaEmail.codigoRastreo,
        infoParaEmail.datosCliente,
        getPegoteResponse,
        PRODUCCION_ACTIVADO
      ); // Background task
    }
  });
});

// Start the server
app.listen(PORT, () => {
  logger.info(
    `[startup] Server listening ${JSON.stringify({
      port: PORT,
      appVersion: APP_VERSION,
    })}`
  );
});
