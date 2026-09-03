// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATIONS MODULE
// ═══════════════════════════════════════════════════════════════════════════════



function initRegistrationsModule(client) {
  // Register Product button — opens the add view
  const regAddBtn = document.getElementById('reg-add-btn');
  if (regAddBtn && !regAddBtn._bound) {
    regAddBtn.addEventListener('click', () => openRegAddView(client));
    regAddBtn._bound = true;
  }

  // Back / Cancel buttons on the register form view
  const regAddBackBtn = document.getElementById('reg-add-back-btn');
  if (regAddBackBtn && !regAddBackBtn._bound) {
    regAddBackBtn.addEventListener('click', () => closeRegAddView(client));
    regAddBackBtn._bound = true;
  }

  const regAddCancelBtn = document.getElementById('reg-add-cancel-btn');
  if (regAddCancelBtn && !regAddCancelBtn._bound) {
    regAddCancelBtn.addEventListener('click', () => closeRegAddView(client));
    regAddCancelBtn._bound = true;
  }

  // Register form submit
  const regForm = document.getElementById('reg-register-form');
  if (regForm && !regForm._bound) {
    regForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      await submitRegisterProduct(client);
    });
    regForm._bound = true;
  }

  // Auto-load the requester's registrations on tab open
  autoLoadRequesterRegistrations(client);
}


// ─── API helper ──────────────────────────────────────────────────────────────

const REG_API_BASE_URL = 'https://txlfgsmbypgudvfbneez.supabase.co/functions/v1';

async function registrationApiRequest(client, path, options = {}) {
  return client.request({
    url: `${REG_API_BASE_URL}${path}`,
    type: options.method || 'GET',
    contentType: 'application/json',
    headers: { 'api-key': '{{setting.productRegistrationApiToken}}' },
    data: options.body || undefined,
    secure: true
  });
}


// ─── Auto-load requester registrations ───────────────────────────────────────

async function autoLoadRequesterRegistrations(client) {
  const resultDiv = document.getElementById('registrations-result');
  resultDiv.innerHTML = '<p class="text-muted">Loading registrations...</p>';
  try {
    const data = await client.get('ticket.requester.email');
    const requesterEmail = data['ticket.requester.email'];
    if (!requesterEmail) {
      resultDiv.innerHTML = `<div class="alert alert-warning mt-2">No requester email found on this ticket.</div>`;
      return;
    }
    // Store email globally for re-use in the register form
    window._regRequesterEmail = requesterEmail;
    const registrations = await registrationApiRequest(
      client,
      `/user-registrations?email=${encodeURIComponent(requesterEmail)}`,
      { method: 'GET' }
    );
    renderUserRegistrations(registrations);
  } catch (err) {
    console.error('Failed to auto-load requester registrations:', err);
    resultDiv.innerHTML = `<div class="alert alert-danger mt-2">Failed to load registrations.</div>`;
  }
}


// ─── Register new product ─────────────────────────────────────────────────────

function openRegAddView(client) {
  document.getElementById('reg-main-view').style.display = 'none';
  document.getElementById('reg-add-view').style.display = 'block';
  // Pre-fill warranty start date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('reg-form-warranty-start').value = today;
}

function closeRegAddView(client) {
  document.getElementById('reg-add-view').style.display = 'none';
  document.getElementById('reg-main-view').style.display = 'block';
  document.getElementById('reg-register-form').reset();
}

async function submitRegisterProduct(client) {
  const btn = document.getElementById('reg-submit-btn');
  btn.disabled = true;
  btn.innerText = 'Registering...';

  try {
    const email = window._regRequesterEmail;
    if (!email) {
      client.invoke('notify', 'No requester email found. Cannot register product.', 'error');
      btn.disabled = false;
      btn.innerText = 'Register';
      return;
    }

    // Build payload from form fields
    const form = document.getElementById('reg-register-form');
    const formData = new FormData(form);
    const payload = {
      email,
      registration_source: 'zendesk',
      // Hardcoded until serial-number-to-product lookup is implemented
      inventory_id: REG_HARDCODED_INVENTORY_ID,
      model_name:   REG_HARDCODED_MODEL_NAME
    };
    formData.forEach((value, key) => {
      if (value.trim()) payload[key] = value.trim();
    });

    const data = await registrationApiRequest(client, '/register-product', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    client.invoke('notify', data.message || 'Product registered successfully!', 'success');
    closeRegAddView(client);
    // Refresh the registrations list
    await autoLoadRequesterRegistrations(client);

  } catch (err) {
    console.error('Registration failed:', err);
    let message = 'Failed to register product.';
    try {
      const parsed = typeof err.responseText === 'string' ? JSON.parse(err.responseText) : err;
      if (parsed.error) message = parsed.error;
    } catch (_) {}
    client.invoke('notify', message, 'error');
    btn.disabled = false;
    btn.innerText = 'Register';
  }
}


// ─── Render helpers ───────────────────────────────────────────────────────────

function renderUserRegistrations(data) {
  const resultDiv = document.getElementById('registrations-result');
  if (!data.user) {
    resultDiv.innerHTML = `<div class="alert alert-warning mt-2">No registrations found for this customer.</div>`;
    return;
  }
  if (!data.registrations || data.registrations.length === 0) {
    resultDiv.innerHTML = `<div class="alert alert-info mt-2">Customer found, but no registered products.</div>`;
    return;
  }
  resultDiv.innerHTML = data.registrations.map(reg => {
    const warrantyStatus = reg.warranty_end_date
      ? (new Date(reg.warranty_end_date) > new Date() ? 'active' : 'expired')
      : 'none';
    const warrantyLabel = { active: 'Active', expired: 'Expired', none: 'Unknown' }[warrantyStatus];
    return `
      <div class="reg-card">
        <div class="reg-card-header">
          <div>
            <div class="reg-card-title">${reg.products?.model_name || 'Unknown Product'}</div>
            <div class="reg-card-subtitle">${reg.products?.serial_number || 'No serial'}</div>
          </div>
          <span class="reg-status reg-status-${warrantyStatus}">${warrantyLabel}</span>
        </div>
        <div class="reg-card-body">
          <div class="reg-fields">
            <div class="reg-field">
              <div class="reg-field-label">Inventory ID</div>
              <div class="reg-field-value">${reg.products?.inventory_id || 'N/A'}</div>
            </div>
            <div class="reg-field">
              <div class="reg-field-label">Status</div>
              <div class="reg-field-value">${reg.registration_status}</div>
            </div>
            <div class="reg-field">
              <div class="reg-field-label">Registered</div>
              <div class="reg-field-value">${formatRegistrationDate(reg.registered_at)}</div>
            </div>
            <div class="reg-field">
              <div class="reg-field-label">Warranty End</div>
              <div class="reg-field-value">${reg.warranty_end_date || 'Unknown'}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function formatRegistrationDate(value) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleDateString();
}