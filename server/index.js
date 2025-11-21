'use strict'
const crypto = require('crypto');
const {logError} = require('./helper')
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const socketIO = require('socket.io');
const { Pool, } = require('pg');
var cron = require('node-cron');
const { webAppMiddleware } = require('./web-app');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
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

// Helper function to load facility mapper
function loadFacilityMapper() {
    try {
        const mapperPath = path.join(__dirname, '..', 'facility-mapper.json');
        if (!fs.existsSync(mapperPath)) {
            throw new Error('Facility mapper file not found. Please create facility-mapper.json in the project root.');
        }
        const mapperData = fs.readFileSync(mapperPath, 'utf8');
        return JSON.parse(mapperData);
    } catch (error) {
        throw new Error(`Failed to load facility mapper: ${error.message}`);
    }
}

// Helper function to get facility codes from scriptId
function getFacilityCodesFromScriptId(scriptId) {
    const mapper = loadFacilityMapper();
    const facilityMapping = mapper.mappings[scriptId];

    if (!facilityMapping) {
        throw new Error(`No facility mapping found for scriptId: ${scriptId}`);
    }

    return {
        province: facilityMapping.province,
        district: facilityMapping.district,
        facility: facilityMapping.facility,
        programType: mapper.programType
    };
}

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



// app.post('/save-poll-data', async (req, res) => {
//     try {
//         const dbConfig = {
//             database: process.env.POLL_DATABASE_NAME,
//             user: process.env.POLL_DATABASE_USER,
//             password: process.env.POLL_DATABASE_PASSWORD,
//             port: process.env.POLL_DATABASE_PORT,
//             host: process.env.POLL_DATABASE_HOST,
//         };
//           if (!(dbConfig.database && dbConfig.user && dbConfig.password &&
//             dbConfig.port && dbConfig.host)) {
//             return res.status(500).json({ success: false, error: 'Database configuration is incomplete' });
//         }
//           const pool = new Pool(dbConfig);

//         let unique_key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
//         if (req.query.unique_key) unique_key = req.query.unique_key;

//         let uid = "";
//         if (req.query.uid) uid = req.query.uid.replace(/"/g, '');

//         let scriptId = "";
//         if (req.query.scriptId) scriptId = req.query.scriptId.replace(/"/g, '');

//         const currentDate = new Date();

//         // Validate request body
//         if (!req.body || typeof req.body !== 'object') {
//             return res.status(302).json({ success: true, message: 'No Body Found' });
//         }

//         const { rows } = await pool.query('SELECT count(*) FROM public.sessions WHERE unique_key = $1;', [unique_key]);
//         const count = Number(rows[0].count);
//         if (count) {
//             return res.status(301).json({ message: "Session already exported" });
//         }

//         const insertResult = await pool.query(
//             'INSERT INTO public.sessions (ingested_at, data, uid, scriptId, unique_key) VALUES ($1, $2, $3, $4, $5) RETURNING id',
//             [currentDate, req.body, uid, scriptId, unique_key]
//         );

//         if (!insertResult.rows[0]) {
//             throw new Error('Insert operation failed');
//         }

//         res.status(200).json({ success: true, id: insertResult.rows[0].id });
//     } catch (e) {
//       logError(`:: SAVE POLL ERROR: ${e.message}`)
//         res.status(502).json({ success: false, error: e.message });
//     }
// });

