const HTML_TEMPLATE = (message) => {
  let country = message.country=='zw'?"ZIMBABWE":"MALAWI"
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>NodeMailer Email Template</title>
          <style>
            .container {
              width: 100%;
              height: 100%;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .email {
              width: 80%;
              margin: 0 auto;
              background-color: #fff;
              padding: 20px;
            }
            .email-header {
              background-color: #1a313d;
              color: #fff;
              padding: 20px;
              text-align: center;
            }
            .email-body {
              padding: 20px;
            }
            .email-footer {
              background-color: #1a313d;
              color: #fff;
              padding: 20px;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="email">
              <div class="email-header">
                <h1>NEOTREE MOBILE APP EXCEPTION</h1>
              </div>
              <div class="email-body">
                <p><b>COUNTRY</b>: ${country}</p>
                <p><b>APP VERSION</b>: ${message.version}</p>
                <p><b>WEB EDITOR VERSION</b>: ${message.editor_version}</p>
                <p><b>DEVICE DETAILS:</b> ${message.device_model}</p>
                <p><b>AVAILABLE MEMORY:</b> ${message.memory}</p>
                <p><b>BATTERY LEVEL:</b> ${message.battery}</p>
                <p><b>MESSAGE</b>: ${message.message}</p>
                <p><b>STACK TRACE:</b> ${message.stack}</p>
              </div>
              <div class="email-footer">
                <p>© 2021 Neotree - All Rights Reserved. Charity no. 1186748, Registered office address: The Broadgate Tower, Third Floor, 20 Primrose Street, London EC2A 2RS | Designed by Creative Clinic</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }
  
   module.exports = HTML_TEMPLATE;