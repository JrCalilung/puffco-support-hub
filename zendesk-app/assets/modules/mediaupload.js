// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA UPLOAD MODULE
// Vanilla JS — no jQuery/Bootstrap dependency
// ═══════════════════════════════════════════════════════════════════════════════

function initMediaUploadModule(client) {
  // Pre-fill email from ticket requester
  client.get('ticket.requester.email').then(function(data) {
    var el = document.getElementById('mu-email');
    if (el && !el.value) el.value = data['ticket.requester.email'] || '';
  }).catch(function() {});

  var btn = document.getElementById('mu-generate-btn');
  if (btn && !btn._mu_bound) {
    btn.addEventListener('click', function() { _muGenerate(client); });
    btn._mu_bound = true;
  }

  var copyBtn = document.getElementById('mu-copy-btn');
  if (copyBtn && !copyBtn._mu_bound) {
    copyBtn.addEventListener('click', _muCopyLink);
    copyBtn._mu_bound = true;
  }
}

function _muSetStatus(msg, type) {
  var el = document.getElementById('mu-status');
  el.className = 'hub-status ' + (type || 'info');
  el.textContent = msg;
  el.style.display = 'block';
}

function _muClearStatus() {
  var el = document.getElementById('mu-status');
  el.className = 'hub-status';
  el.textContent = '';
  el.style.display = 'none';
}

async function _muGenerate(client) {
  _muClearStatus();
  document.getElementById('mu-result').style.display = 'none';

  var btn = document.getElementById('mu-generate-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  _muSetStatus('Generating upload link — please wait...', 'info');

  try {
    var metadata = await client.metadata();
    var settings = metadata.settings || {};
    var apiBase  = settings.AWS_API_BASE_URL;
    if (!apiBase) throw new Error('AWS_API_BASE_URL not configured. Contact IT.');

    var ticketData = await client.get(['ticket.id', 'ticket.requester.name', 'ticket.requester.email']);

    var payload = {
      ticket_id:       ticketData['ticket.id'],
      requester_email: ticketData['ticket.requester.email'] || '',
      requester_name:  ticketData['ticket.requester.name']  || '',
      expiration_days: parseInt(document.getElementById('mu-expiry').value),
      max_files:       parseInt(document.getElementById('mu-max-files').value)
    };

    // APP_SHARED_SECRET is now a secure parameter injected by Zendesk as a header
    // Use client.request() so Zendesk injects the secure header server-side
    // The secret never touches browser memory
    var result = await client.request({
      url:         apiBase + '/upload-sessions',
      type:        'POST',
      contentType: 'application/json',
      secure:      true,
      data:        JSON.stringify(payload),
      headers: {
        'x-api-shared-secret': '{{setting.APP_SHARED_SECRET}}'
      }
    });
    if (!result || result.error) throw new Error((result && result.error) || 'Failed to generate upload link.');

    var uploadUrl  = result.customer_upload_url;
    var name       = ticketData['ticket.requester.name'] || 'there';
    var expDays    = document.getElementById('mu-expiry').value;
    var maxFiles   = document.getElementById('mu-max-files').value;
    var replyText  =
      'Hi ' + name + ',\n\n' +
      'Please use the link below to securely upload any photos or videos related to your support ticket:\n\n' +
      uploadUrl + '\n\n' +
      'The link will expire in ' + expDays + ' days and accepts up to ' + maxFiles + ' files.\n\n' +
      'Thank you,\nPuffco Support';

    await client.invoke('ticket.comment.appendText', replyText);

    document.getElementById('mu-link-text').textContent = uploadUrl;
    document.getElementById('mu-result').style.display = 'flex';
    _muClearStatus();
    _muSetStatus('✓ Upload link added to reply composer.', 'success');

  } catch (e) {
    _muSetStatus('Failed: ' + (e.message || 'Unknown error.') + ' Try again or contact IT.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Upload Link';
  }
}

function _muCopyLink() {
  var text = document.getElementById('mu-link-text').textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = document.getElementById('mu-copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
  }).catch(function() {
    _muSetStatus('Could not copy — please copy the link manually.', 'error');
  });
}
