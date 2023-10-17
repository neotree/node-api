const nodemailer = require('nodemailer');
const  HTML_TEMPLATE = require("./mail-template.js");

const transporter = nodemailer.createTransport({
  service: process.env.MAIL_MAILER,
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false,
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  },
   tls: {
        rejectUnauthorized: false
    }
});

const mailOptions = {
  from: process.env.MAIL_FROM_ADDRESS,
  to: process.env.MAIL_RECEIVERS,
  subject: 'NEOTREE MOBILE APP EXCEPTION',
};

module.exports = function sendEmail(message,callback) {
        console.log('sendEmail message = ', message);
        if(message){
                transporter.sendMail({ ...mailOptions, html: HTML_TEMPLATE(message) }, function(error, info){
                        console.log('transporter.sendMail', error, info);
                        if (error) {
                                callback(error,null);
                        } else {
                                callback(null,{success: true})
                        }
                });
        }
}
