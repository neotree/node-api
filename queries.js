const { Pool, Client } = require('pg');

const connectionString = 'postgresql://stage_db_usr:n30Tr33Andr01d!@jsonexports.c6bsc90kw28z.eu-west-2.rds.amazonaws.com:5432/jsonsessions_stage'

const pool = new Pool({
  connectionString: connectionString,
})


const getLatestUploads = (request, response) => {
  pool.query('SELECT tablet, maxdate FROM public."latest_tablet_uploads"', (error, results) => {
    if (error) {
      throw error
    }

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);
    response.status(200).json(results.rows)

  })
}

const getSessionsCount = (request, response) => {
  pool.query('SELECT count, scripttitle FROM public."ScriptCount"', (error, results) => {
    if (error) {
      throw error
    }

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);
    response.status(200).json(results.rows)

  })
}

const getSessions = (request, response) => {
var sort = request.query.sort;
  console.log(sort)
  var queryasc = 'SELECT id, ingested_at, data FROM public.sessions ORDER BY id ASC;'
  var querydesc = 'SELECT id, ingested_at, data FROM public.sessions ORDER BY id DESC;'
  var query = 'SELECT id, ingested_at, data FROM public.sessions;'
  if (sort == "asc")
  {
    query = queryasc;
    console.log("Asc")
  }
  if (sort == "desc")
  {
    query = querydesc;
    console.log("Desc")
  }
  pool.query(query, (error, results) => {
    if (error) {
      throw error
    }

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    //context.succeed(jsonObj);
    response.status(200).json(results.rows)

  })

}

const getSessionByTableId = (request, response) => {
  const id = parseInt(request.params.id)

  pool.query('SELECT id, ingested_at, data FROM public.sessions WHERE id = $1', [id], (error, results) => {
    if (error) {
      throw error
    }

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    //  context.succeed(jsonObj);
    response.status(200).json(results.rows)

  })
}

const getSessionByUID = (request, response) => {
  const uid = request.query.uid
  console.log(uid)
  pool.query('SELECT id, ingested_at, data FROM public.sessions WHERE uid = ($1)', [uid], (error, results) => {
    if (error) {
      throw error
    }

    var jsonString = JSON.stringify(results.rows);
    var jsonObj = JSON.parse(jsonString);

    //  context.succeed(jsonObj);
    response.status(200).json(results.rows)

  })
}

const createSession = (request, response) => {
  var uid = ""
  if (request.query.uid)
  {
    uid = request.query.uid.replace('"', '').replace('"', '');
    console.log(uid)
  }
  var scriptId = ""
  if (request.query.scriptId)
  {
    scriptId = request.query.scriptId.replace('"', '').replace('"', '');
    console.log(scriptId)
  }
  const { ingested_at, data } = request.body
  console.log(JSON.stringify(request.body).length)
  inputLength = JSON.stringify(request.body).length
  var currentDate = new Date()
  if (inputLength > 200)
  {
    pool.query('INSERT INTO public.sessions (ingested_at, data, uid, scriptId) VALUES ($1, $2, $3, $4) RETURNING id', [currentDate, request.body, uid, scriptId], (error, results) => {
      if (error) {
        throw error
      }
    //  console.log(results.rows)
      response.status(201).send(`Session added with ID: ${results.rows[0].id}`)
    })
  }  else {
      response.status(201).send(`Session data too small`)
  }
}

const updateSession = (request, response) => {
  const id = parseInt(request.params.id)
  const { ingested_at, data } = request.body
  var currentDate = new Date()
  pool.query('UPDATE public.sessions SET ingested_at = $1, data = $2 WHERE id = $3', [currentDate, request.body, id], (error, results) => {
      if (error) {
        throw error
      }
      response.status(200).send(`Sessions modified with ID: ${id}`)
    }
  )
}

const deleteSession = (request, response) => {
  const id = parseInt(request.params.id)

  pool.query('DELETE FROM public.sessions WHERE id = $1', [id], (error, results) => {
    if (error) {
      throw error
    }
    response.status(200).send(`Session deleted with ID: ${id}`)

  })
}

module.exports = {
  getLatestUploads,
  getSessionsCount,
  getSessions,
  getSessionByTableId,
  createSession,
  updateSession,
  deleteSession,
}
