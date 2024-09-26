'use strict'
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const socketIO = require('socket.io');
const { Pool, } = require('pg');
var cron = require('node-cron');
const { webAppMiddleware } = require('./web-app');

let app = express();
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
const db = require('./queries')(app, { socket: { io, subscribers } })


app.get('/update-sessions-key', (req, res) => {
  function updateKey(count) {
    db.pool.query('select id from public.sessions where unique_key is null limit 500;', async (e, rslts) => {
      if (e) return res.json({ success: false, error: e.message || e, });
      await Promise.all(rslts.rows.map(row => new Promise((resolve, reject) => {
        const key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
        db.pool.query('UPDATE public.sessions SET unique_key = $1 WHERE id = $2', [key, row.id], (error, results) => {
          if (error) return reject (error);
          resolve(results);
        }
      );
      })));
      db.pool.query('select count(*) from public.sessions where unique_key is null;', (e, rslts) => {
        if (e) {
          res.json({ success: false, error: e });
        } else {
          if (rslts.rows[0].count) return updateKey(rslts.rows[0].count);
          res.json({ success: true, rslts });
        }
      });
    });
  }
  updateKey();
});

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

app.get('/', (_, response) => {
  response.json({ info: 'Node.js, Express, and Postgres API' });
});

app.get('/test-mail', (_, res) => {
	const nodemailer = require('nodemailer');
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
	const mailOptions = {
		from: process.env.MAIL_FROM_ADDRESS,
		to: process.env.MAIL_RECEIVERS,
		subject: 'NEOTREE Test mail',
	};
	transporter.sendMail({ ...mailOptions, html: '<h1>Test mail</h1>' }, function(error, info){
		console.log({
			error,
			info,
		});
		res.json({
			error,
			success: error ? false : true,
			info,
		});
	});
});

app.get('/sessions/count-by-uid-prefix', db.countByUidPrefix);
app.get('/latestuploads', db.getLatestUploads);
app.get('/sessionsCount', db.getSessionsCount);
app.get('/sessions/:id', db.getSessionByTableId);
app.get('/sessions', db.getSessions);
//app.get('/sessions', db.getSessionByUID);
app.post('/sessions', db.saveSession);
app.put('/sessions/:id', db.updateSession);
app.delete('/sessions/:id', db.deleteSession);
app.get('/last-ingested-sessions', db.getLastIngestedSessions);
app.get('/find-sessions-by-uid', db.getSessionsByUID);
app.post('/exceptions', db.saveException);
app.post('/remove-confidential-data', db.removeConfidentialData);
app.get('/remove-confidential-data', db._removeConfidentialData);

app.post('/save-poll-data', (req, res) => {
  const done = e => {
    if (e) return res.json({ error: e.message });
    next();
  };
  const dbConfig = {
    database: process.env.POLL_DATABASE_NAME,
    user: process.env.POLL_DATABASE_USER,
    password: process.env.POLL_DATABASE_PASSWORD,
    port: process.env.POLL_DATABASE_PORT,
    host: process.env.POLL_DATABASE_HOST,
  };

  if (!(dbConfig.database && dbConfig.user && dbConfig.password && 
    dbConfig.port && dbConfig.host)) return res.json({ success: false, error: 'Database not setup' });

  const pool = new Pool(dbConfig);

  let unique_key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
  if (req.query.unique_key) unique_key = req.query.unique_key;

  var uid = "";
  if (req.query.uid) uid = req.query.uid.replace('"', '').replace('"', '');

  var scriptId = "";
  if (req.query.scriptId) scriptId = req.query.scriptId.replace('"', '').replace('"', '');

  var currentDate = new Date();

  pool.query('select count(*) from public.sessions where unique_key = $1;', [unique_key], (error, results) => {
    if (error) return done(error.message);

    const count = Number(results.rows[0].count);
    if (count) return done(null, `Session already exported`);

    pool.query(
      'INSERT INTO public.sessions (ingested_at, data, uid, scriptId, unique_key) VALUES ($1, $2, $3, $4, $5) RETURNING id', 
      [currentDate, req.body, uid, scriptId, unique_key], 
      (error, results) => {
        if (error || !results) return res.json({ success: false, error: error || 'Something went wrong', });
        res.json({ success: true, id: results.rows[0].id, });
      }
    );
  });
});

app = webAppMiddleware(app);

httpServer.listen(process.env.SERVER_PORT, (e) => {
  if(e){
  console.log('Failed to start server', e)
  } else{
    db.createExceptionTable();
    cron.schedule('13 * * * *', () => {
        db.sendEmails();
      }, {
      scheduled: true,
      timezone: "Africa/Harare"
    });
  console.log(`Listening on port ${process.env.SERVER_PORT}.`)
  }


}
  
);

module.exports = app;
