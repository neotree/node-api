const nodemailer = require('nodemailer');
const  HTML_TEMPLATE = require("./mail-template.js");
const { logError, serializeError } = require('./helper');

const transporter = nodemailer.createTransport({
  service: process.env.MAIL_MAILER,
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false,
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  }
});

const mailOptions = {
  from: process.env.MAIL_FROM_ADDRESS,
  to: process.env.MAIL_RECEIVERS,
  subject: 'NEOTREE MOBILE APP EXCEPTION',
};

module.exports = function sendEmail(message,callback) {
        if(message){
                transporter.sendMail({ ...mailOptions, html: HTML_TEMPLATE(message) }, function(error, info){
                        if (error) {
                                logError('[Mailer] Sending the exception email failed', serializeError(error));
                                callback(error,null);
                        } else {
                                callback(null,{success: true})
                        }
                });
        }
}

// Free-form email (to/subject/html) for summaries that don't fit the per-exception template.
module.exports.raw = (options, callback) => transporter.sendMail({ ...mailOptions, ...options }, callback);
