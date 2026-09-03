// ═══════════════════════════════════════════════════════════════════════════════
// PUFFCO SUPPORT HUB — App Shell
// Tabs: Inquiries | Registrations | Return Label | Media Upload
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  var client = ZAFClient.init();
  client.invoke('resize', { width: '100%', height: '600px' });

  // Register Handlebars equality helper (used by Inquiries module)
  Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });

  // ── Tab nav wiring ───────────────────────────────────────────────────────────
  document.querySelectorAll('.app-nav-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchModule(this.dataset.module, client);
    });
  });

  // ── Boot into default module ─────────────────────────────────────────────────
  switchModule('inquiries', client);

})();

function switchModule(moduleName, client) {
  // Update tab active state
  document.querySelectorAll('.app-nav-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.module === moduleName);
  });

  // Show matching panel, hide the rest
  document.querySelectorAll('.module-panel').forEach(function(panel) {
    panel.style.display = panel.id === moduleName + '-module' ? 'block' : 'none';
  });

  // Call the module's init function
  switch (moduleName) {
    case 'inquiries':
      initInquiriesModule(client);
      break;
    case 'registrations':
      initRegistrationsModule(client);
      break;
    case 'returnlabel':
      initReturnLabelModule(client);
      break;
    case 'mediaupload':
      initMediaUploadModule(client);
      break;
  }
}
