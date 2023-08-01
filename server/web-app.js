const { Pool, Client } = require('pg');

const pool = new Pool();

async function dbTransaction(q, data = [], cb) {
	return new Promise((resolve, reject) => {
		pool.query(q, data, (e, rslts) => {
			if (e) {
				reject(e);
			} else {
				resolve(rslts ? rslts.rows : []);
			}
			if (cb) cb(e, rslts);
		});
	});
}

const APP_VERSION = 'web';

async function getAuthenticatedUser(device_id) {
    const rows = await dbTransaction('select * from web_authenticated_user where device_id=$1;', [device_id]);
    const user = rows[0];
    return user?.details ? JSON.parse(user.details) : null;
}

async function setLocation(device_id, params) {
	const getLocationRslt = await dbTransaction('select * from web_location where device_id=$1;', [device_id]);
    const _location = getLocationRslt[0];

	const location = { device_id, ...params, };
	const cols = Object.keys(location);

	if (_location) {
		await dbTransaction(
			`update web_location set (${cols.map((c, i) => `"${c}"=${i+1}`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')});`,
			Object.values(location),
		);
	} else {
		await dbTransaction(
			`insert or replace into web_location (${Object.keys(location).join(',')}) values (${Object.keys(location).map((_, i) => `$${i + 1}`).join(',')});`,
			Object.values(location),
		);
	}
}

async function getLocation() {
    const rows = await dbTransaction('select * from web_location limit 1;', null);
    return rows[0];
} 

const getApplication = (device_id) => new Promise<types.Application>((resolve, reject) => {
    (async () => {
        try {
            const getApplicationRslt = await dbTransaction('select * from web_application where device_id=$1;', [device_id]);
            const application = getApplicationRslt[0];
            if (application) application.webeditor_info = JSON.parse(application.webeditor_info || '{}');
            resolve(application);
        } catch (e) { reject(e); }
    })();
});

const getConfigKeys = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { _order, ..._where } = options || {};

            let order = (_order || [['position', 'ASC']]);
            order = (order.map ? order : [])
                .map((keyVal) => (!keyVal.map ? '' : `${keyVal[0] || ''} ${keyVal[1] || ''}`).trim())
                .filter((clause) => clause)
                .join(',');

            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');

            let q = 'select * from web_config_keys';
            q = where ? `${q} where ${where}` : q;
            q = order ? `${q} order by ${order}` : q;

            const rows = await dbTransaction(`${q};`.trim(), null);
            resolve(rows.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })));
        } catch (e) { reject(e); }
    })();
});

const getConfiguration = (options = {}) => new Promise<types.Configuration>((resolve, reject) => {
    (async () => {
        try {
            const { ..._where } = options || {};
            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');
            let q = 'select * from web_configuration';
            q = where ? `${q} where ${where}` : q;

            const configurationRslts = await dbTransaction(`${q} limit 1;`.trim());
            const configuration = {
                data: {},
                ...configurationRslts.map(s => ({ ...s, data: JSON.parse(s.data || '{}') }))[0]
            };
            const configKeys = await getConfigKeys();
            resolve({
                ...configuration,
                data: configKeys.reduce((acc, { data: { configKey } }) => ({
                ...acc,
                [configKey]: acc[configKey] ? true : false,
                }), configuration.data)
            });
        } catch (e) { reject(e); }
    })();
});

const saveConfiguration = (device_id, data = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
			const getConfigurationRslt = await dbTransaction(`select * from public.web_configuration where device_id=$1;`, [device_id]);
            const _configuration = (getConfigurationRslt || [])[0];

			if (_configuration) {
				const res = await dbTransaction(
					'update public.web_configuration set data=$1, "updatedAt"=$2 where device_id=$3;',
					[JSON.stringify(data || {}), new Date().toISOString(), device_id]
				);
				resolve(res);
			} else {
				const res = await dbTransaction(
					'insert into public.web_configuration (device_id, data, "createdAt", "updatedAt") values ($1, $2, $3, $4);',
					[device_id, JSON.stringify(data || {}), new Date().toISOString(), new Date().toISOString()]
				);
				resolve(res);
			}
        } catch (e) { reject(e); }
    })();
});

