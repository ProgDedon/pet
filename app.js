const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const db = require('./config/db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride('_method'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'onlinepet-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
  })
);

app.use(async (req, res, next) => {
  res.locals.cartCount = req.session.cart
    ? Object.values(req.session.cart).reduce((sum, item) => sum + item.quantity, 0)
    : 0;
  res.locals.admin = req.session.admin || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function setFlash(req, message, type = 'success') {
  req.session.flash = { message, type };
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    setFlash(req, 'Admin login required', 'danger');
    return res.redirect('/auth/login');
  }
  next();
}

async function ensureAdmin() {
  const [rows] = await db.query('SELECT COUNT(*) AS count FROM admins');
  if (rows[0].count === 0) {
    const passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'PetStore123!', 10);
    await db.query(
      'INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)',
      ['Store Admin', process.env.ADMIN_EMAIL || 'admin@onlinepet.local', passwordHash]
    );
    console.log('Seeded default admin account:', process.env.ADMIN_EMAIL || 'admin@onlinepet.local');
  }
}

async function loadPetTypes() {
  const [types] = await db.query('SELECT DISTINCT type FROM pets ORDER BY type');
  return types.map((row) => row.type);
}

app.get('/', async (req, res) => {
  const [pets] = await db.query('SELECT * FROM pets ORDER BY id DESC LIMIT 6');
  const types = await loadPetTypes();
  res.render('index', { pets, types });
});

app.get('/pets', async (req, res) => {
  const { type, q } = req.query;
  const types = await loadPetTypes();
  let query = 'SELECT * FROM pets';
  const params = [];
  const clauses = [];

  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  if (q) {
    clauses.push('(name LIKE ? OR breed LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (clauses.length) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY name';

  const [pets] = await db.query(query, params);
  res.render('pets', { pets, types, selectedType: type || 'all', search: q || '' });
});

app.get('/pets/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM pets WHERE id = ?', [req.params.id]);
  const pet = rows[0];
  if (!pet) {
    return res.status(404).send('Pet not found');
  }
  res.render('pet-details', { pet });
});

app.post('/cart/add', async (req, res) => {
  const { petId, quantity } = req.body;
  const [rows] = await db.query('SELECT id, name, price, image_url FROM pets WHERE id = ?', [petId]);
  const pet = rows[0];
  if (!pet) {
    setFlash(req, 'Unable to add item to cart', 'danger');
    return res.redirect('/pets');
  }

  req.session.cart = req.session.cart || {};
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  if (req.session.cart[pet.id]) {
    req.session.cart[pet.id].quantity += qty;
  } else {
    req.session.cart[pet.id] = {
      id: pet.id,
      name: pet.name,
      breed: pet.breed,
      type: pet.type,
      price: pet.price,
      image_url: pet.image_url,
      quantity: qty
    };
  }

  setFlash(req, `${pet.name} added to cart`, 'success');
  res.redirect('/cart');
});

app.get('/cart', (req, res) => {
  const cart = req.session.cart || {};
  res.render('cart', { cart });
});

app.post('/cart/remove', (req, res) => {
  const { petId } = req.body;
  if (req.session.cart && req.session.cart[petId]) {
    delete req.session.cart[petId];
  }
  setFlash(req, 'Item removed from cart', 'info');
  res.redirect('/cart');
});

app.get('/checkout', (req, res) => {
  const cart = req.session.cart || {};
  const items = Object.values(cart);
  if (!items.length) {
    setFlash(req, 'Your cart is empty', 'warning');
    return res.redirect('/pets');
  }
  res.render('checkout', { cart });
});

app.post('/checkout', async (req, res) => {
  const cart = req.session.cart || {};
  const items = Object.values(cart);
  if (!items.length) {
    setFlash(req, 'Your cart is empty', 'warning');
    return res.redirect('/pets');
  }

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const [orderResult] = await db.query(
    'INSERT INTO orders (customer_name, customer_email, total_amount, status, created_at) VALUES (?, ?, ?, ?, NOW())',
    [req.body.name || 'Guest Shopper', req.body.email || 'guest@onlinepet.com', total, 'Pending']
  );
  const orderId = orderResult.insertId;

  const orderItems = items.map((item) => [orderId, item.id, item.quantity, item.price]);
  await db.query('INSERT INTO order_items (order_id, pet_id, quantity, unit_price) VALUES ?', [orderItems]);

  req.session.cart = {};
  setFlash(req, 'Thank you! Your order has been placed.', 'success');
  res.redirect('/');
});

