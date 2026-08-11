// src/core/auth/store.js
// Guarda y carga la cuenta autenticada en data/accounts.json.
// (data/ está en .gitignore: no se sube al repo.)

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../../utils');

const ACCOUNTS_DIR = path.resolve(__dirname, '..', '..', '..', 'data');
const ACCOUNTS_FILE = path.join(ACCOUNTS_DIR, 'accounts.json');

function saveAccount(account) {
  ensureDir(ACCOUNTS_DIR);
  // Solo guardamos una cuenta por ahora (la última en usar).
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(account, null, 2), 'utf-8');
  return account;
}

function loadAccount() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function clearAccount() {
  if (fs.existsSync(ACCOUNTS_FILE)) fs.unlinkSync(ACCOUNTS_FILE);
}

module.exports = { saveAccount, loadAccount, clearAccount, ACCOUNTS_FILE };
