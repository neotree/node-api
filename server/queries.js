const { Pool, Client } = require('pg');
const sendEmail = require('./mailer');
const CryptoJS = require('crypto-js');

const pool = new Pool();

const _removeConfidentialData = () => (req, res) => {
  const keys = [
    "MotherFirstName",
    "MotherSurname",
    "MothersCell",
    "MothFirstNameDC",
    "MothSurnameDC",
    "Ethnicity2",
    "HospNu",
    "MoFirstNameBC",
    "MoSurNameBC",
    "DOBTOB",
    "BirthDateDis",
    "Toes",
    "MothInitials",
    "MotherDOB",
    "BabyFirstName",
    "BabySurname",
    "BabyFirst",
    "BabyLast",
    'MotherAddressVillage',
  ];
  console.log('loading sessions...');
  const month = req.query.month;
  const year = req.query.year;
  // pool.query(`select count(*) from sessions where EXTRACT(MONTH FROM ingested_at) = ${month} and EXTRACT(YEAR FROM ingested_at) = ${year}`, (error, results) => {
  // 	res.json({ error, results });
  // });
  pool.query(`select id, data from sessions where EXTRACT(MONTH FROM ingested_at) = ${month} and EXTRACT(YEAR FROM ingested_at) = ${year} order by ingested_at desc;`, (error, results) => {
    if (error) return res.json({ error });

    const data = results.rows.map(item => {
      const data = item.data;
      const conf = Object.keys(data.entries).filter(key => keys.includes(key));
      keys.forEach(key => {
        delete data.entries[key];
      });
      return {
        id: item.id,
        data: JSON.stringify(data),
        conf,
      }
    }).filter(item => item.conf.length);

    console.log(data.length + ' sessions');

    if (data.length) {
      data.forEach((item, i) => {
        console.log('updating session ID: ' + item.id);
        pool.query('UPDATE public.sessions SET data = $1 WHERE id = $2', [item.data, item.id], (error, rslts) => {
          if (i === (data.length - 1)) console.log({ success: true });
        });
      });
    } else {
      console.log({ success: true });
      res.json({ success: true });
    }
  });
};

const removeConfidentialData = () => (req, res) => {
  const keys = req.body.keys || [];
  pool.query("select id, data from sessions order by ingested_at desc;", (error, results) => {
    if (error) return res.json({ error });

    const data = results.rows.map(item => {
      const data = item.data;
      const conf = Object.keys(data.entries).filter(key => keys.includes(key));
      keys.forEach(key => {
        delete data.entries[key];
      });
      return {
        id: item.id,
        data: JSON.stringify(data),
        conf,
      }
    }).filter(item => item.conf.length);

    if (data.length) {
      data.forEach((item, i) => {
        pool.query('UPDATE public.sessions SET data = $1 WHERE id = $2', [item.data, item.id], () => {
          if (i === (data.length - 1)) res.json({ success: true });
        });
      });
    } else {
      res.json({ success: true });
    }
  });
};

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

const getLocalSessionsByUID = () => (request, response) => {
  const uid = request.query.uid
  const hospital_id = request.query.hospital
   const sec = process.env.LOCAL_SERVER_SECRET
  pool.query(
    `SELECT DISTINCT ON (uid,scriptid) id, scriptid, ingested_at, data 
     FROM public.sessions 
     WHERE uid = ($1) AND data->>'hospital_id' = ($2)
     ORDER BY uid,scriptid, ingested_at DESC`,
    [uid, hospital_id],
    (error, results) => {
      if (error) throw error;
       const encrypted = encryptLocalData(results.rows, sec)
       console.log(JSON.stringify(results.rows))
      response.status(200).json(JSON.stringify({ sessions:  encrypted}));
    }
  );
}

const saveSession = (app, { socket }) => (request, response) => {
  const done = (e, data) => {
    if (e) return response.status(502).send(e.message || e);
    response.status(200).send(data);
  };
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
    if (error) return done(error.message);

    let q = 'INSERT INTO public.sessions (ingested_at, data, uid, scriptId, unique_key) VALUES ($1, $2, $3, $4, $5) RETURNING id';

    const count = Number(results.rows[0].count);
    if (count) {
      // return done(null, `Session already exported`);
      q = 'UPDATE public.sessions SET ingested_at=$1, data=$2, uid=$3, scriptId=$4, unique_key=$5 WHERE unique_key=$5 RETURNING id';
    }

    if (inputLength > 200) {
      pool.query(q, [currentDate, request.body, uid, scriptId, unique_key], (error, results) => {
        if (error) throw error;
        socket.io.emit('sessions_exported', { sessions: results.rows });
        done(null, `Session added with ID: ${results.rows[0].id}`);
      });
    } else {
      done(`Session data too small`);
    }
  });
};