const getScript = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { ..._where } = options || {};
            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');
            let q = 'select * from web_scripts';
            q = where ? `${q} where ${where}` : q;

            const res = await dbTransaction(`${q} limit 1;`.trim());
            const script = res.map(s => ({ ...s, data: JSON.parse(s.data || '{}') }))[0];
            let screens = [];
            let diagnoses = [];

            if (script) {
                const _screens = await dbTransaction(`select * from web_screens where script_id='${script.script_id}' order by position asc;`);
                const _diagnoses = await dbTransaction(`select * from web_diagnoses where script_id='${script.script_id}' order by position asc;`);
                screens = _screens
                    .map(s => ({ ...s, data: JSON.parse(s.data || '{}') }))
                    .map(s => ({
                        ...s,
                        data: {
                            ...s.data,
                            metadata: {
                                ...s.data?.metadata,
                                fields: s.data?.metadata?.fields || [],
                                items: s.data?.metadata?.items || [],
                            },
                        },
                    }));
                diagnoses = _diagnoses.map(s => ({ ...s, data: JSON.parse(s.data || '{}') }));
            }

            resolve({ script, screens, diagnoses, });
        } catch (e) { reject(e); }
    })();
});

const getScripts = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { _order, ..._where } = options || {};

            let order = (_order || [['position', 'ASC']]);
            order = (order.map ? order : [])
                .map((keyVal) => (!keyVal.map ? '' : `${keyVal[0] || ''} ${keyVal[1] || ''}`).trim())
                .filter((clause) => clause)
                .join(',');

            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');

            let q = 'select * from web_scripts';
            q = where ? `${q} where ${where}` : q;
            q = order ? `${q} order by ${order}` : q;

            const rows = await dbTransaction(`${q};`.trim());
            resolve(rows.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })));
        } catch (e) { reject(e); }
    })();
});

const getScreens = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { _order, ..._where } = options || {};

            let order = (_order || [['position', 'ASC']]);
            order = (order.map ? order : [])
                .map((keyVal) => (!keyVal.map ? '' : `${keyVal[0] || ''} ${keyVal[1] || ''}`).trim())
                .filter((clause) => clause)
                .join(',');

            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');

            let q = 'select * from web_screens';
            q = where ? `${q} where ${where}` : q;
            q = order ? `${q} order by ${order}` : q;

            const rows = await dbTransaction(`${q};`.trim(), null);
            resolve(rows.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })));
        } catch (e) { reject(e); }
    })();
});

const getDiagnoses = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { _order, ..._where } = options || {};

            let order = (_order || [['position', 'ASC']]);
            order = (order.map ? order : [])
                .map((keyVal) => (!keyVal.map ? '' : `${keyVal[0] || ''} ${keyVal[1] || ''}`).trim())
                .filter((clause) => clause)
                .join(',');

            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');

            let q = 'select * from web_diagnoses';
            q = where ? `${q} where ${where}` : q;
            q = order ? `${q} order by ${order}` : q;

            const rows = await dbTransaction(`${q};`.trim(), null);
            resolve(rows.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })));
        } catch (e) { reject(e); }
    })();
});

const countSessions = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { ..._where } = options || {};
            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');
            let q = 'select count(id) from web_sessions';
            q = where ? `${q} where ${where}` : q;

            const res = await dbTransaction(`${q};`.trim());
            resolve(res ? res[0] : 0);
        } catch (e) { reject(e); }
    })();
});
  
const getSession = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { ..._where } = options || {};
            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');
            let q = 'select * from web_sessions';
            q = where ? `${q} where ${where}` : q;

            const res = await dbTransaction(`${q} limit 1;`.trim());
            resolve(res.map(s => ({ ...s, data: JSON.parse(s.data || '{}') }))[0]);
        } catch (e) { reject(e); }
    })();
});
  
