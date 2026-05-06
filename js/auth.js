// Auth and Bookings - Local Storage Implementation
let currentUser = null;
let token = localStorage.getItem('token');

// ── Hardcoded admin account ──────────────────────────────────
const ADMIN_USER = {
  id: 'admin_deb',
  username: 'deb',
  email: 'deb@bharattours.com',
  password: 'deb'
};

// Database simulation using localStorage
const DB = {
  users: JSON.parse(localStorage.getItem('users') || '[]'),
  bookings: JSON.parse(localStorage.getItem('bookings') || '[]'),
  
  saveUsers() {
    localStorage.setItem('users', JSON.stringify(this.users));
  },
  
  saveBookings() {
    localStorage.setItem('bookings', JSON.stringify(this.bookings));
  }
};

// Check if logged in on load
if (token) {
  const storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  if (storedUser) {
    currentUser = storedUser;
    updateAuthUI();
  } else {
    localStorage.removeItem('token');
    updateAuthUI();
  }
}

function updateAuthUI() {
  const authLink = document.getElementById('authLink');
  const signUpLink = document.querySelector('a[onclick*="openRegister"]');
  
  if (currentUser) {
    if (signUpLink) {
      signUpLink.parentElement.style.display = 'none';
    }
    authLink.innerHTML = `<i class="fas fa-user"></i> ${currentUser.username}`;
    authLink.onclick = openProfile;
  } else {
    if (signUpLink) {
      signUpLink.parentElement.style.display = 'block';
    }
    authLink.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    authLink.onclick = openLogin;
  }
}

function login(email, password) {
  return new Promise((resolve, reject) => {

    // ── Hardcoded admin login: username "deb" / password "deb" ──
    const isAdminLogin =
      (email === ADMIN_USER.username || email === ADMIN_USER.email) &&
      password === ADMIN_USER.password;

    if (isAdminLogin) {
      token = 'token_' + Date.now();
      currentUser = { id: ADMIN_USER.id, username: ADMIN_USER.username, email: ADMIN_USER.email };
      localStorage.setItem('token', token);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      updateAuthUI();
      closeLogin();
      alert('✅ Login successful! Welcome, deb.');
      resolve({ token, user: currentUser });
      return;
    }

    // ── Regular user login ───────────────────────────────────────
    const user = DB.users.find(u => u.email === email && u.password === password);
    
    if (!user) {
      reject(new Error('Invalid email or password'));
      return;
    }
    
    token = 'token_' + Date.now();
    currentUser = { id: user.id, username: user.username, email: user.email };
    localStorage.setItem('token', token);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    updateAuthUI();
    closeLogin();
    alert('✅ Login successful!');
    resolve({ token, user: currentUser });
  });
}

function register(username, email, password) {
  return new Promise((resolve, reject) => {
    // Prevent overwriting the hardcoded admin account
    if (username.toLowerCase() === 'deb' || email === ADMIN_USER.email) {
      reject(new Error('This username/email is reserved.'));
      return;
    }

    if (DB.users.find(u => u.email === email)) {
      reject(new Error('Email already registered'));
      return;
    }
    
    if (!username || !email || !password) {
      reject(new Error('All fields are required'));
      return;
    }
    
    const newUser = {
      id: Date.now(),
      username,
      email,
      password
    };
    
    DB.users.push(newUser);
    DB.saveUsers();
    
    alert('✅ Registration successful! Please login.');
    closeRegister();
    openLogin();
    resolve(newUser);
  });
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  token = null;
  currentUser = null;
  updateAuthUI();
  closeProfile();
}

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

// UI Functions
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
  document.getElementById('profileUsername').textContent = currentUser.username;
  const bookingsList = document.getElementById('bookingsList');
  try {
    const bookings = await loadBookings();
    bookingsList.innerHTML = bookings.map(b => `
      <div class="booking-item">
        <h4>${b.package_name}</h4>
        <p>Duration: ${b.duration || 'N/A'} | Price: ₹${b.price.toLocaleString()} | Status: <span class="${b.status}">${b.status.toUpperCase()}</span></p>
        <p>Guests: ${b.guests || 'N/A'}</p>
        <button onclick="editBooking(${b.id})">Edit</button>
        ${b.status !== 'cancelled' ? `<button onclick="cancelBooking(${b.id})">Cancel</button>` : ''}
      </div>
    `).join('') || '<p>No bookings yet. <a href="#packages">Book now!</a></p>';
  } catch (err) {
    bookingsList.innerHTML = '<p>Error loading bookings.</p>';
  }
}

function editBooking(id) {
  const newPrice = prompt('Enter new price:');
  if (newPrice) {
    updateBooking(id, { price: parseFloat(newPrice) }).then(() => loadProfileContent());
  }
}

window.login = login;
window.register = register;
window.logout = logout;
window.loadProfileContent = loadProfileContent;
window.editBooking = editBooking;
window.openRegister = openRegister;
window.closeRegister = closeRegister;
window.openLogin = openLogin;
window.closeLogin = closeLogin;
window.openProfile = openProfile;
window.closeProfile = closeProfile;
window.cancelBooking = async (id) => {
  if (confirm('Cancel this booking?')) {
    await cancelBooking(id);
    loadProfileContent();
  }
};
