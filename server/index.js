'use strict'
const express = require('express');
const bodyParser = require('body-parser');
const db = require('./queries');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('*', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  db.getApiKeys(apiKey)
    .then((rows = []) => {
      rows = rows.map(r => r.key);
      if (!rows.includes(apiKey)) throw new Error('Unauthorised api key');
      next();
    })
    .catch(e => { throw e; });
});

app.get('/', (request, response) => response.json({ info: 'Node.js, Express, and Postgres API' }));
app.get('/sessions/count-by-uid-prefix', db.countByUidPrefix);
app.get('/latestuploads', db.getLatestUploads);
app.get('/sessionsCount', db.getSessionsCount);
app.get('/sessions/:id', db.getSessionByTableId);
app.get('/sessions', db.getSessions);
//app.get('/sessions', db.getSessionByUID);
app.post('/sessions', db.createSession);
app.put('/sessions/:id', db.updateSession);
app.delete('/sessions/:id', db.deleteSession);


app.listen(process.env.SERVER_PORT, e => e ?
  console.log('Failed to start server', e)
  :
  console.log(`Listening on port ${process.env.SERVER_PORT}.`)
);

module.exports = app;
