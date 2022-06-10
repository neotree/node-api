const { Pool, Client } = require('pg');

const pool = new Pool();

const countByUidPrefix = () => (req, res) => {
  pool.query(`SELECT count(*) FROM public.sessions WHERE uid LIKE '${req.query.uid_prefix}%';`, (e, rslts) => {
    if (e) throw e;
    res.status(200).send(rslts.rows[0] ? rslts.rows[0].count : 0);
  });
};

const getApiKeys = () => keys => {
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

const getLatestUploads = () => (request, response) => {
  pool.query('SELECT tablet, maxdate FROM public."latest_tablet_uploads"', (error, results) => {
    if (error) throw error;
    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);
    response.status(200).json(results.rows);
  });
};

const getSessionsCount = () => (request, response) => {
  pool.query('SELECT count, scripttitle FROM public."ScriptCount"', (error, results) => {
    if (error) throw error;
    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);
    response.status(200).json(results.rows);
  });
};

const getSessions = () => (request, response) => {
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

const getSessionByTableId = () => (request, response) => {
  const id = parseInt(request.params.id);

  pool.query('SELECT id, ingested_at, data FROM public.sessions WHERE id = $1', [id], (error, results) => {
    if (error) throw error;

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    response.status(200).json(results.rows);
  });
};

const getSessionsByUID = () => (request, response) => {
  const uid = request.query.uid

  pool.query('SELECT id, ingested_at, data FROM public.sessions WHERE uid = ($1)', [uid], (error, results) => {
    if (error) throw error;

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    response.status(200).json({ sessions: results.rows });
  });
};

const createSession = (app, { socket }) => (request, response) => {
  let unique_key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
  if (request.query.unique_key) unique_key = request.query.unique_key;

  var uid = "";
  if (request.query.uid) uid = request.query.uid.replace('"', '').replace('"', '');

  var scriptId = "";
  if (request.query.scriptId) scriptId = request.query.scriptId.replace('"', '').replace('"', '');

  const { ingested_at, data } = request.body;

  inputLength = JSON.stringify(request.body).length;
  var currentDate = new Date();

  pool.query('select count(*) from public.sessions where unique_key = $1;', [unique_key], (error, results) => {
    if (error) return response.status(201).send(error.message);

    const count = results.rows[0].count;
    if (count) return response.status(201).send(`Session already exported`);

    if (inputLength > 200) {
      pool.query('INSERT INTO public.sessions (ingested_at, data, uid, scriptId) VALUES ($1, $2, $3, $4, $5) RETURNING id', [currentDate, request.body, uid, scriptId, unique_key], (error, results) => {
        if (error) throw error;
        socket.io.emit('sessions_exported', { sessions: results.rows });
        response.status(200).send(`Session added with ID: ${results.rows[0].id}`);
      });
    }  else {
        response.status(201).send(`Session data too small`);
    }
  });
};

const updateSession = () => (request, response) => {
  const id = parseInt(request.params.id);
  const { ingested_at, data } = request.body;
  var currentDate = new Date();
  pool.query('UPDATE public.sessions SET ingested_at = $1, data = $2 WHERE id = $3', [currentDate, request.body, id], (error, results) => {
      if (error) throw error;
      response.status(200).send(`Sessions modified with ID: ${id}`);
    }
  );
};

const deleteSession = () => (request, response) => {
  const id = parseInt(request.params.id);

  pool.query('DELETE FROM public.sessions WHERE id = $1', [id], (error, results) => {
    if (error) throw error;
    response.status(200).send(`Session deleted with ID: ${id}`)
  });
};

const getLastIngestedSessions = () => (req, res) => {
  const { last_ingested_at } = req.query;

  const done = (error, rslts) => {
    res.json({ error, sessions: rslts ? rslts.rows : undefined });
  };

  pool.query('select max(ingested_at) as max_ingested_at from public.sessions;', [], (e, rslts) => {
    if (e) return done(e);

    const { rows: [{ max_ingested_at }] } = rslts;

    const lastTwoWeeks = new Date(max_ingested_at);
    const pastDate = lastTwoWeeks.getDate() - 14;
    lastTwoWeeks.setDate(pastDate);

    let lastIngestedAt = lastTwoWeeks;
    if (last_ingested_at && (new Date(last_ingested_at) > lastTwoWeeks)) lastIngestedAt = new Date(last_ingested_at);

    pool.query('select * from public.sessions where ingested_at > $1;', [lastIngestedAt], done);
  });
};

module.exports = (app, config = {}) => ({
  pool,
  getLatestUploads: getLatestUploads(app, config),
  getSessionsCount: getSessionsCount(app, config),
  getSessions: getSessions(app, config),
  getSessionByTableId: getSessionByTableId(app, config),
  createSession: createSession(app, config),
  updateSession: updateSession(app, config),
  deleteSession: deleteSession(app, config),
  getApiKeys: getApiKeys(app, config),
  countByUidPrefix: countByUidPrefix(app, config),
  getLastIngestedSessions: getLastIngestedSessions(app, config),
  getSessionsByUID: getSessionsByUID(app, config),
});
