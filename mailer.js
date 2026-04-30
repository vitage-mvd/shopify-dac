const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

const VITAGE_EMAIL = process.env.VITAGE_EMAIL;
const VITAGE_APP_PASS = process.env.VITAGE_APP_PASS;

const transporter = nodemailer.createTransport({
  service: "Gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: VITAGE_EMAIL,
    pass: VITAGE_APP_PASS,
  },
});

// -----------------------------------------------------------------------------
// sendEmail
// -----------------------------------------------------------------------------

/**
 * Enviar un correo electrónico mediante Nodemailer y OAuth2.
 * @param {string} to - Dirección de correo del destinatario.
 * @param {string} subject - Asunto del correo.
 * @param {string} message - Contenido en HTML del correo.
 * @returns {Promise<Object>} - Resultado del envío del correo.
 */
const sendEmail = async (to, copyTo, subject, message, attachmentPath) => {
  try {
    const toDomain = (to || "").includes("@")
      ? (to || "").split("@").pop()
      : null;
    console.log(
      "[MAIL_PROOF] send_attempt",
      JSON.stringify({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        secure: true,
        hasFrom: Boolean(VITAGE_EMAIL),
        hasAuth: Boolean(VITAGE_APP_PASS),
        toDomain,
        hasBcc: Boolean(copyTo),
        subjectLength: (subject || "").length,
        hasAttachment: Boolean(
          attachmentPath && fs.existsSync(attachmentPath)
        ),
      })
    );

    // Opciones del correo
    const mailOptions = {
      from: VITAGE_EMAIL,
      to: to,
      bcc: copyTo || "", // Añadir copia oculta si está definida
      subject,
      html: message,
      attachments:
        attachmentPath && fs.existsSync(attachmentPath)
          ? [
              {
                filename: path.basename(attachmentPath),
                path: attachmentPath,
              },
            ]
          : [],
    };

    if (attachmentPath && !fs.existsSync(attachmentPath)) {
      logger.warn(
        `[mailer] Attachment file not found ${JSON.stringify({
          attachmentPath,
        })}`
      );
    }

    const sendStarted = Date.now();
    const result = await transporter.sendMail(mailOptions);
    const okPayload = {
      elapsedMs: Date.now() - sendStarted,
      messageId: result?.messageId || null,
      response: result?.response || null,
    };
    logger.info(`[mailer] Sent OK ${JSON.stringify(okPayload)}`);
    console.log("[MAIL_PROOF] send_ok", JSON.stringify(okPayload));
    return result;
  } catch (error) {
    const errPayload = {
      message: error.message,
      code: error.code || null,
      command: error.command || null,
      responseCode: error.responseCode || null,
    };
    logger.error(
      `[mailer] Error al enviar el correo ${JSON.stringify(errPayload)}`
    );
    console.log("[MAIL_PROOF] send_failed", JSON.stringify(errPayload));
    throw error;
  }
};

module.exports = { sendEmail };