const getSessions = (device_id, options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            let { _order, ..._where } = options || {};

			_where = { ..._where, device_id, };
			if (_where.exported !== undefined) _where.exported = (_where.exported === 'true') || (_where.exported === '1');

            let order = (_order || [['createdAt', 'DESC']]);
            order = (order.map ? order : [])
                .map((keyVal) => (!keyVal.map ? '' : `${JSON.stringify(keyVal[0] || '')} ${keyVal[1] || ''}`).trim())
                .filter((clause) => clause)
                .join(',');

            const where = Object.keys(_where).map((key, i) => `${JSON.stringify(key)}=$${i + 1}`)
                .join('and ');

            let q = 'select * from web_sessions';
            q = where ? `${q} where ${where}` : q;
            q = order ? `${q} order by ${order}` : q;

            const rows = await dbTransaction(`${q};`.trim(), Object.values(_where));
            resolve(rows.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })));
        } catch (e) { reject(e); }
    })();
});

const saveSession = (device_id, params = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
			const s = { device_id, ...params, };
			if (s.id) {
				const res = await dbTransaction(
					`update web_sessions set (${Object.keys(s).map((key, i) => `${JSON.stringify(key)}=${i + 1}`).join(',')}) where device_id="${device_id}";`,
					Object.values(s),
				);
				resolve(res[0]);
			} else {
				const res = await dbTransaction(
					`insert into web_sessions (${Object.keys(s).map(key => JSON.stringify(key)).join(',')}) values (${Object.keys(s).map((_, i) => `$${i + 1}`).join(',')}) returning *;`,
					Object.values(s),
				);
				resolve(res[0]);
			}
        } catch (e) { reject(e); }
    })();
});

const deleteSessions = (ids = []) => new Promise((resolve, reject) => {
    (async () => {
        try {
            ids = ids || [];
            if (!ids.map) ids = [ids];

            const res = await dbTransaction(`delete from web_sessions where id in (${ids.join(',')})`);
            resolve(res);
        } catch (e) { reject(e); }
    })();
});

const saveApplication = (device_id, params = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const getApplicationRslt = await dbTransaction(`select * from web_application where device_id='${device_id}';`);
            const _application = getApplicationRslt[0];

            let application = {
				device_id,
                ..._application,
                ...params,
                version: _application.version || APP_VERSION,
                updatedAt: new Date().toISOString(),
            };

            await dbTransaction(
                `insert or replace into web_application (${Object.keys(application).join(',')}) values (${Object.keys(application).map(() => '?').join(',')});`,
                Object.values(application)
            );
            application = await getApplication();
            resolve(application);
        } catch (e) { reject(e); }
    })();
});

function webAppMiddleware(app) {
	app.post('/web-app/:deviceId/saveApplication', (req, res) => {
		saveApplication(req.params.deviceId, req.body)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	app.post('/web-app/:deviceId/saveConfiguration', (req, res) => {
		saveConfiguration(req.params.deviceId, req.body)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	app.get('/web-app/:deviceId/countSessions', (req, res) => {
		countSessions(req.params.deviceId, req.query)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	app.get('/web-app/:deviceId/getSession', (req, res) => {
		getSession(req.params.deviceId, req.query)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	app.get('/web-app/:deviceId/getSessions', (req, res) => {
		getSessions(req.params.deviceId, req.query)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	app.post('/web-app/:deviceId/deleteSessions', (req, res) => {
		deleteSessions(req.params.deviceId, req.body)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	app.post('/web-app/:deviceId/saveSession', (req, res) => {
		saveSession(req.params.deviceId, req.body)
			.then(data => res.json({ data, }))
			.catch(e => res.status(500).json({ error: e.message, }));
	});

	return app;
}

module.exports = {
	webAppMiddleware,
};
