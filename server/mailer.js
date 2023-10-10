const nodemailer = require('nodemailer');
const  HTML_TEMPLATE = require("./mail-template.js");

const transporter = nodemailer.createTransport({
  service: process.env.MAIL_MAILER,
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: true,
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD
  }
});

console.log('transporter', transporter);

const mailOptions = {
  from: process.env.MAIL_FROM_ADDRESS,
  to: process.env.MAIL_RECEIVERS,
  subject: 'NEOTREE MOBILE APP EXCEPTION',
};

module.exports = function sendEmail(message,callback) {
	console.log('sendEmail message = ', message);
	if(message){
		transporter.sendMail({ ...mailOptions, html: HTML_TEMPLATE(message) }, function(error, info){
			console.log('sendEmail', error, info);
			if (error) {
				callback(error,null);
			} else {
				callback(null,{success: true})
			}
		});
	}
}
