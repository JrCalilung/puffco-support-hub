// ═══════════════════════════════════════════════════════════════════════════════
// RETURN LABEL MODULE
// Auto-populates from inquiry record, falls back to ticket requester
// Macro auto-apply: fetches matching USPS return macro based on part item_type
// + product_family, injects content into reply composer with label URL appended
// ═══════════════════════════════════════════════════════════════════════════════

var RETURN_LABEL_PRODUCTS = {
  peak_pro_base: {
    label:      'Peak / Peak Pro Base',
    weight_oz:  32,
    dimensions: '12" x 6" x 6"',
    desc:       'Peak and Peak Pro base returns',
    families:   ['peak_pro_v2', 'peak_pro', 'peak']
  },
  proxy_base: {
    label:      'Proxy Base',
    weight_oz:  32,
    dimensions: '8" x 8" x 6"',
    desc:       'Proxy base returns',
    families:   ['proxy']
  },
  pivot_plus_chamber: {
    label:      'Pivot / Plus Base & Chamber Returns',
    weight_oz:  16,
    dimensions: '4" x 4" x 4"',
    desc:       'Pivot, Plus base returns and all device chamber returns',
    families:   ['pivot', 'plus']
  },
  custom: {
    label:      'Custom',
    weight_oz:  null,
    dimensions: null,
    desc:       'Custom weight and dimensions',
    families:   []
  }
};

// ─── Macro Map: item_type|product_family → Zendesk Macro ID ─────────────────
// Source: Return Instructions::(USPS) active macros — confirmed Sept 2026
var PART_MACRO_MAP = {
  // Peak / Peak Pro Base
  'base|peak':              '360164836813',
  'base|peak_v2':           '360164836813',
  'base|peak_pro':          '360164836813',
  'base|peak_pro_v2':       '360164836813',

  // Peak / Peak Pro Base + Charger
  'charger|peak_pro':       '1260811777889',
  'charger|peak_pro_v2':    '1260811777889',

  // Power Dock
  'charger|peak_pro_power_dock': '1500001856001',

  // Peak Pro Chamber
  'chamber|peak_pro':       '360194809614',
  'chamber|peak_pro_v2':    '360194809614',
  'chamber|peak_v2':        '360194809614',
  'chamber|peak':           '360194809614',

  // Peak Pro Link
  'link|peak_pro_v2':       '48595166512667',

  // Peak / Peak Pro Glass (also covers Proxy glass and travel glass per CS confirmation)
  'glass|peak':             '1500001902762',
  'glass|peak_v2':          '1500001902762',
  'glass|peak_pro':         '1500001902762',
  'glass|peak_pro_v2':      '1500001902762',
  'glass|proxy':            '1500001902762',
  'glass|proxy_v2':         '1500001902762',
  'ryan_fitt_glass|peak':        '1500001902762',
  'ryan_fitt_glass|peak_v2':     '1500001902762',
  'ryan_fitt_glass|peak_pro':    '1500001902762',
  'ryan_fitt_glass|peak_pro_v2': '1500001902762',
  'ryan_fitt_glass|proxy':       '1500001902762',
  'wizard_glass|proxy':          '1500001902762',
  'wizard_glass|proxy_v2':       '1500001902762',
  'bub_glass|proxy':             '1500001902762',
  'bub_glass|proxy_v2':          '1500001902762',
  'terrapipe_glass|proxy':       '1500001902762',
  'ripple_glass|proxy':          '1500001902762',
  'ryan_fitt_glass|proxy_v2':    '1500001902762',
  'droplet_glass|proxy':         '1500001902762',

  // Proxy Travel Pipe → Peak/Peak Pro Glass (CS confirmed Sept 2026)
  'travel_glass|proxy':     '1500001902762',
  'travel_glass|peak_pro':  '1500001902762',

  // Proxy Base
  'base|proxy':             '6797769672731',
  'base|proxy_v2':          '6797769672731',

  // Proxy Chamber
  'chamber|proxy':          '6797874930459',
  'chamber|proxy_v2':       '6797874930459',

  // Hot Knife
  'heated_loading_tool|heated_loading_tool':    '30796698761627',
  'heated_loading_tool|heated_loading_tool_v2': '30796698761627',

  // Pivot — base IS the battery
  'base|pivot':             '30347462352411',
  // Pivot Chamber
  'chamber|pivot':          '30347555581339',

  // Plus Battery (base)
  'base|plus':              '156377188',
  'base|plus_v3':           '19854437900955',

  // Plus Chamber (original maps to 3.0 — confirmed same size Sept 2026)
  'chamber|plus':           '19854395360411',
  'chamber|plus_v3':        '19854395360411',

  // Power Dock
  'charger|peak_pro':       '1500001856001',
};

