const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const port = 3000
const db = require('./queries')
//AKIAYOAYHBXTHK26S4VJ
//

//Claudia
//AKIAYOAYHBXTDVOFAUHG
//gO5JsL4D49m88otOwkmLZxopIAH2o8eYKnCUG3hb

app.use(bodyParser.json())
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
)
app.get('/', (request, response) => {
  response.json({ info: 'Node.js, Express, and Postgres API' })
})
app.get('/latestuploads', db.getLatestUploads)
app.get('/sessionsCount', db.getSessionsCount)
app.get('/sessions', db.getSessions)
app.get('/sessions/:id', db.getSessionByTableId)
app.get('/session', db.getSessionByUID)
app.post('/sessions', db.createSession)
app.put('/sessions/:id', db.updateSession)
app.delete('/sessions/:id', db.deleteSession)
//getSessionByTableId