const saveLocalSession = (app, { socket }) => (request, response) => {
  try{
  const done = (e, data) => {
    if (e) return response.status(502).send(e.message || e);
    response.status(200).send(data);
  };
  const sec = process.env.LOCAL_SERVER_SECRET
  let unique_key = `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
  if (request.query.unique_key) unique_key = request.query.unique_key;

  var uid = "";
  if (request.query.uid) uid = request.query.uid.replace('"', '').replace('"', '');

  var scriptId = "";
  if (request.query.scriptId) scriptId = request.query.scriptId.replace('"', '').replace('"', '');

  const { ingested_at, data } = request.body;

  const encrypted = request.body?.data
  const decryptedData = decryptLocalData(encrypted,sec)

  inputLength = JSON.stringify(decryptedData).length;
  var currentDate = new Date();

  pool.query('select count(*) from public.sessions where unique_key = $1;', [unique_key], (error, results) => {
    if (error) return done(error.message);

    let q = 'INSERT INTO public.sessions (ingested_at, data, uid, scriptId, unique_key) VALUES ($1, $2, $3, $4, $5) RETURNING id';

    const count = Number(results.rows[0].count);
    if (count) {
      // return done(null, `Session already exported`);
      q = 'UPDATE public.sessions SET ingested_at=$1, data=$2, uid=$3, scriptId=$4, unique_key=$5 WHERE unique_key=$5 RETURNING id';
    }

    if (inputLength > 200) {
      pool.query(q, [currentDate, decryptedData, uid, scriptId, unique_key], (error, results) => {
        if (error) throw error;
        socket.io.emit('sessions_exported', { sessions: results.rows });
        done(null, `Session added with ID: ${results.rows[0].id}`);
      });
    } else {
      done(`Session data too small`);
    }
  });
}catch(ex){
  console.warn("This is a warning",ex);
console.error("This is an error",ex);
console.debug("This is a debug message",ex);
}
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
const updateException = (id) => {
  const itemId = parseInt(id);

  pool.query('UPDATE public.neotree_exception SET sent = true where id = $1', [itemId], (error, results) => {
    if (error) throw error;
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

const saveException = () => (req, res) => {
  const done = (e, data) => {
    if (e) return res.status(502).send(e.message || e);
    res.status(200).send(data);
  };
  const q = `INSERT INTO public.neotree_exception (device_id,device_hash,message,device,country,stack,hospital,sent,version,battery,device_model,memory,editor_version) 
  VALUES ($1, $2, $3, $4, $5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`
  const { deviceId, deviceHash, message, device, country, stack, hospital, version, battery, device_model, memory, editor_version } = req.body
  pool.query(q, [deviceId, deviceHash, message, device, country, stack, hospital, false, version, battery, device_model, memory, editor_version], (error, results) => {
    if (error) {
      throw error
    } else done(null, `Exception: ${results.rows[0].id}`);
  })
}
const getExceptions = (callback) => {

  pool.query('SELECT id, country, device_id, device_hash, message,stack,version,battery,device_model,memory,editor_version FROM public.neotree_exception WHERE sent is false', (error, results) => {
    if (error) callback(error, null)
    const jsonObject = JSON.stringify(results.rows)
    callback(null, JSON.parse(jsonObject));
  });
};


const createExceptionTable = () => {
  pool.query(`CREATE TABLE IF NOT EXISTS public.neotree_exception (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR NOT NULL,
	device_hash VARCHAR NOT NULL,
	message VARCHAR NOT NULL,
    device VARCHAR NOT NULL,
    country VARCHAR NOT NULL,
    stack VARCHAR NOT NULL,
    hospital VARCHAR,
    sent BOOLEAN,
    version VARCHAR,
    battery VARCHAR,
    device_model VARCHAR,
    memory VARCHAR,
    editor_version VARCHAR
  )`)
}
const sendEmails = () => {
  getExceptions((err, results) => {
    if (err) throw err
    if (Array.isArray(results)) {
      for (msg of results) {
        sendEmail(msg, (e, res) => {
          if (e) throw e
          //DO NOTHING
          updateException(msg.id);
        })
      }
    }
  })
}

const crypto = require('crypto');

function encryptLocalData(data, secretKey) {
  // 1. Generate random IV (16 bytes)
  const iv = crypto.randomBytes(16);
  
  // 2. Create cipher
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(secretKey, 'utf8'), // Key must be 32 bytes
    iv
  );
  
  // 3. Encrypt and output as Base64
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  // 4. Return IV + ciphertext (both Base64 encoded)
  return iv.toString('base64') +':'+ encrypted;
}

function decryptLocalData(encryptedData, secretKey) {
  try {
    // 1. Extract IV and ciphertext
    const [ivB64, ciphertext] = encryptedData.split(':');
    
    // 2. Convert IV from Base64 to Buffer
    const iv = Buffer.from(ivB64, 'base64');
    
    // 3. Ensure key is 32 bytes (AES-256 requirement)
    const key = Buffer.alloc(32); // Create a 32-byte buffer
    Buffer.from(secretKey, 'utf8').copy(key); // Copy the key
    
    // 4. Create decipher
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      key,
      iv
    );
    
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

module.exports = (app, config = {}) => ({
  pool,
  getLatestUploads: getLatestUploads(app, config),
  getSessionsCount: getSessionsCount(app, config),
  getSessions: getSessions(app, config),
  getSessionByTableId: getSessionByTableId(app, config),
  getLocalSessionsByUID:getLocalSessionsByUID(app, config),
  saveSession: saveSession(app, config),
  saveLocalSession: saveLocalSession(app, config),
  updateSession: updateSession(app, config),
  deleteSession: deleteSession(app, config),
  getApiKeys: getApiKeys(app, config),
  countByUidPrefix: countByUidPrefix(app, config),
  getLastIngestedSessions: getLastIngestedSessions(app, config),
  getSessionsByUID: getSessionsByUID(app, config),
  createExceptionTable,
  saveException: saveException(app, config),
  removeConfidentialData: removeConfidentialData(app, config),
  _removeConfidentialData: _removeConfidentialData(app, config),
  sendEmails
});
