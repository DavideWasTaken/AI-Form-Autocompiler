async function checkContentScript(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch (error) {
    return false;
  }
}

async function waitForContentScript(tabId, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isReady = await checkContentScript(tabId);
    if (isReady) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  const instructionsTextarea = document.getElementById('instructions');
  const saveButton = document.getElementById('save');
  const fillButton = document.getElementById('fillForm');
  const statusDiv = document.getElementById('status');
  const modeSelect = document.getElementById('mode');

  // Load saved instructions
  chrome.storage.local.get(['lastInstructions'], (result) => {
    if (result.lastInstructions) {
      instructionsTextarea.value = result.lastInstructions;
      showStatus('Last used instructions loaded', 'success');
    }
  });

  // Save instructions
  saveButton.addEventListener('click', () => {
    const instructions = instructionsTextarea.value.trim();
    if (instructions) {
      chrome.storage.local.set({ 'lastInstructions': instructions }, () => {
        showStatus('Instructions saved successfully', 'success');
      });
    } else {
      showStatus('Please enter instructions before saving', 'error');
    }
  });

  // Start form filling
  fillButton.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url.includes('docs.google.com/forms')) {
        showStatus('Please open a Google Form before proceeding.', 'error');
        return;
      }

      const instructions = instructionsTextarea.value;
      if (!instructions) {
        showStatus('Please enter instructions before proceeding.', 'error');
        return;
      }

      showStatus('Checking connection...', 'info');
      
      // Wait for content script to be ready
      const isReady = await waitForContentScript(tab.id);
      if (!isReady) {
        showStatus('Unable to connect to form. Please reload the page.', 'error');
        return;
      }

      showStatus('Filling in progress', 'info');

      // Keep the connection alive
      const port = chrome.tabs.connect(tab.id, {name: 'formfiller'});
      
      port.onMessage.addListener((response) => {
        if (response.status === 'retrying') {
          showStatus(`Retrying in ${response.retryAfter/1000} seconds...`, 'warning');
        } else if (response.success) {
          showStatus('Filling complete', 'success');
        } else if (response.error && response.error.includes('429')) {
          showStatus('Too many attempts, please wait a few seconds and try again', 'error');
        } else {
          showStatus(`Error: ${response.error || 'Unknown error'}`, 'error');
        }
      });

      port.postMessage({
        action: 'fillForm',
        instructions: instructions,
        mode: modeSelect.value // 'smart' or 'simple'
      });

    } catch (error) {
      console.error('Error in popup:', error);
      showStatus('Error during filling', 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    // Non nascondere automaticamente i messaggi di warning
    if (type !== 'warning') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }
});
