// ── Auth shim layer ─────────────────────────────────────────────
// Thin wrappers around window.UsersStore (defined in js/dataStore.js).
// Exists to keep the old global API (login/register/logout/etc.) used
// by index.html / package.html / dashboard.html unchanged while the
// real work happens against Firebase Auth + Firestore.

let currentUser = null;
const ADMIN_USERNAME = 'deb';
const ADMIN_EMAILS   = (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.length)
  ? window.ADMIN_EMAILS.map(e => String(e).toLowerCase())
  : [String(window.ADMIN_EMAIL || 'deb@andamanvoyages.in').toLowerCase()];
const ADMIN_EMAIL    = ADMIN_EMAILS[0]; // legacy
function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.indexOf(String(email).toLowerCase()) >= 0;
}

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
  return isAdminEmail(user.email) || user.role === 'admin' || user.username === ADMIN_USERNAME;
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
// Accepts either positional args (legacy) or a single object payload.
async function register(...args) {
  let username, email, password, fullName, phone;
  if (args.length === 1 && typeof args[0] === 'object' && args[0]) {
    ({ username, email, password, fullName, phone } = args[0]);
  } else {
    [username, email, password, fullName = '', phone = ''] = args;
  }

  username = (username || '').trim();
  email    = (email || '').trim();
  fullName = (fullName || '').trim();
  phone    = (phone || '').trim();

  // Required fields
  if (!fullName) throw new Error('Full name is required.');
  if (fullName.length < 2) throw new Error('Full name must be at least 2 characters long.');
  if (!username) throw new Error('Username is required.');
  if (username.length < 3) throw new Error('Username must be at least 3 characters long.');
  if (!email) throw new Error('Email is required.');
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  if (!phone) throw new Error('Phone number is required.');
  if (!/^[0-9+()\- ]{8,20}$/.test(phone)) {
    throw new Error('Phone must be 8–20 digits (digits, spaces, dashes, parentheses, and a leading + are allowed).');
  }
  // Require at least 8 actual digits to avoid "+()-"-only inputs
  if ((phone.match(/\d/g) || []).length < 8) {
    throw new Error('Phone number must contain at least 8 digits.');
  }
  if (!password) throw new Error('Password is required.');
  const pwErr = validatePassword(password);
  if (pwErr) throw new Error(pwErr);

  if (!window.UsersStore) throw new Error('Auth system not loaded — please refresh the page.');

  await window.UsersStore.register({ username, email, password, fullName, phone });
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

// ── Forgot username / password modal ────────────────────────────
function openForgot() {
  document.getElementById('forgotModal').style.display = 'block';
  const r = document.getElementById('forgotResult');
  if (r) r.innerHTML = '';
  const e = document.getElementById('forgotEmail');
  if (e) { e.value = ''; e.focus(); }
}
function closeForgot() {
  document.getElementById('forgotModal').style.display = 'none';
}
window.openForgot = openForgot;
window.closeForgot = closeForgot;

document.addEventListener('DOMContentLoaded', () => {
  // "Forgot username or password?" link inside the login modal
  const goToForgot = document.getElementById('goToForgot');
  if (goToForgot) {
    goToForgot.addEventListener('click', e => {
      e.preventDefault();
      closeLogin();
      openForgot();
    });
  }

  // "Back to login" link from the forgot modal
  const goToLoginFromForgot = document.getElementById('goToLoginFromForgot');
  if (goToLoginFromForgot) {
    goToLoginFromForgot.addEventListener('click', e => {
      e.preventDefault();
      closeForgot();
      openLogin();
    });
  }

  // Forgot form: look up username(s) AND send a password-reset email
  const forgotForm = document.getElementById('forgotForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async e => {
      e.preventDefault();
      const emailInput = document.getElementById('forgotEmail');
      const submitBtn  = document.getElementById('forgotSubmitBtn');
      const result     = document.getElementById('forgotResult');
      const email = (emailInput.value || '').trim();
      if (!email) return;

      result.innerHTML = '';
      submitBtn.disabled = true;
      const oldHTML = submitBtn.innerHTML;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Working…';

      let usernameMsg = '';
      try {
        const usernames = await window.UsersStore.lookupUsernamesByEmail(email);
        if (usernames && usernames.length) {
          usernameMsg = `<div style="background:#e8f8f5;border-left:3px solid #1abc9c;padding:0.6rem 0.85rem;border-radius:4px;margin-bottom:0.6rem;color:#0e6655;">
              <strong>Your username:</strong> ${usernames.map(u => `<code>${u}</code>`).join(', ')}
          </div>`;
        } else {
          usernameMsg = `<div style="background:#fef9e7;border-left:3px solid #f1c40f;padding:0.6rem 0.85rem;border-radius:4px;margin-bottom:0.6rem;color:#7d6608;">
              No account found with that email. (We will still attempt the password reset; if the email isn't registered, no email is sent.)
          </div>`;
        }
      } catch (err) {
        usernameMsg = `<div style="color:#a04000;margin-bottom:0.6rem;">Couldn't look up username: ${err.message || err}</div>`;
      }

      let resetMsg;
      try {
        await window.UsersStore.sendPasswordReset(email);
        resetMsg = `<div style="background:#eaf2f8;border-left:3px solid #3498db;padding:0.6rem 0.85rem;border-radius:4px;color:#1a5276;">
            ✅ A password-reset link has been sent to <strong>${email}</strong>. Check your inbox (and spam folder).
        </div>`;
      } catch (err) {
        resetMsg = `<div style="background:#fdedec;border-left:3px solid #e74c3c;padding:0.6rem 0.85rem;border-radius:4px;color:#922b21;">
            ❌ ${err.message || 'Could not send reset link.'}
        </div>`;
      }

      result.innerHTML = usernameMsg + resetMsg;
      submitBtn.disabled = false;
      submitBtn.innerHTML = oldHTML;
    });
  }
});
