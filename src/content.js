async function analyzeFormFields() {
  console.log('Starting form field analysis...');
  const fields = [];
  
  // Debug the form structure
  console.log('Form structure:', document.documentElement.innerHTML);
  
  // Try different selectors for questions
  const selectors = [
    '.freebirdFormviewerComponentsQuestionBaseRoot',
    '.freebirdFormviewerViewNumberedItemContainer',
    '.freebirdFormviewerViewItemsItemItem',
    'div[role="listitem"]',
    '.freebirdFormviewerViewItemsItemItemHeader'
  ];

  let questions = [];
  for (const selector of selectors) {
    questions = document.querySelectorAll(selector);
    console.log(`Trying selector ${selector}:`, questions.length);
    if (questions.length > 0) break;
  }

  console.log('Found questions:', questions.length);
  
  questions.forEach((question, index) => {
    console.log(`Analyzing question ${index + 1}:`, question);
    console.log('Question HTML:', question.outerHTML);

    // Try different selectors for title
    const titleSelectors = [
      '.freebirdFormviewerComponentsQuestionBaseTitle',
      '.freebirdFormviewerViewItemsItemItemTitle',
      '[role="heading"]',
      '.freebirdFormviewerViewItemsItemItemHeader'
    ];

    let titleElement = null;
    for (const selector of titleSelectors) {
      titleElement = question.querySelector(selector);
      if (titleElement) {
        console.log(`Found title with selector ${selector}`);
        break;
      }
    }

    if (!titleElement) {
      console.log(`Question ${index + 1} has no title element`);
      return;
    }

    const title = titleElement.textContent.trim();
    const type = determineQuestionType(question);
    const required = question.querySelector('[aria-required="true"]') !== null;

    console.log(`Question ${index + 1} details:`, { title, type, required });

    // Get available options for radio/checkbox/dropdown
    let options = [];
    if (type === 'radio' || type === 'checkbox') {
      // Try different selectors for options
      const optionSelectors = [
        'label',
        '[role="radio"]',
        '[role="checkbox"]',
        '.docssharedWizToggleLabeledContainer',
        '.quantumWizTogglePaperradioEl'
      ];

      for (const selector of optionSelectors) {
        const elements = question.querySelectorAll(selector);
        if (elements.length > 0) {
          options = Array.from(elements).map(el => el.textContent.trim());
          console.log(`Found ${options.length} options with selector ${selector}:`, options);
          break;
        }
      }
    } else if (type === 'dropdown') {
      const selectElement = question.querySelector('select');
      if (selectElement) {
        options = Array.from(selectElement.options).map(option => option.text.trim());
        console.log(`Found ${options.length} dropdown options:`, options);
      }
    }

    fields.push({
      title,
      type,
      required,
      options,
      element: question
    });
  });

  console.log('Final analyzed fields:', fields);
  return fields;
}

function determineQuestionType(questionElement) {
  console.log('Determining type for question:', questionElement.outerHTML);

  // Check for date inputs
  if (questionElement.querySelector('input[type="date"], [role="date"], .quantumWizTextinputPaperinputInput[data-date="true"]')) {
    console.log('Found date input');
    return 'date';
  }

  // Check for text/paragraph inputs
  if (questionElement.querySelector('input[type="text"], [role="textbox"]')) {
    console.log('Found text input');
    return 'text';
  }
  if (questionElement.querySelector('textarea')) {
    console.log('Found paragraph input');
    return 'paragraph';
  }

  // Check for radio buttons
  if (questionElement.querySelector('input[type="radio"], [role="radio"], .quantumWizTogglePaperradioEl')) {
    console.log('Found radio input');
    return 'radio';
  }

  // Check for checkboxes
  if (questionElement.querySelector('input[type="checkbox"], [role="checkbox"], .quantumWizTogglePapercheckboxEl')) {
    console.log('Found checkbox input');
    return 'checkbox';
  }

  // Check for dropdowns
  if (questionElement.querySelector('select, [role="listbox"]')) {
    console.log('Found dropdown input');
    return 'dropdown';
  }

  console.log('Unknown input type');
  return 'unknown';
}