function _rlGetMacroId(itemType, productFamily) {
  if (!itemType || !productFamily) return null;
  return PART_MACRO_MAP[itemType + '|' + productFamily] || null;
}

function _rlFamilyToProductKey(family) {
  if (!family) return '';
  var f = family.toLowerCase();
  for (var key in RETURN_LABEL_PRODUCTS) {
    var families = RETURN_LABEL_PRODUCTS[key].families;
    for (var i = 0; i < families.length; i++) {
      if (f.indexOf(families[i]) !== -1) return key;
    }
  }
  return '';
}

var _rlEventsbound  = false;
var _rlInquiryType  = '';
var _rlMacroId      = null;  // Set during load, used after label generation

function initReturnLabelModule(client) {
  if (!_rlEventsbound) {
    _rlEventsbound = true;

    var productSel = document.getElementById('rl-product');
    if (productSel) productSel.addEventListener('change', _rlOnProductChange);

    var btn = document.getElementById('rl-generate-btn');
    if (btn) btn.addEventListener('click', function() { _rlGenerate(client); });

    var refreshBtn = document.getElementById('rl-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function() { _rlLoad(client); });
  }

  _rlLoad(client);
}

async function _rlLoad(client) {
  _rlSetBanner('Loading customer info from inquiry...', 'info');
  _rlMacroId = null;

  try {
    var ticketData = await client.get('ticket.id');
    var ticketId   = String(ticketData['ticket.id']);

    var response = await client.request({
      url:         '/api/v2/custom_objects/inquiry/records/search',
      type:        'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        filter: { 'custom_object_fields.ticket_id': { '$eq': ticketId } }
      })
    });

    var records = (response.custom_object_records || []);
    var record  = records.find(function(r) {
      return r.custom_object_fields.status === 'open';
    }) || records[0];

    if (record) {
      var f = record.custom_object_fields;
      _rlFillFields(f);

      // ── Fetch part record to resolve macro ──────────────────────────────────
      if (f.part) {
        try {
          var partResp = await client.request({
            url:  '/api/v2/custom_objects/product/records/' + f.part,
            type: 'GET'
          });
          var pf        = partResp.custom_object_record.custom_object_fields;
          var itemType  = pf.item_type     || '';
          var family    = pf.product_family || '';
          _rlMacroId    = _rlGetMacroId(itemType, family);
          console.log('Return label macro resolved:', itemType, family, '→', _rlMacroId);
        } catch(e) {
          console.warn('Could not resolve part record for macro lookup:', e);
        }
      }

      if (f.shipping_address_line_1) {
        _rlSetBanner('✓ Information auto-populated from the Inquiry Tracker. Please review before generating.', 'success');
      } else {
        _rlSetBanner('Inquiry found but no shipping address on record. Please enter address manually.', 'warning');
      }
    } else {
      _rlFallbackToTicket(client);
    }
  } catch(e) {
    console.warn('Return label inquiry lookup failed:', e);
    _rlFallbackToTicket(client);
  }
}

async function _rlFallbackToTicket(client) {
  try {
    var data = await client.get(['ticket.requester.name', 'ticket.requester.email']);
    document.getElementById('rl-name').value  = data['ticket.requester.name']  || '';
    document.getElementById('rl-email').value = data['ticket.requester.email'] || '';
  } catch(e) {}
  _rlSetBanner('No inquiry record found. Please enter shipping information manually.', 'info');
}

function _rlFillFields(f) {
  _rlInquiryType = f.inquiry_type || '';

  var map = {
    'rl-name':     f.customer_name           || '',
    'rl-email':    f.email                   || '',
    'rl-address1': f.shipping_address_line_1 || '',
    'rl-address2': f.shipping_address_line_2 || '',
    'rl-city':     f.city                    || '',
    'rl-state':    f.state                   || '',
    'rl-zip':      f.zip                     || ''
  };
  for (var id in map) {
    var el = document.getElementById(id);
    if (el) el.value = map[id];
  }

  var productKey = _rlFamilyToProductKey(f.product_family || '');
  var sel = document.getElementById('rl-product');
  if (sel && productKey) {
    sel.value = productKey;
    _rlOnProductChange();
  }
}

