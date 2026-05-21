// ── Auth (jsonbin-backed) and bookings (localStorage) ──────────────
//
// Users are stored in a private jsonbin bin via window.UsersStore (see
// js/dataStore.js). Passwords are SHA-256 hashed with a per-user salt.
// Bookings remain client-side only for now (per-browser localStorage).

let currentUser = null;
let token = localStorage.getItem('token');

const ADMIN_USERNAME = 'deb';

const DB = {
  bookings: JSON.parse(localStorage.getItem('bookings') || '[]'),
  saveBookings() {
    localStorage.setItem('bookings', JSON.stringify(this.bookings));
  }
};

// ── Bootstrap on load ──
(function init() {
  if (!token) { updateAuthUI(); return; }
  const storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  if (storedUser) {
    currentUser = storedUser;
  } else {
    localStorage.removeItem('token');
    token = null;
  }
  updateAuthUI();
})();

// ── Validation helpers ──
function validatePassword(password) {
  if (!password || password.length < 5) {
    return 'Password must be at least 5 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include at least one letter and one digit.';
  }
  return null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAdmin(user) {
  if (!user) user = currentUser;
  return !!user && (user.username === ADMIN_USERNAME || user.role === 'admin');
}

// ── UI: show/hide nav items based on auth & role ──
function updateAuthUI() {
  const authLink = document.getElementById('authLink');
  const signUpNavLink = document.getElementById('signUpNavLink');
  const dashboardNavItem = findDashboardNavItem();

  // Login / username pill
  if (authLink) {
    if (currentUser) {
      authLink.innerHTML = '<i class="fas fa-user"></i> ' + currentUser.username;
      authLink.onclick = openProfile;
    } else {
      authLink.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
      authLink.onclick = openLogin;
    }
  }

  // Hide Sign Up while logged in
  if (signUpNavLink) {
    const li = signUpNavLink.closest('li') || signUpNavLink;
    li.style.display = currentUser ? 'none' : '';
  }

  // Dashboard tab — admin (deb) only
  if (dashboardNavItem) {
    dashboardNavItem.style.display = isAdmin() ? '' : 'none';
  }
}

function findDashboardNavItem() {
  // Find the <li> containing the Dashboard link in the navbar.
  const links = document.querySelectorAll('a[href$="dashboard.html"]');
  for (const a of links) {
    const li = a.closest('li');
    if (li) return li;
    return a; // fallback to the link itself
  }
  return null;
}

// ── Login ──
async function login(identifier, password) {
  if (!identifier || !password) {
    throw new Error('Please enter your username/email and password.');
  }
  if (!window.UsersStore) {
    throw new Error('Auth store not loaded — please refresh the page.');
  }
  const user = await window.UsersStore.login(identifier.trim(), password);
  token = 'token_' + Date.now();
  currentUser = {
    id: user.id, username: user.username, email: user.email,
    role: user.role || 'user'
  };
  localStorage.setItem('token', token);
  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  updateAuthUI();
  closeLogin();
  alert('✅ Login successful! Welcome, ' + currentUser.username + '.');
  return { token, user: currentUser };
}

// ── Register ──
async function register(username, email, password) {
  username = (username || '').trim();
  email    = (email || '').trim();

  if (!username || !email || !password) {
    throw new Error('All fields are required.');
  }
  if (username.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const pwErr = validatePassword(password);
  if (pwErr) throw new Error(pwErr);

  if (!window.UsersStore) {
    throw new Error('Auth store not loaded — please refresh the page.');
  }

  await window.UsersStore.register({ username, email, password });
  alert('✅ Registration successful! Please login with your new account.');
  closeRegister();
  openLogin();
  // Pre-fill the login email with whatever they registered with
  const loginEmailEl = document.getElementById('loginEmail');
  if (loginEmailEl) loginEmailEl.value = email;
}

// ── Logout ──
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  token = null;
  currentUser = null;
  updateAuthUI();
  closeProfile();
}

// ── Bookings (localStorage only — per-browser) ──
async function loadBookings() {
  if (!currentUser) return [];
  return DB.bookings.filter(b => b.userId === currentUser.id);
}

async function createBooking(bookingData) {
  if (!currentUser) throw new Error('Login required');
  const booking = {
    id: Date.now(),
    userId: currentUser.id,
    ...bookingData,
    createdAt: new Date().toISOString()
  };
  DB.bookings.push(booking);
  DB.saveBookings();
  return booking;
}

async function updateBooking(id, updates) {
  const booking = DB.bookings.find(b => b.id === id && b.userId === currentUser.id);
  if (!booking) throw new Error('Booking not found');
  Object.assign(booking, updates);
  DB.saveBookings();
  return booking;
}

async function cancelBooking(id) {
  const booking = DB.bookings.find(b => b.id === id && b.userId === currentUser.id);
  if (!booking) throw new Error('Booking not found');
  booking.status = 'cancelled';
  DB.saveBookings();
  alert('✅ Booking cancelled successfully');
  loadProfileContent();
}

// ── Modal helpers ──
function openLogin() { document.getElementById('loginModal').style.display = 'block'; }
function closeLogin() { document.getElementById('loginModal').style.display = 'none'; }
function openRegister() { document.getElementById('registerModal').style.display = 'block'; }
function closeRegister() { document.getElementById('registerModal').style.display = 'none'; }
function openProfile() {
  document.getElementById('profileModal').style.display = 'block';
  loadProfileContent();
}
function closeProfile() { document.getElementById('profileModal').style.display = 'none'; }

async function loadProfileContent() {
  if (!currentUser) return;
  const usernameEl = document.getElementById('profileUsername');
  if (usernameEl) usernameEl.textContent = currentUser.username;
  const bookingsList = document.getElementById('bookingsList');
  if (!bookingsList) return;
  try {
    const bookings = await loadBookings();
    bookingsList.innerHTML = bookings.length
      ? bookings.map(b => `
        <div class="booking-item">
          <h4>${b.package_name || 'Package'}</h4>
          <p>Duration: ${b.duration || 'N/A'} | Price: ₹${Number(b.price || 0).toLocaleString()} | Status: <span class="${b.status || 'confirmed'}">${(b.status || 'confirmed').toUpperCase()}</span></p>
          <p>Guests: ${b.guests || 'N/A'}</p>
          ${b.status !== 'cancelled' ? `<button onclick="cancelBooking(${b.id})">Cancel</button>` : ''}
        </div>
      `).join('')
      : '<p>No bookings yet. <a href="#packages">Book now!</a></p>';
  } catch (err) {
    bookingsList.innerHTML = '<p>Error loading bookings.</p>';
  }
}

// ── Expose globals (used by inline handlers / other scripts) ──
window.login = login;
window.register = register;
window.logout = logout;
window.loadProfileContent = loadProfileContent;
window.openRegister = openRegister;
window.closeRegister = closeRegister;
window.openLogin = openLogin;
window.closeLogin = closeLogin;
window.openProfile = openProfile;
window.closeProfile = closeProfile;
window.createBooking = createBooking;
window.cancelBooking = async (id) => {
  if (confirm('Cancel this booking?')) {
    await cancelBooking(id);
    loadProfileContent();
  }
};
window.isAdmin = isAdmin;