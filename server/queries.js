const { Pool, Client } = require('pg');
const { DATABASE } = require('../config/server');
const formatJson = require('./formatJson')

const connectionString = `postgresql://${DATABASE.USERNAME}:${DATABASE.PASSWORD}@${DATABASE.HOST}:${DATABASE.PORT}/${DATABASE.DBNAME}`;

const pool = new Pool({ connectionString });

const getApiKeys = keys => {
  return new Promise((resolve, reject) => {
    keys = (keys.map ? keys : [keys]).map(k => `'${k}'`);
    pool.query(`SELECT key FROM public."api_keys" WHERE key IN (${keys.join(',')})`, (error, results) => {
      if (error) {
        reject(error);
      } else {
        resolve(results.rows);
      }
    });
  });
};

const getLatestUploads = (request, response) => {
  pool.query('SELECT tablet, maxdate FROM public."latest_tablet_uploads"', (error, results) => {
    if (error) throw error;
    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);
    response.status(200).json(results.rows);
  });
};

const getSessionsCount = (request, response) => {
  pool.query('SELECT count, scripttitle FROM public."ScriptCount"', (error, results) => {
    if (error) throw error;
    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);
    response.status(200).json(results.rows);
  });
};

const getSessions = (request, response) => {
  var sort = request.query.sort;
  var queryasc = 'SELECT id, ingested_at, data FROM public.sessions ORDER BY id ASC;';
  var querydesc = 'SELECT id, ingested_at, data FROM public.sessions ORDER BY id DESC;';
  var query = 'SELECT id, ingested_at, data FROM public.sessions;';

  if (sort == "asc") query = queryasc;
  if (sort == "desc") query = querydesc;

  pool.query(query, (error, results) => {
    if (error) throw error;

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    response.status(200).json(results.rows);
  });
};

const getSessionByTableId = (request, response) => {
  const id = parseInt(request.params.id);

  pool.query('SELECT id, ingested_at, data FROM public.sessions WHERE id = $1', [id], (error, results) => {
    if (error) throw error;

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    response.status(200).json(results.rows);
  });
};

const getSessionByUID = (request, response) => {
  const uid = request.query.uid

  pool.query('SELECT id, ingested_at, data FROM public.sessions WHERE uid = ($1)', [uid], (error, results) => {
    if (error) throw error;

    response.status(200).json(results.rows);
  });
};

const createSession = (request, response) => {
  var uid = "";
  if (request.query.uid) uid = request.query.uid.replace('"', '').replace('"', '');

  var scriptId = "";
  if (request.query.scriptId) scriptId = request.query.scriptId.replace('"', '').replace('"', '');


  inputLength = JSON.stringify(request.body).length;
  var currentDate = new Date();
  //Format Json Into Desirable Format
  const data = formatJson(request.body);
  console.log("DDDDD---",data)
  if (inputLength > 200) {
    pool.query('INSERT INTO public.sessions (ingested_at, data, uid, scriptId) VALUES ($1, $2, $3, $4) RETURNING id', [currentDate, data, uid, scriptId], (error, results) => {
      if (error) throw error;
      console.log("DD--ROWS--DDD---",results.rows);
      response.status(200).send(`Session added with ID: ${results.rows[0].id}`);
    });
  }  else {
      response.status(201).send(`Session data too small`);
  }
};

const updateSession = (request, response) => {
  const id = parseInt(request.params.id);
  const data = formatJson(request.body);
  console.log("DDDDD---",data)
  var currentDate = new Date();

  pool.query('UPDATE public.sessions SET ingested_at = $1, data = $2 WHERE id = $3', [currentDate, data, id], (error, results) => {
      if (error) throw error;
      response.status(200).send(`Sessions modified with ID: ${id}`);
    }
  );
};

const deleteSession = (request, response) => {
  const id = parseInt(request.params.id);

  pool.query('DELETE FROM public.sessions WHERE id = $1', [id], (error, results) => {
    if (error) throw error;
    response.status(200).send(`Session deleted with ID: ${id}`)
  });
};

module.exports = {
  getLatestUploads,
  getSessionsCount,
  getSessions,
  getSessionByTableId,
  createSession,
  updateSession,
  deleteSession,
  getApiKeys,
};