function _rlSetBanner(msg, type) {
  var el = document.getElementById('rl-banner');
  if (!el) return;
  el.className    = 'rl-banner rl-banner-' + (type || 'info');
  el.textContent  = msg;
  el.style.display = 'block';
}

function _rlOnProductChange() {
  var key      = document.getElementById('rl-product').value;
  var infoEl   = document.getElementById('rl-product-info');
  var customEl = document.getElementById('rl-custom-fields');

  infoEl.style.display   = 'none';
  infoEl.innerHTML       = '';
  customEl.style.display = 'none';

  if (!key || !RETURN_LABEL_PRODUCTS[key]) return;

  var p = RETURN_LABEL_PRODUCTS[key];

  if (key === 'custom') {
    customEl.style.display = 'block';
    return;
  }

  infoEl.style.display = 'block';
  infoEl.innerHTML =
    '<span><strong>Weight:</strong> ' + (p.weight_oz / 16).toFixed(1) + ' lbs (' + p.weight_oz + ' oz)</span>' +
    '<span><strong>Box size:</strong> ' + p.dimensions + '</span>' +
    '<span><strong>Used for:</strong> ' + p.desc + '</span>';
}

function _rlSetStatus(msg, type) {
  var el = document.getElementById('rl-status');
  el.className    = 'hub-status ' + (type || 'info');
  el.textContent  = msg;
  el.style.display = 'block';
}

function _rlClearStatus() {
  var el = document.getElementById('rl-status');
  el.className    = 'hub-status';
  el.textContent  = '';
  el.style.display = 'none';
}

function _rlValidate() {
  if (!document.getElementById('rl-product').value) return 'Please select a product / return type.';
  var required = {
    'rl-address1': 'Address Line 1',
    'rl-city':     'City',
    'rl-state':    'State',
    'rl-zip':      'ZIP Code'
  };
  for (var id in required) {
    if (!document.getElementById(id).value.trim()) return required[id] + ' is required.';
  }
  if (document.getElementById('rl-state').value.trim().length !== 2) return 'State must be a 2-letter code (e.g. CA).';
  if (document.getElementById('rl-product').value === 'custom') {
    if (!document.getElementById('rl-custom-weight').value) return 'Weight is required for custom returns.';
    if (!document.getElementById('rl-custom-length').value) return 'Length is required for custom returns.';
    if (!document.getElementById('rl-custom-width').value)  return 'Width is required for custom returns.';
    if (!document.getElementById('rl-custom-height').value) return 'Height is required for custom returns.';
  }
  return null;
}