async function fillFormField(field, value) {
  console.log('Filling field:', { field, value });
  const { element, type } = field;

  try {
    switch (type) {
      case 'text':
      case 'paragraph': {
        console.log('Filling text/paragraph field');
        const input = element.querySelector('input[type="text"], textarea');
        if (!input) {
          console.error('Input element not found for text/paragraph field');
          return;
        }
        console.log('Found input element:', input);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        break;
      }
      case 'date': {
        console.log('Filling date field');
        const input = element.querySelector('input[type="date"], [role="date"], .quantumWizTextinputPaperinputInput[data-date="true"]');
        if (!input) {
          console.error('Date input element not found');
          return;
        }
        
        // Mappa dei mesi italiani
        const mesiItaliani = {
          'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04',
          'maggio': '05', 'giugno': '06', 'luglio': '07', 'agosto': '08',
          'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12',
          'gen': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'mag': '05',
          'giu': '06', 'lug': '07', 'ago': '08', 'set': '09', 'ott': '10',
          'nov': '11', 'dic': '12'
        };

        // Funzione per parsare una data italiana
        function parseItalianDate(str) {
          str = str.toLowerCase().trim();
          
          // Gestisce date nel formato "1 maggio 2000"
          const match = str.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
          if (match) {
            const [_, giorno, mese, anno] = match;
            const meseNum = mesiItaliani[mese];
            if (meseNum) {
              return `${anno}-${meseNum}-${giorno.padStart(2, '0')}`;
            }
          }
          
          return null;
        }

        // Prova prima a parsare come data italiana
        let dateValue = parseItalianDate(value);
        
        // Se non è una data italiana, prova altri formati
        if (!dateValue) {
          if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
            dateValue = value;
          } else {
            // Prova a convertire altri formati
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              dateValue = date.toISOString().split('T')[0];
            } else {
              console.error('Invalid date format:', value);
              return;
            }
          }
        }
        
        console.log('Setting date value:', dateValue);
        input.value = dateValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
      case 'radio': {
        console.log('Filling radio field');
        const options = element.querySelectorAll('input[type="radio"], [role="radio"]');
        const labels = element.querySelectorAll('label, [role="radio"] .exportLabel');
        console.log('Radio options:', options);
        console.log('Radio labels:', labels);

        for (let i = 0; i < options.length; i++) {
          const label = labels[i];
          const option = options[i];
          if (label && label.textContent.trim().toLowerCase() === value.toLowerCase()) {
            console.log('Found matching radio option:', label.textContent);
            option.click();
            break;
          }
        }
        break;
      }
      case 'checkbox': {
        console.log('Filling checkbox field');
        const values = Array.isArray(value) ? value : [value];
        const options = element.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
        const labels = element.querySelectorAll('label, [role="checkbox"] .exportLabel');

        for (let i = 0; i < options.length; i++) {
          const label = labels[i];
          const option = options[i];
          if (label && values.some(v => label.textContent.trim().toLowerCase() === v.toLowerCase())) {
            console.log('Found matching checkbox option:', label.textContent);
            option.click();
          }
        }
        break;
      }
      case 'dropdown': {
        console.log('Filling dropdown field');
        const select = element.querySelector('select, [role="listbox"]');
        if (!select) {
          console.error('Select element not found');
          return;
        }

        const options = Array.from(select.options || select.querySelectorAll('[role="option"]'));
        const targetOption = options.find(opt =>
          opt.text.trim().toLowerCase().includes(value.toLowerCase())
        );
        if (targetOption) {
          console.log('Found matching dropdown option:', targetOption.text);
          select.value = targetOption.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('Dropdown value set and event dispatched');
        } else {
          console.warn('No matching dropdown option found for:', value);
        }
        break;
      }
    }
  } catch (error) {
    console.error('Error filling field:', error);
    throw error;
  }
}

async function matchInstructionsToFields(instructions, fields) {
  try {
    console.log('Starting matchInstructionsToFields with:', { instructions, fields });
    const prompt = createAIPrompt(instructions, fields);
    const aiMatches = await getAIResponse(prompt, fields);
    console.log('Risposta AI:', aiMatches);
    // Normalizza e mappa solo i match trovati
    const processedMatches = aiMatches.map(match => {
      const field = fields.find(f => f.title && match.fieldTitle && f.title.trim().toLowerCase() === match.fieldTitle.trim().toLowerCase());
      if (!field) {
        console.warn('No field found for:', match.fieldTitle);
      }
      return { field, value: match.value };
    }).filter(match => match.field);
    return processedMatches;
  } catch (error) {
    console.error('Error matching instructions to fields:', error);
    throw error;
  }
}

