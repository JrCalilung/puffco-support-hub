// ═══════════════════════════════════════════════════════════════════════════════
// INQUIRIES MODULE
// All logic below is unchanged from the original main.js.
// initInquiriesModule() is the entry point called by switchModule().
// ═══════════════════════════════════════════════════════════════════════════════

function initInquiriesModule(client) {
  // Wire up buttons (guard against double-binding on repeat tab visits)
  const addInquiryBtn = document.getElementById('add-inquiry');
  if (addInquiryBtn && !addInquiryBtn._bound) {
    addInquiryBtn.addEventListener('click', () => openAddView(client));
    addInquiryBtn._bound = true;
  }

  const addBackBtn = document.getElementById('add-back-btn');
  if (addBackBtn && !addBackBtn._bound) {
    addBackBtn.addEventListener('click', () => closeAddView(client));
    addBackBtn._bound = true;
  }

  const addCancelBtn = document.getElementById('add-form-cancel-btn');
  if (addCancelBtn && !addCancelBtn._bound) {
    addCancelBtn.addEventListener('click', () => closeAddView(client));
    addCancelBtn._bound = true;
  }

  const addForm = document.getElementById('add-inquiry-form');
  if (addForm && !addForm._bound) {
    addForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('add-submit-btn');
      btn.disabled = true;
      btn.innerText = 'Creating record...';
      const customObjectKey = 'inquiry';
      try {
        const ticketData = await client.get('ticket.id');
        const ticketId = ticketData['ticket.id'];
        const formData = new FormData(this);
        const customFields = {};
        formData.forEach((value, key) => { customFields[key] = value; });
        if (document.getElementById('product_family_selector')) {
          customFields.product_family = document.getElementById('product_family_selector').value;
        }
        if (document.getElementById('part_selector')) {
          customFields.part = document.getElementById('part_selector').value;
        }
        customFields.ticket_id = ticketId;
        customFields.status = 'open';
        await client.request({
          url: `/api/v2/custom_objects/${customObjectKey}/records`,
          type: 'POST',
          contentType: 'application/json',
          data: JSON.stringify({
            custom_object_record: {
              name: `Ticket ${ticketId} - ${customFields.serial_number || 'Product'}`,
              custom_object_fields: customFields
            }
          })
        });
        client.invoke('notify', 'Inquiry added successfully!', 'success');
        closeAddView(client);
        setTimeout(() => initApp(client), 2000);
      } catch (err) {
        console.error('Save Error:', err);
        client.invoke('notify', 'Failed to save inquiry.', 'error');
        btn.disabled = false;
        btn.innerText = 'Add';
      }
    });
    addForm._bound = true;
  }

  const inquiryList = document.getElementById('inquiry-list');
  if (inquiryList && !inquiryList._bound) {
    inquiryList.addEventListener('click', (event) => {
      openDeleteInquiryModal(event, client);
      handleCloseInquiry(event, client);
    });
    inquiryList._bound = true;
  }

  const editBackBtn = document.getElementById('edit-back-btn');
  if (editBackBtn && !editBackBtn._bound) {
    editBackBtn.addEventListener('click', () => closeEditView(client));
    editBackBtn._bound = true;
  }

  const editCancelBtn = document.getElementById('edit-form-cancel-btn');
  if (editCancelBtn && !editCancelBtn._bound) {
    editCancelBtn.addEventListener('click', () => closeEditView(client));
    editCancelBtn._bound = true;
  }

  const editForm = document.getElementById('edit-inquiry-form');
  if (editForm && !editForm._bound) {
    editForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('edit-save-btn');
      btn.disabled = true;
      btn.innerText = 'Updating...';
      const recordId = this.dataset.recordId;
      const customObjectKey = 'inquiry';
      try {
        const formData = new FormData(this);
        const customFields = {};
        formData.forEach((value, key) => { customFields[key] = value; });
        if (document.getElementById('product_family_selector')) {
          customFields.product_family = document.getElementById('product_family_selector').value;
        }
        if (document.getElementById('part_selector')) {
          customFields.part = document.getElementById('part_selector').value;
        }
        if (document.getElementById('inquiry_type_selector')) {
          customFields.inquiry_type = document.getElementById('inquiry_type_selector').value;
        }
        // ── VALIDATION RULES ──────────────────────────────────────────────────
        // check() returns true = VALID, false = BLOCKED.
        // Rules are evaluated in order; the first failure stops submission.
        const validationRules = [
          {
            message: 'You must have a resolution method when closing a Product Issue Inquiry.',
            check: (fields) =>
              !(fields.status === 'closed' &&
                fields.inquiry_type === 'product_issue' &&
                !fields.resolution_method)
          },
          // {
          //   message: 'Your next rule message here.',
          //   check: (fields) => !(someCondition && anotherCondition)
          // },
        ];
        const failedRule = validationRules.find(rule => !rule.check(customFields));
        if (failedRule) {
          client.invoke('notify', failedRule.message, 'error');
          btn.disabled = false;
          btn.innerText = 'Save Changes';
          return;
        }
        // ── END VALIDATION ────────────────────────────────────────────────────
        await client.request({
          url: `/api/v2/custom_objects/${customObjectKey}/records/${recordId}`,
          type: 'PUT',
          contentType: 'application/json',
          data: JSON.stringify({ custom_object_record: { custom_object_fields: customFields } })
        });
        client.invoke('notify', 'Inquiry updated successfully!', 'success');
        btn.disabled = false;
        btn.innerText = 'Save Changes';
        closeEditView(client);
      } catch (err) {
        console.error('Update Error:', err);
        client.invoke('notify', 'Failed to update inquiry.', 'error');
        btn.disabled = false;
        btn.innerText = 'Save Changes';
      }
    });
    editForm._bound = true;
  }

  // Load the inquiry list
  initApp(client);
}


