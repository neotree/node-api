'use strict'
const {logError} = require('./helper')
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

app.get('/api/ping', (_, res) => res.status(200).json({ data: 'pong', }));

app.get('/update-sessions-key', (req, res) => {
  function updateKey() {
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
          res.status(400).json({ success: false, error: e });
        } else {
          if (rslts.rows[0].count) return updateKey(rslts.rows[0].count);
          res.status(200).json({ success: true, rslts });
        }
      });
    });
  }
  updateKey();
});

app.post('*', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const done = e => {
    if (e) return res.status(400).json({ error: e.message });
    next();
  };
  db.getApiKeys(apiKey)
    .then((rows = []) => {
      rows = rows.map(r => r.key);
      if (!rows.includes(apiKey)) done(new Error('Unauthorised api key'));
      done();
    })
    .catch(e => {
      logError(`::POST ERROR: ${e}`)
      done(e)});
});

app.get('/', (_, response) => {
  response.status(200).json({ info: 'Node.js, Express, and Postgres API' });
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
		res.status(error?400:200).json({
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
app.get('/localByUid', db.getLocalSessionsByUID);
app.post('/local', db.saveLocalSession);
app.put('/sessions/:id', db.updateSession);
app.delete('/sessions/:id', db.deleteSession);
app.get('/last-ingested-sessions', db.getLastIngestedSessions);
app.get('/find-sessions-by-uid', db.getSessionsByUID);
app.post('/exceptions', db.saveException);
app.post('/remove-confidential-data', db.removeConfidentialData);



app.post('/save-poll-data', async (req, res) => {
    try {
        const dbConfig = {
            database: process.env.POLL_DATABASE_NAME,
            user: process.env.POLL_DATABASE_USER,
            password: process.env.POLL_DATABASE_PASSWORD,
            port: process.env.POLL_DATABASE_PORT,
            host: process.env.POLL_DATABASE_HOST,
        };
          if (!(dbConfig.database && dbConfig.user && dbConfig.password && 
            dbConfig.port && dbConfig.host)) {
            return res.status(500).json({ success: false, error: 'Database configuration is incomplete' });
        }
          const pool = new Pool(dbConfig);

        let unique_key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
        if (req.query.unique_key) unique_key = req.query.unique_key;

        let uid = "";
        if (req.query.uid) uid = req.query.uid.replace(/"/g, '');

        let scriptId = "";
        if (req.query.scriptId) scriptId = req.query.scriptId.replace(/"/g, '');

        const currentDate = new Date();

        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(302).json({ success: true, message: 'No Body Found' });
        }

        const { rows } = await pool.query('SELECT count(*) FROM public.sessions WHERE unique_key = $1;', [unique_key]);
        const count = Number(rows[0].count);
        if (count) {
            return res.status(301).json({ message: "Session already exported" });
        }
        
        const insertResult = await pool.query(
            'INSERT INTO public.sessions (ingested_at, data, uid, scriptId, unique_key) VALUES ($1, $2, $3, $4, $5) RETURNING id', 
            [currentDate, req.body, uid, scriptId, unique_key]
        );
       
        if (!insertResult.rows[0]) {
            throw new Error('Insert operation failed');
        }

        res.status(200).json({ success: true, id: insertResult.rows[0].id });
    } catch (e) {
      logError(`:: SAVE POLL ERROR: ${e.message}`)
        res.status(502).json({ success: false, error: e.message });
    }
});

app = webAppMiddleware(app);

httpServer.listen(process.env.SERVER_PORT, (e) => {
  if(e){
  console.log('Failed to start server', e)
    db.createExceptionTable();  } else{

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