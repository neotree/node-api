const nodemailer = require('nodemailer');
const  HTML_TEMPLATE = require("./mail-template.js");

const config = {
    emailFrom: process.env.MAIL_FROM_ADDRESS,
    emailsTo: process.env.MAIL_RECEIVERS,
    emailPassword: process.env.MAIL_PASSWORD,
};

const transporter = nodemailer.createTransport({
  service: process.env.MAIL_MAILER,
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: true,
  auth: {
    user: config.emailFrom,
    pass: config.emailPassword
  }
});

const mailOptions = {
  from: config.emailFrom,
  to: config.emailsTo,
  subject: 'NEOTREE MOBILE APP EXCEPTION',
};
module.exports = function sendEmail(message,callback) {
	if(message){
		transporter.sendMail({ ...mailOptions, html: HTML_TEMPLATE(message) }, function(error, info){
			if (error) {
				callback(error,null);
			} else {
				callback(null,{success: true})
			}
		});
	}
}
