let serverType = process.env.NEOTREE_SERVER_TYPE || '';

if (serverType) serverType = `${serverType.toUpperCase()}_`;

const serverConfigFileName = `${serverType}NEOTREE_NODEAPI_CONFIG_FILE`;

module.exports = {
  ...(() => {
    try {
      return require(process.env[serverConfigFileName]);
    } catch (e) {
      return require('./server.config.json');
    }
  })()
};
