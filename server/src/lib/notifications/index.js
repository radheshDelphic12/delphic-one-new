const { notify } = require('./dispatch');
const recipients = require('./recipients');
const catalog = require('./eventCatalog');

module.exports = {
  notify,
  ...recipients,
  ROLE_EVENT_MATRIX: catalog.ROLE_EVENT_MATRIX,
  NOTIFICATION_TYPES: catalog.NOTIFICATION_TYPES,
  NOTIFICATION_LABELS: catalog.NOTIFICATION_LABELS,
  eventsForRole: catalog.eventsForRole,
  renderNotification: catalog.renderNotification,
};
