const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// Инициализация базы данных
const dbPath = path.join(app.getPath('userData'), 'ri_database.db');
const db = new Database(dbPath);

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    docType TEXT NOT NULL,
    number TEXT,
    status TEXT DEFAULT 'Проект',
    stage TEXT DEFAULT 'Разработка',
    risk TEXT DEFAULT 'Средний',
    developer TEXT,
    regBody TEXT,
    controlDate TEXT,
    forecastDate TEXT,
    effectiveDate TEXT,
    summary TEXT,
    products TEXT DEFAULT '[]',
    links TEXT DEFAULT '[]',
    notes TEXT DEFAULT '[]',
    history TEXT DEFAULT '[]',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS actives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    docType TEXT NOT NULL,
    number TEXT,
    status TEXT DEFAULT 'Принятый',
    developer TEXT,
    regBody TEXT,
    effectiveDate TEXT,
    summary TEXT,
    products TEXT DEFAULT '[]',
    links TEXT DEFAULT '[]',
    notes TEXT DEFAULT '[]',
    history TEXT DEFAULT '[]',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL,
    itemType TEXT NOT NULL,
    changeType TEXT NOT NULL,
    description TEXT NOT NULL,
    changeDate TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Добавление продуктов по умолчанию
const defaultProducts = [
  { name: 'Фармацевтика', color: '#ef4444' },
  { name: 'Медицина', color: '#f97316' },
  { name: 'БАДы', color: '#eab308' },
  { name: 'Ветеринария', color: '#22c55e' },
  { name: 'Пищевая продукция', color: '#14b8a6' },
  { name: 'Косметика', color: '#3b82f6' },
  { name: 'Парфюмерия', color: '#8b5cf6' },
  { name: 'Бытовая химия', color: '#ec4899' },
  { name: 'Табак', color: '#06b6d4' },
  { name: 'Иная продукция', color: '#64748b' }
];

const stmtInsertProduct = db.prepare('INSERT OR IGNORE INTO products (name, color) VALUES (?, ?)');
for (const p of defaultProducts) {
  stmtInsertProduct.run(p.name, p.color);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('ri_platform.html');
  
  // Открытие DevTools в режиме разработки
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC обработчики для работы с базой данных

// Продукты
ipcMain.handle('get-products', () => {
  const products = db.prepare('SELECT * FROM products').all();
  return products;
});

// Проекты
ipcMain.handle('get-projects', () => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC').all();
  return projects.map(p => ({ ...p, type: 'proj' }));
});

