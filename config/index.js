try {
  module.exports = require(process.env.NEOTREE_NODE_API_CONFIG);
} catch (e) {
  module.exports = require('./config.json');
}
