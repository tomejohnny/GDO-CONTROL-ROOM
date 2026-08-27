// Bus minimale per notificare "i dati sono cambiati" senza creare dipendenze
// circolari fra i moduli tab (che modificano i dati) e main.js (che ridisegna
// tutto). Ogni handler di CRUD chiama loadAll() poi notifyDataChanged().
const listeners = [];

export function onDataChanged(cb) {
  listeners.push(cb);
}

export function notifyDataChanged() {
  listeners.forEach(cb => cb());
}
