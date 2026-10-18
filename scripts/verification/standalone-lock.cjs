const { lstatSync } = require('node:fs');
const path = require('node:path');

// Integrated verification runs browser suites in its separate source copy.
// Standalone suites in the original workspace must respect that workspace's lock.
function canStartStandalone(root) {
  try { lstatSync(path.join(root, '.runtime/verify.lock')); }
  catch (error) { if (error.code === 'ENOENT') return true; }
  console.error('VERIFY_BUSY: wait for the active acceptance to release its verification lock.');
  return false;
}
module.exports = { canStartStandalone };