// ─── Inquiry List ─────────────────────────────────────────────────────────────

async function initApp(client) {
  try {
    const ticketData = await client.get('ticket.id');
    const ticketId = ticketData['ticket.id'];
    const customObjectKey = 'inquiry';
    const clientContext = await client.context();
    const subdomain = clientContext.account.subdomain;
    const rawInquiries = await fetchInquiries(client, customObjectKey, ticketId);
    const hydratedInquiries = await Promise.all(rawInquiries.map(async (item) => {
      const fields = item.custom_object_fields;
      const recordUrl = `https://${subdomain}.zendesk.com/agent/custom-objects/${customObjectKey}/records/${item.id}`;
      const inquiryType = fields.inquiry_type;
      const inquirySubType = await fetchRecordName(client, 'inquiry_subtype', fields.inquiry_subtype);
      const status = fields.status;
      const orderNumber = fields.order_number;
      const partName = await fetchRecordName(client, 'product', fields.part);
      const deviceName = await fetchRecordName(client, 'product', fields.device);
      const issueCode = await fetchRecordName(client, 'issue_code', fields.issue);
      const serialNumber = fields.part_serial_number;
      const deviceSerialNumber = fields.device_serial_number;
      const resolution = await fetchRecordName(client, 'resolution_method', fields.resolution_method);
      const productFamily = fields.product_family;
      var returnObject = {
        id: item.id,
        inquiry_type: inquiryType,
        display_name: toProperCase(inquiryType) + " Inquiry",
        headline: inquirySubType ? toProperCase(inquirySubType) : null,
        context1: inquirySubType ? "<strong>Inquiry Subtype:</strong> " + toProperCase(inquirySubType) : null,
        context3: null, context4: null, context5: null, context6: null,
        context7: resolution ? "<strong>Resolution:</strong> " + toProperCase(resolution) : null,
        status: status,
        record_url: recordUrl
      };
      if (fields.inquiry_type == 'product_issue') {
        returnObject.headline = partName || null;
        returnObject.context1 = partName ? "<strong>Part:</strong> " + partName : null;
        returnObject.context3 = serialNumber ? "<strong>Part SN:</strong> " + serialNumber : null;
        returnObject.context4 = issueCode ? "<strong>Issue:</strong> " + issueCode : null;
        returnObject.context5 = deviceName ? "<strong>Device:</strong> " + deviceName : null;
        returnObject.context6 = deviceSerialNumber ? "<strong>Device SN:</strong> " + deviceSerialNumber : null;
      } else if (fields.inquiry_type == 'product_question') {
        returnObject.headline = productFamily || null;
        returnObject.context1 = productFamily ? '<strong>Product Family:</strong> ' + productFamily : null;
      } else if (['shipping', 'order', 'returns'].includes(fields.inquiry_type)) {
        returnObject.context3 = orderNumber ? "<strong>Order:</strong> " + orderNumber : null;
      }
      return returnObject;
    }));
    renderInquiryList(hydratedInquiries);
  } catch (error) {
    console.error(error);
  }
}