async function _rlGenerate(client) {
  _rlClearStatus();
  var err = _rlValidate();
  if (err) {
    client.invoke('notify', err, 'alert');
    _rlSetStatus(err, 'error');
    return;
  }

  var btn = document.getElementById('rl-generate-btn');
  btn.disabled    = true;
  btn.textContent = 'Generating...';
  _rlSetStatus('Generating return label — please wait...', 'info');

  try {
    var metadata = await client.metadata();
    var settings = metadata.settings || {};
    var apiBase  = settings.AWS_API_BASE_URL;
    if (!apiBase) throw new Error('AWS_API_BASE_URL not configured. Contact IT.');

    var ticketData   = await client.get(['ticket.id', 'ticket.requester.email']);
    var pKey         = document.getElementById('rl-product').value;
    var p            = RETURN_LABEL_PRODUCTS[pKey];
    var weightOz     = p.weight_oz;
    var productLabel = p.label;

    if (pKey === 'custom') {
      weightOz     = parseInt(document.getElementById('rl-custom-weight').value);
      var l        = document.getElementById('rl-custom-length').value;
      var w        = document.getElementById('rl-custom-width').value;
      var h        = document.getElementById('rl-custom-height').value;
      productLabel = 'Custom (' + l + '"x' + w + '"x' + h + '", ' + weightOz + 'oz)';
    }

    var payload = {
      ticket_id:      ticketData['ticket.id'],
      customer_name:  document.getElementById('rl-name').value.trim(),
      customer_email: document.getElementById('rl-email').value.trim() || ticketData['ticket.requester.email'] || '',
      address: {
        address1: document.getElementById('rl-address1').value.trim(),
        address2: document.getElementById('rl-address2').value.trim(),
        city:     document.getElementById('rl-city').value.trim(),
        state:    document.getElementById('rl-state').value.trim().toUpperCase(),
        zip:      document.getElementById('rl-zip').value.trim()
      },
      weight_oz:    weightOz,
      product_type: productLabel,
      inquiry_type: _rlInquiryType
    };

    var resp   = await fetch(apiBase + '/return-label/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    var result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Failed to generate label.');

    // ── Macro + label URL injection ────────────────────────────────────────────
    var labelUrl = result.customer_label_url || result.customer_message || '';
    await _rlInjectMacroWithLabel(client, labelUrl, ticketData['ticket.id']);

    client.invoke('notify', '✓ Return label generated! Tracking: ' + result.tracking_number, 'notice');
    _rlSetStatus(
      '✓ Return label generated!\n' +
      'Product: ' + p.label + '\n' +
      'Tracking: ' + result.tracking_number + '\n' +
      'Postage: $' + result.postage_amount + '\n' +
      'Reply composer pre-populated — review and send to customer.',
      'success'
    );

  } catch (e) {
    client.invoke('notify', 'Failed to generate label: ' + (e.message || 'Unknown error.'), 'alert');
    _rlSetStatus('Failed: ' + (e.message || 'Unknown error.') + ' Try again or contact IT.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Generate Return Label';
  }
}

// ─── Macro fetch + label URL injection ────────────────────────────────────────

async function _rlInjectMacroWithLabel(client, labelUrl, ticketId) {
  try {
    var commentHtml = '';

    if (_rlMacroId) {
      // Fetch macro content from Zendesk
      var macroResp = await client.request({
        url:  '/api/v2/macros/' + _rlMacroId + '.json',
        type: 'GET'
      });

      var actions = (macroResp.macro && macroResp.macro.actions) || [];

      // Prefer HTML action, fall back to plain text action
      var commentAction = actions.find(function(a) {
        return a.field === 'comment_value_html';
      }) || actions.find(function(a) {
        return a.field === 'comment_value';
      });

      if (commentAction && commentAction.value) {
        commentHtml = commentAction.value;

        // Resolve {{ticket.requester.first_name}} placeholder
        try {
          var requesterData = await client.get('ticket.requester.name');
          var fullName      = requesterData['ticket.requester.name'] || '';
          var firstName     = fullName.split(' ')[0] || fullName;
          commentHtml = commentHtml.replace(/\{\{ticket\.requester\.first_name\}\}/gi, firstName);
          commentHtml = commentHtml.replace(/\{\{ticket\.requester\.name\}\}/gi, fullName);
        } catch(nameErr) {
          console.warn('Could not resolve requester name:', nameErr);
          commentHtml = commentHtml.replace(/\{\{ticket\.requester\.first_name\}\}/gi, '');
          commentHtml = commentHtml.replace(/\{\{ticket\.requester\.name\}\}/gi, '');
        }

        // Replace "attached to this email" label reference with actual download link
        commentHtml = commentHtml.replace(
          /pre-paid shipping label attached to this email/gi,
          'pre-paid shipping label linked below'
        );

        // Append label URL as a clearly marked block at the end
        if (labelUrl) {
          commentHtml += '<br><br><strong>Return Label Download Link:</strong><br>' +
            '<a href="' + labelUrl + '">' + labelUrl + '</a>';
        }
      }
    }

    // Fallback — no macro, just inject label URL as HTML
    if (!commentHtml && labelUrl) {
      commentHtml = '<a href="' + labelUrl + '">' + labelUrl + '</a>';
    }

    if (commentHtml) {
      // Switch composer to public reply first
      try { await client.set('ticket.comment.type', 'publicReply'); } catch(e) {}
      // Inject as HTML so formatting renders correctly
      await client.invoke('ticket.comment.appendHtml', commentHtml);
    }

  } catch(e) {
    // Non-fatal — label was still generated, macro inject just failed
    console.warn('Macro inject failed, falling back to label URL only:', e);
    if (labelUrl) {
      try {
        try { await client.set('ticket.comment.type', 'publicReply'); } catch(e) {}
        await client.invoke('ticket.comment.appendHtml',
          '<a href="' + labelUrl + '">' + labelUrl + '</a>');
      } catch(e2) {
        console.warn('Label URL inject also failed:', e2);
      }
    }
  }
}
