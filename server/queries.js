const { Pool, Client } = require('pg');
const sendEmail = require('./mailer');
const { layout: mailLayout } = require('./mail-template');
const CryptoJS = require('crypto-js');

const pool = new Pool();

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
    'MothersCell',
    'KinAddress',
    'KinName'
  ];

const _removeConfidentialData = () => (req, res) => {

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
  const done = (e, data, statusCode = 502) => {
    if (e) return response.status(statusCode).send(e.message || e);
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

  // Check for duplicates on unique_key, uid, and scriptid
  pool.query('select count(*) from public.sessions where unique_key = $1 OR (uid = $2 AND scriptId = $3);', [unique_key, uid, scriptId], (error, results) => {
    if (error) return done(error.message);

    const count = Number(results.rows[0].count);
    if (count) {
      // Return 301 status code if duplicate record exists
      return response.status(301).json({
        success: false,
        message: "Duplicate record - session already exists"
      });
    }

    let q = 'INSERT INTO public.sessions (ingested_at, data, uid, scriptId, unique_key) VALUES ($1, $2, $3, $4, $5) RETURNING id';

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
    if (error) console.error('Failed to mark exception as sent', error.message);
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


const CE_PREFIXES = ['[Conditional expression failed to evaluate]', '[EligibilityCriteria.evaluateCondition]'];
const CE_LIKE = CE_PREFIXES.map((p) => `${p}%`);
const isCe = (message) => typeof message === 'string' && CE_PREFIXES.some((p) => message.startsWith(p));


const ceFingerprint = (stack) => {
  const text = `${stack || ''}`
  try {
    const stored = JSON.parse(text)
    if (typeof stored?.ce === 'string') return stored
  } catch (e) {}
  try {
    const extra = JSON.parse(text.slice(text.lastIndexOf('\n') + 1))
    if (typeof extra.condition === 'string') return { ce: extra.condition, authored: true }
    if (typeof extra.expression !== 'string') return null
    if (extra.expression !== extra.compiled) return { ce: extra.expression, authored: true }
    const shape = extra.compiled
      .replace(/"(?:[^"\\]|\\.)*"/g, '?')
      .replace(/\d+(?:\.\d+)?|\b(?:true|false|null)\b/g, '?')
    return shape.includes('"') ? null : { ce: shape, authored: false }
  } catch (e) {
    return null
  }
}

const stackToStore = (message, stack) => {
  if (!isCe(message)) return stack
  const fingerprint = ceFingerprint(stack)
  return fingerprint ? JSON.stringify(fingerprint) : ''
}

const saveException = () => (req, res) => {
  const done = (e, data) => {
    if (e) return res.status(502).send(e.message || e);
    res.status(200).send(data);
  };
  const q = `INSERT INTO public.neotree_exception (device_id,device_hash,message,device,country,stack,hospital,sent,version,battery,device_model,memory,editor_version) 
  VALUES ($1, $2, $3, $4, $5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`
  const { deviceId, deviceHash, message, device, country, stack, hospital, version, battery, device_model, memory, editor_version } = req.body
  pool.query(q, [deviceId, deviceHash, message, device, country || '', stackToStore(message, stack), hospital, false, version, battery, device_model, memory, editor_version], (error, results) => {
    if (error) return done(error)
    done(null, `Exception: ${results.rows[0].id}`);
  })
}
const getExceptions = (callback) => {

  pool.query('SELECT id, country, device_id, device_hash, message,stack,version,battery,device_model,memory,editor_version FROM public.neotree_exception WHERE sent is false AND message NOT LIKE ALL($1)', [CE_LIKE], (error, results) => {
    if (error) return callback(error, null)
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
  )`, (error) => error && console.error('Failed to create exception table', error.message))
}
const sendEmails = () => {
  getExceptions((err, results) => {
    if (err) return console.error('Failed to load exception email queue', err.message)
    if (Array.isArray(results)) {
      for (const msg of results) {
        sendEmail(msg, (e) => {
          if (e) return console.error('Failed to send exception email', e.message)
          updateException(msg.id);
        })
      }
    }
  })
}

const CE_LOOKUP_BATCH = 1000

const locateCes = async (lookups) => {
  const { EDITOR_URL, EDITOR_API_KEY } = process.env
  if (!EDITOR_URL || !EDITOR_API_KEY || typeof fetch !== 'function') return null
  const pairs = lookups.flatMap(({ site, expressions }) => expressions.map((ce) => [site, ce]))
  try {
    const located = { sites: {}, dataVersion: null }
    for (let i = 0; i === 0 || i < pairs.length; i += CE_LOOKUP_BATCH) {
      const batch = new Map(i ? [] : lookups.map(({ site }) => [site, []]))
      for (const [site, ce] of pairs.slice(i, i + CE_LOOKUP_BATCH)) {
        if (!batch.has(site)) batch.set(site, [])
        batch.get(site).push(ce)
      }
      const res = await fetch(`${EDITOR_URL.replace(/\/$/, '')}/api/app/ce-locations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': EDITOR_API_KEY },
        body: JSON.stringify({ sites: [...batch].map(([site, expressions]) => ({ site, expressions })) }),
        signal: AbortSignal.timeout(120000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      for (const [site, answer] of Object.entries(body.sites || {})) {
        const known = located.sites[site]
        located.sites[site] = known ? { ...known, locations: { ...known.locations, ...answer.locations } } : answer
      }
      if (located.dataVersion == null) located.dataVersion = body.dataVersion ?? null
    }
    return located
  } catch (e) {
    console.error('CE digest: web editor lookup failed', e.message)
    return null
  }
}

const IMPACTS = ['high', 'medium', 'low']
// Bounds one run after a long outage; the rest is reported the next day.
const CE_DIGEST_MAX_ROWS = 50000

// Only a CE as authored that the editor searched for in the site's scripts and did not find counts
// as gone. A value-stripped shape, "()" or a CE missing from the answer stays a fault, so nothing
// that may still be broken is hidden.
const isGone = (item) => item.resolved && item.authored && !item.total

// One email a day, one section per reporting site: a site's tablets sync only that site's scripts,
// so each site's CEs are looked up in its own scripts. Each faulty CE is listed once per site with
// where it is, what its failure does and how to fix it. A CE the site's scripts no longer have was
// fixed, changed or removed after the reporting tablets last downloaded; those tablets are listed
// with the CEs instead. Hermes offsets ("1:93:") in the error vary with the substituted values, and
// any double-quoted text in it is a substituted value, so both are stripped.
const sendCeDigest = () => {
  pool.query(
    'SELECT id, message, stack, device_id, device_hash, hospital, editor_version, country FROM public.neotree_exception WHERE sent is false AND message LIKE ANY($1) ORDER BY id LIMIT $2',
    [CE_LIKE, CE_DIGEST_MAX_ROWS],
    async (error, results) => {
      if (error) return console.error('CE digest query failed', error.message)
      if (!results.rows.length) return
      try {
        const sites = new Map() // site id ('' when not reported) -> Map(CE -> fault)
        const versions = new Map() // device -> newest data version in its reports
        for (const row of results.rows) {
          const fingerprint = ceFingerprint(row.stack)
          const error = row.message.replace(/\] \d+:\d+:/, '] ').replace(/"(?:[^"\\]|\\.)*"/g, '"[redacted]"')
          row.key = fingerprint ? fingerprint.ce : error
          row.site = row.hospital || ''
          if (!sites.has(row.site)) sites.set(row.site, new Map())
          const faults = sites.get(row.site)
          if (!faults.has(row.key)) faults.set(row.key, { ...fingerprint, error, devices: new Set(), ids: [] })
          const fault = faults.get(row.key)
          fault.devices.add(row.device_id)
          fault.ids.push(row.id)
          versions.set(row.device_id, Math.max(versions.get(row.device_id) || 0, Number(row.editor_version) || 0))
        }

        const located = await locateCes([...sites].map(([site, faults]) => ({
          site: site || null,
          expressions: [...faults.values()].filter((f) => f.ce).map((f) => f.ce),
        })))

        const sections = [...sites].map(([site, faults]) => {
          const answer = located && located.sites[site]
          const items = [...faults.values()].map((fault) => {
            const entry = answer && fault.ce && answer.locations[fault.ce]
            const { matches = [], total = matches.length, elsewhere = 0, fix } = entry || {}
            const rank = Math.min(IMPACTS.length, ...matches.map((m) => IMPACTS.indexOf(m.impact)).filter((i) => i >= 0))
            return { ...fault, matches, total, elsewhere, fix, rank, resolved: Boolean(entry) }
          }).sort((a, b) => a.rank - b.rank || b.devices.size - a.devices.size || b.ids.length - a.ids.length)
          const toFix = items.filter((item) => !isGone(item))
          const goneKeys = new Set(items.filter(isGone).map((item) => item.ce))
          const behind = new Map()
          for (const row of results.rows) {
            if (row.site !== site || !goneKeys.has(row.key)) continue
            if (!behind.has(row.device_id)) behind.set(row.device_id, { tablet: row.device_hash || row.device_id, version: versions.get(row.device_id), ces: new Set(), uploads: 0 })
            const tablet = behind.get(row.device_id)
            tablet.ces.add(row.key)
            tablet.uploads++
          }
          const name = (answer && answer.name) || site || 'Site not reported'
          return { name, scoped: Boolean(answer && answer.scoped), items, toFix, behind, high: toFix.filter((item) => item.rank === 0).length }
        }).sort((a, b) => b.high - a.high || b.toFix.length - a.toFix.length || a.name.localeCompare(b.name))

        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
        const where = (item) => {
          if (item.matches.length) {
            const shown = item.matches.slice(0, 5).map((m) => `<a href="${esc(m.href)}">${esc(m.script)} › ${esc(m.where)}</a><br><i>${esc(m.consequence)}</i>`)
            if (item.total > shown.length) shown.push(`…and ${item.total - shown.length} more`)
            if (item.elsewhere) shown.push(`Also in ${item.elsewhere} place(s) in other sites' scripts`)
            return shown.join('<br>')
          }
          if (!item.ce) return 'Condition not reported by the app'
          if (!item.resolved) return 'Location unavailable: web editor lookup not configured or failed'
          if (item.ce === '()') return 'An empty condition (the app does not say where)'
          return 'A field, option or search-field condition (the app does not say which)'
        }
        // Same look as the exception email: its layout, label lines and header colour.
        const table = 'width="100%" border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"'
        const headRow = 'bgcolor="#1a313d" style="color:#fff;text-align:left"'
        const faultRows = (s) => s.toFix.map((item) => `<tr valign="top">
          <td><b>${(IMPACTS[item.rank] || '—').toUpperCase()}</b></td>
          <td>${where(item)}</td>
          <td><code style="white-space:pre-wrap">${esc(item.ce || '')}</code><br>${esc(item.error)}${item.fix ? `<br><b>Fix:</b> ${esc(item.fix)}` : ''}</td>
          <td>${item.devices.size} device(s), ${item.ids.length} upload(s)</td>
        </tr>`).join('')
        const tabletRows = (s) => [...s.behind.values()].sort((a, b) => b.ces.size - a.ces.size).map((t) => {
          const ces = [...t.ces]
          const listed = ces.slice(0, 5).map((ce) => `<code style="white-space:pre-wrap">${esc(ce)}</code>`)
          if (ces.length > 5) listed.push(`…and ${ces.length - 5} more`)
          return `<tr valign="top">
          <td>${esc(t.tablet)}</td><td>${t.version || '?'}</td><td>${listed.join('<br>')}<br>${ces.length} condition(s), ${t.uploads} upload(s)</td>
        </tr>`
        }).join('')
        const section = (s) => `
                <p style="background-color:#1a313d;color:#fff;padding:8px 12px"><b>SITE</b>: ${esc(s.name)}</p>
                <p><b>FAULTY CONDITIONS</b>: ${s.toFix.length} (${s.high} high impact)${s.behind.size ? `&nbsp;&nbsp; <b>TABLETS BEHIND</b>: ${s.behind.size}` : ''}</p>
                ${located && !s.scoped ? '<p><i>The web editor does not know this site, so all scripts were searched.</i></p>' : ''}
                ${s.toFix.length ? `<table ${table}><tr ${headRow}><th>Impact</th><th>Where</th><th>Condition</th><th>Seen</th></tr>${faultRows(s)}</table>` : ''}
                ${s.behind.size ? `<p><b>TABLETS RUNNING CONDITIONS NO LONGER IN THIS SITE'S SCRIPTS</b></p>
                <table ${table}><tr ${headRow}><th>Tablet</th><th>Data version</th><th>Conditions no longer in the site's scripts</th></tr>${tabletRows(s)}</table>` : ''}`

        const server = process.env.NEOTREE_SERVER_TYPE || 'unknown'
        const countries = [...new Set(results.rows.map((row) => row.country).filter(Boolean))]
          .map((c) => ({ zw: 'ZIMBABWE', mw: 'MALAWI' }[c] || c.toUpperCase())).join(', ')
        const faulty = sections.reduce((n, s) => n + s.toFix.length, 0)
        const high = sections.reduce((n, s) => n + s.high, 0)
        const behind = sections.reduce((n, s) => n + s.behind.size, 0)

        sendEmail.raw({
          to: process.env.CE_DIGEST_RECEIVERS || process.env.MAIL_RECEIVERS,
          subject: `NEOTREE CE DIGEST (${server}): ${faulty} faulty condition(s), ${high} high impact, ${sections.length} site(s)${behind ? `, ${behind} tablet(s) behind` : ''}`,
          html: mailLayout('NEOTREE CE DIGEST', `
                <p><b>SERVER</b>: ${esc(server)}</p>
                <p><b>COUNTRY</b>: ${esc(countries || 'UNKNOWN')}</p>
                <p><b>SITES</b>: ${sections.length}</p>
                <p><b>FAULTY CONDITIONS</b>: ${faulty} (${high} high impact)</p>
                ${behind ? `<p><b>TABLETS BEHIND</b>: ${behind}</p>` : ''}
                <p>Conditions that failed to evaluate on tablets since the last digest, by site; each site's conditions are looked up in
                  that site's scripts. A failing condition never crashes the app: the tablet treats it as false, with the effect shown.
                  Uploads count tablet syncs that reported it, not occurrences.</p>
                ${behind ? `<p>Tablets behind ran conditions that their site's scripts no longer have: they were fixed, changed or removed
                  after the tablets last downloaded. Check each one; the tablets pick up the current scripts at their next download, after
                  the next publish or a forced sync. Current data version: ${esc((located && located.dataVersion) ?? '?')}. A tablet's data
                  version is the newest seen in its reports, so it may already be newer.</p>` : ''}
                ${sections.map(section).join('')}`),
        }, (e) => {
          if (e) return console.error('CE digest email failed', e.message)
          // Mark exactly the rows reported; anything that arrived meanwhile waits for the next digest.
          pool.query(
            'UPDATE public.neotree_exception SET sent = true WHERE id = ANY($1)',
            [sections.flatMap((s) => s.items.flatMap((item) => item.ids))],
            (err) => err && console.error('CE digest mark-sent failed', err.message)
          )
        })
      } catch (e) {
        console.error('CE digest failed', e.message)
      }
    }
  )
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
  sendEmails,
  sendCeDigest
});