function toProperCase(str) {
  return str
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function fetchInquiries(client, customObjectKey, ticketId) {
  const response = await client.request({
    url: `/api/v2/custom_objects/${customObjectKey}/records/search`,
    type: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({
      filter: { "custom_object_fields.ticket_id": { "$eq": ticketId } }
    })
  });
  console.log(response);
  return response.custom_object_records || [];
}

function renderInquiryList(inquiries) {
  document.querySelector('h2').innerText = "Inquiries [" + inquiries.length + "]";
  var source = document.getElementById("inquiry-list-template").innerHTML;
  var template = Handlebars.compile(source);
  document.getElementById("inquiry-list").innerHTML = template({ inquiries });
  inquiries.forEach(inq => {
    const body = document.getElementById(`body-${inq.id}`);
    const chevron = document.getElementById(`chevron-${inq.id}`);
    if (body) body.classList.add('visible');
    if (chevron) chevron.classList.add('open');
  });
}

async function fetchRecordName(client, objectKey, recordId) {
  if (!recordId) return null;
  try {
    const response = await client.request({
      url: `/api/v2/custom_objects/${objectKey}/records/${recordId}`,
      type: 'GET'
    });
    return response.custom_object_record.name || "Unknown";
  } catch (e) {
    console.error(`Failed to lookup ${objectKey} ${recordId}`, e);
    return "Unknown ID";
  }
}

function toggleInquiryCard(id) {
  document.getElementById(`body-${id}`).classList.toggle('visible');
  document.getElementById(`chevron-${id}`).classList.toggle('open');
}


// ─── Delete / Edit modal dispatch ────────────────────────────────────────────

async function openDeleteInquiryModal(event, client) {
  if (event.target && event.target.classList.contains('delete-btn')) {
    const recordId = event.target.getAttribute('data-id');
    const recordName = event.target.getAttribute('data-name');
    client.invoke('instances.create', {
      location: 'modal',
      url: `assets/delete-inquiry-modal.html?recordId=${encodeURIComponent(recordId)}&name=${encodeURIComponent(recordName)}`,
      size: { width: '450px', height: '300px' }
    }).then(function(modalContext) {
      var modalClient = client.instance(modalContext['instances.create'][0].instanceGuid);
      modalClient.on('inquiry_deleted', function() {
        console.log('received inquiry_deleted from modal');
        initApp(client);
      });
      modalClient.on('modal.close', function() {
        console.log('Delete modal closed');
      });
    }).catch(function(e) {
      console.error('Failed to open delete modal:', e);
      client.invoke('notify', 'Could not open delete dialog. Please try again.', 'error');
    });
  } else if (event.target && event.target.classList.contains('edit-btn')) {
    const recordId = event.target.closest('.edit-btn').getAttribute('data-id');
    openEditView(recordId, client);
  }
}


// ─── Close / Reopen inquiry ──────────────────────────────────────────────────

async function handleCloseInquiry(event, client) {
  const isCloseBtn = event.target && event.target.classList.contains('close-btn');
  const isReopenBtn = event.target && event.target.classList.contains('reopen-btn');
  if (!isCloseBtn && !isReopenBtn) return;
  const recordId = event.target.getAttribute('data-id');
  const customObjectKey = 'inquiry';
  const newStatus = isCloseBtn ? 'closed' : 'open';
  const actionLabel = isCloseBtn ? 'Closed' : 'Reopened';
  try {
    if (isCloseBtn) {
      const recordResponse = await client.request({
        url: `/api/v2/custom_objects/${customObjectKey}/records/${recordId}`,
        type: 'GET'
      });
      const fields = recordResponse.custom_object_record.custom_object_fields;
      // ── VALIDATION RULES ────────────────────────────────────────────────────
      const validationRules = [
        {
          message: 'You must have a resolution method when closing a Product Issue Inquiry.',
          check: (f) => !(f.inquiry_type === 'product_issue' && !f.resolution_method)
        },
        // {
        //   message: 'Your next rule message here.',
        //   check: (f) => !(someCondition)
        // },
      ];
      const failedRule = validationRules.find(rule => !rule.check(fields));
      if (failedRule) {
        client.invoke('notify', failedRule.message, 'error');
        return;
      }
      // ── END VALIDATION ───────────────────────────────────────────────────────
    }
    await client.request({
      url: `/api/v2/custom_objects/${customObjectKey}/records/${recordId}`,
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ custom_object_record: { custom_object_fields: { status: newStatus } } })
    });
    initApp(client);
    client.invoke('notify', `Inquiry ${actionLabel}`, 'success');
  } catch (error) {
    console.error('Failed to update inquiry status:', error);
    client.invoke('notify', 'Failed to update inquiry status. Please try again.', 'error');
  }
}


// ─── Inline Edit View ────────────────────────────────────────────────────────

function openEditView(recordId, client) {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('edit-view').style.display = 'block';
  document.getElementById('edit-inquiry-form').dataset.recordId = recordId;
  loadEditForm(recordId, client);
}

