const express = require('express');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const {
  ROOM_TYPES,
  ROOM_IMAGES,
  ALL_AMENITIES,
  ROOM_AMENITIES,
  HOTEL_AMENITIES,
  normalizeAmenities,
  parseAmenities,
} = require('./constants');

auth.seedAdmin();

const app = express();

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  req.user = auth.getUserFromRequest(req);
  next();
});

if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
      }
    });
    next();
  });
}

// ---------- Helpers ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateRange(checkIn, checkOut, { allowPast = false } = {}) {
  if (!isValidDate(checkIn)) throw new HttpError(400, 'Check-in must be a valid date (YYYY-MM-DD).');
  if (!isValidDate(checkOut)) throw new HttpError(400, 'Check-out must be a valid date (YYYY-MM-DD).');
  if (checkOut <= checkIn) throw new HttpError(400, 'Check-out must be after check-in.');
  if (!allowPast && checkIn < today()) throw new HttpError(400, 'Check-in cannot be in the past.');
}

const OVERLAP_SQL = `room_id = @room_id AND check_in < @check_out AND @check_in < check_out`;

function findConflict(roomId, checkIn, checkOut) {
  return db
    .prepare(`SELECT * FROM bookings WHERE ${OVERLAP_SQL} LIMIT 1`)
    .get({ room_id: roomId, check_in: checkIn, check_out: checkOut });
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  return id;
}

function requireUser(req) {
  if (!req.user) throw new HttpError(401, 'Please log in.');
  return req.user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Admin access required.');
  return user;
}

function shapeRoom(r) {
  const { booking_id, guest_name, check_in, check_out, ...rest } = r;
  const room = {
    id: rest.id,
    room_no: rest.room_no,
    type: rest.type,
    price: rest.price,
    image_url: rest.image_url || ROOM_IMAGES[rest.type] || ROOM_IMAGES.Single,
    amenities: parseAmenities(rest.amenities),
  };
  if (booking_id !== undefined) {
    room.status = booking_id ? 'Booked' : 'Available';
    room.current_booking = booking_id
      ? { id: booking_id, guest_name, check_in, check_out }
      : null;
  }
  return room;
}

const wrap = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (e) {
    next(e);
  }
};

// ---------- Auth ----------

app.get('/api/meta', wrap((_req, res) => {
  res.json({
    roomTypes: ROOM_TYPES,
    roomImages: ROOM_IMAGES,
    roomAmenities: ROOM_AMENITIES,
    amenities: ALL_AMENITIES,
    hotelAmenities: HOTEL_AMENITIES,
  });
}));

app.get('/api/auth/me', wrap((req, res) => {
  res.json({ user: req.user });
}));

app.post('/api/auth/register', wrap((req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (name.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
  if (name.length > 80) throw new HttpError(400, 'Name is too long (max 80 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'A valid email is required.');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with that email already exists.');
  }

  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, auth.hashPassword(password), 'guest');
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  auth.setSessionCookie(res, auth.createSession(user.id));
  res.status(201).json({ user });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !auth.verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'Invalid email or password.');
  }
  auth.setSessionCookie(res, auth.createSession(row.id));
  res.json({ user: { id: row.id, name: row.name, email: row.email, role: row.role } });
}));

app.post('/api/auth/logout', wrap((req, res) => {
  auth.destroySession(req);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
}));

// ---------- Rooms ----------

app.get('/api/rooms', wrap((req, res) => {
  const date = req.query.date || today();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date.');

  const rows = db.prepare(`
    SELECT r.*,
           b.id         AS booking_id,
           b.guest_name AS guest_name,
           b.check_in   AS check_in,
           b.check_out  AS check_out
    FROM rooms r
    LEFT JOIN bookings b
      ON b.room_id = r.id AND b.check_in <= @date AND @date < b.check_out
    ORDER BY r.room_no
  `).all({ date });

  res.json(rows.map(shapeRoom));
}));

app.get('/api/rooms/search', wrap((req, res) => {
  const { type, checkIn, checkOut, amenity } = req.query;

  if (type && !ROOM_TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${ROOM_TYPES.join(', ')}.`);
  if ((checkIn && !checkOut) || (!checkIn && checkOut)) {
    throw new HttpError(400, 'Provide both check-in and check-out dates, or neither.');
  }
  if (checkIn) validateRange(checkIn, checkOut);

  const params = {};
  let sql = 'SELECT r.* FROM rooms r WHERE 1=1';
  if (type) {
    sql += ' AND r.type = @type';
    params.type = type;
  }
  if (checkIn) {
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.room_id = r.id AND b.check_in < @check_out AND @check_in < b.check_out
    )`;
    params.check_in = checkIn;
    params.check_out = checkOut;
  }
  sql += ' ORDER BY r.price, r.room_no';

  let rooms = db.prepare(sql).all(params).map(shapeRoom);
  if (amenity) {
    rooms = rooms.filter((r) => r.amenities.includes(amenity));
  }
  res.json(rooms);
}));