ipcMain.handle('add-project', (event, data) => {
  const { title, docType, number, stage, risk, developer, regBody, controlDate, forecastDate, effectiveDate, summary, products, links } = data;
  const now = new Date().toISOString();
  const history = JSON.stringify([{ date: now, action: 'Создан', user: 'Admin' }]);
  
  const result = db.prepare(`
    INSERT INTO projects (title, docType, number, stage, risk, developer, regBody, controlDate, forecastDate, effectiveDate, summary, products, links, history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, docType, number || '', stage, risk, developer || '', regBody || '', controlDate || '', forecastDate || '', effectiveDate || '', summary || '', JSON.stringify(products || []), JSON.stringify(links || []), history);
  
  // Добавление записи в историю изменений
  db.prepare(`
    INSERT INTO changes (itemId, itemType, changeType, description, changeDate)
    VALUES (?, 'project', 'create', 'Создан новый проект: ${title}', ?)
  `).run(result.lastInsertRowid, forecastDate || now);
  
  return { id: result.lastInsertRowid, ...data };
});

ipcMain.handle('update-project', (event, id, data) => {
  const now = new Date().toISOString();
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'id' && key !== 'type') {
      fields.push(`${key} = ?`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }
  }
  
  if (fields.length > 0) {
    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);
    
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    
    // Обновление истории
    const item = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    const history = JSON.parse(item.history || '[]');
    history.push({ date: now, action: 'Обновлен', user: 'Admin' });
    db.prepare('UPDATE projects SET history = ? WHERE id = ?').run(JSON.stringify(history), id);
  }
  
  return { id, ...data };
});

ipcMain.handle('delete-project', (event, id) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return true;
});

// Принятые акты
ipcMain.handle('get-actives', () => {
  const actives = db.prepare('SELECT * FROM actives ORDER BY updatedAt DESC').all();
  return actives.map(a => ({ ...a, type: 'active' }));
});

ipcMain.handle('add-active', (event, data) => {
  const { title, docType, number, developer, regBody, effectiveDate, summary, products, links } = data;
  const now = new Date().toISOString();
  const history = JSON.stringify([{ date: now, action: 'Создан', user: 'Admin' }]);
  
  const result = db.prepare(`
    INSERT INTO actives (title, docType, number, developer, regBody, effectiveDate, summary, products, links, history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, docType, number || '', developer || '', regBody || '', effectiveDate || '', summary || '', JSON.stringify(products || []), JSON.stringify(links || []), history);
  
  // Добавление записи в историю изменений
  db.prepare(`
    INSERT INTO changes (itemId, itemType, changeType, description, changeDate)
    VALUES (?, 'active', 'create', 'Создан новый принятый акт: ${title}', ?)
  `).run(result.lastInsertRowid, effectiveDate || now);
  
  return { id: result.lastInsertRowid, ...data };
});

ipcMain.handle('update-active', (event, id, data) => {
  const now = new Date().toISOString();
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'id' && key !== 'type') {
      fields.push(`${key} = ?`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }
  }
  
  if (fields.length > 0) {
    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);
    
    db.prepare(`UPDATE actives SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    
    // Обновление истории
    const item = db.prepare('SELECT * FROM actives WHERE id = ?').get(id);
    const history = JSON.parse(item.history || '[]');
    history.push({ date: now, action: 'Обновлен', user: 'Admin' });
    db.prepare('UPDATE actives SET history = ? WHERE id = ?').run(JSON.stringify(history), id);
  }
  
  return { id, ...data };
});

ipcMain.handle('delete-active', (event, id) => {
  db.prepare('DELETE FROM actives WHERE id = ?').run(id);
  return true;
});

// Перемещение проекта в принятые
ipcMain.handle('move-to-active', (event, projectId) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  
  const now = new Date().toISOString();
  
  // Создаем запись в actives
  const result = db.prepare(`
    INSERT INTO actives (title, docType, number, developer, regBody, effectiveDate, summary, products, links, history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.title, 
    project.docType, 
    project.number, 
    project.developer, 
    project.regBody, 
    project.effectiveDate || now, 
    project.summary, 
    project.products, 
    project.links,
    JSON.stringify([...JSON.parse(project.history || '[]'), { date: now, action: 'Перемещен из проектов', user: 'Admin' }])
  );
  
  // Добавляем запись в историю изменений
  db.prepare(`
    INSERT INTO changes (itemId, itemType, changeType, description, changeDate)
    VALUES (?, 'active', 'status_change', 'Проект перемещен в принятые акты: ${project.title}', ?)
  `).run(result.lastInsertRowid, project.effectiveDate || now);
  
  // Удаляем из проектов
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  
  return { id: result.lastInsertRowid, type: 'active' };
});

// История изменений
ipcMain.handle('get-changes', () => {
  const changes = db.prepare(`
    SELECT c.*, p.title as itemTitle, a.title as activeTitle
    FROM changes c
    LEFT JOIN projects p ON c.itemId = p.id AND c.itemType = 'project'
    LEFT JOIN actives a ON c.itemId = a.id AND c.itemType = 'active'
    ORDER BY c.changeDate DESC, c.createdAt DESC
    LIMIT 100
  `).all();
  return changes;
});

// Статистика
ipcMain.handle('get-stats', () => {
  const totalProjects = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
  const totalActives = db.prepare('SELECT COUNT(*) as count FROM actives').get().count;
  const upcomingChanges = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT forecastDate FROM projects WHERE forecastDate >= date('now') AND forecastDate <= date('now', '+30 days')
      UNION ALL
      SELECT effectiveDate FROM actives WHERE effectiveDate >= date('now') AND effectiveDate <= date('now', '+30 days')
    )
  `).get().count;
  const highRisk = db.prepare("SELECT COUNT(*) as count FROM projects WHERE risk = 'Высокий'").get().count;
  
  return { totalProjects, totalActives, upcomingChanges, highRisk };
});

// Поиск
ipcMain.handle('search-items', (event, query) => {
  const searchQuery = `%${query}%`;
  const projects = db.prepare(`
    SELECT *, 'proj' as type FROM projects 
    WHERE title LIKE ? OR number LIKE ? OR developer LIKE ?
  `).all(searchQuery, searchQuery, searchQuery);
  
  const actives = db.prepare(`
    SELECT *, 'active' as type FROM actives 
    WHERE title LIKE ? OR number LIKE ? OR developer LIKE ?
  `).all(searchQuery, searchQuery, searchQuery);
  
  return [...projects, ...actives];
});
