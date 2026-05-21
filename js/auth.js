// ── Auth shim layer ─────────────────────────────────────────────
// Thin wrappers around window.UsersStore (defined in js/dataStore.js).
// Exists to keep the old global API (login/register/logout/etc.) used
// by index.html / package.html / dashboard.html unchanged while the
// real work happens against Firebase Auth + Firestore.

let currentUser = null;
const ADMIN_USERNAME = 'deb';
const ADMIN_EMAIL    = window.ADMIN_EMAIL || 'deb@andamanvoyages.in';

const DB = {
  bookings: JSON.parse(localStorage.getItem('bookings') || '[]'),
  saveBookings() {
    localStorage.setItem('bookings', JSON.stringify(this.bookings));
  }
};

// Pull any cached profile so the UI renders correctly during the
// brief async Firebase boot.
try {
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch (_) { currentUser = null; }

// ── Validation ──
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
  if (!user) return false;
  return user.email === ADMIN_EMAIL || user.role === 'admin' || user.username === ADMIN_USERNAME;
}

// ── UI: show/hide nav based on auth & role ──
function findDashboardNavItem() {
  const links = document.querySelectorAll('a[href$="dashboard.html"]');
  for (const a of links) {
    return a.closest('li') || a;
  }
  return null;
}

function updateAuthUI() {
  const authLink = document.getElementById('authLink');
  const signUpNavLink = document.getElementById('signUpNavLink');
  const dashboardNavItem = findDashboardNavItem();

  if (authLink) {
    if (currentUser) {
      authLink.innerHTML = '<i class="fas fa-user"></i> ' + currentUser.username;
      authLink.onclick = openProfile;
    } else {
      authLink.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
      authLink.onclick = openLogin;
    }
  }

  if (signUpNavLink) {
    const li = signUpNavLink.closest('li') || signUpNavLink;
    li.style.display = currentUser ? 'none' : '';
  }

  if (dashboardNavItem) {
    dashboardNavItem.style.display = isAdmin() ? '' : 'none';
  }
}

// Subscribe to Firebase auth-state changes once UsersStore is available.
(function subscribeAuth() {
  if (window.UsersStore && typeof window.UsersStore.onAuthChange === 'function') {
    window.UsersStore.onAuthChange(profile => {
      currentUser = profile || null;
      updateAuthUI();
    });
  } else {
    // dataStore.js may load just after this file — retry shortly.
    setTimeout(subscribeAuth, 100);
  }
})();

// Render whatever we have right away (instant cached pill before Firebase boots)
updateAuthUI();

// ── Login (identifier may be username OR email) ──
async function login(identifier, password) {
  if (!identifier || !password) {
    throw new Error('Please enter your username/email and password.');
  }
  if (!window.UsersStore) {
    throw new Error('Auth system not loaded — please refresh the page.');
  }
  const profile = await window.UsersStore.login(identifier.trim(), password);
  currentUser = profile;
  updateAuthUI();
  closeLogin();
  alert('✅ Login successful! Welcome, ' + profile.username + '.');
  return { user: profile };
}

// ── Register ──
async function register(username, email, password) {
  username = (username || '').trim();
  email    = (email || '').trim();

  if (!username || !email || !password) throw new Error('All fields are required.');
  if (username.length < 3) throw new Error('Username must be at least 3 characters long.');
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  const pwErr = validatePassword(password);
  if (pwErr) throw new Error(pwErr);

  if (!window.UsersStore) throw new Error('Auth system not loaded — please refresh the page.');

  await window.UsersStore.register({ username, email, password });
  alert('✅ Registration successful! Please login with your new account.');
  closeRegister();
  openLogin();

  const loginEmailEl = document.getElementById('loginEmail');
  if (loginEmailEl) loginEmailEl.value = email;
}

// ── Logout ──
async function logout() {
  try {
    if (window.UsersStore) await window.UsersStore.logout();
  } catch (_) {}
  currentUser = null;
  updateAuthUI();
  closeProfile();
}

// ── Bookings (still localStorage; per-browser) ──
async function loadBookings() {
  if (!currentUser) return [];
  return DB.bookings.filter(b => b.userId === currentUser.id || b.userId === currentUser.uid);
}

async function createBooking(bookingData) {
  if (!currentUser) throw new Error('Login required');
  const booking = {
    id: Date.now(),
    userId: currentUser.id || currentUser.uid,
    ...bookingData,
    createdAt: new Date().toISOString()
  };
  DB.bookings.push(booking);
  DB.saveBookings();
  return booking;
}

async function updateBooking(id, updates) {
  const booking = DB.bookings.find(b => b.id === id);
  if (!booking) throw new Error('Booking not found');
  Object.assign(booking, updates);
  DB.saveBookings();
  return booking;
}

async function cancelBooking(id) {
  const booking = DB.bookings.find(b => b.id === id);
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

// ── Globals (used by inline handlers and other scripts) ──
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