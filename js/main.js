document.documentElement.classList.add('js');

// Show either the landing page or the register page
function show(view){
  document.getElementById('view-home').style.display = view==='home' ? 'block' : 'none';
  document.getElementById('view-register').style.display = view==='register' ? 'block' : 'none';
  document.getElementById('nav-home').classList.toggle('active', view==='home');
  document.getElementById('nav-register').classList.toggle('active', view==='register');
  window.scrollTo(0,0);
  watchReveals();
}
function goHome(){ location.hash = 'home'; }
function goRegister(){ location.hash = 'register'; }
function goStory(){ document.getElementById('why').scrollIntoView({behavior:'smooth',block:'start'}); }
function goSection(id){
  if(location.hash !== '#home' && location.hash !== ''){ location.hash = 'home'; }
  setTimeout(function(){ document.getElementById(id).scrollIntoView({behavior:'smooth'}); }, 80);
}
function goContact(){
  if(location.hash !== '#home' && location.hash !== ''){ location.hash = 'home'; }
  setTimeout(function(){ document.getElementById('contact').scrollIntoView({behavior:'smooth'}); }, 80);
}
function route(){ show(location.hash === '#register' ? 'register' : 'home'); }
window.addEventListener('hashchange', route);

// Fade sections in as they scroll into view
function watchReveals(){
  var items = document.querySelectorAll('.reveal:not(.in)');
  if(!('IntersectionObserver' in window)){ items.forEach(function(el){el.classList.add('in')}); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  }, {threshold:.12});
  items.forEach(function(el){ io.observe(el); });
}

// Package choice: show T-shirt size only for Elite and update the total
var PACKAGE_PRICES = { Starter: 500, Pacesetter: 1200, Elite: 2500 };
function updatePackage(){
  var pkg = document.getElementById('package').value;
  var wantsShirt = pkg === 'Elite';
  var amount = 'LKR ' + PACKAGE_PRICES[pkg].toLocaleString('en-US');
  document.getElementById('shirtBox').style.display = wantsShirt ? 'block' : 'none';
  document.getElementById('shirt').disabled = !wantsShirt;
  document.getElementById('shirt').required = wantsShirt;   // size is mandatory for Elite
  document.getElementById('total').textContent = amount;
  document.getElementById('payAmount').textContent = amount;
}

// ---- Connects the form to your Google Apps Script. SCRIPT_URL is set in js/config.js ----

function showError(msg){
  var el = document.getElementById('formErr'); el.textContent = msg; el.style.display = 'block';
  var b = document.getElementById('submitBtn'); b.disabled = false; b.innerHTML = 'Submit registration';
}
function showSuccess(preview){
  document.getElementById('regForm').style.display = 'none';
  document.getElementById('success').style.display = 'block';
  if (preview && !document.getElementById('previewNote')) {
    var n = document.createElement('p'); n.id = 'previewNote'; n.className = 'err'; n.style.display = 'block';
    n.textContent = 'PREVIEW MODE: nothing was saved, because SCRIPT_URL is empty in js/config.js.';
    document.getElementById('success').appendChild(n);
  }
  window.scrollTo(0,0);
}
function readFile(file){
  return new Promise(function(resolve, reject){
    var r = new FileReader();
    r.onload = function(){ resolve(String(r.result).split(',')[1]); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
// Photos are shrunk before upload so they send quickly; PDFs are sent as they are.
function prepareReceipt(file){
  if (file.type === 'application/pdf') {
    return readFile(file).then(function(b64){ return { name: file.name, type: file.type, data: b64 }; });
  }
  return new Promise(function(resolve, reject){
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function(){
      var s = Math.min(1, 1600 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.8).split(',')[1] });
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('Could not read the image')); };
    img.src = url;
  });
}
// ---- Phone and email validation ----
// Phone numbers must be exactly 10 digits (spaces and dashes are allowed while typing, e.g. 077 123 4567).
function cleanPhone(v){ return String(v || '').replace(/[\s-]/g, ''); }
function isValidPhone(v){ return /^\d{10}$/.test(cleanPhone(v)); }
function isValidEmail(v){ return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(String(v || '').trim()); }

function attachValidation(id, test, message){
  var el = document.getElementById(id);
  if (!el) return;
  function check(){ el.setCustomValidity(el.value === '' || test(el.value) ? '' : message); }
  el.addEventListener('input', check);
  el.addEventListener('blur', function(){ check(); if (el.value !== '') el.reportValidity(); });
  check();
}
attachValidation('phone',   isValidPhone, 'Please enter a 10-digit phone number, e.g. 0771234567.');
attachValidation('ecphone', isValidPhone, 'Please enter a 10-digit phone number, e.g. 0771234567.');
attachValidation('email',   isValidEmail, 'Please enter a valid email address, e.g. name@example.com.');

function submitForm(e){
  e.preventDefault();
  document.getElementById('formErr').style.display = 'none';
  var data = Object.fromEntries(new FormData(document.getElementById('regForm')).entries());
  delete data.receipt;
  if (!isValidPhone(data.phone))     { showError('Please enter a 10-digit contact number.'); return false; }
  if (!isValidPhone(data.ecphone))   { showError('Please enter a 10-digit emergency contact number.'); return false; }
  if (!isValidEmail(data.email))     { showError('Please enter a valid email address.'); return false; }
  data.phone = cleanPhone(data.phone);
  data.ecphone = cleanPhone(data.ecphone);
  data.email = data.email.trim();
  data.action = 'register';
  data.privacy = document.getElementById('privacyok').checked;
  data.marketing = document.getElementById('marketing').checked;
  if (!SCRIPT_URL) { showSuccess(true); return false; }   // preview mode
  var file = document.getElementById('receipt').files[0];
  if (!file) { showError('Please upload your payment receipt.'); return false; }
  if (file.size > 10 * 1024 * 1024) { showError('Your receipt is larger than 10 MB. Please upload a smaller photo or PDF.'); return false; }
  if (file.type === 'application/pdf' && file.size > 5 * 1024 * 1024) { showError('Your PDF is larger than 5 MB. Please upload a smaller file or a photo.'); return false; }
  if (['image/jpeg','image/png','application/pdf'].indexOf(file.type) === -1) { showError('Please upload your receipt as a JPG, PNG or PDF.'); return false; }
  var b = document.getElementById('submitBtn'); b.disabled = true; b.textContent = 'Sending… this can take up to 30 seconds';
  var ctrl = new AbortController(), timer = setTimeout(function(){ ctrl.abort(); }, 90000);
  prepareReceipt(file).then(function(rc){
    data.receipt = rc;
    return fetch(SCRIPT_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(data), signal: ctrl.signal });
  })
    .then(function(r){ return r.json(); })
    .then(function(res){ clearTimeout(timer); if (res.ok) showSuccess(); else showError(res.error || 'Something went wrong. Please try again.'); })
    .catch(function(err){
      clearTimeout(timer);
      if (err && err.name === 'AbortError') showError('This is taking longer than usual. Please check your email in a few minutes before trying again, so you don’t register twice.');
      else showError('Could not send your registration. Please check your connection and try again.');
    });
  return false;
  
}

updatePackage();
route();