app.get('/auth/login', (req, res) => {
  res.render('auth/login');
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
  const admin = rows[0];
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    setFlash(req, 'Invalid credentials', 'danger');
    return res.redirect('/auth/login');
  }

  req.session.admin = { id: admin.id, name: admin.name, email: admin.email };
  res.redirect('/admin');
});

app.get('/auth/logout', (req, res) => {
  req.session.admin = null;
  setFlash(req, 'Logged out successfully', 'success');
  res.redirect('/');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const [[{ totalPets }]] = await db.query('SELECT COUNT(*) AS totalPets FROM pets');
  const [[{ totalOrders }]] = await db.query('SELECT COUNT(*) AS totalOrders FROM orders');
  const [[{ totalRevenue }]] = await db.query('SELECT IFNULL(SUM(total_amount), 0) AS totalRevenue FROM orders');
  const [recentOrders] = await db.query('SELECT id, customer_name, total_amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5');

  res.render('admin/dashboard', {
    totalPets,
    totalOrders,
    totalRevenue,
    recentOrders
  });
});

app.get('/admin/pets', requireAdmin, async (req, res) => {
  const [pets] = await db.query('SELECT * FROM pets ORDER BY name');
  res.render('admin/pets', { pets });
});

app.get('/admin/pets/new', requireAdmin, async (req, res) => {
  res.render('admin/add-pet');
});

app.post('/admin/pets/new', requireAdmin, async (req, res) => {
  const { name, breed, type, age, price, description, image_url } = req.body;
  await db.query(
    'INSERT INTO pets (name, breed, type, age, price, description, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
    [name, breed, type, age, price, description, image_url]
  );
  setFlash(req, 'New pet added', 'success');
  res.redirect('/admin/pets');
});

app.get('/admin/pets/:id/edit', requireAdmin, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM pets WHERE id = ?', [req.params.id]);
  const pet = rows[0];
  if (!pet) return res.redirect('/admin/pets');
  res.render('admin/edit-pet', { pet });
});

app.post('/admin/pets/:id/edit', requireAdmin, async (req, res) => {
  const { name, breed, type, age, price, description, image_url } = req.body;
  await db.query(
    'UPDATE pets SET name = ?, breed = ?, type = ?, age = ?, price = ?, description = ?, image_url = ? WHERE id = ?',
    [name, breed, type, age, price, description, image_url, req.params.id]
  );
  setFlash(req, 'Pet updated successfully', 'success');
  res.redirect('/admin/pets');
});

app.post('/admin/pets/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM pets WHERE id = ?', [req.params.id]);
  setFlash(req, 'Pet removed from inventory', 'info');
  res.redirect('/admin/pets');
});

app.get('/admin/orders', requireAdmin, async (req, res) => {
  const [orders] = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
  const [items] = await db.query(
    'SELECT oi.*, p.name AS pet_name FROM order_items oi JOIN pets p ON oi.pet_id = p.id'
  );
  const ordersById = orders.map((order) => ({
    ...order,
    items: items.filter((item) => item.order_id === order.id)
  }));
  res.render('admin/orders', { orders: ordersById });
});

app.use((req, res) => {
  res.status(404).render('404', { path: req.path });
});

async function startServer() {
  try {
    // Test database connection
    await db.query('SELECT 1');
    console.log('✓ Database connected');

    // Ensure admin account exists
    await ensureAdmin();

    // Start server
    app.listen(port, () => {
      console.log(`OnlinePet Store is running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('✗ Failed to start server:');
    console.error('Error:', error.message || error.code || error);
    console.error('Full error:', error);
    process.exit(1);
  }
}

startServer();