app.post('/api/rooms', wrap((req, res) => {
  requireAdmin(req);
  const { room_no, type, price, image_url, amenities } = req.body || {};
  const roomNo = typeof room_no === 'string' ? room_no.trim() : String(room_no ?? '').trim();
  const priceNum = Number(price);

  if (!roomNo) throw new HttpError(400, 'Room number is required.');
  if (roomNo.length > 10) throw new HttpError(400, 'Room number is too long (max 10 characters).');
  if (!ROOM_TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${ROOM_TYPES.join(', ')}.`);
  if (!Number.isFinite(priceNum) || priceNum <= 0) throw new HttpError(400, 'Price must be a number greater than 0.');

  if (db.prepare('SELECT 1 FROM rooms WHERE room_no = ?').get(roomNo)) {
    throw new HttpError(409, `Room ${roomNo} already exists.`);
  }

  const image = typeof image_url === 'string' && image_url.trim() ? image_url.trim() : ROOM_IMAGES[type];
  const am = JSON.stringify(normalizeAmenities(amenities, type));
  const info = db
    .prepare('INSERT INTO rooms (room_no, type, price, image_url, amenities) VALUES (?, ?, ?, ?, ?)')
    .run(roomNo, type, priceNum, image, am);
  res.status(201).json(shapeRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid)));
}));

app.put('/api/rooms/:id', wrap((req, res) => {
  requireAdmin(req);
  const id = parseId(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) throw new HttpError(404, 'Room not found.');

  const type = req.body?.type ?? room.type;
  const price = req.body?.price !== undefined ? Number(req.body.price) : room.price;
  if (!ROOM_TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${ROOM_TYPES.join(', ')}.`);
  if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'Price must be a number greater than 0.');

  const image =
    req.body?.image_url !== undefined
      ? (String(req.body.image_url).trim() || ROOM_IMAGES[type])
      : room.image_url || ROOM_IMAGES[type];
  const am =
    req.body?.amenities !== undefined
      ? JSON.stringify(normalizeAmenities(req.body.amenities, type))
      : room.amenities;

  db.prepare('UPDATE rooms SET type = ?, price = ?, image_url = ?, amenities = ? WHERE id = ?').run(
    type,
    price,
    image,
    am,
    id
  );
  res.json(shapeRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)));
}));

app.delete('/api/rooms/:id', wrap((req, res) => {
  requireAdmin(req);
  const id = parseId(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) throw new HttpError(404, 'Room not found.');

  const active = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE room_id = ? AND check_out > ?').get(id, today());
  if (active.n > 0) {
    throw new HttpError(409, `Room ${room.room_no} has ${active.n} active booking(s). Cancel them first.`);
  }
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  res.json({ message: `Room ${room.room_no} deleted.` });
}));

// ---------- Bookings ----------

app.get('/api/bookings', wrap((req, res) => {
  const user = requireUser(req);
  const params = [];
  let sql = `
    SELECT b.*, r.room_no, r.type, r.price,
           CAST(julianday(b.check_out) - julianday(b.check_in) AS INTEGER) AS nights
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
  `;
  if (user.role !== 'admin') {
    sql += ' WHERE b.user_id = ?';
    params.push(user.id);
  }
  sql += ' ORDER BY b.check_in, r.room_no';

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((b) => ({ ...b, total: b.nights * b.price })));
}));

app.post('/api/bookings', wrap((req, res) => {
  const user = requireUser(req);
  const { room_id, guest_name, check_in, check_out } = req.body || {};
  const roomId = Number(room_id);
  const guest =
    guest_name == null || guest_name === ''
      ? user.name
      : String(guest_name).trim();

  if (!Number.isInteger(roomId) || roomId <= 0) throw new HttpError(400, 'A valid room is required.');
  if (guest.length < 2) throw new HttpError(400, 'Guest name must be at least 2 characters.');
  if (guest.length > 80) throw new HttpError(400, 'Guest name is too long (max 80 characters).');
  validateRange(check_in, check_out);

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) throw new HttpError(404, 'Room not found.');

  const info = db.transaction(() => {
    const conflict = findConflict(roomId, check_in, check_out);
    if (conflict) {
      throw new HttpError(
        409,
        `Room ${room.room_no} is already booked from ${conflict.check_in} to ${conflict.check_out}.`
      );
    }
    return db
      .prepare(
        'INSERT INTO bookings (room_id, guest_name, check_in, check_out, user_id) VALUES (?, ?, ?, ?, ?)'
      )
      .run(roomId, guest, check_in, check_out, user.id);
  });

  res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid));
}));

app.delete('/api/bookings/:id', wrap((req, res) => {
  const user = requireUser(req);
  const id = parseId(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) throw new HttpError(404, `Booking #${id} does not exist.`);
  if (user.role !== 'admin' && booking.user_id !== user.id) {
    throw new HttpError(403, 'You can only cancel your own bookings.');
  }
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  res.json({ message: `Booking #${id} for ${booking.guest_name} cancelled.` });
}));

// ---------- Errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
