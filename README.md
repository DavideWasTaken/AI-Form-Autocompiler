# AI Form Autocompiler Chrome Extension

Automatically fill out Google Forms using OpenAI's GPT models! This extension allows you to provide natural language instructions and have forms filled smartly using AI.

---

## 🚀 Features
- **Smart Mode**: Uses field selectors for accurate and context-aware filling.
- **Simple Mode**: Sends the entire form to the AI for best-effort filling.
- Easy-to-use popup UI.
- Full English interface and logs.

---

## 🛠️ Installation & Setup

### 1. Clone or Download the Repository

### 2. Get an OpenAI API Key
- Sign up at [OpenAI](https://platform.openai.com/) and create an API key.

### 3. Add Your OpenAI API Key
- Open `src/config.js` in a text editor.
- Replace the placeholder with your API key:
  ```js
  // OpenAI API Key
  const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY_HERE';
  ```
- **Do not share your API key publicly!**

### 4. Load the Extension in Chrome
1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the project folder (`AI-Form-Compiler`)

---

## 📝 Usage
1. Go to any Google Form (`docs.google.com/forms/...`).
2. Click the extension icon.
3. Enter your instructions (e.g., "My name is John Doe, I am 25 years old...").
4. Choose the desired mode (Smart/Simple).
5. Click **Fill**. The form will be filled automatically!


## 💡 Tips
- For best results, use clear and specific instructions.
- Smart Mode works best on standard Google Forms.
- If Smart Mode fails, try Simple Mode.

---

## 🐞 Troubleshooting
- If the extension doesn't work, reload the form page and try again.
- Make sure your API key is correct and has enough quota.
- Check the browser console for error logs.

---

## 📄 License
MIT

---

## ✨ Contributions
Pull requests are welcome! For major changes, please open an issue first.

Enjoy effortless form filling! 🚀