app.post('/save-poll-data', async (req, res) => {
    try {

        // Database configuration for impilo
        const dbConfig = {
            database: process.env.IMPILO_DATABASE_NAME,
            user: process.env.IMPILO_DATABASE_USER,
            password: process.env.IMPILO_DATABASE_PASSWORD,
            port: process.env.IMPILO_DATABASE_PORT ,
            host: process.env.IMPILO_DATABASE_HOST 
        };

        if (!(dbConfig.database && dbConfig.user && dbConfig.password &&
            dbConfig.port && dbConfig.host)) {
            return res.status(500).json({ success: false, error: 'Database configuration is incomplete' });
        }

        // Connect to PostgreSQL server (without specifying database)
        const adminPool = new Pool({
            user: dbConfig.user,
            password: dbConfig.password,
            port: dbConfig.port,
            host: dbConfig.host,
            database: 'postgres' // Connect to default database
        });

        // Check if database exists, create if it doesn't
        const dbCheckResult = await adminPool.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [dbConfig.database]
        );

        if (dbCheckResult.rows.length === 0) {
            await adminPool.query(`CREATE DATABASE ${dbConfig.database}`);
        }

        await adminPool.end();

        // Now connect to the impilo database
        const pool = new Pool(dbConfig);

        // Create table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.impilo_sessions (
                id SERIAL PRIMARY KEY,
                ingested_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                time TIMESTAMP WITHOUT TIME ZONE,
                scriptid TEXT,
                uid TEXT,
                impilo_id TEXT,
                impilo_uid UUID DEFAULT gen_random_uuid(),
                synced BOOLEAN DEFAULT false,
                data TEXT
            );
        `);

        // Create index on unique fields for duplicate checking (date-based)
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_impilo_uid_scriptid_date
            ON public.impilo_sessions(uid, scriptid, DATE(time));
        `);

        // Extract parameters
        let uid = "";
        if (req.query.uid) uid = req.query.uid.replace(/"/g, '');

        let scriptId = "";
        if (req.query.scriptId) scriptId = req.query.scriptId.replace(/"/g, '');

        // Validate scriptId is provided
        if (!scriptId) {
            return res.status(400).json({
                success: false,
                error: 'scriptId is required'
            });
        }

        // Get facility codes from mapper using scriptId
        let province, district, facilityCode, programType;
        try {
            const facilityCodes = getFacilityCodesFromScriptId(scriptId);
            province = facilityCodes.province;
            district = facilityCodes.district;
            facilityCode = facilityCodes.facility;
            programType = facilityCodes.programType;
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(302).json({ success: true, message: 'No Body Found' });
        }

        // Extract started_at from request body
        const { started_at } = req.body;
        if (!started_at) {
            return res.status(400).json({
                success: false,
                error: 'started_at field is required in request body'
            });
        }

        // Parse the started_at date
        const sessionTime = new Date(started_at);
        if (isNaN(sessionTime.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid started_at date format'
            });
        }

        const sessionYear = sessionTime.getFullYear();
        const currentDate = new Date(); // For ingested_at timestamp

        // Check for duplicates based on uid, scriptid, and date (not full timestamp)
        const duplicateCheck = await pool.query(
            'SELECT count(*) FROM public.impilo_sessions WHERE uid = $1 AND scriptid = $2 AND DATE(time) = DATE($3)',
            [uid, scriptId, sessionTime]
        );

        const duplicateCount = Number(duplicateCheck.rows[0].count);
        if (duplicateCount > 0) {
            return res.status(301).json({
                success: false,
                message: "Duplicate record - session already exists for this date"
            });
        }

        // Generate impilo_id: PP-DD-SS-YYYY-P-XXXXX
        // Get the current sequence number for this year and facility
        const sequenceQuery = await pool.query(`
            SELECT COUNT(*) as count
            FROM public.impilo_sessions
            WHERE impilo_id LIKE $1
            AND EXTRACT(YEAR FROM time) = $2
        `, [`${province}-${district}-${facilityCode}-${sessionYear}-${programType}-%`, sessionYear]);

        const sequenceNumber = Number(sequenceQuery.rows[0].count) + 1;
        const formattedSequence = String(sequenceNumber).padStart(5, '0');
        const impiloIdPlain = `${province}-${district}-${facilityCode}-${sessionYear}-${programType}-${formattedSequence}`;

        // Encrypt the impilo_id using AES-256
        const secretKey = process.env.IMPILO_ENCRYPTION_SECRET || process.env.LOCAL_SERVER_SECRET;
        const keyBuffer = Buffer.alloc(32);
        Buffer.from(secretKey, 'utf8').copy(keyBuffer, 0, 0, 32);

        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-cbc',
            keyBuffer,
            iv
        );
        let encryptedImpiloId = cipher.update(impiloIdPlain, 'utf8', 'base64');
        encryptedImpiloId += cipher.final('base64');
        const impiloIdWithIv = iv.toString('base64') + ':' + encryptedImpiloId;

        // Encrypt the data
        const dataIv = crypto.randomBytes(16);
        const dataCipher = crypto.createCipheriv(
            'aes-256-cbc',
            keyBuffer,
            dataIv
        );
        let encryptedData = dataCipher.update(JSON.stringify(req.body), 'utf8', 'base64');
        encryptedData += dataCipher.final('base64');
        const encryptedDataWithIv = dataIv.toString('base64') + ':' + encryptedData;

        // Generate UUID for this record
        const impiloUid = uuidv4();

        // Insert the record
        const insertResult = await pool.query(
            `INSERT INTO public.impilo_sessions
            (ingested_at, time, scriptid, uid, impilo_id, impilo_uid, synced, data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id`,
            [currentDate, sessionTime, scriptId, uid, impiloIdWithIv, impiloUid, false, encryptedDataWithIv]
        );

        if (!insertResult.rows[0]) {
            throw new Error('Insert operation failed');
        }

        await pool.end();

        res.status(200).json({
            success: true,
            id: insertResult.rows[0].id,
            impilo_id: impiloIdPlain // Return unencrypted ID for reference
        });

    } catch (e) {
        logError(`:: SAVE IMPILO ERROR: ${e.message}`);
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