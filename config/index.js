const config = require('./config.json');

module.exports = {
  ...config,
  ...(() => {
    try {
      return require(process.env.NEOTREE_NODE_API_CONFIG);
    } catch (e) {
      return null
    }
  })()
};
