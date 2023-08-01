const nodemailer = require('nodemailer');
const  HTML_TEMPLATE = require("./mail-template.js");
const config = {
    emailFrom: process.env.MAIL_PW,
    emailsTo: process.env.MAIL_RECEIVERS,
    emailPassword: process.env.MAIL_USER,
  };

const transporter = nodemailer.createTransport({
  service: 'gmail',
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
module.exports = async function sendEmail(message){
if(message){
transporter.sendMail({...mailOptions,html: HTML_TEMPLATE(message)}, function(error, info){
  if (error) {
 console.log(error);
  } else {
   return {success: true}
  }
});
}
}