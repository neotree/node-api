'use strict'
const crypto = require('crypto');
const {logError, logInfo} = require('./helper')
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

// Request deduplication cache - stores in-flight requests
// Key format: uid:scriptid:started_at
// Value: { processing: boolean, result: object, timestamp: number }
const requestCache = {};

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
        programType: mapper.programType,
        isAdmission: facilityMapping.isAdmission??true,
        allowMultiple: facilityMapping.allowMultiple??false
    };
}

// Helper function to decrypt impilo_id
function decryptImpiloId(encryptedIdWithIv) {
    if (!encryptedIdWithIv) return null;

    try {
        const secretKey = process.env.IMPILO_ENCRYPTION_SECRET || process.env.LOCAL_SERVER_SECRET;
        const keyBuffer = Buffer.alloc(32);
        Buffer.from(secretKey, 'utf8').copy(keyBuffer, 0, 0, 32);

        const parts = encryptedIdWithIv.split(':');
        if (parts.length !== 2) {
            console.error('Invalid encrypted format - missing IV separator');
            return null;
        }

        const [ivBase64, encryptedId] = parts;
        const iv = Buffer.from(ivBase64, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);

        let decrypted = decipher.update(encryptedId, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Failed to decrypt impilo_id:', error.message);
        return null;
    }
}

// Helper function to get the next sequence number with atomic database locking
// Prevents race conditions when multiple requests arrive simultaneously
async function getNextSequenceNumber(pool, scriptId, sessionYear) {
    try {
        // Use a database-level atomic operation to prevent race conditions
        // INSERT OR UPDATE the sequence tracker table with the next sequence number
        const result = await pool.query(`
            INSERT INTO public.impilo_sequence_tracker (scriptid, year, last_sequence, updated_at)
            VALUES ($1, $2, 1, NOW())
            ON CONFLICT (scriptid, year)
            DO UPDATE SET
                last_sequence = public.impilo_sequence_tracker.last_sequence + 1,
                updated_at = NOW()
            RETURNING last_sequence
        `, [scriptId, sessionYear]);

        const nextSequence = Number(result.rows[0].last_sequence);
        console.log(`[Sequence Lock] Generated sequence ${nextSequence} for scriptId=${scriptId}, year=${sessionYear}`);
        return nextSequence;
    } catch (error) {
        console.error('Error getting next sequence number:', error.message);
        // Fallback: query the actual records if locking fails
        try {
            const result = await pool.query(`
                SELECT DISTINCT impilo_id FROM public.impilo_sessions
                WHERE scriptid = $1
                AND EXTRACT(YEAR FROM time) = $2
            `, [scriptId, sessionYear]);

            if (result.rows.length === 0) {
                return 1;
            }

            let maxSequence = 0;
            for (const row of result.rows) {
                const decryptedId = decryptImpiloId(row.impilo_id);
                if (decryptedId) {
                    const parts = decryptedId.split('-');
                    const lastPart = parts[parts.length - 1];
                    const sequence = parseInt(lastPart, 10);
                    if (sequence > maxSequence) {
                        maxSequence = sequence;
                    }
                }
            }
            return maxSequence + 1;
        } catch (fallbackError) {
            console.error('Fallback sequence lookup also failed:', fallbackError.message);
            return 1; // Last resort - start from 1
        }
    }
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
  logInfo(`[API Key Check] Received POST to: ${req.originalUrl} with API key: ${apiKey || 'NO KEY PROVIDED'}`);

  const done = e => {
    if (e) {
      logError(`[API Key Validation Failed] ${e.message}`);
      return res.status(400).json({ error: e.message });
    }
    logInfo(`[API Key Validation Passed] Request allowed to proceed to next middleware`);
    next();
  };

  try {
    // db.getApiKeys is a function that returns another function expecting apiKey parameter
    // It returns a Promise
    if (!apiKey) {
      logError('[API Key Validation] No API key provided in x-api-key header');
      return done(new Error('No API key provided'));
    }

    logInfo(`[API Key Lookup] Starting query for key: ${apiKey}`);

    // Call db.getApiKeys with the apiKey
    const promise = db.getApiKeys(apiKey);

    if (!promise || typeof promise.then !== 'function') {
      logError(`[API Key Lookup Error] db.getApiKeys did not return a promise. Type: ${typeof promise}`);
      return done(new Error('API key validation service error'));
    }

    promise
      .then((rows) => {
        logInfo(`[API Key Query Result] Database returned: ${JSON.stringify(rows)}`);

        // Handle case where rows is null or undefined
        if (!rows || !Array.isArray(rows)) {
          logError(`[API Key Validation Error] Database query returned invalid data type: ${typeof rows}, value: ${JSON.stringify(rows)}`);
          return done(new Error('Invalid API key validation response'));
        }

        logInfo(`[Valid Keys in DB] Found ${rows.length} key(s)`);
        const keys = rows.map(r => r.key);
        logInfo(`[Valid Keys List] ${keys.join(', ') || 'None found'}`);

        if (!keys.includes(apiKey)) {
          logError(`[API Key Validation] Unauthorised api key: ${apiKey}`);
          return done(new Error('Unauthorised api key'));
        } else {
          logInfo(`[API Key Validation Success] Valid API key accepted: ${apiKey}`);
          done();
        }
      })
      .catch(e => {
        logError(`[API Key Lookup Error] Promise rejected with error: ${e.message}`);
        logError(`[Error Type] ${e.constructor.name}`);
        logError(`[Error Code] ${e.code}`);
        logError(`[Error Stack] ${e.stack}`);
        done(e);
      });
  } catch (error) {
    logError(`[API Key Validation Exception] Unexpected error: ${error.message}`);
    logError(`[Exception Stack] ${error.stack}`);
    done(error);
  }
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
    let pool; // Declare pool outside try block for access in catch block

    // Log incoming request data - OUTSIDE of try block to catch all requests
    try {
        logInfo('\n=== INCOMING REQUEST TO /save-poll-data ===');
        logInfo('[Request Method] POST');
        logInfo('[Request URL] ' + req.originalUrl);

        if (req.query && Object.keys(req.query).length > 0) {
            logInfo('[Query Parameters] ' + JSON.stringify(req.query));
        } else {
            logInfo('[Query Parameters] EMPTY - No query parameters');
        }

        if (req.body && Object.keys(req.body).length > 0) {
            logInfo('[Request Body] ' + JSON.stringify(req.body));
        } else {
            logInfo('[Request Body] EMPTY - No body data');
        }

        logInfo('[Content-Type] ' + (req.headers['content-type'] || 'NOT SET'));
        logInfo('[Content-Length] ' + (req.headers['content-length'] || 'NOT SET'));
    } catch (loggingError) {
        // If logging itself fails, try to log that error
        console.error('Failed to log incoming request:', loggingError);
    }

    try {

        // Extract uid, scriptid, and started_at early for request deduplication
        let uid = "";
        if (req.query.uid) uid = req.query.uid.replace(/"/g, '');
        logInfo(`[Extracted uid from query]: "${uid}" (length: ${uid.length})`);

        let scriptId = "";
        if (req.query.scriptId) scriptId = req.query.scriptId.replace(/"/g, '');
        logInfo(`[Extracted scriptId from query]: "${scriptId}" (length: ${scriptId.length})`);

        const { started_at } = req.body || {};
        logInfo(`[Extracted started_at from body]: "${started_at}"`);
        logInfo(`[Body keys present]: ${req.body ? Object.keys(req.body).join(', ') : 'No body'}`);

        // Create cache key for request deduplication using unique_key from query params
        // This prevents duplicate processing of the exact same request
        let unique_key = req.query.unique_key || null;
        logInfo(`[Cache/Deduplication key]: ${unique_key || 'Not provided'}`);
        const cacheKey = unique_key ? `unique_key:${unique_key}` : null;
        const CACHE_TIMEOUT = 10000; // 10 seconds - window for duplicate requests

        // Only apply deduplication if unique_key is provided
        if (cacheKey && requestCache[cacheKey]) {
            const cached = requestCache[cacheKey];
            const timeSinceRequest = Date.now() - cached.timestamp;

            if (timeSinceRequest < CACHE_TIMEOUT) {
                if (cached.processing) {
                    logInfo(`[Request Deduplicated] Request in progress for unique_key=${unique_key}`);
                    // Wait for the original request to complete
                    return new Promise((resolve) => {
                        const waitInterval = setInterval(() => {
                            if (!cached.processing && cached.result) {
                                clearInterval(waitInterval);
                                clearTimeout(timeoutHandle);
                                logInfo(`[Request Dedup Response] Returning cached result for unique_key=${unique_key}`);
                                res.status(cached.result.status).json(cached.result.body);
                                resolve();
                            }
                        }, 100);

                        // Timeout after 30 seconds
                        const timeoutHandle = setTimeout(() => {
                            clearInterval(waitInterval);
                            if (!res.headersSent) {
                                res.status(408).json({ success: false, error: 'Request timeout' });
                            }
                            resolve();
                        }, 30000);
                    });
                } else if (cached.result) {
                    logInfo(`[Request Dedup Cache Hit] Returning cached result for unique_key=${unique_key}`);
                    res.status(cached.result.status).json(cached.result.body);
                    return;
                }
            } else {
                // Cache expired, clean it up
                delete requestCache[cacheKey];
            }
        }

        // Mark this request as being processed (only if we have a unique_key)
        if (cacheKey) {
            requestCache[cacheKey] = {
                processing: true,
                result: null,
                timestamp: Date.now()
            };
            logInfo(`[Request Tracking] Starting processing for unique_key=${unique_key}`);
        }

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
        pool = new Pool(dbConfig);

        // Create table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.impilo_sessions (
                id SERIAL PRIMARY KEY,
                ingested_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                time TIMESTAMP WITHOUT TIME ZONE,
                scriptid TEXT,
                uid TEXT,
                unique_key TEXT,
                impilo_id TEXT,
                impilo_uid UUID NOT NULL UNIQUE,
                synced BOOLEAN DEFAULT false,
                data TEXT
            );
        `);

        // Create sequence tracking table to prevent race conditions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.impilo_sequence_tracker (
                id SERIAL PRIMARY KEY,
                scriptid TEXT NOT NULL,
                year INTEGER NOT NULL,
                last_sequence INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                UNIQUE(scriptid, year)
            );
        `);

        // Add unique_key column if it doesn't exist
        await pool.query(`
            ALTER TABLE public.impilo_sessions
            ADD COLUMN IF NOT EXISTS unique_key TEXT;
        `);

        // Create unique constraint on uid, scriptid, and DATE(time)
        // This ensures only one record per uid, scriptid, and day
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_impilo_uid_scriptid_date
            ON public.impilo_sessions(uid, scriptid, DATE(time));
        `);

        // Validate scriptId is provided (uid and scriptId already extracted at top)
        if (!scriptId) {
            return res.status(200).json({
                success: false,
                message: 'scriptId is required - record ignored'
            });
        }

        // Get facility codes from mapper using scriptId
        let province, district, facilityCode, programType, isAdmission, allowMultipleVal;
        try {
            const facilityCodes = getFacilityCodesFromScriptId(scriptId);
            if(facilityCodes){
            province = facilityCodes.province;
            district = facilityCodes.district;
            facilityCode = facilityCodes.facility;
            programType = facilityCodes.programType;
            // Extract isAdmission and allowMultiple from facility mapper
            isAdmission = facilityCodes.isAdmission ?? true; // Default to true if not specified
            allowMultipleVal = facilityCodes.allowMultiple ?? false; // Default to false if not specified
            }else{
               return res.status(200).json({
                success: false,
                message: `scriptId '${scriptId}' not found in facility-mapper - record ignored`
            });
            }
        } catch (error) {
            return res.status(200).json({
                success: false,
                message: `scriptId '${scriptId}' unidentified error found - record ignored`
            });
        }

        // Validate request body
        logInfo(`[Validation] Request body type: ${typeof req.body}, Is object: ${typeof req.body === 'object'}`);
        if (!req.body || typeof req.body !== 'object') {
            logError('[VALIDATION_ERROR] Request body is missing or not an object');
            return res.status(302).json({ success: true, message: 'No Body Found' });
        }

        // Validate started_at is present (already extracted at top for deduplication)
        logInfo(`[Validation] started_at present: ${!!started_at}, Value: "${started_at}"`);
        if (!started_at) {
            logError('[VALIDATION_ERROR] started_at field is required but missing');
            return res.status(400).json({
                success: false,
                error: 'started_at field is required in request body'
            });
        }

        logInfo(`[Facility Config] scriptId=${scriptId}, isAdmission=${isAdmission}, allowMultiple=${allowMultipleVal}`);

        // Parse the started_at date
        logInfo(`[Date Parsing] Attempting to parse started_at: "${started_at}"`);
        const sessionTime = new Date(started_at);
        logInfo(`[Date Parsing] Parsed date result: ${sessionTime.toISOString()}, Valid: ${!isNaN(sessionTime.getTime())}`);
        if (isNaN(sessionTime.getTime())) {
            logError(`[VALIDATION_ERROR] Invalid date format for started_at: "${started_at}"`);
            return res.status(400).json({
                success: false,
                error: 'Invalid started_at date format'
            });
        }

        const sessionYear = sessionTime.getFullYear();
        const currentDate = new Date(); // For ingested_at timestamp

        // Check for duplicates based on allowMultiple setting
        // If allowMultiple is true, check for uid, scriptid, and DATE part of time
        // If allowMultiple is false and isAdmission is true, check for scriptid and exact time
        if (allowMultipleVal) {
            // When allowMultiple=true, check on uid, scriptid, and date only (not time)
            const duplicateCheck = await pool.query(
                `SELECT COUNT(*) as count FROM public.impilo_sessions
                 WHERE uid = $1 AND scriptid = $2 AND DATE(time) = DATE($3)`,
                [uid, scriptId, sessionTime]
            );

            const duplicateCount = Number(duplicateCheck.rows[0].count);
            if (duplicateCount > 0) {
                await pool.end();
                return res.status(301).json({
                    success: false,
                    message: "Duplicate record - record with same uid, scriptid and date already exists"
                });
            }
        } else if (isAdmission) {
            // When allowMultiple=false and isAdmission=true, check on scriptid and exact time
            const duplicateCheck = await pool.query(
                'SELECT COUNT(*) as count FROM public.impilo_sessions WHERE scriptid = $1 AND time = $2',
                [scriptId, sessionTime]
            );

            const duplicateCount = Number(duplicateCheck.rows[0].count);
            logInfo(`[Duplicate Check] isAdmission=true, duplicateCount=${duplicateCount}`);
            if (duplicateCount > 0) {
                await pool.end();
                return res.status(301).json({
                    success: false,
                    message: "Duplicate record - session with same scriptid and time already exists"
                });
            }
        }

        let impiloIdPlain;
        let impiloIdWithIv;

        // If unique_key wasn't provided in query params, generate one for tracking
        if (!unique_key) {
            unique_key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
        }

        // Setup encryption key (needed for both new and existing impilo_ids)
        const secretKey = process.env.IMPILO_ENCRYPTION_SECRET || process.env.LOCAL_SERVER_SECRET;
        const keyBuffer = Buffer.alloc(32);
        Buffer.from(secretKey, 'utf8').copy(keyBuffer, 0, 0, 32);

        // Handle impilo_id logic
        if (allowMultipleVal) {
            // When allowMultiple=true, each uid gets its own impilo_id
            // The same uid can have records across different scriptIds - they all share the same impilo_id
            // Check if this uid already has a record (regardless of scriptId)
            const existingImpiloIdResult = await pool.query(
                `SELECT impilo_id FROM public.impilo_sessions
                 WHERE uid = $1
                 ORDER BY time ASC
                 LIMIT 1`,
                [uid]
            );

            if (existingImpiloIdResult.rows.length > 0) {
                // Reuse the impilo_id from the first record for this uid (regardless of scriptId)
                impiloIdWithIv = existingImpiloIdResult.rows[0].impilo_id;
                logInfo(`[allowMultiple=true] Reusing existing impilo_id for uid: ${uid}`);
            } else {
                // Generate new impilo_id for first record with this uid
                // Use the highest generated sequence number instead of counting all records
                const sequenceNumber = await getNextSequenceNumber(pool, scriptId, sessionYear);
                const formattedSequence = String(sequenceNumber).padStart(5, '0');
                impiloIdPlain = `${province}-${district}-${facilityCode}-${sessionYear}-${programType}-${formattedSequence}`;

                // Encrypt the new impilo_id using AES-256
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv(
                    'aes-256-cbc',
                    keyBuffer,
                    iv
                );
                let encryptedImpiloId = cipher.update(impiloIdPlain, 'utf8', 'base64');
                encryptedImpiloId += cipher.final('base64');
                impiloIdWithIv = iv.toString('base64') + ':' + encryptedImpiloId;
                logInfo(`[allowMultiple=true] Generated new impilo_id for first record of uid: ${uid}, impilo_id: ${impiloIdPlain}`);
            }
        } else if (isAdmission) {
            // Generate new impilo_id for admission records
            // Use the highest generated sequence number instead of counting all records
            const sequenceNumber = await getNextSequenceNumber(pool, scriptId, sessionYear);
            const formattedSequence = String(sequenceNumber).padStart(5, '0');
            impiloIdPlain = `${province}-${district}-${facilityCode}-${sessionYear}-${programType}-${formattedSequence}`;
            logInfo("[PLAIN_IMPILO_ID] " + impiloIdPlain);
            // Encrypt the new impilo_id using AES-256
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(
                'aes-256-cbc',
                keyBuffer,
                iv
            );
            let encryptedImpiloId = cipher.update(impiloIdPlain, 'utf8', 'base64');
            encryptedImpiloId += cipher.final('base64');
            impiloIdWithIv = iv.toString('base64') + ':' + encryptedImpiloId;
            logInfo(`[isAdmission=true] Generated new impilo_id: ${impiloIdPlain}`);
        } else {
            // Retrieve existing impilo_id for this uid (only when isAdmission=false and allowMultiple=false)
            const existingImpiloIdResult = await pool.query(
                `SELECT impilo_id FROM public.impilo_sessions WHERE uid = $1 LIMIT 1`,
                [uid]
            );

            if (!existingImpiloIdResult.rows.length) {
                await pool.end();
                return res.status(404).json({
                    success: false,
                    message: `No existing impilo_id found for uid: ${uid}. Please set isAdmission=true or allowMultiple=true for first record.`
                });
            }

            impiloIdWithIv = existingImpiloIdResult.rows[0].impilo_id;
            logInfo(`[isAdmission=false and allowMultiple=false] Retrieved existing impilo_id for uid: ${uid}`);
        }

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

        // Generate UUID for this record and check for collision before inserting
        let impiloUid = uuidv4();
        let insertResult;
        let maxRetries = 5;
        let retryCount = 0;

        // Try to insert with UUID collision retry logic
        while (retryCount < maxRetries) {
            try {
                // Duplicate check logic based on allowMultiple and isAdmission
                if (allowMultipleVal) {
                    // When allowMultiple=true, check for existing record with uid, scriptid, and same date
                    const existingCheck = await pool.query(
                        `SELECT COUNT(*) as count FROM public.impilo_sessions
                         WHERE uid = $1 AND scriptid = $2 AND DATE(time) = DATE($3)`,
                        [uid, scriptId, sessionTime]
                    );

                    const existingCount = Number(existingCheck.rows[0].count);

                    if (existingCount > 0) {
                        logInfo(`[Duplicate Detected] Record with uid=${uid}, scriptid=${scriptId} and same date already exists.`);
                        await pool.end();
                        return res.status(301).json({
                            success: false,
                            message: "Duplicate record - record with same uid, scriptid and date already exists"
                        });
                    }
                } else if (isAdmission) {
                    // When allowMultiple=false and isAdmission=true, check for admission record with uid and scriptid
                    const existingCheck = await pool.query(
                        'SELECT COUNT(*) as count FROM public.impilo_sessions WHERE uid = $1 AND scriptid = $2',
                        [uid, scriptId]
                    );

                    const existingCount = Number(existingCheck.rows[0].count);

                    if (existingCount > 0) {
                        logInfo(`[Duplicate Detected] Admission record with uid=${uid} and scriptid=${scriptId} already exists.`);
                        await pool.end();
                        return res.status(301).json({
                            success: false,
                            message: "Duplicate record - admission session with same uid and scriptid already exists"
                        });
                    }
                }

                // No duplicate found, proceed with insert
                logInfo(`[Generated impilo_id] Plain: ${impiloIdPlain || 'Retrieved existing'}, UUID: ${impiloUid}`);

                // Insert the record
                insertResult = await pool.query(
                    `INSERT INTO public.impilo_sessions
                    (ingested_at, time, scriptid, uid, unique_key, impilo_id, impilo_uid, synced, data)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id`,
                    [currentDate, sessionTime, scriptId, uid, unique_key, impiloIdWithIv, impiloUid, false, encryptedDataWithIv]
                );

                if (!insertResult.rows[0]) {
                    throw new Error('Insert operation failed');
                }

                // Log the saved record to a JSON file
                // Decrypt the impilo_id for logging
                const decryptedImpiloId = decryptImpiloId(impiloIdWithIv);

                let impiloIdSource;
                if (impiloIdPlain) {
                    // New impilo_id was generated
                    impiloIdSource = 'generated';
                } else if (allowMultipleVal) {
                    // Reused from another record for same uid
                    const firstRecord = await pool.query(
                        `SELECT id FROM public.impilo_sessions WHERE uid = $1 ORDER BY time ASC LIMIT 1`,
                        [uid]
                    );
                    impiloIdSource = firstRecord.rows.length > 0 ? `reused_from_record_${firstRecord.rows[0].id}` : 'unknown';
                } else {
                    // Retrieved existing for non-allowMultiple case
                    impiloIdSource = 'reused_existing';
                }

                const logEntry = {
                    uid: uid,
                    impilo_uid: impiloUid,
                    impilo_id: decryptedImpiloId,  // The actual decrypted impilo_id (PLAIN)
                    impilo_id_source: impiloIdSource,  // 'generated', 'reused_from_record_X', or 'reused_existing'
                    time: sessionTime.toISOString(),
                    scriptid: scriptId,
                    ingested_at: currentDate.toISOString(),
                    id: insertResult.rows[0].id
                };

                // Append to log file
                const logFilePath = path.join(__dirname, '..', 'saved-records.jsonl');
                fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n', 'utf8');
                logInfo(`[Logged] Record saved to ${logFilePath}`);

                // Close the pool after all operations are complete
                await pool.end();

                // Cache the successful result (only if we have a cacheKey)
                const responseBody = {
                    success: true,
                    id: insertResult.rows[0].id,
                    impilo_id: impiloIdPlain // Return unencrypted ID for reference
                };

                if (cacheKey && requestCache[cacheKey]) {
                    requestCache[cacheKey].processing = false;
                    requestCache[cacheKey].result = {
                        status: 200,
                        body: responseBody
                    };
                    logInfo(`[Request Cached] Result cached for cacheKey=${cacheKey}`);
                }

                res.status(200).json(responseBody);
                return;
            } catch (insertError) {
                // Handle any other errors during insert
                logError(`Insert error on attempt ${retryCount + 1}: ${insertError.message}`);

                // Check for UUID collision error by constraint name (database-agnostic)
                if (insertError.constraint === 'impilo_sessions_impilo_uid_key') {
                    logInfo(`[Attempt ${retryCount + 1}] UUID constraint violation detected. Regenerating...`);
                    impiloUid = uuidv4();
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        await pool.end();
                        return res.status(409).json({
                            success: false,
                            message: 'Failed to generate unique UUID after multiple attempts - please try again'
                        });
                    }
                    continue;
                }

                // Check for duplicate on uid, scriptid, and date (allowMultiple=true)
                if (insertError.constraint === 'idx_impilo_uid_scriptid_date') {
                    logInfo(`[Duplicate Detected] Constraint violation on uid+scriptid+date. Record already exists.`);
                    await pool.end();
                    return res.status(301).json({
                        success: false,
                        message: "Duplicate record - record with same uid, scriptid and date already exists"
                    });
                }

                // For other unique constraint violations, provide generic message
                if (insertError.code === '23505' || insertError.message.toLowerCase().includes('duplicate')) {
                    logInfo(`[Duplicate Detected] Unique constraint violation: ${insertError.constraint || 'unknown'}`);
                    await pool.end();
                    return res.status(301).json({
                        success: false,
                        message: `Duplicate record - ${insertError.constraint || 'constraint'} violation`
                    });
                }

                // For other errors, throw them
                throw insertError;
            }
        }

    } catch (e) {
        logError('\n=== ERROR CAUGHT IN /save-poll-data ===');
        logError('[Error Message] ' + e.message);
        logError('[Error Stack] ' + e.stack);
        logError('[Error Code] ' + e.code);
        logError('[Error Constraint] ' + e.constraint);
        logError('[Full Error Object] ' + JSON.stringify({
            message: e.message,
            code: e.code,
            constraint: e.constraint,
            detail: e.detail,
            file: e.file,
            line: e.line
        }, null, 2));
        logError(`:: SAVE IMPILO ERROR: ${e.message}`);
        // Close pool on error if it exists
        if (pool) {
            try {
                await pool.end();
            } catch (poolError) {
                logError('Error closing pool: ' + poolError.message);
            }
        }
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