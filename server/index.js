'use strict'
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const socketIO = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = socketIO(httpServer);

app.use(require('cors')());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const subscribers = {};
io.on('connection', socket => {
    subscribers[socket.id] = socket;

    socket.on('disconnect', () => { delete subscribers[socket.id]; });

    socket.emit('connected', { socketId: socket.id });
});

const db = require('./queries')(app, { socket: { io, subscribers } });

app.post('*', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const done = e => {
    if (e) return res.json({ error: e.message });
    next();
  };
  db.getApiKeys(apiKey)
    .then((rows = []) => {
      rows = rows.map(r => r.key);
      if (!rows.includes(apiKey)) done(new Error('Unauthorised api key'));
      done();
    })
    .catch(e => done(e));
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
app.get('/last-ingested-sessions', db.getLastIngestedSessions);


httpServer.listen(process.env.SERVER_PORT, e => e ?
  console.log('Failed to start server', e)
  :
  console.log(`Listening on port ${process.env.SERVER_PORT}.`)
);

module.exports = app;
