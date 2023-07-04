const { Pool, Client } = require('pg');

const pool = new Pool();

async function dbTransaction(q, data = [], cb) {
	return new Promise((resolve, reject) => {
		pool.query(q, data, (e, rslts) => {
			if (e) {
				reject(e);
			} else {
				resolve(rslts);
			}
			if (cb) cb(e, rslts);
		});
	});
}

const APP_VERSION = 'web';

async function getAuthenticatedUser() {
    const rows = await dbTransaction('select * from web_authenticated_user;');
    const user = rows[0];
    return user?.details ? JSON.parse(user.details) : null;
}

async function setLocation(params) {
	const location = { id: 1, ...params, };
	await dbTransaction(
		`insert or replace into web_location (${Object.keys(location).join(',')}) values (${Object.keys(location).map(() => '?').join(',')});`,
		Object.values(location),
	);
}

async function getLocation() {
    const rows = await dbTransaction('select * from web_location limit 1;', null);
    return rows[0];
} 

const getApplication = () => new Promise<types.Application>((resolve, reject) => {
    (async () => {
        try {
            const getApplicationRslt = await dbTransaction('select * from web_application where id=1;');
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
            const res = await dbTransaction(
                'insert or replace into web_configuration (device_id, data, createdAt, updatedAt) values (?, ?, ?, ?);',
                [device_id, JSON.stringify(data || {}), new Date().toISOString(), new Date().toISOString()]
            );
            resolve(res);
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
  
const getSessions = (options = {}) => new Promise((resolve, reject) => {
    (async () => {
        try {
            const { _order, ..._where } = options || {};

            let order = (_order || [['createdAt', 'DESC']]);
            order = (order.map ? order : [])
                .map((keyVal) => (!keyVal.map ? '' : `${keyVal[0] || ''} ${keyVal[1] || ''}`).trim())
                .filter((clause) => clause)
                .join(',');

            const where = Object.keys(_where).map(key => `${key}=${JSON.stringify(_where[key])}`)
                .join(',');

            let q = 'select * from web_sessions';
            q = where ? `${q} where ${where}` : q;
            q = order ? `${q} order by ${order}` : q;

            const rows = await dbTransaction(`${q};`.trim(), null);
            resolve(rows.map(s => ({ ...s, data: JSON.parse(s.data || '{}') })));
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

const getScriptsFields = () => new Promise((resolve, reject) => {
    (async () => {
        try {
            const scripts = await getScripts();
            const rslts = await Promise.all(scripts.map(script => new Promise((resolve, reject) => {
                (async () => {
                    try {
                        const screens = await getScreens({ script_id: script.script_id });
                        resolve({
                            [script.script_id]: screens.map(screen => {
                                const metadata = { ...screen.data.metadata };
                                const fields = metadata.fields || [];
                                return {
                                    screen_id: screen.screen_id,
                                    script_id: screen.script_id,
                                    screen_type: screen.type,
                                    keys: (() => {
                                        let keys = [];
                                        switch (screen.type) {
                                            case 'form':
                                                keys = fields.map((f) => f.key);
                                                break;
                                            default:
                                                keys.push(metadata.key);
                                        }
                                        return keys.filter((k) => k);
                                    })(),
                                };
                            })
                        });
                    } catch (e) { reject(e); }
                })();
            })));
            resolve(rslts.reduce((acc, s) => ({ ...acc, ...s }), {}));
        } catch (e) { reject(e); }
    })();
});

function webAppMiddleware(app) {
	app.post('/web-app/:deviceId/saveApplication', (req, res) => {
		saveApplication(req.params.deviceId, req.body)
			.then(data => res.json({ data, })).catch(e => res.status(500).json({ error: e.message, }));
	});

	app.post('/web-app/:deviceId/saveConfiguration', (req, res) => {
		saveConfiguration(req.params.deviceId, req.body)
			.then(data => res.json({ data, })).catch(e => res.status(500).json({ error: e.message, }));
	});

	return app;
}

module.exports = {
	webAppMiddleware,
};
