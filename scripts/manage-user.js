#!/usr/bin/env node
// Control Center user management from the command line.
//
//   node scripts/manage-user.js add <username> <password> [admin|user]
//   node scripts/manage-user.js list
//   node scripts/manage-user.js passwd <username> <newPassword>
//   node scripts/manage-user.js delete <username>
//
// Inside the container: docker compose exec control-center node scripts/manage-user.js …

const auth = require('../control-center/lib/auth');

const USAGE = [
  'Usage:',
  '  node scripts/manage-user.js add <username> <password> [admin|user]',
  '  node scripts/manage-user.js list',
  '  node scripts/manage-user.js passwd <username> <newPassword>',
  '  node scripts/manage-user.js delete <username>',
].join('\n');

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);

  switch (cmd) {
    case 'add': {
      if (!a || !b) throw new Error('add: username and password required');
      const user = await auth.createUser(a, b, c);
      console.log(`Created ${user.role} '${user.username}'`);
      break;
    }
    case 'list': {
      const users = auth.listUsers();
      if (!users.length) return console.log('(no users)');
      const width = Math.max(8, ...users.map((u) => u.username.length)) + 2;
      console.log(`${'USERNAME'.padEnd(width)}${'ROLE'.padEnd(8)}${'TAG'.padEnd(6)}CREATED`);
      users.forEach((u) => console.log(`${u.username.padEnd(width)}${u.role.padEnd(8)}${(u.tag || '-').padEnd(6)}${u.createdAt}`));
      break;
    }
    case 'passwd': {
      if (!a || !b) throw new Error('passwd: username and new password required');
      await auth.changePassword(a, b);
      console.log(`Password updated for '${a}'`);
      break;
    }
    case 'delete': {
      if (!a) throw new Error('delete: username required');
      if (!auth.deleteUser(a)) throw new Error(`User '${a}' not found`);
      console.log(`Deleted '${a}'`);
      break;
    }
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 2 : 0;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