function closeEditView(client) {
  document.getElementById('edit-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';
  initApp(client);
}

async function loadEditForm(recordId, client) {
  const customObjectKey = 'inquiry';
  const container = document.getElementById('edit-dynamic-field-container');
  container.innerHTML = '<p>Loading existing data...</p>';
  try {
    const [recordResponse, fieldData] = await Promise.all([
      client.request({ url: `/api/v2/custom_objects/${customObjectKey}/records/${recordId}`, type: 'GET' }),
      client.request({ url: `/api/v2/custom_objects/${customObjectKey}/fields`, type: 'GET' })
    ]);
    const existingData = recordResponse.custom_object_record.custom_object_fields;
    window._editAllAvailableFields = fieldData.custom_object_fields.filter(field => {
      const isHidden = field.description?.toLowerCase().includes('[hidden]');
      return field.key !== 'ticket_id' && field.active === true && !isHidden;
    });
    const inquiryTypeField = window._editAllAvailableFields.find(f => f.key === 'inquiry_type');
    await editRenderInitialUI(inquiryTypeField, existingData, client);
  } catch (err) {
    console.error('Edit form load error:', err);
    container.innerHTML = '<p class="text-danger">Failed to load record.</p>';
  }
}

async function editRenderInitialUI(typeField, existingData, client) {
  const container = document.getElementById('edit-dynamic-field-container');
  container.innerHTML = `
    <div class="form-group mt-3">
      <label class="font-weight-bold">${typeField.title} <span class="text-danger">*</span></label>
      <select class="form-control" id="inquiry_type_selector" name="inquiry_type" required disabled>
        ${typeField.custom_field_options.map(opt =>
          `<option value="${opt.value}" ${opt.value === existingData.inquiry_type ? 'selected' : ''}>${opt.name}</option>`
        ).join('')}
      </select>
    </div>
    <div id="conditional-fields"></div>
  `;
  const conditionalContainer = document.getElementById('conditional-fields');
  await editUpdateDynamicFields(existingData.inquiry_type, conditionalContainer, existingData, client);
  document.getElementById('inquiry_type_selector').addEventListener('change', function(e) {
    editUpdateDynamicFields(e.target.value, conditionalContainer, {}, client);
  });
}

async function editUpdateDynamicFields(chosenType, conditionalContainer, existingData, client) {
  if (chosenType === 'product_issue') {
    await editRenderProductUI(conditionalContainer, existingData, client);
  } else {
    await editRenderFieldsForType(chosenType, conditionalContainer, existingData, client);
  }
}

async function editRenderProductUI(targetDiv, existingData, client) {
  const productFamilyField = window._editAllAvailableFields.find(f => f.key === 'product_family');
  targetDiv.innerHTML = `
    <div class="form-group mt-3">
      <label class="font-weight-bold">${productFamilyField.title} <span class="text-danger">*</span></label>
      <select class="form-control" id="product_family_selector" required>
        <option value="" disabled>Select Family...</option>
        ${productFamilyField.custom_field_options.map(opt =>
          `<option value="${opt.value}" ${opt.value === existingData.product_family ? 'selected' : ''}>${opt.name}</option>`
        ).join('')}
      </select>
    </div>
    <div id="part-selector-container"></div>
    <div id="remaining-fields-container"></div>
  `;
  const partContainer = document.getElementById('part-selector-container');
  const remainingFieldsContainer = document.getElementById('remaining-fields-container');
  if (existingData.product_family) {
    window._editSelectedProductFamily = existingData.product_family;
    await editRenderPartSelector(existingData.product_family, partContainer, remainingFieldsContainer, existingData, client);
  }
  document.getElementById('product_family_selector').addEventListener('change', async function() {
    window._editSelectedProductFamily = this.value;
    const currentFormData = editCaptureCurrentFormValues();
    currentFormData.part = '';
    await editRenderPartSelector(this.value, partContainer, remainingFieldsContainer, currentFormData, client);
  });
}

function editCaptureCurrentFormValues() {
  const formData = new FormData(document.getElementById('edit-inquiry-form'));
  const values = {};
  formData.forEach((value, key) => { values[key] = value; });
  return values;
}

async function editRenderPartSelector(familyId, targetDiv, remainingFieldsContainer, existingData, client) {
  const partRecords = await editFetchAllCustomObjectRecords('product', client);
  let filteredParts = partRecords.filter(rec => rec.custom_object_fields.product_family === familyId);
  filteredParts = filteredParts.sort((a, b) => {
    const aType = a.custom_object_fields.item_type || '';
    const bType = b.custom_object_fields.item_type || '';
    if (aType !== bType) return aType.localeCompare(bType);
    const aIsOther = /other/i.test(a.name || '');
    const bIsOther = /other/i.test(b.name || '');
    if (aIsOther && !bIsOther) return 1;
    if (!aIsOther && bIsOther) return -1;
    return (a.name || '').localeCompare(b.name || '');
  });
  targetDiv.innerHTML = `
    <div class="form-group mt-3">
      <label class="font-weight-bold">Part <span class="text-danger">*</span></label>
      <select class="form-control" id="part_selector" required>
        <option value="" disabled ${!existingData.part ? 'selected' : ''}>Select Part...</option>
        ${filteredParts.map(part =>
          `<option value="${part.id}" ${part.id === existingData.part ? 'selected' : ''}>${part.name}</option>`
        ).join('')}
      </select>
    </div>
  `;
  if (existingData.part) {
    const partData = await client.request({ url: `/api/v2/custom_objects/product/records/${existingData.part}`, type: 'GET' });
    window._editSelectedPartItemType = partData.custom_object_record.custom_object_fields.item_type;
    await editRenderFieldsForType('product_issue', remainingFieldsContainer, existingData, client);
  }
  document.getElementById('part_selector').addEventListener('change', async function() {
    const partData = await client.request({ url: `/api/v2/custom_objects/product/records/${this.value}`, type: 'GET' });
    window._editSelectedPartItemType = partData.custom_object_record.custom_object_fields.item_type;
    const currentFormData = editCaptureCurrentFormValues();
    await editRenderFieldsForType('product_issue', remainingFieldsContainer, currentFormData, client);
  });
}

async function editRenderFieldsForType(chosenType, container, existingData, client) {
  container.innerHTML = `
    <div class="form-group mt-3">
      <div class="alert alert-info" role="alert">
        <div class="spinner-border spinner-border-sm mr-2" role="status" style="display:inline-block;">
          <span class="sr-only">Loading...</span>
        </div>
        Loading Fields...
      </div>
    </div>
  `;
  let filteredFields = window._editAllAvailableFields.filter(field => {
    if (['inquiry_type', 'ticket_id', 'product_family', 'part'].includes(field.key)) return false;
    const desc = field.description?.toLowerCase() || '';
    return desc.includes('[visibility:global]') || desc.includes(`[visibility:${chosenType.toLowerCase()}]`);
  });
  if (chosenType === 'product_issue' && ['battery', 'base', 'travel_glass'].includes(window._editSelectedPartItemType)) {
    filteredFields = filteredFields.filter(f => !['device', 'device_serial_number'].includes(f.key));
  }
  const schema = await editBuildDynamicSchema(filteredFields, client);
  editRenderDynamicForm(schema, container, existingData);
}

async function editFetchAllCustomObjectRecords(objType, client) {
  const all = [];
  let afterCursor = undefined;
  const pageSize = 100;
  do {
    const url = `/api/v2/custom_objects/${objType}/records?page[size]=${pageSize}` + (afterCursor ? `&page[after]=${afterCursor}` : '');
    const res = await client.request({ url, type: 'GET' });
    all.push(...(res.custom_object_records || []));
    afterCursor = res.meta?.after_cursor;
  } while (afterCursor);
  return all;
}

async function editBuildDynamicSchema(visibleFields, client) {
  return Promise.all(visibleFields.map(async (field) => {
    const desc = (field.description || '').toLowerCase();
    const base = {
      id: field.id, key: field.key, label: field.title,
      description: field.description, required: field.required,
      searchable: desc.includes('[searchable]')
    };
    if (field.type === 'dropdown') {
      return { ...base, renderType: 'select', options: field.custom_field_options.map(o => ({ value: o.value, label: o.name })) };
    }
    if (field.type === 'lookup') {
      const objType = field.relationship_target_type.replace('zen:custom_object:', '');
      let records = await editFetchAllCustomObjectRecords(objType, client);
      if (field.key === 'device' && window._editSelectedProductFamily) {
        const validTypes = ['base', 'battery', 'hash_vaporizer'];
        records = records.filter(r =>
          validTypes.includes(r.custom_object_fields.item_type) &&
          r.custom_object_fields.product_family === window._editSelectedProductFamily
        );
        records = records.sort((a, b) => {
          const aType = a.custom_object_fields.item_type || '';
          const bType = b.custom_object_fields.item_type || '';
          if (aType !== bType) return aType.localeCompare(bType);
          const aIsOther = /other/i.test(a.name || '');
          const bIsOther = /other/i.test(b.name || '');
          if (aIsOther && !bIsOther) return 1;
          if (!aIsOther && bIsOther) return -1;
          return (a.name || '').localeCompare(b.name || '');
        });
      }
      if (field.key === 'issue') {
        if (window._editSelectedProductFamily) {
          records = records.filter(r => r.custom_object_fields.product_family === window._editSelectedProductFamily);
        }
        const getIssueItemType = (rec) => rec.custom_object_fields?.item_type || rec.custom_object_fields?.issue_code?.item_type;
        if (window._editSelectedPartItemType) {
          records = records.filter(r => getIssueItemType(r) === window._editSelectedPartItemType);
        }
        records = records.sort((a, b) => {
          const aType = getIssueItemType(a) || '';
          const bType = getIssueItemType(b) || '';
          if (aType !== bType) return aType.localeCompare(bType);
          const aIsOther = /other/i.test(a.name || '');
          const bIsOther = /other/i.test(b.name || '');
          if (aIsOther && !bIsOther) return 1;
          if (!aIsOther && bIsOther) return -1;
          return (a.name || '').localeCompare(b.name || '');
        });
      }
      if (field.key === 'inquiry_subtype') {
        const selectedInquiryType = document.getElementById('inquiry_type_selector')?.value;
        if (selectedInquiryType) {
          records = records.filter(r => r.custom_object_fields.inquiry_type === selectedInquiryType);
        }
      }
      return { ...base, renderType: 'select', options: records.map(r => ({ value: r.id, label: r.name })) };
    }
    return { ...base, renderType: field.type === 'textarea' ? 'textarea' : 'text' };
  }));
}

function editRenderDynamicForm(schema, targetDiv, existingData) {
  targetDiv.innerHTML = '';
  const isStatusClosed = existingData.status === 'closed';
  const issueFieldIndex = schema.findIndex(f => f.key === 'issue');
  const statusFieldIndex = schema.findIndex(f => f.key === 'status');
  const issueField = issueFieldIndex !== -1 ? schema[issueFieldIndex] : null;
  const statusField = statusFieldIndex !== -1 ? schema[statusFieldIndex] : null;
  const remainingSchema = schema.filter((f, idx) => idx !== issueFieldIndex && idx !== statusFieldIndex);

  function buildFieldEl(field, val, disabled) {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';
    const disabledAttr = disabled ? 'disabled' : '';
    let inputHtml = '';
    if (field.renderType === 'select') {
      inputHtml = `<select class="form-control" id="${field.key}" name="${field.key}" ${field.required ? 'required' : ''} ${disabledAttr}>
        <option value="">Select...</option>
        ${field.options.map(opt => `<option value="${opt.value}" ${opt.value == val ? 'selected' : ''}>${opt.label}</option>`).join('')}
      </select>`;
    } else {
      inputHtml = `<input type="text" class="form-control" id="${field.key}" name="${field.key}" value="${val}" ${field.required ? 'required' : ''} ${disabledAttr}>`;
    }
    formGroup.innerHTML = `<label class="font-weight-bold">${field.label}</label>` + inputHtml;
    return formGroup;
  }

  if (issueField) {
    const c = document.createElement('div');
    c.id = 'issue-field-container';
    c.className = 'mb-3';
    c.appendChild(buildFieldEl(issueField, existingData[issueField.key] || '', false));
    targetDiv.appendChild(c);
    if (issueField.searchable) $(`#${issueField.key}`).select2({ width: '100%' });
  }
  if (statusField) {
    const c = document.createElement('div');
    c.id = 'status-field-container';
    c.className = 'mb-3 pb-3 border-bottom';
    c.appendChild(buildFieldEl(statusField, existingData[statusField.key] || '', false));
    targetDiv.appendChild(c);
    if (statusField.searchable) $(`#${statusField.key}`).select2({ width: '100%' });
  }

  const sections = {};
  const unsectionedFields = [];
  remainingSchema.forEach(field => {
    const match = (field.description || '').match(/\[section:([^\]]+)\]/i);
    if (match) {
      const name = match[1];
      if (!sections[name]) sections[name] = [];
      sections[name].push(field);
    } else {
      unsectionedFields.push(field);
    }
  });

  unsectionedFields.forEach(field => {
    const el = buildFieldEl(field, existingData[field.key] || '', isStatusClosed);
    el.classList.add('mt-3');
    targetDiv.appendChild(el);
    if (field.searchable) $(`#${field.key}`).select2({ width: '100%' });
  });

  Object.entries(sections).forEach(([sectionName, fields]) => {
    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'section-container';
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-header';
    sectionHeader.innerHTML = `
      <h5 class="section-header-title">${sectionName}</h5>
      <span class="section-toggle-icon collapsed">▼</span>
    `;
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content collapsed';
    fields.forEach(field => {
      const el = buildFieldEl(field, existingData[field.key] || '', isStatusClosed);
      el.classList.add('mt-3');
      sectionContent.appendChild(el);
      if (field.searchable) $(`#${field.key}`).select2({ width: '100%' });
    });
    sectionContainer.appendChild(sectionHeader);
    sectionContainer.appendChild(sectionContent);
    targetDiv.appendChild(sectionContainer);
    sectionHeader.addEventListener('click', function() {
      sectionContent.classList.toggle('collapsed');
      this.querySelector('.section-toggle-icon').classList.toggle('collapsed');
    });
  });

  if (isStatusClosed) {
    ['product_family_selector', 'part_selector'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  }
}


// ─── Inline Add View ─────────────────────────────────────────────────────────

function openAddView(client) {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('add-view').style.display = 'block';
  document.getElementById('add-inquiry-form').reset();
  window._addAllAvailableFields = null;
  window._addSelectedProductFamily = null;
  window._addSelectedPartItemType = null;
  loadAddForm(client);
}

function closeAddView(client) {
  document.getElementById('add-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';
}

async function loadAddForm(client) {
  const customObjectKey = 'inquiry';
  const container = document.getElementById('add-dynamic-field-container');
  container.innerHTML = '<p>Loading fields...</p>';
  try {
    const fieldData = await client.request({
      url: `/api/v2/custom_objects/${customObjectKey}/fields`,
      type: 'GET'
    });
    window._addAllAvailableFields = fieldData.custom_object_fields.filter(field => {
      const isHidden = field.description?.toLowerCase().includes('[hidden]');
      return field.key !== 'ticket_id' && field.active === true && !isHidden;
    });
    const inquiryTypeField = window._addAllAvailableFields.find(f => f.key === 'inquiry_type');
    addInqRenderInitialUI(inquiryTypeField, container, client);
  } catch (err) {
    console.error('Add form load error:', err);
    container.innerHTML = '<p class="text-danger">Failed to load fields.</p>';
  }
}

function addInqRenderInitialUI(typeField, container, client) {
  container.innerHTML = `
    <div class="form-group mt-3">
      <label class="font-weight-bold">${typeField.title} <span class="text-danger">*</span></label>
      <select class="form-control" id="inquiry_type_selector" name="inquiry_type" required>
        <option value="" disabled selected>Select Category...</option>
        ${typeField.custom_field_options.map(opt =>
          `<option value="${opt.value}">${opt.name}</option>`
        ).join('')}
      </select>
    </div>
    <div id="conditional-fields"></div>
  `;
  document.getElementById('inquiry_type_selector').addEventListener('change', function(e) {
    const conditionalContainer = document.getElementById('conditional-fields');
    addInqUpdateDynamicFields(e.target.value, conditionalContainer, client);
  });
}

async function addInqUpdateDynamicFields(chosenType, conditionalContainer, client) {
  if (chosenType === 'product_issue') {
    addInqRenderProductUI(conditionalContainer, client);
  } else {
    await addInqRenderFieldsForType(chosenType, conditionalContainer, client);
  }
}

function addInqRenderProductUI(targetDiv, client) {
  const productFamilyField = window._addAllAvailableFields.find(f => f.key === 'product_family');
  targetDiv.innerHTML = `
    <div class="form-group mt-3">
      <label class="font-weight-bold">${productFamilyField.title} <span class="text-danger">*</span></label>
      <select class="form-control" id="product_family_selector" required>
        <option value="" disabled selected>Select ${productFamilyField.title}...</option>
        ${productFamilyField.custom_field_options.map(opt =>
          `<option value="${opt.value}">${opt.name}</option>`
        ).join('')}
      </select>
    </div>
    <div id="part-selector-container"></div>
    <div id="remaining-fields-container"></div>
  `;
  const partContainer = document.getElementById('part-selector-container');
  const remainingFieldsContainer = document.getElementById('remaining-fields-container');
  document.getElementById('product_family_selector').addEventListener('change', async function() {
    window._addSelectedProductFamily = this.value;
    await addInqRenderPartSelector(this.value, partContainer, remainingFieldsContainer, client);
  });
}

async function addInqRenderPartSelector(productFamilyId, targetDiv, remainingFieldsContainer, client) {
  try {
    let partRecords = await addInqFetchAllCustomObjectRecords('product', client);
    let filteredParts = partRecords.filter(rec => rec.custom_object_fields.product_family === productFamilyId);
    filteredParts = filteredParts.sort((a, b) => {
      const aType = a.custom_object_fields.item_type || '';
      const bType = b.custom_object_fields.item_type || '';
      if (aType !== bType) return aType.localeCompare(bType);
      const aIsOther = /other/i.test(a.name || '');
      const bIsOther = /other/i.test(b.name || '');
      if (aIsOther && !bIsOther) return 1;
      if (!aIsOther && bIsOther) return -1;
      return (a.name || '').localeCompare(b.name || '');
    });
    targetDiv.innerHTML = `
      <div class="form-group mt-3">
        <label class="font-weight-bold">Part <span class="text-danger">*</span></label>
        <select class="form-control" id="part_selector" required>
          <option value="" disabled selected>Select Part...</option>
          ${filteredParts.map(rec => `<option value="${rec.id}">${rec.name}</option>`).join('')}
        </select>
      </div>
    `;
    document.getElementById('part_selector').addEventListener('change', async function() {
      try {
        const partData = await client.request({
          url: `/api/v2/custom_objects/product/records/${this.value}`,
          type: 'GET'
        });
        window._addSelectedPartItemType = partData.custom_object_record.custom_object_fields.item_type;
        await addInqRenderFieldsForType('product_issue', remainingFieldsContainer, client);
      } catch (err) {
        console.error('Failed to fetch part data:', err);
      }
    });
  } catch (err) {
    console.error('Failed to fetch parts:', err);
  }
}

async function addInqRenderFieldsForType(chosenType, container, client) {
  container.innerHTML = `
    <div class="form-group mt-3">
      <div class="alert alert-info" role="alert">
        <div class="spinner-border spinner-border-sm mr-2" role="status" style="display:inline-block;">
          <span class="sr-only">Loading...</span>
        </div>
        Loading Fields...
      </div>
    </div>
  `;
  let filteredFields = window._addAllAvailableFields.filter(field => {
    if (['inquiry_type', 'ticket_id', 'status'].includes(field.key)) return false;
    if (field.key === 'product_family' && chosenType === 'product_issue') return false;
    if (field.key === 'part' && chosenType === 'product_issue') return false;
    const desc = field.description?.toLowerCase() || '';
    return desc.includes('[visibility:global]') || desc.includes(`[visibility:${chosenType.toLowerCase()}]`);
  });
  const excludedItemTypes = ['battery', 'base', 'heated_loading_tool', 'travel_glass'];
  if (chosenType === 'product_issue' && excludedItemTypes.includes(window._addSelectedPartItemType)) {
    filteredFields = filteredFields.filter(f => !['device', 'device_serial_number'].includes(f.key));
  }
  const schema = await addInqBuildDynamicSchema(filteredFields, client);
  addInqRenderDynamicForm(schema, container);
}

async function addInqFetchAllCustomObjectRecords(objType, client) {
  const all = [];
  let afterCursor = undefined;
  const pageSize = 100;
  do {
    const url = `/api/v2/custom_objects/${objType}/records?page[size]=${pageSize}` + (afterCursor ? `&page[after]=${afterCursor}` : '');
    const res = await client.request({ url, type: 'GET' });
    all.push(...(res.custom_object_records || []));
    afterCursor = res.meta?.after_cursor;
  } while (afterCursor);
  return all;
}

async function addInqBuildDynamicSchema(visibleFields, client) {
  const sortByTypeAndName = (getType, getName) => (a, b) => {
    const aType = getType(a) || '';
    const bType = getType(b) || '';
    if (aType !== bType) return aType.localeCompare(bType);
    const aIsOther = /other/i.test(getName(a) || '');
    const bIsOther = /other/i.test(getName(b) || '');
    if (aIsOther && !bIsOther) return 1;
    if (!aIsOther && bIsOther) return -1;
    return (getName(a) || '').localeCompare(getName(b) || '');
  };
  return Promise.all(visibleFields.map(async (field) => {
    const desc = (field.description || '').toLowerCase();
    const base = {
      id: field.id, key: field.key, label: field.title,
      type: field.type, description: field.description,
      required: field.required || desc.includes('[required]'),
      searchable: desc.includes('[searchable]')
    };
    if (field.type === 'dropdown') {
      return { ...base, renderType: 'select', options: field.custom_field_options.map(o => ({ value: o.value, label: o.name })) };
    }
    if (field.type === 'lookup') {
      const objType = field.relationship_target_type.replace('zen:custom_object:', '');
      try {
        let records = await addInqFetchAllCustomObjectRecords(objType, client);
        if (field.key === 'device') {
          const validTypes = ['base', 'battery', 'hash_vaporizer'];
          records = records.filter(r => validTypes.includes(r.custom_object_fields.item_type));
          if (window._addSelectedProductFamily) {
            records = records.filter(r => r.custom_object_fields.product_family === window._addSelectedProductFamily);
          }
          records = records.sort(sortByTypeAndName(r => r.custom_object_fields.item_type, r => r.name));
        } else if (field.key === 'part') {
          records = records.filter(r => r.custom_object_fields.item_class === 'part');
          if (window._addSelectedProductFamily) {
            records = records.filter(r => r.custom_object_fields.product_family === window._addSelectedProductFamily);
          }
          records = records.sort(sortByTypeAndName(r => r.custom_object_fields.item_type, r => r.name));
        } else if (field.key === 'issue') {
          if (window._addSelectedProductFamily) {
            records = records.filter(r => r.custom_object_fields.product_family === window._addSelectedProductFamily);
          }
          const getIssueItemType = r => r.custom_object_fields?.item_type || r.custom_object_fields?.issue_code?.item_type;
          if (window._addSelectedPartItemType) {
            records = records.filter(r => getIssueItemType(r) === window._addSelectedPartItemType);
          }
          records = records.sort(sortByTypeAndName(getIssueItemType, r => r.name));
        } else if (field.key === 'inquiry_subtype') {
          const selectedType = document.getElementById('inquiry_type_selector')?.value;
          if (selectedType) {
            records = records.filter(r => r.custom_object_fields.inquiry_type === selectedType);
          }
        }
        return { ...base, renderType: 'select', options: records.map(r => ({ value: r.id, label: r.name || r.id })) };
      } catch (err) {
        console.error(`Could not load lookup for ${objType}`, err);
        return { ...base, renderType: 'text' };
      }
    }
    return { ...base, renderType: field.type === 'textarea' ? 'textarea' : 'text' };
  }));
}

function addInqRenderDynamicForm(schema, targetDiv) {
  targetDiv.innerHTML = '';
  const sections = {};
  const unsectionedFields = [];
  schema.forEach(field => {
    const match = (field.description || '').match(/\[section:([^\]]+)\]/i);
    if (match) {
      const name = match[1];
      if (!sections[name]) sections[name] = [];
      sections[name].push(field);
    } else {
      unsectionedFields.push(field);
    }
  });

  function buildAddFieldEl(field) {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group mt-3';
    const label = `<label for="${field.key}" class="font-weight-bold">${field.label}${field.required ? ' <span class="text-danger">*</span>' : ''}</label>`;
    let inputHtml = field.renderType === 'select'
      ? `<select class="form-control" id="${field.key}" name="${field.key}" ${field.required ? 'required' : ''}>
           <option value="" disabled selected>Select ${field.label}...</option>
           ${field.options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
         </select>`
      : `<input type="text" class="form-control" id="${field.key}" name="${field.key}" placeholder="Enter ${field.label}" ${field.required ? 'required' : ''}>`;
    formGroup.innerHTML = label + inputHtml;
    return formGroup;
  }

  unsectionedFields.forEach(field => {
    const el = buildAddFieldEl(field);
    targetDiv.appendChild(el);
    if (field.renderType === 'select' && field.searchable) {
      $(`#${field.key}`).select2({ placeholder: `Search ${field.label}...`, width: '100%' });
    }
  });

  Object.entries(sections).forEach(([sectionName, fields]) => {
    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'section-container';
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-header';
    sectionHeader.innerHTML = `
      <h5 class="section-header-title">${sectionName}</h5>
      <span class="section-toggle-icon collapsed">▼</span>
    `;
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content collapsed';
    fields.forEach(field => {
      const el = buildAddFieldEl(field);
      sectionContent.appendChild(el);
      if (field.renderType === 'select' && field.searchable) {
        $(`#${field.key}`).select2({ placeholder: `Search ${field.label}...`, width: '100%' });
      }
    });
    sectionContainer.appendChild(sectionHeader);
    sectionContainer.appendChild(sectionContent);
    targetDiv.appendChild(sectionContainer);
    sectionHeader.addEventListener('click', function() {
      sectionContent.classList.toggle('collapsed');
      this.querySelector('.section-toggle-icon').classList.toggle('collapsed');
    });
  });
}
