// Prepara la CRM para usarla en tu computadora: revisa Node.js y crea el .env con una contraseña.
// Lo usan iniciar.bat (Windows) e iniciar.sh (Mac/Linux).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 9)) {
  console.error(`\nTu Node.js es ${process.versions.node} y se necesita 22.9 o superior.`);
  console.error('Descarga la versión LTS desde https://nodejs.org, instálala y vuelve a intentar.\n');
  process.exit(1);
}

let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
let password = (env.match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1]?.trim();
if (!password || password === 'cambia-esta-clave') {
  password = randomBytes(4).toString('hex');
  env = /^ADMIN_PASSWORD=/m.test(env)
    ? env.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`)
    : `${env}\nADMIN_PASSWORD=${password}\n`;
  writeFileSync('.env', env);
}
const user = (env.match(/^ADMIN_USER=(.*)$/m) || [])[1]?.trim() || 'admin';
const port = (env.match(/^PORT=(.*)$/m) || [])[1]?.trim() || '3000';

console.log('\n==============================================');
console.log(`  Abre:        http://localhost:${port}`);
console.log(`  Usuario:     ${user}`);
console.log(`  Contraseña:  ${password}`);
console.log('  (puedes cambiarla en el archivo .env)');
console.log('  Para apagar la CRM: cierra esta ventana o Ctrl + C');
console.log('==============================================\n');
