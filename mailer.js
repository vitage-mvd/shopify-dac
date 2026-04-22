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

    // Enviar el correo
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    logger.error(
      `[mailer] Error al enviar el correo ${JSON.stringify({
        message: error.message,
      })}`
    );
    throw error;
  }
};

module.exports = { sendEmail };