function createAIPrompt(instructions, fields) {
  const fieldsJson = fields.map(({ title, type, required, options }) => ({
    title,
    type,
    required,
    options: options || []
  }));

  return {
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: "Sei un assistente che aiuta a compilare moduli. Il tuo compito è analizzare le istruzioni dell'utente e abbinarle ai campi del modulo disponibili."
      },
      {
        role: "user",
        content: `Dati i seguenti campi del modulo:\n${JSON.stringify(fieldsJson, null, 2)}\n\nE le seguenti istruzioni:\n${instructions}\n\nFornisci un JSON array di oggetti con 'fieldTitle' e 'value' per ogni campo che può essere compilato in base alle istruzioni. Per i campi checkbox, 'value' può essere un array di valori. Rispondi SOLO con il JSON, senza altri commenti.`
      }
    ]
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAIResponse(prompt, fields, retryCount = 0, maxRetries = 3, formHtml = null) {
  try {
    console.log(`Attempt ${retryCount + 1} of ${maxRetries + 1}`);
    console.log('Sending request to OpenAI with prompt:', prompt);
    
    const apiKey = typeof OPENAI_API_KEY !== 'undefined' ? OPENAI_API_KEY : '';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(
        typeof prompt === 'object' && prompt.model && prompt.messages
          ? prompt
          : {
              model: 'gpt-4',
              messages: [
                { role: 'system', content: 'Sei un assistente che aiuta a compilare moduli. Il tuo compito è analizzare le istruzioni dell\'utente e abbinarle ai campi del modulo disponibili.' },
                { role: 'user', content: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) }
              ]
            }
      )
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error response:', errorText);
    }

    const data = await response.json();

    // Estrai il testo della risposta
    const aiText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content.trim() : '';
    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      throw new Error('La risposta di OpenAI non è un JSON valido: ' + aiText);
    }
    return parsed;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    if (retryCount < maxRetries && (error.message.includes('429') || error.message.includes('500'))) {
      const delay = Math.pow(2, retryCount + 1) * 1000;
      console.log(`Retrying after ${delay}ms...`);
      await sleep(delay);
      return getAIResponse(prompt, fields, retryCount + 1, maxRetries);
    }
    throw error;
  }
}

async function submitForm() {
  console.log('Attempting to submit form...');
  
  // Try different selectors for the submit button
  const submitSelectors = [
    '[role="button"][jsname="M2UYVd"]',
    '.freebirdFormviewerViewNavigationSubmitButton',
    '[role="button"]:not([aria-label="Clear form"])',
    'div[role="button"]:last-child',
    '.quantumWizButtonPaperbuttonEl'
  ];

  let submitButton = null;
  for (const selector of submitSelectors) {
    submitButton = document.querySelector(selector);
    if (submitButton) {
      console.log(`Found submit button with selector ${selector}:`, submitButton);
      break;
    }
  }

  if (submitButton) {
    console.log('Submit button found:', submitButton);
    
    // Check for errors using different selectors
    const errorSelectors = [
      '.freebirdFormviewerViewItemsItemItem.hasError',
      '[aria-invalid="true"]',
      '.freebirdFormviewerViewItemsItemError',
      '.quantumWizTextinputPaperinputError'
    ];

    for (const selector of errorSelectors) {
      const errors = document.querySelectorAll(selector);
      if (errors.length > 0) {
        console.error(`Found ${errors.length} errors with selector ${selector}:`, errors);
        throw new Error('Ci sono campi obbligatori non compilati');
      }
    }

    submitButton.click();
    console.log('Form submitted');
  } else {
    console.error('Submit button not found. Available buttons:', 
      Array.from(document.querySelectorAll('[role="button"]')).map(b => ({ 
        text: b.textContent, 
        html: b.outerHTML 
      })));
    throw new Error('Pulsante di invio non trovato');
  }
}

function initializeFormFiller() {
  // Aggiungi stili per il toast notifications
  const style = document.createElement('style');
  style.textContent = `
    .formfiller-toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #323232;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s ease;
      animation: fadeInOut 3s ease;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }

    @keyframes fadeInOut {
      0% { opacity: 0; transform: translate(-50%, 20px); }
      10% { opacity: 1; transform: translate(-50%, 0); }
      90% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, 20px); }
    }

    .formfiller-toast.success { background-color: #4caf50; }
    .formfiller-toast.error { background-color: #f44336; }
    .formfiller-toast.info { background-color: #2196f3; }
    .formfiller-toast.warning { background-color: #ff9800; }
  `;
  
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.documentElement.appendChild(style);
  }
}

