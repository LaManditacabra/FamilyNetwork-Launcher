// src/core/auth/store.js
// Guarda y carga la cuenta autenticada en accounts.json (carpeta de datos;
// data/ en dev, app.getPath('userData') empaquetado — ver utils setDataRoot).

const fs = require('fs');
const path = require('path');
const { ensureDir, getDataRoot } = require('../../utils');

function accountsFile() { return path.join(getDataRoot(), 'accounts.json'); }

function saveAccount(account) {
  ensureDir(getDataRoot());
  // Solo guardamos una cuenta por ahora (la última en usar).
  fs.writeFileSync(accountsFile(), JSON.stringify(account, null, 2), 'utf-8');
  return account;
}

function loadAccount() {
  if (!fs.existsSync(accountsFile())) return null;
  try {
    return JSON.parse(fs.readFileSync(accountsFile(), 'utf-8'));
  } catch {
    return null;
  }
}

function clearAccount() {
  if (fs.existsSync(accountsFile())) fs.unlinkSync(accountsFile());
}

module.exports = { saveAccount, loadAccount, clearAccount, accountsFile };
