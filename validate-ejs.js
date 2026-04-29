const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const glob = require('glob');
const files = glob.sync('views/**/*.ejs');
let failed = false;
for (const file of files) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    ejs.compile(content, { filename: path.resolve(file) });
    console.log('OK', file);
  } catch (err) {
    console.error('ERR', file, err.message);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