// Sistema di toast notifications
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `formfiller-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), duration);
}

// Salva le ultime istruzioni usate
function saveLastInstructions(instructions) {
  chrome.storage.local.set({ 'lastInstructions': instructions }, () => {
    console.log('Instructions saved:', instructions);
  });
}

// Recupera le ultime istruzioni usate
function getLastInstructions() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastInstructions'], (result) => {
      resolve(result.lastInstructions || '');
    });
  });
}

// Crea il dialog per le istruzioni
function createInstructionsDialog() {
  const dialog = document.createElement('div');
  dialog.id = 'formfiller-instructions';
  dialog.style.display = 'none';
  dialog.innerHTML = `
    <h3>Enter instructions to fill the form</h3>
    <textarea placeholder="Example: My name is Mario Rossi, I am 25 years old..."></textarea>
    <div class="buttons">
      <button class="cancel">Cancel</button>
      <button class="compile">Fill</button>
    </div>
  `;
  document.body.appendChild(dialog);

  const textarea = dialog.querySelector('textarea');

  // Carica le ultime istruzioni usate
  getLastInstructions().then(instructions => {
    if (instructions) {
      textarea.value = instructions;
      showToast('Last used instructions loaded', 'info');
    }
  });

  // Event listeners
  dialog.querySelector('.cancel').addEventListener('click', () => {
    dialog.style.display = 'none';
  });

  dialog.querySelector('.compile').addEventListener('click', () => {
    const instructions = textarea.value.trim();
    if (instructions) {
      fillFormWithInstructions(instructions);
      // dialog.style.display = 'none'; // Rimosso perché dialog non è definito in questo scope
    } else {
      showToast('Please enter instructions before filling', 'error');
    }
  });

  return dialog;
}

// Function to fill the form with instructions
async function fillFormWithInstructions(instructions, mode = 'smart') {
  try {
    console.log(`Filling form in ${mode} mode...`);
    
    if (mode === 'smart') {
      // Smart mode: uses field selectors and matches fields individually
      console.log('Analyzing form fields...');
      const fields = await analyzeFormFields();
      console.log('Form fields found:', fields);

      const matches = await matchInstructionsToFields(instructions, fields);
      console.log('Matches ready for filling:', matches);

      for (const match of matches) {
        if (!match.field) {
          console.warn('Field not found for match:', match);
          continue;
        }
        console.log('Filling field:', match);
        await fillFormField(match.field, match.value);
      }
    } else {
      // Simple mode: sends entire form to API for processing
      console.log('Sending entire form to API...');
      const formHtml = document.documentElement.outerHTML;
      const response = await getAIResponse(instructions, [], 0, 3, formHtml);
      
      if (response && response.fields) {
        for (const field of response.fields) {
          const element = document.querySelector(field.selector);
          if (element) {
            await fillFormField({ element, type: field.type }, field.value);
          }
        }
      }
    }

    console.log('Form filling complete');
    showToast('Form filled successfully!', 'success');
  } catch (error) {
    console.error('Error filling form:', error);
    showToast(`Error: ${error.message}`, 'error');
  }

}

// Log immediato per verificare che il content script sia caricato
console.log('Content script loaded at:', new Date().toISOString());
console.log('Current URL:', window.location.href);

// Inizializza quando il DOM è pronto
function initOnLoad() {
  if (document.body && document.head) {
    initializeFormFiller();
  } else {
    // Se il DOM non è ancora pronto, riprova tra 100ms
    setTimeout(initOnLoad, 100);
  }
}

// Avvia l'inizializzazione
initOnLoad();

// Backup: ascolta anche l'evento DOMContentLoaded
document.addEventListener('DOMContentLoaded', initializeFormFiller);

// Debug function per testare il selettore dei campi del form
function debugFormFields() {
  console.log('Debugging form fields...');
  const questions = document.querySelectorAll('.freebirdFormviewerComponentsQuestionBaseRoot');
  console.log('Questions found:', questions.length);
  questions.forEach((q, i) => {
    console.log(`Question ${i}:`, q.outerHTML);
  });
}

// Esegui il debug iniziale dopo un breve delay per assicurarsi che il form sia caricato
setTimeout(debugFormFields, 2000);

// Listen for ping messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  if (request.action === 'ping') {
    console.log('Ping received, sending response');
    sendResponse({ status: 'ready' });
    return true;
  }
});

// Listen for connections from the popup
chrome.runtime.onConnect.addListener((port) => {
  console.log('Connection established with port:', port.name);
  console.log('Connection established with popup');

  if (port.name === 'formfiller') {
    console.log('Formfiller connection established');
    port.onMessage.addListener(async (request) => {
      console.log('Received request through port:', request);
      if (request.action === 'fillForm') {
        console.log('Received fillForm request with instructions:', request.instructions);
        console.log('Mode:', request.mode);
        
        try {
          await fillFormWithInstructions(request.instructions, request.mode);
          console.log('Form filling complete');
          port.postMessage({ success: true });
        } catch (error) {
          console.error('Error filling form:', error);
          port.postMessage({ success: false, error: error.message });
        }
      }
    });
  }
});
